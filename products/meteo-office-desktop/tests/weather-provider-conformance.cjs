'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WeatherConnector = require('../capabilities/weather-connector.js');
const Providers = require('../capabilities/weather/providers.cjs');
const { startWeatherProviderMock } = require('./support/weather-provider-mock.cjs');

const DATASET = {
  schemaVersion: 'meteomate.weather.dataset/v1',
  id: 'provider-contract-20260730',
  name: 'Provider 契约回放资料',
  region: {
    name: '匿名测试区域',
    bbox: [110, 20, 116, 26],
    timezone: 'Asia/Shanghai',
    projection: 'EPSG:4326',
  },
  issueTime: '2026-07-30T00:00:00.000Z',
  validTime: {
    start: '2026-07-30T00:00:00.000Z',
    end: '2026-07-31T00:00:00.000Z',
  },
  model: 'CONTRACT-MODEL',
  forecastHour: 24,
  units: {
    rain1h: 'mm',
    rain6h: 'mm',
    rain24h: 'mm',
    temperature: 'degC',
    dewpoint: 'degC',
    windDirection: 'degree',
    windSpeed: 'm/s',
    gust: 'm/s',
    pressure: 'hPa',
  },
  stations: [
    {
      id: 'TEST-001',
      name: '匿名站一',
      lon: 112.5,
      lat: 23.1,
      rain1h: 12,
      rain6h: 48,
      rain24h: 96,
      temperature: 27,
      quality: 'checked',
      validTime: '2026-07-30T06:00:00.000Z',
    },
  ],
  quality: { status: 'checked' },
};

const workspaces = new Set();
let origin;
let redirectTarget;

function createWorkspace(sources) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-provider-contract-'));
  const registryDirectory = path.join(workspace, '.meteomate');
  fs.mkdirSync(registryDirectory, { recursive: true });
  fs.writeFileSync(path.join(registryDirectory, 'weather-sources.json'), JSON.stringify({
    apiVersion: 'meteomate.weather/v1',
    kind: 'WeatherSourceRegistry',
    sources,
  }, null, 2));
  workspaces.add(workspace);
  return workspace;
}

function httpSource(id, server, queryPath, overrides = {}) {
  return {
    id,
    name: id,
    type: 'http-json',
    baseUrl: server.url,
    queryPath,
    method: 'GET',
    allowedHosts: ['127.0.0.1'],
    allowInsecure: true,
    classification: 'beta',
    version: 'contract-v1',
    ...overrides,
  };
}

async function captureError(operation) {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
}

function captureSyncError(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}

function assertErrorCode(error, expectedCode) {
  assert.ok(error instanceof Error, `expected ${expectedCode}, but the operation succeeded`);
  assert.equal(error.code, expectedCode, `unexpected provider error: ${error.message}`);
}

function assertStableResult(first, second) {
  assert.equal(first.validation.valid, true);
  assert.equal(second.validation.valid, true);
  assert.equal(second.dataset.contentHash, first.dataset.contentHash);
  assert.deepEqual(second.evidenceSummary, first.evidenceSummary);
}

function httpAuthority(workspace, sourceId, queryPath, method = 'GET') {
  return {
    [sourceId]: {
      type: 'http-json',
      workspaceRoot: workspace,
      origin: origin.url,
      method,
      queryPath,
      classification: 'beta',
      official: false,
      version: 'contract-v1',
    },
  };
}

async function withSourceAuthorities(authorities, operation) {
  const environmentName = Providers.SOURCE_AUTHORITIES_ENV;
  const previous = process.env[environmentName];
  try {
    process.env[environmentName] = JSON.stringify(authorities);
    return await operation();
  } finally {
    if (previous == null) delete process.env[environmentName];
    else process.env[environmentName] = previous;
  }
}

test.before(async () => {
  origin = await startWeatherProviderMock({ dataset: DATASET });
  redirectTarget = await startWeatherProviderMock({ dataset: DATASET });
  origin.setRedirectTarget(`${redirectTarget.url}/valid`);
});

test.after(async () => {
  for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
  await Promise.all([origin?.close(), redirectTarget?.close()]);
});

test.beforeEach(() => {
  origin.resetRequests();
  redirectTarget.resetRequests();
});

