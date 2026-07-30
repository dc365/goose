const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const RuntimeRecords = require('../harness/runtime-records');

const serverNow = Date.parse('2026-07-30T08:00:00.000Z');
let gateCheckedAt = null;
const gateStub = {
  runPublicationGate({ analysis, artifacts, evidence, humanSignoff, allowSynthetic, at }) {
    gateCheckedAt = at;
    const blockers = [];
    if (!analysis?.conclusions?.length) blockers.push('缺少预报结论');
    if (!artifacts?.length) blockers.push('缺少可交付成果物');
    if (!evidence?.length) blockers.push('缺少证据');
    if (evidence?.some((item) => item?.metadata?.synthetic) && !allowSynthetic) blockers.push('构造数据不能签发');
    if (!humanSignoff?.approved) blockers.push('缺少预报员或业务人员签发');
    return { ready: blockers.length === 0, status: blockers.length ? 'draft' : 'ready', blockers, warnings: [] };
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith('publication-service.cjs') && request === '../harness/validation-engine') return gateStub;
  return originalLoad.call(this, request, parent, isMain);
};
const { createPublicationService } = require('../capabilities/publication-service.cjs');
Module._load = originalLoad;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-'));
const handlers = new Map();
const profileContext = {
  currentPaths: () => ({ root }),
  isAuthenticated: () => false,
  publicState: () => ({ cachedUser: null }),
};
const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
const service = createPublicationService({
  ipcMain,
  profileContext,
  securityMode: 'internal',
  now: () => serverNow,
});
assert.ok(service.publicationAttestor);
service.registerIpc();
assert.equal(handlers.size, 3);

function sha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function publicationInput(taskId, overrides = {}) {
  const artifactPath = overrides.artifactPath || path.join(root, `${taskId}.txt`);
  if (overrides.createArtifact !== false && !fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, `artifact for ${taskId}`);
  }
  const evidence = service.publicationAttestor.attestRecord('Evidence', {
    id: `e-${taskId}`,
    source: 'trusted-weather-provider',
    sourceVersion: '2026.07',
    evidenceType: 'meteorological-fact',
    validTime: '2026-07-30T07:00:00.000Z',
    variable: 'rain24h',
    unit: 'mm',
    value: 88,
    metadata: {
      classification: 'production',
      official: true,
      sourceId: 'trusted-weather-provider',
      datasetHash: '1'.repeat(64),
    },
    ...(overrides.evidence || {}),
  }, { taskId, runId: `run-${taskId}`, toolCallId: 'weather-query' });
  const artifact = service.publicationAttestor.attestRecord('Artifact', {
    id: `a-${taskId}`,
    name: path.basename(artifactPath),
    path: artifactPath,
    status: 'ready',
    contentHash: Object.hasOwn(overrides, 'contentHash')
      ? overrides.contentHash
      : fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile()
        ? sha256(artifactPath)
        : null,
    ...(overrides.artifact || {}),
  }, { taskId, runId: `run-${taskId}`, toolCallId: 'weather-render' });
  return {
    taskId,
    workspace: overrides.workspace ?? root,
    analysis: {
      conclusions: [{
        text: '暴雨风险',
        evidenceIds: [evidence.id],
      }],
    },
    artifacts: [artifact],
    evidence: [evidence],
    note: '已复核',
    reviewerName: '本机值班员',
    at: Date.parse('2000-01-01T00:00:00.000Z'),
  };
}

function withoutAttestation(record) {
  const result = JSON.parse(JSON.stringify(record));
  delete result.metadata.publicationAttestation;
  return result;
}

const input = publicationInput('task-1');
const signed = service.sign(input);
assert.equal(signed.gate.ready, true);
assert.equal(signed.signoff.verification, 'local-profile');
assert.equal(signed.signoff.reviewerName, '本机值班员');
assert.equal(gateCheckedAt, serverNow, 'publication checks must use the server clock');
assert.equal(service.check(input).signoff.approved, true);

const runtimeTask = { id: 'task-runtime', artifacts: [], evidence: [] };
const runtimeInput = publicationInput(runtimeTask.id);
const evidenceEvent = service.publicationAttestor.attestRuntimeEvent({
  type: 'evidence_created',
  taskId: runtimeTask.id,
  runId: 'run-runtime',
  toolCallId: 'weather-query',
  evidence: runtimeInput.evidence[0],
});
const artifactEvent = service.publicationAttestor.attestRuntimeEvent({
  type: 'artifact_created',
  taskId: runtimeTask.id,
  runId: 'run-runtime',
  toolCallId: 'weather-render',
  artifact: runtimeInput.artifacts[0],
});
RuntimeRecords.recordRuntimeEvent(runtimeTask, evidenceEvent, { runId: 'run-runtime' }, {
  responseId: 'response-runtime',
});
RuntimeRecords.recordRuntimeEvent(runtimeTask, artifactEvent, { runId: 'run-runtime' }, {
  responseId: 'response-runtime',
});
assert.equal(service.sign({
  ...runtimeInput,
  artifacts: runtimeTask.artifacts,
  evidence: runtimeTask.evidence,
}).gate.ready, true, 'runtime record normalization must preserve the main-process attestation');

