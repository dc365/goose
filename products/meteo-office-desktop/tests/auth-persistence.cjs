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

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createMemoryCredentialStore(initial) {
  let credential = initial;
  return {
    state: () => ({ available: true }),
    hasCredential: () => Boolean(credential?.refreshToken),
    load: () => credential ? { ...credential } : null,
    save: (next) => { credential = { ...next }; },
    clear: () => { credential = null; },
  };
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

    const raceBaseUrl = 'http://127.0.0.1:18088';
    const raceStore = createMemoryCredentialStore({ baseUrl: raceBaseUrl, refreshToken: 'race-refresh-old' });
    let releaseRaceRefresh;
    let markRaceRefreshStarted;
    const raceRefreshStarted = new Promise((resolve) => { markRaceRefreshStarted = resolve; });
    const raceRefreshGate = new Promise((resolve) => { releaseRaceRefresh = resolve; });
    const raceFetch = async (url) => {
      if (url.endsWith('/v1/auth/refresh')) {
        markRaceRefreshStarted();
        await raceRefreshGate;
        return jsonResponse(200, {
          sessionToken: 'race-access-new',
          refreshToken: 'race-refresh-new',
          expiresAt: '2027-01-01T00:00:00Z',
          refreshExpiresAt: '2027-02-01T00:00:00Z',
          user: { id: 'usr-race', username: 'race', role: 'viewer', status: 'active' },
        });
      }
      if (url.endsWith('/v1/auth/logout')) return jsonResponse(200, { loggedOut: true });
      if (url.endsWith('/v1/me/policy')) return jsonResponse(200, { userId: 'usr-race', policy: {} });
      return jsonResponse(404, { error: { message: 'not found' } });
    };
    const raceUserData = path.join(temp, 'race-user-data');
    const raceContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : raceUserData, whenReady: () => Promise.resolve() },
      ipcMain: { handle() {} },
      credentialStore: raceStore,
      fetchImpl: raceFetch,
    });
    const pendingRestore = raceContext.beginRestore();
    await raceRefreshStarted;
    await raceContext.logout();
    releaseRaceRefresh();
    const stateAfterLogoutRace = await pendingRestore;
    assert.equal(stateAfterLogoutRace.status, 'signed_out');
    assert.equal(raceStore.hasCredential(), false);

    const retryBaseUrl = 'http://127.0.0.1:18089';
    const retryStore = createMemoryCredentialStore({ baseUrl: retryBaseUrl, refreshToken: 'retry-refresh-1' });
    let retryRefreshNumber = 1;
    let retryPolicyNumber = 0;
    const retryFetch = async (url) => {
      if (url.endsWith('/v1/auth/refresh')) {
        retryRefreshNumber += 1;
        return jsonResponse(200, {
          sessionToken: `retry-access-${retryRefreshNumber}`,
          refreshToken: `retry-refresh-${retryRefreshNumber}`,
          expiresAt: '2027-01-01T00:00:00Z',
          refreshExpiresAt: '2027-02-01T00:00:00Z',
          user: { id: 'usr-retry', username: 'retry', role: 'viewer', status: 'active' },
        });
      }
      if (url.endsWith('/v1/me/policy')) {
        retryPolicyNumber += 1;
        if (retryPolicyNumber === 1) return jsonResponse(503, { error: { message: 'temporary policy failure' } });
        return jsonResponse(200, { userId: 'usr-retry', policy: { revision: 2 } });
      }
      return jsonResponse(404, { error: { message: 'not found' } });
    };
    const retryUserData = path.join(temp, 'retry-user-data');
    const retryContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : retryUserData, whenReady: () => Promise.resolve() },
      ipcMain: { handle() {} },
      credentialStore: retryStore,
      fetchImpl: retryFetch,
    });
    assert.equal((await retryContext.beginRestore()).status, 'signed_out');
    assert.equal(retryStore.load().refreshToken, 'retry-refresh-2');
    assert.equal((await retryContext.beginRestore()).status, 'authenticated');
    assert.equal(retryStore.load().refreshToken, 'retry-refresh-3');

    let strictHTTPFetchCalls = 0;
    const strictHTTPContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : path.join(temp, 'strict-http-user-data') },
      ipcMain: { handle() {} },
      credentialStore: createMemoryCredentialStore(null),
      fetchImpl: async () => { strictHTTPFetchCalls += 1; return jsonResponse(500, {}); },
      securityMode: 'strict',
    });
    await assert.rejects(
      () => strictHTTPContext.login({ baseUrl: 'http://intranet.example', username: 'user', password: 'password' }),
      /严格安全模式要求使用 HTTPS/,
    );
    assert.equal(strictHTTPFetchCalls, 0);

    const firstAccountBaseUrl = 'http://127.0.0.1:18090';
    const secondAccountBaseUrl = 'http://127.0.0.1:18091';
    const accountSwitchStore = createMemoryCredentialStore(null);
    let releaseOldRequest;
    let markOldRequestStarted;
    const oldRequestStarted = new Promise((resolve) => { markOldRequestStarted = resolve; });
    const oldRequestGate = new Promise((resolve) => { releaseOldRequest = resolve; });
    const protectedTokens = [];
    const accountSwitchFetch = async (url, options = {}) => {
      if (url.endsWith('/v1/auth/login')) {
        const secondAccount = url.startsWith(secondAccountBaseUrl);
        return jsonResponse(200, {
          sessionToken: secondAccount ? 'account-2-access' : 'account-1-access',
          refreshToken: secondAccount ? 'account-2-refresh' : 'account-1-refresh',
          expiresAt: '2027-01-01T00:00:00Z',
          refreshExpiresAt: '2027-02-01T00:00:00Z',
          user: {
            id: secondAccount ? 'account-2' : 'account-1',
            username: secondAccount ? 'account-2' : 'account-1',
            role: 'viewer',
            status: 'active',
          },
        });
      }
      if (url.endsWith('/v1/me/policy')) {
        const secondAccount = url.startsWith(secondAccountBaseUrl);
        return jsonResponse(200, { userId: secondAccount ? 'account-2' : 'account-1', policy: {} });
      }
      if (url.endsWith('/v1/auth/logout')) return jsonResponse(200, { loggedOut: true });
      if (url.endsWith('/v1/protected')) {
        protectedTokens.push(new Headers(options.headers).get('Authorization'));
        markOldRequestStarted();
        await oldRequestGate;
        return jsonResponse(401, { error: { message: 'expired' } });
      }
      return jsonResponse(404, { error: { message: 'not found' } });
    };
    const accountSwitchUserData = path.join(temp, 'account-switch-user-data');
    const accountSwitchContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : accountSwitchUserData },
      ipcMain: { handle() {} },
      credentialStore: accountSwitchStore,
      fetchImpl: accountSwitchFetch,
    });
    await accountSwitchContext.login({ baseUrl: firstAccountBaseUrl, username: 'account-1', password: 'password' });
    const oldAccountRequest = accountSwitchContext.fetchAuthenticated(`${firstAccountBaseUrl}/v1/protected`);
    await oldRequestStarted;
    await accountSwitchContext.logout();
    await accountSwitchContext.login({ baseUrl: secondAccountBaseUrl, username: 'account-2', password: 'password' });
    releaseOldRequest();
    await assert.rejects(() => oldAccountRequest, /登录状态已发生变化/);
    assert.deepEqual(protectedTokens, ['Bearer account-1-access']);

    const logoutWindowBaseUrl = 'http://127.0.0.1:18092';
    const logoutWindowStore = createMemoryCredentialStore(null);
    let releaseLogoutRequest;
    let markLogoutRequestStarted;
    let logoutWindowRefreshCalls = 0;
    const logoutRequestStarted = new Promise((resolve) => { markLogoutRequestStarted = resolve; });
    const logoutRequestGate = new Promise((resolve) => { releaseLogoutRequest = resolve; });
    const logoutWindowFetch = async (url) => {
      if (url.endsWith('/v1/auth/login')) {
        return jsonResponse(200, {
          sessionToken: 'logout-window-access',
          refreshToken: 'logout-window-refresh',
          expiresAt: '2027-01-01T00:00:00Z',
          refreshExpiresAt: '2027-02-01T00:00:00Z',
          user: { id: 'logout-window-user', username: 'logout-window-user', role: 'viewer', status: 'active' },
        });
      }
      if (url.endsWith('/v1/me/policy')) return jsonResponse(200, { userId: 'logout-window-user', policy: {} });
      if (url.endsWith('/v1/auth/logout')) {
        markLogoutRequestStarted();
        await logoutRequestGate;
        return jsonResponse(200, { loggedOut: true });
      }
      if (url.endsWith('/v1/auth/refresh')) {
        logoutWindowRefreshCalls += 1;
        return jsonResponse(500, {});
      }
      return jsonResponse(404, { error: { message: 'not found' } });
    };
    const logoutWindowContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : path.join(temp, 'logout-window-user-data') },
      ipcMain: { handle() {} },
      credentialStore: logoutWindowStore,
      fetchImpl: logoutWindowFetch,
    });
    await logoutWindowContext.login({ baseUrl: logoutWindowBaseUrl, username: 'user', password: 'password' });
    const pendingLogout = logoutWindowContext.logout();
    await logoutRequestStarted;
    assert.equal(logoutWindowContext.publicState().status, 'signed_out');
    assert.equal(logoutWindowStore.hasCredential(), false);
    assert.equal((await logoutWindowContext.beginRestore()).status, 'signed_out');
    await assert.rejects(
      () => logoutWindowContext.fetchAuthenticated(`${logoutWindowBaseUrl}/v1/protected`),
      /请先登录/,
    );
    assert.equal(logoutWindowRefreshCalls, 0);
    releaseLogoutRequest();
    await pendingLogout;

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

    const unavailableUserData = path.join(temp, 'strict-unavailable-user-data');
    const unavailableInternalStore = createAuthCredentialStore({
      app: { getPath: () => unavailableUserData },
      securityMode: 'internal',
    });
    unavailableInternalStore.save({ baseUrl, refreshToken: 'plaintext-before-strict' });
    const unavailableStrictStore = createAuthCredentialStore({
      app: { getPath: () => unavailableUserData },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text',
      },
      platform: 'linux',
      securityMode: 'strict',
    });
    assert.equal(unavailableStrictStore.load(), null);
    assert.equal(fs.existsSync(unavailableStrictStore.path()), false);

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
