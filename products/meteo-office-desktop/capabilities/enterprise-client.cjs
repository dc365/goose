'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8088';
const MAX_JSON_BYTES = 4 * 1024 * 1024;

function normalizeBaseURL(value) {
  const parsed = new URL(String(value || DEFAULT_BASE_URL).trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('企业服务只支持 HTTP 或 HTTPS');
  if (parsed.username || parsed.password) throw new Error('企业服务 URL 不能包含用户名或密码');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function createEnterpriseClient({ app, ipcMain, safeStorage, skillHubClient }) {
  let cache = null;
  let volatileToken = String(process.env.METEOMATE_CONTROL_PLANE_TOKEN || '');

  function filePath() {
    const directory = path.join(app.getPath('userData'), 'enterprise');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return path.join(directory, 'session.json');
  }

  function encrypt(value) {
    const text = String(value || '');
    if (!text) return null;
    if (safeStorage?.isEncryptionAvailable?.()) {
      volatileToken = '';
      return { scheme: 'electron-safe-storage', data: safeStorage.encryptString(text).toString('base64') };
    }
    volatileToken = text;
    return { scheme: 'memory-only', data: '' };
  }

  function decrypt(record) {
    if (record?.scheme === 'memory-only') return volatileToken;
    if (!record?.data) return '';
    try {
      const bytes = Buffer.from(record.data, 'base64');
      return record.scheme === 'electron-safe-storage' && safeStorage?.isEncryptionAvailable?.()
        ? safeStorage.decryptString(bytes)
        : bytes.toString('utf8');
    } catch {
      return '';
    }
  }

  function load() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
      cache = {
        baseUrl: normalizeBaseURL(parsed.baseUrl || process.env.METEOMATE_CONTROL_PLANE_URL || DEFAULT_BASE_URL),
        token: parsed.token || null,
        session: parsed.session || null,
      };
    } catch {
      cache = {
        baseUrl: normalizeBaseURL(process.env.METEOMATE_CONTROL_PLANE_URL || process.env.METEOMATE_SKILLHUB_URL || DEFAULT_BASE_URL),
        token: encrypt(process.env.METEOMATE_CONTROL_PLANE_TOKEN || ''),
        session: null,
      };
    }
    return cache;
  }

  function save(next) {
    const target = filePath();
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
    cache = next;
    return publicState();
  }

  function publicState() {
    const current = load();
    return {
      baseUrl: current.baseUrl,
      authenticated: Boolean(decrypt(current.token) && current.session?.authenticated),
      tokenConfigured: Boolean(decrypt(current.token)),
      tokenStorage: current.token?.scheme || 'none',
      encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()),
      session: current.session || { authenticated: false },
    };
  }

  async function request(relative, options = {}) {
    const current = load();
    const target = `${current.baseUrl}${relative.startsWith('/') ? relative : `/${relative}`}`;
    const token = decrypt(current.token);
    const response = await fetch(target, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs || 20_000),
    });
    return { response, target };
  }

  async function jsonRequest(relative, options = {}) {
    const { response, target } = await request(relative, options);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('企业服务响应超过大小限制');
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`企业服务返回无效 JSON（${response.status} ${target}）`);
      }
    }
    if (!response.ok) throw new Error(payload?.error?.message || `企业服务请求失败：${response.status}`);
    return payload;
  }

  async function login(input = {}) {
    const baseUrl = normalizeBaseURL(input.baseUrl || load().baseUrl);
    const target = `${baseUrl}/v1/auth/login`;
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        orgId: input.orgId || '',
        remember: Boolean(input.remember),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || `登录失败：${response.status}`);
    const next = {
      baseUrl,
      token: encrypt(payload.token),
      session: payload.session,
    };
    save(next);
    skillHubClient?.saveSettings?.({ baseUrl, token: payload.token, requireSignature: true });
    return publicState();
  }

  async function logout() {
    try {
      if (decrypt(load().token)) {
        await jsonRequest('/v1/auth/logout', { method: 'POST', timeoutMs: 8_000 });
      }
    } catch {
      // Local logout must still complete if the server is unavailable.
    }
    volatileToken = '';
    const next = { baseUrl: load().baseUrl, token: null, session: null };
    save(next);
    skillHubClient?.saveSettings?.({ baseUrl: next.baseUrl, clearToken: true, requireSignature: true });
    return publicState();
  }

  async function session() {
    if (!decrypt(load().token)) return publicState();
    try {
      const profile = await jsonRequest('/v1/auth/session', { timeoutMs: 8_000 });
      save({ ...load(), session: profile });
    } catch (error) {
      save({ ...load(), token: null, session: null });
      throw error;
    }
    return publicState();
  }

  async function switchOrganization(orgId) {
    const profile = await jsonRequest('/v1/auth/switch-organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
    save({ ...load(), session: profile });
    return publicState();
  }

  const get = (path) => jsonRequest(path);
  const mutate = (path, method, body) => jsonRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  async function listOrganizations() { return get('/v1/organizations'); }
  async function createOrganization(input) { return mutate('/v1/organizations', 'POST', input); }
  async function listUsers(orgId) { return get(`/v1/users?orgId=${encodeURIComponent(orgId || '')}`); }
  async function createUser(input) { return mutate('/v1/users', 'POST', input); }
  async function updateUser(input) { return mutate(`/v1/users/${encodeURIComponent(input.id)}`, 'PATCH', input.patch || {}); }
  async function resetPassword(input) { return mutate(`/v1/users/${encodeURIComponent(input.id)}/password`, 'POST', { password: input.password }); }
  async function listMembers(orgId) { return get(`/v1/organizations/${encodeURIComponent(orgId)}/members`); }
  async function putMember(input) { return mutate(`/v1/organizations/${encodeURIComponent(input.orgId)}/members/${encodeURIComponent(input.userId)}`, 'PUT', { role: input.role }); }
  async function removeMember(input) { return mutate(`/v1/organizations/${encodeURIComponent(input.orgId)}/members/${encodeURIComponent(input.userId)}`, 'DELETE'); }

  async function listProjects(orgId) { return get(`/v1/projects?orgId=${encodeURIComponent(orgId || '')}`); }
  async function getProject(id) { return get(`/v1/projects/${encodeURIComponent(id)}`); }
  async function createProject(input) { return mutate('/v1/projects', 'POST', input); }
  async function updateProject(input) { return mutate(`/v1/projects/${encodeURIComponent(input.id)}`, 'PATCH', input.patch || {}); }
  async function archiveProject(id) { return mutate(`/v1/projects/${encodeURIComponent(id)}`, 'DELETE'); }
  async function putProjectMember(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/members/${encodeURIComponent(input.userId)}`, 'PUT', { role: input.role }); }
  async function removeProjectMember(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/members/${encodeURIComponent(input.userId)}`, 'DELETE'); }
  async function updateProjectCapabilities(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/capabilities`, 'PUT', input.capabilities); }

  async function listConnectorDefinitions(orgId) { return get(`/v1/connector-definitions?orgId=${encodeURIComponent(orgId || '')}`); }
  async function createConnectorDefinition(input) { return mutate('/v1/connector-definitions', 'POST', input); }
  async function updateConnectorDefinition(input) { return mutate(`/v1/connector-definitions/${encodeURIComponent(input.id)}`, 'PATCH', input.patch || {}); }
  async function listConnectorBindings(orgId) { return get(`/v1/connector-bindings?orgId=${encodeURIComponent(orgId || '')}`); }
  async function createConnectorBinding(input) { return mutate('/v1/connector-bindings', 'POST', input); }
  async function updateConnectorBinding(input) { return mutate(`/v1/connector-bindings/${encodeURIComponent(input.id)}`, 'PATCH', input.patch || {}); }
  async function deleteConnectorBinding(id) { return mutate(`/v1/connector-bindings/${encodeURIComponent(id)}`, 'DELETE'); }
  async function testConnectorBinding(id) { return mutate(`/v1/connector-bindings/${encodeURIComponent(id)}/test`, 'POST'); }
  async function listConnectorGrants(projectId) { return get(`/v1/projects/${encodeURIComponent(projectId)}/connector-grants`); }
  async function createConnectorGrant(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/connector-grants`, 'POST', input.grant); }
  async function updateConnectorGrant(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/connector-grants/${encodeURIComponent(input.grantId)}`, 'PATCH', input.patch || {}); }
  async function deleteConnectorGrant(input) { return mutate(`/v1/projects/${encodeURIComponent(input.projectId)}/connector-grants/${encodeURIComponent(input.grantId)}`, 'DELETE'); }

  async function extensionsForRequest(request = {}) {
    const enterpriseProjectId = request.enterpriseProjectId || request.remoteProjectId || '';
    if (!enterpriseProjectId || !decrypt(load().token)) return [];
    try {
      const payload = await get(`/v1/runtime/connectors?projectId=${encodeURIComponent(enterpriseProjectId)}`);
      return Array.isArray(payload?.extensions) ? payload.extensions : [];
    } catch (error) {
      if (request.requireEnterpriseConnectors) throw error;
      return [];
    }
  }

  function registerIpc() {
    ipcMain.handle('enterprise:get-session', async () => publicState());
    ipcMain.handle('enterprise:login', async (_event, request) => login(request || {}));
    ipcMain.handle('enterprise:logout', async () => logout());
    ipcMain.handle('enterprise:refresh-session', async () => session());
    ipcMain.handle('enterprise:switch-organization', async (_event, orgId) => switchOrganization(orgId));
    ipcMain.handle('enterprise:list-organizations', async () => listOrganizations());
    ipcMain.handle('enterprise:create-organization', async (_event, request) => createOrganization(request || {}));
    ipcMain.handle('enterprise:list-users', async (_event, orgId) => listUsers(orgId));
    ipcMain.handle('enterprise:create-user', async (_event, request) => createUser(request || {}));
    ipcMain.handle('enterprise:update-user', async (_event, request) => updateUser(request || {}));
    ipcMain.handle('enterprise:reset-password', async (_event, request) => resetPassword(request || {}));
    ipcMain.handle('enterprise:list-members', async (_event, orgId) => listMembers(orgId));
    ipcMain.handle('enterprise:put-member', async (_event, request) => putMember(request || {}));
    ipcMain.handle('enterprise:remove-member', async (_event, request) => removeMember(request || {}));
    ipcMain.handle('enterprise:list-projects', async (_event, orgId) => listProjects(orgId));
    ipcMain.handle('enterprise:get-project', async (_event, id) => getProject(id));
    ipcMain.handle('enterprise:create-project', async (_event, request) => createProject(request || {}));
    ipcMain.handle('enterprise:update-project', async (_event, request) => updateProject(request || {}));
    ipcMain.handle('enterprise:archive-project', async (_event, id) => archiveProject(id));
    ipcMain.handle('enterprise:put-project-member', async (_event, request) => putProjectMember(request || {}));
    ipcMain.handle('enterprise:remove-project-member', async (_event, request) => removeProjectMember(request || {}));
    ipcMain.handle('enterprise:update-project-capabilities', async (_event, request) => updateProjectCapabilities(request || {}));
    ipcMain.handle('enterprise:list-connector-definitions', async (_event, orgId) => listConnectorDefinitions(orgId));
    ipcMain.handle('enterprise:create-connector-definition', async (_event, request) => createConnectorDefinition(request || {}));
    ipcMain.handle('enterprise:update-connector-definition', async (_event, request) => updateConnectorDefinition(request || {}));
    ipcMain.handle('enterprise:list-connector-bindings', async (_event, orgId) => listConnectorBindings(orgId));
    ipcMain.handle('enterprise:create-connector-binding', async (_event, request) => createConnectorBinding(request || {}));
    ipcMain.handle('enterprise:update-connector-binding', async (_event, request) => updateConnectorBinding(request || {}));
    ipcMain.handle('enterprise:delete-connector-binding', async (_event, id) => deleteConnectorBinding(id));
    ipcMain.handle('enterprise:test-connector-binding', async (_event, id) => testConnectorBinding(id));
    ipcMain.handle('enterprise:list-connector-grants', async (_event, projectId) => listConnectorGrants(projectId));
    ipcMain.handle('enterprise:create-connector-grant', async (_event, request) => createConnectorGrant(request || {}));
    ipcMain.handle('enterprise:update-connector-grant', async (_event, request) => updateConnectorGrant(request || {}));
    ipcMain.handle('enterprise:delete-connector-grant', async (_event, request) => deleteConnectorGrant(request || {}));
  }

  return {
    registerIpc,
    publicState,
    login,
    logout,
    session,
    switchOrganization,
    listOrganizations,
    createOrganization,
    listUsers,
    createUser,
    listMembers,
    listProjects,
    getProject,
    createProject,
    updateProject,
    updateProjectCapabilities,
    listConnectorDefinitions,
    createConnectorDefinition,
    listConnectorBindings,
    createConnectorBinding,
    testConnectorBinding,
    listConnectorGrants,
    createConnectorGrant,
    extensionsForRequest,
  };
}

module.exports = { createEnterpriseClient, normalizeBaseURL };
