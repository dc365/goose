'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Contracts = require('../capabilities/weather/contracts.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const Render = require('../capabilities/weather/render.cjs');

function dataset(overrides = {}) {
  return {
    schemaVersion: Contracts.DATASET_SCHEMA_VERSION,
    id: 'weather-contract-case',
    name: 'Weather Contract Case',
    region: {
      name: '匿名区域',
      bbox: [110, 20, 116, 26],
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
    },
    issueTime: '2026-07-30T00:00:00Z',
    validTime: {
      start: '2026-07-30T00:00:00Z',
      end: '2026-07-31T00:00:00Z',
    },
    forecastHour: 24,
    units: {
      rain1h: 'mm',
      rain24h: 'mm',
      temperature: '°C',
      windSpeed: 'm/s',
      pressure: 'hPa',
      regionalMax24h: 'mm',
    },
    stations: [
      {
        id: '002',
        name: '匿名二号站',
        lon: 113,
        lat: 23,
        rain1h: 12,
        rain24h: 90,
        temperature: 27,
        windSpeed: 8,
        pressure: 998,
        quality: 'checked',
      },
      {
        id: '001',
        name: '匿名一号站',
        lon: 112,
        lat: 22,
        rain1h: 18,
        rain24h: 120,
        temperature: 26,
        windSpeed: 10,
        pressure: 996,
        quality: 'checked',
      },
    ],
    guidance: [
      { model: 'Z-MODEL', regionalMax24h: 140, confidence: 0.7 },
      { model: 'A-MODEL', regionalMax24h: 130, confidence: 0.8 },
    ],
    ...overrides,
  };
}

const source = {
  id: 'contract-fixture',
  name: 'Contract Fixture',
  type: 'fixture',
  version: '1',
  classification: 'demo',
  official: false,
  synthetic: true,
  authority: 'fixture',
};

const normalized = Contracts.normalizeDataset(dataset(), source);
assert.equal(Contracts.validateDataset(normalized).valid, true);
assert.deepEqual(Contracts.normalizeDataset(normalized), normalized);
assert.deepEqual(normalized.stations.map((station) => station.id), ['001', '002']);
assert.deepEqual(normalized.guidance.map((item) => item.model), ['A-MODEL', 'Z-MODEL']);
assert.throws(
  () => Contracts.datasetEvidence(normalized, { maxRecords: 1 }),
  (error) => error.code === 'WEATHER_EVIDENCE_LIMIT_EXCEEDED',
);

const reordered = Contracts.normalizeDataset(dataset({
  stations: [...dataset().stations].reverse(),
  guidance: [...dataset().guidance].reverse(),
}), source);
assert.equal(reordered.contentHash, normalized.contentHash);
assert.deepEqual(
  Contracts.datasetEvidence(reordered).map((record) => record.id),
  Contracts.datasetEvidence(normalized).map((record) => record.id),
);

const converted = Contracts.normalizeDataset(dataset({
  id: 'converted-units',
  units: {
    rain1h: 'inch',
    rain24h: 'inch',
    temperature: 'K',
    windSpeed: 'kt',
    pressure: 'Pa',
    regionalMax24h: 'inch',
  },
  stations: [{
    id: '001',
    name: 'Converted',
    lon: 112,
    lat: 22,
    rain1h: 1,
    rain24h: 2,
    temperature: 300,
    windSpeed: 10,
    pressure: 100000,
    quality: 'checked',
  }],
  guidance: [{ model: 'MODEL', regionalMax24h: 3, confidence: 0.8 }],
}), source);
assert.equal(converted.stations[0].rain1h, 25.4);
assert.equal(converted.stations[0].rain24h, 50.8);
assert.equal(converted.stations[0].temperature, 26.85);
assert.equal(converted.stations[0].windSpeed, 5.14444);
assert.equal(converted.stations[0].pressure, 1000);
assert.equal(converted.guidance[0].regionalMax24h, 76.2);
assert.equal(Contracts.validateDataset(converted).valid, true);
assert.ok(converted.metadata.unitConversions.length >= 6);
assert.deepEqual(Contracts.normalizeDataset(converted), converted);

