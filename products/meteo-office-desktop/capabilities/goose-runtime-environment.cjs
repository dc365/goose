'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const LEGACY_PROVIDER_MIGRATION_VERSION = 1;
const PROVIDER_DEFINITION_KEYS = Object.freeze([
  'api_key_env',
  'base_path',
  'base_url',
  'catalog_provider_id',
  'description',
  'display_name',
  'dynamic_models',
  'engine',
  'fast_model',
  'model_doc_link',
  'models',
  'name',
  'preserves_thinking',
  'requires_auth',
  'setup_steps',
  'skip_canonical_filtering',
  'supports_streaming',
  'timeout_seconds',
]);

function activeProfileRoot(profileContext) {
  try {
    return String(profileContext?.currentPaths?.()?.root || '').trim();
  } catch {
    return '';
  }
}

function resolveRuntimeRoot({
  env = process.env,
  profileContext = null,
  userDataDir,
} = {}) {
  const configured = String(env.METEOMATE_GOOSE_PATH_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  const profileRoot = activeProfileRoot(profileContext);
  if (profileRoot) return path.join(profileRoot, 'goose');
  if (!userDataDir) throw new Error('MeteoMate Goose runtime requires a user data directory');
  return path.join(path.resolve(userDataDir), 'runtime', 'goose');
}

function legacyConfigRoot(env = process.env) {
  const configured = String(env.METEOMATE_LEGACY_GOOSE_CONFIG_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(String(env.HOME || os.homedir()), '.config', 'goose');
}

function sanitizeProviderDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['openai', 'openai_compatible'].includes(String(value.engine || '').toLowerCase())) {
    return null;
  }
  const output = {};
  for (const key of PROVIDER_DEFINITION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) output[key] = value[key];
  }
  output.headers = {};
  output.env_vars = [];
  return output;
}

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readStoredSecret({ runtimeRoot, key } = {}) {
  const secretKey = String(key || '').trim();
  if (!runtimeRoot || !secretKey) return null;
  const target = path.join(path.resolve(runtimeRoot), 'config', 'secrets.yaml');
  try {
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const values = yaml.load(fs.readFileSync(target, 'utf8'));
    const value = values && typeof values === 'object' && !Array.isArray(values)
      ? values[secretKey]
      : null;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

function migrateLegacyProviderDefinitions({
  runtimeRoot,
  env = process.env,
} = {}) {
  const markerPath = path.join(
    runtimeRoot,
    'config',
    `.meteomate-provider-migration-v${LEGACY_PROVIDER_MIGRATION_VERSION}.json`,
  );
  if (fs.existsSync(markerPath)) {
    try {
      return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {
      return { version: LEGACY_PROVIDER_MIGRATION_VERSION, status: 'completed' };
    }
  }

  const sourceRoot = legacyConfigRoot(env);
  const sourceDirectory = path.join(sourceRoot, 'custom_providers');
  const targetDirectory = path.join(runtimeRoot, 'config', 'custom_providers');
  const copiedProviders = [];
  const preservedProviders = [];
  const skippedFiles = [];

  if (fs.existsSync(sourceDirectory)) {
    fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    for (const fileName of fs.readdirSync(sourceDirectory).sort()) {
      if (!/^[a-zA-Z0-9._-]+\.json$/.test(fileName)) continue;
      const sourcePath = path.join(sourceDirectory, fileName);
      const targetPath = path.join(targetDirectory, fileName);
      try {
        if (!fs.lstatSync(sourcePath).isFile()) {
          skippedFiles.push(fileName);
          continue;
        }
        if (fs.existsSync(targetPath)) {
          preservedProviders.push(fileName);
          continue;
        }
        const sanitized = sanitizeProviderDefinition(
          JSON.parse(fs.readFileSync(sourcePath, 'utf8')),
        );
        if (!sanitized) {
          skippedFiles.push(fileName);
          continue;
        }
        atomicWriteJson(targetPath, sanitized);
        copiedProviders.push(fileName);
      } catch {
        skippedFiles.push(fileName);
      }
    }
  }

  const result = {
    apiVersion: 'meteomate.ai/v1',
    kind: 'GooseProviderMigration',
    version: LEGACY_PROVIDER_MIGRATION_VERSION,
    status: 'completed',
    sourceRoot,
    copiedProviders,
    preservedProviders,
    skippedFiles,
    secretsMigrated: false,
    completedAt: new Date().toISOString(),
  };
  atomicWriteJson(markerPath, result);
  return result;
}

function createEnvironment({
  env = process.env,
  profileContext = null,
  userDataDir,
  overrides = {},
} = {}) {
  const runtimeRoot = resolveRuntimeRoot({ env, profileContext, userDataDir });
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(runtimeRoot, 0o700);
  if (activeProfileRoot(profileContext)) {
    migrateLegacyProviderDefinitions({ runtimeRoot, env });
  }
  return {
    ...env,
    ...overrides,
    GOOSE_PATH_ROOT: runtimeRoot,
    GOOSE_DISABLE_KEYRING: '1',
  };
}

module.exports = {
  LEGACY_PROVIDER_MIGRATION_VERSION,
  activeProfileRoot,
  createEnvironment,
  legacyConfigRoot,
  migrateLegacyProviderDefinitions,
  readStoredSecret,
  resolveRuntimeRoot,
  sanitizeProviderDefinition,
};
