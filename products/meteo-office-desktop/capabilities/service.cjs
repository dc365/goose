'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRegistry } = require('./registry.cjs');
const SkillPackage = require('./skill-package.cjs');
const ConnectorClient = require('./connector-client.cjs');
const BrowserConnector = require('./browser-connector.js');
const BrowserRuntime = require('./browser-runtime.cjs');
const ComputerConnector = require('./computer-connector.js');
const ComputerRuntime = require('./computer-runtime.cjs');
const OfficeConnector = require('./office-connector.js');
const OfficeRuntime = require('./office-runtime.cjs');
const WeatherConnector = require('./weather-connector.js');
const { compareSkillVersions } = require('./skill-version.cjs');

const INSPECTION_TTL_MS = 20 * 60 * 1000;
const MAX_RUNTIME_SKILL_CHARS = 32_000;
const MAX_RUNTIME_SKILL_RESOURCE_CHARS = 12_000;
const RUNTIME_SKILL_RESOURCE_EXTENSIONS = new Set([
  '.csv',
  '.json',
  '.md',
  '.txt',
  '.tsv',
  '.yaml',
  '.yml',
]);
const EXPERT_STATUSES = new Set(['draft', 'enabled', 'disabled', 'archived']);
const EXPERT_WORK_MODES = new Set(['ask', 'plan', 'execute']);

function sanitizePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function createCapabilityService({
  app,
  dialog,
  ipcMain,
  shell,
  productRoot,
  profileContext,
  secretStore,
  computerRuntime,
  homeDir = os.homedir(),
}) {
  const pendingInspections = new Map();
  const computerRuntimeManager = computerRuntime || ComputerRuntime.createComputerRuntimeManager({
    app,
    productRoot,
    openAccessibilitySettings: typeof shell?.openExternal === 'function'
      ? () => shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      )
      : null,
  });
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

  function browserRuntime() {
    return BrowserRuntime.resolveBrowserRuntime({
      productRoot,
      allowSystemFallback: app.isPackaged !== true || process.env.METEOMATE_ALLOW_SYSTEM_BROWSER_RUNTIME === '1',
      mcpPackage: BrowserConnector.MCP_PACKAGE,
    });
  }

  function officeRuntime() {
    return OfficeRuntime.resolveOfficeRuntime({
      productRoot,
      allowSystemFallback: app.isPackaged !== true || process.env.METEOMATE_ALLOW_SYSTEM_OFFICE_RUNTIME === '1',
    });
  }

  function officeWorkspace(request = {}) {
    if (request.workspace && path.isAbsolute(request.workspace)) {
      const workspace = path.resolve(request.workspace);
      if (fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()) return workspace;
    }
    const workspace = path.join(paths().root, 'office', 'test-workspace');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    return workspace;
  }

  function weatherWorkspace(request = {}) {
    if (request.workspace && path.isAbsolute(request.workspace)) {
      const workspace = path.resolve(request.workspace);
      if (fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()) return workspace;
    }
    const workspace = path.join(paths().root, 'weather-demo', 'workspace');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    return workspace;
  }

  function materializeConnectorInput(input = {}, request = {}) {
    if (BrowserConnector.isBrowserConnector(input)) {
      const outputDir = path.join(paths().root, 'browser', 'artifacts');
      fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
      return BrowserConnector.materialize(input, {
        runtime: browserRuntime(),
        outputDir,
      });
    }
    if (ComputerConnector.isComputerConnector(input)) {
      return ComputerConnector.materialize(input, {
        connection: computerRuntimeManager.connection(),
        runtimeInfo: computerRuntimeManager.runtimeInfo(),
      });
    }
    if (OfficeConnector.isOfficeConnector(input)) {
      return OfficeConnector.materialize(input, {
        runtime: officeRuntime(),
        workspace: officeWorkspace(request),
      });
    }
    if (WeatherConnector.isWeatherConnector(input)) {
      return WeatherConnector.materialize(input, {
        productRoot,
        workspace: weatherWorkspace(request),
        attestationKeyFile: path.join(paths().root, 'weather-provider-attestation.key'),
      });
    }
    return input;
  }

  function connectorToolCeiling(connector) {
    if (BrowserConnector.isBrowserConnector(connector)) return [...BrowserConnector.SAFE_TOOLS];
    if (ComputerConnector.isComputerConnector(connector)) return [...ComputerConnector.SAFE_TOOLS];
    if (OfficeConnector.isOfficeConnector(connector)) return [...OfficeConnector.SAFE_TOOLS];
    if (WeatherConnector.isWeatherConnector(connector)) {
      return [...(WeatherConnector.PRESETS[connector.id]?.toolAllowlist || [])];
    }
    return Array.isArray(connector.toolAllowlist)
      ? [...new Set(connector.toolAllowlist.map(String).filter(Boolean))]
      : null;
  }

  function ensureDemoWeatherConnectors() {
    if (process.env.METEOMATE_DEMO !== '1' && process.env.METEOMATE_MOCK !== '1') return;
    for (const preset of Object.values(WeatherConnector.PRESETS)) {
      if (getRegistry().getConnector(preset.id)) continue;
      const materialized = materializeConnectorInput({
        ...preset,
        enabled: true,
        projectIds: [],
      });
      const { record, secrets } = ConnectorClient.normalizeConnector(materialized);
      record.lastTest = ConnectorClient.normalizeLastTest(WeatherConnector.discoveryResult(preset.id));
      record.secrets = encodeSecrets(secrets, preset.id);
      getRegistry().upsertConnector(record);
    }
  }

  function connectorSelectedForRequest(connector, request = {}) {
    const selected = new Set((request.connectorIds || []).map(String));
    const hasExplicitConnectorSelection = Array.isArray(request.connectorIds);
    const projectId = request.projectId ? String(request.projectId) : null;
    const selectedForTask = selected.has(connector.id);
    const boundToProject = projectId
      && Array.isArray(connector.projectIds)
      && connector.projectIds.includes(projectId);
    return hasExplicitConnectorSelection
      ? selectedForTask
      : selectedForTask || boundToProject;
  }

  function assertSelectedToolsReady(request = {}) {
    const toolSelections = request.toolSelections && typeof request.toolSelections === 'object'
      ? request.toolSelections
      : {};
    const connectors = getRegistry().load().connectors;
    const issues = [];
    const unavailableConnectorIds = new Set();
    for (const connectorId of uniqueStrings(request.connectorIds)) {
      if (connectorId === 'local-workspace') continue;
      const connector = connectors.find((item) => item.id === connectorId);
      if (!connector?.enabled || !connectorAllowed(connectorId)) {
        issues.push(`工具服务“${connector?.name || connectorId}”未连接或已被禁用`);
        unavailableConnectorIds.add(connectorId);
        continue;
      }
      if (connector.lastTest?.ok !== true || !Array.isArray(connector.lastTest?.result?.tools)) {
        issues.push(`工具服务“${connector.name || connectorId}”需要重新测试连接`);
        unavailableConnectorIds.add(connectorId);
      }
    }
    for (const [connectorId, values] of Object.entries(toolSelections)) {
      const requestedTools = uniqueStrings(
        connectorId === OfficeConnector.ID ? OfficeConnector.upgradeToolSelection(values) : values
      );
      if (!requestedTools.length || unavailableConnectorIds.has(connectorId)) continue;
      const connector = connectors.find((item) => item.id === connectorId);
      if (!connector?.enabled || !connectorAllowed(connectorId)) {
        issues.push(`工具服务“${connector?.name || connectorId}”未连接或已被禁用`);
        continue;
      }
      if (connector.lastTest?.ok !== true || !Array.isArray(connector.lastTest?.result?.tools)) {
        issues.push(`工具服务“${connector.name || connectorId}”需要重新测试连接`);
        continue;
      }
      const ceiling = connectorToolCeiling(connector);
      const discovered = OfficeConnector.isOfficeConnector(connector)
        ? ceiling
        : connector.lastTest.result.tools
          .map((tool) => String(tool?.name || '').trim())
          .filter(Boolean);
      const available = new Set(
        ceiling ? discovered.filter((tool) => ceiling.includes(tool)) : discovered
      );
      const missing = requestedTools.filter((tool) => !available.has(tool));
      if (missing.length) {
        issues.push(`工具服务“${connector.name || connectorId}”中已不存在：${missing.join('、')}`);
      }
    }
    if (!issues.length) return;
    const error = new Error(`工具配置未就绪：${issues.join('；')}。请重新测试连接并选择可用工具。`);
    error.code = 'CAPABILITY_TOOLS_NOT_READY';
    error.issues = issues;
    throw error;
  }

  async function prepareForRequest(request = {}) {
    assertSelectedToolsReady(request);
    const requiresComputerRuntime = getRegistry().load().connectors.some(
      (connector) => connector.enabled
        && connectorAllowed(connector.id)
        && ComputerConnector.isComputerConnector(connector)
        && connectorSelectedForRequest(connector, request)
    );
    if (requiresComputerRuntime) await computerRuntimeManager.start();
  }

  function cleanupPending() {
    const now = Date.now();
    for (const [token, prepared] of pendingInspections) {
      if (now - prepared.createdAt <= INSPECTION_TTL_MS) continue;
      if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
      pendingInspections.delete(token);
    }
  }

  const volatileSecrets = new Map();

  function connectorSecretRef(id) {
    const connectorId = sanitizePathSegment(id || 'connector');
    return secretStore?.reference?.('connector', connectorId) || `connector:${connectorId}`;
  }

  function decodeLegacySecrets(secretRecord) {
    if (!secretRecord?.data) return { env: {}, headers: {} };
    if (!['local-obfuscated', 'local-base64', 'base64-plain'].includes(secretRecord.scheme)) {
      return { env: {}, headers: {} };
    }
    try {
      const parsed = JSON.parse(Buffer.from(secretRecord.data, 'base64').toString('utf8'));
      return {
        env: parsed?.env && typeof parsed.env === 'object' ? parsed.env : {},
        headers: parsed?.headers && typeof parsed.headers === 'object' ? parsed.headers : {},
      };
    } catch {
      return { env: {}, headers: {} };
    }
  }

  function encodeSecrets(secrets, connectorId = 'connector') {
    const normalized = {
      env: secrets?.env && typeof secrets.env === 'object' ? secrets.env : {},
      headers: secrets?.headers && typeof secrets.headers === 'object' ? secrets.headers : {},
    };
    const ref = connectorSecretRef(connectorId);
    if (!Object.keys(normalized.env).length && !Object.keys(normalized.headers).length) {
      secretStore?.remove?.(ref);
      volatileSecrets.delete(ref);
      return null;
    }
    if (secretStore) return secretStore.put(ref, normalized, { kind: 'connector', connectorId: String(connectorId) });
    volatileSecrets.set(ref, normalized);
    return { scheme: 'secret-ref', ref, volatile: true };
  }

  function decodeSecrets(secretRecord) {
    if (!secretRecord) return { env: {}, headers: {} };
    if (secretRecord.scheme === 'secret-ref' && secretRecord.ref) {
      return secretStore?.get?.(secretRecord.ref, null)
        || volatileSecrets.get(secretRecord.ref)
        || { env: {}, headers: {} };
    }
    if (secretStore?.state?.().mode === 'strict') return { env: {}, headers: {} };
    return decodeLegacySecrets(secretRecord);
  }

  function migrateConnectorSecrets(record) {
    if (!record?.id || !record.secrets || record.secrets.scheme === 'secret-ref') return record;
    try {
      const migrated = encodeSecrets(decodeLegacySecrets(record.secrets), record.id);
      record.secrets = migrated;
      record.updatedAt = Date.now();
      getRegistry().upsertConnector(record);
    } catch {
      // Leave the record untouched so a later run with secure storage can migrate it.
    }
    return record;
  }

  function removeConnectorSecrets(record) {
    const ref = record?.secrets?.ref || connectorSecretRef(record?.id || 'connector');
    secretStore?.remove?.(ref);
    volatileSecrets.delete(ref);
  }

  function redactConnector(record) {
    const secrets = decodeSecrets(record.secrets);
    const copy = { ...record };
    delete copy.secrets;
    copy.secretKeys = {
      env: Object.keys(secrets.env || {}),
      headers: Object.keys(secrets.headers || {}),
    };
    const state = secretStore?.state?.() || { encryptionAvailable: false, backend: 'volatile-test-only' };
    copy.secretStorage = record.secrets?.scheme || 'none';
    copy.secretBackend = record.secrets?.scheme === 'secret-ref' ? state.backend : record.secrets?.scheme || 'none';
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
          category: report.sidecar?.data?.categories?.[0] || '本地技能',
          categories: Array.isArray(report.sidecar?.data?.categories) ? report.sidecar.data.categories : [],
          icon: report.sidecar?.data?.icon || report.skill.displayName.slice(0, 1).toUpperCase(),
          tags: Array.isArray(report.sidecar?.data?.tags) ? report.sidecar.data.tags : [],
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

  function runtimeSkillInstruction(record) {
    if (!record?.enabled || !record.installPath) return '';
    const skillFile = path.join(record.installPath, 'SKILL.md');
    try {
      const installRoot = path.resolve(record.installPath);
      const resourceBlocks = [];
      let resourceChars = 0;
      const resourceFiles = Array.isArray(record.files)
        ? record.files
          .map((file) => String(file?.path || '').trim())
          .filter((relativePath) => relativePath.startsWith('references/'))
          .filter((relativePath) => RUNTIME_SKILL_RESOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()))
          .sort((left, right) => left.localeCompare(right, 'en'))
        : [];
      for (const relativePath of resourceFiles) {
        const resourcePath = path.resolve(installRoot, ...relativePath.split('/'));
        if (!resourcePath.startsWith(`${installRoot}${path.sep}`)) continue;
        let content;
        try {
          content = fs.readFileSync(resourcePath, 'utf8').trim();
        } catch {
          continue;
        }
        if (!content) continue;
        const opening = `<skill-resource path=${JSON.stringify(relativePath)}>\n`;
        const closing = '\n</skill-resource>';
        const separatorChars = resourceBlocks.length ? 2 : 0;
        const remaining = MAX_RUNTIME_SKILL_RESOURCE_CHARS
          - resourceChars
          - separatorChars
          - opening.length
          - closing.length;
        if (remaining <= 0) break;
        const excerpt = content.slice(0, remaining);
        const block = `${opening}${excerpt}${closing}`;
        resourceBlocks.push(block);
        resourceChars += block.length + separatorChars;
      }
      const resources = resourceBlocks.join('\n\n');
      const separator = resources ? '\n\n' : '';
      const skillBudget = Math.max(0, MAX_RUNTIME_SKILL_CHARS - resources.length - separator.length);
      const instruction = fs.readFileSync(skillFile, 'utf8').slice(0, skillBudget).trim();
      return `${instruction}${separator}${resources}`.trim();
    } catch {
      return '';
    }
  }

  function uniqueStrings(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function normalizeExpertId(value, name) {
    const explicit = String(value || '').trim();
    if (explicit) return sanitizePathSegment(explicit);
    const base = sanitizePathSegment(name).toLowerCase();
    return `${base === 'item' ? 'expert' : base}-${crypto.randomUUID().slice(0, 8)}`;
  }

  function normalizeExpertToolSelections(value, connectorIds) {
    const allowed = new Set(connectorIds);
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(
      Object.entries(source)
        .filter(([connectorId, toolNames]) => allowed.has(connectorId) && Array.isArray(toolNames))
        .map(([connectorId, toolNames]) => [connectorId, uniqueStrings(toolNames)])
    );
  }

  function expertPreflight(record) {
    const skills = getRegistry().load().skills;
    const connectors = getRegistry().load().connectors;
    const issues = [];
    for (const skillId of record.requiredSkills || []) {
      const installed = skills.find((item) => item.skillId === skillId || item.id === skillId);
      if (!installed?.enabled) {
        issues.push({ type: 'skill', id: skillId, message: `必需技能未安装或未启用：${skillId}` });
      }
    }
    for (const connectorId of record.requiredConnectors || []) {
      const connector = connectors.find((item) => item.id === connectorId);
      if (!connector?.enabled || !connectorAllowed(connectorId)) {
        issues.push({ type: 'connector', id: connectorId, message: `必需工具未连接或被策略禁用：${connectorId}` });
        continue;
      }
      const selected = record.toolSelections?.[connectorId];
      const available = Array.isArray(connector.lastTest?.result?.tools)
        ? new Set(connector.lastTest.result.tools.map((tool) => String(tool.name || '')).filter(Boolean))
        : null;
      if (available && Array.isArray(selected)) {
        for (const toolName of selected) {
          if (!available.has(toolName)) {
            issues.push({
              type: 'tool',
              id: `${connectorId}/${toolName}`,
              message: `工具服务 ${connector.name || connectorId} 中不存在：${toolName}`,
            });
          }
        }
      }
    }
    return { ready: issues.length === 0, issues };
  }

  function normalizeExpert(input = {}, existing = null) {
    const now = new Date().toISOString();
    const name = String(input.name || existing?.name || '').trim();
    const instruction = String(input.instruction || existing?.instruction || '').trim();
    if (!name) throw new Error('请输入专家名称');
    if (!instruction) throw new Error('请输入专家工作指令');
    const requiredConnectors = uniqueStrings(input.requiredConnectors ?? existing?.requiredConnectors);
    const recommendedConnectors = uniqueStrings(input.recommendedConnectors ?? existing?.recommendedConnectors)
      .filter((id) => !requiredConnectors.includes(id));
    const requiredWorkflows = uniqueStrings(input.requiredWorkflows ?? existing?.requiredWorkflows);
    const recommendedWorkflows = uniqueStrings(input.recommendedWorkflows ?? existing?.recommendedWorkflows)
      .filter((id) => !requiredWorkflows.includes(id));
    const connectorIds = [...requiredConnectors, ...recommendedConnectors];
    const status = EXPERT_STATUSES.has(input.status) ? input.status : existing?.status || 'draft';
    const remote = existing?.remote || null;
    return {
      apiVersion: 'meteomate.ai/v1',
      kind: 'Expert',
      id: normalizeExpertId(input.id || existing?.id, name),
      name,
      version: String(input.version || existing?.version || '0.1.0').trim() || '0.1.0',
      revision: Number(existing?.revision || 0) + 1,
      source: existing?.source || { type: 'user' },
      status,
      visibility: 'private',
      owner: String(input.owner || existing?.owner || '我').trim() || '我',
      category: String(input.category || existing?.category || '自定义专家').trim() || '自定义专家',
      avatar: String(input.avatar || existing?.avatar || name.slice(0, 1)).trim().slice(0, 2) || '专',
      description: String(input.description || existing?.description || '').trim(),
      mission: String(input.mission || existing?.mission || '').trim(),
      tags: uniqueStrings(input.tags ?? existing?.tags),
      instruction,
      methodology: uniqueStrings(input.methodology ?? input.workflow ?? existing?.methodology ?? existing?.workflow),
      workflow: uniqueStrings(input.workflow ?? input.methodology ?? existing?.workflow ?? existing?.methodology),
      limitations: uniqueStrings(input.limitations ?? existing?.limitations),
      inputs: uniqueStrings(input.inputs ?? existing?.inputs),
      outputs: uniqueStrings(input.outputs ?? existing?.outputs),
      prompts: uniqueStrings(input.prompts ?? existing?.prompts),
      requiredSkills: uniqueStrings(input.requiredSkills ?? existing?.requiredSkills),
      recommendedSkills: uniqueStrings(input.recommendedSkills ?? input.optionalSkills ?? existing?.recommendedSkills),
      requiredWorkflows,
      recommendedWorkflows,
      requiredConnectors,
      recommendedConnectors,
      toolSelections: normalizeExpertToolSelections(input.toolSelections ?? existing?.toolSelections, connectorIds),
      permissionProfile: String(input.permissionProfile || existing?.permissionProfile || 'artifact-approval'),
      defaultWorkMode: EXPERT_WORK_MODES.has(input.defaultWorkMode)
        ? input.defaultWorkMode
        : existing?.defaultWorkMode || 'execute',
      modelPolicy: String(input.modelPolicy || existing?.modelPolicy || 'inherit'),
      inputSchema: input.inputSchema ?? existing?.inputSchema ?? null,
      outputSchema: input.outputSchema ?? existing?.outputSchema ?? null,
      remote,
      syncStatus: remote ? 'pending_upload' : existing?.syncStatus || 'local_only',
      syncError: null,
      remoteShadow: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  function remoteExpertRecord(input = {}, context = {}) {
    const requiredConnectors = uniqueStrings(input.requiredConnectors);
    const recommendedConnectors = uniqueStrings(input.recommendedConnectors)
      .filter((id) => !requiredConnectors.includes(id));
    const requiredWorkflows = uniqueStrings(input.requiredWorkflows);
    const recommendedWorkflows = uniqueStrings(input.recommendedWorkflows)
      .filter((id) => !requiredWorkflows.includes(id));
    const connectorIds = [...requiredConnectors, ...recommendedConnectors];
    const source = input.source && typeof input.source === 'object'
      ? input.source
      : { type: input.visibility === 'organization' ? 'organization' : input.visibility === 'public' ? 'system' : 'user' };
    return {
      apiVersion: 'meteomate.ai/v1',
      kind: 'Expert',
      id: String(input.id || '').trim(),
      name: String(input.name || '').trim(),
      version: String(input.version || '0.1.0').trim() || '0.1.0',
      revision: Math.max(1, Number(input.revision || 1)),
      source: {
        type: ['user', 'organization', 'system'].includes(source.type) ? source.type : 'user',
        remoteId: String(source.remoteId || input.id || '').trim(),
      },
      status: EXPERT_STATUSES.has(input.status) ? input.status : 'draft',
      visibility: ['private', 'organization', 'public'].includes(input.visibility) ? input.visibility : 'private',
      owner: String(input.owner || '').trim(),
      ownerId: String(input.ownerId || '').trim(),
      orgId: String(input.orgId || '').trim(),
      category: String(input.category || '自定义专家').trim() || '自定义专家',
      avatar: String(input.avatar || input.name || '专').trim().slice(0, 2) || '专',
      description: String(input.description || '').trim(),
      mission: String(input.mission || '').trim(),
      tags: uniqueStrings(input.tags),
      instruction: String(input.instruction || '').trim(),
      methodology: uniqueStrings(input.methodology),
      workflow: uniqueStrings(input.workflow ?? input.methodology),
      limitations: uniqueStrings(input.limitations),
      inputs: uniqueStrings(input.inputs),
      outputs: uniqueStrings(input.outputs),
      prompts: uniqueStrings(input.prompts),
      requiredSkills: uniqueStrings(input.requiredSkills),
      recommendedSkills: uniqueStrings(input.recommendedSkills),
      requiredWorkflows,
      recommendedWorkflows,
      requiredConnectors,
      recommendedConnectors,
      toolSelections: normalizeExpertToolSelections(input.toolSelections, connectorIds),
      permissionProfile: String(input.permissionProfile || 'artifact-approval'),
      defaultWorkMode: EXPERT_WORK_MODES.has(input.defaultWorkMode) ? input.defaultWorkMode : 'execute',
      modelPolicy: String(input.modelPolicy || 'inherit'),
      review: {
        status: String(input.review?.status || (input.visibility === 'private' ? 'not_required' : 'not_submitted')),
        note: String(input.review?.note || ''),
        submittedAt: input.review?.submittedAt || null,
        reviewedAt: input.review?.reviewedAt || null,
      },
      distribution: {
        mode: String(input.distribution?.mode || 'all'),
        percentage: Math.max(0, Number(input.distribution?.percentage || 0)),
        userIds: uniqueStrings(input.distribution?.userIds),
      },
      inputSchema: input.inputSchema ?? null,
      outputSchema: input.outputSchema ?? null,
      remote: {
        id: String(input.id || '').trim(),
        revision: Math.max(1, Number(input.revision || 1)),
        updatedAt: input.updatedAt || null,
        baseUrl: String(context.baseUrl || '').trim(),
      },
      syncStatus: 'synced',
      syncError: null,
      remoteShadow: null,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString(),
    };
  }

  function acceptRemoteExpert(input = {}, context = {}) {
    const existing = input.id ? getRegistry().getExpert(input.id) : null;
    const remoteRecord = remoteExpertRecord(input, context);
    const record = {
      ...remoteRecord,
      requiredWorkflows: existing?.requiredWorkflows || remoteRecord.requiredWorkflows,
      recommendedWorkflows: existing?.recommendedWorkflows || remoteRecord.recommendedWorkflows,
    };
    if (!record.id || !record.name || !record.instruction) {
      throw new Error('SkillHub 返回的专家记录不完整');
    }
    return {
      expert: getRegistry().upsertExpert(record),
      registry: registrySnapshot(),
    };
  }

  function markExpertSyncError(id, message, conflict = false, remoteShadow = null) {
    const existing = getRegistry().getExpert(id);
    if (!existing) return { expert: null, registry: registrySnapshot() };
    const expert = getRegistry().upsertExpert({
      ...existing,
      syncStatus: conflict ? 'conflict' : 'sync_error',
      syncError: String(message || '专家同步失败'),
      remoteShadow: remoteShadow || existing.remoteShadow || null,
    });
    return { expert, registry: registrySnapshot() };
  }

  function syncRemoteExperts(items = [], context = {}) {
    const currentUserId = String(context.currentUserId || '').trim();
    const baseUrl = String(context.baseUrl || '').trim();
    const remoteItems = Array.isArray(items) ? items : [];
    const remoteIds = new Set();
    const conflicts = [];
    const synced = [];
    for (const item of remoteItems) {
      if (!item?.id) continue;
      remoteIds.add(item.id);
      const existing = getRegistry().getExpert(item.id);
      const remoteRecord = remoteExpertRecord(item, { baseUrl });
      const incoming = {
        ...remoteRecord,
        requiredWorkflows: existing?.requiredWorkflows || remoteRecord.requiredWorkflows,
        recommendedWorkflows: existing?.recommendedWorkflows || remoteRecord.recommendedWorkflows,
      };
      const ownPersonal = incoming.source.type === 'user' && incoming.ownerId === currentUserId;
      const locallyChanged = ownPersonal && existing
        && ['local_only', 'pending_upload', 'conflict'].includes(existing.syncStatus);
      const sourceCollision = existing?.source?.type === 'user' && incoming.source.type !== 'user';
      if (locallyChanged || sourceCollision) {
        const expert = getRegistry().upsertExpert({
          ...existing,
          syncStatus: 'conflict',
          syncError: existing.syncError || (
            sourceCollision
              ? '个人专家 ID 与远程组织或系统专家冲突'
              : '远程版本已变化，请选择保留本地版本或采用远程版本'
          ),
          remoteShadow: incoming,
        });
        conflicts.push(expert);
        continue;
      }
      synced.push(getRegistry().upsertExpert(incoming));
    }
    for (const existing of getRegistry().snapshot().experts) {
      if (!existing.remote || existing.remote.baseUrl !== baseUrl || remoteIds.has(existing.id)) continue;
      if (existing.source?.type === 'user' && existing.ownerId === currentUserId) continue;
      getRegistry().removeExpert(existing.id);
    }
    return { synced, conflicts, registry: registrySnapshot() };
  }

  function saveExpert(input = {}) {
    const existing = input.id ? getRegistry().getExpert(input.id) : null;
    if (existing && existing.source?.type !== 'user') {
      throw new Error('组织或系统专家为只读，请复制后再编辑');
    }
    const record = normalizeExpert(input, existing);
    const preflight = expertPreflight(record);
    if (record.status === 'enabled' && !preflight.ready) {
      throw new Error(preflight.issues.map((issue) => issue.message).join('；'));
    }
    return { expert: getRegistry().upsertExpert(record), preflight, registry: registrySnapshot() };
  }

  function setExpertStatus(id, status) {
    if (!EXPERT_STATUSES.has(status)) throw new Error('不支持的专家状态');
    const existing = getRegistry().getExpert(id);
    if (!existing) throw new Error('专家不存在');
    if (existing.source?.type !== 'user') throw new Error('组织或系统专家的状态由远程管理员维护');
    const record = normalizeExpert({ ...existing, status }, existing);
    const preflight = expertPreflight(record);
    if (status === 'enabled' && !preflight.ready) {
      throw new Error(preflight.issues.map((issue) => issue.message).join('；'));
    }
    return { expert: getRegistry().upsertExpert(record), preflight, registry: registrySnapshot() };
  }

  function migrateExperts(items = []) {
    const migrated = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      const id = normalizeExpertId(item.id, item.name);
      if (getRegistry().getExpert(id)) continue;
      const record = normalizeExpert({ ...item, id, status: 'enabled' });
      migrated.push(getRegistry().upsertExpert(record));
    }
    return { migrated, registry: registrySnapshot() };
  }

  function resolveExpertConflict(id, resolution) {
    const existing = getRegistry().getExpert(id);
    if (!existing || existing.syncStatus !== 'conflict' || !existing.remoteShadow) {
      throw new Error('专家没有待处理的版本冲突');
    }
    if (resolution === 'remote') {
      return acceptRemoteExpert(existing.remoteShadow, {
        baseUrl: existing.remoteShadow.remote?.baseUrl || existing.remote?.baseUrl || '',
      });
    }
    if (resolution !== 'local') throw new Error('不支持的冲突处理方式');
    const remote = existing.remoteShadow.remote || {
      id: existing.remoteShadow.id,
      revision: existing.remoteShadow.revision,
      updatedAt: existing.remoteShadow.updatedAt || null,
      baseUrl: existing.remote?.baseUrl || '',
    };
    const expert = getRegistry().upsertExpert({
      ...existing,
      remote,
      syncStatus: 'pending_upload',
      syncError: null,
      remoteShadow: null,
    });
    return { expert, registry: registrySnapshot() };
  }

  function registrySnapshot() {
    reconcileUserSkillInstallations();
    ensureDemoWeatherConnectors();
    if (secretStore) {
      for (const connector of getRegistry().load().connectors) migrateConnectorSecrets(connector);
    }
    const snapshot = getRegistry().snapshot();
    return {
      ...snapshot,
      skills: snapshot.skills.map((record) => ({
        ...record,
        runtimeInstruction: runtimeSkillInstruction(record),
      })),
      bundledSkills: listBundledSkills(),
      connectors: snapshot.connectors.map((record) => {
        const toolAllowlist = connectorToolCeiling(record);
        return {
          ...redactConnector(record),
          ...(toolAllowlist ? { toolAllowlist } : {}),
          policyBlocked: !connectorAllowed(record.id),
        };
      }),
      experts: snapshot.experts,
      organizationPolicy: profileContext?.policyContext() || null,
      encryptionAvailable: Boolean(secretStore?.state?.().encryptionAvailable),
      secretStorage: secretStore?.state?.() || { encryptionAvailable: false, backend: 'volatile-test-only' },
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

  function skillInstallationRecord({
    prepared,
    scope,
    projectId = null,
    workspace = null,
    installPath,
    enabled = true,
    sourceType = null,
    managedByPolicy = false,
    managedPolicyRevision = 0,
    installedAt = Date.now(),
  }) {
    const sourcePath = prepared.sourcePath;
    const now = Date.now();
    return {
      apiVersion: 'meteomate.ai/v1',
      kind: 'SkillInstallation',
      id: installationId(prepared.report, scope, projectId),
      skillId: prepared.report.skill.id,
      name: prepared.report.skill.displayName,
      description: prepared.report.skill.description,
      version: prepared.report.skill.version,
      scope,
      projectId: scope === 'project' ? projectId : null,
      workspace: scope === 'project' ? workspace : null,
      installPath,
      enabled: Boolean(enabled),
      source: {
        type: sourceType
          || (sourcePath.startsWith(paths().bundled)
            ? 'bundled'
            : path.extname(sourcePath).toLowerCase() === '.zip' ? 'zip' : 'directory'),
        path: sourcePath,
      },
      integrity: prepared.report.integrity,
      reportHash: prepared.report.reportHash,
      risk: prepared.report.risk,
      warnings: prepared.report.warnings,
      files: prepared.report.files,
      sidecar: prepared.report.sidecar?.data || null,
      projectIds: scope === 'project' && projectId ? [projectId] : [],
      managedByPolicy: Boolean(managedByPolicy),
      managedPolicyRevision: managedByPolicy ? Number(managedPolicyRevision || 0) : null,
      installedAt,
      updatedAt: now,
    };
  }

  function reconcileUserSkillInstallations() {
    const registered = new Set(
      getRegistry().load().skills
        .filter((item) => item.scope === 'user')
        .map((item) => item.skillId),
    );
    const roots = [
      { base: installBase({ scope: 'user' }), enabled: true },
      { base: disabledBase({ scope: 'user' }), enabled: false },
    ];
    for (const { base, enabled } of roots) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || registered.has(entry.name)) continue;
        const installPath = path.join(base, entry.name);
        try {
          const prepared = SkillPackage.prepareSource(installPath, paths().temp);
          if (path.resolve(prepared.root) !== path.resolve(installPath)) continue;
          if (prepared.report.skill.id !== entry.name || registered.has(prepared.report.skill.id)) continue;
          const stat = fs.statSync(installPath);
          getRegistry().upsertSkill(skillInstallationRecord({
            prepared,
            scope: 'user',
            installPath,
            enabled,
            sourceType: 'recovered',
            installedAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
          }));
          registered.add(prepared.report.skill.id);
        } catch {
          // Invalid or incomplete directories remain untouched and are not exposed as skills.
        }
      }
    }
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
    const record = skillInstallationRecord({
      prepared,
      scope,
      projectId: request.projectId || null,
      workspace,
      installPath: target,
      managedByPolicy: request.managedByPolicy,
      managedPolicyRevision: request.managedPolicyRevision,
    });
    const persisted = getRegistry().upsertSkill(record);
    if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
    pendingInspections.delete(request.token);
    return { installation: persisted, registry: registrySnapshot() };
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

  function updateSkillHubState(id, remote = {}) {
    const record = getRegistry().getSkill(id);
    if (!record) throw new Error('Skill 安装记录不存在');
    record.remote = {
      ...(record.remote || {}),
      ...remote,
      syncedAt: new Date().toISOString(),
    };
    record.updatedAt = Date.now();
    const installation = getRegistry().upsertSkill(record);
    return { installation, registry: registrySnapshot() };
  }

  function saveConnector(input) {
    if (!connectorAllowed(input.id)) throw new Error('管理员策略不允许使用该工具');
    const existing = input.id ? getRegistry().getConnector(input.id) : null;
    const preparedInput = materializeConnectorInput({ ...existing, ...input });
    const effectiveLastTest = Object.prototype.hasOwnProperty.call(input, 'lastTest')
      ? input.lastTest
      : existing?.lastTest;
    const managedDesktopConnector = BrowserConnector.isBrowserConnector(preparedInput)
      || ComputerConnector.isComputerConnector(preparedInput)
      || OfficeConnector.isOfficeConnector(preparedInput)
      || WeatherConnector.isWeatherConnector(preparedInput);
    if (managedDesktopConnector && preparedInput.enabled !== false && effectiveLastTest?.ok !== true) {
      const name = ComputerConnector.isComputerConnector(preparedInput)
        ? '桌面应用操作'
        : OfficeConnector.isOfficeConnector(preparedInput)
          ? 'Office 成果物'
          : WeatherConnector.isWeatherConnector(preparedInput)
            ? preparedInput.name
          : '浏览器操作';
      throw new Error(`启用${name}前，请先完成连接测试`);
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
    record.secrets = encodeSecrets(mergedSecrets, record.id);
    getRegistry().upsertConnector(record);
    if (ComputerConnector.isComputerConnector(record) && record.enabled === false) {
      void computerRuntimeManager.stop();
    }
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  async function testConnector(input) {
    if (!connectorAllowed(input?.id)) throw new Error('管理员策略不允许使用该工具');
    if (ComputerConnector.isComputerConnector(input)) {
      await computerRuntimeManager.start({ requestPermissions: true });
    }
    let record;
    let secrets;
    if (input?.id && !input.transport && getRegistry().getConnector(input.id)) {
      record = materializeConnectorInput(getRegistry().getConnector(input.id));
      secrets = decodeSecrets(record.secrets);
    } else {
      const materialized = materializeConnectorInput(input || {});
      const normalized = ConnectorClient.normalizeConnector(materialized);
      record = normalized.record;
      record.runtimeEnv = materialized.runtimeEnv;
      record.runtimeInfo = materialized.runtimeInfo;
      secrets = normalized.secrets;
    }
    const startedAt = Date.now();
    try {
      const result = await ConnectorClient.testConnector(record, secrets);
      if (record.runtimeInfo) result.runtime = { ...record.runtimeInfo };
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
    if (enabled && ComputerConnector.isComputerConnector(record) && record.lastTest?.ok !== true) {
      throw new Error('启用桌面应用操作前，请先完成连接测试');
    }
    if (enabled && OfficeConnector.isOfficeConnector(record) && record.lastTest?.ok !== true) {
      throw new Error('启用 Office 成果物前，请先完成连接测试');
    }
    if (enabled && WeatherConnector.isWeatherConnector(record) && record.lastTest?.ok !== true) {
      throw new Error(`启用${record.name}前，请先完成连接测试`);
    }
    record.enabled = Boolean(enabled);
    record.updatedAt = Date.now();
    getRegistry().upsertConnector(record);
    if (!record.enabled && ComputerConnector.isComputerConnector(record)) {
      void computerRuntimeManager.stop();
    }
    return { connector: redactConnector(record), registry: registrySnapshot() };
  }

  function deleteConnector(id) {
    const record = getRegistry().getConnector(id);
    const removed = getRegistry().removeConnector(id);
    if (removed && record) removeConnectorSecrets(record);
    if (removed && ComputerConnector.isComputerConnector(record)) {
      void computerRuntimeManager.stop();
    }
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
    const toolSelections = request.toolSelections && typeof request.toolSelections === 'object'
      ? request.toolSelections
      : {};
    const result = [];
    for (const connector of getRegistry().load().connectors) {
      if (!connector.enabled) continue;
      if (!connectorAllowed(connector.id)) continue;
      if (!connectorSelectedForRequest(connector, request)) continue;
      const runtimeConnector = materializeConnectorInput(connector, request);
      const toolCeiling = connectorToolCeiling(runtimeConnector);
      const hasToolSelection = Object.prototype.hasOwnProperty.call(toolSelections, connector.id);
      const requestedValues = Array.isArray(toolSelections[connector.id]) ? toolSelections[connector.id] : [];
      const requestedTools = hasToolSelection
        ? [...new Set((OfficeConnector.isOfficeConnector(connector)
          ? OfficeConnector.upgradeToolSelection(requestedValues)
          : requestedValues).map(String).filter(Boolean))]
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

  function extensionSecretsForRequest(request = {}) {
    const entries = selectedConnectorConfigs(request, ConnectorClient.extensionSecretValues);
    const merged = {};
    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry)) {
        if (Object.prototype.hasOwnProperty.call(merged, key) && merged[key] !== value) {
          throw new Error(`工具服务密钥变量冲突：${key}`);
        }
        merged[key] = value;
      }
    }
    return merged;
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
          ? [...new Set((OfficeConnector.isOfficeConnector(connector)
            ? OfficeConnector.upgradeToolSelection(toolSelections[connector.id] || [])
            : toolSelections[connector.id] || []).map(String).filter(Boolean))]
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
                annotations: tool.annotations && typeof tool.annotations === 'object'
                  ? { ...tool.annotations }
                  : {},
                effects: tool.effects && typeof tool.effects === 'object'
                  ? { ...tool.effects }
                  : {},
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
    const bundled = listBundledSkills().find((item) => item.id === skillId && !item.broken);
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
      if (bundled && compareSkillVersions(bundled.version, existing.version) > 0) {
        const inspection = inspectBundledSkill(skillId);
        return {
          ...installSkill({
            token: inspection.token,
            reportHash: inspection.report.reportHash,
            scope: 'user',
            replace: true,
            managedByPolicy: true,
            managedPolicyRevision: revision,
          }),
          installed: true,
          upgraded: true,
        };
      }
      return { installation: existing, registry: registrySnapshot(), installed: false };
    }
    if (!bundled) return null;
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
    ipcMain.handle('capability:save-expert', async (_event, request) => saveExpert(request || {}));
    ipcMain.handle('capability:set-expert-status', async (_event, request) => setExpertStatus(request?.id, request?.status));
    ipcMain.handle('capability:migrate-experts', async (_event, items) => migrateExperts(items));
    ipcMain.handle('capability:resolve-expert-conflict', async (_event, request) => (
      resolveExpertConflict(request?.id, request?.resolution)
    ));
    ipcMain.handle('capability:open-path', async (_event, targetPath) => {
      if (!targetPath || typeof targetPath !== 'string') return false;
      const error = await shell.openPath(targetPath);
      return error === '';
    });
  }

  profileContext?.onChange(() => {
    void computerRuntimeManager.stop();
    registry = null;
    for (const prepared of pendingInspections.values()) {
      if (prepared.tempDir) fs.rmSync(prepared.tempDir, { recursive: true, force: true });
    }
    pendingInspections.clear();
  });

  return {
    registerIpc,
    registrySnapshot,
    prepareForRequest,
    extensionsForRequest,
    extensionSecretsForRequest,
    sessionExtensionsForRequest,
    permissionContextForRequest,
    inspectSkill,
    installSkill,
    setSkillEnabled,
    uninstallSkill,
    updateSkillHubState,
    saveExpert,
    setExpertStatus,
    migrateExperts,
    resolveExpertConflict,
    acceptRemoteExpert,
    markExpertSyncError,
    syncRemoteExperts,
    saveConnector,
    testConnector,
    syncManagedSkills,
    installBundledDefault,
    shutdown: () => computerRuntimeManager.stop(),
    paths,
  };
}

module.exports = { createCapabilityService };