const convertedTemperatureIndices = Contracts.normalizeDataset(dataset({
  id: 'converted-temperature-indices',
  units: {
    ...dataset().units,
    kIndex: 'K',
    liftedIndex: 'kelvin',
  },
  upperAir: {
    indices: {
      kIndex: 35,
      liftedIndex: -3,
    },
  },
}), source);
assert.equal(convertedTemperatureIndices.upperAir.indices.kIndex, 35);
assert.equal(convertedTemperatureIndices.upperAir.indices.liftedIndex, -3);
assert.equal(Contracts.validateDataset(convertedTemperatureIndices).valid, true);
assert.ok(convertedTemperatureIndices.metadata.unitConversions.some((entry) =>
  entry.field === 'kIndex' && entry.from === 'K' && entry.to === '°C'
));
assert.ok(convertedTemperatureIndices.metadata.unitConversions.some((entry) =>
  entry.field === 'liftedIndex' && entry.from === 'kelvin' && entry.to === '°C'
));
assert.deepEqual(
  Contracts.normalizeDataset(convertedTemperatureIndices),
  convertedTemperatureIndices,
);

const convertedReordered = Contracts.normalizeDataset(dataset({
  id: 'converted-order',
  units: {
    rain1h: 'inch',
    rain24h: 'inch',
    temperature: 'K',
    windSpeed: 'kt',
    pressure: 'Pa',
    regionalMax24h: 'inch',
  },
}), source);
const convertedReorderedAgain = Contracts.normalizeDataset(dataset({
  id: 'converted-order',
  units: {
    rain1h: 'inch',
    rain24h: 'inch',
    temperature: 'K',
    windSpeed: 'kt',
    pressure: 'Pa',
    regionalMax24h: 'inch',
  },
  stations: [...dataset().stations].reverse(),
  guidance: [...dataset().guidance].reverse(),
}), source);
assert.equal(convertedReorderedAgain.contentHash, convertedReordered.contentHash);

const duplicateGuidanceA = dataset({
  id: 'duplicate-guidance-order',
  guidance: [
    { model: 'SAME', cycle: '2026-07-30T00:00:00Z', validTime: '2026-07-31T00:00:00Z', forecastHour: 24, regionalMax24h: 100 },
    { model: 'SAME', cycle: '2026-07-30T00:00:00Z', validTime: '2026-07-31T00:00:00Z', forecastHour: 24, regionalMax24h: 200 },
  ],
});
const duplicateGuidanceB = {
  ...duplicateGuidanceA,
  guidance: [...duplicateGuidanceA.guidance].reverse(),
};
assert.equal(
  Contracts.normalizeDataset(duplicateGuidanceA, source).contentHash,
  Contracts.normalizeDataset(duplicateGuidanceB, source).contentHash,
);

