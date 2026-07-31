const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RuntimeRecords = require('../harness/runtime-records');
const StateStore = require('../harness/state-store');
const QcPolicy = require('../harness/qc-policy');

const serverNow = Date.parse('2026-07-30T08:00:00.000Z');
const { createPublicationService, stableDigest } = require('../capabilities/publication-service.cjs');
assert.equal(stableDigest(QcPolicy.POLICY_DEFINITION), QcPolicy.POLICY_DIGEST);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-'));
const safeStorageKey = crypto.randomBytes(32);
let safeStorageCalls = 0;
const safeStorage = {
  isEncryptionAvailable() { safeStorageCalls += 1; return true; },
  getSelectedStorageBackend() { safeStorageCalls += 1; return 'test-aes-gcm'; },
  encryptString(value) {
    safeStorageCalls += 1;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', safeStorageKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decryptString(value) {
    safeStorageCalls += 1;
    const iv = value.subarray(0, 12);
    const tag = value.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', safeStorageKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  },
};
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
  safeStorage,
  securityMode: 'internal',
  now: () => serverNow,
});
assert.ok(service.publicationAttestor);
service.registerIpc();
assert.equal(handlers.size, 5);
for (const channel of [
  'publication:check',
  'publication:sign',
  'publication:revoke',
  'publication:waive-qc',
  'publication:revoke-qc-waiver',
]) {
  assert.ok(handlers.has(channel), `missing ${channel} handler`);
}

function sha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function legacyCanonicalRecord(input = {}) {
  const record = clone(input);
  delete record.recordHash;
  delete record.lineage;
  delete record.createdAt;
  delete record.updatedAt;
  if (record.metadata && typeof record.metadata === 'object') {
    delete record.metadata.publicationAttestation;
    delete record.metadata.responseId;
  }
  return stable(record);
}

function asLegacyAttestedRecord(record, taskId) {
  const legacy = clone(record);
  const current = legacy.metadata.publicationAttestation;
  const attestation = {
    version: 'meteomate-publication/v1',
    taskId,
    runId: current.runId,
    toolCallId: current.toolCallId,
    issuedAt: current.issuedAt,
  };
  legacy.metadata.publicationAttestation = attestation;
  const payload = JSON.stringify(stable({
    kind: legacy.kind,
    taskId: attestation.taskId,
    runId: attestation.runId,
    toolCallId: attestation.toolCallId,
    issuedAt: attestation.issuedAt,
    record: legacyCanonicalRecord(legacy),
  }));
  const key = Buffer.from(
    fs.readFileSync(path.join(root, 'publication-attestation.key'), 'utf8').trim(),
    'hex',
  );
  attestation.value = crypto.createHmac('sha256', key).update(payload).digest('hex');
  return legacy;
}

