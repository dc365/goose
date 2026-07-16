'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRegistry } = require('./registry.cjs');
const SkillPackage = require('./skill-package.cjs');
const ConnectorClient = require('./connector-client.cjs');

const INSPECTION_TTL_MS = 20 * 60 * 1000;

function sanitizePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function createCapabilityService({ app, dialog, ipcMain, safeStorage, shell, productRoot, homeDir = os.homedir() }) {
  const pendingInspections = new Map();
  let registry = null;

  function paths() {
    const userData = app.getPath('userData');
    const root = path.join(userData, 'capabilities');
    const registryPath = path.join(root, 'registry.json');
    const temp = path.join(root, 'quarantine');
    const bundled = path.join(productRoot, 'bundled-skills');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
    return { root, registryPath, temp, bundled };
  }

  function getRegistry() {
    if (!registry) registry = new JsonRegistry(paths().registryPath);
    return registry;
  }

  function cleanupPending() {
    const now = Date.now();
    for (const [token, prepared] of pendingInspections) {
      if (now - prepared.createdAt <= INSPECTION_TTL_MS) continue;
      if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
      pendingInspections.delete(token);
    }
  }

  function encryptSecrets(secrets) {
    const payload = JSON.stringify(secrets || {});
    if (safeStorage?.isEncryptionAvailable?.()) {
      return { scheme: 'electron-safe-storage', data: safeStorage.encryptString(payload).toString('base64') };
    }
    return { scheme: 'base64-plain', data: Buffer.from(payload, 'utf8').toString('base64') };
  }

  function decryptSecrets(secretRecord) {
    if (!secretRecord?.data) return { env: {}, headers: {} };
    try {
      const buffer = Buffer.from(secretRecord.data, 'base64');
      const text = secretRecord.scheme === 'electron-safe-storage' && safeStorage?.isEncryptionAvailable?.()
        ? safeStorage.decryptString(buffer)
        : buffer.toString('utf8');
      const parsed = JSON.parse(text);
      return {
        env: parsed?.env && typeof parsed.env === 'object' ? parsed.env : {},
        headers: parsed?.headers && typeof parsed.headers === 'object' ? parsed.headers : {},
      };
    } catch {
      return { env: {}, headers: {} };
    }
  }

  function redactConnector(record) {
    const secrets = decryptSecrets(record.secrets);
    const copy = { ...record };
    delete copy.secrets;
    copy.secretKeys = {
      env: Object.keys(secrets.env || {}),
      headers: Object.keys(secrets.headers || {}),
    };
    copy.secretStorage = record.secrets?.scheme || 'none';
    return copy;
  }

  function listBundledSkills() {
    const bundledRoot = paths().bundled;
    if (!fs.existsSync(bundledRoot)) return [];
    const result = [];
    for (const entry of fs.readdirSync(bundledRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = path.join(bundledRoot, entry.name);
      try {
        const report = SkillPackage.inspectRoot(source);
        result.push({
          id: report.skill.id,
          name: report.skill.displayName,
          version: report.skill.version,
          description: report.skill.description,
          risk: report.risk,
          warnings: report.warnings,
          sourcePath: source,
          bundled: true,
          integrity: report.integrity,
          requires: report.sidecar?.data?.requires || {},
          sidecar: report.sidecar?.data || null,
        });
      } catch (error) {
        result.push({
          id: entry.name,
          name: entry.name,
          version: '0.0.0',
          description: '随产品提供的 Skill 无法通过校验',
          bundled: true,
          broken: true,
          error: error.message,
        });
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }

  function registrySnapshot() {
    const snapshot = getRegistry().snapshot();
    return {
      ...snapshot,
      bundledSkills: listBundledSkills(),
      connectors: snapshot.connectors.map(redactConnector),
      encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()),
    };
  }

  async function chooseSkillFile() {
    const result = await dialog.showOpenDialog({
      title: '选择 Skill ZIP 或 SKILL.md',
      properties: ['openFile'],
      filters: [
        { name: 'Skill Package', extensions: ['zip', 'md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  }

  async function chooseSkillDirectory() {
    const result = await dialog.showOpenDialog({
      title: '选择包含 SKILL.md 的目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  }

  function inspectSkill(sourcePath) {
    cleanupPending();
    const prepared = SkillPackage.prepareSource(sourcePath, paths().temp);
    const token = crypto.randomUUID();
    pendingInspections.set(token, { ...prepared, createdAt: Date.now() });
    return { token, report: { ...prepared.report, root: undefined } };
  }

  function inspectBundledSkill(skillId) {
    const sourcePath = path.join(paths().bundled, sanitizePathSegment(skillId));
    return inspectSkill(sourcePath);
  }

  function installBase({ scope, workspace }) {
    if (scope === 'project') {
      if (!workspace) throw new Error('安装到项目需要选择项目工作区');
      return path.join(path.resolve(workspace), '.agents', 'skills');
    }
    return path.join(homeDir, '.agents', 'skills');
  }

  function disabledBase({ scope, workspace }) {
    if (scope === 'project') return path.join(path.resolve(workspace), '.agents', 'disabled-skills');
    return path.join(homeDir, '.agents', 'disabled-skills');
  }

  function installationId(report, scope, projectId) {
    return `${scope}:${projectId || 'user'}:${report.skill.id}`;
  }

  function installSkill(request) {
    cleanupPending();
    const prepared = pendingInspections.get(request.token);
    if (!prepared) throw new Error('Skill 检查结果已过期，请重新选择文件');
    if (request.reportHash && request.reportHash !== prepared.report.reportHash) {
      throw new Error('Skill 检查结果与安装请求不一致');
    }
    const scope = request.scope === 'project' ? 'project' : 'user';
    const workspace = scope === 'project' ? String(request.workspace || '') : '';
    const targetBase = installBase({ scope, workspace });
    const target = SkillPackage.installPreparedSkill(prepared.root, targetBase, prepared.report.skill.id, {
      replace: Boolean(request.replace),
    });
    const now = Date.now();
    const record = {
      apiVersion: 'meteomate.ai/v1',
      kind: 'SkillInstallation',
      id: installationId(prepared.report, scope, request.projectId),
      skillId: prepared.report.skill.id,
      name: prepared.report.skill.displayName,
      description: prepared.report.skill.description,
      version: prepared.report.skill.version,
      scope,
      projectId: scope === 'project' ? request.projectId || null : null,
      workspace: scope === 'project' ? workspace : null,
      installPath: target,
      enabled: true,
      source: {
        type: prepared.sourcePath.startsWith(paths().bundled) ? 'bundled' : path.extname(prepared.sourcePath).toLowerCase() === '.zip' ? 'zip' : 'directory',
        path: prepared.sourcePath,
      },
      integrity: prepared.report.integrity,
      reportHash: prepared.report.reportHash,
      risk: prepared.report.risk,
      warnings: prepared.report.warnings,
      files: prepared.report.files,
      sidecar: prepared.report.sidecar?.data || null,
      projectIds: scope === 'project' && request.projectId ? [request.projectId] : [],
      installedAt: now,
      updatedAt: now,
    };
    getRegistry().upsertSkill(record);
    if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
    pendingInspections.delete(request.token);
    return { installation: record, registry: registrySnapshot() };
  }

  function resolveSkillPath(record, enabled) {
    const base = enabled
      ? installBase({ scope: record.scope, workspace: record.workspace })
      : disabledBase({ scope: record.scope, workspace: record.workspace });
    return path.join(base, record.skillId);
  }

  function setSkillEnabled(id, enabled) {
    const record = getRegistry().getSkill(id);
    if (!record) throw new Error('Skill 安装记录不存在');
    if (Boolean(record.enabled) === Boolean(enabled)) return { installation: record, registry: registrySnapshot() };
    const source = record.installPath;
    const target = resolveSkillPath(record, enabled);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(source)) throw new Error('Skill 安装目录不存在，建议卸载后重新安装');
    if (fs.existsSync(target)) throw new Error('目标目录已存在，无法切换 Skill 状态');
    fs.renameSync(source, target);
    record.installPath = target;
    record.enabled = Boolean(enabled);
    record.updatedAt = Date.now();
    getRegistry().upsertSkill(record);
    return { installation: record, registry: registrySnapshot() };
  }

  function uninstallSkill(id) {
    const record = getRegistry().getSkill(id);
    if (!record) return { removed: false, registry: registrySnapshot() };
    const allowedEnabled = resolveSkillPath(record, true);
    const allowedDisabled = resolveSkillPath(record, false);
    const actual = path.resolve(record.installPath);
    if (![path.resolve(allowedEnabled), path.resolve(allowedDisabled)].includes(actual)) {
      throw new Error('安装路径不在允许的 Skill 目录内，拒绝卸载');
    }
    fs.rmSync(actual, { recursive: true, force: true });
    getRegistry().removeSkill(id);
    return { removed: true, registry: registrySnapshot() };
  }

  function updateSkillProjects(id, projectIds) {
    const record = getRegistry().getSkill(id);
    if (!record) throw new Error('Skill 安装记录不存在');
    record.projectIds = [...new Set((projectIds || []).map(String).filter(Boolean))];
    record.updatedAt = Date.now();
    getRegistry().upsertSkill(record);
    return { installation: record, registry: registrySnapshot() };
  }

  function saveConnector(input) {
    const existing = input.id ? getRegistry().getConnector(input.id) : null;
    const { record, secrets } = ConnectorClient.normalizeConnector({ ...existing, ...input });
    const existingSecrets = existing ? decryptSecrets(existing.secrets) : { env: {}, headers: {} };
    const mergedSecrets = {
      env: Object.keys(secrets.env || {}).length ? secrets.env : existingSecrets.env,
      headers: Object.keys(secrets.headers || {}).length ? secrets.headers : existingSecrets.headers,
    };
    record.createdAt = existing?.createdAt || record.createdAt;
    record.lastTest = existing?.lastTest || null;
    record.secrets = encryptSecrets(mergedSecrets);
    getRegistry().upsertConnector(record);
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  async function testConnector(input) {
    let record;
    let secrets;
    if (input?.id && !input.transport && getRegistry().getConnector(input.id)) {
      record = getRegistry().getConnector(input.id);
      secrets = decryptSecrets(record.secrets);
    } else {
      const normalized = ConnectorClient.normalizeConnector(input || {});
      record = normalized.record;
      secrets = normalized.secrets;
    }
    const startedAt = Date.now();
    try {
      const result = await ConnectorClient.testConnector(record, secrets);
      const lastTest = { ok: true, checkedAt: Date.now(), durationMs: Date.now() - startedAt, result };
      if (getRegistry().getConnector(record.id)) {
        const stored = getRegistry().getConnector(record.id);
        stored.lastTest = lastTest;
        stored.updatedAt = Date.now();
        getRegistry().upsertConnector(stored);
      }
      return lastTest;
    } catch (error) {
      const lastTest = { ok: false, checkedAt: Date.now(), durationMs: Date.now() - startedAt, error: error.message };
      if (getRegistry().getConnector(record.id)) {
        const stored = getRegistry().getConnector(record.id);
        stored.lastTest = lastTest;
        stored.updatedAt = Date.now();
        getRegistry().upsertConnector(stored);
      }
      return lastTest;
    }
  }

  function setConnectorEnabled(id, enabled) {
    const record = getRegistry().getConnector(id);
    if (!record) throw new Error('连接器不存在');
    record.enabled = Boolean(enabled);
    record.updatedAt = Date.now();
    getRegistry().upsertConnector(record);
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  function deleteConnector(id) {
    const removed = getRegistry().removeConnector(id);
    return { removed, registry: registrySnapshot() };
  }

  function updateConnectorProjects(id, projectIds) {
    const record = getRegistry().getConnector(id);
    if (!record) throw new Error('连接器不存在');
    record.projectIds = [...new Set((projectIds || []).map(String).filter(Boolean))];
    record.updatedAt = Date.now();
    getRegistry().upsertConnector(record);
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  function extensionsForRequest(request = {}) {
    const selected = new Set((request.connectorIds || []).map(String));
    const projectId = request.projectId ? String(request.projectId) : null;
    const result = [];
    for (const connector of getRegistry().load().connectors) {
      if (!connector.enabled) continue;
      const selectedForTask = selected.has(connector.id);
      const boundToProject = projectId && Array.isArray(connector.projectIds) && connector.projectIds.includes(projectId);
      if (!selectedForTask && !boundToProject) continue;
      result.push(ConnectorClient.extensionConfig(connector, decryptSecrets(connector.secrets)));
    }
    return result;
  }

  function registerIpc() {
    ipcMain.handle('capability:list', async () => registrySnapshot());
    ipcMain.handle('capability:choose-skill-file', async () => chooseSkillFile());
    ipcMain.handle('capability:choose-skill-directory', async () => chooseSkillDirectory());
    ipcMain.handle('capability:inspect-skill', async (_event, sourcePath) => inspectSkill(sourcePath));
    ipcMain.handle('capability:inspect-bundled-skill', async (_event, skillId) => inspectBundledSkill(skillId));
    ipcMain.handle('capability:install-skill', async (_event, request) => installSkill(request || {}));
    ipcMain.handle('capability:set-skill-enabled', async (_event, request) => setSkillEnabled(request?.id, request?.enabled));
    ipcMain.handle('capability:uninstall-skill', async (_event, id) => uninstallSkill(id));
    ipcMain.handle('capability:update-skill-projects', async (_event, request) => updateSkillProjects(request?.id, request?.projectIds));
    ipcMain.handle('capability:save-connector', async (_event, request) => saveConnector(request || {}));
    ipcMain.handle('capability:test-connector', async (_event, request) => testConnector(request || {}));
    ipcMain.handle('capability:set-connector-enabled', async (_event, request) => setConnectorEnabled(request?.id, request?.enabled));
    ipcMain.handle('capability:delete-connector', async (_event, id) => deleteConnector(id));
    ipcMain.handle('capability:update-connector-projects', async (_event, request) => updateConnectorProjects(request?.id, request?.projectIds));
    ipcMain.handle('capability:open-path', async (_event, targetPath) => {
      if (!targetPath || typeof targetPath !== 'string') return false;
      const error = await shell.openPath(targetPath);
      return error === '';
    });
  }

  return {
    registerIpc,
    registrySnapshot,
    extensionsForRequest,
    inspectSkill,
    installSkill,
    setSkillEnabled,
    uninstallSkill,
    saveConnector,
    testConnector,
    paths,
  };
}

module.exports = { createCapabilityService };
