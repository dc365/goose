const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecretStore } = require('../capabilities/secret-store.cjs');
const SecurityMode = require('../capabilities/security-mode.cjs');

assert.throws(() => SecurityMode.normalizeSecurityMode('strcit'), /未知的安全模式/);

const internalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-secret-internal-'));
let safeStorageCalls = 0;
const unavailableSafeStorage = {
  isEncryptionAvailable() { safeStorageCalls += 1; throw new Error('must not be called in internal mode'); },
  getSelectedStorageBackend() { safeStorageCalls += 1; throw new Error('must not be called in internal mode'); },
  encryptString() { safeStorageCalls += 1; throw new Error('must not be called in internal mode'); },
  decryptString() { safeStorageCalls += 1; throw new Error('must not be called in internal mode'); },
};
const internalStore = createSecretStore({
  safeStorage: unavailableSafeStorage,
  securityMode: 'internal',
  profileContext: { currentPaths: () => ({ root: internalRoot }) },
});
assert.equal(internalStore.state().mode, 'internal');
assert.equal(internalStore.state().storageAvailable, true);
assert.equal(internalStore.state().requiresSystemUnlock, false);
assert.equal(internalStore.state().backend, 'local-profile-file');
const internalRecord = internalStore.put('connector:weather-api', { env: { WEATHER_TOKEN: 'internal-secret' }, headers: {} });
assert.equal(internalRecord.scheme, 'secret-ref');
assert.equal(internalStore.get(internalRecord.ref).env.WEATHER_TOKEN, 'internal-secret');
assert.equal(safeStorageCalls, 0, 'internal mode must not invoke OS safeStorage/keychain');
assert.equal(internalStore.remove(internalRecord.ref), true);

const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-secret-strict-'));
const key = crypto.randomBytes(32);
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'test-aes-gcm',
  encryptString(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decryptString(buffer) {
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  },
};
const strictStore = createSecretStore({
  safeStorage,
  securityMode: 'strict',
  profileContext: { currentPaths: () => ({ root: strictRoot }) },
});
assert.equal(strictStore.state().encryptionAvailable, true);
assert.equal(strictStore.state().requiresSystemUnlock, true);
const strictRecord = strictStore.put('connector:strict', { token: 'secret' });
assert.equal(strictStore.get(strictRecord.ref).token, 'secret');
const raw = fs.readFileSync(path.join(strictRoot, 'secrets', 'vault.json'), 'utf8');
assert.equal(raw.includes('"token"'), false);
assert.equal(raw.includes('secret'), false);
const strictVaultPath = path.join(strictRoot, 'secrets', 'vault.json');
fs.writeFileSync(strictVaultPath, '{"version":2,');
assert.throws(() => strictStore.get('connector:strict'), /cannot be read/);
assert.throws(
  () => strictStore.put('connector:new', { token: 'must-not-overwrite-corrupt-vault' }),
  /cannot be read/,
);
assert.equal(fs.readFileSync(strictVaultPath, 'utf8'), '{"version":2,');

const legacyInternalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-secret-legacy-'));
fs.mkdirSync(path.join(legacyInternalRoot, 'secrets'), { recursive: true });
fs.writeFileSync(path.join(legacyInternalRoot, 'secrets', 'vault.json'), JSON.stringify({
  apiVersion: 'meteomate.ai/v1',
  kind: 'DesktopSecretStore',
  version: 2,
  items: {
    'connector:legacy': {
      scheme: 'local-profile-base64',
      backend: 'local-profile-file',
      data: Buffer.from(JSON.stringify({ token: 'legacy-plaintext' }), 'utf8').toString('base64'),
    },
  },
}));
const strictLegacyStore = createSecretStore({
  safeStorage,
  securityMode: 'strict',
  profileContext: { currentPaths: () => ({ root: legacyInternalRoot }) },
});
assert.equal(strictLegacyStore.get('connector:legacy', null), null);

fs.rmSync(internalRoot, { recursive: true, force: true });
fs.rmSync(strictRoot, { recursive: true, force: true });
fs.rmSync(legacyInternalRoot, { recursive: true, force: true });
console.log('secret store intranet-mode tests passed');
