const assert = require('node:assert/strict');
const Module = require('node:module');

const artifactStub = {
  validateArtifact(record) {
    const errors = [];
    if (!record?.id) errors.push('missing id');
    if (!record?.name) errors.push('missing name');
    if (!record?.path && !record?.uri) errors.push('missing path or uri');
    if (!['draft', 'validated', 'ready', 'published', 'failed'].includes(record?.status)) errors.push('invalid status');
    return { valid: errors.length === 0, errors };
  },
};
const evidenceStub = {
  semanticHash(record) {
    return JSON.stringify(record);
  },
  isExpired(record, at = Date.now()) {
    return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= at);
  },
  validateEvidence(record) {
    const errors = [];
    const warnings = [];
    if (!record?.source) errors.push('missing source');
    if (record?.confidence != null && (record.confidence < 0 || record.confidence > 1)) errors.push('invalid confidence');
    return { valid: errors.length === 0, errors, warnings };
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith('validation-engine.js') && request === './artifact-registry') return artifactStub;
  if (parent?.filename?.endsWith('validation-engine.js') && request === './evidence-ledger') return evidenceStub;
  return originalLoad.call(this, request, parent, isMain);
};
const Validation = require('../harness/validation-engine');
Module._load = originalLoad;

const now = Date.now();
const evidence = [{
  id: 'evidence-1',
  kind: 'Evidence',
  evidenceType: 'meteorological-fact',
  source: 'ECMWF',
  sourceVersion: '2026072900',
  validTime: new Date(now + 3_600_000).toISOString(),
  expiresAt: new Date(now + 86_400_000).toISOString(),
  variable: 'rain24h',
  unit: 'mm',
  value: 110,
  confidence: 0.9,
  qcStatus: 'checked',
  qcVersion: 'meteomate.weather.qc/1.0.0',
  metadata: { classification: 'production', synthetic: false },
}];
const artifacts = [{
  id: 'artifact-1',
  kind: 'Artifact',
  name: 'forecast.pdf',
  path: '/tmp/forecast.pdf',
  status: 'ready',
  contentHash: 'a'.repeat(64),
  metadata: { classification: 'production', synthetic: false },
}];
const analysis = {
  region: '华南', issueTime: new Date(now).toISOString(), validPeriod: '未来24小时',
  conclusions: [{ text: '局地暴雨', evidenceIds: ['evidence-1'] }],
};
let result = Validation.runPublicationGate({ analysis, artifacts, evidence, humanSignoff: null, at: now });
assert.equal(result.ready, false);
assert.ok(result.blockers.includes('缺少预报员或业务人员签发'));
result = Validation.runPublicationGate({ analysis, artifacts, evidence, humanSignoff: { approved: true, signer: 'forecaster' }, at: now });
assert.equal(result.ready, true);
const demo = structuredClone(evidence[0]);
demo.id = 'demo-1';
demo.metadata.synthetic = true;
demo.metadata.classification = 'demo';
result = Validation.runPublicationGate({
  analysis: { ...analysis, conclusions: [{ text: '演示结论', evidenceIds: ['demo-1'] }] },
  artifacts,
  evidence: [demo],
  humanSignoff: { approved: true },
  at: now,
});
assert.equal(result.ready, false);
assert.ok(result.blockers.some((item) => item.includes('synthetic')));
console.log('publication validation tests passed');
