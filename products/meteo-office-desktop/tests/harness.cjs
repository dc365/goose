const assert = require('node:assert/strict');

const Shared = require('../harness/shared');
const Project = require('../harness/project');
const TaskStateMachine = require('../harness/task-state-machine');
const CapabilityResolver = require('../harness/capability-resolver');
const PolicyEngine = require('../harness/policy-engine');
const ContextCompiler = require('../harness/context-compiler');
const EventNormalizer = require('../harness/event-normalizer');
const ArtifactRegistry = require('../harness/artifact-registry');
const EvidenceLedger = require('../harness/evidence-ledger');
const ValidationEngine = require('../harness/validation-engine');
const StateStore = require('../harness/state-store');

function createDefaultPlan() {
  return [
    { id: 'prepare', title: '准备', status: 'pending' },
    { id: 'analyze', title: '分析', status: 'pending' },
    { id: 'deliver', title: '交付', status: 'pending' },
  ];
}

const catalog = {
  experts: [{ id: 'synoptic-expert', name: '天气形势分析专家', instruction: '基于证据分析天气形势。' }],
  skills: [
    { id: 'synoptic-analysis', name: '天气形势分析', version: '1.2.0', requires: { connectors: ['weather-data'] } },
  ],
  connectors: [
    { id: 'weather-data', name: '气象数据中心', version: '1.0.0' },
    { id: 'artifact-docx', name: 'Word 成果物', version: '1.0.0' },
  ],
  permissionProfiles: {
    'artifact-approval': {
      id: 'artifact-approval',
      name: '成果物审批',
      filesystem: { read: 'workspace', write: 'approval' },
      shell: false,
      network: 'connector-only',
      publish: 'approval',
    },
  },
};

const project = Project.normalizeProject({
  id: 'south-china-heavy-rain',
  name: '华南强降水业务',
  workspace: '/data/heavy-rain',
  instructions: ['所有时次使用北京时间'],
  skillIds: ['synoptic-analysis@1.2.0'],
  connectorIds: ['artifact-docx'],
  meteorologicalContext: {
    region: '华南',
    defaultModels: ['ECMWF'],
    defaultForecastHours: [24, 48, 72],
  },
  policies: {
    defaultWorkMode: 'execute',
    defaultPermissionProfileId: 'artifact-approval',
  },
});

assert.equal(project.kind, 'Project');
assert.equal(project.spec.meteorologicalContext.timezone, 'Asia/Shanghai');
assert.deepEqual(project.spec.capabilities.skills, ['synoptic-analysis@1.2.0']);
assert.equal(project.spec.workspaces[0].root, '/data/heavy-rain');

const expert = {
  id: 'synoptic-expert',
  name: '天气形势分析专家',
  version: '1.0.0',
  instruction: '基于结构化气象事实和证据分析天气形势。',
  requiredSkills: ['synoptic-analysis@1.2.0'],
  requiredConnectors: ['weather-data'],
  recommendedConnectors: ['artifact-docx'],
  defaultWorkMode: 'execute',
  permissionProfile: 'artifact-approval',
};

const task = TaskStateMachine.normalizeTask({
  id: 'task-001',
  title: '未来三天形势分析',
  status: 'draft',
  projectId: project.id,
  expertId: expert.id,
  permissionProfileId: 'artifact-approval',
  providerId: 'openai',
  modelId: 'gpt-test',
  workspace: project.workspace,
  messages: [{ id: 'm1', role: 'user', text: '分析未来三天华南天气形势。' }],
});

const capabilities = CapabilityResolver.resolveCapabilities({ project, expert, task, catalog });
assert.equal(capabilities.ready, true);
assert.deepEqual(capabilities.skills.map((item) => item.id), ['synoptic-analysis']);
assert.deepEqual(capabilities.connectors.map((item) => item.id).sort(), ['artifact-docx', 'weather-data']);

const snapshot = ContextCompiler.compileTaskContext({ task, project, expert, catalog });
assert.equal(snapshot.kind, 'TaskContextSnapshot');
assert.ok(snapshot.id.startsWith('ctx-'));
assert.equal(snapshot.task.workMode, 'execute');
assert.equal(snapshot.permissionPolicy.id, 'artifact-approval');
assert.equal(snapshot.meteorologicalContext.region, '华南');
assert.ok(Object.isFrozen(snapshot));
snapshot.task.title = '被修改';
assert.notEqual(snapshot.task.title, '被修改');

const snapshotAgain = ContextCompiler.compileTaskContext({ task, project, expert, catalog });
assert.notEqual(snapshot.compiledAt, undefined);
assert.equal(snapshot.project.hash, snapshotAgain.project.hash);
assert.equal(ContextCompiler.runtimeEnvelope(snapshot).contextSnapshotId, snapshot.id);