function publicationInput(taskId, overrides = {}, targetService = service, workspaceRoot = root) {
  const artifactPath = overrides.artifactPath || path.join(workspaceRoot, `${taskId}.txt`);
  if (overrides.createArtifact !== false && !fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, `artifact for ${taskId}`);
  }
  const evidence = targetService.publicationAttestor.attestRecord('Evidence', {
    id: `e-${taskId}`,
    source: 'trusted-weather-provider',
    sourceVersion: '2026.07',
    evidenceType: 'meteorological-fact',
    validTime: '2026-07-30T07:00:00.000Z',
    expiresAt: '2026-08-02T08:00:00.000Z',
    variable: 'rain24h',
    unit: 'mm',
    value: 88,
    qcStatus: 'checked',
    qcVersion: QcPolicy.POLICY_VERSION,
    metadata: {
      classification: 'production',
      synthetic: false,
      official: true,
      sourceId: 'trusted-weather-provider',
      datasetHash: '1'.repeat(64),
    },
    ...(overrides.evidence || {}),
  }, {
    taskId,
    runId: `run-${taskId}`,
    toolCallId: 'weather-query',
    extensionName: 'weather-data',
    toolName: 'weather_build_evidence',
  });
  const artifact = targetService.publicationAttestor.attestRecord('Artifact', {
    id: `a-${taskId}`,
    name: path.basename(artifactPath),
    path: artifactPath,
    status: 'ready',
    evidenceIds: [evidence.id],
    contentHash: Object.hasOwn(overrides, 'contentHash')
      ? overrides.contentHash
      : fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile()
        ? sha256(artifactPath)
        : null,
    metadata: {
      classification: 'production',
      synthetic: false,
      official: true,
    },
    ...(overrides.artifact || {}),
  }, {
    taskId,
    runId: `run-${taskId}`,
    toolCallId: 'weather-render',
    extensionName: 'gis-map',
    toolName: 'weather_render_dataset_map',
  });
  return {
    taskId,
    workspace: overrides.workspace ?? workspaceRoot,
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
assert.ok(signed.signoff.reviewerName);
assert.equal(signed.signoff.signedAt, new Date(serverNow).toISOString());
assert.match(signed.signoff.snapshotDigest, /^[a-f0-9]{64}$/);
assert.equal(
  service.publicationAttestor.verifyAuditRecord(
    'PublicationSignoff',
    signed.signoff,
    { taskId: input.taskId },
  ),
  true,
);
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
const restoredRuntimeTask = StateStore.normalizeStoredTask({
  ...runtimeTask,
  title: '重启恢复验证',
  workspace: root,
  contextSnapshotId: 'context-created-after-attestation',
  status: 'completed',
}, {
  createDefaultPlan: () => [],
});
assert.equal(
  service.publicationAttestor.verifyRecord(
    'Evidence',
    restoredRuntimeTask.evidence[0],
    { taskId: runtimeTask.id },
  ),
  true,
);
assert.equal(
  service.publicationAttestor.verifyRecord(
    'Artifact',
    restoredRuntimeTask.artifacts[0],
    { taskId: runtimeTask.id },
  ),
  true,
);

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
      official: false,
      sourceId: 'fixture-weather-provider',
      datasetHash: '2'.repeat(64),
    },
  },
});
assert.throws(
  () => service.sign({ ...synthetic, allowSynthetic: true }),
  /synthetic evidence is not publishable/,
);

const changedAnalysis = {
  ...input,
  analysis: { conclusions: [{ text: '已经篡改的结论', evidenceIds: [input.evidence[0].id] }] },
};
assert.equal(service.check(changedAnalysis).gate.ready, false);
assert.ok(service.check(changedAnalysis).gate.blockers.some((item) => item.includes('已经变化')));

fs.writeFileSync(input.artifacts[0].path, 'modified artifact');
const changedFile = service.check(input);
assert.equal(changedFile.gate.ready, false);
assert.ok(changedFile.gate.blockers.some((item) => item.includes('内容摘要')));
assert.equal(service.revoke({
  taskId: 'task-1',
  reason: '成果物内容发生变化，撤销原签发记录',
}).revoked, true);

const good = publicationInput('task-qc-good', {
  evidence: { qcStatus: 'good' },
});
assert.equal(service.sign(good).gate.ready, true);

const suspect = publicationInput('task-qc-suspect', {
  evidence: { qcStatus: 'suspect' },
});
assert.throws(() => service.sign(suspect), /QC 状态 suspect/);
assert.throws(
  () => service.waiveQc({ ...suspect, evidenceId: suspect.evidence[0].id, reason: '太短' }),
  /8-1000/,
);
assert.throws(
  () => service.waiveQc({ ...suspect, evidenceId: 'evidence-not-present', reason: '已完成人工交叉检查' }),
  /不在本次权威输入/,
);
const waived = service.waiveQc({
  ...suspect,
  evidenceId: suspect.evidence[0].id,
  reason: '已与相邻站、雷达回波和原始报文完成人工交叉检查',
});
assert.equal(waived.qcWaivers.length, 1);
assert.equal(waived.gate.ready, false);
assert.deepEqual(waived.gate.qc.activeWaiverIds, [waived.qcWaivers[0].id]);
assert.equal(
  service.publicationAttestor.verifyAuditRecord(
    'EvidenceQcWaiver',
    waived.qcWaivers[0],
    { taskId: suspect.taskId },
  ),
  true,
);
assert.equal(service.sign(suspect).gate.ready, true);