test('strict mode rejects an absolute queryPath HTTP downgrade before sending', async () => {
  const workspace = createWorkspace([
    httpSource('downgrade', origin, `${origin.url}/valid`, {
      baseUrl: `https://127.0.0.1:${origin.port}`,
    }),
  ]);
  const error = await captureError(() => Providers.queryDataset({
    workspace,
    sourceId: 'downgrade',
    datasetRef: 'latest',
    securityMode: 'strict',
  }));

  assert.equal(origin.requests.length, 0, 'a rejected downgrade must not reach the HTTP target');
  assertErrorCode(error, 'WEATHER_PROVIDER_HTTP_DOWNGRADE');
});

test('sensitive static headers disable redirects and never reach another origin', async (context) => {
  for (const [headerName, secret] of [
    ['X-Api-Key', 'api-key-must-not-cross-origin'],
    ['X-Upstream-Secret', 'named-secret-must-not-cross-origin'],
  ]) {
    await context.test(headerName, async () => {
      origin.resetRequests();
      redirectTarget.resetRequests();
      const workspace = createWorkspace([
        httpSource(`redirect-${headerName.toLowerCase()}`, origin, '/redirect', {
          headers: { [headerName]: secret },
        }),
      ]);
      const error = await captureError(() => Providers.queryDataset({
        workspace,
        sourceId: `redirect-${headerName.toLowerCase()}`,
        datasetRef: 'latest',
        securityMode: 'internal',
      }));

      assert.equal(redirectTarget.requests.length, 0, 'redirect target must not receive a secret-bearing request');
      assert.equal(String(error?.message || '').includes(secret), false, 'provider errors must not disclose secrets');
      assertErrorCode(error, 'WEATHER_PROVIDER_REDIRECT_BLOCKED');
    });
  }
});

test('unknown source types are rejected by registry and query preflight', async () => {
  const workspace = createWorkspace([{
    id: 'unsupported',
    name: 'unsupported',
    type: 'weather-grpc',
    classification: 'beta',
  }]);

  assertErrorCode(
    captureSyncError(() => Providers.listSources(workspace, { securityMode: 'internal' })),
    'WEATHER_PROVIDER_UNSUPPORTED_SOURCE_TYPE',
  );
  assertErrorCode(
    await captureError(() => Providers.queryDataset({
      workspace,
      sourceId: 'unsupported',
      datasetRef: 'latest',
      securityMode: 'internal',
    })),
    'WEATHER_PROVIDER_UNSUPPORTED_SOURCE_TYPE',
  );
  assert.equal(origin.requests.length, 0);
});

test('HTTP failure modes expose stable provider error codes', async (context) => {
  const sources = [
    httpSource('malformed', origin, '/malformed'),
    httpSource('status', origin, '/status'),
    httpSource('oversize', origin, '/oversize', { maxResponseBytes: 1_024 }),
    httpSource('timeout', origin, '/delay', { timeoutMs: 1_000 }),
    httpSource('content-type', origin, '/wrong-content-type'),
    httpSource('wrong-envelope', origin, '/wrong-envelope'),
    httpSource('bare-dataset', origin, '/bare-dataset'),
    httpSource('connection-reset', origin, '/reset'),
  ];
  const workspace = createWorkspace(sources);
  const cases = [
    ['malformed JSON', 'malformed', 'WEATHER_PROVIDER_INVALID_JSON'],
    ['HTTP 500', 'status', 'WEATHER_PROVIDER_HTTP_ERROR'],
    ['streamed oversized body', 'oversize', 'WEATHER_PROVIDER_RESPONSE_TOO_LARGE'],
    ['timeout', 'timeout', 'WEATHER_PROVIDER_TIMEOUT'],
    ['invalid Content-Type', 'content-type', 'WEATHER_PROVIDER_CONTENT_TYPE_INVALID'],
    ['unsupported response envelope', 'wrong-envelope', 'WEATHER_PROVIDER_RESPONSE_SCHEMA_INVALID'],
    ['bare HTTP dataset', 'bare-dataset', 'WEATHER_PROVIDER_RESPONSE_SCHEMA_INVALID'],
    ['connection reset', 'connection-reset', 'WEATHER_PROVIDER_NETWORK_ERROR'],
  ];

  for (const [name, sourceId, code] of cases) {
    await context.test(name, async () => {
      const error = await captureError(() => Providers.queryDataset({
        workspace,
        sourceId,
        datasetRef: 'latest',
        securityMode: 'internal',
      }));
      assertErrorCode(error, code);
    });
  }
});

