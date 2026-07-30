const assert = require('node:assert/strict');

const Shared = require('../harness/shared');
const ContextWindow = require('../harness/context-window');
const Project = require('../harness/project');
const Automation = require('../harness/automation');
const TaskStateMachine = require('../harness/task-state-machine');
const CapabilityResolver = require('../harness/capability-resolver');
const PolicyEngine = require('../harness/policy-engine');
const ContextCompiler = require('../harness/context-compiler');
const EventNormalizer = require('../harness/event-normalizer');
const ArtifactRegistry = require('../harness/artifact-registry');
const EvidenceLedger = require('../harness/evidence-ledger');
const RuntimeRecords = require('../harness/runtime-records');
const ValidationEngine = require('../harness/validation-engine');
const PublicationState = require('../harness/publication-state');
const StateStore = require('../harness/state-store');

function createDefaultPlan() {
  return [
    { id: 'prepare', title: '准备', status: 'pending' },
    { id: 'analyze', title: '分析', status: 'pending' },
    { id: 'deliver', title: '交付', status: 'pending' },
  ];
}

const normalContext = ContextWindow.contextStatus({
  usage: { used: 64_000, contextLimit: 128_000 },
});
assert.equal(normalContext.percent, 50);
assert.equal(normalContext.tone, 'normal');
assert.equal(normalContext.remaining, 64_000);

const warningContext = ContextWindow.contextStatus({
  usage: { used: 92_000, size: 128_000 },
});
assert.equal(warningContext.tone, 'warning');
assert.equal(warningContext.shouldCompact, false);

const compactContext = ContextWindow.contextStatus({
  usage: { used: 103_000, size: 128_000 },
  contextState: { phase: 'compacting' },
});
assert.equal(compactContext.tone, 'active');
assert.equal(compactContext.shouldCompact, true);
assert.equal(ContextWindow.contextStatus({ contextState: { phase: 'compacted' } }).tone, 'success');
assert.deepEqual(
  ContextWindow.compactionStatus({
    sessionUpdate: 'status_message',
    status: { type: 'notice', message: 'Compaction complete' },
  }),
  { phase: 'compacted', message: 'Compaction complete' }
);
assert.deepEqual(
  ContextWindow.mergeUsage(
    { used: 12_000, accumulatedInputTokens: 30_000 },
    { used: 14_000, size: 128_000 }
  ),
  { used: 14_000, accumulatedInputTokens: 30_000, size: 128_000 }
);

const catalog = {
  experts: [{ id: 'synoptic-expert', name: '天气形势分析专家', instruction: '基于证据分析天气形势。' }],
  skills: [
    { id: 'synoptic-analysis', name: '天气形势分析', version: '1.2.0', requires: { connectors: ['weather-data'] } },
  ],
  connectors: [
    { id: 'weather-data', name: '气象数据中心', version: '1.0.0' },
    { id: 'artifact-docx', name: 'Word 成果物', version: '1.0.0' },
    { id: 'cua-desktop', name: '桌面应用操作', version: '1.0.0', status: 'connected' },
    { id: 'playwright-browser', name: '浏览器操作', version: '1.0.0', status: 'available' },
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
  toolSelections: { 'artifact-docx': ['create_document'] },
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
assert.deepEqual(project.spec.capabilities.toolSelections, { 'artifact-docx': ['create_document'] });
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

const runtimeEvidence = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'evidence_created',
  runtime: 'acp',
  runId: 'run-from-event',
  toolCallId: 'tool-weather-1',
  evidence: {
    id: 'evidence-runtime-1',
    source: 'weather-provider',
    sourceVersion: 'fixture-v1',
    evidenceType: 'meteorological-fact',
    variable: 'rain24h',
    unit: 'mm',
    value: 86,
    validTime: '2026-07-30T08:00:00.000Z',
  },
}, { runId: 'run-runtime-fallback' }, { responseId: 'response-runtime-1' });
assert.equal(runtimeEvidence.evidence.id, 'evidence-runtime-1');
assert.equal(runtimeEvidence.evidence.lineage.taskId, task.id);
assert.equal(runtimeEvidence.evidence.lineage.runId, 'run-from-event');
assert.equal(runtimeEvidence.evidence.lineage.toolCallId, 'tool-weather-1');
assert.equal(runtimeEvidence.responseId, 'response-runtime-1');
assert.equal(Object.hasOwn(runtimeEvidence.evidence.metadata, 'responseId'), false);
assert.equal(runtimeEvidence.evidenceChanged, true);
assert.equal(task.evidence.length, 1);
assert.equal(task.harnessEvents.at(-1).type, 'evidence.created');