const changedSuspect = publicationInput(suspect.taskId, {
  evidence: { qcStatus: 'suspect', value: 99 },
});
const changedSuspectGate = service.check(changedSuspect).gate;
assert.equal(changedSuspectGate.ready, false);
assert.ok(changedSuspectGate.blockers.some((item) => item.includes('QC 状态 suspect')));

const registryPath = path.join(root, 'publication-signoffs.json');
const validRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const tamperedRegistry = JSON.parse(JSON.stringify(validRegistry));
tamperedRegistry.qcWaivers[suspect.taskId][0].reason = '攻击者篡改了豁免理由';
fs.writeFileSync(registryPath, `${JSON.stringify(tamperedRegistry, null, 2)}\n`);
const tamperedWaiverGate = service.check(suspect).gate;
assert.equal(tamperedWaiverGate.ready, false);
assert.ok(tamperedWaiverGate.blockers.some((item) => item.includes('未通过主进程签名验证')));
fs.writeFileSync(registryPath, `${JSON.stringify(validRegistry, null, 2)}\n`);

const waiverRegistryBeforeRevocation = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const revokedWaiver = service.revokeQcWaiver({
  ...suspect,
  waiverId: waived.qcWaivers[0].id,
  reason: '复核结论发生变化',
});
assert.equal(revokedWaiver.revoked, true);
assert.ok(revokedWaiver.qcWaivers[0].revokedAt);
assert.equal(revokedWaiver.gate.ready, false);
assert.throws(() => service.sign(suspect), /QC 状态 suspect/);
const waiverRegistryAfterRevocation = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const replayedWaiverRegistry = clone(waiverRegistryAfterRevocation);
replayedWaiverRegistry.qcWaivers[suspect.taskId] = clone(
  waiverRegistryBeforeRevocation.qcWaivers[suspect.taskId],
);
fs.writeFileSync(registryPath, `${JSON.stringify(replayedWaiverRegistry, null, 2)}\n`);
const replayedWaiverGate = service.check(suspect).gate;
assert.equal(replayedWaiverGate.ready, false);
assert.deepEqual(replayedWaiverGate.qc.activeWaiverIds, []);
assert.ok(replayedWaiverGate.blockers.some((item) => item.includes('QC 状态 suspect')));
fs.writeFileSync(registryPath, `${JSON.stringify(waiverRegistryAfterRevocation, null, 2)}\n`);

for (const status of ['unknown', 'unchecked', 'missing', 'bad', 'rejected']) {
  const denied = publicationInput(`task-qc-${status}`, {
    evidence: { qcStatus: status },
  });
  assert.throws(() => service.sign(denied), new RegExp(`QC 状态 ${status}`));
  assert.throws(
    () => service.waiveQc({
      ...denied,
      evidenceId: denied.evidence[0].id,
      reason: '人工说明不能覆盖不可豁免的 QC 结果',
    }),
    /仅当前政策版本的 suspect/,
  );
}

const stalePolicy = publicationInput('task-qc-policy-stale', {
  evidence: {
    qcStatus: 'suspect',
    qcVersion: 'meteomate.weather.qc/0.9.0',
  },
});
assert.throws(() => service.sign(stalePolicy), /QC 策略版本/);
assert.throws(
  () => service.waiveQc({
    ...stalePolicy,
    evidenceId: stalePolicy.evidence[0].id,
    reason: '旧政策不能通过人工理由继续使用',
  }),
  /仅当前政策版本/,
);

const invalidClassificationCase = publicationInput('task-classification-case', {
  evidence: {
    metadata: {
      classification: 'Production',
      synthetic: false,
      official: true,
      sourceId: 'trusted-weather-provider',
      datasetHash: '5'.repeat(64),
    },
  },
});
assert.throws(() => service.sign(invalidClassificationCase), /成熟度分类/);

const invalidSyntheticType = publicationInput('task-synthetic-type', {
  evidence: {
    metadata: {
      classification: 'production',
      synthetic: 'true',
      official: true,
      sourceId: 'trusted-weather-provider',
      datasetHash: '6'.repeat(64),
    },
  },
});
assert.throws(() => service.sign(invalidSyntheticType), /构造数据标记必须为布尔值/);