const invalid = Contracts.normalizeDataset(dataset({
  id: 'invalid-contract',
  region: {
    name: 'Invalid',
    bbox: [-181, 20, 190, 26],
    timezone: 'Not/A-Timezone',
    projection: 'EPSG:3857',
  },
  units: { rain24h: 'm/s', temperature: '°C', windSpeed: 'm/s', pressure: 'hPa' },
  stations: [{
    id: 'bad',
    lon: 200,
    lat: 95,
    rain24h: -1,
    temperature: 999,
    windSpeed: -2,
    pressure: -1,
    quality: 'BAD-CODE',
  }],
}), source);
const invalidValidation = Contracts.validateDataset(invalid);
assert.equal(invalidValidation.valid, false);
for (const code of [
  'WEATHER_TIMEZONE_INVALID',
  'WEATHER_CRS_UNSUPPORTED',
  'WEATHER_COORDINATE_INVALID',
  'WEATHER_VALUE_OUT_OF_RANGE',
  'WEATHER_UNIT_UNSUPPORTED',
  'WEATHER_QUALITY_INVALID',
]) {
  assert.ok(invalidValidation.errorDetails.some((entry) => entry.code === code), `missing ${code}`);
}
assert.deepEqual(Contracts.datasetEvidence(invalid), []);
assert.throws(
  () => Diagnosis.diagnoseDataset(invalid),
  (error) => error.code === 'WEATHER_DATASET_INVALID',
);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-invalid-render-'));
try {
  assert.throws(
    () => Render.renderDatasetMap({ workspace, dataset: invalid }),
    (error) => error.code === 'WEATHER_DATASET_INVALID',
  );
  assert.equal(fs.existsSync(path.join(workspace, 'artifacts', 'weather', 'risk-map.html')), false);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

const noRainDataset = Contracts.normalizeDataset(dataset({
  id: 'no-rain-map',
  stations: [{
    id: 'NO-RAIN',
    name: 'No Rain Station',
    lon: 112,
    lat: 22,
    temperature: 25,
    quality: 'checked',
  }],
  units: { temperature: '°C' },
}), source);
const noRainMap = Render.renderHtml(noRainDataset);
assert.equal(noRainMap.includes('No Rain Station'), false);

const invalidCalendar = Contracts.normalizeDataset(dataset({
  id: 'invalid-calendar',
  issueTime: '2026-02-30T00:00:00Z',
}));
assert.equal(Contracts.validateDataset(invalidCalendar).valid, false);
assert.ok(
  Contracts.validateDataset(invalidCalendar).errorDetails
    .some((entry) => entry.code === 'WEATHER_TIME_INVALID' && entry.path === 'issueTime'),
);

const invalidOffset = Contracts.normalizeDataset(dataset({
  id: 'invalid-offset',
  issueTime: '2026-07-30T00:00:00+14:01',
}));
assert.ok(
  Contracts.validateDataset(invalidOffset).errorDetails
    .some((entry) => entry.code === 'WEATHER_TIME_INVALID' && entry.path === 'issueTime'),
);

const invalidBboxShape = Contracts.normalizeDataset(dataset({
  id: 'invalid-bbox-shape',
  region: {
    name: 'Invalid bbox',
    bbox: [110, 20, 116],
    timezone: 'Asia/Shanghai',
    projection: 'EPSG:4326',
  },
}));
assert.ok(
  Contracts.validateDataset(invalidBboxShape).errorDetails
    .some((entry) => entry.code === 'WEATHER_COORDINATE_INVALID' && entry.path === 'region.bbox'),
);

const emptyDiagnostic = Contracts.normalizeDataset(dataset({
  id: 'empty-diagnostic',
  stations: [],
  upperAir: { '500hPa': { feature: 'text-only placeholder' } },
  fields: { rain24h: { values: [999], unit: 'bogus' } },
}));
assert.ok(
  Contracts.validateDataset(emptyDiagnostic).errorDetails
    .some((entry) => entry.code === 'WEATHER_DATASET_EMPTY'),
);

const missingConvectionInputs = Contracts.normalizeDataset(dataset({
  id: 'missing-convection-inputs',
  upperAir: {
    indices: {
      precipitableWater: null,
      cape: null,
      cin: null,
      shear0to6km: null,
      lcl: null,
      freezingLevel: null,
    },
  },
  radar: { maxDbz: null },
}), source);
assert.throws(
  () => Diagnosis.diagnoseDataset(missingConvectionInputs, 'convection'),
  (error) => error.code === 'WEATHER_DIAGNOSIS_INPUT_INSUFFICIENT',
);
assert.throws(
  () => Diagnosis.diagnoseDataset(missingConvectionInputs, 'unknown-kind'),
  (error) => error.code === 'WEATHER_DIAGNOSIS_KIND_UNSUPPORTED',
);

const undeclaredConvergenceAlias = Contracts.normalizeDataset(dataset({
  id: 'undeclared-convergence-alias',
  upperAir: { '850hPa': { convergence: -999 } },
}), source);
assert.throws(
  () => Diagnosis.diagnoseDataset(undeclaredConvergenceAlias, 'heavy-rain'),
  (error) => error.code === 'WEATHER_DIAGNOSIS_INPUT_INSUFFICIENT',
);

const pagedDataset = Contracts.normalizeDataset(dataset({
  id: 'paged-evidence',
  stations: Array.from({ length: 30 }, (_, index) => ({
    id: `PAGE-${String(index).padStart(3, '0')}`,
    name: `Page Station ${index}`,
    lon: 110 + index * 0.01,
    lat: 20 + index * 0.01,
    rain1h: index,
    rain24h: index * 2,
    temperature: 20 + index * 0.1,
    windSpeed: 5 + index * 0.1,
    pressure: 1000 - index * 0.1,
    quality: 'checked',
  })),
}), source);
const firstEvidencePage = Contracts.evidencePage(pagedDataset, { limit: 25 });
const secondEvidencePage = Contracts.evidencePage(pagedDataset, {
  limit: 25,
  cursor: firstEvidencePage.page.nextCursor,
});
assert.equal(firstEvidencePage.evidence.length, 25);
assert.equal(firstEvidencePage.page.total, 150);
assert.equal(firstEvidencePage.page.truncated, true);
assert.equal(secondEvidencePage.page.offset, 25);
assert.equal(secondEvidencePage.page.evidenceSetHash, firstEvidencePage.page.evidenceSetHash);
assert.equal(
  firstEvidencePage.evidence.some((record) =>
    secondEvidencePage.evidence.some((candidate) => candidate.id === record.id)
  ),
  false,
);
assert.throws(
  () => Contracts.evidencePage(pagedDataset, { cursor: 'not-a-valid-cursor' }),
  (error) => error.code === 'WEATHER_EVIDENCE_CURSOR_INVALID',
);

const invalidUpperAir = Contracts.normalizeDataset(dataset({
  id: 'invalid-upper-air',
  units: {
    ...dataset().units,
    dewpoint: '°C',
    windDirection: 'degree',
  },
  upperAir: {
    '850hPa': {
      dewpoint: 999,
      windSpeed: -50,
      windDirection: 999,
      pressure: -20,
    },
  },
}), source);
for (const path of [
  'upperAir.850hPa.dewpoint',
  'upperAir.850hPa.windSpeed',
  'upperAir.850hPa.windDirection',
  'upperAir.850hPa.pressure',
]) {
  assert.ok(
    Contracts.validateDataset(invalidUpperAir).errorDetails
      .some((entry) => entry.code === 'WEATHER_VALUE_OUT_OF_RANGE' && entry.path === path),
    `missing upper-air range error for ${path}`,
  );
}

const staleTimedProducts = Contracts.normalizeDataset(dataset({
  id: 'stale-timed-products',
  radar: {
    maxDbz: 50,
    validTime: '2020-01-01T00:00:00Z',
  },
  guidance: [{
    model: 'IMPOSSIBLE',
    cycle: '2030-01-01T00:00:00Z',
    validTime: '2020-01-01T00:00:00Z',
    forecastHour: -999,
    regionalMax24h: 100,
  }],
  units: {
    ...dataset().units,
    maxDbz: 'dBZ',
  },
}), source);
assert.ok(
  Contracts.validateDataset(staleTimedProducts).errorDetails
    .some((entry) => entry.code === 'WEATHER_TIME_INCONSISTENT' && entry.path === 'radar.validTime'),
);
assert.ok(
  Contracts.validateDataset(staleTimedProducts).errorDetails
    .some((entry) => entry.code === 'WEATHER_VALUE_OUT_OF_RANGE' && entry.path === 'guidance[0].forecastHour'),
);
assert.ok(
  Contracts.validateDataset(staleTimedProducts).errorDetails
    .some((entry) => entry.code === 'WEATHER_TIME_INCONSISTENT' && entry.path === 'guidance[0].cycle'),
);

const forgedLineage = Contracts.normalizeDataset(dataset({
  id: 'forged-lineage',
  metadata: {
    normalizerVersion: 'attacker/999',
    normalizationIssues: [null, { code: 'FORGED', path: 'stations', message: 'forged' }],
    unitConversions: [null, { path: 'stations[0].rain24h', field: 'rain24h', from: 'm', to: 'mm' }],
    providerAttestation: { version: 'v1', value: '0'.repeat(64) },
  },
}), source);
assert.equal(forgedLineage.metadata.normalizerVersion, Contracts.NORMALIZER_VERSION);
assert.deepEqual(forgedLineage.metadata.normalizationIssues, []);
assert.deepEqual(forgedLineage.metadata.unitConversions, []);
assert.equal(Contracts.verifyProviderAttestation(forgedLineage), true);

const localAttested = Contracts.normalizeDataset(dataset({ id: 'local-attestation' }), {
  id: 'deployment-local',
  name: 'Deployment Local',
  type: 'local',
  version: '1',
  uri: 'file:///workspace/data/case.json',
  classification: 'production',
  official: true,
  synthetic: false,
  authority: 'deployment',
});
assert.equal(Contracts.verifyProviderAttestation(localAttested), true);
const tamperedLocalAttestation = Contracts.clone(localAttested);
tamperedLocalAttestation.source.uri = 'file:///workspace/data/other.json';
assert.equal(Contracts.verifyProviderAttestation(tamperedLocalAttestation), false);
const downgradedTamperedLocal = Contracts.normalizeDataset(tamperedLocalAttestation);
assert.equal(downgradedTamperedLocal.source.authority, 'untrusted');
assert.equal(downgradedTamperedLocal.source.classification, 'experimental');
assert.equal(downgradedTamperedLocal.source.official, false);
const tamperedRetrievalTime = Contracts.clone(localAttested);
tamperedRetrievalTime.source.retrievedAt = '2099-01-01T00:00:00.000Z';
assert.equal(Contracts.verifyProviderAttestation(tamperedRetrievalTime), false);

const crossProcessAttestationRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'meteomate-weather-attestation-'),
);
try {
  const keyFile = path.join(crossProcessAttestationRoot, 'profile', 'weather-provider.key');
  const contractsModule = path.resolve(__dirname, '..', 'capabilities', 'weather', 'contracts.cjs');
  const normalizeScript = `
    const fs = require('node:fs');
    const Contracts = require(process.argv[1]);
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(
      Contracts.normalizeDataset(input.dataset, input.source || undefined)
    ));
  `;
  const providerDataset = JSON.parse(execFileSync(
    process.execPath,
    ['-e', normalizeScript, contractsModule],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        METEOMATE_WEATHER_ATTESTATION_KEY_FILE: keyFile,
      },
      input: JSON.stringify({
        dataset: dataset({ id: 'cross-process-attestation' }),
        source: {
          id: 'deployment-cross-process',
          name: 'Deployment Cross Process',
          type: 'http-json',
          version: '2026.07',
          uri: 'https://weather.internal/query',
          classification: 'production',
          official: true,
          synthetic: false,
          authority: 'deployment',
          retrievedAt: '2026-07-30T01:00:00Z',
        },
      }),
    },
  ));
  const downstreamDataset = JSON.parse(execFileSync(
    process.execPath,
    ['-e', normalizeScript, contractsModule],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        METEOMATE_WEATHER_ATTESTATION_KEY_FILE: keyFile,
      },
      input: JSON.stringify({ dataset: providerDataset }),
    },
  ));
  assert.deepEqual(downstreamDataset, providerDataset);
  assert.equal(downstreamDataset.source.authority, 'deployment');
  assert.equal(downstreamDataset.source.classification, 'production');
  assert.equal(downstreamDataset.source.official, true);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  }
} finally {
  fs.rmSync(crossProcessAttestationRoot, { recursive: true, force: true });
}