RuntimeRecords.recordRuntimeEvent(task, {
  type: 'evidence_created',
  toolCallId: 'tool-weather-1',
  evidence: {
    id: 'evidence-runtime-1',
    source: 'weather-provider',
    variable: 'rain24h',
    unit: 'mm',
    value: 86,
  },
}, { runId: 'run-runtime-1' });
assert.equal(task.evidence.length, 1);
assert.equal(Object.hasOwn(task.evidence[0].metadata, 'responseId'), false);

const runtimeArtifact = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'artifact_created',
  toolCallId: 'tool-map-1',
  artifact: {
    id: 'artifact-runtime-1',
    name: 'risk-map.html',
    path: '/data/heavy-rain/artifacts/risk-map.html',
    mediaType: 'text/html',
    status: 'ready',
    contentHash: 'a'.repeat(64),
  },
}, { runId: 'run-runtime-1' });
assert.equal(runtimeArtifact.artifact.id, 'artifact-runtime-1');
assert.equal(runtimeArtifact.artifact.lineage.runId, 'run-runtime-1');
assert.equal(task.artifacts.length, 1);
const artifactUpdatedAt = runtimeArtifact.artifact.updatedAt;
const duplicateRuntimeArtifact = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'artifact_created',
  toolCallId: 'tool-map-1',
  artifact: {
    id: 'artifact-runtime-1',
    name: 'risk-map.html',
    path: '/data/heavy-rain/artifacts/risk-map.html',
    mediaType: 'text/html',
    status: 'ready',
    contentHash: 'a'.repeat(64),
  },
}, { runId: 'run-runtime-1' });
assert.equal(duplicateRuntimeArtifact.artifactChanged, false);
assert.equal(duplicateRuntimeArtifact.artifact.updatedAt, artifactUpdatedAt);
assert.equal(task.artifacts.length, 1);
assert.equal(
  ArtifactRegistry.createArtifact(runtimeArtifact.artifact).lineage.runId,
  'run-runtime-1'
);
assert.equal(
  EvidenceLedger.createEvidence(runtimeEvidence.evidence).lineage.toolCallId,
  'tool-weather-1'
);

const incompletePublicationGate = PublicationState.evaluate(task, null, Date.parse('2026-07-30T09:00:00.000Z'));
assert.ok(incompletePublicationGate.blockers.includes('缺少预报结论'));
assert.equal(PublicationState.signable(incompletePublicationGate), false);

