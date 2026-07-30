'use strict';

const assert = require('node:assert/strict');
const Contracts = require('../capabilities/weather/contracts.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const SchemaValidator = require('../capabilities/weather/schema-validator.cjs');

const { CONTRACT_KINDS, ERROR_CODES, WeatherContractError, validate, validateOrThrow } = SchemaValidator;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(kind, value, expectedPath) {
  const result = validate(kind, value);
  assert.equal(result.valid, false);
  assert.equal(result.code, ERROR_CODES.INVALID);
  assert.ok(result.errors.length > 0);
  if (expectedPath) {
    assert.ok(
      result.errors.some((error) => error.instancePath === expectedPath),
      `${kind} should report ${expectedPath}: ${JSON.stringify(result.errors)}`,
    );
  }
  assert.throws(
    () => validateOrThrow(kind, value),
    (error) => {
      assert.ok(error instanceof WeatherContractError);
      assert.equal(error.name, 'WeatherContractError');
      assert.equal(error.code, ERROR_CODES.INVALID);
      assert.equal(error.details.kind, kind);
      assert.ok(error.details.errors.length > 0);
      return true;
    },
  );
}

const query = {
  apiVersion: 'meteomate.weather/v1',
  kind: 'WeatherQuery',
  sourceId: 'golden-fixture',
  datasetRef: 'cases/heavy-rain.json',
  securityMode: 'internal',
  query: {
    issueTime: '2026-07-29T00:00:00Z',
    forecastHour: 24,
    member: ['control', 'perturbed-01'],
  },
};
assert.equal(validate(CONTRACT_KINDS.QUERY, query).valid, true);
assert.equal(validateOrThrow(CONTRACT_KINDS.QUERY, query), query);
expectInvalid(CONTRACT_KINDS.QUERY, { ...query, apiVersion: 'meteomate.weather/v2' }, '/apiVersion');
expectInvalid(CONTRACT_KINDS.QUERY, { ...query, kind: 'WeatherQueryResult' }, '/kind');
expectInvalid(CONTRACT_KINDS.QUERY, {
  ...query,
  query: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, index])),
}, '/query');
const oversizedQueryArray = clone(query);
oversizedQueryArray.query.member = Array.from({ length: 257 }, (_, index) => `member-${index}`);
const oversizedQueryArrayResult = validate(CONTRACT_KINDS.QUERY, oversizedQueryArray);
assert.equal(oversizedQueryArrayResult.valid, false);
assert.ok(oversizedQueryArrayResult.errors.length <= 8, 'weather query validation must fail fast');

const registry = {
  apiVersion: 'meteomate.weather/v1',
  kind: 'WeatherSourceRegistry',
  sources: [
    {
      id: 'golden-fixture',
      name: 'Golden Fixture',
      type: 'local',
      root: 'tests/fixtures/weather-replays',
      classification: 'demo',
      synthetic: true,
      official: false,
      version: '1',
    },
    {
      id: 'operations-api',
      name: 'Operations API',
      type: 'http-json',
      baseUrl: 'https://weather.example.test',
      queryPath: '/v1/query',
      method: 'POST',
      allowedHosts: ['weather.example.test'],
      credentialRef: 'weather:operations-api',
      classification: 'production',
      official: true,
      synthetic: false,
      version: '2026.07',
    },
  ],
};
assert.equal(validate(CONTRACT_KINDS.SOURCE_REGISTRY, registry).valid, true);
expectInvalid(
  CONTRACT_KINDS.SOURCE_REGISTRY,
  { ...registry, kind: 'WeatherSources' },
  '/kind',
);
const missingHttpUrl = clone(registry);
delete missingHttpUrl.sources[1].baseUrl;
expectInvalid(CONTRACT_KINDS.SOURCE_REGISTRY, missingHttpUrl, '/sources/1');

