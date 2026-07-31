const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ArtifactRegistry = require('../harness/artifact-registry');
const PublicationState = require('../harness/publication-state');
const RuntimeRecords = require('../harness/runtime-records');
const StateStore = require('../harness/state-store');
const ValidationEngine = require('../harness/validation-engine');

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
  publication: {
    signoff: { approved: true },
    gate: { ready: true },
    dirty: false,
  },
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
  metadata: {
    publicationAttestation: {
      issuedAt: '2026-07-30T08:00:00.000Z',
      value: 'first-evidence-attestation',
    },
  },
};
const artifact = {
  id: 'stable-artifact',
  name: 'risk-map.html',
  path: '/workspace/risk-map.html',
  contentHash: 'a'.repeat(64),
  status: 'ready',
  createdAt: 100,
  metadata: {
    publicationAttestation: {
      issuedAt: '2026-07-30T08:00:00.000Z',
      value: 'first-artifact-attestation',
    },
  },
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

task.publication.dirty = false;
const retriedEvidence = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'evidence_created',
  responseId: 'response-2',
  toolCallId: 'weather-tool',
  evidence: {
    ...evidence,
    createdAt: 200,
    metadata: {
      publicationAttestation: {
        issuedAt: '2026-07-30T08:01:00.000Z',
        value: 'second-evidence-attestation',
      },
    },
  },
}, { runId: 'run-2' });
const retriedArtifact = RuntimeRecords.recordRuntimeEvent(task, {
  type: 'artifact_created',
  responseId: 'response-2',
  toolCallId: 'map-tool',
  artifact: {
    ...artifact,
    createdAt: 200,
    metadata: {
      publicationAttestation: {
        issuedAt: '2026-07-30T08:01:00.000Z',
        value: 'second-artifact-attestation',
      },
    },
  },
}, { runId: 'run-2' });
assert.equal(retriedEvidence.evidence, firstEvidence.evidence);
assert.equal(retriedArtifact.artifact, firstArtifact.artifact);
assert.equal(retriedEvidence.evidence.lineage.runId, 'run-1');
assert.equal(retriedArtifact.artifact.lineage.runId, 'run-1');
assert.equal(
  retriedEvidence.evidence.metadata.publicationAttestation.value,
  'first-evidence-attestation',
);
assert.equal(
  retriedArtifact.artifact.metadata.publicationAttestation.value,
  'first-artifact-attestation',
);
assert.equal(retriedEvidence.responseId, 'response-2');
assert.equal(retriedArtifact.responseId, 'response-2');
assert.equal(retriedEvidence.evidenceChanged, false);
assert.equal(retriedArtifact.artifactChanged, false);
assert.equal(task.publication.dirty, false);

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

const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'renderer-actions.js'), 'utf8');
let generatedId = 0;
const legacyTask = {
  id: 'legacy-artifact-task',
  workspace: '/workspace',
  artifacts: [],
  artifactIds: [],
  messages: [{ id: 'legacy-response', role: 'assistant', status: 'streaming' }],
  publication: {
    signoff: { approved: true },
    gate: { ready: true },
    dirty: false,
  },
};
const rendererContext = vm.createContext({
  window: { MeteoMateHarness: { ArtifactRegistry } },
  cryptoRandomId: () => `legacy-artifact-${++generatedId}`,
  currentStreamingAssistant: () => legacyTask.messages[0],
  latestAssistantMessage: () => legacyTask.messages[0],
  pathBaseName: (value) => String(value).replaceAll('\\', '/').split('/').at(-1),
});
vm.runInContext([
  extractNamedFunction(rendererSource, 'extractArtifactCandidates'),
  extractNamedFunction(rendererSource, 'artifactCandidatePath'),
  extractNamedFunction(rendererSource, 'registerArtifacts'),
  extractNamedFunction(rendererSource, 'completionArtifactUri'),
  extractNamedFunction(rendererSource, 'registerCompletionArtifacts'),
].join('\n'), rendererContext);
rendererContext.registerArtifacts(
  legacyTask,
  '中央气象台页面包含 /publish/observations/beijing.html 和 https://example.com/forecast.html'
);
assert.equal(legacyTask.artifacts.length, 0);
rendererContext.registerArtifacts(legacyTask, '已生成 artifacts/report.pdf');
assert.equal(legacyTask.artifacts.length, 1);
assert.equal(legacyTask.artifactIds.length, 1);
assert.deepEqual(Array.from(legacyTask.messages[0].artifactIds), [legacyTask.artifacts[0].id]);
assert.equal(legacyTask.publication.dirty, true);
assert.ok(legacyTask.artifacts[0].recordHash);

legacyTask.publication.dirty = false;
rendererContext.registerCompletionArtifacts(legacyTask, [{
  uri: '/workspace/artifacts/summary.docx',
  name: 'summary.docx',
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}]);
assert.equal(legacyTask.artifacts.length, 2);
assert.equal(legacyTask.artifactIds.length, 2);
assert.equal(legacyTask.publication.dirty, true);
assert.ok(legacyTask.artifacts[1].recordHash);

