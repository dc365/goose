'use strict';

const path = require('node:path');
const { createMemoryStore, MEMORY_TYPES, STATUSES } = require('./memory-store.cjs');
const MemoryContext = require('../harness/memory-context');

function createMemoryService({
  ipcMain,
  profileContext,
  isTrustedEvent,
  confirmMemoryMutation,
} = {}) {
  if (!ipcMain?.handle) throw new Error('Memory service requires ipcMain');
  if (!profileContext?.currentPaths) throw new Error('Memory service requires profileContext');
  if (typeof isTrustedEvent !== 'function') throw new Error('Memory service requires trusted IPC validation');
  if (typeof confirmMemoryMutation !== 'function') throw new Error('Memory service requires native confirmation');

  let current = null;
  let currentPath = '';

  function account() {
    const state = profileContext.publicState?.() || {};
    if (!state.user?.id || !['authenticated', 'offline'].includes(state.status)) {
      throw new Error('请先登录 MeteoMate 再使用记忆');
    }
    return state;
  }

  function serviceError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertTrustedEvent(event) {
    if (!isTrustedEvent(event)) {
      throw serviceError('记忆请求来自不受信任的窗口', 'MEMORY_UNTRUSTED_SENDER');
    }
  }

  function memoryEnabled() {
    return profileContext.desktopPreferences?.().memoryEnabled === true;
  }

  function assertMemoryEnabled() {
    if (!memoryEnabled()) throw serviceError('记忆已关闭，请先在个性化设置中开启', 'MEMORY_DISABLED');
  }

  function databasePath() {
    return path.join(profileContext.currentPaths().root, 'memory', 'memory.db');
  }

  function store() {
    account();
    const target = databasePath();
    if (!current || target !== currentPath) {
      current?.close?.();
      current = createMemoryStore({ databasePath: target });
      currentPath = target;
    }
    return current;
  }

  function actorContext(request = {}) {
    const state = account();
    return {
      actorId: state.user.id,
      taskId: request.taskId ? String(request.taskId) : null,
      runId: request.runId ? String(request.runId) : null,
      projectId: request.projectId ? String(request.projectId) : null,
    };
  }

  function requestProjectId(request = {}) {
    return String(request.projectId || '').trim();
  }

  function assertScopeAccess(memory, request = {}) {
    const state = account();
    if (memory.scope.type === 'user') {
      if (memory.scope.id !== state.user.id) {
        throw serviceError('无权访问这条个人记忆', 'MEMORY_SCOPE_FORBIDDEN');
      }
      return memory;
    }
    const projectId = requestProjectId(request);
    if (!projectId) {
      throw serviceError('访问项目记忆必须提供项目上下文', 'MEMORY_PROJECT_REQUIRED');
    }
    if (memory.scope.id !== projectId) {
      throw serviceError('这条记忆不属于当前项目', 'MEMORY_SCOPE_FORBIDDEN');
    }
    return memory;
  }

  function accessibleMemory(request = {}) {
    const memory = store().get(request.id);
    if (!memory) throw new Error('记忆不存在');
    return assertScopeAccess(memory, request);
  }

  async function confirm(action, memory, request = {}) {
    const approved = await confirmMemoryMutation({
      action,
      memory,
      projectId: requestProjectId(request) || null,
      actor: account().user,
    });
    if (!approved) throw serviceError('用户取消了记忆操作', 'MEMORY_CONFIRMATION_CANCELLED');
  }

  function normalizedScope(request = {}) {
    const state = account();
    const scopeType = request.scope?.type === 'user' || request.scopeType === 'user'
      ? 'user'
      : 'project';
    if (scopeType === 'user') return { type: 'user', id: state.user.id };
    const projectId = String(request.scope?.id || request.projectId || request.scopeId || '').trim();
    if (!projectId) throw new Error('项目记忆必须绑定项目');
    if (requestProjectId(request) !== projectId) {
      throw serviceError('项目记忆范围与当前项目不一致', 'MEMORY_SCOPE_FORBIDDEN');
    }
    return { type: 'project', id: projectId };
  }

  async function create(request = {}) {
    assertMemoryEnabled();
    const state = account();
    const scope = normalizedScope(request);
    await confirm('create', {
      scope,
      title: request.title,
      summary: request.summary,
      memoryType: request.memoryType,
      tags: request.tags,
      sourceRefs: request.sourceRefs,
    }, request);
    const memory = store().create({
      ...request,
      scope,
      authority: 'user-confirmed',
      createdBy: { type: 'user', id: state.user.id },
      extractorVersion: 'manual/v1',
    }, actorContext(request));
    return { memory, stats: stats({ projectId: request.projectId }) };
  }

  async function update(request = {}) {
    const state = account();
    const existing = accessibleMemory(request);
    const patch = { ...request.patch };
    if (patch.scope || patch.scopeType || patch.scopeId) {
      patch.scope = normalizedScope({
        ...request,
        ...patch,
        scope: patch.scope,
      });
    } else {
      patch.scope = existing.scope.type === 'user'
        ? { type: 'user', id: state.user.id }
        : existing.scope;
    }
    await confirm('update', {
      ...existing,
      ...patch,
      scope: patch.scope || existing.scope,
    }, request);
    const memory = store().update(request.id, patch, {
      ...actorContext(request),
      baseRevision: request.baseRevision,
    });
    return { memory, stats: stats({ projectId: request.projectId || (memory.scope.type === 'project' ? memory.scope.id : '') }) };
  }

  function list(request = {}) {
    const state = account();
    const query = {
      search: request.search || '',
      memoryType: request.memoryType || 'all',
      status: request.status || 'active',
      limit: request.limit || 200,
      offset: request.offset || 0,
      order: request.order || 'recent',
    };
    if (request.scopeType && request.scopeId) {
      query.scopeType = request.scopeType;
      if (request.scopeType === 'user') {
        query.scopeId = state.user.id;
      } else {
        const projectId = requestProjectId(request);
        if (!projectId || String(request.scopeId) !== projectId) {
          throw serviceError('项目记忆范围与当前项目不一致', 'MEMORY_SCOPE_FORBIDDEN');
        }
        query.scopeId = projectId;
      }
    } else {
      query.projectId = requestProjectId(request);
      query.userId = request.includeUser === false ? '' : state.user.id;
    }
    return {
      items: store().list(query),
      stats: stats(request),
      store: serviceState(),
    };
  }

  function retrieve(request = {}) {
    const state = account();
    const policy = MemoryContext.normalizePolicy(request.policy || {}, {});
    if (!memoryEnabled()) {
      return {
        snapshot: MemoryContext.emptySnapshot({
          query: request.query || '',
          projectId: requestProjectId(request) || null,
          userId: state.user.id,
        }),
        policy: { ...policy, useProjectMemory: false, useUserMemory: false },
      };
    }
    const items = store().retrieve({
      query: request.query || '',
      projectId: requestProjectId(request),
      userId: state.user.id,
      includeProject: policy.useProjectMemory,
      includeUser: policy.useUserMemory,
      limit: request.limit || policy.maxItems,
      charBudget: request.charBudget || policy.charBudget,
    });
    const snapshot = MemoryContext.normalizeSnapshot({
      query: request.query || '',
      projectId: request.projectId || null,
      userId: state.user.id,
      generatedAt: Date.now(),
      items,
    });
    return { snapshot, policy };
  }

  function markUsed(request = {}) {
    if (!memoryEnabled()) return { items: [] };
    const ids = [...new Set((Array.isArray(request.ids) ? request.ids : []).map(String).filter(Boolean))];
    ids.forEach((id) => accessibleMemory({ ...request, id }));
    const memories = store().markUsed(ids, actorContext(request));
    return { items: memories };
  }

  async function setEnabled(request = {}) {
    account();
    const enabled = request.enabled === true;
    if (enabled && !memoryEnabled()) {
      await confirm('enable', {
        scope: { type: 'user', id: account().user.id },
        title: '启用长期记忆',
        summary: '允许 MeteoMate 在后续对话中检索你明确保存的个人与项目记忆。',
      });
    }
    const preferences = profileContext.saveDesktopPreferences({ memoryEnabled: enabled });
    return { memoryEnabled: preferences.memoryEnabled === true };
  }

  function setStatus(request = {}) {
    accessibleMemory(request);
    const memory = store().setStatus(request.id, request.status, {
      ...actorContext(request),
      baseRevision: request.baseRevision,
    });
    return { memory };
  }

  async function remove(request = {}) {
    const memory = accessibleMemory(request);
    await confirm('delete', memory, request);
    return {
      removed: store().remove(request.id, {
        ...actorContext(request),
        baseRevision: request.baseRevision,
      }),
    };
  }

  function get(request = {}) {
    const memory = accessibleMemory(request);
    return {
      memory,
      history: request.includeHistory ? store().history(request.id, request.historyLimit) : [],
    };
  }

  function history(request = {}) {
    accessibleMemory(request);
    return { items: store().history(request.id, request.limit) };
  }

  function stats(request = {}) {
    const state = account();
    return store().stats({
      projectId: requestProjectId(request),
      userId: request.includeUser === false ? '' : state.user.id,
      status: request.status || 'all',
    });
  }

  function serviceState() {
    if (!current) {
      return {
        available: true,
        backend: 'sqlite',
        databasePath: null,
        memoryTypes: [...MEMORY_TYPES],
        statuses: [...STATUSES],
      };
    }
    return {
      available: true,
      backend: 'sqlite',
      databasePath: current.path(),
      ftsAvailable: current.ftsAvailable(),
      memoryTypes: [...MEMORY_TYPES],
      statuses: [...STATUSES],
    };
  }

  function close() {
    current?.close?.();
    current = null;
    currentPath = '';
  }

  const unsubscribe = profileContext.onChange?.(() => close()) || null;

  function registerIpc() {
    const handle = (name, callback) => {
      ipcMain.handle(name, async (event, request) => {
        assertTrustedEvent(event);
        return callback(request || {});
      });
    };
    handle('memory:state', () => serviceState());
    handle('memory:list', list);
    handle('memory:get', get);
    handle('memory:create', create);
    handle('memory:update', update);
    handle('memory:set-status', setStatus);
    handle('memory:delete', remove);
    handle('memory:retrieve', retrieve);
    handle('memory:mark-used', markUsed);
    handle('memory:history', history);
    handle('memory:stats', stats);
    handle('memory:set-enabled', setEnabled);
  }

  function shutdown() {
    unsubscribe?.();
    close();
  }

  return {
    registerIpc,
    shutdown,
    serviceState,
    list,
    get,
    create,
    update,
    setStatus,
    remove,
    retrieve,
    markUsed,
    setEnabled,
    history,
    stats,
  };
}

module.exports = { createMemoryService };
