'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8088';
const PROFILE_VERSION = 2;
const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({
  sendOnEnter: true,
  showExecutionProcess: true,
  showContextMeter: true,
  autoCompactThreshold:
    normalizeManagedAutoCompactThreshold(
      process.env.METEOMATE_AUTO_COMPACT_THRESHOLD || process.env.GOOSE_AUTO_COMPACT_THRESHOLD
    ) ?? 0.75,
  defaultPermissionProfileId: '',
});

function unrestrictedPolicy(user = {}) {
  return {
    userId: user.id || '',
    role: user.role || '',
    orgId: user.orgId || '',
    defaultSpaceId: user.defaultSpaceId || (user.id ? `personal:${user.id}` : ''),
    profileBindingId: user.id ? `user:${user.id}` : '',
    policy: {
      defaultModel: '',
      allowedModels: [],
      defaultSkillIds: [],
      allowedConnectorIds: [],
      defaultPermissionProfileId: '',
      allowedPermissionProfileIds: [],
      autoCompactThreshold: null,
      sources: {},
      revision: 0,
      updatedAt: null,
    },
  };
}

function normalizePolicyContext(value, user = {}) {
  const fallback = unrestrictedPolicy(user);
  const input = value && typeof value === 'object' ? value : {};
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
  return {
    userId: String(input.userId || fallback.userId),
    role: String(input.role || fallback.role),
    orgId: String(input.orgId || fallback.orgId),
    defaultSpaceId: String(input.defaultSpaceId || fallback.defaultSpaceId),
    profileBindingId: String(input.profileBindingId || fallback.profileBindingId),
    policy: {
      defaultModel: String(policy.defaultModel || ''),
      allowedModels: Array.isArray(policy.allowedModels) ? policy.allowedModels.map(String) : [],
      defaultSkillIds: Array.isArray(policy.defaultSkillIds) ? policy.defaultSkillIds.map(String) : [],
      allowedConnectorIds: Array.isArray(policy.allowedConnectorIds) ? policy.allowedConnectorIds.map(String) : [],
      defaultPermissionProfileId: String(policy.defaultPermissionProfileId || ''),
      allowedPermissionProfileIds: Array.isArray(policy.allowedPermissionProfileIds) ? policy.allowedPermissionProfileIds.map(String) : [],
      autoCompactThreshold: normalizeManagedAutoCompactThreshold(policy.autoCompactThreshold),
      sources: policy.sources && typeof policy.sources === 'object' ? policy.sources : {},
      revision: Number(policy.revision || 0),
      updatedAt: policy.updatedAt || null,
    },
  };
}

function normalizeManagedAutoCompactThreshold(value) {
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0.5 && threshold <= 0.95 ? threshold : null;
}

function normalizeDesktopPreferences(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    sendOnEnter: input.sendOnEnter !== false,
    showExecutionProcess: input.showExecutionProcess !== false,
    showContextMeter: input.showContextMeter !== false,
    autoCompactThreshold:
      normalizeManagedAutoCompactThreshold(input.autoCompactThreshold)
      ?? DEFAULT_DESKTOP_PREFERENCES.autoCompactThreshold,
    defaultPermissionProfileId: String(
      input.defaultPermissionProfileId ?? DEFAULT_DESKTOP_PREFERENCES.defaultPermissionProfileId
    ),
  };
}

function modelRef(providerId, modelId) {
  return providerId && modelId ? `${providerId}/${modelId}` : '';
}

function parseModelRef(value) {
  const text = String(value || '').trim();
  const separator = text.indexOf('/');
  if (separator <= 0 || separator === text.length - 1) return null;
  return { providerId: text.slice(0, separator), modelId: text.slice(separator + 1) };
}