test('valid GET and POST providers replay stable hashes and Evidence IDs', async () => {
  const workspace = createWorkspace([
    httpSource('valid-get', origin, '/valid'),
    httpSource('valid-post', origin, '/valid', { method: 'POST' }),
  ]);

  await withSourceAuthorities({
    ...httpAuthority(workspace, 'valid-get', '/valid', 'GET'),
    ...httpAuthority(workspace, 'valid-post', '/valid', 'POST'),
  }, async () => {
    const getFirst = await Providers.queryDataset({
      workspace,
      sourceId: 'valid-get',
      datasetRef: 'latest',
      query: { cycle: '00', member: ['control', 'perturbed'] },
      securityMode: 'strict',
    });
    const getSecond = await Providers.queryDataset({
      workspace,
      sourceId: 'valid-get',
      datasetRef: 'latest',
      query: { cycle: '00', member: ['control', 'perturbed'] },
      securityMode: 'strict',
    });
    assertStableResult(getFirst, getSecond);

    const postFirst = await Providers.queryDataset({
      workspace,
      sourceId: 'valid-post',
      datasetRef: 'latest',
      query: { cycle: '00' },
      securityMode: 'strict',
    });
    const postSecond = await Providers.queryDataset({
      workspace,
      sourceId: 'valid-post',
      datasetRef: 'latest',
      query: { cycle: '00' },
      securityMode: 'strict',
    });
    assertStableResult(postFirst, postSecond);
  });

  const getRequest = origin.requests.find((request) => request.method === 'GET');
  assert.ok(getRequest.url.includes('datasetRef=latest'));
  assert.ok(getRequest.url.includes('cycle=00'));
  assert.deepEqual(
    new URL(getRequest.url, origin.url).searchParams.getAll('member'),
    ['control', 'perturbed'],
  );
  const postRequest = origin.requests.find((request) => request.method === 'POST');
  assert.deepEqual(JSON.parse(postRequest.body), {
    datasetRef: 'latest',
    query: { cycle: '00' },
  });
});

test('query conflicts are rejected before the Provider is called', async () => {
  const workspace = createWorkspace([
    httpSource('query-conflict', origin, '/valid'),
  ]);
  const error = await captureError(() => Providers.queryDataset({
    workspace,
    sourceId: 'query-conflict',
    datasetRef: 'top-level',
    query: { datasetRef: 'nested' },
    securityMode: 'strict',
  }));

  assertErrorCode(error, 'WEATHER_PROVIDER_QUERY_INVALID');
  assert.equal(origin.requests.length, 0);
});

test('upstream error bodies cannot echo configured secrets', async () => {
  const secret = 'must-not-appear-in-provider-error';
  const workspace = createWorkspace([
    httpSource('secret-error', origin, '/secret-error', {
      headers: { 'X-Api-Key': secret },
    }),
  ]);
  const error = await captureError(() => Providers.queryDataset({
    workspace,
    sourceId: 'secret-error',
    datasetRef: 'latest',
    securityMode: 'internal',
  }));

  assertErrorCode(error, 'WEATHER_PROVIDER_HTTP_ERROR');
  assert.equal(error.message.includes(secret), false);
  assert.equal(JSON.stringify(error.details || {}).includes(secret), false);
});

test('workspace registry cannot self-declare an official production source', async () => {
  const workspace = createWorkspace([
    httpSource('self-declared-production', origin, '/valid', {
      classification: 'production',
      official: true,
    }),
  ]);
  const result = await Providers.queryDataset({
    workspace,
    sourceId: 'self-declared-production',
    datasetRef: 'latest',
    securityMode: 'internal',
  });

  assert.equal(result.provider.authority, 'workspace');
  assert.equal(result.provider.classification, 'experimental');
  assert.equal(result.provider.official, false);
  assert.equal(result.dataset.source.authority, 'workspace');
  assert.equal(result.dataset.source.classification, 'experimental');
  assert.equal(result.dataset.source.official, false);
  assert.equal(result.publication.readyForHumanReview, false);
  assert.ok(result.publication.blockers.some((item) => item.includes('实验数据')));

  const strictError = await captureError(() => Providers.queryDataset({
    workspace,
    sourceId: 'self-declared-production',
    datasetRef: 'latest',
    securityMode: 'strict',
  }));
  assertErrorCode(strictError, 'WEATHER_PROVIDER_SOURCE_NOT_AUTHORIZED');
});

