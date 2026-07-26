const assert = require('node:assert/strict');

const Workflow = require('../harness/workflow');
const Automation = require('../harness/automation');
const ExpertTeam = require('../harness/expert-team');
const CapabilityResolver = require('../harness/capability-resolver');
const ContextCompiler = require('../harness/context-compiler');
const WorkflowIo = require('../capabilities/workflow-io.cjs');

const template = Workflow.createHeavyRainTemplate();
const validation = Workflow.validateWorkflow(template);
assert.equal(validation.valid, true);
assert.equal(validation.definition.spec.nodes.length, 9);
assert.ok(Workflow.executionWaves(template).some((wave) => wave.length === 2));

const published = Workflow.publishWorkflow(template, {
  now: 1_700_000_000_000,
  version: '1.0.0',
});
assert.equal(published.metadata.status, 'published');
assert.equal(published.metadata.version, '1.0.0');
assert.ok(published.digest);

const structuralRun = Workflow.createStructuralRun(published, {
  id: 'workflow-run-test',
  startedAt: 1_700_000_000_100,
});
assert.equal(structuralRun.status, 'waiting_approval');
assert.equal(
  structuralRun.nodeRuns.find((nodeRun) => nodeRun.nodeId === 'approval').status,
  'waiting_approval',
);
assert.equal(
  structuralRun.nodeRuns.find((nodeRun) => nodeRun.nodeId === 'report').status,
  'pending',
);
Workflow.resolveStructuralApproval(published, structuralRun, {
  approved: true,
  at: 1_700_000_000_200,
});
assert.equal(structuralRun.status, 'completed');

const sequentialApprovals = Workflow.normalizeWorkflow({
  metadata: { id: 'sequential-approvals', name: '连续审批', version: '1.0.0' },
  spec: {
    nodes: [
      { id: 'input', type: 'input', name: '输入' },
      { id: 'approval-one', type: 'approval', name: '一审' },
      { id: 'approval-two', type: 'approval', name: '二审' },
      { id: 'output', type: 'output', name: '输出' },
    ],
    edges: [
      { from: 'input.success', to: 'approval-one.input' },
      { from: 'approval-one.approved', to: 'approval-two.input' },
      { from: 'approval-two.approved', to: 'output.input' },
    ],
  },
});
const sequentialRun = Workflow.createStructuralRun(sequentialApprovals, { startedAt: 100 });
assert.equal(sequentialRun.status, 'waiting_approval');
assert.equal(sequentialRun.nodeRuns.find((node) => node.nodeId === 'approval-one').status, 'waiting_approval');
Workflow.resolveStructuralApproval(sequentialApprovals, sequentialRun, { approved: true, at: 200 });
assert.equal(sequentialRun.status, 'waiting_approval');
assert.equal(sequentialRun.nodeRuns.find((node) => node.nodeId === 'approval-two').status, 'waiting_approval');
Workflow.resolveStructuralApproval(sequentialApprovals, sequentialRun, { approved: true, at: 300 });
assert.equal(sequentialRun.status, 'completed');

const rejectionBranch = Workflow.normalizeWorkflow({
  metadata: { id: 'rejection-branch', name: '驳回分支', version: '1.0.0' },
  spec: {
    nodes: [
      { id: 'input', type: 'input', name: '输入' },
      { id: 'approval', type: 'approval', name: '审批' },
      { id: 'delivery', type: 'template', name: '正式交付' },
      { id: 'revision', type: 'template', name: '退回修改' },
      { id: 'output', type: 'output', name: '输出' },
    ],
    edges: [
      { from: 'input.success', to: 'approval.input' },
      { from: 'approval.approved', to: 'delivery.input' },
      { from: 'approval.rejected', to: 'revision.input' },
      { from: 'delivery.success', to: 'output.input' },
      { from: 'revision.success', to: 'output.input' },
    ],
  },
});
const rejectionRun = Workflow.createStructuralRun(rejectionBranch, { startedAt: 400 });
Workflow.resolveStructuralApproval(rejectionBranch, rejectionRun, { approved: false, at: 500 });
assert.equal(rejectionRun.status, 'completed');
assert.equal(rejectionRun.nodeRuns.find((node) => node.nodeId === 'delivery').status, 'skipped');
assert.equal(rejectionRun.nodeRuns.find((node) => node.nodeId === 'revision').status, 'completed');