const noWorkspaceTask = {
  ...legacyTask,
  id: 'no-workspace-task',
  workspace: '',
  artifacts: [],
  artifactIds: [],
  messages: [{ id: 'no-workspace-response', role: 'assistant', status: 'streaming' }],
};
rendererContext.registerCompletionArtifacts(noWorkspaceTask, [{
  uri: 'Library/Application Support/MeteoMate/browser/page.png',
  name: '全页截图',
  mediaType: 'image/png',
}]);
assert.equal(noWorkspaceTask.artifacts.length, 0);

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

const publishableEvidence = {
  id: 'publishable-evidence',
  source: 'weather-provider',
  sourceVersion: 'dataset-v1',
  evidenceType: 'meteorological-fact',
  validTime: '2026-07-30T08:00:00Z',
  expiresAt: '2026-08-02T08:00:00Z',
  variable: 'rain24h',
  unit: 'mm',
  value: 86,
  qcStatus: 'checked',
  qcVersion: 'meteomate.weather.qc/1.0.0',
  metadata: {
    classification: 'production',
    synthetic: false,
  },
};
const publicationAnalysis = {
  region: '华南',
  issueTime: '2026-07-30T08:00:00Z',
  validPeriod: '2026-07-30T08:00:00Z/2026-07-31T08:00:00Z',
  conclusions: [{
    text: '存在强降水风险。',
    evidenceIds: [publishableEvidence.id],
  }],
};
for (const status of ['draft', 'failed']) {
  const gate = ValidationEngine.runPublicationGate({
    analysis: publicationAnalysis,
    evidence: [publishableEvidence],
    artifacts: [{
      id: `artifact-${status}`,
      name: `${status}.html`,
      path: `/workspace/${status}.html`,
      status,
      contentHash: 'c'.repeat(64),
      metadata: { classification: 'production', synthetic: false },
    }],
    humanSignoff: { approved: true },
  });
  assert.equal(gate.ready, false);
  assert.ok(gate.blockers.some((blocker) => blocker.includes('状态必须为 ready 或 published')));
}
for (const status of ['ready', 'published']) {
  const gate = ValidationEngine.runPublicationGate({
    analysis: publicationAnalysis,
    evidence: [publishableEvidence],
    artifacts: [{
      id: `artifact-${status}`,
      name: `${status}.html`,
      path: `/workspace/${status}.html`,
      status,
      contentHash: 'd'.repeat(64),
      metadata: { classification: 'production', synthetic: false },
    }],
    humanSignoff: { approved: true },
  });
  assert.equal(gate.ready, true);
}

const versionedArtifactTask = {
  id: 'versioned-artifact-task',
  workspace: '/workspace',
  publicationAnalysis,
  evidence: [publishableEvidence],
  publication: {
    dirty: true,
    signoff: { approved: true, reviewerId: 'forecaster-1' },
  },
  artifacts: [
    {
      id: 'risk-map-v1',
      name: 'risk-map.html',
      path: '/workspace/risk-map.html',
      status: 'published',
      contentHash: '1'.repeat(64),
    },
    {
      id: 'uri-only-v1',
      name: 'remote.json',
      uri: 'file:///workspace/remote.json',
      status: 'ready',
      contentHash: '2'.repeat(64),
    },
    {
      id: 'risk-map-v2',
      name: 'risk-map.html',
      path: '/workspace/risk-map.html',
      status: 'ready',
      contentHash: '3'.repeat(64),
    },
    {
      id: 'uri-only-v2',
      name: 'remote.json',
      uri: 'file:///workspace/remote.json',
      status: 'ready',
      contentHash: '4'.repeat(64),
    },
    {
      id: 'uri-only-distinct',
      name: 'distinct.json',
      uri: 'file:///workspace/distinct.json',
      status: 'ready',
      contentHash: '5'.repeat(64),
    },
  ],
};
const versionedRequest = PublicationState.requestForTask(versionedArtifactTask);
assert.deepEqual(
  versionedRequest.artifacts.map((record) => record.id),
  ['risk-map-v2', 'uri-only-v2', 'uri-only-distinct'],
);
assert.equal(versionedArtifactTask.artifacts.length, 5);
assert.equal(versionedArtifactTask.publication.signoff.approved, true);

const latestDraftTask = {
  ...versionedArtifactTask,
  id: 'latest-draft-task',
  artifacts: [
    {
      id: 'forecast-v1',
      name: 'forecast.html',
      path: '/workspace/forecast.html',
      status: 'ready',
      contentHash: '6'.repeat(64),
    },
    {
      id: 'forecast-v2',
      name: 'forecast.html',
      path: '/workspace/forecast.html',
      status: 'draft',
      contentHash: '7'.repeat(64),
    },
  ],
};
const latestDraftRequest = PublicationState.requestForTask(latestDraftTask);
assert.deepEqual(latestDraftRequest.artifacts.map((record) => record.id), ['forecast-v2']);
const latestDraftGate = ValidationEngine.runPublicationGate({
  analysis: latestDraftRequest.analysis,
  artifacts: latestDraftRequest.artifacts,
  evidence: latestDraftRequest.evidence,
  humanSignoff: { approved: true },
});
assert.equal(latestDraftGate.ready, false);
assert.ok(latestDraftGate.blockers.some((blocker) => blocker.includes('状态必须为 ready 或 published')));

console.log('runtime Ledger retry and legacy Artifact tests passed');
