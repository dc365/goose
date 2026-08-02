const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ArtifactRegistry = require('../harness/artifact-registry');
const CompletionCompat = require('../harness/completion-compat.cjs');
const ContextCompiler = require('../harness/context-compiler');
const RuntimeRecords = require('../harness/runtime-records');
const StateStore = require('../harness/state-store');

function extractNamedFunction(source, name) {
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
  id: 'retry-task',
  contextSnapshotId: 'snapshot-1',
  artifacts: [],
  evidence: [],
  messages: [
    { id: 'response-1', role: 'assistant', status: 'completed' },
    { id: 'response-2', role: 'assistant', status: 'streaming' },
  ],
};
const evidence = {
  id: 'stable-evidence',
  source: 'weather-provider',
  sourceVersion: 'dataset-v1',
  validTime: '2026-07-30T08:00:00Z',
  variable: 'rain24h',
  unit: 'mm',
  value: 86,
  createdAt: 100,
  metadata: {},
};
const artifact = {
  id: 'stable-artifact',
  name: 'risk-map.html',
  path: '/workspace/risk-map.html',
  contentHash: 'a'.repeat(64),
  status: 'ready',
  createdAt: 100,
  metadata: {},
};

const firstEvidence = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'evidence_created',
  responseId: 'response-1',
  toolCallId: 'weather-tool',
  evidence,
}, { runId: 'run-1' });
const firstArtifact = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'artifact_created',
  responseId: 'response-1',
  toolCallId: 'map-tool',
  artifact,
}, { runId: 'run-1' });
assert.equal(firstEvidence.responseId, 'response-1');
assert.equal(firstArtifact.responseId, 'response-1');
assert.equal(firstEvidence.evidence.lineage.runId, 'run-1');
assert.equal(firstArtifact.artifact.lineage.runId, 'run-1');
assert.equal(Object.hasOwn(firstEvidence.evidence.metadata, 'responseId'), false);
assert.equal(Object.hasOwn(firstArtifact.artifact.metadata, 'responseId'), false);

const retriedEvidence = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'evidence_created',
  responseId: 'response-2',
  toolCallId: 'weather-tool',
  evidence: {
    ...evidence,
    createdAt: 200,
    metadata: {},
  },
}, { runId: 'run-2' });
const retriedArtifact = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'artifact_created',
  responseId: 'response-2',
  toolCallId: 'map-tool',
  artifact: {
    ...artifact,
    createdAt: 200,
    metadata: {},
  },
}, { runId: 'run-2' });
assert.equal(retriedEvidence.evidence, firstEvidence.evidence);
assert.equal(retriedArtifact.artifact, firstArtifact.artifact);
assert.equal(retriedEvidence.evidence.lineage.runId, 'run-1');
assert.equal(retriedArtifact.artifact.lineage.runId, 'run-1');
assert.equal(retriedEvidence.responseId, 'response-2');
assert.equal(retriedArtifact.responseId, 'response-2');
assert.equal(retriedEvidence.evidenceChanged, false);
assert.equal(retriedArtifact.artifactChanged, false);

assert.throws(
  () => RuntimeRecords.recordRuntimeEvent(task, {
    type: 'evidence_created',
    responseId: 'response-2',
    evidence: { ...evidence, value: 128 },
  }, { runId: 'run-2' }),
  /Evidence ID conflict: stable-evidence/,
);
assert.throws(
  () => RuntimeRecords.recordRuntimeEvent(task, {
    type: 'artifact_created',
    responseId: 'response-2',
    artifact: { ...artifact, contentHash: 'b'.repeat(64) },
  }, { runId: 'run-2' }),
  /Artifact ID conflict: stable-artifact/,
);

const lifecycleTask = { id: 'artifact-lifecycle', artifacts: [], artifactIds: [] };
const lifecycleDraft = ArtifactRegistry.registerArtifact(lifecycleTask, {
  id: 'office-document',
  name: 'forecast.docx',
  path: '/workspace/artifacts/forecast.docx',
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  status: 'draft',
  sizeBytes: 4096,
  contentHash: 'c'.repeat(64),
  metadata: { source: 'office-artifacts', relativePath: 'artifacts/forecast.docx' },
});
const lifecycleDraftRecordHash = lifecycleDraft.recordHash;
const lifecycleValidated = ArtifactRegistry.registerArtifact(lifecycleTask, {
  ...lifecycleDraft,
  status: 'validated',
  metadata: {
    ...lifecycleDraft.metadata,
    render: { pageCount: 3, previewPath: '.meteomate/previews/forecast.pdf' },
  },
});
assert.equal(lifecycleValidated, lifecycleDraft);
assert.equal(lifecycleDraft.status, 'validated');
assert.equal(lifecycleDraft.metadata.render.pageCount, 3);
assert.notEqual(lifecycleDraft.recordHash, lifecycleDraftRecordHash);
assert.equal(lifecycleTask.artifacts.length, 1);

