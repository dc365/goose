(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const QcPolicy = typeof module === 'object' && module.exports ? require('./qc-policy') : root.MeteoMateHarness.QcPolicy;
  const api = factory(Shared, QcPolicy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.EvidenceLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared, QcPolicy) {
  'use strict';

  function createEvidence(input = {}, lineage = {}) {
    if (!input.source) throw new Error('Evidence requires a source');
    const confidence = Shared.clampNumber(input.confidence, 0, 1, null);
    const hasQcStatus = Object.prototype.hasOwnProperty.call(input, 'qcStatus');
    const hasQcVersion = Object.prototype.hasOwnProperty.call(input, 'qcVersion');
    const qc = QcPolicy.normalizeEvidenceQc(input);
    const record = {
      apiVersion: 'meteomate/v1',
      kind: 'Evidence',
      id: input.id || Shared.createId('evidence'),
      evidenceType: input.evidenceType || 'meteorological-fact',
      source: input.source,
      sourceVersion: input.sourceVersion || null,
      model: input.model || null,
      initTime: input.initTime || null,
      validTime: input.validTime || null,
      forecastHour: Number.isFinite(input.forecastHour) ? input.forecastHour : null,
      region: input.region || null,
      variable: input.variable || null,
      level: input.level || null,
      unit: input.unit || null,
      value: input.value ?? null,
      algorithm: input.algorithm ? Shared.deepClone(input.algorithm) : null,
      confidence,
      uncertainty: input.uncertainty || null,
      ...(hasQcStatus ? { qcStatus: qc.qcStatus } : {}),
      ...(hasQcVersion ? { qcVersion: qc.qcVersion } : {}),
      createdAt: input.createdAt || Date.now(),
      expiresAt: input.expiresAt || null,
      lineage: {
        taskId: lineage.taskId || input.lineage?.taskId || input.taskId || null,
        runId: lineage.runId || input.lineage?.runId || input.runId || null,
        contextSnapshotId: lineage.contextSnapshotId || input.lineage?.contextSnapshotId || input.contextSnapshotId || null,
        toolCallId: lineage.toolCallId || input.lineage?.toolCallId || input.toolCallId || null,
      },
      metadata: Shared.deepClone(input.metadata || {}),
    };
    record.recordHash = Shared.contentHash(record);
    return record;
  }

  function semanticRecord(record = {}) {
    const metadata = Shared.deepClone(record.metadata || {});
    delete metadata.responseId;
    const semantic = {
      ...record,
      metadata,
    };
    delete semantic.id;
    delete semantic.createdAt;
    delete semantic.lineage;
    delete semantic.recordHash;
    return semantic;
  }

  function semanticHash(record = {}) {
    return Shared.contentHash(semanticRecord(record));
  }

  function registerEvidence(task, input, lineage = {}) {
    task.evidence = Array.isArray(task.evidence) ? task.evidence : [];
    const record = createEvidence(input, { taskId: task.id, contextSnapshotId: task.contextSnapshotId, ...lineage });
    const duplicateId = task.evidence.find((item) => item.id === record.id);
    if (duplicateId) {
      const reconciled = {
        ...duplicateId,
        metadata: {
          ...(duplicateId.metadata || {}),
          ...(input.metadata || {}),
        },
      };
      for (const key of Object.keys(input)) {
        if (['id', 'createdAt', 'lineage', 'recordHash', 'metadata'].includes(key)) continue;
        if (Object.prototype.hasOwnProperty.call(record, key)) reconciled[key] = record[key];
      }
      if (semanticHash(duplicateId) !== semanticHash(reconciled)) {
        throw new Error(`Evidence ID conflict: ${record.id}`);
      }
      return duplicateId;
    }
    const exactDuplicate = task.evidence.find((item) => item.recordHash === record.recordHash);
    if (exactDuplicate) return exactDuplicate;
    task.evidence.push(record);
    task.evidenceIds = Shared.uniqueStrings([...(task.evidenceIds || []), record.id]);
    return record;
  }

  function isExpired(record, at = Date.now()) {
    return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= at);
  }

  function validateEvidence(record) {
    const errors = [];
    const warnings = [];
    if (!record?.source) errors.push('missing source');
    if (!record?.validTime && record?.evidenceType === 'meteorological-fact') warnings.push('missing validTime');
    if (record?.value != null && !record?.unit) warnings.push('value has no unit');
    if (record?.confidence != null && (record.confidence < 0 || record.confidence > 1)) errors.push('invalid confidence');
    if (isExpired(record)) warnings.push('evidence expired');
    return { valid: errors.length === 0, errors, warnings };
  }

  return {
    createEvidence,
    semanticRecord,
    semanticHash,
    registerEvidence,
    isExpired,
    validateEvidence,
  };
});
