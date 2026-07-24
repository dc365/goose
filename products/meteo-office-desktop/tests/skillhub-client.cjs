'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-skillhub-client-'));
const zipWriterPath = path.resolve(__dirname, '..', 'capabilities', 'zip-writer.cjs');
if (!fs.existsSync(zipWriterPath)) {
  const stub = new Module(zipWriterPath, module);
  stub.exports = { createZipBuffer: () => Buffer.from('draft-package') };
  require.cache[zipWriterPath] = stub;
}
const { createSkillHubClient, normalizeBaseURL } = require('../capabilities/skillhub-client.cjs');

const productRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(productRoot, 'index.html'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(productRoot, 'capabilities', 'main-wrapper.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(productRoot, 'preload.cjs'), 'utf8');
for (const moduleName of [
  'skillhub-core.js',
  'skillhub-render.js',
  'skillhub-detail.js',
  'skillhub-publishing.js',
  'skillhub-integration.js',
]) {
  const relative = `capability-center/${moduleName}`;
  assert.ok(fs.existsSync(path.join(productRoot, relative)), `missing ${relative}`);
  assert.ok(indexSource.includes(relative), `index does not load ${relative}`);
}
assert.ok(indexSource.includes('styles-skillhub.css'));
assert.ok(indexSource.includes('styles-skillhub-management.css'));
assert.ok(indexSource.indexOf('skillhub-core.js') > indexSource.indexOf('skill-creator.js'));
assert.ok(indexSource.indexOf('skillhub-integration.js') > indexSource.indexOf('skillhub-publishing.js'));
assert.ok(wrapperSource.includes('createSkillHubClient'));
assert.ok(wrapperSource.includes('skillHubClient.registerIpc()'));
assert.ok(preloadSource.includes('getSkillHubSettings'));
assert.ok(preloadSource.includes('publishSkillDraftToHub'));
assert.ok(preloadSource.includes('listManagedSkillHubSkills'));
assert.ok(preloadSource.includes('syncSkillHubExperts'));
assert.ok(preloadSource.includes('updateSkillHubSkill'));

assert.equal(normalizeBaseURL('http://127.0.0.1:8088/'), 'http://127.0.0.1:8088');
assert.throws(() => normalizeBaseURL('ftp://example.com'), /HTTP/);
assert.throws(() => normalizeBaseURL('https://user:pass@example.com'), /用户名或密码/);

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const packageBytes = Buffer.from('signed-skill-package');
const digest = crypto.createHash('sha256').update(packageBytes).digest('hex');
const message = `weather-review\n1.0.0\n${digest}`;
const signature = crypto.sign(null, Buffer.from(message), privateKey).toString('base64');

const server = http.createServer((request, response) => {
  const send = (status, payload, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(payload));
  };
  if (request.url === '/healthz') return send(200, { status: 'ok' });
  if (request.url === '/v1/me') return send(200, { authenticated: true, user: { id: 'usr-publisher', username: 'publisher', displayName: 'Publisher', role: 'publisher' } });
  if (request.url.startsWith('/v1/skills?')) {
    const query = new URL(request.url, 'http://127.0.0.1').searchParams;
    return send(200, { items: [{ id: 'weather-review', name: 'Weather Review', latestVersion: query.get('includeDrafts') === 'true' ? '' : '1.0.0' }], total: 1 });
  }
  if (request.url === '/v1/admin/users' && request.method === 'GET') {
    return send(200, {
      items: [
        { id: 'usr-publisher', role: 'publisher', status: 'active' },
        { id: 'usr-admin', role: 'admin', status: 'active' },
        { id: 'usr-viewer', role: 'viewer', status: 'active' },
        { id: 'usr-disabled', role: 'publisher', status: 'disabled' },
      ],
      total: 4,
    });
  }
  if (request.url === '/v1/skills/weather-review' && request.method === 'PATCH') {
    return send(200, { id: 'weather-review', name: 'Updated Weather Review', visibility: 'organization' });
  }
  if (request.url.startsWith('/v1/recommendations?')) return send(200, { items: [{ skill: { id: 'weather-review' }, score: 50, reasons: ['精选推荐'] }] });
  if (request.url === '/v1/trust/keys') return send(200, { keys: [{ algorithm: 'ed25519', keyId: 'test-key', publicKey: rawPublic }] });
  if (request.url === '/v1/skills/weather-review') return send(200, { skill: { id: 'weather-review', latestVersion: '1.0.0' }, versions: [{ version: '1.0.0', status: 'published' }] });
  if (request.url === '/v1/skills/weather-review/versions/1.0.0/publish' && request.method === 'POST') {
    return send(200, { skillId: 'weather-review', version: '1.0.0', status: 'published' });
  }
  if (request.url === '/v1/skills/weather-review/versions/1.0.0/deprecate' && request.method === 'POST') {
    return send(200, { deprecated: true });
  }
  if (request.url === '/v1/skills/weather-review/versions/1.0.0/download') {
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': packageBytes.length,
      'x-meteomate-digest': digest,
      'x-meteomate-signature': signature,
      'x-meteomate-key-id': 'test-key',
    });
    return response.end(packageBytes);
  }
  if (request.url === '/v1/installations' && request.method === 'POST') return send(201, { id: 'inst-1' });
  if (request.url === '/v1/installations/inst-1' && request.method === 'DELETE') return send(200, { deleted: true });
  return send(404, { error: { message: 'not found' } });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const address = server.address();
    const ipcHandlers = new Map();
    let activeProfileKey = 'profile-a';
    const installedSkills = [];
    const remoteStates = [];
    let registrySkills = [{
      id: 'user:user:weather-review',
      scope: 'user',
      skillId: 'weather-review',
      version: '0.9.0',
      enabled: true,
      remote: { skillHubInstallationId: 'inst-1' },
    }];
    const capabilityService = {
      paths: () => ({ temp }),
      inspectSkill: (filePath) => {
        assert.deepEqual(fs.readFileSync(filePath), packageBytes);
        return {
          token: 'inspection-token',
          report: {
            autoInstallEligible: true,
            reportHash: 'report-hash',
            skill: { id: 'weather-review', version: '1.0.0' },
          },
        };
      },
      syncManagedSkills: () => {},
      registrySnapshot: () => ({ skills: registrySkills }),
      installBundledDefault: () => null,
      installSkill: (request) => {
        installedSkills.push({ profileKey: activeProfileKey, request });
        return { installation: { id: 'user:user:weather-review', version: '1.0.0' } };
      },
      updateSkillHubState: (id, remote) => remoteStates.push({ id, remote }),
    };
    const profileRoot = path.join(temp, 'profiles', 'publisher');
    const profileContext = {
      currentPaths: () => ({ capabilities: path.join(profileRoot, 'capabilities') }),
      baseUrl: () => `http://127.0.0.1:${address.port}`,
      authHeaders: (headers = {}) => ({ ...headers, Authorization: 'Bearer session-token' }),
      isAuthenticated: () => true,
      hasActiveProfile: () => Boolean(activeProfileKey),
      publicState: () => ({ profileKey: activeProfileKey }),
      onChange: () => () => {},
    };
    const client = createSkillHubClient({
      app: { getPath: () => temp },
      ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
      capabilityService,
      skillCreatorService: null,
      profileContext,
    });

    client.saveSettings({ requireSignature: true });
    assert.equal(client.publicSettings().tokenConfigured, true);
    assert.equal(client.publicSettings().tokenStorage, 'memory');
    assert.equal((await client.testConnection()).identity.role, 'publisher');
    assert.equal((await client.listSkills({ q: 'weather' })).total, 1);
    assert.equal((await client.listManagedSkills()).items[0].latestVersion, '');
    assert.equal((await client.listPublishers()).items.length, 2);
    assert.equal((await client.updateSkill({ skillId: 'weather-review', name: 'Updated Weather Review', visibility: 'organization' })).visibility, 'organization');
    assert.equal((await client.publishVersion({ skillId: 'weather-review', version: '1.0.0' })).status, 'published');
    assert.equal((await client.deprecateVersion({ skillId: 'weather-review', version: '1.0.0' })).deprecated, true);
    assert.equal((await client.recommendations({ connectorIds: ['weather-data'] })).items.length, 1);
    assert.equal((await client.skillDetail('weather-review')).skill.id, 'weather-review');
    const inspection = await client.downloadAndInspect({ skillId: 'weather-review', version: '1.0.0' });
    assert.equal(inspection.remote.signatureVerified, true);
    assert.equal(inspection.remote.digest, digest);
    assert.equal((await client.reportInstallation({ localInstallationId: 'user:user:weather-review', skillId: 'weather-review', version: '1.0.0' })).id, 'inst-1');
    assert.equal(remoteStates[0].remote.skillHubInstallationId, 'inst-1');
    assert.equal((await client.reportUninstallation({ remoteInstallationId: 'inst-1' })).deleted, true);

    const firstManaged = await client.applyManagedPolicy({
      profileKey: 'profile-a',
      policyContext: { policy: { revision: 2, defaultSkillIds: ['weather-review'] } },
    });
    assert.equal(firstManaged.installed[0].source, 'skillhub');
    assert.equal(firstManaged.installed[0].upgraded, true);
    assert.equal(installedSkills[0].request.replace, true);
    installedSkills.length = 0;
    registrySkills = [];

    const managedSync = client.applyManagedPolicy({
      profileKey: 'profile-a',
      policyContext: { policy: { revision: 3, defaultSkillIds: ['weather-review'] } },
    });
    activeProfileKey = 'profile-b';
    const managedResult = await managedSync;
    assert.equal(installedSkills.length, 0);
    assert.match(managedResult.errors[0].message, /用户已切换/);

    client.registerIpc();
    for (const name of ['skillhub:get-settings', 'skillhub:test', 'skillhub:list-skills', 'skillhub:list-managed-skills', 'skillhub:list-experts', 'skillhub:sync-experts', 'skillhub:list-publishers', 'skillhub:update-skill', 'skillhub:publish-version', 'skillhub:deprecate-version', 'skillhub:download-inspect', 'skillhub:report-uninstallation', 'skillhub:publish-draft']) {
      assert.ok(ipcHandlers.has(name), `missing IPC handler ${name}`);
    }
    console.log('MeteoMate SkillHub client checks passed.');
  } finally {
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