task.publicationAnalysis = {
  region: '华南',
  issueTime: '2026-07-30T08:00:00.000Z',
  validPeriod: '2026-07-30T08:00:00.000Z/2026-07-31T08:00:00.000Z',
  conclusions: [{ text: '粤西存在强降水风险。', evidenceIds: ['evidence-runtime-1'] }],
};
EvidenceLedger.registerEvidence(task, {
  id: 'evidence-unreferenced-demo',
  source: 'fixture-weather-provider',
  sourceVersion: 'fixture-v1',
  evidenceType: 'meteorological-fact',
  variable: 'rain24h',
  unit: 'mm',
  value: 120,
  validTime: '2026-07-29T08:00:00.000Z',
  expiresAt: '2026-07-29T20:00:00.000Z',
  metadata: {
    classification: 'demo',
    synthetic: true,
  },
});
assert.deepEqual(
  PublicationState.normalizeAnalysis({
    region: ' 华南 ',
    forecastConclusions: [{ title: '强降水风险', evidence_ids: ['evidence-runtime-1', 'evidence-runtime-1'] }],
  }).conclusions,
  [{ text: '强降水风险', evidenceIds: ['evidence-runtime-1'] }]
);
assert.equal(
  PublicationState.normalizeValidPeriod({
    start: '2026-07-30T08:00:00+08:00',
    end: '2026-07-31T08:00:00+08:00',
  }),
  '2026-07-30T08:00:00+08:00/2026-07-31T08:00:00+08:00'
);
const signablePublicationGate = PublicationState.evaluate(task, null, Date.parse('2026-07-30T09:00:00.000Z'));
assert.deepEqual(signablePublicationGate.blockers, [PublicationState.SIGNOFF_BLOCKER]);
assert.equal(PublicationState.signable(signablePublicationGate), true);
const advisoryEvidenceGate = ValidationEngine.runPublicationGate({
  analysis: task.publicationAnalysis,
  artifacts: task.artifacts,
  evidence: task.evidence,
  at: Date.parse('2026-07-30T09:00:00.000Z'),
});
assert.deepEqual(advisoryEvidenceGate.blockers, [PublicationState.SIGNOFF_BLOCKER]);
assert.ok(advisoryEvidenceGate.warnings.some((warning) =>
  warning.includes('evidence-unreferenced-demo') && warning.includes('synthetic')
));
assert.ok(advisoryEvidenceGate.warnings.some((warning) =>
  warning.includes('evidence-unreferenced-demo') && warning.includes('expired')
));
const missingReferencedEvidenceGate = ValidationEngine.runPublicationGate({
  analysis: {
    ...task.publicationAnalysis,
    conclusions: [{ text: '缺少引用记录。', evidenceIds: ['evidence-missing'] }],
  },
  artifacts: task.artifacts,
  evidence: task.evidence,
  at: Date.parse('2026-07-30T09:00:00.000Z'),
});
assert.ok(missingReferencedEvidenceGate.blockers.includes('引用了不存在的证据：evidence-missing'));
const blankConclusionGate = ValidationEngine.runPublicationGate({
  analysis: {
    ...task.publicationAnalysis,
    conclusions: [{ text: ' ', evidenceIds: ['evidence-runtime-1'] }],
  },
  artifacts: task.artifacts,
  evidence: task.evidence,
  at: Date.parse('2026-07-30T09:00:00.000Z'),
});
assert.ok(blankConclusionGate.blockers.includes('预报结论缺少内容'));
const publicationRequest = PublicationState.requestForTask(task);
assert.equal(publicationRequest.taskId, task.id);
assert.equal(publicationRequest.workspace, task.workspace);
assert.equal(publicationRequest.evidence.length, 1);
assert.equal(publicationRequest.evidence[0].id, 'evidence-runtime-1');
assert.equal(publicationRequest.artifacts.length, 1);
assert.deepEqual(publicationRequest.analysis.conclusions[0].evidenceIds, ['evidence-runtime-1']);
assert.equal(PublicationState.requestMatchesTask(task, publicationRequest), true);
assert.equal(PublicationState.requestMatchesTask(task, {
  ...publicationRequest,
  workspace: '/data/another-workspace',
}), false);

