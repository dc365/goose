(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports
    ? require('./shared')
    : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.QcPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const POLICY_ID = 'meteomate.weather.qc';
  const POLICY_VERSION = `${POLICY_ID}/1.0.0`;
  const MAX_WAIVER_DURATION_MS = 24 * 60 * 60 * 1000;
  const POLICY_DEFINITION = Object.freeze({
    id: POLICY_ID,
    version: POLICY_VERSION,
    allowedStatuses: Object.freeze(['checked', 'good']),
    waivableStatuses: Object.freeze(['suspect']),
    blockedStatuses: Object.freeze(['unknown', 'unchecked', 'missing', 'bad', 'rejected']),
    maximumWaiverDurationMs: MAX_WAIVER_DURATION_MS,
  });
  const POLICY_DIGEST = '91c64e11a4bb1157089359e8047a2626f12a1f01392820d19308a8888374a42f';
  const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
  const STATUSES = Object.freeze([
    'checked',
    'good',
    'suspect',
    'unchecked',
    'missing',
    'bad',
    'rejected',
    'unknown',
  ]);
  const STATUS_LABELS = Object.freeze({
    checked: '已检查',
    good: '良好',
    suspect: '可疑',
    unchecked: '未检查',
    missing: '缺测',
    bad: '未通过',
    rejected: '已拒绝',
    unknown: '未知',
  });
  const LEGACY_STATUS_MAP = Object.freeze({
    passed: 'checked',
    checked: 'checked',
    good: 'good',
    verified: 'checked',
    suspect: 'suspect',
    unchecked: 'unchecked',
    missing: 'missing',
    bad: 'bad',
    failed: 'bad',
    rejected: 'rejected',
    unknown: 'unknown',
  });
  const STATUS_SEVERITY = Object.freeze({
    checked: 0,
    good: 0,
    suspect: 20,
    unknown: 30,
    unchecked: 40,
    missing: 50,
    bad: 60,
    rejected: 70,
  });

  function normalizedText(value) {
    return String(value ?? '').trim();
  }

  function normalizeStatus(value) {
    const status = normalizedText(value).toLowerCase();
    return LEGACY_STATUS_MAP[status] || 'unknown';
  }

  function qualityCandidate(record = {}) {
    const metadata = record?.metadata || {};
    const quality = metadata.quality ?? record.quality;
    if (record.qcStatus != null) return record.qcStatus;
    if (metadata.qcStatus != null) return metadata.qcStatus;
    if (typeof quality === 'string') return quality;
    if (quality && typeof quality === 'object') return quality.status;
    return null;
  }

  function normalizeEvidenceQc(record = {}) {
    const hasStatus = Object.prototype.hasOwnProperty.call(record, 'qcStatus');
    const hasVersion = Object.prototype.hasOwnProperty.call(record, 'qcVersion');
    return {
      qcStatus: hasStatus ? normalizeStatus(record.qcStatus) : 'unknown',
      qcVersion: hasVersion ? normalizedText(record.qcVersion) : '',
    };
  }

  function deriveEvidenceQc(record = {}) {
    return {
      qcStatus: normalizeStatus(qualityCandidate(record)),
      qcVersion: POLICY_VERSION,
    };
  }

  function aggregateStatus(values = []) {
    const statuses = (Array.isArray(values) ? values : [])
      .map((value) => normalizeStatus(
        value && typeof value === 'object' ? value.qcStatus : value
      ));
    if (!statuses.length) return 'unknown';
    return statuses.reduce((worst, status) =>
      STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst
    , 'checked');
  }

  function validTime(value) {
    if (typeof value !== 'string') return null;
    const match = RFC3339.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = match[8] == null ? 0 : Number(match[8]);
    const offsetMinute = match[9] == null ? 0 : Number(match[9]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
      month < 1
      || month > 12
      || day < 1
      || day > monthDays[month - 1]
      || hour > 23
      || minute > 59
      || second > 59
      || offsetHour > 23
      || offsetMinute > 59
    ) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function validateWaiver(waiver = {}) {
    const errors = [];
    if (waiver.apiVersion !== 'meteomate/v1') errors.push('apiVersion must be meteomate/v1');
    if (waiver.kind !== 'EvidenceQcWaiver') errors.push('kind must be EvidenceQcWaiver');
    if (!/^qc-waiver-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalizedText(waiver.id))) {
      errors.push('invalid waiver id');
    }
    if (waiver.policyVersion !== POLICY_VERSION) errors.push('waiver policy version is not current');
    if (waiver.policyDigest !== POLICY_DIGEST) errors.push('waiver policy digest is not current');
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(normalizedText(waiver.taskId))) errors.push('invalid task id');
    if (!/^[a-f0-9]{64}$/.test(normalizedText(waiver.workspaceDigest))) errors.push('invalid workspace digest');
    if (!normalizedText(waiver.evidenceId)) errors.push('missing evidence id');
    if (!/^[a-f0-9]{64}$/.test(normalizedText(waiver.evidenceDigest))) errors.push('invalid evidence digest');
    if (waiver.qcStatus !== 'suspect') errors.push('only suspect evidence can be waived');
    const reason = normalizedText(waiver.reason);
    if (reason.length < 8 || reason.length > 1000) errors.push('waiver reason must contain 8-1000 characters');
    if (!normalizedText(waiver.reviewerId)) errors.push('missing reviewer id');
    if (!normalizedText(waiver.reviewerName)) errors.push('missing reviewer name');
    if (!normalizedText(waiver.reviewerRole)) errors.push('missing reviewer role');
    if (!['account-profile', 'local-profile'].includes(waiver.verification)) {
      errors.push('invalid reviewer verification');
    }
    if (!['internal', 'strict'].includes(waiver.securityMode)) {
      errors.push('invalid waiver security mode');
    }
    const approvedAt = validTime(waiver.approvedAt);
    const expiresAt = validTime(waiver.expiresAt);
    if (approvedAt == null) errors.push('invalid approvedAt');
    if (expiresAt == null) errors.push('invalid expiresAt');
    if (approvedAt != null && expiresAt != null) {
      if (expiresAt <= approvedAt) errors.push('expiresAt must be after approvedAt');
      if (expiresAt - approvedAt > MAX_WAIVER_DURATION_MS) errors.push('waiver duration exceeds policy limit');
    }
    if (waiver.revokedAt != null && validTime(waiver.revokedAt) == null) errors.push('invalid revokedAt');
    if (waiver.revokedAt != null && !normalizedText(waiver.revokedBy)) errors.push('missing revokedBy');
    if (
      waiver.revokedAt != null
      && approvedAt != null
      && validTime(waiver.revokedAt) != null
      && validTime(waiver.revokedAt) < approvedAt
    ) {
      errors.push('revokedAt precedes approvedAt');
    }
    return { valid: errors.length === 0, errors };
  }

  function waiverMatches(record, waiver, options = {}) {
    if (!validateWaiver(waiver).valid || waiver.revokedAt) return false;
    const qc = normalizeEvidenceQc(record);
    if (qc.qcStatus !== 'suspect' || qc.qcVersion !== POLICY_VERSION) return false;
    if (normalizedText(waiver.taskId) !== normalizedText(options.taskId)) return false;
    if (normalizedText(waiver.workspaceDigest) !== normalizedText(options.workspaceDigest)) return false;
    if (normalizedText(waiver.evidenceId) !== normalizedText(record?.id)) return false;
    if (normalizedText(waiver.evidenceDigest) !== normalizedText(options.evidenceDigest)) return false;
    if (
      options.securityMode
      && normalizedText(waiver.securityMode) !== normalizedText(options.securityMode)
    ) {
      return false;
    }
    const approvedAt = validTime(waiver.approvedAt);
    const expiresAt = validTime(waiver.expiresAt);
    const at = Number.isFinite(Number(options.at)) ? Number(options.at) : Date.now();
    return approvedAt != null && expiresAt != null && approvedAt <= at && at < expiresAt;
  }

  function evaluateEvidence(record, waivers = [], options = {}) {
    const qc = normalizeEvidenceQc(record);
    const errors = [];
    const warnings = [];
    let waiver = null;
    if (qc.qcVersion !== POLICY_VERSION) {
      errors.push(`QC 策略版本 ${qc.qcVersion || '缺失'} 与当前 ${POLICY_VERSION} 不一致`);
    } else if (qc.qcStatus === 'suspect') {
      waiver = (Array.isArray(waivers) ? waivers : []).find((candidate) =>
        waiverMatches(record, candidate, options)
      ) || null;
      if (!waiver) {
        errors.push('QC 状态 suspect，需要有审计记录的人工豁免');
      } else {
        warnings.push(`QC suspect 已由 ${waiver.reviewerName} 人工豁免`);
      }
    } else if (['bad', 'rejected'].includes(qc.qcStatus)) {
      errors.push(`QC 状态 ${qc.qcStatus} 不可豁免`);
    } else if (!['checked', 'good'].includes(qc.qcStatus)) {
      errors.push(`QC 状态 ${qc.qcStatus} 阻止发布`);
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      qcStatus: qc.qcStatus,
      qcVersion: qc.qcVersion,
      waivable: qc.qcVersion === POLICY_VERSION && qc.qcStatus === 'suspect',
      waiver,
    };
  }

  function summarize(records = [], waivers = [], options = {}) {
    const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    const activeWaiverIds = [];
    const findings = [];
    for (const record of Array.isArray(records) ? records : []) {
      const qc = normalizeEvidenceQc(record);
      statusCounts[qc.qcStatus] += 1;
      const evidenceDigest = typeof options.evidenceDigest === 'function'
        ? options.evidenceDigest(record)
        : '';
      const result = evaluateEvidence(record, waivers, {
        ...options,
        evidenceDigest,
      });
      if (result.waiver?.id) activeWaiverIds.push(result.waiver.id);
      findings.push({
        evidenceId: normalizedText(record?.id) || null,
        qcStatus: result.qcStatus,
        qcVersion: result.qcVersion,
        valid: result.valid,
        waivable: result.waivable,
        waiverId: result.waiver?.id || null,
      });
    }
    return {
      policyId: POLICY_ID,
      policyVersion: POLICY_VERSION,
      policyDigest: POLICY_DIGEST,
      statusCounts,
      activeWaiverIds: [...new Set(activeWaiverIds)],
      findings,
    };
  }

  function labelForStatus(value) {
    return STATUS_LABELS[normalizeStatus(value)] || STATUS_LABELS.unknown;
  }

  return {
    POLICY_ID,
    POLICY_VERSION,
    POLICY_DEFINITION,
    POLICY_DIGEST,
    MAX_WAIVER_DURATION_MS,
    STATUSES,
    STATUS_LABELS,
    normalizeStatus,
    rfc3339Timestamp: validTime,
    normalizeEvidenceQc,
    deriveEvidenceQc,
    aggregateStatus,
    validateWaiver,
    waiverMatches,
    evaluateEvidence,
    summarize,
    labelForStatus,
  };
});