const rawDataset = {
  schemaVersion: 'meteomate.weather.dataset/v1',
  kind: 'WeatherDataset',
  id: 'golden-heavy-rain-r1',
  name: 'Synthetic heavy rain replay',
  region: {
    name: 'Synthetic Region',
    bbox: [110, 20, 116, 26],
    timezone: 'Asia/Shanghai',
    projection: 'EPSG:4326',
  },
  issueTime: '2026-07-29T00:00:00Z',
  validTime: {
    start: '2026-07-29T00:00:00Z',
    end: '2026-07-30T00:00:00Z',
  },
  model: 'SYNTHETIC',
  forecastHour: null,
  units: {
    rain6h: 'mm',
    rain24h: 'mm',
    windSpeed: 'm/s',
    specificHumidity: 'g/kg',
    dewpoint: '°C',
    moistureFluxConvergence: 's^-1',
    omega: 'Pa/s',
    divergence: 's^-1',
    precipitableWater: 'mm',
    cape: 'J/kg',
    cin: 'J/kg',
    kIndex: '°C',
    liftedIndex: '°C',
    shear0to6km: 'm/s',
    lcl: 'm',
    freezingLevel: 'm',
    maxDbz: 'dBZ',
    regionalMax24h: 'mm',
  },
  stations: [
    {
      id: 'S001',
      name: 'Synthetic Station 1',
      lon: 112.1,
      lat: 23.1,
      rain6h: 62,
      rain24h: 128,
      quality: 'checked',
    },
  ],
  upperAir: {
    '850hPa': {
      windSpeed: 19,
      specificHumidity: 15.2,
      dewpoint: 18.4,
      moistureFluxConvergence: -0.000045,
      feature: 'synthetic low-level convergence',
    },
    '700hPa': { omega: -0.46 },
    '500hPa': { feature: 'synthetic trough' },
    '200hPa': { divergence: 0.000032, feature: 'synthetic divergence' },
    indices: {
      precipitableWater: 62,
      cape: 1600,
      cin: 24,
      kIndex: 37,
      liftedIndex: -3.1,
      shear0to6km: 18,
      lcl: 680,
      freezingLevel: 4900,
    },
  },
  radar: {
    maxDbz: 56,
    morphology: 'synthetic training bands',
    signals: ['training'],
  },
  guidance: [
    {
      model: 'SYNTHETIC-A',
      forecastHour: null,
      regionalMax24h: 145,
      timing: 'first window',
    },
    {
      model: 'SYNTHETIC-B',
      forecastHour: null,
      regionalMax24h: 162,
      timing: 'first window',
    },
  ],
};
assert.equal(validate(CONTRACT_KINDS.RAW_DATASET, rawDataset).valid, true);
expectInvalid(
  CONTRACT_KINDS.RAW_DATASET,
  { ...rawDataset, schemaVersion: 'meteomate.weather.dataset/v2' },
  '/schemaVersion',
);
expectInvalid(
  CONTRACT_KINDS.RAW_DATASET,
  { ...rawDataset, kind: 'WeatherRawDataset' },
  '/kind',
);
expectInvalid(
  CONTRACT_KINDS.RAW_DATASET,
  { ...rawDataset, issueTime: '2026-02-30T00:00:00Z' },
  '/issueTime',
);
expectInvalid(
  CONTRACT_KINDS.RAW_DATASET,
  { ...rawDataset, issueTime: '2026-07-30T00:00:00+14:01' },
  '/issueTime',
);

const normalizedDataset = Contracts.normalizeDataset(rawDataset, {
  id: 'golden-fixture',
  name: 'Golden Fixture',
  type: 'local',
  version: '1',
  uri: 'fixture://golden-heavy-rain-r1',
  classification: 'demo',
  official: false,
  synthetic: true,
  authority: 'fixture',
  retrievedAt: '2026-07-29T00:00:00Z',
});
assert.equal(validate(CONTRACT_KINDS.DATASET, normalizedDataset).valid, true);
const normalizedWithoutKind = clone(normalizedDataset);
delete normalizedWithoutKind.kind;
expectInvalid(CONTRACT_KINDS.DATASET, normalizedWithoutKind, '');
expectInvalid(
  CONTRACT_KINDS.DATASET,
  { ...normalizedDataset, schemaVersion: 'meteomate.weather.dataset/v2' },
  '/schemaVersion',
);
expectInvalid(
  CONTRACT_KINDS.DATASET,
  { ...normalizedDataset, kind: 'WeatherProviderResult' },
  '/kind',
);
expectInvalid(
  CONTRACT_KINDS.DATASET,
  { ...normalizedDataset, contentHash: `sha256:${normalizedDataset.contentHash}` },
  '/contentHash',
);

const validation = Contracts.validateDataset(normalizedDataset);
const providerResult = {
  schemaVersion: 'meteomate.weather.dataset/v1',
  kind: 'WeatherProviderResult',
  provider: {
    id: 'golden-fixture',
    name: 'Golden Fixture',
    type: 'local',
    description: 'Versioned synthetic replay data',
    classification: 'demo',
    official: false,
    synthetic: true,
    authority: 'fixture',
    version: '1',
    root: 'tests/fixtures/weather-replays',
  },
  dataset: normalizedDataset,
  validation,
  evidenceSummary: Contracts.summarizeEvidence(Contracts.datasetEvidence(normalizedDataset)),
  publication: Contracts.publicationAssessment(normalizedDataset, validation),
};
assert.equal(validate(CONTRACT_KINDS.PROVIDER_RESULT, providerResult).valid, true);
const providerWithoutKind = clone(providerResult);
delete providerWithoutKind.kind;
expectInvalid(CONTRACT_KINDS.PROVIDER_RESULT, providerWithoutKind, '');
expectInvalid(
  CONTRACT_KINDS.PROVIDER_RESULT,
  { ...providerResult, kind: 'WeatherDiagnosisResult' },
  '/kind',
);
const releasedProviderResult = clone(providerResult);
releasedProviderResult.publication.readyForRelease = true;
expectInvalid(CONTRACT_KINDS.PROVIDER_RESULT, releasedProviderResult, '/publication/readyForRelease');

