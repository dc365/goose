'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SecurityMode = require('./security-mode.cjs');

const STORE_VERSION = 2;
const SECRET_REF_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,255}$/i;

function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
}

function safeRead(target, fallback) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizedRef(value) {
  const ref = String(value || '').trim();
  if (!SECRET_REF_PATTERN.test(ref)) throw new Error('Secret reference is invalid');
  return ref;
}

function emptyStore() {
  return {
    apiVersion: 'meteomate.ai/v1',
    kind: 'DesktopSecretStore',
    version: STORE_VERSION,
    items: {},
    updatedAt: null,
  };
}

function createSecretStore({
  safeStorage,
  profileContext,
  app,
  securityMode = process.env.METEOMATE_SECURITY_MODE,
  allowInsecureFallback = process.env.METEOMATE_ALLOW_INSECURE_SECRET_FALLBACK === '1',
} = {}) {
  if (!profileContext) throw new Error('Secret store requires profileContext');
  const mode = SecurityMode.normalizeSecurityMode(securityMode);

  function storePath() {
    let root;
    try {
      root = profileContext.currentPaths().root;
    } catch {
      root = app?.getPath?.('userData');
    }
    if (!root) throw new Error('Secret store requires an active profile');
    return path.join(root, 'secrets', 'vault.json');
  }

  function strictBackendState() {
    let encryptionAvailable = false;
    let backend = 'unavailable';
    try {
      encryptionAvailable = Boolean(safeStorage?.isEncryptionAvailable?.());
      backend = String(safeStorage?.getSelectedStorageBackend?.() || (encryptionAvailable ? 'os-crypt' : 'unavailable'));
    } catch {
      encryptionAvailable = false;
      backend = 'unavailable';
    }
    const secure = encryptionAvailable && backend !== 'basic_text';
    return {
      mode,
      encryptionAvailable: secure,
      storageAvailable: secure || allowInsecureFallback,
      osEncryptionAvailable: secure,
      backend: secure ? backend : allowInsecureFallback ? 'explicit-insecure-fallback' : backend,
      insecureFallback: !secure && allowInsecureFallback,
      requiresSystemUnlock: secure,
      profileFileStorage: !secure && allowInsecureFallback,
    };
  }

  function backendState() {
    if (mode === SecurityMode.MODES.INTERNAL) {
      return {
        mode,
        encryptionAvailable: false,
        storageAvailable: true,
        osEncryptionAvailable: false,
        backend: 'local-profile-file',
        insecureFallback: true,
        requiresSystemUnlock: false,
        profileFileStorage: true,
      };
    }
    return strictBackendState();
  }

  function load() {
    const parsed = safeRead(storePath(), emptyStore());
    return {
      ...emptyStore(),
      ...parsed,
      items: parsed?.items && typeof parsed.items === 'object' && !Array.isArray(parsed.items)
        ? parsed.items
        : {},
    };
  }

  function save(store) {
    store.version = STORE_VERSION;
    store.updatedAt = new Date().toISOString();
    atomicWrite(storePath(), store);
  }

  function encode(value) {
    const state = backendState();
    const payload = JSON.stringify(value ?? null);
    if (mode === SecurityMode.MODES.INTERNAL) {
      return {
        scheme: 'local-profile-base64',
        backend: state.backend,
        data: Buffer.from(payload, 'utf8').toString('base64'),
      };
    }
    if (state.osEncryptionAvailable) {
      return {
        scheme: 'electron-safe-storage',
        backend: state.backend,
        data: safeStorage.encryptString(payload).toString('base64'),
      };
    }
    if (state.insecureFallback) {
      return {
        scheme: 'explicit-base64-fallback',
        backend: state.backend,
        data: Buffer.from(payload, 'utf8').toString('base64'),
      };
    }
    throw new Error('严格安全模式下系统安全存储不可用。可切换为默认内网模式，或配置系统钥匙串。');
  }

  function decode(record) {
    if (!record?.data) return null;
    try {
      if (record.scheme === 'electron-safe-storage') {
        return JSON.parse(safeStorage.decryptString(Buffer.from(record.data, 'base64')));
      }
      if (['local-profile-base64', 'explicit-base64-fallback'].includes(record.scheme)) {
        if (record.scheme === 'local-profile-base64' && mode === SecurityMode.MODES.STRICT) return null;
        if (record.scheme === 'explicit-base64-fallback' && mode === SecurityMode.MODES.STRICT && !allowInsecureFallback) {
          return null;
        }
        return JSON.parse(Buffer.from(record.data, 'base64').toString('utf8'));
      }
    } catch {
      return null;
    }
    return null;
  }

  function put(ref, value, metadata = {}) {
    const key = normalizedRef(ref);
    if (value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
      return remove(key);
    }
    const store = load();
    store.items[key] = {
      ...encode(value),
      metadata: {
        ...(metadata || {}),
        securityMode: mode,
        updatedAt: new Date().toISOString(),
      },
    };
    save(store);
    return { scheme: 'secret-ref', ref: key };
  }

  function get(ref, fallback = null) {
    const key = normalizedRef(ref);
    const record = load().items[key];
    if (!record) return fallback;
    const value = decode(record);
    return value == null ? fallback : value;
  }

  function has(ref) {
    const key = normalizedRef(ref);
    return Boolean(load().items[key]);
  }

  function remove(ref) {
    const key = normalizedRef(ref);
    const store = load();
    if (!Object.prototype.hasOwnProperty.call(store.items, key)) return false;
    delete store.items[key];
    save(store);
    return true;
  }

  function list(prefix = '') {
    const normalizedPrefix = String(prefix || '').trim();
    return Object.entries(load().items)
      .filter(([ref]) => !normalizedPrefix || ref.startsWith(normalizedPrefix))
      .map(([ref, record]) => ({
        ref,
        scheme: record.scheme,
        backend: record.backend || null,
        metadata: record.metadata || {},
      }))
      .sort((left, right) => left.ref.localeCompare(right.ref));
  }

  function migrateLegacy(ref, legacyRecord, decodeLegacy, metadata = {}) {
    if (!legacyRecord || legacyRecord.scheme === 'secret-ref') return legacyRecord || null;
    const value = typeof decodeLegacy === 'function' ? decodeLegacy(legacyRecord) : null;
    if (value == null) return null;
    return put(ref, value, { ...metadata, migratedFrom: legacyRecord.scheme || 'legacy' });
  }

  return Object.freeze({
    put,
    get,
    has,
    remove,
    list,
    migrateLegacy,
    state: backendState,
    reference(namespace, id) {
      return normalizedRef(`${String(namespace || 'secret').trim()}:${String(id || '').trim()}`);
    },
  });
}

module.exports = { createSecretStore, normalizedRef, emptyStore };
