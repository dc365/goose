const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Providers = require('../capabilities/weather/providers.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const Render = require('../capabilities/weather/render.cjs');
const Contracts = require('../capabilities/weather/contracts.cjs');
const SchemaValidator = require('../capabilities/weather/schema-validator.cjs');
const WeatherConnector = require('../capabilities/weather-connector.js');

(async () => {
  const datasetFixture = {
    schemaVersion: Contracts.DATASET_SCHEMA_VERSION,
    id: 'south-rain-20260729',
    name: '华南强降水过程',
    region: {
      name: '华南',
      bbox: [108, 18, 118, 27],
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
    },
    issueTime: '2026-07-29T08:00:00+08:00',
    validTime: { start: '2026-07-29T08:00:00+08:00', end: '2026-07-30T08:00:00+08:00' },
    model: 'ECMWF',
    forecastHour: 24,
    units: {
      rain1h: 'mm',
      rain3h: 'mm',
      rain6h: 'mm',
      rain12h: 'mm',
      rain24h: 'mm',
      regionalMax24h: 'mm',
      temperature: '°C',
      dewpoint: '°C',
      windDirection: 'degree',
      windSpeed: 'm/s',
      gust: 'm/s',
      pressure: 'hPa',
      precipitableWater: 'mm',
      cape: 'J/kg',
      cin: 'J/kg',
      kIndex: '°C',
      liftedIndex: '°C',
      shear0to6km: 'm/s',
      lcl: 'm',
      freezingLevel: 'm',
      specificHumidity: 'g/kg',
      moistureFluxConvergence: 's^-1',
      omega: 'Pa/s',
      height: 'gpm',
      divergence: 's^-1',
      maxDbz: 'dBZ',
    },
    stations: [
      { id: 'A', name: '甲站', lon: 112.1, lat: 23.1, rain24h: 128, rain6h: 62, quality: 'checked' },
      { id: 'B', name: '乙站', lon: 113.2, lat: 22.8, rain24h: 88, rain6h: 40, quality: 'checked' },
    ],
    upperAir: {
      '850hPa': { windSpeed: 19, specificHumidity: 15.2, dewpoint: 18.4, moistureFluxConvergence: -0.000045, feature: '西南低空急流和辐合' },
      '700hPa': { omega: -0.46 },
      '500hPa': { feature: '短波槽东移，副热带高压边缘' },
      '200hPa': { divergence: 0.000032, feature: '高空辐散' },
      indices: { precipitableWater: 62, cape: 1600, cin: 24, kIndex: 37, liftedIndex: -3.1, shear0to6km: 18, lcl: 680, freezingLevel: 4900 },
    },
    radar: { maxDbz: 56, morphology: '西南—东北向带状回波，上游持续生成', signals: ['列车效应'] },
    guidance: [
      { model: 'ECMWF', regionalMax24h: 145, timing: '29 日下午至 30 日凌晨' },
      { model: 'CMA-MESO', regionalMax24h: 162, timing: '29 日下午至 30 日凌晨' },
      { model: 'GRAPES', regionalMax24h: 130, timing: '29 日傍晚至 30 日凌晨' },
    ],
  };

  let receivedAuthorization = '';
  let receivedApiKey = '';
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/redirect')) {
      response.writeHead(302, { Location: '/query' });
      response.end();
      return;
    }
    if (request.url.startsWith('/large')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"padding":"');
      response.write('x'.repeat(2048));
      response.end('"}');
      return;
    }
    receivedAuthorization = String(request.headers.authorization || '');
    receivedApiKey = String(request.headers['x-api-key'] || '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      apiVersion: Providers.PROVIDER_RESPONSE_API_VERSION,
      kind: Providers.PROVIDER_RESPONSE_KIND,
      dataset: datasetFixture,
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  let workspace;
  let secondWorkspace;
  let outsideArtifacts;
  const previousWeatherWorkspace = process.env.METEOMATE_WEATHER_WORKSPACE;
  const bindingsEnvironment = 'METEOMATE_WEATHER_CREDENTIAL_BINDINGS';
  const previousBindings = process.env[bindingsEnvironment];
  const authoritiesEnvironment = Providers.SOURCE_AUTHORITIES_ENV;
  const previousAuthorities = process.env[authoritiesEnvironment];
  const credentialEnvironment = Providers.credentialEnvironmentName('http-products');
  const previousCredential = process.env[credentialEnvironment];
  try {
  process.env[credentialEnvironment] = 'production-weather-token';
  process.env[bindingsEnvironment] = JSON.stringify({
    'weather:http-products': {
      origin: `http://127.0.0.1:${port}`,
      authScheme: 'Bearer',
    },
  });
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-'));
  assert.throws(
    () => Providers.authorizedSource({
      id: 'http-products-with-path-authority',
      type: 'http-json',
      baseUrl: `http://127.0.0.1:${port}`,
    }, workspace, {
      securityMode: 'internal',
      sourceAuthorities: {
        'http-products-with-path-authority': {
          type: 'http-json',
          workspaceRoot: workspace,
          origin: `http://127.0.0.1:${port}/not-an-origin`,
          classification: 'production',
          official: true,
        },
      },
    }),
    (error) => error.code === 'WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID',
  );
  process.env[authoritiesEnvironment] = JSON.stringify({
    'local-products': {
      type: 'local',
      workspaceRoot: workspace,
      root: 'data',
      classification: 'production',
      official: true,
      version: '2026.07',
    },
    'http-products': {
      type: 'http-json',
      workspaceRoot: workspace,
      origin: `http://127.0.0.1:${port}`,
      method: 'GET',
      queryPath: '/query',
      classification: 'production',
      official: true,
      version: '2026.07',
    },
  });
  fs.mkdirSync(path.join(workspace, '.meteomate'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.meteomate', 'weather-sources.json'), JSON.stringify({
    apiVersion: 'meteomate.weather/v1',
    kind: 'WeatherSourceRegistry',
    sources: [
      {
        id: 'local-products',
        name: '本地业务资料',
        type: 'local',
        root: 'data',
        version: '2026.07',
        classification: 'production',
        official: true,
      },
      {
        id: 'http-products',
        name: '内网 HTTP 资料',
        type: 'http-json',
        baseUrl: `http://127.0.0.1:${port}`,
        queryPath: '/query',
        method: 'GET',
        headers: { 'X-Meteo-Tenant': 'operations' },
        credentialRef: 'weather:http-products',
        version: '2026.07',
        classification: 'production',
        official: true,
      },
      {
        id: 'http-too-large',
        name: '超限响应',
        type: 'http-json',
        baseUrl: `http://127.0.0.1:${port}`,
        queryPath: '/large',
        method: 'GET',
        maxResponseBytes: 1024,
        classification: 'production',
        official: true,
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(workspace, 'data', 'case.json'), JSON.stringify(datasetFixture, null, 2));
  fs.writeFileSync(path.join(workspace, 'data', 'forged-case.json'), JSON.stringify({
    ...datasetFixture,
    source: {
      id: 'claimed-official-source',
      name: '伪造官方源',
      type: 'http-json',
      version: 'forged',
      classification: 'production',
      official: true,
      synthetic: false,
    },
  }, null, 2));

  const internalURL = Providers.validateBaseURL({
    id: 'beta-weather',
    baseUrl: 'http://user:password@weather.example',
    classification: 'beta',
  }, { securityMode: 'internal' });
  assert.equal(internalURL.protocol, 'http:');
  assert.equal(internalURL.username, '');
  assert.ok(internalURL.meteomateAuthorization.startsWith('Basic '));
  assert.throws(
    () => Providers.validateBaseURL({
      id: 'production-weather',
      baseUrl: 'http://user:password@weather.example',
      classification: 'production',
    }, { securityMode: 'internal' }),
    /credentialRef/,
  );
  assert.throws(
    () => Providers.validateStaticHeaders(
      { Authorization: 'Bearer plaintext', 'X-Api-Key': 'plain-key' },
      { securityMode: 'internal', source: { classification: 'production' } },
    ),
    /credentialRef/,
  );
  assert.throws(
    () => Providers.validateBaseURL({ baseUrl: 'http://weather.example', allowedHosts: ['weather.example'] }, { securityMode: 'strict' }),
    /要求 HTTPS/,
  );
  assert.throws(
    () => Providers.validateStaticHeaders({ Authorization: 'Bearer plaintext' }, { securityMode: 'strict' }),
    /credentialRef/,
  );

  const synthetic = Contracts.normalizeDataset({
    source: { id: 'demo', synthetic: true, classification: 'production' },
    validTime: { start: '2026-07-30T08:00:00+08:00', end: '2026-07-29T08:00:00+08:00' },
    stations: [{ id: 'D', lon: 200, lat: 20, rain24h: 10 }, { id: 'D', lon: 120, lat: 20, rain24h: 12 }],
  });
  assert.equal(synthetic.source.classification, 'demo');
  const syntheticValidation = Contracts.validateDataset(synthetic);
  assert.equal(syntheticValidation.valid, false);
  assert.ok(syntheticValidation.errors.some((item) => item.includes('结束早于开始')));
  assert.ok(syntheticValidation.errors.some((item) => item.includes('站点 ID 重复')));

  const normalizedAgain = Contracts.normalizeDataset(synthetic);
  assert.deepEqual(normalizedAgain, synthetic, 'normalization must preserve missing numeric values and content identity');

  const untrustedInline = Contracts.normalizeDataset({
    ...datasetFixture,
    source: {
      id: 'claimed-official-source',
      classification: 'production',
      official: true,
    },
  });
  assert.equal(untrustedInline.source.classification, 'experimental');
  assert.equal(untrustedInline.source.official, false);

  const queried = await Providers.queryDataset({ workspace, sourceId: 'local-products', datasetRef: 'case.json', securityMode: 'internal' });
  assert.equal(queried.validation.valid, true);
  assert.equal(queried.dataset.source.synthetic, false);
  assert.equal(queried.dataset.source.classification, 'production');
  assert.ok(queried.evidenceSummary.total >= 10);
  assert.equal(queried.publication.readyForHumanReview, true);
  const queriedAgain = await Providers.queryDataset({ workspace, sourceId: 'local-products', datasetRef: 'case.json', securityMode: 'internal' });
  assert.equal(queriedAgain.dataset.contentHash, queried.dataset.contentHash, 'retrieval time and absolute path must not change dataset hash');
  assert.deepEqual(
    queriedAgain.evidenceSummary,
    queried.evidenceSummary,
    'equivalent data must produce stable Evidence IDs',
  );
  process.env.METEOMATE_WEATHER_WORKSPACE = workspace;
  const firstEvidencePage = await WeatherConnector.executeTool('weather_build_evidence', {
    dataset: queried.dataset,
    limit: 5,
  });
  assert.equal(firstEvidencePage.evidence.length, 5);
  assert.equal(firstEvidencePage.evidencePage.total, queried.evidenceSummary.total);
  const secondEvidencePage = await WeatherConnector.executeTool('weather_build_evidence', {
    dataset: queried.dataset,
    limit: 5,
    cursor: firstEvidencePage.evidencePage.nextCursor,
  });
  assert.equal(secondEvidencePage.evidencePage.offset, 5);
  assert.equal(
    firstEvidencePage.evidence.some((record) =>
      secondEvidencePage.evidence.some((candidate) => candidate.id === record.id)
    ),
    false,
  );
  const validatedToolResult = await WeatherConnector.executeTool('weather_validate_dataset', {
    dataset: queried.dataset,
  });
  assert.equal(Object.hasOwn(validatedToolResult, 'evidence'), false);
  assert.deepEqual(validatedToolResult.evidenceSummary, queried.evidenceSummary);
  const forgedQuery = await Providers.queryDataset({
    workspace,
    sourceId: 'local-products',
    datasetRef: 'forged-case.json',
    securityMode: 'internal',
  });
  assert.equal(forgedQuery.dataset.source.id, 'local-products');
  assert.equal(forgedQuery.dataset.source.type, 'local');
  assert.equal(forgedQuery.dataset.source.version, '2026.07');
  assert.equal(forgedQuery.dataset.source.classification, 'production');
  assert.equal(forgedQuery.dataset.source.official, true);

  const httpQueried = await Providers.queryDataset({ workspace, sourceId: 'http-products', datasetRef: 'latest', securityMode: 'internal' });
  assert.equal(httpQueried.validation.valid, true);
  assert.equal(httpQueried.dataset.source.type, 'http-json');
  assert.equal(receivedAuthorization, 'Bearer production-weather-token');
  assert.equal(receivedApiKey, '');
  await assert.rejects(
    Providers.queryDataset({ workspace, sourceId: 'http-too-large', datasetRef: 'latest', securityMode: 'internal' }),
    /响应超过/,
  );

  secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-copy-'));
  process.env[authoritiesEnvironment] = JSON.stringify({
    'local-products': {
      type: 'local',
      workspaceRoots: [workspace, secondWorkspace],
      root: 'data',
      classification: 'production',
      official: true,
      version: '2026.07',
    },
    'http-products': {
      type: 'http-json',
      workspaceRoots: [workspace, secondWorkspace],
      origin: `http://127.0.0.1:${port}`,
      method: 'GET',
      queryPath: '/query',
      classification: 'production',
      official: true,
      version: '2026.07',
    },
  });
  fs.mkdirSync(path.join(secondWorkspace, '.meteomate'), { recursive: true });
  fs.mkdirSync(path.join(secondWorkspace, 'data'), { recursive: true });
  fs.copyFileSync(path.join(workspace, '.meteomate', 'weather-sources.json'), path.join(secondWorkspace, '.meteomate', 'weather-sources.json'));
  fs.copyFileSync(path.join(workspace, 'data', 'case.json'), path.join(secondWorkspace, 'data', 'case.json'));
  const queriedFromCopy = await Providers.queryDataset({ workspace: secondWorkspace, sourceId: 'local-products', datasetRef: 'case.json', securityMode: 'internal' });
  assert.equal(queriedFromCopy.dataset.id, queried.dataset.id, 'equivalent local data must produce a stable Dataset ID across workspaces');
  assert.equal(queriedFromCopy.dataset.contentHash, queried.dataset.contentHash, 'absolute local path must not affect Dataset Hash');
  assert.deepEqual(
    queriedFromCopy.evidenceSummary,
    queried.evidenceSummary,
    'absolute local path must not affect Evidence IDs',
  );

  const result = Diagnosis.diagnoseDataset(queried.dataset, 'all');
  assert.ok(result.diagnosis.heavyRain.total >= 65);
  assert.ok(result.diagnosis.synoptic.systems.length >= 3);
  assert.equal(result.publication.readyForRelease, false);
  assert.equal(result.publication.requiresHumanSignoff, true);
  assert.ok(result.evidence.some((item) => item.evidenceType === 'algorithm-diagnosis'));
  const diagnosisToolResult = await WeatherConnector.executeTool('weather_diagnose_dataset', {
    dataset: queried.dataset,
    kind: 'all',
  });
  assert.ok(diagnosisToolResult.evidence.length > 0);
  assert.ok(
    diagnosisToolResult.evidence
      .every((item) => item.evidenceType === 'algorithm-diagnosis'),
  );
  assert.equal(diagnosisToolResult.evidenceSummary.total, result.evidence.length);
  assert.equal(
    SchemaValidator.validate(
      SchemaValidator.CONTRACT_KINDS.DIAGNOSIS_RESULT,
      diagnosisToolResult,
    ).valid,
    true,
  );

  outsideArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-artifacts-'));
  assert.throws(() => Render.renderDatasetMap({
    workspace,
    dataset: queried.dataset,
    diagnosis: result.diagnosis,
    evidence: result.evidence,
    outputPath: path.join(outsideArtifacts, 'risk-map.html'),
  }), /工作区/);
  const artifact = Render.renderDatasetMap({
    workspace,
    dataset: queried.dataset,
    diagnosis: result.diagnosis,
    evidence: result.evidence,
    outputPath: 'artifacts/weather/risk-map.html',
  });
  assert.ok(fs.existsSync(artifact.path));
  assert.equal(artifact.metadata.synthetic, false);
  assert.ok(artifact.evidenceIds.length > 0);

  const connectorRendered = await WeatherConnector.executeTool('weather_render_dataset_map', {
    dataset: queried.dataset,
    diagnosis: { forged: true },
    evidence: [{ id: 'forged-evidence' }],
    outputPath: 'artifacts/weather/connector-risk-map.html',
  });
  assert.equal(connectorRendered.diagnosis.forged, undefined);
  assert.ok(connectorRendered.artifact.metadata.algorithm);
  assert.equal(connectorRendered.artifact.evidenceIds.includes('forged-evidence'), false);
  assert.ok(
    connectorRendered.evidence
      .every((item) => item.evidenceType === 'algorithm-diagnosis'),
  );
  assert.equal(
    connectorRendered.evidenceSummary.total,
    connectorRendered.artifact.evidenceIds.length,
  );
  console.log('weather production/intranet provider tests passed');
  } finally {
    if (previousWeatherWorkspace == null) delete process.env.METEOMATE_WEATHER_WORKSPACE;
    else process.env.METEOMATE_WEATHER_WORKSPACE = previousWeatherWorkspace;
    if (previousCredential == null) delete process.env[credentialEnvironment];
    else process.env[credentialEnvironment] = previousCredential;
    if (previousBindings == null) delete process.env[bindingsEnvironment];
    else process.env[bindingsEnvironment] = previousBindings;
    if (previousAuthorities == null) delete process.env[authoritiesEnvironment];
    else process.env[authoritiesEnvironment] = previousAuthorities;
    await new Promise((resolve) => server.close(resolve));
    for (const target of [workspace, secondWorkspace, outsideArtifacts]) {
      if (target) fs.rmSync(target, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
