'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Contracts = require('../../capabilities/weather/contracts.cjs');
const Diagnosis = require('../../capabilities/weather/diagnosis.cjs');
const Render = require('../../capabilities/weather/render.cjs');
const SchemaValidator = require('../../capabilities/weather/schema-validator.cjs');

const GOLDEN_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'weather', 'golden');
const DEFAULT_CASE_ID = 'synthetic-fujian-rainstorm-001';
const DEFAULT_REVISION = 'v2';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function replayPaths(caseId = DEFAULT_CASE_ID, revision = DEFAULT_REVISION) {
  const directory = path.join(GOLDEN_ROOT, caseId, revision);
  return {
    root: GOLDEN_ROOT,
    directory,
    index: path.join(GOLDEN_ROOT, 'index.json'),
    manifest: path.join(directory, 'manifest.json'),
    dataset: path.join(directory, 'dataset.json'),
    expected: path.join(directory, 'expected.json'),
  };
}

function loadReplay(caseId = DEFAULT_CASE_ID, revision = DEFAULT_REVISION) {
  const paths = replayPaths(caseId, revision);
  return {
    paths,
    manifest: readJson(paths.manifest),
    dataset: readJson(paths.dataset),
    expected: readJson(paths.expected),
  };
}

function fixtureSource(manifest) {
  return {
    id: 'meteomate-synthetic-fixture',
    name: 'MeteoMate synthetic fixture',
    type: 'fixture',
    version: manifest.id,
    uri: `fixture://${manifest.id}`,
    classification: manifest.dataPolicy.classification,
    synthetic: manifest.dataPolicy.synthetic,
    official: manifest.dataPolicy.official,
    authority: 'fixture',
    retrievedAt: manifest.clock.inWindow,
  };
}

function deterministicDataset(dataset) {
  const projected = clone(dataset);
  delete projected.source?.retrievedAt;
  delete projected.metadata?.providerAttestation;
  return projected;
}

function deterministicEvidence(evidence) {
  return evidence.map((record) => {
    const projected = clone(record);
    delete projected.createdAt;
    return projected;
  });
}

function deterministicArtifact(artifact, workspace) {
  const projected = clone(artifact);
  delete projected.createdAt;
  const canonicalWorkspace = fs.realpathSync(workspace);
  const relativePath = path.relative(canonicalWorkspace, artifact.path);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Golden Replay Artifact escaped its workspace: ${artifact.path}`);
  }
  projected.path = relativePath.split(path.sep).join('/');
  return projected;
}

function evidenceTypeCounts(evidence) {
  return Object.fromEntries(
    [...new Set(evidence.map((record) => record.evidenceType))]
      .sort()
      .map((type) => [type, evidence.filter((record) => record.evidenceType === type).length]),
  );
}

function lineageSummary(dataset, evidence, artifact) {
  const evidenceIds = evidence.map((record) => record.id);
  const algorithmEvidenceIds = evidence
    .filter((record) => record.evidenceType === 'algorithm-diagnosis')
    .map((record) => record.id);
  const evidenceDatasetHashes = [...new Set(evidence.map((record) => record.metadata?.datasetHash))].sort();
  const evidenceSourceIds = [...new Set(evidence.map((record) => record.metadata?.sourceId))].sort();
  return {
    datasetId: dataset.id,
    datasetHash: dataset.contentHash,
    evidenceIds,
    algorithmEvidenceIds,
    evidenceDatasetHashes,
    evidenceSourceIds,
    artifactDatasetHash: artifact.metadata?.datasetHash,
    artifactEvidenceIds: [...(artifact.evidenceIds || [])],
    allEvidenceLinkedToDataset: (
      evidenceDatasetHashes.length === 1
      && evidenceDatasetHashes[0] === dataset.contentHash
    ),
    artifactLinkedToDataset: artifact.metadata?.datasetHash === dataset.contentHash,
    artifactCoversAllEvidence: (
      artifact.evidenceIds?.length === evidenceIds.length
      && artifact.evidenceIds.every((id, index) => id === evidenceIds[index])
    ),
  };
}

function replaySummary(manifest, result, artifact) {
  const evidence = result.evidence;
  const inWindow = Date.parse(manifest.clock.inWindow);
  const expired = Date.parse(manifest.clock.expired);
  return {
    heavyRainScore: result.diagnosis.heavyRain.total,
    heavyRainDimensionScores: result.diagnosis.heavyRain.dimensions.map((item) => item.score),
    convectionScore: result.diagnosis.convection.total,
    synopticSystemCount: result.diagnosis.synoptic.systems.length,
    evidenceCount: evidence.length,
    evidenceTypeCounts: evidenceTypeCounts(evidence),
    algorithmEvidenceCount: evidence.filter((record) => record.evidenceType === 'algorithm-diagnosis').length,
    artifactContentHash: artifact.contentHash,
    activeEvidenceAtInWindow: evidence.filter((record) => Date.parse(record.expiresAt) > inWindow).length,
    expiredEvidenceAtExpiredClock: evidence.filter((record) => Date.parse(record.expiresAt) <= expired).length,
  };
}

function runReplay({ manifest, dataset, workspace }) {
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.GOLDEN_REPLAY, manifest);
  const normalized = Contracts.normalizeDataset(dataset, fixtureSource(manifest));
  const validation = Contracts.validateDataset(normalized);
  const result = Diagnosis.diagnoseDataset(normalized, manifest.pipeline.diagnosisKind);
  const diagnosisForRender = {
    ...result.diagnosis,
    algorithm: result.algorithm,
  };
  const artifact = Render.renderDatasetMap({
    workspace,
    dataset: normalized,
    diagnosis: diagnosisForRender,
    evidence: result.evidence,
    outputPath: manifest.pipeline.renderer.outputPath,
  });
  const projectedEvidence = deterministicEvidence(result.evidence);
  const projectedArtifact = deterministicArtifact(artifact, workspace);
  return {
    apiVersion: 'meteomate.weather.golden-replay-result/v1',
    kind: 'WeatherGoldenReplayResult',
    replay: {
      id: manifest.id,
      revision: manifest.revision,
    },
    dataset: deterministicDataset(normalized),
    validation,
    diagnosis: {
      algorithm: result.algorithm,
      ...clone(result.diagnosis),
    },
    evidence: projectedEvidence,
    artifact: projectedArtifact,
    publication: clone(result.publication),
    lineage: lineageSummary(normalized, projectedEvidence, projectedArtifact),
    summary: replaySummary(manifest, result, artifact),
  };
}

module.exports = {
  DEFAULT_CASE_ID,
  DEFAULT_REVISION,
  GOLDEN_ROOT,
  deterministicArtifact,
  deterministicDataset,
  deterministicEvidence,
  evidenceTypeCounts,
  fixtureSource,
  lineageSummary,
  loadReplay,
  readJson,
  replayPaths,
  runReplay,
  sha256File,
};