test('credential values are delivered only to their bound origin and never returned', async () => {
  const sourceId = 'credentialed';
  const secret = 'provider-contract-secret-7f47c5';
  const credentialEnvironment = Providers.credentialEnvironmentName(sourceId);
  const bindingsEnvironment = 'METEOMATE_WEATHER_CREDENTIAL_BINDINGS';
  const previousCredential = process.env[credentialEnvironment];
  const previousBindings = process.env[bindingsEnvironment];
  const workspace = createWorkspace([
    httpSource(sourceId, origin, '/valid', {
      credentialRef: Providers.credentialReference(sourceId),
    }),
  ]);

  try {
    process.env[credentialEnvironment] = secret;
    process.env[bindingsEnvironment] = JSON.stringify({
      [Providers.credentialReference(sourceId)]: {
        origin: origin.url,
        authScheme: 'Bearer',
      },
    });
    const result = await withSourceAuthorities(
      httpAuthority(workspace, sourceId, '/valid', 'GET'),
      () => Providers.queryDataset({
        workspace,
        sourceId,
        datasetRef: 'latest',
        securityMode: 'strict',
      }),
    );

    assert.equal(origin.requests.length, 1);
    assert.equal(origin.requests[0].headers.authorization, `Bearer ${secret}`);
    assert.equal(redirectTarget.requests.length, 0);
    assert.equal(JSON.stringify(result).includes(secret), false);
  } finally {
    if (previousCredential == null) delete process.env[credentialEnvironment];
    else process.env[credentialEnvironment] = previousCredential;
    if (previousBindings == null) delete process.env[bindingsEnvironment];
    else process.env[bindingsEnvironment] = previousBindings;
  }
});

test('large station datasets return an Evidence summary instead of multi-megabyte records', async () => {
  const workspace = createWorkspace([{
    id: 'large-local',
    name: 'large-local',
    type: 'local',
    root: '.',
  }]);
  const stations = Array.from({ length: 600 }, (_, index) => ({
    id: `LARGE-${String(index).padStart(3, '0')}`,
    name: `Large Station ${index}`,
    lon: 110 + (index % 60) * 0.05,
    lat: 20 + Math.floor(index / 60) * 0.05,
    rain1h: index % 30,
    rain6h: index % 90,
    rain24h: index % 180,
    temperature: 20 + (index % 15),
    dewpoint: 15 + (index % 10),
    windSpeed: 3 + (index % 12),
    gust: 8 + (index % 20),
    pressure: 980 + (index % 30),
    quality: 'checked',
  }));
  fs.writeFileSync(path.join(workspace, 'large.json'), JSON.stringify({
    ...DATASET,
    id: 'provider-large-evidence',
    units: {
      ...DATASET.units,
      specificHumidity: 'g/kg',
      moistureFluxConvergence: 's^-1',
    },
    stations,
    upperAir: {
      '850hPa': {
        specificHumidity: 14,
        moistureFluxConvergence: -0.00004,
        windSpeed: 16,
      },
    },
  }));

  const result = await Providers.queryDataset({
    workspace,
    sourceId: 'large-local',
    datasetRef: 'large.json',
    securityMode: 'internal',
  });

  assert.equal(Object.hasOwn(result, 'evidence'), false);
  assert.equal(result.evidenceSummary.total, 4_803);
  assert.equal(result.evidenceSummary.pageTool, 'weather_build_evidence');
  assert.ok(JSON.stringify(result).length < 2 * 1024 * 1024);

  const previousWorkspace = process.env.METEOMATE_WEATHER_WORKSPACE;
  try {
    process.env.METEOMATE_WEATHER_WORKSPACE = workspace;
    const validated = await WeatherConnector.executeTool('weather_validate_dataset', {
      dataset: result.dataset,
    });
    assert.equal(Object.hasOwn(validated, 'evidence'), false);
    assert.equal(validated.evidenceSummary.total, result.evidenceSummary.total);
    assert.ok(JSON.stringify(validated).length < 2 * 1024 * 1024);

    const diagnosed = await WeatherConnector.executeTool('weather_diagnose_dataset', {
      dataset: result.dataset,
      kind: 'heavy-rain',
    });
    assert.ok(diagnosed.evidence.length > 0);
    assert.ok(diagnosed.evidence.every((record) =>
      record.evidenceType === 'algorithm-diagnosis'
    ));
    assert.ok(diagnosed.evidenceSummary.total > diagnosed.evidence.length);
    assert.ok(JSON.stringify(diagnosed).length < 2 * 1024 * 1024);
  } finally {
    if (previousWorkspace == null) delete process.env.METEOMATE_WEATHER_WORKSPACE;
    else process.env.METEOMATE_WEATHER_WORKSPACE = previousWorkspace;
  }
});

