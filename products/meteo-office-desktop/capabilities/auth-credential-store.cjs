'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SecurityMode = require('./security-mode.cjs');

const STORE_VERSION = 1;

function createAuthCredentialStore({
  app,
  safeStorage = null,
  platform = process.platform,
  securityMode = process.env.METEOMATE_SECURITY_MODE,
} = {}) {
  if (!app?.getPath) throw new Error('Auth credential store requires app');
  const mode = SecurityMode.normalizeSecurityMode(securityMode);

  function storePath() {
    return path.join(app.getPath('userData'), 'auth', 'login-credential.json');
  }

  function state() {
    if (mode === SecurityMode.MODES.INTERNAL) {
      return {
        available: true,
        encryptionAvailable: false,
        backend: 'local-user-file',
        insecureBackend: false,
        requiresSystemUnlock: false,
      };
    }
    let encryptionAvailable = false;
    let backend = platform === 'darwin' ? 'keychain' : platform === 'win32' ? 'dpapi' : 'unknown';
    try {
      encryptionAvailable = safeStorage.isEncryptionAvailable() === true;
      if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        backend = safeStorage.getSelectedStorageBackend() || 'unknown';
      }
    } catch {
      encryptionAvailable = false;
    }
    const insecureBackend = platform === 'linux' && backend === 'basic_text';
    return {
      available: encryptionAvailable && !insecureBackend,
      encryptionAvailable,
      backend,
      insecureBackend,
      requiresSystemUnlock: true,
    };
  }

  function hasCredential() {
    return fs.existsSync(storePath());
  }

  function load() {
    const target = storePath();
    if (!fs.existsSync(target)) return null;
    try {
      const record = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (record?.version !== STORE_VERSION) return null;
      if (mode === SecurityMode.MODES.INTERNAL) {
        if (record.scheme !== 'local-user-file') {
          clear();
          return null;
        }
        return normalizeCredential(record.credential);
      }
      const storage = state();
      if (!storage.available) return null;
      if (record.scheme === 'local-user-file') {
        const credential = normalizeCredential(record.credential);
        if (credential) save(credential);
        return credential;
      }
      if (record.scheme !== 'electron-safe-storage' || !record.data) return null;
      const decrypted = safeStorage.decryptString(Buffer.from(record.data, 'base64'));
      const credential = normalizeCredential(JSON.parse(decrypted));
      return credential;
    } catch {
      return null;
    }
  }

  function normalizeCredential(credential) {
    if (!credential?.baseUrl || !credential?.refreshToken) return null;
    return {
      baseUrl: String(credential.baseUrl),
      refreshToken: String(credential.refreshToken),
      refreshExpiresAt: credential.refreshExpiresAt || null,
    };
  }

  function save(credential = {}) {
    const storage = state();
    if (!storage.available) throw new Error('系统安全存储不可用，无法保持登录状态');
    const baseUrl = String(credential.baseUrl || '').trim();
    const refreshToken = String(credential.refreshToken || '').trim();
    if (!baseUrl || !refreshToken) throw new Error('登录凭据不完整');
    const credentialPayload = {
      baseUrl,
      refreshToken,
      refreshExpiresAt: credential.refreshExpiresAt || null,
    };
    const target = storePath();
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const record = mode === SecurityMode.MODES.INTERNAL ? {
      apiVersion: 'meteomate.ai/v1',
      kind: 'DesktopAuthCredential',
      version: STORE_VERSION,
      scheme: 'local-user-file',
      backend: storage.backend,
      credential: credentialPayload,
      updatedAt: new Date().toISOString(),
    } : {
      apiVersion: 'meteomate.ai/v1',
      kind: 'DesktopAuthCredential',
      version: STORE_VERSION,
      scheme: 'electron-safe-storage',
      backend: storage.backend,
      data: safeStorage.encryptString(JSON.stringify(credentialPayload)).toString('base64'),
      updatedAt: new Date().toISOString(),
    };
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
    return true;
  }

  function clear() {
    try {
      fs.unlinkSync(storePath());
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  return { state, hasCredential, load, save, clear, path: storePath };
}

module.exports = { createAuthCredentialStore };