const policy = PolicyEngine.resolvePolicy({ project, expert, task, permissionProfiles: catalog.permissionProfiles });
assert.equal(PolicyEngine.authorize({ kind: 'read' }, policy, { insideWorkspace: true }).decision, 'allow');
assert.equal(PolicyEngine.authorize({ kind: 'write' }, policy, { insideWorkspace: true }).decision, 'approval');
assert.equal(PolicyEngine.authorize({ kind: 'shell' }, policy, { insideWorkspace: true }).decision, 'deny');

const attempt = TaskStateMachine.beginRunAttempt(task, { contextSnapshotId: snapshot.id, runtime: 'goose-acp' });
assert.equal(task.lifecycleState, 'RUNNING');
TaskStateMachine.finishRunAttempt(task, attempt.id, 'completed');
assert.equal(task.lifecycleState, 'COMPLETED');
assert.equal(task.runAttempts[0].status, 'completed');

const normalizedEvent = EventNormalizer.normalizeRuntimeEvent({
  type: 'tool_call_started',
  taskId: task.id,
  toolCallId: 'tool-1',
});
assert.equal(normalizedEvent.type, 'tool.started');
assert.equal(normalizedEvent.taskId, task.id);

const evidence = EvidenceLedger.registerEvidence(task, {
  id: 'ev-001',
  source: 'ECMWF',
  model: 'IFS',
  initTime: '2026-07-15T00:00:00Z',
  validTime: '2026-07-16T00:00:00Z',
  forecastHour: 24,
  region: '华南',
  variable: 'total_precipitation',
  unit: 'mm',
  value: 128.4,
  confidence: 0.84,
});
assert.equal(evidence.lineage.taskId, task.id);
assert.equal(EvidenceLedger.validateEvidence(evidence).valid, true);

const artifact = ArtifactRegistry.registerArtifact(task, {
  id: 'artifact-001',
  name: '天气形势分析.docx',
  path: '/data/heavy-rain/reports/天气形势分析.docx',
  type: 'docx',
  status: 'validated',
}, { evidenceIds: [evidence.id], expertId: expert.id });
assert.equal(artifact.lineage.contextSnapshotId, task.contextSnapshotId);
assert.equal(ArtifactRegistry.validateArtifact(artifact).valid, true);

const analysis = {
  region: '华南',
  issueTime: '2026-07-15T17:00:00+08:00',
  validPeriod: { start: '2026-07-15T20:00:00+08:00', end: '2026-07-18T20:00:00+08:00' },
  conclusions: [{ text: '粤西存在强降水风险。', evidenceIds: [evidence.id] }],
};
const gate = ValidationEngine.runPublicationGate({
  analysis,
  artifacts: [artifact],
  evidence: [evidence],
  humanSignoff: { approved: true, userId: 'forecaster-01' },
});
assert.equal(gate.ready, true);
assert.equal(gate.status, 'ready');

const legacy = {
  workspace: '/legacy/project',
  tasks: [{
    id: 'legacy-task',
    title: '旧任务',
    prompt: '旧问题',
    output: '旧回答',
    status: 'running',
    createdAt: 1000,
    updatedAt: 2000,
  }],
};
const migrated = StateStore.migrateLegacyState(legacy, {
  initialState: { runtime: {}, projects: [], tasks: [] },
  catalog,
  createDefaultPlan,
  createId: () => 'project-legacy',
  pathBaseName: () => 'legacy',
});
assert.equal(migrated.tasks[0].status, 'interrupted');
assert.equal(migrated.tasks[0].messages.length, 2);
assert.equal(migrated.tasks[0].messages[1].processPlan.length, 3);
assert.equal(migrated.projects[0].kind, 'Project');

const stored = {
  runtime: { state: 'ready' },
  projects: [{ id: 'p1', name: 'P1', workspace: '/p1' }],
  tasks: [{
    id: 't1',
    title: 'T1',
    status: 'completed',
    messages: [{
      id: 'a1',
      role: 'assistant',
      text: 'done',
      status: 'completed',
      processPlan: [{ id: 'custom', title: '自定义步骤', status: 'completed' }],
    }],
  }],
};
const normalizedState = StateStore.normalizeStoredState(stored, {
  initialState: { runtime: { state: 'starting' }, projects: [], tasks: [] },
  createDefaultPlan,
});
assert.equal(normalizedState.runtime.state, 'starting');
assert.equal(normalizedState.tasks[0].messages[0].processPlan[0].title, '自定义步骤');
assert.equal(normalizedState.tasks[0].lifecycleState, 'COMPLETED');

assert.equal(Shared.contentHash({ b: 2, a: 1 }), Shared.contentHash({ a: 1, b: 2 }));
console.log('MeteoMate harness tests passed.');