const movedPublished = Workflow.normalizeWorkflow({
  ...published,
  metadata: { ...published.metadata, status: 'draft', revision: 99 },
  spec: {
    ...published.spec,
    nodes: published.spec.nodes.map((node, index) => ({
      ...node,
      position: { x: index * 13, y: index * 17 },
    })),
  },
});
assert.equal(movedPublished.digest, published.digest);

const disconnected = Workflow.normalizeWorkflow({
  ...template,
  spec: {
    ...template.spec,
    nodes: [...template.spec.nodes, { id: 'orphan', type: 'transform', name: '孤立节点' }],
  },
});
assert.equal(Workflow.validateWorkflow(disconnected).valid, false);
assert.ok(Workflow.validateWorkflow(disconnected).errors.some((error) => error.includes('无法从入口到达')));

const unknownNodeType = Workflow.normalizeWorkflow({
  ...template,
  spec: {
    ...template.spec,
    nodes: template.spec.nodes.map((node, index) =>
      index === 1 ? { ...node, type: 'made-up-node' } : node
    ),
  },
});
assert.ok(Workflow.validateWorkflow(unknownNodeType).errors.some((error) => error.includes('类型不受支持')));

const withoutOutput = Workflow.normalizeWorkflow({
  ...template,
  spec: {
    ...template.spec,
    nodes: template.spec.nodes.filter((node) => node.type !== 'output'),
    edges: template.spec.edges.filter((edge) => edge.to.nodeId !== 'output'),
  },
});
assert.ok(Workflow.validateWorkflow(withoutOutput).errors.some((error) => error.includes('Output')));

const team = {
  id: 'review-team',
  kind: 'team',
  name: '研判团队',
  nodes: [
    { id: 'analysis', expert: 'synoptic-expert', dependsOn: [] },
    { id: 'review', expert: 'writing-expert', dependsOn: ['analysis'] },
  ],
};
const teamWorkflow = ExpertTeam.toWorkflowDefinition(team);
assert.equal(Workflow.validateWorkflow(teamWorkflow).valid, true);
assert.match(teamWorkflow.spec.nodes.at(-1).outputs.summary, /nodes\.review\.outputs\.result/);
assert.doesNotMatch(teamWorkflow.spec.nodes.at(-1).outputs.summary, /team-output/);

const automation = Automation.normalizeAutomation({
  id: 'daily-product',
  name: '每日产品',
  projectId: 'project-1',
  workflowRef: { id: published.metadata.id, version: published.metadata.version },
  taskTemplate: {
    prompt: '生成今日强降水产品',
    expertId: 'heavy-rain-expert',
    permissionProfileId: 'artifact-approval',
  },
  trigger: { mode: 'recurring', cadence: 'daily', time: '07:30' },
}, { now: 1_700_000_000_000 });
assert.equal(
  Automation.workflowCapabilityReference(automation),
  `${published.metadata.id}@${published.metadata.version}`,
);
assert.equal(Workflow.validateWorkflow(Automation.toWorkflowDefinition(automation)).valid, true);

const expert = {
  id: 'heavy-rain-expert',
  requiredWorkflows: [`${published.metadata.id}@${published.metadata.version}`],
};
const workflowExperts = ['data-expert', 'synoptic-expert', 'heavy-rain-expert', 'convection-expert', 'writing-expert']
  .map((id) => id === expert.id ? expert : { id });
const workflowConnectors = [{
  id: 'office-artifacts',
  status: 'connected',
  tools: [{ name: 'artifact_create' }],
}];
const project = {
  id: 'project-1',
  name: '短临业务',
  spec: {
    capabilities: {
      experts: [expert.id],
      skills: [],
      workflows: [],
      connectors: [],
    },
  },
};
const resolved = CapabilityResolver.resolveCapabilities({
  project,
  expert,
  task: {},
  catalog: {
    workflows: [published],
    experts: workflowExperts,
    connectors: workflowConnectors,
  },
});
assert.equal(resolved.ready, true);
assert.deepEqual(resolved.workflows.map((workflow) => workflow.id), [published.metadata.id]);
assert.deepEqual(resolved.toolSelections['office-artifacts'], ['artifact_create']);
assert.deepEqual(resolved.workflowPermissionProfiles, ['artifact-approval']);