const invalidDates = publicationInput('task-invalid-dates', {
  evidence: {
    validTime: 'not-a-date',
    expiresAt: 'also-not-a-date',
  },
});
assert.throws(() => service.sign(invalidDates), /invalid validTime|invalid expiresAt/);

const invalidArtifactClassification = publicationInput('task-artifact-classification', {
  artifact: {
    metadata: {
      classification: 'Experimental',
      synthetic: false,
      official: false,
    },
  },
});
assert.throws(() => service.sign(invalidArtifactClassification), /成果物.*成熟度分类无效/);

const forgedLineage = publicationInput('task-forged-lineage');
forgedLineage.artifacts[0].lineage.evidenceIds = [];
assert.throws(() => service.sign(forgedLineage), /主进程签名/);

const legacyProof = publicationInput('task-legacy-proof');
legacyProof.artifacts[0] = asLegacyAttestedRecord(
  legacyProof.artifacts[0],
  legacyProof.taskId,
);
assert.equal(
  service.publicationAttestor.verifyRecord(
    'Artifact',
    legacyProof.artifacts[0],
    { taskId: legacyProof.taskId },
  ),
  true,
);
assert.throws(() => service.sign(legacyProof), /使用旧版证明/);

let expiryClock = serverNow;
const expiryService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext,
  safeStorage,
  securityMode: 'internal',
  now: () => expiryClock,
});
const expiring = publicationInput('task-qc-expiry', {
  evidence: { qcStatus: 'suspect' },
});
const expiringWaiver = expiryService.waiveQc({
  ...expiring,
  evidenceId: expiring.evidence[0].id,
  reason: '短时豁免用于验证政策有效期边界',
});
assert.equal(expiringWaiver.gate.qc.activeWaiverIds.length, 1);
expiryClock += QcPolicy.MAX_WAIVER_DURATION_MS + 1;
const expiredGate = expiryService.check(expiring).gate;
assert.equal(expiredGate.ready, false);
assert.ok(expiredGate.blockers.some((item) => item.includes('QC 状态 suspect')));

const missingWorkspace = publicationInput('task-missing-workspace');
delete missingWorkspace.workspace;
assert.throws(() => service.sign(missingWorkspace), /工作区/);

const missingClassification = publicationInput('task-missing-classification', {
  evidence: {
    metadata: {
      synthetic: false,
      official: true,
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
      synthetic: false,
      official: true,
      datasetHash: '4'.repeat(64),
    },
  },
});
assert.throws(() => service.sign(missingSourceId), /资料源标识/);

const missingDatasetHash = publicationInput('task-missing-dataset-hash', {
  evidence: {
    metadata: {
      classification: 'production',
      synthetic: false,
      official: true,
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

const cachedProfileService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext: {
    currentPaths: () => ({ root }),
    isAuthenticated: () => false,
    publicState: () => ({
      cachedUser: {
        id: 'forged-cached-admin',
        displayName: '伪造离线管理员',
        role: 'admin',
      },
    }),
  },
  safeStorage,
  securityMode: 'internal',
  now: () => serverNow,
});
const cachedProfileSignoff = cachedProfileService.sign(publicationInput('task-cached-profile')).signoff;
assert.notEqual(cachedProfileSignoff.reviewerId, 'forged-cached-admin');
assert.equal(cachedProfileSignoff.verification, 'local-profile');
assert.equal(safeStorageCalls, 0, 'internal publication mode must not access Keychain/safeStorage');

const strictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext,
  safeStorage,
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
  safeStorage,
  securityMode: 'strict',
});
assert.throws(() => viewerStrictService.sign({ ...input, taskId: 'viewer-task' }), /发布权限/);
const expiredStrictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext: {
    currentPaths: () => ({ root }),
    isAuthenticated: () => true,
    publicState: () => ({
      status: 'authenticated',
      expiresAt: '2000-01-01T00:00:00.000Z',
      user: { id: 'publisher-expired', displayName: '过期发布员', role: 'publisher' },
    }),
  },
  safeStorage,
  securityMode: 'strict',
  now: () => serverNow,
});
assert.throws(
  () => expiredStrictService.sign(publicationInput('task-expired-session')),
  /会话已经过期/,
);

