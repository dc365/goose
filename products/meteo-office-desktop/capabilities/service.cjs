'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRegistry } = require('./registry.cjs');
const SkillPackage = require('./skill-package.cjs');
const ConnectorClient = require('./connector-client.cjs');
const BrowserConnector = require('./browser-connector.js');

const INSPECTION_TTL_MS = 20 * 60 * 1000;

function sanitizePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function createCapabilityService({ app, dialog, ipcMain, shell, productRoot, profileContext, homeDir = os.homedir() }) {
  const pendingInspections = new Map();
  let registry = null;

  function paths() {
    const profilePaths = profileContext?.currentPaths();
    const root = profilePaths?.capabilities || path.join(app.getPath('userData'), 'capabilities');
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

  function connectorAllowed(id) {
    return !profileContext?.connectorAllowed || profileContext.connectorAllowed(id);
  }

  function browserCommand() {
    const executableName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const candidates = [
      process.env.METEOMATE_NPX_PATH,
      path.join(productRoot, 'runtime', 'node', process.platform === 'win32' ? '' : 'bin', executableName),
      ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/npx', '/usr/local/bin/npx'] : []),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next product or system runtime location.
      }
    }
    return ConnectorClient.executableExists(executableName) ? executableName : 'npx';
  }

  function materializeConnectorInput(input = {}) {
    if (!BrowserConnector.isBrowserConnector(input)) return input;
    const outputDir = path.join(paths().root, 'browser', 'artifacts');
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    return BrowserConnector.materialize(input, {
      command: browserCommand(),
      outputDir,
    });
  }

  function connectorToolCeiling(connector) {
    if (BrowserConnector.isBrowserConnector(connector)) return [...BrowserConnector.SAFE_TOOLS];
    return Array.isArray(connector.toolAllowlist)
      ? [...new Set(connector.toolAllowlist.map(String).filter(Boolean))]
      : null;
  }

  function cleanupPending() {
    const now = Date.now();
    for (const [token, prepared] of pendingInspections) {
      if (now - prepared.createdAt <= INSPECTION_TTL_MS) continue;
      if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
      pendingInspections.delete(token);
    }
  }

  function encodeSecrets(secrets) {
    const payload = JSON.stringify(secrets || {});
    return { scheme: 'local-obfuscated', data: Buffer.from(payload, 'utf8').toString('base64') };
  }

  function decodeSecrets(secretRecord) {
    if (!secretRecord?.data) return { env: {}, headers: {} };
    if (!['local-obfuscated', 'local-base64', 'base64-plain'].includes(secretRecord.scheme)) {
      return { env: {}, headers: {} };
    }
    try {
      const buffer = Buffer.from(secretRecord.data, 'base64');
      const text = buffer.toString('utf8');
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
    const secrets = decodeSecrets(record.secrets);
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
      connectors: snapshot.connectors.map((record) => ({
        ...redactConnector(record),
        policyBlocked: !connectorAllowed(record.id),
      })),
      organizationPolicy: profileContext?.policyContext() || null,
      encryptionAvailable: false,
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
    const assistantWorkspace = profileContext?.currentPaths().assistantWorkspace;
    return assistantWorkspace ? path.join(assistantWorkspace, '.agents', 'skills') : path.join(homeDir, '.agents', 'skills');
  }

  function disabledBase({ scope, workspace }) {
    if (scope === 'project') return path.join(path.resolve(workspace), '.agents', 'disabled-skills');
    const assistantWorkspace = profileContext?.currentPaths().assistantWorkspace;
    return assistantWorkspace ? path.join(assistantWorkspace, '.agents', 'disabled-skills') : path.join(homeDir, '.agents', 'disabled-skills');
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
      managedByPolicy: Boolean(request.managedByPolicy),
      managedPolicyRevision: request.managedByPolicy ? Number(request.managedPolicyRevision || 0) : null,
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
    if (record.managedByPolicy && !enabled) throw new Error('该 Skill 是组织默认能力，不能关闭');
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
    if (record.managedByPolicy) throw new Error('该 Skill 是组织默认能力，不能卸载');
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
    if (!connectorAllowed(input.id)) throw new Error('管理员策略不允许使用该工具');
    const existing = input.id ? getRegistry().getConnector(input.id) : null;
    const preparedInput = materializeConnectorInput({ ...existing, ...input });
    const effectiveLastTest = Object.prototype.hasOwnProperty.call(input, 'lastTest')
      ? input.lastTest
      : existing?.lastTest;
    if (BrowserConnector.isBrowserConnector(preparedInput) && preparedInput.enabled !== false && effectiveLastTest?.ok !== true) {
      throw new Error('启用浏览器操作前，请先完成连接测试');
    }
    const { record, secrets } = ConnectorClient.normalizeConnector(preparedInput);
    const existingSecrets = existing ? decodeSecrets(existing.secrets) : { env: {}, headers: {} };
    const mergedSecrets = {
      env: Object.keys(secrets.env || {}).length ? secrets.env : existingSecrets.env,
      headers: Object.keys(secrets.headers || {}).length ? secrets.headers : existingSecrets.headers,
    };
    record.createdAt = existing?.createdAt || record.createdAt;
    record.lastTest = Object.prototype.hasOwnProperty.call(input, 'lastTest')
      ? ConnectorClient.normalizeLastTest(input.lastTest)
      : existing?.lastTest || null;
    record.secrets = encodeSecrets(mergedSecrets);
    getRegistry().upsertConnector(record);
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  async function testConnector(input) {
    if (!connectorAllowed(input?.id)) throw new Error('管理员策略不允许使用该工具');
    let record;
    let secrets;
    if (input?.id && !input.transport && getRegistry().getConnector(input.id)) {
      record = materializeConnectorInput(getRegistry().getConnector(input.id));
      secrets = decodeSecrets(record.secrets);
    } else {
      const normalized = ConnectorClient.normalizeConnector(materializeConnectorInput(input || {}));
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
    if (!record) throw new Error('工具服务不存在');
    if (enabled && !connectorAllowed(id)) throw new Error('管理员策略不允许启用该工具');
    if (enabled && BrowserConnector.isBrowserConnector(record) && record.lastTest?.ok !== true) {
      throw new Error('启用浏览器操作前，请先完成连接测试');
    }
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
    if (!record) throw new Error('工具服务不存在');
    record.projectIds = [...new Set((projectIds || []).map(String).filter(Boolean))];
    record.updatedAt = Date.now();
    getRegistry().upsertConnector(record);
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  function selectedConnectorConfigs(request = {}, toExtension) {
    const selected = new Set((request.connectorIds || []).map(String));
    const hasExplicitConnectorSelection = Array.isArray(request.connectorIds);
    const toolSelections = request.toolSelections && typeof request.toolSelections === 'object'
      ? request.toolSelections
      : {};
    const projectId = request.projectId ? String(request.projectId) : null;
    const result = [];
    for (const connector of getRegistry().load().connectors) {
      if (!connector.enabled) continue;
      if (!connectorAllowed(connector.id)) continue;
      const selectedForTask = selected.has(connector.id);
      const boundToProject = projectId && Array.isArray(connector.projectIds) && connector.projectIds.includes(projectId);
      if (hasExplicitConnectorSelection ? !selectedForTask : !selectedForTask && !boundToProject) continue;
      const runtimeConnector = materializeConnectorInput(connector);
      const toolCeiling = connectorToolCeiling(runtimeConnector);
      const hasToolSelection = Object.prototype.hasOwnProperty.call(toolSelections, connector.id);
      const requestedTools = hasToolSelection
        ? [...new Set((Array.isArray(toolSelections[connector.id]) ? toolSelections[connector.id] : []).map(String).filter(Boolean))]
        : null;
      const availableTools = toolCeiling
        ? toolCeiling.filter((tool) => !requestedTools || requestedTools.includes(tool))
        : requestedTools;
      if (hasToolSelection && !availableTools.length) continue;
      result.push(toExtension(runtimeConnector, decodeSecrets(connector.secrets), availableTools));
    }
    return result;
  }

  function extensionsForRequest(request = {}) {
    return selectedConnectorConfigs(request, ConnectorClient.gooseExtensionConfig);
  }

  function sessionExtensionsForRequest(request = {}) {
    return selectedConnectorConfigs(request, ConnectorClient.extensionConfig);
  }

  function permissionContextForRequest(request = {}) {
    const selected = new Set((request.connectorIds || []).map(String));
    const toolSelections = request.toolSelections && typeof request.toolSelections === 'object'
      ? request.toolSelections
      : {};
    const connectors = getRegistry().load().connectors
      .filter((connector) => connector.enabled && selected.has(connector.id) && connectorAllowed(connector.id))
      .map((connector) => {
        const toolCeiling = connectorToolCeiling(connector);
        const requestedTools = Object.prototype.hasOwnProperty.call(toolSelections, connector.id)
          ? [...new Set((toolSelections[connector.id] || []).map(String).filter(Boolean))]
          : null;
        const selectedTools = toolCeiling
          ? toolCeiling.filter((tool) => !requestedTools || requestedTools.includes(tool))
          : requestedTools || [];
        const explicitToolSelection = requestedTools !== null || Boolean(toolCeiling);
        return {
          id: connector.id,
          transport: connector.transport,
          ...(connector.connectorType ? { connectorType: connector.connectorType } : {}),
          riskClassification: connector.riskClassification || 'medium',
          verified: connector.lastTest?.ok === true,
          explicitToolSelection,
          selectedTools,
          tools: Array.isArray(connector.lastTest?.result?.tools)
            ? connector.lastTest.result.tools.map((tool) => ({
                name: String(tool.name || ''),
                description: String(tool.description || ''),
              }))
            : [],
        };
      });
    return { connectors };
  }

  function syncManagedSkills(skillIds = [], revision = 0) {
    const managed = new Set((skillIds || []).map(String));
    for (const record of getRegistry().load().skills) {
      const shouldManage = record.scope === 'user' && managed.has(record.skillId);
      if (
        Boolean(record.managedByPolicy) === shouldManage &&
        (!shouldManage || (record.managedPolicyRevision === revision && record.enabled))
      ) continue;
      record.managedByPolicy = shouldManage;
      record.managedPolicyRevision = shouldManage ? Number(revision || 0) : null;
      if (shouldManage && !record.enabled) {
        const target = resolveSkillPath(record, true);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (!fs.existsSync(record.installPath)) throw new Error(`组织默认 Skill 安装目录不存在：${record.skillId}`);
        if (fs.existsSync(target)) throw new Error(`组织默认 Skill 启用目录已存在：${record.skillId}`);
        fs.renameSync(record.installPath, target);
        record.installPath = target;
        record.enabled = true;
      }
      record.updatedAt = Date.now();
      getRegistry().upsertSkill(record);
    }
    return registrySnapshot();
  }

  function installBundledDefault(skillId, revision = 0) {
    const existing = getRegistry().load().skills.find((item) => item.scope === 'user' && item.skillId === skillId);
    if (existing) {
      existing.managedByPolicy = true;
      existing.managedPolicyRevision = Number(revision || 0);
      if (!existing.enabled) {
        const target = resolveSkillPath(existing, true);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(existing.installPath) && !fs.existsSync(target)) fs.renameSync(existing.installPath, target);
        existing.installPath = target;
        existing.enabled = true;
      }
      existing.updatedAt = Date.now();
      getRegistry().upsertSkill(existing);
      return { installation: existing, registry: registrySnapshot(), installed: false };
    }
    if (!listBundledSkills().some((item) => item.id === skillId && !item.broken)) return null;
    const inspection = inspectBundledSkill(skillId);
    return {
      ...installSkill({
        token: inspection.token,
        reportHash: inspection.report.reportHash,
        scope: 'user',
        managedByPolicy: true,
        managedPolicyRevision: revision,
      }),
      installed: true,
    };
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

  profileContext?.onChange(() => {
    registry = null;
    for (const prepared of pendingInspections.values()) {
      if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
    }
    pendingInspections.clear();
  });

  return {
    registerIpc,
    registrySnapshot,
    extensionsForRequest,
    sessionExtensionsForRequest,
    permissionContextForRequest,
    inspectSkill,
    installSkill,
    setSkillEnabled,
    uninstallSkill,
    saveConnector,
    testConnector,
    syncManagedSkills,
    installBundledDefault,
    paths,
  };
}

module.exports = { createCapabilityService };
