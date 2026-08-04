'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryService } = require('../capabilities/memory-service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-memory-service-'));
const handlers = new Map();
const ipcMain = {
  handle(name, callback) {
    assert.equal(handlers.has(name), false, `duplicate IPC handler ${name}`);
    handlers.set(name, callback);
  },
};
let profileKey = 'profile-a';
let listeners = [];
let memoryEnabled = false;
let confirmMutation = true;
const confirmedMutations = [];
const profileContext = {
  currentPaths: () => ({ root: path.join(root, profileKey) }),
  publicState: () => ({
    status: 'authenticated',
    profileKey,
    user: { id: profileKey === 'profile-a' ? 'user-a' : 'user-b', displayName: '值班员' },
  }),
  onChange(listener) {
    listeners.push(listener);
    return () => { listeners = listeners.filter((item) => item !== listener); };
  },
  desktopPreferences: () => ({ memoryEnabled }),
  saveDesktopPreferences(input = {}) {
    memoryEnabled = input.memoryEnabled === true;
    return { memoryEnabled };
  },
};

const trustedEvent = { sender: { id: 'main-renderer' } };
const service = createMemoryService({
  ipcMain,
  profileContext,
  isTrustedEvent: (event) => event === trustedEvent,
  async confirmMemoryMutation(request) {
    confirmedMutations.push(request);
    return confirmMutation;
  },
});
service.registerIpc();
for (const name of [
  'memory:state', 'memory:list', 'memory:get', 'memory:create', 'memory:update',
  'memory:set-status', 'memory:delete', 'memory:retrieve', 'memory:mark-used',
  'memory:history', 'memory:stats', 'memory:set-enabled',
]) assert.equal(handlers.has(name), true, `missing ${name}`);

async function invoke(name, request = {}) {
  return handlers.get(name)(trustedEvent, request);
}

(async () => {
  await assert.rejects(
    () => invoke('memory:create', {
      scope: { type: 'user' },
      title: '不应写入',
      summary: '全局开关关闭时主进程必须拒绝。',
    }),
    /记忆已关闭/
  );
  await assert.rejects(
    () => handlers.get('memory:list')({ sender: { id: 'other-renderer' } }, {}),
    /不受信任/
  );
  const enabled = await invoke('memory:set-enabled', { enabled: true });
  assert.equal(enabled.memoryEnabled, true);
  assert.equal(confirmedMutations.at(-1).action, 'enable');

  const createdProject = await invoke('memory:create', {
    projectId: 'project-1',
    scope: { type: 'project', id: 'project-1' },
    memoryType: 'decision',
    title: '风险区调整决定',
    summary: '会商后将重点风险区向东北方向调整。',
    tags: ['会商', '风险区'],
    sourceRefs: [{ kind: 'task', id: 'task-1' }],
    taskId: 'task-1',
  });
  assert.equal(createdProject.memory.scope.id, 'project-1');
  assert.equal(createdProject.memory.createdBy.id, 'user-a');
  assert.equal(createdProject.memory.authority, 'user-confirmed');
  assert.equal(confirmedMutations.at(-1).action, 'create');

  const createdUser = await invoke('memory:create', {
    scope: { type: 'user' },
    memoryType: 'preference',
    title: '产品格式',
    summary: '默认生成 PDF。',
  });
  assert.equal(createdUser.memory.scope.type, 'user');
  assert.equal(createdUser.memory.scope.id, 'user-a');
  const updatedUser = await invoke('memory:update', {
    id: createdUser.memory.id,
    baseRevision: createdUser.memory.revision,
    projectId: 'project-1',
    patch: { title: '产品格式偏好' },
  });
  assert.equal(updatedUser.memory.scope.type, 'user', 'project context must not move a user memory');

  await assert.rejects(
    () => invoke('memory:get', { id: createdProject.memory.id, projectId: 'project-2' }),
    /不属于当前项目/
  );
  await assert.rejects(
    () => invoke('memory:history', { id: createdProject.memory.id }),
    /必须提供项目上下文/
  );

  const list = await invoke('memory:list', { projectId: 'project-1', includeUser: true });
  assert.equal(list.items.length, 2);
  assert.equal(list.store.backend, 'sqlite');

  const retrieved = await invoke('memory:retrieve', {
    projectId: 'project-1',
    query: '今天的风险区如何调整',
    policy: { useProjectMemory: true, useUserMemory: true },
  });
  assert.equal(retrieved.snapshot.kind, 'MemoryContextSnapshot');
  assert.equal(retrieved.snapshot.items.some((item) => item.id === createdProject.memory.id), true);

  const marked = await invoke('memory:mark-used', {
    ids: retrieved.snapshot.items.map((item) => item.id),
    projectId: 'project-1',
    taskId: 'task-2',
    runId: 'run-2',
  });
  assert.ok(marked.items.length >= 1);

  const updated = await invoke('memory:update', {
    id: createdProject.memory.id,
    baseRevision: createdProject.memory.revision,
    projectId: 'project-1',
    patch: { summary: '会商后将重点风险区向东北调整 30–50 km。' },
  });
  assert.equal(updated.memory.revision, 2);

  confirmMutation = false;
  await assert.rejects(
    () => invoke('memory:update', {
      id: createdProject.memory.id,
      baseRevision: updated.memory.revision,
      projectId: 'project-1',
      patch: { summary: '未获用户确认的更新。' },
    }),
    /用户取消/
  );
  assert.equal((await invoke('memory:get', {
    id: createdProject.memory.id,
    projectId: 'project-1',
  })).memory.revision, 2);
  confirmMutation = true;

  await assert.rejects(
    () => invoke('memory:delete', { id: createdProject.memory.id, baseRevision: 1, projectId: 'project-1' }),
    (error) => error.code === 'MEMORY_REVISION_CONFLICT'
  );

  const history = await invoke('memory:history', { id: createdProject.memory.id, projectId: 'project-1' });
  assert.equal(history.items.some((item) => item.action === 'created'), true);
  assert.equal(history.items.some((item) => item.action === 'updated'), true);
  assert.equal(history.items.some((item) => item.action === 'used'), true);

  profileKey = 'profile-b';
  listeners.forEach((listener) => listener(profileContext.publicState()));
  const isolated = await invoke('memory:list', { projectId: 'project-1', includeUser: true });
  assert.equal(isolated.items.length, 0, 'profile memory must be isolated');

  service.shutdown();
  console.log('memory service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