const staleArtifactInput = publicationInput('task-stale-artifact');
const staleArtifactSigned = service.sign(staleArtifactInput);
assert.equal(staleArtifactSigned.gate.ready, true);
fs.unlinkSync(staleArtifactInput.artifacts[0].path);
const staleArtifactCheck = service.check(staleArtifactInput);
assert.equal(staleArtifactCheck.gate.ready, false);
assert.equal(staleArtifactCheck.signoff.id, staleArtifactSigned.signoff.id);
assert.equal(
  service.revoke({
    taskId: staleArtifactInput.taskId,
    reason: '成果物文件已不可用，撤销本次签发记录',
  }).revoked,
  true,
);

const signoffReplayInput = publicationInput('task-signoff-replay');
service.sign(signoffReplayInput);
const registryBeforeSignoffRevocation = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
service.revoke({
  taskId: signoffReplayInput.taskId,
  reason: '业务复核结论变化，撤销旧签发记录',
});
const registryAfterSignoffRevocation = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const replayedSignoffRegistry = clone(registryAfterSignoffRevocation);
replayedSignoffRegistry.signoffs[signoffReplayInput.taskId] = clone(
  registryBeforeSignoffRevocation.signoffs[signoffReplayInput.taskId],
);
fs.writeFileSync(registryPath, `${JSON.stringify(replayedSignoffRegistry, null, 2)}\n`);
const replayedSignoff = service.check(signoffReplayInput);
assert.equal(replayedSignoff.signoff, null);
assert.equal(replayedSignoff.gate.ready, false);
assert.ok(replayedSignoff.gate.blockers.includes('缺少预报员或业务人员签发'));
fs.writeFileSync(registryPath, `${JSON.stringify(registryAfterSignoffRevocation, null, 2)}\n`);

const invalidationLogPath = path.join(root, 'publication-audit-invalidations.jsonl');
const invalidationAnchorPath = path.join(root, 'publication-audit-anchor.json');
const hiddenInvalidationLogPath = `${invalidationLogPath}.hidden`;
fs.renameSync(invalidationLogPath, hiddenInvalidationLogPath);
const missingInvalidationLog = service.check(signoffReplayInput);
assert.equal(missingInvalidationLog.gate.ready, false);
assert.ok(missingInvalidationLog.gate.blockers.some((item) => item.includes('锚点')));
fs.renameSync(hiddenInvalidationLogPath, invalidationLogPath);
const hiddenInvalidationAnchorPath = `${invalidationAnchorPath}.hidden`;
fs.renameSync(invalidationAnchorPath, hiddenInvalidationAnchorPath);
const missingInvalidationAnchor = service.check(signoffReplayInput);
assert.equal(missingInvalidationAnchor.gate.ready, false);
assert.ok(missingInvalidationAnchor.gate.blockers.some((item) => item.includes('锚点')));
fs.renameSync(hiddenInvalidationAnchorPath, invalidationAnchorPath);

const secureStorageCallsBeforeAnchorMigration = safeStorageCalls;
const internalAnchorBeforeSecureEnvelope = fs.readFileSync(invalidationAnchorPath, 'utf8');
fs.writeFileSync(invalidationAnchorPath, JSON.stringify({
  version: 1,
  scheme: 'electron-safe-storage',
  data: 'must-not-be-decrypted-in-internal-mode',
}));
const rejectedSecureAnchor = service.check(signoffReplayInput);
assert.equal(rejectedSecureAnchor.gate.blockers.some((item) => item.includes('锚点')), true);
assert.equal(safeStorageCalls, secureStorageCallsBeforeAnchorMigration);
assert.equal(JSON.parse(fs.readFileSync(invalidationAnchorPath, 'utf8')).scheme, 'electron-safe-storage');
fs.writeFileSync(invalidationAnchorPath, internalAnchorBeforeSecureEnvelope);