assert.throws(
  () => Contracts.normalizeDataset({ ...dataset(), schemaVersion: 'meteomate.weather.dataset/v999' }),
  (error) => error.code === 'WEATHER_SCHEMA_UNSUPPORTED',
);
assert.throws(
  () => Contracts.normalizeDataset({ ...dataset(), kind: 'WeatherProviderResult' }),
  (error) => error.code === 'WEATHER_KIND_UNSUPPORTED',
);

const workspaceClaim = Contracts.normalizeDataset(dataset({
  source: {
    id: 'self-declared',
    classification: 'production',
    official: true,
  },
}), {
  id: 'workspace-source',
  type: 'local',
  version: '1',
  classification: 'production',
  official: true,
  authority: 'workspace',
});
assert.equal(workspaceClaim.source.classification, 'experimental');
assert.equal(workspaceClaim.source.official, false);
assert.equal(workspaceClaim.source.authority, 'workspace');

const deploymentClaim = Contracts.normalizeDataset(dataset(), {
  id: 'deployment-source',
  type: 'http-json',
  version: '2026.07',
  classification: 'production',
  official: true,
  authority: 'deployment',
});
assert.equal(deploymentClaim.source.classification, 'production');
assert.equal(deploymentClaim.source.official, true);
assert.equal(Contracts.validateDataset(deploymentClaim).valid, true);

