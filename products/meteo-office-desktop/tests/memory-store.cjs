'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryStore } = require('../capabilities/memory-store.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-memory-store-'));
const databasePath = path.join(root, 'memory.db');
let now = Date.parse('2026-08-04T08:00:00+08:00');
let sequence = 0;
const createStore = () => createMemoryStore({
  databasePath,
  clock: () => now,
  idFactory: () => `memory-test-${++sequence}`,
});

let store = createStore();
const projectPreference = store.create({
  scope: { type: 'project', id: 'project-fujian' },
  memoryType: 'preference',
  title: '日常产品输出格式',
  summary: '默认同时生成 DOCX 和 PDF，并保留 Markdown 中间稿。',
  tags: ['产品制作', 'DOCX', 'PDF'],
  pinned: true,
  sourceRefs: [
    { kind: 'message', id: 'message-1', excerpt: '以后都同时生成 Word 和 PDF。' },
    { kind: 'task', id: 'task-1' },
  ],
}, { actorId: 'user-1', taskId: 'task-1' });
assert.equal(projectPreference.scope.type, 'project');
assert.equal(projectPreference.revision, 1);
assert.equal(projectPreference.authority, 'model-extracted');
assert.equal(projectPreference.sourceRefs.length, 2);
assert.ok(projectPreference.recordHash.length >= 32);
const duplicatePreference = store.create({
  scope: { type: 'project', id: 'project-fujian' },
  memoryType: 'preference',
  title: '日常产品输出格式',
  summary: '默认同时生成 DOCX 和 PDF，并保留 Markdown 中间稿。',
  tags: ['产品制作', 'DOCX', 'PDF'],
  pinned: true,
  sourceRefs: [
    { kind: 'message', id: 'message-1', excerpt: '以后都同时生成 Word 和 PDF。' },
    { kind: 'task', id: 'task-1' },
  ],
}, { actorId: 'user-1', taskId: 'task-1' });
assert.equal(duplicatePreference.id, projectPreference.id, 'exact duplicate memory should be reused');

now += 1000;
const userPreference = store.create({
  scope: { type: 'user', id: 'user-1' },
  memoryType: 'preference',
  title: '分析顺序',
  summary: '用户习惯先看 500hPa，再检查 850hPa 与地面场。',
  tags: ['形势分析'],
}, { actorId: 'user-1' });

now += 1000;
const otherProject = store.create({
  scope: { type: 'project', id: 'project-other' },
  memoryType: 'decision',
  title: '其他项目决定',
  summary: '这条内容不能出现在福建项目检索中。',
}, { actorId: 'user-1' });

const listed = store.list({ projectId: 'project-fujian', userId: 'user-1', status: 'active' });
assert.deepEqual(new Set(listed.map((item) => item.id)), new Set([projectPreference.id, userPreference.id]));

const documentQuery = store.retrieve({
  query: '生成 PDF 产品',
  projectId: 'project-fujian',
  userId: 'user-1',
  includeProject: true,
  includeUser: true,
  limit: 8,
  charBudget: 6000,
});
assert.equal(documentQuery[0].id, projectPreference.id);
assert.ok(documentQuery.every((item) => item.id !== otherProject.id));

now += 1000;
const unrelatedNote = store.create({
  scope: { type: 'user', id: 'user-1' },
  memoryType: 'note',
  title: '服务器维护备注',
  summary: '测试机每周五晚进行磁盘清理。',
}, { actorId: 'user-1' });
assert.equal(
  store.retrieve({
    query: '生成暴雨预报产品',
    projectId: 'project-fujian',
    userId: 'user-1',
  }).some((item) => item.id === unrelatedNote.id),
  false,
  'unrelated notes should not be injected merely because they share the user scope'
);

const synopticQuery = store.retrieve({
  query: '分析天气形势时先看什么层次',
  projectId: 'project-fujian',
  userId: 'user-1',
  includeProject: true,
  includeUser: true,
});
assert.ok(synopticQuery.some((item) => item.id === userPreference.id));

const updated = store.update(projectPreference.id, {
  summary: '默认同时生成 DOCX、PDF，并保留 Markdown 中间稿和图件清单。',
  tags: ['产品制作', 'DOCX', 'PDF', '图件'],
}, { actorId: 'user-1', baseRevision: 1 });
assert.equal(updated.revision, 2);
assert.match(updated.summary, /图件清单/);
const noChange = store.update(projectPreference.id, {
  summary: updated.summary,
  tags: updated.tags,
}, { actorId: 'user-1', baseRevision: 2 });
assert.equal(noChange.revision, 2, 'no-op updates must not create revisions');
assert.throws(
  () => store.update(projectPreference.id, { title: '过期编辑' }, { actorId: 'user-1', baseRevision: 1 }),
  (error) => error.code === 'MEMORY_REVISION_CONFLICT'
);

const used = store.markUsed([projectPreference.id, userPreference.id, 'missing'], {
  actorId: 'user-1',
  taskId: 'task-2',
  runId: 'run-2',
  projectId: 'project-fujian',
});
assert.equal(used.length, 2);
assert.equal(store.get(projectPreference.id).useCount, 1);
assert.equal(store.history(projectPreference.id).some((event) => event.action === 'used' && event.runId === 'run-2'), true);

const archived = store.setStatus(userPreference.id, 'archived', { actorId: 'user-1', baseRevision: 1 });
assert.equal(archived.status, 'archived');
const afterArchive = store.retrieve({
  query: '500hPa',
  projectId: 'project-fujian',
  userId: 'user-1',
});
assert.equal(afterArchive.some((item) => item.id === userPreference.id), false);

now += 1000;
const expiring = store.create({
  scope: { type: 'project', id: 'project-fujian' },
  memoryType: 'note',
  title: '临时会商安排',
  summary: '只在今天的会商中使用。',
  temporal: { class: 'event', expiresAt: now + 500 },
}, { actorId: 'user-1' });
assert.equal(store.retrieve({ query: '会商', projectId: 'project-fujian', userId: 'user-1' }).some((item) => item.id === expiring.id), true);
now += 1000;
assert.equal(store.retrieve({ query: '会商', projectId: 'project-fujian', userId: 'user-1' }).some((item) => item.id === expiring.id), false);

const stats = store.stats({ projectId: 'project-fujian', userId: 'user-1', status: 'all' });
assert.equal(stats.total, 4);
assert.equal(stats.byScope.project, 2);
assert.equal(stats.byScope.user, 2);

store.close();
store = createStore();
assert.equal(store.get(projectPreference.id).revision, 2);
assert.equal(store.get(projectPreference.id).useCount, 1);
assert.throws(
  () => store.remove(projectPreference.id, { actorId: 'user-1', baseRevision: 1 }),
  (error) => error.code === 'MEMORY_REVISION_CONFLICT'
);
assert.equal(store.remove(otherProject.id, { actorId: 'user-1', baseRevision: 1 }), true);
assert.equal(store.get(otherProject.id), null);
store.close();

console.log('memory store tests passed');
