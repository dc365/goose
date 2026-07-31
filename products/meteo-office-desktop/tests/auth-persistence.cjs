'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createAuthCredentialStore } = require('../capabilities/auth-credential-store.cjs');
const { createProfileContext } = require('../capabilities/profile-context.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-auth-persistence-'));
const userData = path.join(temp, 'user-data');
const documents = path.join(temp, 'documents');
const key = crypto.randomBytes(32);
let safeStorageCalls = 0;
const safeStorage = {
  isEncryptionAvailable() { safeStorageCalls += 1; return true; },
  encryptString(value) {
    safeStorageCalls += 1;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decryptString(buffer) {
    safeStorageCalls += 1;
    const iv = buffer.subarray(0, 12);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  },
};
const app = {
  getPath: (name) => name === 'documents' ? documents : userData,
  whenReady: () => Promise.resolve(),
};
const credentialStore = createAuthCredentialStore({
  app,
  safeStorage,
  platform: 'darwin',
  securityMode: 'internal',
});
assert.equal(credentialStore.state().available, true);
assert.equal(credentialStore.state().requiresSystemUnlock, false);
assert.equal(safeStorageCalls, 0);

let refreshNumber = 1;
let activeRefreshToken = 'refresh-1-secret';
let activeAccessToken = 'access-1-secret';
let forceUnauthorizedOnce = false;
let logoutRefreshToken = '';

async function readJSON(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const server = http.createServer(async (request, response) => {
  const send = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  if (request.url === '/v1/auth/login' && request.method === 'POST') {
    const input = await readJSON(request);
    assert.equal(input.remember, true);
    return send(200, {
      sessionToken: activeAccessToken,
      expiresAt: '2027-01-01T00:00:00Z',
      refreshToken: activeRefreshToken,
      refreshExpiresAt: '2027-02-01T00:00:00Z',
      user: { id: 'usr-forecaster', username: 'forecaster', displayName: '值班预报员', role: 'publisher', status: 'active' },
    });
  }
  if (request.url === '/v1/auth/refresh' && request.method === 'POST') {
    const input = await readJSON(request);
    if (input.refreshToken !== activeRefreshToken) return send(401, { error: { message: 'refresh invalid' } });
    refreshNumber += 1;
    activeRefreshToken = `refresh-${refreshNumber}-secret`;
    activeAccessToken = `access-${refreshNumber}-secret`;
    return send(200, {
      sessionToken: activeAccessToken,
      expiresAt: '2027-01-01T00:00:00Z',
      refreshToken: activeRefreshToken,
      refreshExpiresAt: '2027-02-01T00:00:00Z',
      user: { id: 'usr-forecaster', username: 'forecaster', displayName: '值班预报员', role: 'publisher', status: 'active' },
    });
  }
  if (request.url === '/v1/me/policy') {
    assert.equal(request.headers.authorization, `Bearer ${activeAccessToken}`);
    return send(200, { userId: 'usr-forecaster', role: 'publisher', policy: { revision: refreshNumber } });
  }
  if (request.url === '/v1/protected') {
    assert.equal(request.headers.authorization, `Bearer ${activeAccessToken}`);
    if (forceUnauthorizedOnce) {
      forceUnauthorizedOnce = false;
      return send(401, { error: { message: 'access expired' } });
    }
    return send(200, { ok: true });
  }
  if (request.url === '/v1/auth/logout' && request.method === 'POST') {
    const input = await readJSON(request);
    logoutRefreshToken = input.refreshToken;
    return send(200, { loggedOut: true });
  }
  return send(404, { error: { message: 'not found' } });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const firstContext = createProfileContext({ app, ipcMain: { handle() {} }, credentialStore });
    const login = await firstContext.login({ baseUrl, username: 'forecaster', password: 'weather-2026' });
    assert.equal(login.status, 'authenticated');
    assert.equal(credentialStore.load().refreshToken, 'refresh-1-secret');
    const credentialFile = fs.readFileSync(credentialStore.path(), 'utf8');
    assert.equal(credentialFile.includes('refresh-1-secret'), true);
    assert.equal(fs.statSync(credentialStore.path()).mode & 0o777, 0o600);
    assert.equal(safeStorageCalls, 0, 'internal mode must never access Keychain/safeStorage');

    const restartedContext = createProfileContext({ app, ipcMain: { handle() {} }, credentialStore });
    const restored = await restartedContext.beginRestore();
    assert.equal(restored.status, 'authenticated');
    assert.equal(restored.user.id, 'usr-forecaster');
    assert.equal(credentialStore.load().refreshToken, 'refresh-2-secret');

    forceUnauthorizedOnce = true;
    const protectedResponse = await restartedContext.fetchAuthenticated(`${baseUrl}/v1/protected`);
    assert.equal(protectedResponse.status, 200);
    assert.equal(refreshNumber, 3);
    assert.equal(credentialStore.load().refreshToken, 'refresh-3-secret');

    await restartedContext.logout();
    assert.equal(logoutRefreshToken, 'refresh-3-secret');
    assert.equal(credentialStore.hasCredential(), false);

    const loggedOutContext = createProfileContext({ app, ipcMain: { handle() {} }, credentialStore });
    assert.equal((await loggedOutContext.beginRestore()).status, 'signed_out');

    await loggedOutContext.login({ baseUrl, username: 'forecaster', password: 'weather-2026' });
    const rendererStates = [];
    const revokedContext = createProfileContext({
      app,
      ipcMain: { handle() {} },
      credentialStore,
      notifyRenderer: (state) => rendererStates.push(state),
    });
    await revokedContext.beginRestore();
    activeRefreshToken = 'server-revoked-refresh';
    forceUnauthorizedOnce = true;
    await assert.rejects(() => revokedContext.fetchAuthenticated(`${baseUrl}/v1/protected`), /refresh invalid/);
    assert.equal(revokedContext.publicState().status, 'signed_out');
    assert.equal(rendererStates.at(-1).status, 'signed_out');
    assert.equal(credentialStore.hasCredential(), false);
    assert.equal(safeStorageCalls, 0, 'login, refresh, logout, and revocation must stay keychain-free in internal mode');

    const strictUserData = path.join(temp, 'strict-user-data');
    const strictStore = createAuthCredentialStore({
      app: { getPath: () => strictUserData },
      safeStorage,
      platform: 'darwin',
      securityMode: 'strict',
    });
    strictStore.save({ baseUrl, refreshToken: 'strict-refresh-secret' });
    assert.equal(strictStore.load().refreshToken, 'strict-refresh-secret');
    const strictFile = fs.readFileSync(strictStore.path(), 'utf8');
    assert.equal(strictFile.includes('strict-refresh-secret'), false);
    assert.ok(safeStorageCalls >= 4, 'strict mode must use safeStorage for availability, encryption, and decryption');

    const legacyUserData = path.join(temp, 'legacy-safe-storage-user-data');
    const legacyApp = { getPath: () => legacyUserData };
    const legacyPath = path.join(legacyUserData, 'auth', 'login-credential.json');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ version: 1, scheme: 'electron-safe-storage', data: 'unused' }));
    let legacySafeStorageCalls = 0;
    const legacyStore = createAuthCredentialStore({
      app: legacyApp,
      safeStorage: {
        isEncryptionAvailable() { legacySafeStorageCalls += 1; return true; },
        decryptString() { legacySafeStorageCalls += 1; throw new Error('must not access Keychain'); },
      },
      platform: 'darwin',
      securityMode: 'internal',
    });
    assert.equal(legacyStore.load(), null);
    assert.equal(legacySafeStorageCalls, 0);
    assert.equal(fs.existsSync(legacyPath), false);

    const linuxStore = createAuthCredentialStore({
      app,
      safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' },
      platform: 'linux',
      securityMode: 'strict',
    });
    assert.equal(linuxStore.state().available, false);
    assert.throws(() => linuxStore.save({ baseUrl, refreshToken: 'unsafe' }), /安全存储不可用/);
    console.log('MeteoMate persistent authentication checks passed.');
  } finally {
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
