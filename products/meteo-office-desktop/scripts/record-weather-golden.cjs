'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Contracts = require('../capabilities/weather/contracts.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const Render = require('../capabilities/weather/render.cjs');
const QcPolicy = require('../harness/qc-policy');
const Golden = require('../tests/support/weather-golden-replay.cjs');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

const caseId = Golden.DEFAULT_CASE_ID;
const index = Golden.readJson(path.join(Golden.GOLDEN_ROOT, 'index.json'));
const entry = index.cases.find((candidate) => candidate.id === caseId);
if (!entry) throw new Error(`Golden index is missing case ${caseId}`);
const previousRevision = Number(entry.latestRevision);
if (!Number.isInteger(previousRevision) || previousRevision < 1) {
  throw new Error(`Golden index has an invalid latest revision for ${caseId}`);
}
const revision = previousRevision + 1;
const previous = Golden.replayPaths(caseId, `v${previousRevision}`);
const target = Golden.replayPaths(caseId, `v${revision}`);
if (fs.existsSync(target.directory)) {
  throw new Error(`Golden revision already exists and is immutable: ${target.directory}`);
}

const previousManifest = Golden.readJson(previous.manifest);
const dataset = Golden.readJson(previous.dataset);
dataset.quality = {
  status: 'checked',
  method: 'fully-synthetic-golden-review/v1',
};

fs.mkdirSync(target.directory, { recursive: true, mode: 0o700 });
writeJson(target.dataset, dataset);

const manifest = {
  ...previousManifest,
  revision,
  supersedes: `${caseId}/v${previousRevision}`,
  input: {
    ...previousManifest.input,
    fileSha256: Golden.sha256File(target.dataset),
  },
  pipeline: {
    ...previousManifest.pipeline,
    normalizerVersion: Contracts.NORMALIZER_VERSION,
    qcPolicy: {
      version: QcPolicy.POLICY_VERSION,
      digest: QcPolicy.POLICY_DIGEST,
    },
    algorithm: {
      name: 'meteomate-weather-diagnosis',
      version: Diagnosis.ALGORITHM_VERSION,
    },
    renderer: {
      name: 'meteomate-weather-risk-map',
      version: Render.RENDERER_VERSION,
      outputPath: `artifacts/golden/${caseId}/v${revision}/risk-map.html`,
    },
  },
  expected: {
    ...previousManifest.expected,
    fileSha256: `sha256:${'0'.repeat(64)}`,
    datasetHash: '0'.repeat(64),
    artifactContentHash: '0'.repeat(64),
  },
};

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-record-weather-golden-'));
let expected;
try {
  expected = Golden.runReplay({ manifest, dataset, workspace });
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
writeJson(target.expected, expected);
manifest.expected = {
  ...manifest.expected,
  fileSha256: Golden.sha256File(target.expected),
  datasetHash: expected.dataset.contentHash,
  evidenceCount: expected.summary.evidenceCount,
  evidenceTypeCounts: expected.summary.evidenceTypeCounts,
  artifactContentHash: expected.artifact.contentHash,
  readyForRelease: expected.publication.readyForRelease,
};
writeJson(target.manifest, manifest);

entry.latestRevision = revision;
entry.latestPath = `${caseId}/v${revision}/manifest.json`;
entry.manifestSha256 = Golden.sha256File(target.manifest);
entry.revisions = [
  ...(Array.isArray(entry.revisions)
    ? entry.revisions.filter((candidate) => candidate.revision !== revision)
    : [{
        revision: previousRevision,
        path: `${caseId}/v${previousRevision}/manifest.json`,
        manifestSha256: Golden.sha256File(previous.manifest),
      }]),
  {
    revision,
    path: entry.latestPath,
    manifestSha256: entry.manifestSha256,
  },
];
fs.writeFileSync(target.index, `${JSON.stringify(index, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});

console.log(`Recorded immutable Weather Golden ${caseId}/v${revision}`);