const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'renderer-actions.js'), 'utf8');
const completionTask = {
  id: 'completion-artifact-task',
  workspace: '/workspace',
  artifacts: [{
    id: 'verified-document',
    name: 'summary.docx',
    path: '/workspace/artifacts/summary.docx',
    status: 'validated',
    contentHash: 'd'.repeat(64),
    metadata: { source: 'office-artifacts', relativePath: 'artifacts/summary.docx' },
  }],
  artifactIds: ['verified-document'],
  messages: [{
    id: 'completion-response',
    role: 'assistant',
    status: 'streaming',
    artifactIds: ['verified-document'],
  }],
};
const rendererContext = vm.createContext({
  Set,
});
vm.runInContext([
  extractNamedFunction(rendererSource, 'normalizedArtifactTarget'),
  extractNamedFunction(rendererSource, 'trustedArtifactRecord'),
  extractNamedFunction(rendererSource, 'deliverableArtifactRecord'),
  extractNamedFunction(rendererSource, 'completionArtifactMatches'),
  extractNamedFunction(rendererSource, 'verifiedCompletionArtifacts'),
  extractNamedFunction(rendererSource, 'pruneUnverifiedArtifactRecords'),
].join('\n'), rendererContext);
const verifiedArtifacts = rendererContext.verifiedCompletionArtifacts(completionTask, [{
  uri: 'artifacts/summary.docx',
  name: 'summary.docx',
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}], completionTask.messages[0]);
assert.equal(verifiedArtifacts.length, 1);
assert.equal(verifiedArtifacts[0].id, 'verified-document');

const noWorkspaceTask = {
  ...completionTask,
  id: 'no-workspace-task',
  workspace: '',
  artifacts: [],
  artifactIds: [],
  messages: [{ id: 'no-workspace-response', role: 'assistant', status: 'streaming' }],
};
assert.equal(rendererContext.verifiedCompletionArtifacts(noWorkspaceTask, [{
  uri: '/Users/dc/artifacts/forecast/并不存在.docx',
  name: '并不存在.docx',
}], noWorkspaceTask.messages[0])[0], null);
assert.equal(noWorkspaceTask.artifacts.length, 0);

const ghostTask = {
  id: 'ghost-task',
  artifacts: [{
    id: 'ghost-document',
    name: '并不存在.docx',
    path: '/Users/dc/artifacts/forecast/并不存在.docx',
    status: 'draft',
    contentHash: null,
    metadata: { source: 'legacy-assistant-text' },
  }],
  artifactIds: ['ghost-document'],
  messages: [{ artifactIds: ['ghost-document'] }],
};
assert.equal(rendererContext.pruneUnverifiedArtifactRecords(ghostTask), true);
assert.equal(ghostTask.artifacts.length, 0);
assert.deepEqual(Array.from(ghostTask.messages[0].artifactIds), []);
assert.ok(!rendererSource.includes("metadata: { source: 'legacy-assistant-text' }"));
assert.ok(!rendererSource.includes('registerArtifacts(task, event.text'));
assert.ok(rendererSource.includes("workspace: project?.workspace || state.assistantWorkspace || ''"));
assert.ok(rendererSource.includes("task.workspace = getConversationProject(task)?.workspace || task.workspace || state.assistantWorkspace || ''"));

const documentContract = ContextCompiler.compileCompletionContract({
  task: { workMode: 'execute', prompt: '生成未来三天天气预报稿', expectedOutputs: [] },
  capabilities: { connectors: [{ id: 'office-artifacts' }], skills: [], toolSelections: {} },
});
assert.equal(documentContract.requiresArtifact, true);
assert.equal(ContextCompiler.promptRequiresArtifact('介绍预报稿的常见结构'), false);
const completionInstruction = CompletionCompat.fallbackInstruction(documentContract);
assert.match(completionInstruction, /必须在本轮完成实际创建和校验并直接交付/);
assert.match(completionInstruction, /禁止拼接、补全或猜测路径/);

const restoredArtifactTask = StateStore.normalizeStoredTask({
  id: 'stored-artifact-task',
  workspace: '/',
  status: 'completed',
  artifactIds: ['legacy-link', 'legacy-screenshot', 'structured-screenshot', 'browser-image'],
  messages: [{
    id: 'stored-response',
    role: 'assistant',
    status: 'completed',
    artifactIds: ['legacy-link', 'legacy-screenshot', 'structured-screenshot', 'browser-image'],
  }],
  artifacts: [
    {
      id: 'legacy-link',
      name: 'beijing.html',
      path: '/publish/observations/beijing.html',
      status: 'draft',
    },
    {
      id: 'legacy-screenshot',
      name: 'page-2026-07-30.png',
      path: '/page-2026-07-30.png',
      status: 'draft',
    },
    {
      id: 'structured-screenshot',
      name: '500hPa高空实况图截图',
      path: 'Library/Application Support/MeteoMate/browser/page-2026-07-30.png',
      uri: 'Library/Application Support/MeteoMate/browser/page-2026-07-30.png',
      status: 'draft',
    },
    {
      id: 'browser-image',
      name: 'browser-image.png',
      path: '/workspace/browser-image.png',
      mediaType: 'image/png',
      status: 'draft',
      metadata: { source: 'acp-image' },
    },
  ],
});
assert.deepEqual(
  restoredArtifactTask.artifacts.map((item) => item.id),
  ['structured-screenshot', 'browser-image']
);
assert.equal(restoredArtifactTask.artifacts[0].path, '/page-2026-07-30.png');
assert.equal(restoredArtifactTask.artifacts[0].uri, '/page-2026-07-30.png');
assert.equal(
  restoredArtifactTask.artifacts[0].metadata.source,
  'legacy-artifact-reconciliation'
);
assert.deepEqual(restoredArtifactTask.artifactIds, ['structured-screenshot', 'browser-image']);
assert.deepEqual(
  restoredArtifactTask.messages[0].artifactIds,
  ['structured-screenshot', 'browser-image']
);
assert.ok(!rendererSource.includes('registerArtifacts(task, event.rawOutput)'));
assert.ok(!rendererSource.includes('registerArtifacts(task, event.content)'));


console.log('runtime Ledger retry and legacy Artifact tests passed');
