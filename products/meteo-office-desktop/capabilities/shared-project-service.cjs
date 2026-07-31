'use strict';

const SecurityMode = require('./security-mode.cjs');

function createSharedProjectService({ ipcMain, profileContext, fetchImpl = globalThis.fetch, securityMode = process.env.METEOMATE_SECURITY_MODE } = {}) {
  if (!ipcMain || !profileContext || typeof fetchImpl !== 'function') {
    throw new Error('Shared project service requires ipcMain, profileContext and fetch');
  }

  function ensureOnline() {
    if (!profileContext.isAuthenticated()) throw new Error('共享项目需要登录 MeteoMate 内网服务');
  }

  async function request(method, pathname, body = undefined) {
    ensureOnline();
    const target = `${profileContext.baseUrl()}${pathname}`;
    const init = {
      method,
      headers: profileContext.authHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    };
    const response = typeof profileContext.fetchAuthenticated === 'function'
      ? await profileContext.fetchAuthenticated(target, init)
      : await fetchImpl(target, init);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`共享项目服务返回了无效响应（${response.status}）`);
    }
    if (!response.ok) throw new Error(payload?.error?.message || `共享项目请求失败（${response.status}）`);
    return payload;
  }

  const mode = SecurityMode.normalizeSecurityMode(securityMode);
  const strict = mode === SecurityMode.MODES.STRICT;

  function sanitizedProjectSpec(project = {}) {
    const spec = project.spec && typeof project.spec === 'object' ? structuredClone(project.spec) : {};
    if (Array.isArray(spec.workspaces)) {
      spec.workspaces = spec.workspaces.map((workspace) => ({
        id: String(workspace?.id || 'primary'),
        access: String(workspace?.access || 'read-write-approved'),
        root: strict ? '' : String(workspace?.root || ''),
        uri: String(workspace?.uri || ''),
      }));
    }
    delete spec.sharing;
    return spec;
  }

  function projectPayload(project = {}, options = {}) {
    const configuredWorkspace = options.workspaceURI ?? project.sharing?.workspaceURI;
    const workspaceURI = configuredWorkspace == null || configuredWorkspace === ''
      ? (strict ? '' : String(project.workspace || project.spec?.workspaces?.[0]?.root || ''))
      : String(configuredWorkspace);
    return {
      name: String(project.name || '').trim(),
      description: String(options.description ?? project.description ?? '').trim(),
      visibility: ['private', 'organization'].includes(options.visibility || project.sharing?.visibility)
        ? options.visibility || project.sharing.visibility
        : 'private',
      workspaceURI: workspaceURI.trim(),
      spec: sanitizedProjectSpec(project),
      clientProjectId: String(project.id || '').trim(),
      baseRevision: Number(options.baseRevision ?? project.sharing?.revision ?? 0),
    };
  }

  async function list(requestInput = {}) {
    const query = new URLSearchParams();
    if (requestInput.query) query.set('query', String(requestInput.query));
    const suffix = query.toString() ? `?${query}` : '';
    return request('GET', `/v1/projects${suffix}`);
  }

  async function get(id) {
    return request('GET', `/v1/projects/${encodeURIComponent(String(id))}`);
  }

  async function publish(input = {}) {
    if (!input.project?.name) throw new Error('共享项目缺少项目名称');
    return request('POST', '/v1/projects', projectPayload(input.project, input));
  }

  async function update(input = {}) {
    const id = String(input.id || input.project?.sharing?.remoteId || '').trim();
    if (!id) throw new Error('共享项目缺少远程 ID');
    return request('PUT', `/v1/projects/${encodeURIComponent(id)}`, projectPayload(input.project || {}, input));
  }

  async function setMember(input = {}) {
    const id = String(input.id || '').trim();
    const userId = String(input.userId || '').trim();
    const role = String(input.role || '').trim();
    const baseRevision = Number(input.baseRevision || 0);
    if (!id || !userId || !['viewer', 'editor', 'owner'].includes(role) || !Number.isInteger(baseRevision) || baseRevision <= 0) {
      throw new Error('共享项目成员参数或 baseRevision 无效');
    }
    return request('PUT', `/v1/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role, baseRevision });
  }

  async function removeMember(input = {}) {
    const id = String(input.id || '').trim();
    const userId = String(input.userId || '').trim();
    const baseRevision = Number(input.baseRevision || 0);
    if (!id || !userId || !Number.isInteger(baseRevision) || baseRevision <= 0) {
      throw new Error('共享项目成员参数或 baseRevision 无效');
    }
    const query = new URLSearchParams({ baseRevision: String(baseRevision) });
    return request('DELETE', `/v1/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}?${query}`);
  }

  function registerIpc() {
    ipcMain.handle('shared-project:list', async (_event, input) => list(input || {}));
    ipcMain.handle('shared-project:get', async (_event, id) => get(id));
    ipcMain.handle('shared-project:publish', async (_event, input) => publish(input || {}));
    ipcMain.handle('shared-project:update', async (_event, input) => update(input || {}));
    ipcMain.handle('shared-project:set-member', async (_event, input) => setMember(input || {}));
    ipcMain.handle('shared-project:remove-member', async (_event, input) => removeMember(input || {}));
  }

  return { registerIpc, list, get, publish, update, setMember, removeMember, projectPayload };
}

module.exports = { createSharedProjectService };