const forgedEvidenceMetadata = Contracts.createEvidence(deploymentClaim, {
  variable: 'rain24h',
  value: 120,
  qcStatus: 'checked',
  metadata: {
    datasetId: 'forged-dataset',
    datasetHash: 'f'.repeat(64),
    sourceId: 'forged-source',
    sourceType: 'fixture',
    sourceAuthority: 'fixture',
    classification: 'demo',
    synthetic: true,
    official: false,
    quality: 'rejected',
    qc: { status: 'rejected' },
    qcStatus: 'rejected',
    qcVersion: 'attacker/999',
    customMarker: 'preserved',
  },
});
assert.equal(forgedEvidenceMetadata.metadata.datasetId, deploymentClaim.id);
assert.equal(
  forgedEvidenceMetadata.metadata.datasetHash,
  Contracts.datasetContentHash(deploymentClaim),
);
assert.equal(forgedEvidenceMetadata.metadata.sourceId, deploymentClaim.source.id);
assert.equal(forgedEvidenceMetadata.metadata.sourceType, deploymentClaim.source.type);
assert.equal(forgedEvidenceMetadata.metadata.sourceAuthority, deploymentClaim.source.authority);
assert.equal(forgedEvidenceMetadata.metadata.classification, deploymentClaim.source.classification);
assert.equal(forgedEvidenceMetadata.metadata.synthetic, false);
assert.equal(forgedEvidenceMetadata.metadata.official, true);
assert.deepEqual(forgedEvidenceMetadata.metadata.quality, deploymentClaim.quality);
assert.equal(forgedEvidenceMetadata.metadata.customMarker, 'preserved');
for (const reserved of ['qc', 'qcStatus', 'qcVersion']) {
  assert.equal(Object.hasOwn(forgedEvidenceMetadata.metadata, reserved), false);
}
assert.equal(forgedEvidenceMetadata.qcStatus, 'checked');