const approvedPublication = PublicationState.applyServiceResult(task, publicationRequest, {
  signoff: { approved: true, reviewerName: '测试预报员' },
  gate: { ready: true, checkedAt: 1234 },
});
assert.equal(approvedPublication.signoff.reviewerName, '测试预报员');
assert.equal(approvedPublication.checkedAt, 1234);
assert.equal(approvedPublication.error, null);
assert.equal(approvedPublication.dirty, false);
assert.equal(
  approvedPublication.requestFingerprint,
  PublicationState.requestFingerprint(publicationRequest),
);
assert.equal(PublicationState.cachedRequestMatchesTask(task), true);
const legacyCachedTask = {
  ...task,
  publication: { ...task.publication },
};
delete legacyCachedTask.publication.requestFingerprint;
assert.equal(PublicationState.cachedRequestMatchesTask(legacyCachedTask), false);
PublicationState.applyError(task, new Error('发布检查失败'));
assert.equal(task.publication.error, '发布检查失败');
PublicationState.updateAnalysis(task, {
  ...task.publicationAnalysis,
  conclusions: [...task.publicationAnalysis.conclusions, {
    text: '沿海风力增大。',
    evidenceIds: ['evidence-runtime-1'],
  }],
});
assert.equal(task.publication.dirty, true);
assert.equal(task.publicationAnalysis.conclusions.length, 2);
assert.equal(PublicationState.cachedRequestMatchesTask(task), false);

const compactedTask = StateStore.compactTaskForStorage({
  ...task,
  publication: null,
  publicationAnalysis: {
    conclusions: [{ text: '保留较早证据', evidenceIds: ['evidence-10'] }],
  },
  evidence: Array.from({ length: 260 }, (_unused, index) => ({ id: `evidence-${index}` })),
  harnessEvents: Array.from({ length: 260 }, (_unused, index) => ({ id: `event-${index}` })),
}, { evidence: 20, harnessEvents: 30 });
assert.equal(compactedTask.evidence.length, 21);
assert.equal(compactedTask.evidence[0].id, 'evidence-10');
assert.equal(compactedTask.evidence.at(-1).id, 'evidence-259');
assert.equal(compactedTask.harnessEvents.length, 30);
assert.deepEqual(compactedTask.pendingPermissions, []);

const compactedLegacyTask = StateStore.compactTaskForStorage({
  publicationAnalysis: {
    forecastConclusions: [{ text: '旧格式引用', evidence_ids: ['legacy-evidence-5'] }],
  },
  evidence: Array.from({ length: 30 }, (_unused, index) => ({ id: `legacy-evidence-${index}` })),
}, { evidence: 3 });
assert.deepEqual(
  compactedLegacyTask.evidence.map((record) => record.id),
  ['legacy-evidence-5', 'legacy-evidence-27', 'legacy-evidence-28', 'legacy-evidence-29'],
);

const signedCompactedTask = StateStore.compactTaskForStorage({
  id: 'signed-compaction-task',
  workspace: '/data/signed-workspace',
  publicationAnalysis: {
    conclusions: [{ text: '签发结论', evidenceIds: ['signed-evidence-5'] }],
  },
  publication: {
    dirty: false,
    gate: { ready: true },
    signoff: { approved: true, reviewerId: 'forecaster-1' },
  },
  artifacts: Array.from({ length: 12 }, (_unused, index) => ({
    id: `signed-artifact-${index}`,
    path: `/data/signed-workspace/artifact-${index}.pdf`,
  })),
  evidence: Array.from({ length: 30 }, (_unused, index) => ({ id: `signed-evidence-${index}` })),
}, { artifacts: 3, evidence: 3 });
assert.deepEqual(
  signedCompactedTask.evidence.map((record) => record.id),
  ['signed-evidence-5', 'signed-evidence-27', 'signed-evidence-28', 'signed-evidence-29'],
);
assert.equal(signedCompactedTask.artifacts.length, 12);
assert.equal(signedCompactedTask.publication.signoff.approved, true);
assert.equal(signedCompactedTask.publication.dirty, false);

const checkedCompactedTask = StateStore.compactTaskForStorage({
  id: 'checked-compaction-task',
  workspace: '/data/checked-workspace',
  publicationAnalysis: {
    conclusions: [{ text: '待签发结论', evidenceIds: ['checked-evidence-1'] }],
  },
  publication: {
    dirty: false,
    gate: { ready: false },
    signoff: { approved: false, reviewerId: 'pending-reviewer' },
  },
  artifacts: Array.from({ length: 5 }, (_unused, index) => ({
    id: `checked-artifact-${index}`,
    path: `/data/checked-workspace/artifact-${index}.pdf`,
  })),
  evidence: [{ id: 'checked-evidence-1' }],
}, { artifacts: 2 });
assert.equal(checkedCompactedTask.artifacts.length, 2);
assert.equal(checkedCompactedTask.publication.dirty, true);
assert.equal(checkedCompactedTask.publication.gate, null);
assert.equal(checkedCompactedTask.publication.signoff, null);

