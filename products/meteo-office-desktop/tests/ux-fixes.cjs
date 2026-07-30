const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');
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
assert.equal(renderCount, 1);
assert.equal(saveCount, 4);
assert.deepEqual(plain(sent.shift()), {
  options: { prompt: 'after-ime', dequeue: true },
  fileReferences: [],
});

assert.equal(vm.runInContext(`runtimeEventCommitMode('evidence_created')`, context), 'progress');
assert.equal(vm.runInContext(`runtimeEventCommitMode('artifact_created')`, context), 'progress');
assert.equal(vm.runInContext(`runtimeEventCommitMode('assistant_message_delta')`, context), 'stream');
for (let index = 0; index < 100; index += 1) {
  vm.runInContext('scheduleRuntimeProgressCommit(activeTask)', context);
}
assert.equal(context.progressTimerCalls, 1);
assert.equal(context.runtimeProgressCommitTimers.size, 1);

const publicationTask = {
  id: 'publication-task',
  publicationAnalysis: {
    conclusions: [],
  },
  evidence: [],
  artifacts: [
    {
      id: 'forecast-v1',
      name: 'forecast-old.html',
      path: '/workspace/forecast.html',
    },
    {
      id: 'forecast-v2',
      name: 'forecast-current.html',
      path: '/workspace/forecast.html',
    },
  ],
  publication: {
    dirty: false,
    gate: { ready: true, blockers: [], warnings: [], checkedAt: 1234 },
    signoff: { approved: true, reviewerName: '旧签发人' },
  },
};
let appliedServiceArguments = [];
const publicationContext = vm.createContext({
  Date,
  publicationUI: {
    open: true,
    taskId: publicationTask.id,
    busy: '',
    error: '',
  },
  window: {
    MeteoMateHarness: {
      PublicationState: {
        analysisForTask(currentTask) {
          return currentTask.publicationAnalysis;
        },
        cachedRequestMatchesTask(currentTask) {
          return currentTask.publication?.requestFingerprint === 'current';
        },
        currentArtifacts(artifacts) {
          return artifacts.slice(-1);
        },
        applyServiceResult(...args) {
          appliedServiceArguments = args;
        },
        requestMatchesTask() {
          return true;
        },
        evaluate() {
          return {
            ready: false,
            blockers: ['本地预检阻塞项'],
            warnings: [],
            checkedAt: null,
          };
        },
        signable() {
          return false;
        },
      },
    },
  },
  escapeHtml(value) {
    return String(value ?? '');
  },
  formatDateTime(value) {
    return String(value);
  },
  icon(name) {
    return `[${name}]`;
  },
  pathBaseName(value) {
    return String(value).split('/').at(-1);
  },
});
vm.runInContext(
  [
    extractNamedFunction('publicationGateForTask', rendererSource),
    extractNamedFunction('renderPublicationEvidence', rendererSource),
    extractNamedFunction('renderTaskPublicationPanel', rendererSource),
    extractNamedFunction('applyPublicationResult'),
  ].join('\n'),
  publicationContext,
);
publicationContext.publicationTask = publicationTask;
const stalePublicationHtml = vm.runInContext(
  'renderTaskPublicationPanel(publicationTask)',
  publicationContext,
);
assert.match(stalePublicationHtml, /本地预检查，签发前需正式检查/);
assert.match(stalePublicationHtml, /请重新运行发布检查/);
assert.match(stalePublicationHtml, /forecast-current\.html/);
assert.doesNotMatch(stalePublicationHtml, /forecast-old\.html/);
assert.doesNotMatch(stalePublicationHtml, /已签发/);
assert.doesNotMatch(stalePublicationHtml, /旧签发人/);

publicationTask.publication.requestFingerprint = 'current';
const currentPublicationHtml = vm.runInContext(
  'renderTaskPublicationPanel(publicationTask)',
  publicationContext,
);
assert.match(currentPublicationHtml, /已签发/);
assert.match(currentPublicationHtml, /旧签发人/);
publicationTask.publication.gate = {
  ready: false,
  blockers: ['签发后的输入已经变化'],
  warnings: [],
  checkedAt: 2345,
};
const changedSignedPublicationHtml = vm.runInContext(
  'renderTaskPublicationPanel(publicationTask)',
  publicationContext,
);
assert.match(changedSignedPublicationHtml, /data-publication-revoke/);
const publicationRequest = { taskId: publicationTask.id };
const publicationResult = { gate: publicationTask.publication.gate };
publicationContext.publicationRequest = publicationRequest;
publicationContext.publicationResult = publicationResult;
assert.equal(
  vm.runInContext(
    'applyPublicationResult(publicationTask, publicationRequest, publicationResult)',
    publicationContext,
  ),
  true,
);
assert.equal(appliedServiceArguments[0], publicationTask);
assert.equal(appliedServiceArguments[1], publicationRequest);
assert.equal(appliedServiceArguments[2], publicationResult);
assert.match(
  source,
  /typeof result\.workspace === 'string' && result\.workspace\.trim\(\)\)\s*\{\s*task\.workspace = result\.workspace\.trim\(\)/,
);

console.log('MeteoMate UX regression tests passed');
