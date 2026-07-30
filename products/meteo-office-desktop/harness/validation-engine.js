(function (root, factory) {
  const ArtifactRegistry = typeof module === 'object' && module.exports ? require('./artifact-registry') : root.MeteoMateHarness.ArtifactRegistry;
  const EvidenceLedger = typeof module === 'object' && module.exports ? require('./evidence-ledger') : root.MeteoMateHarness.EvidenceLedger;
  const QcPolicy = typeof module === 'object' && module.exports ? require('./qc-policy') : root.MeteoMateHarness.QcPolicy;
  const api = factory(ArtifactRegistry, EvidenceLedger, QcPolicy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ValidationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ArtifactRegistry, EvidenceLedger, QcPolicy) {
  'use strict';

  function validRfc3339(value) {
    return QcPolicy.rfc3339Timestamp(value) != null;
  }

  function validatePublicationMetadata(metadata = {}, label = 'record') {
    const errors = [];
    if (typeof metadata.classification !== 'string'
      || !['demo', 'experimental', 'beta', 'production'].includes(metadata.classification)) {
      errors.push(`${label} has invalid maturity classification`);
    }
    if (typeof metadata.synthetic !== 'boolean') {
      errors.push(`${label} synthetic flag must be a boolean`);
    }
    if (metadata.official != null && typeof metadata.official !== 'boolean') {
      errors.push(`${label} official flag must be a boolean`);
    }
    return errors;
  }

  function publicationEvidenceValidation(record, options = {}) {
    const errors = [];
    const warnings = [];
    const base = EvidenceLedger.validateEvidence(record);
    errors.push(...base.errors);
    warnings.push(...base.warnings);
    const metadata = record?.metadata || {};
    errors.push(...validatePublicationMetadata(metadata, 'evidence'));
    const synthetic = metadata.synthetic === true || metadata.classification === 'demo';
    if (synthetic && options.allowSynthetic !== true) errors.push('synthetic evidence is not publishable');
    if (metadata.classification === 'experimental') errors.push('experimental evidence is not publishable');
    if (record?.evidenceType === 'meteorological-fact') {
      if (!validRfc3339(record?.validTime)) errors.push('meteorological fact has invalid validTime');
      if (!validRfc3339(record?.expiresAt)) errors.push('meteorological fact has invalid expiresAt');
    } else {
      if (record?.validTime != null && !validRfc3339(record.validTime)) errors.push('evidence has invalid validTime');
      if (record?.expiresAt != null && !validRfc3339(record.expiresAt)) errors.push('evidence has invalid expiresAt');
    }
    if (record?.value != null && !record?.unit) errors.push('numeric evidence has no unit');
    if (!record?.sourceVersion) warnings.push('evidence has no sourceVersion');
    if (EvidenceLedger.isExpired(record, options.at || Date.now())) errors.push('evidence expired');
    const evidenceDigest = typeof options.evidenceDigest === 'function'
      ? options.evidenceDigest(record)
      : EvidenceLedger.semanticHash(record);
    const qc = QcPolicy.evaluateEvidence(record, options.qcWaivers, {
      taskId: options.taskId || record?.lineage?.taskId || '',
      workspaceDigest: options.workspaceDigest || '',
      evidenceDigest,
      securityMode: options.securityMode || '',
      at: options.at,
    });
    errors.push(...qc.errors);
    warnings.push(...qc.warnings);
    return { valid: errors.length === 0, errors, warnings, qc };
  }

  function validateMeteorologicalAnalysis(analysis = {}, evidenceRecords = [], options = {}) {
    const errors = [];
    const warnings = [];
    if (!analysis.region) warnings.push('分析未指定区域');
    if (!analysis.issueTime && !analysis.issue_time) warnings.push('分析未指定发布时间');
    if (!analysis.validPeriod && !analysis.valid_period) warnings.push('分析未指定有效时段');
    const conclusions = analysis.forecastConclusions || analysis.forecast_conclusions || analysis.conclusions || [];
    if (!Array.isArray(conclusions) || conclusions.length === 0) errors.push('缺少预报结论');
    const evidenceIds = new Set(evidenceRecords.map((record) => String(record?.id || '')).filter(Boolean));
    const referencedEvidenceIds = new Set();
    for (const conclusion of Array.isArray(conclusions) ? conclusions : []) {
      if (!String(conclusion?.text || conclusion?.title || '').trim()) errors.push('预报结论缺少内容');
      const ids = conclusion.evidenceIds || conclusion.evidence_ids || [];
      if (!Array.isArray(ids) || ids.length === 0) errors.push(`结论“${conclusion.text || conclusion.title || '未命名'}”没有证据引用`);
      for (const id of ids || []) {
        const normalizedId = String(id || '');
        if (normalizedId) referencedEvidenceIds.add(normalizedId);
        if (!evidenceIds.has(normalizedId)) errors.push(`引用了不存在的证据：${id}`);
      }
    }
    for (const record of evidenceRecords) {
      const result = publicationEvidenceValidation(record, options);
      const referenced = referencedEvidenceIds.has(String(record?.id || ''));
      const prefix = referenced ? '证据' : '关联证据';
      errors.push(...result.errors.map((message) => `${prefix} ${record?.id || '未知'}: ${message}`));
      warnings.push(...result.warnings.map((message) => `${prefix} ${record?.id || '未知'}: ${message}`));
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function runPublicationGate({
    taskId = '',
    analysis = {},
    artifacts = [],
    evidence = [],
    qcWaivers = [],
    humanSignoff = null,
    allowSynthetic = false,
    workspaceDigest = '',
    evidenceDigest = null,
    securityMode = '',
    at = Date.now(),
  }) {
    const analysisResult = validateMeteorologicalAnalysis(analysis, evidence, {
      allowSynthetic,
      at,
      taskId,
      qcWaivers,
      workspaceDigest,
      evidenceDigest,
      securityMode,
    });
    const artifactErrors = [];
    const artifactWarnings = [];
    for (const artifact of artifacts) {
      const result = ArtifactRegistry.validateArtifact(artifact);
      artifactErrors.push(...result.errors.map((message) => `成果物 ${artifact.id || artifact.name}: ${message}`));
      if (!['ready', 'published'].includes(artifact?.status)) {
        artifactErrors.push(`成果物 ${artifact.id || artifact.name}: 状态必须为 ready 或 published`);
      }
      if (artifact?.metadata?.synthetic === true && !allowSynthetic) artifactErrors.push(`成果物 ${artifact.id || artifact.name}: 构造数据成果不能正式发布`);
      if (artifact?.metadata?.classification === 'experimental') artifactErrors.push(`成果物 ${artifact.id || artifact.name}: 实验成果不能正式发布`);
      artifactErrors.push(...validatePublicationMetadata(
        artifact?.metadata || {},
        `artifact ${artifact.id || artifact.name}`
      ).map((message) => `成果物 ${artifact.id || artifact.name}: ${message}`));
      if (!artifact?.contentHash) artifactWarnings.push(`成果物 ${artifact.id || artifact.name}: 缺少内容摘要`);
    }
    if (!artifacts.length) artifactErrors.push('缺少可交付成果物');
    const blockers = [...new Set([...analysisResult.errors, ...artifactErrors])];
    if (!humanSignoff?.approved) blockers.push('缺少预报员或业务人员签发');
    return {
      ready: blockers.length === 0,
      status: blockers.length === 0 ? 'ready' : 'draft',
      blockers: [...new Set(blockers)],
      warnings: [...new Set([...analysisResult.warnings, ...artifactWarnings])],
      checkedAt: at,
      signoff: humanSignoff || null,
      qc: QcPolicy.summarize(evidence, qcWaivers, {
        taskId,
        workspaceDigest,
        securityMode,
        at,
        evidenceDigest: typeof evidenceDigest === 'function'
          ? evidenceDigest
          : EvidenceLedger.semanticHash,
      }),
      policy: {
        allowSynthetic: Boolean(allowSynthetic),
        humanSignoffRequired: true,
        qcPolicyVersion: QcPolicy.POLICY_VERSION,
        waivableQcStatuses: ['suspect'],
      },
    };
  }

  return {
    validRfc3339,
    publicationEvidenceValidation,
    validateMeteorologicalAnalysis,
    runPublicationGate,
  };
});