const capabilities = CapabilityResolver.resolveCapabilities({ project, expert, task, catalog });
assert.equal(capabilities.ready, true);
assert.deepEqual(capabilities.skills.map((item) => item.id), ['synoptic-analysis']);
assert.deepEqual(capabilities.connectors.map((item) => item.id).sort(), ['artifact-docx', 'weather-data']);
assert.deepEqual(capabilities.toolSelections, { 'artifact-docx': ['create_document'] });

const missingRequiredCapability = CapabilityResolver.resolveCapabilities({
  project: null,
  expert: {
    id: 'missing-capability-expert',
    requiredSkills: ['missing-analysis-skill'],
  },
  task: { capabilityMode: 'inherit', skillIds: [], connectorIds: [] },
  catalog,
});
assert.equal(missingRequiredCapability.ready, false);
assert.throws(
  () => CapabilityResolver.assertCapabilitiesReady(missingRequiredCapability),
  (error) => error.code === 'CAPABILITY_NOT_READY'
    && /技能“missing-analysis-skill”/.test(error.message)
);
const disconnectedRequiredConnector = CapabilityResolver.resolveCapabilities({
  project: null,
  expert: {
    id: 'disconnected-tool-expert',
    requiredConnectors: ['weather-data'],
  },
  task: { capabilityMode: 'inherit', skillIds: [], connectorIds: [] },
  catalog: {
    ...catalog,
    connectors: catalog.connectors.map((item) => (
      item.id === 'weather-data' ? { ...item, status: 'disabled' } : item
    )),
  },
});
assert.equal(disconnectedRequiredConnector.ready, false);
assert.deepEqual(disconnectedRequiredConnector.connectors, []);
assert.throws(
  () => CapabilityResolver.assertCapabilitiesReady(disconnectedRequiredConnector),
  /工具服务“weather-data”（未连接）/
);

const recommendedCapabilities = CapabilityResolver.resolveCapabilities({
  project: null,
  expert: {
    id: 'recommended-expert',
    recommendedSkills: ['synoptic-analysis'],
    recommendedConnectors: ['weather-data'],
  },
  task: { capabilityMode: 'inherit', skillIds: [], connectorIds: [] },
  catalog,
});
assert.deepEqual(recommendedCapabilities.skills.map((item) => item.id), ['synoptic-analysis']);
assert.deepEqual(recommendedCapabilities.connectors.map((item) => item.id), ['weather-data']);

