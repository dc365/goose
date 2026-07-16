(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const ArtifactRegistry = isNode ? require('./artifact-registry') : root.MeteoMateHarness.ArtifactRegistry;
  const EvidenceLedger = isNode ? require('./evidence-ledger') : root.MeteoMateHarness.EvidenceLedger;
  const api = factory(ArtifactRegistry, EvidenceLedger);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ValidationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ArtifactRegistry, EvidenceLedger) {
  'use strict';

  function validateMeteorologicalAnalysis(analysis = {}, evidenceRecords = []) {
    const errors = [];
    const warnings = [];
    if (!analysis.region) warnings.push('分析未指定区域');
    if (!analysis.issueTime && !analysis.issue_time) warnings.push('分析未指定发布时间');
    if (!analysis.validPeriod && !analysis.valid_period) warnings.push('分析未指定有效时段');
    const conclusions = analysis.forecastConclusions || analysis.forecast_conclusions || analysis.conclusions || [];
    if (!Array.isArray(conclusions) || conclusions.length === 0) errors.push('缺少预报结论');
    const evidenceIds = new Set(evidenceRecords.map((record) => record.id));
    for (const conclusion of Array.isArray(conclusions) ? conclusions : []) {
      const ids = conclusion.evidenceIds || conclusion.evidence_ids || [];
      if (!Array.isArray(ids) || ids.length === 0) warnings.push(`结论“${conclusion.text || conclusion.title || '未命名'}”没有证据引用`);
      for (const id of ids || []) if (!evidenceIds.has(id)) errors.push(`引用了不存在的证据：${id}`);
    }
    for (const record of evidenceRecords) {
      const result = EvidenceLedger.validateEvidence(record);
      errors.push(...result.errors.map((message) => `证据 ${record.id}: ${message}`));
      warnings.push(...result.warnings.map((message) => `证据 ${record.id}: ${message}`));
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function runPublicationGate({ analysis = {}, artifacts = [], evidence = [], humanSignoff = null }) {
    const analysisResult = validateMeteorologicalAnalysis(analysis, evidence);
    const artifactErrors = [];
    for (const artifact of artifacts) {
      const result = ArtifactRegistry.validateArtifact(artifact);
      artifactErrors.push(...result.errors.map((message) => `成果物 ${artifact.id || artifact.name}: ${message}`));
    }
    const blockers = [...analysisResult.errors, ...artifactErrors];
    if (!humanSignoff?.approved) blockers.push('缺少预报员或业务人员签发');
    return {
      ready: blockers.length === 0,
      status: blockers.length === 0 ? 'ready' : 'draft',
      blockers,
      warnings: analysisResult.warnings,
      checkedAt: Date.now(),
      signoff: humanSignoff || null,
    };
  }

  return { validateMeteorologicalAnalysis, runPublicationGate };
});
