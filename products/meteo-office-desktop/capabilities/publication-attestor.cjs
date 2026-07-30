'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ArtifactRegistry = require('../harness/artifact-registry');
const EvidenceLedger = require('../harness/evidence-ledger');

const LEGACY_ATTESTATION_VERSION = 'meteomate-publication/v1';
const ATTESTATION_VERSION = 'meteomate-publication/v2';
const AUDIT_ATTESTATION_VERSION = 'meteomate-publication-audit/v1';
const KEY_FILE = 'publication-attestation.key';
const RECORD_KINDS = new Set(['Evidence', 'Artifact']);
const AUDIT_KINDS = new Set(['PublicationSignoff', 'EvidenceQcWaiver']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonicalRecord(input = {}) {
  const record = clone(input) || {};
  delete record.recordHash;
  delete record.createdAt;
  delete record.updatedAt;
  if (record.metadata && typeof record.metadata === 'object') {
    delete record.metadata.publicationAttestation;
    delete record.metadata.responseId;
  }
  return stable(record);
}

function legacyCanonicalRecord(input = {}) {
  const record = canonicalRecord(input);
  delete record.lineage;
  return stable(record);
}

function canonicalAuditRecord(input = {}) {
  const record = clone(input) || {};
  delete record.auditAttestation;
  return stable(record);
}

function normalizeRecord(kind, input, context = {}) {
  const lineage = {
    taskId: context.taskId || null,
    runId: context.runId || null,
    toolCallId: context.toolCallId || null,
  };
  return kind === 'Evidence'
    ? EvidenceLedger.createEvidence(input, lineage)
    : ArtifactRegistry.createArtifact(input, lineage);
}

function validTimestamp(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && Number.isFinite(Date.parse(value));
}

function prepareAuditRecord(kind, input = {}, context = {}) {
  if (!AUDIT_KINDS.has(kind)) throw new Error(`不支持的发布审计记录类型：${kind}`);
  const record = clone(input) || {};
  if (record.kind && record.kind !== kind) throw new Error(`发布审计记录类型不匹配：${kind}`);
  record.apiVersion ||= 'meteomate/v1';
  record.kind = kind;
  record.taskId ||= context.taskId || null;
  if (kind === 'EvidenceQcWaiver') record.evidenceId ||= context.evidenceId || null;
  auditIdentity(kind, record, context);
  delete record.auditAttestation;
  return record;
}

function auditIdentity(kind, record = {}, context = {}) {
  if (!AUDIT_KINDS.has(kind) || record.kind !== kind || record.apiVersion !== 'meteomate/v1') {
    throw new Error('发布审计记录契约无效');
  }
  const taskId = String(record.taskId || '').trim();
  if (!taskId) throw new Error('发布审计记录需要任务标识');
  if (context.taskId && taskId !== String(context.taskId).trim()) {
    throw new Error('发布审计记录任务标识不匹配');
  }
  if (kind === 'PublicationSignoff') {
    if (!validTimestamp(record.signedAt)) throw new Error('发布签发记录需要有效 signedAt');
    if (record.revokedAt != null && !validTimestamp(record.revokedAt)) {
      throw new Error('发布签发记录 revokedAt 无效');
    }
    return {
      taskId,
      signedAt: record.signedAt,
      revokedAt: record.revokedAt || null,
    };
  }
  const evidenceId = String(record.evidenceId || '').trim();
  if (!evidenceId) throw new Error('QC 豁免记录需要证据标识');
  if (context.evidenceId && evidenceId !== String(context.evidenceId).trim()) {
    throw new Error('QC 豁免记录证据标识不匹配');
  }
  if (!validTimestamp(record.approvedAt)) throw new Error('QC 豁免记录需要有效 approvedAt');
  if (record.revokedAt != null && !validTimestamp(record.revokedAt)) {
    throw new Error('QC 豁免记录 revokedAt 无效');
  }
  return {
    taskId,
    evidenceId,
    approvedAt: record.approvedAt,
    revokedAt: record.revokedAt || null,
  };
}

function createPublicationAttestor({ profileContext, now = () => Date.now() } = {}) {
  if (!profileContext) throw new Error('Publication attestor requires profileContext');
  const keyCache = new Map();

  function keyPath() {
    return path.join(profileContext.currentPaths().root, KEY_FILE);
  }

  function signingKey() {
    const target = keyPath();
    if (keyCache.has(target)) return keyCache.get(target);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(target)) {
      try {
        fs.writeFileSync(target, `${crypto.randomBytes(32).toString('hex')}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    const encoded = fs.readFileSync(target, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error('发布记录证明密钥无效');
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
    const key = Buffer.from(encoded, 'hex');
    keyCache.set(target, key);
    return key;
  }

  function legacySignaturePayload(kind, record, attestation) {
    return JSON.stringify(stable({
      kind,
      taskId: attestation.taskId,
      runId: attestation.runId,
      toolCallId: attestation.toolCallId,
      issuedAt: attestation.issuedAt,
      record: legacyCanonicalRecord(record),
    }));
  }

  function signaturePayload(kind, record, attestation) {
    const proof = clone(attestation);
    delete proof.value;
    return JSON.stringify(stable({
      domain: 'meteomate-publication-record',
      proof,
      record: canonicalRecord(record),
    }));
  }

  function auditSignaturePayload(record, attestation) {
    const proof = clone(attestation);
    delete proof.value;
    return JSON.stringify(stable({
      domain: 'meteomate-publication-audit',
      proof,
      record: canonicalAuditRecord(record),
    }));
  }

  function attestRecord(kind, input, context = {}) {
    if (!RECORD_KINDS.has(kind)) throw new Error(`不支持的发布记录类型：${kind}`);
    const taskId = String(context.taskId || '').trim();
    if (!taskId) throw new Error('发布记录证明需要任务标识');
    const inputLineage = input?.lineage || {};
    const extensionName = context.extensionName || input?.metadata?.extensionName || null;
    const toolName = context.toolName || input?.metadata?.toolName || null;
    const attestation = {
      version: ATTESTATION_VERSION,
      taskId,
      runId: context.runId || inputLineage.runId || input?.runId || null,
      toolCallId: context.toolCallId || inputLineage.toolCallId || input?.toolCallId || null,
      extensionName,
      toolName,
      issuedAt: new Date(Number(now()) || Date.now()).toISOString(),
    };
    const record = normalizeRecord(kind, {
      ...normalizeRecord(kind, input, context),
      metadata: {
        ...(input.metadata || {}),
        extensionName,
        toolName,
        teamMemberId: context.teamMemberId || input.metadata?.teamMemberId || null,
        publicationAttestation: attestation,
      },
    }, context);
    attestation.value = crypto
      .createHmac('sha256', signingKey())
      .update(signaturePayload(kind, record, attestation))
      .digest('hex');
    return normalizeRecord(kind, {
      ...record,
      metadata: {
        ...(record.metadata || {}),
        publicationAttestation: attestation,
      },
    }, context);
  }

  function verifyRecord(kind, record, context = {}) {
    if (!RECORD_KINDS.has(kind)) return false;
    const attestation = record?.metadata?.publicationAttestation;
    if (
      !attestation
      || ![ATTESTATION_VERSION, LEGACY_ATTESTATION_VERSION].includes(attestation.version)
      || String(attestation.taskId || '') !== String(context.taskId || '')
      || !/^[a-f0-9]{64}$/.test(String(attestation.value || ''))
    ) {
      return false;
    }
    if (attestation.version === ATTESTATION_VERSION) {
      if (
        String(attestation.extensionName || '') !== String(record?.metadata?.extensionName || '')
        || String(attestation.toolName || '') !== String(record?.metadata?.toolName || '')
        || (context.extensionName && String(attestation.extensionName || '') !== String(context.extensionName))
        || (context.toolName && String(attestation.toolName || '') !== String(context.toolName))
      ) {
        return false;
      }
    }
    const payload = attestation.version === LEGACY_ATTESTATION_VERSION
      ? legacySignaturePayload(kind, record, attestation)
      : signaturePayload(kind, record, attestation);
    const expected = crypto
      .createHmac('sha256', signingKey())
      .update(payload)
      .digest();
    const actual = Buffer.from(attestation.value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  function attestAuditRecord(kind, input, context = {}) {
    const record = prepareAuditRecord(kind, input, context);
    const identity = auditIdentity(kind, record, context);
    const attestation = {
      version: AUDIT_ATTESTATION_VERSION,
      kind,
      ...identity,
    };
    attestation.value = crypto
      .createHmac('sha256', signingKey())
      .update(auditSignaturePayload(record, attestation))
      .digest('hex');
    return {
      ...record,
      auditAttestation: attestation,
    };
  }

  function verifyAuditRecord(kind, record, context = {}) {
    let identity;
    try {
      identity = auditIdentity(kind, record, context);
    } catch {
      return false;
    }
    const attestation = record?.auditAttestation;
    if (
      !attestation
      || attestation.version !== AUDIT_ATTESTATION_VERSION
      || attestation.kind !== kind
      || !/^[a-f0-9]{64}$/.test(String(attestation.value || ''))
    ) {
      return false;
    }
    for (const [key, value] of Object.entries(identity)) {
      if (String(attestation[key] ?? '') !== String(value ?? '')) return false;
    }
    const expected = crypto
      .createHmac('sha256', signingKey())
      .update(auditSignaturePayload(record, attestation))
      .digest();
    const actual = Buffer.from(attestation.value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  function attestPublicationSignoff(input, context = {}) {
    return attestAuditRecord('PublicationSignoff', input, context);
  }

  function verifyPublicationSignoff(record, context = {}) {
    return verifyAuditRecord('PublicationSignoff', record, context);
  }

  function attestEvidenceQcWaiver(input, context = {}) {
    return attestAuditRecord('EvidenceQcWaiver', input, context);
  }

  function verifyEvidenceQcWaiver(record, context = {}) {
    return verifyAuditRecord('EvidenceQcWaiver', record, context);
  }

  function attestRuntimeEvent(event = {}) {
    if (event.type === 'evidence_created' && (event.evidence || event.record || event.payload)) {
      const key = event.evidence ? 'evidence' : event.record ? 'record' : 'payload';
      return {
        ...event,
        [key]: attestRecord('Evidence', event[key], event),
      };
    }
    if (event.type === 'artifact_created' && (event.artifact || event.record || event.payload)) {
      const key = event.artifact ? 'artifact' : event.record ? 'record' : 'payload';
      return {
        ...event,
        [key]: attestRecord('Artifact', event[key], event),
      };
    }
    return event;
  }

  return {
    attestRecord,
    verifyRecord,
    attestAuditRecord,
    verifyAuditRecord,
    attestPublicationSignoff,
    verifyPublicationSignoff,
    attestEvidenceQcWaiver,
    verifyEvidenceQcWaiver,
    attestRuntimeEvent,
  };
}

module.exports = {
  ATTESTATION_VERSION,
  LEGACY_ATTESTATION_VERSION,
  AUDIT_ATTESTATION_VERSION,
  canonicalRecord,
  canonicalAuditRecord,
  createPublicationAttestor,
};