const missingWorkflowConnector = CapabilityResolver.resolveCapabilities({
  project,
  expert,
  task: {},
  catalog: { workflows: [published], experts: workflowExperts, connectors: [] },
});
assert.equal(missingWorkflowConnector.ready, false);
assert.ok(missingWorkflowConnector.missing.some((item) =>
  item.type === 'connector' && item.id === 'office-artifacts'
));

const missing = CapabilityResolver.resolveCapabilities({
  project,
  expert,
  task: {},
  catalog: { workflows: [] },
});
assert.equal(missing.ready, false);
assert.equal(missing.missing[0].type, 'workflow');

const snapshot = ContextCompiler.compileTaskContext({
  task: {
    id: 'task-1',
    workflowIds: [`${published.metadata.id}@1.0.0`],
    permissionProfileId: 'workspace-approval',
  },
  project,
  expert,
  catalog: {
    workflows: [published],
    experts: workflowExperts,
    connectors: workflowConnectors,
    permissionProfiles: {},
  },
  clock: class FixedClock extends Date {
    constructor() {
      super(1_700_000_000_000);
    }
  },
});
assert.deepEqual(ContextCompiler.runtimeEnvelope(snapshot).capabilities.workflows, [{
  id: published.metadata.id,
  version: '1.0.0',
  digest: published.digest,
  role: 'selected',
}]);
assert.equal(snapshot.permissionPolicy.requestedId, 'workspace-approval');
assert.equal(snapshot.permissionPolicy.id, 'artifact-approval');

const child = Workflow.publishWorkflow(Workflow.normalizeWorkflow({
  metadata: { id: 'published-child', name: '已发布子流程', version: '1.0.0' },
  spec: {
    nodes: [
      { id: 'input', type: 'input', name: '输入' },
      { id: 'output', type: 'output', name: '输出' },
    ],
    edges: [{ from: 'input.success', to: 'output.input' }],
  },
}), { version: '1.0.0' });
const parentWithUnfixedChild = Workflow.normalizeWorkflow({
  metadata: { id: 'parent-workflow', name: '父流程', version: '1.0.0' },
  spec: {
    nodes: [
      { id: 'input', type: 'input', name: '输入' },
      {
        id: 'child',
        type: 'workflow',
        name: '子流程',
        capability: { kind: 'Workflow', id: child.metadata.id },
      },
      { id: 'output', type: 'output', name: '输出' },
    ],
    edges: [
      { from: 'input.success', to: 'child.input' },
      { from: 'child.success', to: 'output.input' },
    ],
  },
});
assert.ok(Workflow.validateWorkflow(parentWithUnfixedChild, { catalog: [child] }).errors
  .some((error) => error.includes('必须固定发布版本')));

const serialized = WorkflowIo.serializeWorkflowYaml(published);
assert.equal(WorkflowIo.parseWorkflowYaml(serialized).digest, published.digest);
assert.throws(
  () => WorkflowIo.parseWorkflowYaml(serialized.replace('metadata:', 'metadata: &元数据')),
  /不支持锚点/
);
assert.throws(
  () => WorkflowIo.parseWorkflowYaml(`${serialized}\nunexpected: true\n`),
  /不符合 v1alpha1 契约/
);
const httpWorkflow = Workflow.publishWorkflow(Workflow.normalizeWorkflow({
  metadata: { id: 'http-secret-check', name: 'HTTP 凭据检查', version: '1.0.0' },
  spec: {
    nodes: [
      { id: 'input', type: 'input', name: '输入' },
      {
        id: 'http',
        type: 'http',
        name: 'HTTP',
        config: {
          method: 'GET',
          url: 'https://example.com',
          headers: '{"Authorization":"Bearer plaintext"}',
        },
      },
      { id: 'output', type: 'output', name: '输出' },
    ],
    edges: [
      { from: 'input.success', to: 'http.input' },
      { from: 'http.success', to: 'output.input' },
    ],
  },
}), { version: '1.0.0' });
assert.throws(() => WorkflowIo.serializeWorkflowYaml(httpWorkflow), /疑似明文凭据/);

console.log('MeteoMate workflow contracts passed.');