const tamperedDeployment = Contracts.clone(deploymentClaim);
tamperedDeployment.stations[0].rain24h += 1;
assert.notEqual(
  tamperedDeployment.contentHash,
  Contracts.datasetContentHash(tamperedDeployment),
);
assert.equal(Contracts.verifyProviderAttestation(tamperedDeployment), false);
const tamperedDeploymentValidation = Contracts.validateDataset(tamperedDeployment);
assert.equal(tamperedDeploymentValidation.valid, false);
for (const code of ['WEATHER_HASH_MISMATCH', 'WEATHER_PROVIDER_ATTESTATION_INVALID']) {
  assert.ok(
    tamperedDeploymentValidation.errorDetails.some((entry) => entry.code === code),
    `missing ${code}`,
  );
}
const forgedPassingValidation = { valid: true, errors: [], warnings: [] };
const tamperedPublication = Contracts.publicationAssessment(
  tamperedDeployment,
  forgedPassingValidation,
);
assert.equal(tamperedPublication.readyForHumanReview, false);
assert.ok(tamperedPublication.blockers.some((item) => item.includes('内容摘要')));
assert.ok(tamperedPublication.blockers.some((item) => item.includes('来源证明')));

const unattestedDeployment = Contracts.clone(deploymentClaim);
delete unattestedDeployment.metadata.providerAttestation;
const unattestedDeploymentValidation = Contracts.validateDataset(unattestedDeployment);
assert.equal(unattestedDeploymentValidation.valid, false);
assert.ok(
  unattestedDeploymentValidation.errorDetails
    .some((entry) => entry.code === 'WEATHER_PROVIDER_ATTESTATION_INVALID'),
);
assert.equal(
  Contracts.publicationAssessment(unattestedDeployment, forgedPassingValidation)
    .readyForHumanReview,
  false,
);

const unattestedFixture = Contracts.clone(normalized);
delete unattestedFixture.metadata.providerAttestation;
assert.equal(Contracts.validateDataset(unattestedFixture).valid, true);
const unattestedWorkspace = Contracts.clone(workspaceClaim);
delete unattestedWorkspace.metadata.providerAttestation;
assert.equal(Contracts.validateDataset(unattestedWorkspace).valid, true);

const deploymentSynthetic = Contracts.normalizeDataset(dataset({ synthetic: true }), {
  id: 'deployment-source',
  type: 'http-json',
  version: '2026.07',
  classification: 'production',
  official: true,
  authority: 'deployment',
});
assert.equal(deploymentSynthetic.source.synthetic, true);
assert.equal(deploymentSynthetic.source.classification, 'demo');
assert.equal(deploymentSynthetic.source.official, false);
assert.equal(Contracts.publicationAssessment(deploymentSynthetic).readyForHumanReview, false);

const localeProbeDataset = dataset({
  id: 'locale-stable-order',
  stations: ['ä', 'z', 'a'].map((id, index) => ({
    ...dataset().stations[index % dataset().stations.length],
    id,
    name: id,
  })),
});
const localeProbe = `
  const Contracts = require('./capabilities/weather/contracts.cjs');
  const normalized = Contracts.normalizeDataset(
    ${JSON.stringify(localeProbeDataset)},
    ${JSON.stringify(source)}
  );
  process.stdout.write(JSON.stringify({
    hash: normalized.contentHash,
    stationIds: normalized.stations.map((station) => station.id)
  }));
`;
const productRoot = path.resolve(__dirname, '..');
const localeResults = ['en_US.UTF-8', 'sv_SE.UTF-8'].map((locale) =>
  JSON.parse(execFileSync(process.execPath, ['-e', localeProbe], {
    cwd: productRoot,
    env: { ...process.env, LANG: locale, LC_ALL: locale },
  }).toString('utf8'))
);
assert.deepEqual(localeResults[0], localeResults[1]);
assert.deepEqual(localeResults[0].stationIds, ['a', 'z', 'ä']);

console.log('weather semantic contract tests passed');