function normalizeBaseURL(value) {
  const text = String(value || DEFAULT_BASE_URL).trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('服务地址无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('服务地址只支持 HTTP 或 HTTPS');
  if (parsed.username || parsed.password) throw new Error('服务地址不能包含用户名或密码');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function safeReadJSON(target, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
}

function profileKey(baseUrl, userId) {
  const digest = crypto.createHash('sha256').update(`${baseUrl}\n${userId}`).digest('hex');
  return `p-${digest.slice(0, 24)}`;
}

function createProfileContext({
  app,
  ipcMain,
  allowOffline = process.env.METEOMATE_ALLOW_OFFLINE_LOGIN === '1',
}) {
  let active = null;
  const listeners = new Set();

  function globalPaths() {
    const userData = app.getPath('userData');
    return {
      userData,
      authRoot: path.join(userData, 'auth'),
      config: path.join(userData, 'auth', 'profile-context.json'),
      profiles: path.join(userData, 'profiles'),
      legacyCapabilities: path.join(userData, 'capabilities'),
      migrations: path.join(userData, 'migrations'),
    };
  }

  function loadConfig() {
    const config = safeReadJSON(globalPaths().config, {});
    return {
      apiVersion: 'meteomate.ai/v1',
      kind: 'DesktopProfileConfig',
      version: PROFILE_VERSION,
      baseUrl: normalizeBaseURL(config.baseUrl || process.env.METEOMATE_SKILLHUB_URL || DEFAULT_BASE_URL),
      lastProfileKey: String(config.lastProfileKey || ''),
    };
  }

  function saveConfig(input = {}) {
    const current = loadConfig();
    const next = {
      ...current,
      ...input,
      baseUrl: normalizeBaseURL(input.baseUrl || current.baseUrl),
      version: PROFILE_VERSION,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(globalPaths().config, next);
    return next;
  }

  function pathsFor(key) {
    const global = globalPaths();
    const root = path.join(global.profiles, key);
    return {
      ...global,
      key,
      root,
      metadata: path.join(root, 'profile.json'),
      preferences: path.join(root, 'preferences.json'),
      capabilities: path.join(root, 'capabilities'),
      assistantWorkspace: path.join(app.getPath('documents'), 'MeteoMate', 'Claw', key),
    };
  }

  function currentPaths() {
    if (!active?.profileKey) throw new Error('请先登录 MeteoMate');
    return pathsFor(active.profileKey);
  }

  function cachedProfile(key) {
    if (!key) return null;
    const metadata = safeReadJSON(pathsFor(key).metadata, null);
    if (!metadata?.user?.id || !metadata?.baseUrl) return null;
    return {
      profileKey: key,
      baseUrl: normalizeBaseURL(metadata.baseUrl),
      user: metadata.user,
      policyContext: normalizePolicyContext(metadata.policyContext, metadata.user),
      lastLoginAt: metadata.lastLoginAt || null,
    };
  }

  function cachedState() {
    const config = loadConfig();
    return cachedProfile(config.lastProfileKey);
  }

  function legacyDataAvailable() {
    const legacy = globalPaths().legacyCapabilities;
    if (!fs.existsSync(legacy)) return false;
    try {
      return fs.readdirSync(legacy).length > 0;
    } catch {
      return false;
    }
  }

  function publicState() {
    const cached = cachedState();
    if (!active) {
      const config = loadConfig();
      return {
        status: 'signed_out',
        baseUrl: config.baseUrl,
        profileKey: null,
        user: null,
        expiresAt: null,
        offlineAvailable: allowOffline && Boolean(cached),
        cachedUser: cached?.user || null,
        legacyDataAvailable: legacyDataAvailable(),
        policyContext: null,
      };
    }
    return {
      status: active.status,
      baseUrl: active.baseUrl,
      profileKey: active.profileKey,
      user: active.user,
      expiresAt: active.expiresAt || null,
      offlineAvailable: allowOffline && !active.user?.mustChangePassword && Boolean(cached),
      cachedUser: active.user,
      legacyDataAvailable: legacyDataAvailable(),
      policyContext: active.policyContext,
    };
  }

  function notify() {
    const snapshot = publicState();
    for (const listener of listeners) listener(snapshot);
  }

  function activate({ baseUrl, user, token = '', expiresAt = null, status, policyContext = null }) {
    const key = profileKey(baseUrl, user.id);
    const target = pathsFor(key);
    const normalizedPolicy = normalizePolicyContext(policyContext, user);
    fs.mkdirSync(target.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(target.assistantWorkspace, { recursive: true, mode: 0o700 });
    const cacheAllowed = status === 'offline' || !user.mustChangePassword;
    if (cacheAllowed) {
      const metadata = {
        apiVersion: 'meteomate.ai/v1',
        kind: 'DesktopUserProfile',
        version: PROFILE_VERSION,
        profileKey: key,
        baseUrl,
        user,
        defaultSpaceId: normalizedPolicy.defaultSpaceId || user.defaultSpaceId || `personal:${user.id}`,
        policyContext: normalizedPolicy,
        lastLoginAt: status === 'authenticated' ? new Date().toISOString() : cachedProfile(key)?.lastLoginAt || null,
        updatedAt: new Date().toISOString(),
      };
      atomicWrite(target.metadata, metadata);
      saveConfig({ baseUrl, lastProfileKey: key });
    } else {
      saveConfig({ baseUrl, lastProfileKey: '' });
    }
    active = { profileKey: key, baseUrl, user, token, expiresAt, status, policyContext: normalizedPolicy };
    notify();
    return publicState();
  }

  async function login(input = {}) {
    const baseUrl = normalizeBaseURL(input.baseUrl || loadConfig().baseUrl);
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    if (!username || !password) throw new Error('请输入用户名和密码');
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, clientId: `meteomate-desktop-${process.platform}` }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new Error(`无法连接 MeteoMate 内网服务：${error.message}`);
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`内网服务返回了无效响应（${response.status}）`);
    }
    if (!response.ok) throw new Error(payload?.error?.message || `登录失败（${response.status}）`);
    if (!payload?.sessionToken || !payload?.user?.id) throw new Error('登录响应缺少用户或会话信息');
    let policyContext = null;
    try {
      const policyResponse = await fetch(`${baseUrl}/v1/me/policy`, {
        headers: { Authorization: `Bearer ${payload.sessionToken}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (policyResponse.ok) policyContext = await policyResponse.json();
      else if (policyResponse.status !== 404) throw new Error(`策略读取失败（${policyResponse.status}）`);
    } catch (error) {
      try {
        await fetch(`${baseUrl}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${payload.sessionToken}` }, signal: AbortSignal.timeout(3_000) });
      } catch {}
      throw new Error(`无法读取当前用户的组织策略：${error.message}`);
    }
    return activate({
      baseUrl,
      user: payload.user,
      token: payload.sessionToken,
      expiresAt: payload.expiresAt || null,
      status: 'authenticated',
      policyContext,
    });
  }

  function openOffline() {
    if (!allowOffline) throw new Error('离线登录未启用，请联系管理员');
    const cached = cachedState();
    if (!cached) throw new Error('这台电脑上还没有可离线使用的用户资料');
    return activate({ baseUrl: cached.baseUrl, user: cached.user, status: 'offline', policyContext: cached.policyContext });
  }

  async function logout() {
    const session = active;
    if (session?.status === 'authenticated' && session.token) {
      try {
        await fetch(`${session.baseUrl}/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {}
    }
    active = null;
    notify();
    return publicState();
  }

  async function changePassword(input = {}) {
    if (active?.status !== 'authenticated' || !active.token) throw new Error('请先登录再修改密码');
    const currentPassword = String(input.currentPassword || '');
    const newPassword = String(input.newPassword || '');
    if (!currentPassword || !newPassword) throw new Error('请输入当前密码和新密码');
    let response;
    try {
      response = await fetch(`${active.baseUrl}/v1/me/password`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new Error(`无法连接 MeteoMate 内网服务：${error.message}`);
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`内网服务返回了无效响应（${response.status}）`);
    }
    if (!response.ok) throw new Error(payload?.error?.message || `密码修改失败（${response.status}）`);
    saveConfig({ baseUrl: active.baseUrl, lastProfileKey: '' });
    active = null;
    notify();
    return publicState();
  }

  function migrateManagedSkills(registryPath, assistantWorkspace) {
    const registry = safeReadJSON(registryPath, null);
    if (!registry || !Array.isArray(registry.skills)) return;
    let changed = false;
    for (const record of registry.skills) {
      if (record.scope !== 'user' || !record.skillId || !record.installPath || !fs.existsSync(record.installPath)) continue;
      const folder = record.enabled === false ? 'disabled-skills' : 'skills';
      const target = path.join(assistantWorkspace, '.agents', folder, record.skillId);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.cpSync(record.installPath, target, { recursive: true, errorOnExist: true, preserveTimestamps: true });
      }
      record.installPath = target;
      record.updatedAt = Date.now();
      changed = true;
    }
    if (changed) atomicWrite(registryPath, registry);
  }

  function claimLegacyData() {
    if (!active) throw new Error('请先登录再迁移本机数据');
    const source = globalPaths().legacyCapabilities;
    if (!legacyDataAvailable()) return { migrated: false };
    const target = currentPaths();
    if (fs.existsSync(target.capabilities) && fs.readdirSync(target.capabilities).length > 0) {
      throw new Error('当前用户已经有能力中心数据，不能覆盖');
    }
    fs.mkdirSync(target.migrations, { recursive: true, mode: 0o700 });
    const backup = path.join(target.migrations, `legacy-capabilities-${Date.now()}`);
    fs.renameSync(source, backup);
    fs.cpSync(backup, target.capabilities, { recursive: true, errorOnExist: true, preserveTimestamps: true });
    migrateManagedSkills(path.join(target.capabilities, 'registry.json'), target.assistantWorkspace);
    notify();
    return { migrated: true, backupPath: backup };
  }

  function authHeaders(extra = {}) {
    return {
      ...extra,
      ...(active?.status === 'authenticated' && active.token ? { Authorization: `Bearer ${active.token}` } : {}),
    };
  }

  function currentPolicyContext() {
    return active?.policyContext || unrestrictedPolicy(active?.user || {});
  }

  function loadPreferences() {
    if (!active?.profileKey) return {};
    return safeReadJSON(currentPaths().preferences, {}) || {};
  }

  function desktopPreferences() {
    return normalizeDesktopPreferences(loadPreferences().desktop);
  }

  function saveDesktopPreferences(input = {}) {
    if (!active?.profileKey) throw new Error('请先登录再保存设置');
    const previous = desktopPreferences();
    const preferences = loadPreferences();
    preferences.apiVersion = 'meteomate.ai/v1';
    preferences.kind = 'DesktopUserPreferences';
    preferences.version = 1;
    preferences.desktop = normalizeDesktopPreferences({ ...previous, ...input });
    preferences.updatedAt = new Date().toISOString();
    atomicWrite(currentPaths().preferences, preferences);
    return preferences.desktop;
  }

  function saveModelPreference(input = {}) {
    if (!active?.profileKey) throw new Error('请先登录再保存模型设置');
    const providerId = String(input.providerId || '').trim();
    const modelId = String(input.modelId || '').trim();
    if (!providerId) throw new Error('请选择可用的 Provider');
    const policy = currentPolicyContext().policy;
    const selected = modelRef(providerId, modelId);
    if (policy.allowedModels.length && (!selected || !policy.allowedModels.includes(selected))) {
      throw new Error('所选模型不在管理员允许范围内');
    }
    const preferences = loadPreferences();
    preferences.apiVersion = 'meteomate.ai/v1';
    preferences.kind = 'DesktopUserPreferences';
    preferences.version = 1;
    preferences.model = { providerId, modelId };
    preferences.updatedAt = new Date().toISOString();
    atomicWrite(currentPaths().preferences, preferences);
    return preferences.model;
  }

  function saveCustomModelMetadata(providerId, model = {}, originalModelId = '') {
    if (!active?.profileKey) throw new Error('请先登录再保存模型设置');
    const provider = String(providerId || '').trim();
    const modelId = String(model.id || '').trim();
    const originalId = String(originalModelId || '').trim();
    if (!provider || !modelId) throw new Error('模型配置缺少提供商或模型 ID');
    const preferences = loadPreferences();
    const customModels = preferences.customModels && typeof preferences.customModels === 'object'
      ? { ...preferences.customModels }
      : {};
    if (originalId && originalId !== modelId) delete customModels[modelRef(provider, originalId)];
    customModels[modelRef(provider, modelId)] = {
      name: String(model.name || '').trim(),
      toolCall: Boolean(model.toolCall),
      imageInput: Boolean(model.imageInput),
      reasoning: Boolean(model.reasoning),
      contextLimit: Number(model.contextLimit || 0) || null,
      maxOutputTokens: Number(model.maxOutputTokens || 0) || null,
    };
    if (originalId && preferences.model?.providerId === provider && preferences.model.modelId === originalId) {
      preferences.model.modelId = modelId;
    }
    preferences.apiVersion = 'meteomate.ai/v1';
    preferences.kind = 'DesktopUserPreferences';
    preferences.version = 1;
    preferences.customModels = customModels;
    preferences.updatedAt = new Date().toISOString();
    atomicWrite(currentPaths().preferences, preferences);
    return customModels[modelRef(provider, modelId)];
  }

  function deleteCustomModelMetadata(providerId, modelId) {
    if (!active?.profileKey) return;
    const provider = String(providerId || '').trim();
    const model = String(modelId || '').trim();
    const preferences = loadPreferences();
    if (!preferences.customModels || typeof preferences.customModels !== 'object') return;
    delete preferences.customModels[modelRef(provider, model)];
    if (preferences.model?.providerId === provider && preferences.model.modelId === model) {
      preferences.model = { providerId: '', modelId: '' };
    }
    preferences.updatedAt = new Date().toISOString();
    atomicWrite(currentPaths().preferences, preferences);
  }

  function deleteCustomProviderMetadata(providerId) {
    if (!active?.profileKey) return;
    const provider = String(providerId || '').trim();
    const preferences = loadPreferences();
    if (preferences.customModels && typeof preferences.customModels === 'object') {
      preferences.customModels = Object.fromEntries(
        Object.entries(preferences.customModels).filter(([key]) => !key.startsWith(`${provider}/`))
      );
    }
    if (preferences.model?.providerId === provider) preferences.model = { providerId: '', modelId: '' };
    preferences.updatedAt = new Date().toISOString();
    atomicWrite(currentPaths().preferences, preferences);
  }

  function filterModelSettings(settings = {}) {
    const policy = currentPolicyContext().policy;
    const allowed = new Set(policy.allowedModels || []);
    const customModels = loadPreferences().customModels || {};
    const providers = (settings.providers || [])
      .map((provider) => ({
        ...provider,
        models: (provider.models || [])
          .filter((model) => !allowed.size || allowed.has(modelRef(provider.id, model.id)))
          .map((model) => {
            const metadata = customModels[modelRef(provider.id, model.id)] || {};
            return {
              ...model,
              ...metadata,
              name: metadata.name || model.name || model.id,
            };
          }),
      }))
      .filter((provider) => !allowed.size || provider.models.length > 0);
    const available = new Set();
    for (const provider of providers) {
      for (const model of provider.models || []) available.add(modelRef(provider.id, model.id));
    }
    const preference = loadPreferences().model || {};
    const candidates = [
      modelRef(preference.providerId, preference.modelId),
      policy.defaultModel,
      modelRef(settings.providerId, settings.modelId),
    ].filter(Boolean);
    let selected = candidates.find((candidate) => available.has(candidate)) || '';
    if (!selected) {
      const firstProvider = providers[0];
      selected = firstProvider?.models?.[0] ? modelRef(firstProvider.id, firstProvider.models[0].id) : '';
    }
    const parsed = parseModelRef(selected);
    return {
      ...settings,
      providerId: parsed?.providerId || providers[0]?.id || '',
      modelId: parsed?.modelId || '',
      providers,
      organizationPolicy: {
        revision: policy.revision || 0,
        defaultModel: policy.defaultModel || '',
        allowedModels: [...(policy.allowedModels || [])],
        managedDefault: Boolean(policy.defaultModel),
        restricted: allowed.size > 0,
        autoCompactThreshold: policy.autoCompactThreshold,
      },
    };
  }

  function enforceRuntimePolicy(request = {}) {
    const policy = currentPolicyContext().policy;
    const next = { ...request };
    if (!next.providerId && !next.modelId && policy.defaultModel) {
      const selected = parseModelRef(policy.defaultModel);
      if (selected) {
        next.providerId = selected.providerId;
        next.modelId = selected.modelId;
      }
    }
    if (policy.allowedModels.length && next.providerId && next.modelId && !policy.allowedModels.includes(modelRef(next.providerId, next.modelId))) {
      throw new Error('当前模型不在管理员允许范围内，请重新选择');
    }
    const permissionProfileID = String(
      next.permissionProfileId
      || policy.defaultPermissionProfileId
      || desktopPreferences().defaultPermissionProfileId
      || 'analysis-readonly'
    );
    if (policy.allowedPermissionProfileIds.length && !policy.allowedPermissionProfileIds.includes(permissionProfileID)) {
      throw new Error('当前权限不在管理员允许范围内，请重新选择');
    }
    next.permissionProfileId = permissionProfileID;
    next.allowFileTools = Boolean(next.allowFileTools);
    const blockedConnectors = (next.connectorIds || []).filter((id) => !connectorAllowed(id));
    if (blockedConnectors.length) throw new Error(`管理员已限制以下工具：${blockedConnectors.join('、')}`);
    return next;
  }

  function connectorAllowed(id) {
    const allowed = currentPolicyContext().policy.allowedConnectorIds || [];
    return allowed.length === 0 || allowed.includes(String(id));
  }

  function registerIpc() {
    ipcMain.handle('auth:state', async () => publicState());
    ipcMain.handle('auth:login', async (_event, request) => login(request || {}));
    ipcMain.handle('auth:offline', async () => openOffline());
    ipcMain.handle('auth:logout', async () => logout());
    ipcMain.handle('auth:change-password', async (_event, request) => changePassword(request || {}));
    ipcMain.handle('auth:claim-legacy', async () => claimLegacyData());
    ipcMain.handle('auth:preferences', async () => desktopPreferences());
    ipcMain.handle('auth:preferences-save', async (_event, request) => saveDesktopPreferences(request || {}));
  }

  return {
    registerIpc,
    publicState,
    login,
    logout,
    changePassword,
    openOffline,
    claimLegacyData,
    currentPaths,
    authHeaders,
    policyContext: currentPolicyContext,
    filterModelSettings,
    desktopPreferences,
    saveDesktopPreferences,
    saveModelPreference,
    saveCustomModelMetadata,
    deleteCustomModelMetadata,
    deleteCustomProviderMetadata,
    enforceRuntimePolicy,
    connectorAllowed,
    defaultSkillIds: () => [...(currentPolicyContext().policy.defaultSkillIds || [])],
    baseUrl: () => active?.baseUrl || loadConfig().baseUrl,
    isAuthenticated: () => active?.status === 'authenticated',
    hasActiveProfile: () => Boolean(active?.profileKey),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  createProfileContext,
  normalizeBaseURL,
  profileKey,
  normalizePolicyContext,
  normalizeDesktopPreferences,
  modelRef,
  parseModelRef,
};
