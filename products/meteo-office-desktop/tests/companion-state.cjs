'use strict';

const assert = require('node:assert/strict');
const Companion = require('../capabilities/companion-state.cjs');

let time = 1_800_000_000_000;
const store = Companion.createCompanionStateStore({ now: () => time });

store.handleRuntimeEvent({
  type: 'runtime_status',
  acpAvailable: false,
  binaryAvailable: false,
  headlessAvailable: false,
});
assert.equal(store.snapshot().visualState, 'offline');
assert.equal(store.snapshot().runtime.online, false);

store.syncSummary({
  activeTaskId: 'task-rain',
  tasks: [{
    id: 'task-rain',
    title: '华东强降水过程分析',
    projectName: '8 月暴雨过程',
    lifecycleState: 'PLANNING',
    updatedAt: time,
  }],
});
let snapshot = store.snapshot();
assert.equal(snapshot.primaryTask.id, 'task-rain');
assert.equal(snapshot.primaryTask.state, 'planning');
assert.equal(snapshot.visualState, 'planning');

const progress = store.handleRuntimeEvent({
  type: 'runtime_progress',
  taskId: 'task-rain',
  stage: 'preparing_runtime',
});
assert.equal(progress.notification, null);
snapshot = store.snapshot();
assert.equal(snapshot.primaryTask.state, 'running');
assert.equal(snapshot.primaryTask.statusText, '正在连接模型与工具');

const approval = store.handleRuntimeEvent({
  type: 'permission_requested',
  taskId: 'task-rain',
  permissionId: 'permission-1',
  toolCall: { title: 'weather-data__read_dataset' },
});
assert.equal(approval.notification.kind, 'approval');
assert.equal(approval.notification.sticky, true);
snapshot = store.snapshot();
assert.equal(snapshot.visualState, 'waiting_approval');
assert.equal(snapshot.counts.waitingApproval, 1);

const resolved = store.handleRuntimeEvent({
  type: 'permission_resolved',
  taskId: 'task-rain',
  permissionId: 'permission-1',
  action: 'approved',
});
assert.equal(resolved.clearNotificationTaskId, 'task-rain');
assert.equal(store.snapshot().primaryTask.state, 'running');

store.handleRuntimeEvent({
  type: 'artifact_created',
  taskId: 'task-rain',
  artifact: {
    id: 'artifact-1',
    title: '强降水风险分析.docx',
    format: 'DOCX',
    createdAt: time,
  },
});
assert.equal(store.snapshot().latestArtifact.title, '强降水风险分析.docx');
assert.equal(store.snapshot().primaryTask.artifactCount, 1);

time += 10;
const completed = store.handleRuntimeEvent({ type: 'turn_completed', taskId: 'task-rain' });
assert.equal(completed.notification.kind, 'completed');
assert.equal(store.snapshot().counts.completedUnread, 1);

// The team terminal event can follow turn_completed; it must not produce a duplicate completion bubble.
time += 10;
const duplicate = store.handleRuntimeEvent({ type: 'team_completed', taskId: 'task-rain' });
assert.equal(duplicate.notification, null);

store.syncSummary({
  activeTaskId: 'task-wind',
  tasks: [
    {
      id: 'task-rain',
      title: '华东强降水过程分析',
      lifecycleState: 'COMPLETED',
      updatedAt: time - 100,
    },
    {
      id: 'task-wind',
      title: '雷暴大风风险巡检',
      lifecycleState: 'RUNNING',
      updatedAt: time,
    },
  ],
});
assert.equal(store.snapshot().primaryTask.id, 'task-wind');

store.handleRuntimeEvent({ type: 'turn_failed', taskId: 'task-rain', message: '资料源暂不可用' });
assert.equal(store.snapshot().primaryTask.id, 'task-rain');
assert.equal(store.snapshot().visualState, 'failed');

store.handleRuntimeEvent({ type: 'permission_requested', taskId: 'task-wind' });
assert.equal(store.snapshot().primaryTask.id, 'task-wind');
assert.equal(store.snapshot().visualState, 'waiting_approval');

store.markRead('task-rain');
assert.equal(store.snapshot().recentTasks.find((task) => task.id === 'task-rain').unread, false);

assert.equal(Companion.normalizeLifecycleState('WAITING_APPROVAL'), 'waiting_approval');
assert.equal(Companion.normalizeLifecycleState('interrupted'), 'partial');
assert.equal(Companion.cleanText('  a\n\tb  ', 20), 'a b');
assert.equal(Companion.safeDisplayLabel('/secret/workspace/report.docx', '新成果物', 72), 'report.docx');

console.log('companion state checks passed');