const diagnosisResult = {
  ...Diagnosis.diagnoseDataset(normalizedDataset, 'all'),
  kind: 'WeatherDiagnosisResult',
};
assert.equal(validate(CONTRACT_KINDS.DIAGNOSIS_RESULT, diagnosisResult).valid, true);
const compactDiagnosisResult = {
  ...diagnosisResult,
  evidence: diagnosisResult.evidence
    .filter((record) => record.evidenceType === 'algorithm-diagnosis'),
  evidenceSummary: Contracts.summarizeEvidence(diagnosisResult.evidence),
};
assert.equal(
  validate(CONTRACT_KINDS.DIAGNOSIS_RESULT, compactDiagnosisResult).valid,
  true,
);
const diagnosisWithoutKind = clone(diagnosisResult);
delete diagnosisWithoutKind.kind;
expectInvalid(CONTRACT_KINDS.DIAGNOSIS_RESULT, diagnosisWithoutKind, '');
expectInvalid(
  CONTRACT_KINDS.DIAGNOSIS_RESULT,
  { ...diagnosisResult, schemaVersion: 'meteomate.weather.diagnosis/v2' },
  '/schemaVersion',
);
expectInvalid(
  CONTRACT_KINDS.DIAGNOSIS_RESULT,
  { ...diagnosisResult, kind: 'WeatherProviderResult' },
  '/kind',
);

const hash = '1'.repeat(64);
const manifest = {
  apiVersion: 'meteomate.weather.golden-replay/v1',
  kind: 'WeatherGoldenReplay',
  id: 'golden-heavy-rain-r1',
  revision: 1,
  supersedes: null,
  dataPolicy: {
    origin: 'synthetic',
    classification: 'demo',
    synthetic: true,
    official: false,
    anonymizationProfile: 'synthetic-v1',
    privacyReviewed: true,
  },
  input: {
    path: 'input.json',
    fileSha256: `sha256:${hash}`,
    datasetSchemaVersion: 'meteomate.weather.dataset/v1',
  },
  pipeline: {
    diagnosisKind: 'all',
    normalizerVersion: 'meteomate-weather-normalizer/1.0.0',
    algorithm: {
      name: 'meteomate-weather-diagnosis',
      version: 'meteomate-weather-diagnosis/1.0.0',
    },
    renderer: {
      name: 'meteomate-weather-map',
      version: 'meteomate-weather-map/1.0.0',
      outputPath: 'actual/risk-map.html',
    },
  },
  clock: {
    inWindow: '2026-07-30T00:00:00Z',
    expired: '2026-08-01T00:00:00Z',
  },
  expected: {
    path: 'expected.json',
    fileSha256: `sha256:${hash}`,
    datasetHash: hash,
    evidenceCount: 12,
    evidenceTypeCounts: {
      'meteorological-fact': 4,
      'algorithm-diagnosis': 8,
    },
    artifactContentHash: hash,
    readyForRelease: false,
  },
};
assert.equal(validate(CONTRACT_KINDS.GOLDEN_REPLAY, manifest).valid, true);
expectInvalid(
  CONTRACT_KINDS.GOLDEN_REPLAY,
  { ...manifest, apiVersion: 'meteomate.weather.golden-replay/v2' },
  '/apiVersion',
);
expectInvalid(
  CONTRACT_KINDS.GOLDEN_REPLAY,
  { ...manifest, kind: 'WeatherGoldenReplayResult' },
  '/kind',
);
const invalidPolicy = clone(manifest);
invalidPolicy.dataPolicy.official = true;
expectInvalid(CONTRACT_KINDS.GOLDEN_REPLAY, invalidPolicy, '/dataPolicy/official');
const invalidInputHash = clone(manifest);
invalidInputHash.input.fileSha256 = hash;
expectInvalid(CONTRACT_KINDS.GOLDEN_REPLAY, invalidInputHash, '/input/fileSha256');

const unknown = validate('weather', {});
assert.equal(unknown.valid, false);
assert.equal(unknown.code, ERROR_CODES.UNKNOWN_KIND);
assert.deepEqual(unknown.errors[0].params.allowedKinds, Object.values(CONTRACT_KINDS));
assert.equal(validate('toString', {}).code, ERROR_CODES.UNKNOWN_KIND);
assert.throws(
  () => validateOrThrow('weather', {}),
  (error) => {
    assert.ok(error instanceof WeatherContractError);
    assert.equal(error.code, ERROR_CODES.UNKNOWN_KIND);
    assert.equal(error.details.kind, 'weather');
    assert.match(error.message, /Unsupported weather contract kind/);
    return true;
  },
);

console.log('weather JSON Schema contract tests passed');