const internalModeInput = publicationInput('task-security-mode-transition');
const internalModeSignoff = service.sign(internalModeInput);
assert.equal(internalModeSignoff.signoff.securityMode, 'internal');
const publisherProfileContext = {
  currentPaths: () => ({ root }),
  isAuthenticated: () => true,
  publicState: () => ({
    status: 'authenticated',
    expiresAt: '2026-08-01T00:00:00.000Z',
    user: { id: 'publisher-1', displayName: '发布员', role: 'publisher' },
  }),
};
const publisherStrictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext: publisherProfileContext,
  safeStorage,
  securityMode: 'strict',
  now: () => serverNow,
});
assert.equal(publisherStrictService.check(internalModeInput).signoff, null);
const strictModeSignoff = publisherStrictService.sign(internalModeInput);
assert.equal(strictModeSignoff.signoff.securityMode, 'strict');
assert.throws(
  () => service.revoke({
    taskId: internalModeInput.taskId,
    reason: '内网模式不得撤销严格模式创建的签发记录',
  }),
  /严格安全存储保护/,
);
assert.throws(
  () => service.sign(internalModeInput),
  /严格安全存储保护/,
);
const loggedOutStrictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext,
  safeStorage,
  securityMode: 'strict',
  now: () => serverNow,
});
const loggedOutStrictCheck = loggedOutStrictService.check(internalModeInput);
assert.equal(loggedOutStrictCheck.signoff.id, strictModeSignoff.signoff.id);
assert.equal(loggedOutStrictCheck.gate.ready, false);
assert.ok(loggedOutStrictCheck.gate.blockers.some((item) => item.includes('在线登录')));

const validRegistryBeforeCorruption = fs.readFileSync(registryPath, 'utf8');
fs.writeFileSync(registryPath, '{"version":3,');
const corruptRegistryCheck = service.check(publicationInput('task-corrupt-registry'));
assert.equal(corruptRegistryCheck.gate.ready, false);
assert.ok(corruptRegistryCheck.gate.blockers.some((item) => item.includes('无法读取')));
assert.throws(
  () => service.sign(publicationInput('task-corrupt-registry-sign')),
  /审计存储无法读取/,
);
assert.equal(fs.readFileSync(registryPath, 'utf8'), '{"version":3,');
fs.writeFileSync(registryPath, validRegistryBeforeCorruption);

const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-legacy-'));
try {
  const legacyProfileContext = {
    currentPaths: () => ({ root: legacyRoot }),
    isAuthenticated: () => false,
    publicState: () => ({ cachedUser: null }),
  };
  const legacyService = createPublicationService({
    ipcMain: { handle() {} },
    profileContext: legacyProfileContext,
    securityMode: 'internal',
    now: () => serverNow,
  });
  const legacyInput = publicationInput(
    'task-legacy-registry',
    {},
    legacyService,
    legacyRoot,
  );
  fs.writeFileSync(
    path.join(legacyRoot, 'publication-signoffs.json'),
    `${JSON.stringify({
      apiVersion: 'meteomate.ai/v1',
      kind: 'PublicationSignoffRegistry',
      version: 1,
      signoffs: {
        [legacyInput.taskId]: {
          approved: true,
          reviewerName: 'Beta3 unsigned reviewer',
        },
      },
    }, null, 2)}\n`,
  );
  const migratedLegacyCheck = legacyService.check(legacyInput);
  assert.equal(migratedLegacyCheck.signoff, null);
  assert.ok(migratedLegacyCheck.gate.blockers.includes('缺少预报员或业务人员签发'));
  assert.equal(legacyService.sign(legacyInput).gate.ready, true);
  const migratedRegistry = JSON.parse(
    fs.readFileSync(path.join(legacyRoot, 'publication-signoffs.json'), 'utf8'),
  );
  assert.equal(migratedRegistry.version, 3);
  assert.equal(
    migratedRegistry.legacySignoffs[legacyInput.taskId].reviewerName,
    'Beta3 unsigned reviewer',
  );
} finally {
  fs.rmSync(legacyRoot, { recursive: true, force: true });
}

fs.rmSync(outsidePath, { force: true });
fs.rmSync(root, { recursive: true, force: true });
console.log('publication service intranet-mode tests passed');
