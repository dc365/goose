'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GooseRuntimeEnvironment = require('../capabilities/goose-runtime-environment.cjs');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'meteomate-goose-environment-test-'),
);

try {
  const legacyConfigRoot = path.join(temporaryDirectory, 'legacy-goose');
  const legacyProviderRoot = path.join(legacyConfigRoot, 'custom_providers');
  fs.mkdirSync(legacyProviderRoot, { recursive: true });
  fs.writeFileSync(
    path.join(legacyConfigRoot, 'config.yaml'),
    'active_provider: legacy-provider\n',
  );
  fs.writeFileSync(
    path.join(legacyConfigRoot, 'secrets.yaml'),
    'LEGACY_API_KEY: must-not-be-copied\n',
  );
  fs.mkdirSync(path.join(legacyConfigRoot, 'chatgpt_codex'), { recursive: true });
  fs.writeFileSync(
    path.join(legacyConfigRoot, 'chatgpt_codex', 'tokens.json'),
    '{"access_token":"must-not-be-copied"}\n',
  );
  fs.writeFileSync(
    path.join(legacyProviderRoot, 'custom_weather.json'),
    JSON.stringify({
      name: 'custom_weather',
      display_name: '气象模型',
      engine: 'openai_compatible',
      base_url: 'https://models.example.test',
      base_path: 'v1/chat/completions',
      api_key_env: 'CUSTOM_WEATHER_API_KEY',
      api_key: 'must-not-be-copied',
      headers: { Authorization: 'must-not-be-copied' },
      env_vars: [{ name: 'CUSTOM_WEATHER_API_KEY', value: 'must-not-be-copied' }],
      requires_auth: true,
      models: [{ name: 'weather-model', context_limit: 128000 }],
    }),
  );
  fs.writeFileSync(
    path.join(legacyProviderRoot, 'unsupported.json'),
    JSON.stringify({ name: 'unsupported', engine: 'shell', models: [] }),
  );
  fs.writeFileSync(path.join(legacyProviderRoot, 'invalid.json'), '{invalid');

  const profileRoot = path.join(temporaryDirectory, 'profiles', 'user-a');
  const environment = GooseRuntimeEnvironment.createEnvironment({
    env: {
      PATH: '/usr/bin:/bin',
      GOOSE_PATH_ROOT: '/shared/goose',
      METEOMATE_LEGACY_GOOSE_CONFIG_DIR: legacyConfigRoot,
    },
    profileContext: {
      currentPaths: () => ({ root: profileRoot }),
    },
    userDataDir: path.join(temporaryDirectory, 'user-data'),
    overrides: {
      GOOSE_MODE: 'approve',
      GOOSE_DISABLE_KEYRING: '',
    },
  });

  assert.equal(environment.PATH, '/usr/bin:/bin');
  assert.equal(environment.GOOSE_MODE, 'approve');
  assert.equal(environment.GOOSE_PATH_ROOT, path.join(profileRoot, 'goose'));
  assert.equal(environment.GOOSE_DISABLE_KEYRING, '1');
  assert.equal(fs.statSync(environment.GOOSE_PATH_ROOT).mode & 0o777, 0o700);

  const migratedProviderPath = path.join(
    environment.GOOSE_PATH_ROOT,
    'config',
    'custom_providers',
    'custom_weather.json',
  );
  const migratedProvider = JSON.parse(fs.readFileSync(migratedProviderPath, 'utf8'));
  assert.equal(migratedProvider.name, 'custom_weather');
  assert.equal(migratedProvider.api_key_env, 'CUSTOM_WEATHER_API_KEY');
  assert.deepEqual(migratedProvider.models, [
    { name: 'weather-model', context_limit: 128000 },
  ]);
  assert.deepEqual(migratedProvider.headers, {});
  assert.deepEqual(migratedProvider.env_vars, []);
  assert.equal(Object.prototype.hasOwnProperty.call(migratedProvider, 'api_key'), false);
  assert.equal(
    fs.existsSync(path.join(environment.GOOSE_PATH_ROOT, 'config', 'config.yaml')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(environment.GOOSE_PATH_ROOT, 'config', 'secrets.yaml')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(environment.GOOSE_PATH_ROOT, 'config', 'chatgpt_codex')),
    false,
  );

  const migrationMarker = JSON.parse(fs.readFileSync(
    path.join(
      environment.GOOSE_PATH_ROOT,
      'config',
      `.meteomate-provider-migration-v${GooseRuntimeEnvironment.LEGACY_PROVIDER_MIGRATION_VERSION}.json`,
    ),
    'utf8',
  ));
  assert.deepEqual(migrationMarker.copiedProviders, ['custom_weather.json']);
  assert.deepEqual(migrationMarker.skippedFiles, ['invalid.json', 'unsupported.json']);
  assert.equal(migrationMarker.secretsMigrated, false);

  migratedProvider.display_name = '用户后来修改的名称';
  fs.writeFileSync(migratedProviderPath, `${JSON.stringify(migratedProvider)}\n`);
  fs.writeFileSync(
    path.join(legacyProviderRoot, 'custom_weather.json'),
    JSON.stringify({
      name: 'custom_weather',
      display_name: '旧目录的新名称',
      engine: 'openai_compatible',
      models: [],
    }),
  );
  GooseRuntimeEnvironment.createEnvironment({
    env: { METEOMATE_LEGACY_GOOSE_CONFIG_DIR: legacyConfigRoot },
    profileContext: {
      currentPaths: () => ({ root: profileRoot }),
    },
    userDataDir: path.join(temporaryDirectory, 'user-data'),
  });
  assert.equal(
    JSON.parse(fs.readFileSync(migratedProviderPath, 'utf8')).display_name,
    '用户后来修改的名称',
  );

  const signedOutEnvironment = GooseRuntimeEnvironment.createEnvironment({
    env: {},
    profileContext: {
      currentPaths: () => {
        throw new Error('signed out');
      },
    },
    userDataDir: path.join(temporaryDirectory, 'user-data'),
  });
  assert.equal(
    signedOutEnvironment.GOOSE_PATH_ROOT,
    path.join(temporaryDirectory, 'user-data', 'runtime', 'goose'),
  );
  assert.equal(signedOutEnvironment.GOOSE_DISABLE_KEYRING, '1');

  const configuredRoot = path.join(temporaryDirectory, 'configured-goose');
  assert.equal(
    GooseRuntimeEnvironment.resolveRuntimeRoot({
      env: { METEOMATE_GOOSE_PATH_ROOT: configuredRoot },
      profileContext: null,
      userDataDir: path.join(temporaryDirectory, 'ignored'),
    }),
    configuredRoot,
  );

  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
  assert.equal(
    (mainSource.match(/env: gooseRuntimeEnvironment\(\{/g) || []).length,
    2,
  );
  assert.doesNotMatch(
    mainSource,
    /env:\s*\{\s*\.\.\.process\.env[\s\S]{0,500}GOOSE_/,
  );

  const rendererSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'renderer-core.js'),
    'utf8',
  );
  assert.match(rendererSource, /'尚未配置模型'/);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('MeteoMate isolated Goose runtime environment tests passed.');
