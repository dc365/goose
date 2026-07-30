const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Providers = require('../capabilities/weather/providers.cjs');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-credentials-'));
const registryDirectory = path.join(workspace, '.meteomate');
const registryPath = path.join(registryDirectory, 'weather-sources.json');
const bindingsEnvironment = 'METEOMATE_WEATHER_CREDENTIAL_BINDINGS';
const previousBindings = process.env[bindingsEnvironment];
fs.mkdirSync(registryDirectory, { recursive: true });

function writeSource(source) {
  fs.writeFileSync(registryPath, JSON.stringify({
    apiVersion: 'meteomate.weather/v1',
    kind: 'WeatherSourceRegistry',
    sources: [source],
  }, null, 2));
}

function expectRejected(source, pattern, securityMode = 'internal') {
  writeSource(source);
  assert.throws(
    () => Providers.readSourceConfig(workspace, { securityMode }),
    pattern,
  );
}

const productionSource = {
  id: 'operations-api',
  type: 'http-json',
  baseUrl: 'https://weather.internal',
  classification: 'production',
  official: true,
};

try {
  process.env[bindingsEnvironment] = JSON.stringify({
    'weather:operations-api': {
      origin: 'https://weather.internal',
      authScheme: 'Bearer',
    },
  });
  assert.equal(Providers.credentialReference('operations-api'), 'weather:operations-api');
  assert.equal(
    Providers.credentialEnvironmentName('operations-api.v1'),
    'METEOMATE_WEATHER_TOKEN_OPERATIONS_DASH_API_DOT_V1',
  );
  assert.notEqual(
    Providers.credentialEnvironmentName('Operations-api'),
    Providers.credentialEnvironmentName('operations-api'),
  );
  assert.equal(
    Providers.credentialEnvironmentName('Operations-api'),
    'METEOMATE_WEATHER_TOKEN__UPPER_O_PERATIONS_DASH_API',
  );

  expectRejected(
    { ...productionSource, tokenEnv: 'OPENAI_API_KEY' },
    /tokenEnv 只能使用固定凭据环境变量 METEOMATE_WEATHER_TOKEN_OPERATIONS_DASH_API/,
  );
  expectRejected(
    { ...productionSource, credentialRef: 'weather:other-source' },
    /credentialRef 必须为 weather:operations-api/,
  );
  expectRejected(
    {
      ...productionSource,
      baseUrl: 'https://attacker.example',
      credentialRef: 'weather:operations-api',
    },
    /只能发送到可信 Origin https:\/\/weather\.internal/,
  );
  expectRejected(
    {
      ...productionSource,
      credentialRef: 'weather:operations-api',
      allowedHosts: ['*'],
    },
    /禁止使用通配 allowedHosts/,
  );

  for (const field of ['token', 'apiKey']) {
    expectRejected(
      { ...productionSource, [field]: 'plaintext-production-secret' },
      new RegExp(`不能内联配置 ${field}`),
    );
  }
  for (const header of ['Authorization', 'Cookie', 'X-Api-Key']) {
    expectRejected(
      { ...productionSource, headers: { [header]: 'plaintext-production-secret' } },
      new RegExp(`不能内联配置敏感 Header ${header}`, 'i'),
    );
  }
  expectRejected(
    { ...productionSource, baseUrl: 'https://reader:password@weather.internal' },
    /URL 不能包含用户名或密码/,
  );
  expectRejected(
    {
      ...productionSource,
      classification: 'beta',
      official: true,
      token: 'plaintext-official-secret',
    },
    /不能内联配置 token/,
  );
  expectRejected(
    {
      ...productionSource,
      classification: 'beta',
      official: false,
      token: 'plaintext-strict-secret',
    },
    /不能内联配置 token/,
    'strict',
  );

  writeSource({
    ...productionSource,
    credentialRef: 'weather:operations-api',
  });
  assert.equal(
    Providers.readSourceConfig(workspace, { securityMode: 'internal' }).sources[0].credentialRef,
    'weather:operations-api',
  );

  writeSource({
    ...productionSource,
    tokenEnv: Providers.credentialEnvironmentName('operations-api'),
  });
  assert.equal(
    Providers.readSourceConfig(workspace, { securityMode: 'internal' }).sources[0].tokenEnv,
    'METEOMATE_WEATHER_TOKEN_OPERATIONS_DASH_API',
  );

  writeSource({
    ...productionSource,
    classification: 'beta',
    official: false,
    token: 'legacy-development-token',
  });
  assert.equal(
    Providers.readSourceConfig(workspace, { securityMode: 'internal' }).sources[0].token,
    'legacy-development-token',
  );

  console.log('weather credential boundary tests passed');
} finally {
  if (previousBindings == null) delete process.env[bindingsEnvironment];
  else process.env[bindingsEnvironment] = previousBindings;
  fs.rmSync(workspace, { recursive: true, force: true });
}