// Read terminal tasks must not keep the mascot in a permanent failure/completed state.
const lifecycleStore = Companion.createCompanionStateStore({ now: () => ++time });
lifecycleStore.handleRuntimeEvent({ type: 'turn_started', taskId: 'task-a' });
const firstCompletion = lifecycleStore.handleRuntimeEvent({ type: 'turn_completed', taskId: 'task-a' });
assert.equal(firstCompletion.notification.kind, 'completed');
lifecycleStore.markRead('task-a');
assert.equal(lifecycleStore.snapshot().primaryTask, null);
assert.equal(lifecycleStore.snapshot().visualState, 'idle');

// A rerun of the same task is a new lifecycle and must notify again.
lifecycleStore.handleRuntimeEvent({ type: 'turn_started', taskId: 'task-a' });
const secondCompletion = lifecycleStore.handleRuntimeEvent({ type: 'turn_completed', taskId: 'task-a' });
assert.equal(secondCompletion.notification.kind, 'completed');

const priorityStore = Companion.createCompanionStateStore({ now: () => ++time });
priorityStore.handleRuntimeEvent({ type: 'turn_started', taskId: 'running-task' });
priorityStore.handleRuntimeEvent({ type: 'turn_failed', taskId: 'failed-task', message: '数据源失败' });
assert.equal(priorityStore.snapshot().primaryTask.id, 'failed-task');
priorityStore.markRead('failed-task');
assert.equal(priorityStore.snapshot().primaryTask.id, 'running-task');

// Summary-only state recovery must dismiss stale approval/input notifications.
const summaryStore = Companion.createCompanionStateStore({ now: () => ++time });
summaryStore.syncSummary({
  activeTaskId: 'summary-task',
  tasks: [{ id: 'summary-task', title: '会商材料', lifecycleState: 'WAITING_INPUT' }],
});
const resumed = summaryStore.syncSummary({
  activeTaskId: 'summary-task',
  tasks: [{ id: 'summary-task', title: '会商材料', lifecycleState: 'RUNNING' }],
});
assert.equal(resumed.clearNotificationTaskId, 'summary-task');

// Companion snapshots deliberately exclude artifact paths and prompt-like content.
summaryStore.syncSummary({
  latestArtifact: { path: '/secret/workspace/private-forecast.docx', createdAt: ++time },
});
const privacySnapshot = summaryStore.snapshot();
assert.equal(privacySnapshot.latestArtifact.title, '新成果物');
assert.ok(!JSON.stringify(privacySnapshot).includes('/secret/workspace'));

const privateFailure = summaryStore.handleRuntimeEvent({
  type: 'turn_failed',
  taskId: 'private-failure',
  message: "ENOENT: open '/Users/alice/private/forecast.docx' token=sk-live-secret",
});
const privateFailureSnapshot = summaryStore.snapshot();
assert.equal(privateFailure.notification.text.includes('/Users/alice'), false);
assert.equal(privateFailure.notification.text.includes('sk-live-secret'), false);
assert.equal(JSON.stringify(privateFailureSnapshot).includes('/Users/alice'), false);
assert.equal(JSON.stringify(privateFailureSnapshot).includes('sk-live-secret'), false);

summaryStore.handleRuntimeEvent({
  type: 'runtime_status',
  online: true,
  message: "connected with token=sk-runtime-secret at /Users/alice/runtime",
});
summaryStore.handleRuntimeEvent({
  type: 'runtime_progress',
  taskId: 'private-progress',
  stage: 'custom-secret-stage',
  message: "reading /Users/alice/private/input.csv with token=sk-progress-secret",
});
const privateRuntimeSnapshot = JSON.stringify(summaryStore.snapshot());
assert.equal(privateRuntimeSnapshot.includes('/Users/alice'), false);
assert.equal(privateRuntimeSnapshot.includes('sk-runtime-secret'), false);
assert.equal(privateRuntimeSnapshot.includes('sk-progress-secret'), false);

// Initial renderer hydration must not turn historical terminal tasks into fresh notifications.
const hydrationStore = Companion.createCompanionStateStore({ now: () => ++time });
const hydration = hydrationStore.syncSummary({
  activeTaskId: 'historical-complete',
  tasks: [{
    id: 'historical-complete',
    title: '昨日会商材料',
    lifecycleState: 'COMPLETED',
    updatedAt: time - 60_000,
  }],
});
assert.equal(hydration.notification, null);
assert.equal(hydrationStore.snapshot().counts.completedUnread, 0);
assert.equal(hydrationStore.snapshot().primaryTask, null);
assert.equal(hydrationStore.snapshot().recentTasks[0].state, 'completed');
