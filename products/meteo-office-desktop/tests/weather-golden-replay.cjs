'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WeatherConnector = require('../capabilities/weather-connector.js');
const Contracts = require('../capabilities/weather/contracts.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const Render = require('../capabilities/weather/render.cjs');
const SchemaValidator = require('../capabilities/weather/schema-validator.cjs');
const ValidationEngine = require('../harness/validation-engine');
const QcPolicy = require('../harness/qc-policy');
const Golden = require('./support/weather-golden-replay.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function temporaryWorkspace(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meteomate-golden-${name}-`));
}

const replay = Golden.loadReplay();
const { manifest, dataset, expected, paths } = replay;
const index = Golden.readJson(paths.index);
const indexEntry = index.cases.find((entry) => entry.id === manifest.id);
const immutableV1 = Golden.replayPaths(Golden.DEFAULT_CASE_ID, 'v1');

assert.ok(indexEntry, `golden index is missing ${manifest.id}`);
assert.equal(
  Golden.sha256File(immutableV1.dataset),
  'sha256:46436a89ab9b11405366489ce8235a5cb0a12911fb27af7bcd59a437c0510479',
);
assert.equal(
  Golden.sha256File(immutableV1.expected),
  'sha256:a77e9fd31c8bcfee6fcec5388fa2781aaed3f74a1277c1875dbe7b42ff921225',
);
assert.equal(
  Golden.sha256File(immutableV1.manifest),
  'sha256:f15a2dc7ebb8e4b66fdd5a06c927d9e81e5366339b71f1f79a6bed09dd7b45ec',
);
assert.equal(indexEntry.latestRevision, manifest.revision);
assert.equal(
  path.resolve(paths.root, indexEntry.latestPath),
  paths.manifest,
);
assert.equal(indexEntry.manifestSha256, Golden.sha256File(paths.manifest));
assert.equal(
  manifest.input.fileSha256,
  Golden.sha256File(path.resolve(paths.directory, manifest.input.path)),
);
assert.equal(
  manifest.expected.fileSha256,
  Golden.sha256File(path.resolve(paths.directory, manifest.expected.path)),
);
assert.equal(
  SchemaValidator.validate(SchemaValidator.CONTRACT_KINDS.GOLDEN_REPLAY, manifest).valid,
  true,
);
assert.equal(manifest.pipeline.normalizerVersion, Contracts.NORMALIZER_VERSION);
assert.deepEqual(manifest.pipeline.qcPolicy, {
  version: QcPolicy.POLICY_VERSION,
  digest: QcPolicy.POLICY_DIGEST,
});
assert.deepEqual(manifest.pipeline.algorithm, {
  name: 'meteomate-weather-diagnosis',
  version: Diagnosis.ALGORITHM_VERSION,
});
assert.equal(manifest.pipeline.renderer.version, Render.RENDERER_VERSION);

const normalized = Contracts.normalizeDataset(dataset, Golden.fixtureSource(manifest));
assert.deepEqual(Contracts.normalizeDataset(normalized), normalized);
assert.equal(normalized.contentHash, manifest.expected.datasetHash);

const workspaceA = temporaryWorkspace('workspace-a');
const workspaceB = temporaryWorkspace('workspace-b');
try {
  const workspaceAFirst = Golden.runReplay({ manifest, dataset, workspace: workspaceA });
  const workspaceASecond = Golden.runReplay({ manifest, dataset, workspace: workspaceA });
  const workspaceBFirst = Golden.runReplay({ manifest, dataset, workspace: workspaceB });
  const workspaceBSecond = Golden.runReplay({ manifest, dataset, workspace: workspaceB });

  assert.deepEqual(workspaceAFirst, expected);
  assert.deepEqual(workspaceASecond, expected);
  assert.deepEqual(workspaceBFirst, expected);
  assert.deepEqual(workspaceBSecond, expected);

  assert.equal(expected.dataset.contentHash, manifest.expected.datasetHash);
  assert.equal(expected.validation.valid, true);
  assert.deepEqual(expected.validation.errors, []);
  assert.deepEqual(expected.validation.warnings, []);
  assert.equal(expected.summary.heavyRainScore, 68);
  assert.deepEqual(expected.summary.heavyRainDimensionScores, [20, 13, 13, 16, 6]);
  assert.equal(expected.summary.convectionScore, 77);
  assert.equal(expected.summary.synopticSystemCount, 5);
  assert.equal(expected.summary.evidenceCount, 84);
  assert.equal(expected.summary.algorithmEvidenceCount, 13);
  assert.deepEqual(expected.summary.evidenceTypeCounts, {
    'algorithm-diagnosis': 13,
    'meteorological-fact': 71,
  });
  assert.equal(manifest.expected.evidenceCount, expected.summary.evidenceCount);
  assert.deepEqual(manifest.expected.evidenceTypeCounts, expected.summary.evidenceTypeCounts);
  assert.equal(expected.summary.artifactContentHash, manifest.expected.artifactContentHash);
  assert.equal(expected.summary.activeEvidenceAtInWindow, 84);
  assert.equal(expected.summary.expiredEvidenceAtExpiredClock, 84);

  assert.equal(expected.lineage.allEvidenceLinkedToDataset, true);
  assert.equal(expected.lineage.artifactLinkedToDataset, true);
  assert.equal(expected.lineage.artifactCoversAllEvidence, true);
  assert.deepEqual(expected.lineage.evidenceDatasetHashes, [expected.dataset.contentHash]);
  assert.deepEqual(expected.lineage.evidenceSourceIds, [expected.dataset.source.id]);
  assert.equal(expected.lineage.artifactDatasetHash, expected.dataset.contentHash);
  assert.deepEqual(expected.lineage.artifactEvidenceIds, expected.lineage.evidenceIds);
  assert.equal(expected.lineage.algorithmEvidenceIds.length, 13);
  assert.ok(expected.evidence.every((record) => record.metadata.datasetHash === expected.dataset.contentHash));
  assert.ok(expected.evidence.every((record) => record.metadata.sourceId === expected.dataset.source.id));
  assert.ok(expected.evidence.every((record) => record.qcStatus === 'checked'));
  assert.ok(expected.evidence.every((record) =>
    record.qcVersion === 'meteomate.weather.qc/1.0.0'
  ));

  assert.equal(expected.dataset.source.synthetic, true);
  assert.equal(expected.dataset.source.official, false);
  assert.equal(expected.dataset.source.classification, 'demo');
  assert.equal(expected.publication.readyForHumanReview, false);
  assert.equal(expected.publication.readyForRelease, false);
  assert.equal(manifest.expected.readyForRelease, expected.publication.readyForRelease);
  assert.equal(expected.publication.requiresHumanSignoff, true);
  assert.ok(expected.publication.blockers.includes('构造或演示数据不能进入正式发布'));

  const reordered = clone(dataset);
  reordered.stations.reverse();
  reordered.guidance.reverse();
  const reorderedProjection = Golden.runReplay({
    manifest,
    dataset: reordered,
    workspace: workspaceB,
  });
  assert.deepEqual(reorderedProjection, expected);

  const mutated = clone(dataset);
  mutated.upperAir.indices.cape = 3_200;
  const mutatedProjection = Golden.runReplay({
    manifest,
    dataset: mutated,
    workspace: workspaceB,
  });
  assert.notEqual(mutatedProjection.dataset.contentHash, expected.dataset.contentHash);
  assert.notDeepEqual(mutatedProjection.evidence, expected.evidence);
  assert.notDeepEqual(mutatedProjection.diagnosis, expected.diagnosis);
  assert.notEqual(mutatedProjection.artifact.contentHash, expected.artifact.contentHash);

  const fixtureWorkspace = temporaryWorkspace('connector-fixture');
  try {
    const fixtureRun = WeatherConnector.createFixtureWeatherRun(fixtureWorkspace);
    assert.deepEqual(Golden.deterministicDataset(fixtureRun.dataset), expected.dataset);
    assert.deepEqual(fixtureRun.validation, expected.validation);
    assert.deepEqual({
      algorithm: fixtureRun.algorithm,
      ...fixtureRun.diagnosis,
    }, expected.diagnosis);
    assert.deepEqual(Golden.deterministicEvidence(fixtureRun.evidence), expected.evidence);
    assert.equal(fixtureRun.artifacts[0].contentHash, expected.artifact.contentHash);
    const gateInput = {
      taskId: 'golden-replay',
      analysis: fixtureRun.publicationAnalysis,
      artifacts: fixtureRun.artifacts,
      evidence: fixtureRun.evidence,
      humanSignoff: { approved: true, reviewerName: 'Golden Replay' },
    };
    const inWindowGate = ValidationEngine.runPublicationGate({
      ...gateInput,
      at: Date.parse(manifest.clock.inWindow),
    });
    assert.equal(inWindowGate.ready, false);
    assert.ok(inWindowGate.blockers.some((blocker) => blocker.includes('synthetic')));
    assert.equal(inWindowGate.blockers.some((blocker) => blocker.includes('expired')), false);
    const expiredGate = ValidationEngine.runPublicationGate({
      ...gateInput,
      at: Date.parse(manifest.clock.expired),
    });
    assert.equal(expiredGate.ready, false);
    assert.ok(expiredGate.blockers.some((blocker) => blocker.includes('synthetic')));
    assert.ok(expiredGate.blockers.some((blocker) => blocker.includes('expired')));
  } finally {
    fs.rmSync(fixtureWorkspace, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(workspaceA, { recursive: true, force: true });
  fs.rmSync(workspaceB, { recursive: true, force: true });
}

console.log('weather Golden Replay tests passed');