test('deployment authority requires a version and exact endpoint binding', async () => {
  const workspace = createWorkspace([
    httpSource('missing-version', origin, '/valid'),
    httpSource('path-mismatch', origin, '/valid'),
  ]);
  const missingVersion = httpAuthority(workspace, 'missing-version', '/valid');
  delete missingVersion['missing-version'].version;
  const missingVersionError = await withSourceAuthorities(
    missingVersion,
    () => captureError(() => Providers.queryDataset({
      workspace,
      sourceId: 'missing-version',
      datasetRef: 'latest',
      securityMode: 'strict',
    })),
  );
  assertErrorCode(missingVersionError, 'WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID');

  const pathMismatchError = await withSourceAuthorities(
    httpAuthority(workspace, 'path-mismatch', '/other-path'),
    () => captureError(() => Providers.queryDataset({
      workspace,
      sourceId: 'path-mismatch',
      datasetRef: 'latest',
      securityMode: 'strict',
    })),
  );
  assertErrorCode(pathMismatchError, 'WEATHER_PROVIDER_AUTHORITY_MISMATCH');
  assert.equal(origin.requests.length, 0);
});

test('strict mode rejects sensitive static and dynamic URL query parameters', async () => {
  const workspace = createWorkspace([
    httpSource('static-secret-query', origin, '/valid?api_key=must-not-send'),
    httpSource('dynamic-secret-query', origin, '/valid'),
  ]);
  const authorities = {
    ...httpAuthority(workspace, 'static-secret-query', '/valid?api_key=must-not-send'),
    ...httpAuthority(workspace, 'dynamic-secret-query', '/valid'),
  };
  await withSourceAuthorities(authorities, async () => {
    const staticError = await captureError(() => Providers.queryDataset({
      workspace,
      sourceId: 'static-secret-query',
      datasetRef: 'latest',
      securityMode: 'strict',
    }));
    assertErrorCode(staticError, 'WEATHER_PROVIDER_CREDENTIAL_POLICY_DENIED');
    const dynamicError = await captureError(() => Providers.queryDataset({
      workspace,
      sourceId: 'dynamic-secret-query',
      datasetRef: 'latest',
      query: { api_key: 'must-not-send' },
      securityMode: 'strict',
    }));
    assertErrorCode(dynamicError, 'WEATHER_PROVIDER_CREDENTIAL_POLICY_DENIED');
  });
  assert.equal(origin.requests.length, 0);
});

test('source discovery redacts URL credentials, query strings, and fragments', () => {
  const workspace = createWorkspace([
    httpSource(
      'redacted-source',
      origin,
      '/valid',
      { baseUrl: `${origin.url.replace('://', '://reader:password@')}/root?api_key=secret#fragment` },
    ),
  ]);
  const listed = Providers.listSources(workspace, { securityMode: 'internal' });
  assert.equal(listed.sources[0].baseUrl, `${origin.url}/root`);
  assert.equal(JSON.stringify(listed).includes('password'), false);
  assert.equal(JSON.stringify(listed).includes('secret'), false);
});
