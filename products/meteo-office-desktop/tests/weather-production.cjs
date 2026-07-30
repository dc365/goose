const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Providers = require('../capabilities/weather/providers.cjs');
const Diagnosis = require('../capabilities/weather/diagnosis.cjs');
const Render = require('../capabilities/weather/render.cjs');
const Contracts = require('../capabilities/weather/contracts.cjs');
const WeatherConnector = require('../capabilities/weather-connector.js');

(async () => {
  const datasetFixture = {
    id: 'south-rain-20260729',
    name: '华南强降水过程',
    region: { name: '华南', bbox: [108, 18, 118, 27], timezone: 'Asia/Shanghai' },
    issueTime: '2026-07-29T08:00:00+08:00',
    validTime: { start: '2026-07-29T08:00:00+08:00', end: '2026-07-30T08:00:00+08:00' },
    model: 'ECMWF',
    forecastHour: 24,
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
    response.end(JSON.stringify({ dataset: datasetFixture }));
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
  assert.ok(queried.evidence.length >= 10);
  assert.equal(queried.publication.readyForHumanReview, true);
  const queriedAgain = await Providers.queryDataset({ workspace, sourceId: 'local-products', datasetRef: 'case.json', securityMode: 'internal' });
  assert.equal(queriedAgain.dataset.contentHash, queried.dataset.contentHash, 'retrieval time and absolute path must not change dataset hash');
  assert.deepEqual(
    queriedAgain.evidence.map((item) => item.id),
    queried.evidence.map((item) => item.id),
    'equivalent data must produce stable Evidence IDs',
  );
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
  fs.mkdirSync(path.join(secondWorkspace, '.meteomate'), { recursive: true });
  fs.mkdirSync(path.join(secondWorkspace, 'data'), { recursive: true });
  fs.copyFileSync(path.join(workspace, '.meteomate', 'weather-sources.json'), path.join(secondWorkspace, '.meteomate', 'weather-sources.json'));
  fs.copyFileSync(path.join(workspace, 'data', 'case.json'), path.join(secondWorkspace, 'data', 'case.json'));
  const queriedFromCopy = await Providers.queryDataset({ workspace: secondWorkspace, sourceId: 'local-products', datasetRef: 'case.json', securityMode: 'internal' });
  assert.equal(queriedFromCopy.dataset.id, queried.dataset.id, 'equivalent local data must produce a stable Dataset ID across workspaces');
  assert.equal(queriedFromCopy.dataset.contentHash, queried.dataset.contentHash, 'absolute local path must not affect Dataset Hash');
  assert.deepEqual(
    queriedFromCopy.evidence.map((item) => item.id),
    queried.evidence.map((item) => item.id),
    'absolute local path must not affect Evidence IDs',
  );

  const result = Diagnosis.diagnoseDataset(queried.dataset, 'all');
  assert.ok(result.diagnosis.heavyRain.total >= 65);
  assert.ok(result.diagnosis.synoptic.systems.length >= 3);
  assert.equal(result.publication.readyForRelease, false);
  assert.equal(result.publication.requiresHumanSignoff, true);
  assert.ok(result.evidence.some((item) => item.evidenceType === 'algorithm-diagnosis'));

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

  process.env.METEOMATE_WEATHER_WORKSPACE = workspace;
  const connectorRendered = await WeatherConnector.executeTool('weather_render_dataset_map', {
    dataset: queried.dataset,
    diagnosis: { forged: true },
    evidence: [{ id: 'forged-evidence' }],
    outputPath: 'artifacts/weather/connector-risk-map.html',
  });
  assert.equal(connectorRendered.diagnosis.forged, undefined);
  assert.ok(connectorRendered.artifact.metadata.algorithm);
  assert.equal(connectorRendered.artifact.evidenceIds.includes('forged-evidence'), false);
  console.log('weather production/intranet provider tests passed');
  } finally {
    if (previousWeatherWorkspace == null) delete process.env.METEOMATE_WEATHER_WORKSPACE;
    else process.env.METEOMATE_WEATHER_WORKSPACE = previousWeatherWorkspace;
    if (previousCredential == null) delete process.env[credentialEnvironment];
    else process.env[credentialEnvironment] = previousCredential;
    if (previousBindings == null) delete process.env[bindingsEnvironment];
    else process.env[bindingsEnvironment] = previousBindings;
    await new Promise((resolve) => server.close(resolve));
    for (const target of [workspace, secondWorkspace, outsideArtifacts]) {
      if (target) fs.rmSync(target, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