const unsignedEvidence = publicationInput('task-unsigned-evidence');
assert.throws(
  () => service.sign({
    ...unsignedEvidence,
    evidence: unsignedEvidence.evidence.map(withoutAttestation),
  }),
  /主进程签名/,
);
assert.equal(service.check({
  ...unsignedEvidence,
  evidence: unsignedEvidence.evidence.map(withoutAttestation),
}).gate.ready, false);
const unsignedArtifact = publicationInput('task-unsigned-artifact');
assert.throws(
  () => service.sign({
    ...unsignedArtifact,
    artifacts: unsignedArtifact.artifacts.map(withoutAttestation),
  }),
  /主进程签名/,
);
const forgedEvidence = publicationInput('task-forged-evidence');
forgedEvidence.evidence[0].value = 999;
assert.throws(
  () => service.sign(forgedEvidence),
  /主进程签名/,
);
const forgedArtifact = publicationInput('task-forged-artifact');
forgedArtifact.artifacts[0].name = 'forged-report.txt';
assert.throws(
  () => service.sign(forgedArtifact),
  /主进程签名/,
);
assert.throws(
  () => service.sign({ ...input, taskId: 'task-replay' }),
  /主进程签名/,
);

const synthetic = publicationInput('task-synthetic', {
  evidence: {
    id: 'e-demo',
    metadata: {
      synthetic: true,
      classification: 'demo',
      sourceId: 'fixture-weather-provider',
      datasetHash: '2'.repeat(64),
    },
  },
});
assert.throws(
  () => service.sign({ ...synthetic, allowSynthetic: true }),
  /构造数据不能签发/,
);

const changedAnalysis = {
  ...input,
  analysis: { conclusions: [{ text: '已经篡改的结论', evidenceIds: ['e1'] }] },
};
assert.equal(service.check(changedAnalysis).gate.ready, false);
assert.ok(service.check(changedAnalysis).gate.blockers.some((item) => item.includes('已经变化')));

fs.writeFileSync(input.artifacts[0].path, 'modified artifact');
const changedFile = service.check(input);
assert.equal(changedFile.gate.ready, false);
assert.ok(changedFile.gate.blockers.some((item) => item.includes('内容摘要')));
assert.equal(service.revoke({ taskId: 'task-1' }).revoked, true);

const missingWorkspace = publicationInput('task-missing-workspace');
delete missingWorkspace.workspace;
assert.throws(() => service.sign(missingWorkspace), /工作区/);

const missingClassification = publicationInput('task-missing-classification', {
  evidence: {
    metadata: {
      sourceId: 'trusted-weather-provider',
      datasetHash: '3'.repeat(64),
    },
  },
});
assert.throws(() => service.sign(missingClassification), /成熟度分类/);

const missingSourceId = publicationInput('task-missing-source-id', {
  evidence: {
    metadata: {
      classification: 'production',
      datasetHash: '4'.repeat(64),
    },
  },
});
assert.throws(() => service.sign(missingSourceId), /资料源标识/);

const missingDatasetHash = publicationInput('task-missing-dataset-hash', {
  evidence: {
    metadata: {
      classification: 'production',
      sourceId: 'trusted-weather-provider',
    },
  },
});
assert.throws(() => service.sign(missingDatasetHash), /资料摘要/);

const missingPath = publicationInput('task-missing-path', {
  artifact: { path: null, uri: 'https://attacker.example/report.pdf' },
  contentHash: null,
});
assert.throws(() => service.sign(missingPath), /本地路径/);

const missingHash = publicationInput('task-missing-hash', { contentHash: null });
assert.throws(() => service.sign(missingHash), /内容摘要/);

const missingFile = publicationInput('task-missing-file', {
  artifactPath: path.join(root, 'does-not-exist.txt'),
  createArtifact: false,
  contentHash: '0'.repeat(64),
});
assert.throws(() => service.sign(missingFile), /不存在/);

const directoryArtifact = publicationInput('task-directory', {
  artifactPath: root,
  contentHash: '0'.repeat(64),
});
assert.throws(() => service.sign(directoryArtifact), /普通文件/);

const outsidePath = path.join(os.tmpdir(), `meteomate-outside-${process.pid}.txt`);
fs.writeFileSync(outsidePath, 'outside artifact');
const outsideArtifact = publicationInput('task-outside', { artifactPath: outsidePath });
assert.throws(() => service.sign(outsideArtifact), /工作区/);

const remoteUri = publicationInput('task-remote-uri', {
  artifact: { uri: 'https://attacker.example/report.pdf' },
});
assert.throws(() => service.sign(remoteUri), /远程 URI/);

const hashMismatch = publicationInput('task-hash-mismatch', { contentHash: 'f'.repeat(64) });
assert.throws(() => service.sign(hashMismatch), /内容摘要不匹配/);

const strictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext,
  securityMode: 'strict',
});
assert.throws(() => strictService.sign({ ...input, taskId: 'strict-task' }), /在线登录/);

const viewerProfileContext = {
  currentPaths: () => ({ root }),
  isAuthenticated: () => true,
  publicState: () => ({ user: { id: 'viewer-1', displayName: '只读用户', role: 'viewer' } }),
};
const viewerStrictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext: viewerProfileContext,
  securityMode: 'strict',
});
assert.throws(() => viewerStrictService.sign({ ...input, taskId: 'viewer-task' }), /发布权限/);

fs.rmSync(outsidePath, { force: true });
fs.rmSync(root, { recursive: true, force: true });
console.log('publication service intranet-mode tests passed');