const explicitlyNamedConnector = CapabilityResolver.resolveCapabilities({
  project: null,
  expert: null,
  task: { capabilityMode: 'inherit', connectorIds: [] },
  catalog,
  prompt: '使用“桌面应用操作”列出当前打开的窗口，只读取。',
});
assert.deepEqual(explicitlyNamedConnector.connectors.map((item) => item.id), ['cua-desktop']);
assert.equal(explicitlyNamedConnector.connectorSources['cua-desktop'], 'prompt');
assert.deepEqual(
  CapabilityResolver.resolveCapabilities({
    project: null,
    expert: null,
    task: { capabilityMode: 'inherit', connectorIds: [] },
    catalog,
    prompt: '不要使用桌面应用操作，只解释原理。',
  }).connectors,
  []
);
assert.deepEqual(
  CapabilityResolver.resolveCapabilities({
    project: null,
    expert: null,
    task: { capabilityMode: 'inherit', connectorIds: [] },
    catalog,
    prompt: '使用浏览器操作打开页面。',
  }).connectors,
  []
);

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
assert.deepEqual(ContextCompiler.runtimeEnvelope(snapshot).capabilities.toolSelections, { 'artifact-docx': ['create_document'] });
assert.equal(snapshot.completionContract.required, true);
assert.equal(ContextCompiler.runtimeEnvelope(snapshot).completionContract.id, snapshot.completionContract.id);
const completionRecipe = ContextCompiler.completionRecipe(snapshot.completionContract);
assert.equal(completionRecipe.settings.max_turns, 24);
assert.ok(completionRecipe.response.json_schema.properties.status.enum.includes('partial'));
assert.ok(!JSON.stringify(completionRecipe).includes('make_product'));
assert.ok(!JSON.stringify(completionRecipe).includes('小福气'));
const explicitConnectorSnapshot = ContextCompiler.compileTaskContext({
  task: { ...task, capabilityMode: 'inherit', connectorIds: [], messages: [] },
  project: Project.normalizeProject({ id: 'no-tools', name: '无默认工具' }),
  expert: { id: 'general' },
  catalog,
  prompt: '调用 cua-desktop 读取窗口列表。',
});
assert.deepEqual(explicitConnectorSnapshot.capabilities.connectors.map((item) => item.id), ['cua-desktop']);

const completedEnvelope = {
  status: 'completed',
  summary: '已生成天气产品。',
  answer: '下周天气产品已生成。',
  artifacts: [{ name: '下周天气.docx', uri: '/tmp/下周天气.docx' }],
  evidence: ['文档生成工具返回成功。'],
  blockers: [],
  nextActions: [],
};
assert.deepEqual(
  ContextCompiler.parseCompletionEnvelope(`处理中\n${JSON.stringify(completedEnvelope)}`),
  completedEnvelope
);
assert.equal(
  ContextCompiler.evaluateCompletion(snapshot.completionContract, JSON.stringify(completedEnvelope)).status,
  'completed'
);
assert.equal(
  ContextCompiler.evaluateCompletion(snapshot.completionContract, '现在开始生成产品。').valid,
  false
);
const fallbackCompletion = [
  '兼容层结果如下：',
  'MeteomATE_COMPLETION',
  'Status: completed',
  'Summary: 已完成浏览器任务',
  'Answer: 页面结果为 Forecast ready: Taipei',
  'ARTIFACTS:',
  '- none',
  'EVIDENCE:',
  '- browser_snapshot 返回 Forecast ready: Taipei',
  'BLOCKERS:',
  '- none',
  'NEXT_ACTIONS:',
  '- none',
  'END_METEOMATE_COMPLETION',
].join('\n');
assert.deepEqual(ContextCompiler.parseCompletionEnvelope(fallbackCompletion), {
  status: 'completed',
  summary: '已完成浏览器任务',
  answer: '页面结果为 Forecast ready: Taipei',
  artifacts: [],
  evidence: ['browser_snapshot 返回 Forecast ready: Taipei'],
  blockers: [],
  nextActions: [],
});
assert.equal(ContextCompiler.evaluateCompletion(snapshot.completionContract, fallbackCompletion).status, 'completed');
assert.equal(
  ContextCompiler.compileCompletionContract({
    task: { workMode: 'ask', expectedOutputs: [] },
    capabilities: { skills: [], connectors: [], toolSelections: {} },
  }).required,
  false
);

const narrowedCapabilities = CapabilityResolver.resolveCapabilities({
  project,
  expert: { ...expert, requiredConnectors: [], recommendedConnectors: [] },
  task: { ...task, capabilityMode: 'custom', connectorIds: ['artifact-docx'], toolSelections: { 'artifact-docx': ['create_document'] } },
  catalog,
});
assert.deepEqual(narrowedCapabilities.connectors.map((item) => item.id), ['artifact-docx']);
assert.equal(narrowedCapabilities.grantMode, 'custom');
const differentlyNarrowedCapabilities = CapabilityResolver.resolveCapabilities({
  project,
  expert: { ...expert, requiredConnectors: [], recommendedConnectors: [] },
  task: { ...task, capabilityMode: 'custom', connectorIds: ['artifact-docx'], toolSelections: { 'artifact-docx': ['update_document'] } },
  catalog,
});
assert.notEqual(differentlyNarrowedCapabilities.id, narrowedCapabilities.id);

