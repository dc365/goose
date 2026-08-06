const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer-core.js'), 'utf8');

function extractNamedFunction(name, input = source) {
  const start = input.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const bodyStart = input.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < input.length; index += 1) {
    if (input[index] === '{') depth += 1;
    if (input[index] === '}') depth -= 1;
    if (depth === 0) return input.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const task = {
  id: 'task-1',
  status: 'running',
  sessionId: 'session-1',
  fileReferences: ['/current/private.txt'],
  queuedDraftFileReferences: [],
  queuedPrompts: [],
};
const sent = [];
let saveCount = 0;
let renderCount = 0;
let streamPatchCount = 0;
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({
  Date,
  JSON,
  activeTask: task,
  composerImeComposing: false,
  pendingQueuedPromptTaskIds: new Set(),
  pendingStreamCommitTaskIds: new Set(),
  runtimeProgressCommitTimers: new Map(),
  RUNTIME_PROGRESS_COMMIT_INTERVAL_MS: 350,
  progressTimerCalls: 0,
  window: {
    setTimeout() {
      context.progressTimerCalls += 1;
      return context.progressTimerCalls;
    },
  },
  state: {
    activeTaskId: task.id,
    draftFileReferences: [],
    view: 'task',
  },
  getActiveTask() {
    return task;
  },
  saveState() {
    saveCount += 1;
  },
  render() {
    renderCount += 1;
  },
  patchActiveRuntimeMessage() {
    streamPatchCount += 1;
    return true;
  },
  sendTaskMessage(options) {
    sent.push({
      options,
      fileReferences: [...(task.fileReferences || [])],
    });
  },
});

vm.runInContext(
  [
    extractNamedFunction('composerFileReferences'),
    extractNamedFunction('setTaskFileReferences'),
    extractNamedFunction('commitRuntimeStreamNow'),
    extractNamedFunction('flushPendingStreamCommits'),
    extractNamedFunction('scheduleRuntimeProgressCommit'),
    extractNamedFunction('runtimeEventCommitMode'),
    extractNamedFunction('flushQueuedTaskPrompts'),
    extractNamedFunction('flushPendingQueuedTaskPrompts'),
  ].join('\n'),
  context
);

vm.runInContext(`setTaskFileReferences(['/queued/new.txt'])`, context);
assert.equal(task.sessionId, 'session-1');
assert.deepEqual(task.fileReferences, ['/current/private.txt']);
assert.deepEqual(plain(task.queuedDraftFileReferences), ['/queued/new.txt']);

task.status = 'completed';
task.queuedPrompts = [
  { text: 'first', fileReferences: ['/queued/new.txt'] },
  { text: 'second', fileReferences: [] },
];
vm.runInContext(`flushQueuedTaskPrompts('task-1')`, context);
assert.deepEqual(plain(sent.shift()), {
  options: { prompt: 'first', dequeue: true },
  fileReferences: ['/queued/new.txt'],
});

task.status = 'completed';
vm.runInContext(`flushQueuedTaskPrompts('task-1')`, context);
assert.deepEqual(plain(sent.shift()), {
  options: { prompt: 'second', dequeue: true },
  fileReferences: [],
});

task.status = 'completed';
task.queuedPrompts = [{ text: 'after-ime', fileReferences: [] }];
context.composerImeComposing = true;
vm.runInContext(`commitRuntimeStreamNow(activeTask); flushQueuedTaskPrompts('task-1')`, context);
assert.equal(renderCount, 0);
assert.ok(context.pendingStreamCommitTaskIds.has('task-1'));
assert.ok(context.pendingQueuedPromptTaskIds.has('task-1'));
assert.equal(sent.length, 0);

context.composerImeComposing = false;
vm.runInContext(`flushPendingStreamCommits(); flushPendingQueuedTaskPrompts()`, context);
assert.equal(renderCount, 0);
assert.equal(streamPatchCount, 1);
assert.equal(saveCount, 4);
assert.deepEqual(plain(sent.shift()), {
  options: { prompt: 'after-ime', dequeue: true },
  fileReferences: [],
});

assert.equal(vm.runInContext(`runtimeEventCommitMode('evidence_created')`, context), 'progress');
assert.equal(vm.runInContext(`runtimeEventCommitMode('artifact_created')`, context), 'progress');
assert.equal(vm.runInContext(`runtimeEventCommitMode('assistant_message_delta')`, context), 'stream');
assert.equal(vm.runInContext(`runtimeEventCommitMode('team_member_progress')`, context), 'stream');
assert.ok(rendererSource.includes('function patchActiveRuntimeMessage(task)'));
for (let index = 0; index < 100; index += 1) {
  vm.runInContext('scheduleRuntimeProgressCommit(activeTask)', context);
}
assert.equal(context.progressTimerCalls, 1);
assert.equal(context.runtimeProgressCommitTimers.size, 1);

const streamPreviewContext = vm.createContext({});
vm.runInContext(extractNamedFunction('streamingTextPreview', mainSource), streamPreviewContext);
assert.equal(streamPreviewContext.streamingTextPreview('逐字输出', 8), '逐字输出');
assert.equal(
  streamPreviewContext.streamingTextPreview('1234567890', 6),
  '> 较早内容已收起，以下为最新阶段输出。\n\n567890',
);

const teamVisibilityContext = vm.createContext({});
vm.runInContext(
  [
    extractNamedFunction('teamMemberHasEnteredRun', rendererSource),
    extractNamedFunction('teamProcessFeedEntries', rendererSource),
  ].join('\n'),
  teamVisibilityContext,
);
assert.equal(teamVisibilityContext.teamMemberHasEnteredRun({ status: 'pending' }), false);
assert.equal(teamVisibilityContext.teamMemberHasEnteredRun({ status: 'interrupted' }), false);
assert.equal(teamVisibilityContext.teamMemberHasEnteredRun({ status: 'running' }), true);
assert.equal(teamVisibilityContext.teamMemberHasEnteredRun({ status: 'pending', startedAt: 100 }), true);
assert.equal(teamVisibilityContext.teamMemberHasEnteredRun({ status: 'completed' }), true);
assert.deepEqual(
  plain(teamVisibilityContext.teamProcessFeedEntries({
    status: 'completed',
    updates: [
      { id: 'message:0', source: 'message', text: 'Now let me inspect the data', status: 'streaming' },
      { id: 'tool:1', source: 'activity', text: 'weather_get_case', status: 'completed' },
      { id: 'message:1', source: 'message', text: '# 完整报告正文', status: 'completed' },
    ],
  })),
  [
    { id: 'drafting-handoff', source: 'status', text: '已完成阶段分析并提交交接结果。', status: 'completed' },
    { id: 'tool:1', source: 'activity', text: 'weather_get_case', status: 'completed' },
  ],
);
assert.deepEqual(
  plain(teamVisibilityContext.teamProcessFeedEntries({
    status: 'running',
    updates: [
      { id: 'message:0', source: 'message', text: '**阶段一**\n\n正在建立分析基线。', status: 'streaming' },
      { id: 'tool:1', source: 'activity', text: 'weather_get_case', status: 'completed' },
    ],
  })),
  [
    { id: 'message:0', source: 'message', text: '**阶段一**\n\n正在建立分析基线。', status: 'streaming' },
    { id: 'tool:1', source: 'activity', text: 'weather_get_case', status: 'completed' },
  ],
);

const teamTerminalContext = vm.createContext({ Date });
vm.runInContext(
  [
    extractNamedFunction('appendTeamMemberUpdate'),
    extractNamedFunction('teamMemberProgressDisplay'),
    extractNamedFunction('finalizeTeamMemberUpdates'),
    extractNamedFunction('teamMemberAcceptsLiveUpdate'),
    extractNamedFunction('settleTeamRunMembers'),
  ].join('\n'),
  teamTerminalContext,
);
assert.equal(teamTerminalContext.teamMemberAcceptsLiveUpdate({ status: 'failed' }), false);
assert.equal(teamTerminalContext.teamMemberAcceptsLiveUpdate({ status: 'completed' }), false);
assert.equal(teamTerminalContext.teamMemberAcceptsLiveUpdate({ status: 'running' }), true);
assert.deepEqual(plain(teamTerminalContext.teamMemberProgressDisplay({
  progressId: 'message:9',
  source: 'message',
  detail: 'Now let me gather the source data',
})), {
  id: 'message:9',
  source: 'message',
  text: 'Now let me gather the source data',
});
const updateMember = { updates: [] };
teamTerminalContext.appendTeamMemberUpdate(updateMember, {
  id: 'message:0', source: 'message', text: '第一段', status: 'streaming', at: 100,
});
teamTerminalContext.appendTeamMemberUpdate(updateMember, {
  id: 'message:0', source: 'message', text: '第一段继续增长', status: 'streaming', at: 110,
});
teamTerminalContext.appendTeamMemberUpdate(updateMember, {
  id: 'activity:tool-1', source: 'activity', text: 'weather_get_case', status: 'running', at: 120,
});
teamTerminalContext.appendTeamMemberUpdate(updateMember, {
  id: 'message:1', source: 'message', text: '第二段', status: 'streaming', at: 130,
});
teamTerminalContext.appendTeamMemberUpdate(updateMember, {
  id: 'activity:tool-1', source: 'activity', text: 'weather_get_case', status: 'completed', at: 140,
});
assert.deepEqual(plain(updateMember.updates.map((entry) => [entry.id, entry.text, entry.status])), [
  ['message:0', '第一段继续增长', 'completed'],
  ['activity:tool-1', 'weather_get_case', 'completed'],
  ['message:1', '第二段', 'streaming'],
]);
updateMember.activities = [
  { id: 'tool-1', status: 'running', updatedAt: 140 },
  { id: 'tool-2', status: 'completed', updatedAt: 145 },
];
teamTerminalContext.finalizeTeamMemberUpdates(updateMember, 'completed', 150);
assert.equal(updateMember.updates.at(-1).status, 'completed');
assert.deepEqual(plain(updateMember.activities.map((activity) => activity.status)), ['completed', 'completed']);
const failedMember = {
  updates: [{ id: 'message:0', source: 'status', text: '正在分析', status: 'streaming' }],
  activities: [{ id: 'tool-1', status: 'running' }],
};
teamTerminalContext.finalizeTeamMemberUpdates(failedMember, 'failed', 180);
assert.equal(failedMember.updates[0].status, 'failed');
assert.equal(failedMember.activities[0].status, 'failed');
const terminalRun = {
  members: [
    { status: 'running', summary: '已交接', detail: '迟到片段' },
    { status: 'running', error: '工具失败', detail: '迟到片段' },
    { status: 'running', detail: '无终态' },
  ],
};
teamTerminalContext.settleTeamRunMembers(terminalRun, 500);
assert.deepEqual(plain(terminalRun.members.map((member) => member.status)), [
  'completed',
  'failed',
  'interrupted',
]);

const titleContext = vm.createContext({});
vm.runInContext(
  [
    extractNamedFunction('compactTaskTitle'),
    extractNamedFunction('automaticTaskTitle'),
    extractNamedFunction('normalizeAutomaticSessionTitle'),
    extractNamedFunction('applyAutomaticSessionTitle'),
  ].join('\n'),
  titleContext,
);
assert.equal(titleContext.automaticTaskTitle('Analyze the latest NMC 500hPa chart'), '新任务');
assert.equal(titleContext.automaticTaskTitle('分析中央气象台最新 500hPa 图'), '分析中央气象台最新 500hPa 图');
assert.equal(titleContext.normalizeAutomaticSessionTitle('NMC 500hPa Chart Analysis'), '');
assert.equal(titleContext.normalizeAutomaticSessionTitle('中央气象台 500hPa 分析'), '中央气象台 500hPa 分析');
const automaticTitleTask = { title: '新任务', titleMode: 'automatic', messages: [{}, {}] };
assert.equal(titleContext.applyAutomaticSessionTitle(automaticTitleTask, 'NMC Chart Analysis'), false);
assert.equal(automaticTitleTask.title, '新任务');
assert.equal(titleContext.applyAutomaticSessionTitle(automaticTitleTask, '中央气象台形势分析'), true);
assert.equal(automaticTitleTask.title, '中央气象台形势分析');
const manualTitleTask = { title: 'My custom title', titleMode: 'manual', messages: [{}, {}] };
assert.equal(titleContext.applyAutomaticSessionTitle(manualTitleTask, '中央气象台形势分析'), false);
assert.equal(manualTitleTask.title, 'My custom title');
assert.match(mainSource, /自动生成本会话标题时，必须使用简体中文/);
assert.match(source, /task\.titleMode = 'manual'/);

assert.match(
  source,
  /typeof result\.workspace === 'string' && result\.workspace\.trim\(\)\)\s*\{\s*task\.workspace = result\.workspace\.trim\(\)/,
);

console.log('MeteoMate UX regression tests passed');
