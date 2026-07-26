const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');

function extractNamedFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
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

console.log('MeteoMate UX regression tests passed');