const emptyCustomCapabilities = CapabilityResolver.resolveCapabilities({
  project,
  expert: { ...expert, requiredConnectors: [], recommendedConnectors: [] },
  task: { ...task, capabilityMode: 'custom', connectorIds: [], toolSelections: {} },
  catalog,
});
assert.deepEqual(emptyCustomCapabilities.connectors, []);
assert.deepEqual(emptyCustomCapabilities.toolSelections, {});

const inheritedAutomation = Automation.normalizeAutomation({
  id: 'auto-inherit',
  name: '继承项目工具',
  projectId: project.id,
  taskTemplate: { prompt: '生成摘要', expertId: expert.id, capabilityMode: 'inherit', connectorIds: ['artifact-docx'] },
});
assert.equal(inheritedAutomation.taskTemplate.capabilityMode, 'inherit');
assert.deepEqual(inheritedAutomation.taskTemplate.connectorIds, []);
const pinnedAutomation = Automation.normalizeAutomation({
  id: 'auto-pinned',
  name: '固定工具',
  projectId: project.id,
  taskTemplate: {
    prompt: '生成摘要',
    expertId: expert.id,
    capabilityMode: 'pinned',
    connectorIds: ['artifact-docx'],
    toolSelections: { 'artifact-docx': ['create_document'] },
  },
});
assert.equal(pinnedAutomation.taskTemplate.capabilityMode, 'pinned');
assert.deepEqual(pinnedAutomation.taskTemplate.toolSelections, { 'artifact-docx': ['create_document'] });

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
  status: 'ready',
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

const recoveredState = StateStore.normalizeStoredState({
  projects: [],
  tasks: [{
    id: 'late-event-task',
    title: '迟到事件恢复',
    status: 'completed',
    messages: [
      { id: 'u1', role: 'user', text: '问题', status: 'completed' },
      { id: 'a1', role: 'assistant', text: '回答', status: 'completed' },
      { id: 'a2', role: 'assistant', text: '', status: 'streaming', responsePhase: 'responding' },
    ],
  }],
}, {
  initialState: { projects: [], tasks: [] },
  createDefaultPlan,
});
assert.deepEqual(recoveredState.tasks[0].messages.map((message) => message.id), ['u1', 'a1']);

const recoveredTeamState = StateStore.normalizeStoredState({
  projects: [],
  tasks: [{
    id: 'interrupted-team-task',
    title: '中断的专家团',
    status: 'running',
    teamRun: {
      id: 'team-run-1',
      teamId: 'forecast-team',
      status: 'running',
      phase: 'executing',
      members: [
        { id: 'analysis', status: 'completed' },
        { id: 'rain', status: 'running' },
        { id: 'convection', status: 'pending' },
      ],
    },
    messages: [{ id: 'u1', role: 'user', text: '联合研判', status: 'completed' }],
  }],
}, {
  initialState: { projects: [], tasks: [] },
  createDefaultPlan,
});
assert.equal(recoveredTeamState.tasks[0].teamRun.status, 'interrupted');
assert.equal(recoveredTeamState.tasks[0].teamRun.phase, 'interrupted');
assert.deepEqual(
  recoveredTeamState.tasks[0].teamRun.members.map((member) => member.status),
  ['completed', 'interrupted', 'interrupted']
);
assert.equal(
  EventNormalizer.normalizeRuntimeEvent({ type: 'team_member_completed', teamMemberId: 'analysis' }).type,
  'team.member.completed'
);

assert.equal(Shared.contentHash({ b: 2, a: 1 }), Shared.contentHash({ a: 1, b: 2 }));
console.log('MeteoMate harness tests passed.');
