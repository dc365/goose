'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ArtifactRegistry = require('../harness/artifact-registry');
const EvidenceLedger = require('../harness/evidence-ledger');

const ATTESTATION_VERSION = 'meteomate-publication/v1';
const KEY_FILE = 'publication-attestation.key';

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
  delete record.lineage;
  delete record.createdAt;
  delete record.updatedAt;
  if (record.metadata && typeof record.metadata === 'object') {
    delete record.metadata.publicationAttestation;
    delete record.metadata.responseId;
  }
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

  function signaturePayload(kind, record, attestation) {
    return JSON.stringify(stable({
      kind,
      taskId: attestation.taskId,
      runId: attestation.runId,
      toolCallId: attestation.toolCallId,
      issuedAt: attestation.issuedAt,
      record: canonicalRecord(record),
    }));
  }

  function attestRecord(kind, input, context = {}) {
    if (!['Evidence', 'Artifact'].includes(kind)) throw new Error(`不支持的发布记录类型：${kind}`);
    const taskId = String(context.taskId || '').trim();
    if (!taskId) throw new Error('发布记录证明需要任务标识');
    const attestation = {
      version: ATTESTATION_VERSION,
      taskId,
      runId: context.runId || null,
      toolCallId: context.toolCallId || null,
      issuedAt: new Date(Number(now()) || Date.now()).toISOString(),
    };
    const record = normalizeRecord(kind, {
      ...normalizeRecord(kind, input, context),
      metadata: {
        ...(input.metadata || {}),
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
    const attestation = record?.metadata?.publicationAttestation;
    if (
      !attestation
      || attestation.version !== ATTESTATION_VERSION
      || String(attestation.taskId || '') !== String(context.taskId || '')
      || !/^[a-f0-9]{64}$/.test(String(attestation.value || ''))
    ) {
      return false;
    }
    const expected = crypto
      .createHmac('sha256', signingKey())
      .update(signaturePayload(kind, record, attestation))
      .digest();
    const actual = Buffer.from(attestation.value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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
    attestRuntimeEvent,
  };
}

module.exports = {
  ATTESTATION_VERSION,
  canonicalRecord,
  createPublicationAttestor,
};
