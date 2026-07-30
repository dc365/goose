'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ArtifactRegistry = require('../harness/artifact-registry');
const {
  ATTESTATION_VERSION,
  LEGACY_ATTESTATION_VERSION,
  AUDIT_ATTESTATION_VERSION,
  createPublicationAttestor,
} = require('../capabilities/publication-attestor.cjs');

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

function legacyPayload(kind, record, attestation) {
  return JSON.stringify(stable({
    kind,
    taskId: attestation.taskId,
    runId: attestation.runId,
    toolCallId: attestation.toolCallId,
    issuedAt: attestation.issuedAt,
    record: legacyCanonicalRecord(record),
  }));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-attestor-'));
try {
  const profileContext = {
    currentPaths: () => ({ root }),
  };
  const now = Date.parse('2026-07-31T04:00:00.000Z');
  const attestor = createPublicationAttestor({ profileContext, now: () => now });
  const recordContext = {
    taskId: 'task-attestor',
    runId: 'run-attestor',
    toolCallId: 'weather-render',
    extensionName: 'gis-map',
    toolName: 'weather_render_dataset_map',
  };

  const artifact = attestor.attestRecord('Artifact', {
    id: 'artifact-attestor',
    name: 'forecast.pdf',
    path: path.join(root, 'forecast.pdf'),
    status: 'ready',
    contentHash: 'a'.repeat(64),
    evidenceIds: ['evidence-1', 'evidence-2'],
    lineage: {
      contextSnapshotId: 'snapshot-1',
      expertId: 'expert-1',
      templateId: 'template-1',
    },
  }, recordContext);

  assert.equal(artifact.metadata.publicationAttestation.version, ATTESTATION_VERSION);
  assert.equal(artifact.metadata.publicationAttestation.extensionName, recordContext.extensionName);
  assert.equal(artifact.metadata.publicationAttestation.toolName, recordContext.toolName);
  assert.equal(artifact.metadata.extensionName, recordContext.extensionName);
  assert.equal(artifact.metadata.toolName, recordContext.toolName);
  assert.equal(attestor.verifyRecord('Artifact', artifact, recordContext), true);
  assert.deepEqual(artifact.lineage.evidenceIds, ['evidence-1', 'evidence-2']);

  for (const mutate of [
    (record) => record.lineage.evidenceIds.push('forged-evidence'),
    (record) => { record.lineage.taskId = 'forged-task'; },
    (record) => { record.lineage.runId = 'forged-run'; },
    (record) => { record.lineage.toolCallId = 'forged-tool'; },
    (record) => { record.lineage.contextSnapshotId = 'forged-snapshot'; },
    (record) => { record.metadata.extensionName = 'forged-extension'; },
    (record) => { record.metadata.toolName = 'forged-tool-name'; },
    (record) => { record.metadata.publicationAttestation.extensionName = 'forged-extension'; },
    (record) => { record.metadata.publicationAttestation.toolName = 'forged-tool-name'; },
  ]) {
    const forged = clone(artifact);
    mutate(forged);
    assert.equal(attestor.verifyRecord('Artifact', forged, recordContext), false);
  }
  assert.equal(attestor.verifyRecord('Artifact', artifact, {
    ...recordContext,
    extensionName: 'another-extension',
  }), false);
  assert.equal(attestor.verifyRecord('Artifact', artifact, {
    ...recordContext,
    toolName: 'another-tool',
  }), false);

  const responseTagged = clone(artifact);
  responseTagged.metadata.responseId = 'renderer-response-id';
  assert.equal(
    attestor.verifyRecord('Artifact', responseTagged, recordContext),
    true,
    'transport-only responseId must remain outside the canonical record',
  );

  const downgraded = clone(artifact);
  downgraded.metadata.publicationAttestation.version = LEGACY_ATTESTATION_VERSION;
  assert.equal(
    attestor.verifyRecord('Artifact', downgraded, recordContext),
    false,
    'a v2 proof cannot be downgraded into the legacy verification path',
  );

  const legacyAttestation = {
    version: LEGACY_ATTESTATION_VERSION,
    taskId: recordContext.taskId,
    runId: recordContext.runId,
    toolCallId: recordContext.toolCallId,
    issuedAt: '2026-07-30T04:00:00.000Z',
  };
  const legacyArtifact = ArtifactRegistry.createArtifact({
    id: 'artifact-legacy',
    name: 'legacy.pdf',
    path: path.join(root, 'legacy.pdf'),
    status: 'ready',
    contentHash: 'b'.repeat(64),
    evidenceIds: ['legacy-evidence'],
    metadata: { publicationAttestation: legacyAttestation },
  }, recordContext);
  const key = Buffer.from(
    fs.readFileSync(path.join(root, 'publication-attestation.key'), 'utf8').trim(),
    'hex',
  );
  legacyArtifact.metadata.publicationAttestation.value = crypto
    .createHmac('sha256', key)
    .update(legacyPayload('Artifact', legacyArtifact, legacyAttestation))
    .digest('hex');
  assert.equal(
    attestor.verifyRecord('Artifact', legacyArtifact, { taskId: recordContext.taskId }),
    true,
    'existing v1 proofs must remain verifiable only through the legacy path',
  );

  const signoff = attestor.attestPublicationSignoff({
    id: 'signoff-1',
    taskId: recordContext.taskId,
    signedAt: '2026-07-31T04:01:00.000Z',
    approved: true,
    reviewerId: 'forecaster-1',
    reviewerName: '值班员',
    evidenceDigest: 'c'.repeat(64),
    artifactDigest: 'd'.repeat(64),
  });
  assert.equal(signoff.apiVersion, 'meteomate/v1');
  assert.equal(signoff.kind, 'PublicationSignoff');
  assert.equal(signoff.auditAttestation.version, AUDIT_ATTESTATION_VERSION);
  assert.equal(attestor.verifyPublicationSignoff(signoff, { taskId: recordContext.taskId }), true);
  assert.equal(attestor.verifyAuditRecord('PublicationSignoff', signoff), true);
  assert.equal(attestor.verifyEvidenceQcWaiver(signoff), false);

  for (const mutate of [
    (record) => { record.reviewerId = 'forged-reviewer'; },
    (record) => { record.signedAt = '2026-07-31T05:01:00.000Z'; },
    (record) => { record.revokedAt = '2026-07-31T06:01:00.000Z'; },
    (record) => { record.taskId = 'forged-task'; },
    (record) => { record.auditAttestation.kind = 'EvidenceQcWaiver'; },
  ]) {
    const forged = clone(signoff);
    mutate(forged);
    assert.equal(attestor.verifyPublicationSignoff(forged, { taskId: recordContext.taskId }), false);
  }

  const revokedSignoff = attestor.attestPublicationSignoff({
    ...signoff,
    revokedAt: '2026-07-31T06:01:00.000Z',
    revokedBy: 'forecaster-2',
  });
  assert.equal(
    attestor.verifyPublicationSignoff(revokedSignoff, { taskId: recordContext.taskId }),
    true,
  );

  const waiver = attestor.attestEvidenceQcWaiver({
    id: 'qc-waiver-11111111-1111-4111-8111-111111111111',
    taskId: recordContext.taskId,
    evidenceId: 'evidence-suspect',
    policyVersion: 'meteomate.weather.qc/1.0.0',
    qcStatus: 'suspect',
    evidenceDigest: 'e'.repeat(64),
    reason: '已与值班人员核对原始观测，确认该可疑值可用于本次产品。',
    reviewerId: 'forecaster-1',
    reviewerName: '值班员',
    reviewerRole: 'publisher',
    verification: 'account-profile',
    securityMode: 'strict',
    approvedAt: '2026-07-31T04:02:00.000Z',
    revokedAt: null,
  });
  assert.equal(waiver.apiVersion, 'meteomate/v1');
  assert.equal(waiver.kind, 'EvidenceQcWaiver');
  assert.equal(waiver.auditAttestation.version, AUDIT_ATTESTATION_VERSION);
  assert.equal(attestor.verifyEvidenceQcWaiver(waiver, {
    taskId: recordContext.taskId,
    evidenceId: waiver.evidenceId,
  }), true);
  assert.equal(attestor.verifyAuditRecord('EvidenceQcWaiver', waiver), true);
  assert.equal(attestor.verifyPublicationSignoff(waiver), false);

  for (const mutate of [
    (record) => { record.reason = '篡改后的原因'; },
    (record) => { record.evidenceDigest = 'f'.repeat(64); },
    (record) => { record.evidenceId = 'forged-evidence'; },
    (record) => { record.approvedAt = '2026-07-31T05:02:00.000Z'; },
    (record) => { record.revokedAt = '2026-07-31T06:02:00.000Z'; },
  ]) {
    const forged = clone(waiver);
    mutate(forged);
    assert.equal(attestor.verifyEvidenceQcWaiver(forged, {
      taskId: recordContext.taskId,
      evidenceId: waiver.evidenceId,
    }), false);
  }

  const revokedWaiver = attestor.attestEvidenceQcWaiver({
    ...waiver,
    revokedAt: '2026-07-31T06:02:00.000Z',
    revokedBy: 'forecaster-2',
  });
  assert.equal(attestor.verifyEvidenceQcWaiver(revokedWaiver, {
    taskId: recordContext.taskId,
    evidenceId: waiver.evidenceId,
  }), true);

  assert.throws(
    () => attestor.attestPublicationSignoff(signoff, { taskId: 'another-task' }),
    /任务标识不匹配/,
  );
  assert.throws(
    () => attestor.attestEvidenceQcWaiver(waiver, { evidenceId: 'another-evidence' }),
    /证据标识不匹配/,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('publication attestor audit tests passed');
