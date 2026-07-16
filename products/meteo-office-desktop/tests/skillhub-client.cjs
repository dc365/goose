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
assert.ok(indexSource.indexOf('skillhub-core.js') > indexSource.indexOf('skill-creator.js'));
assert.ok(indexSource.indexOf('skillhub-integration.js') > indexSource.indexOf('skillhub-publishing.js'));
assert.ok(wrapperSource.includes('createSkillHubClient'));
assert.ok(wrapperSource.includes('skillHubClient.registerIpc()'));
assert.ok(preloadSource.includes('getSkillHubSettings'));
assert.ok(preloadSource.includes('publishSkillDraftToHub'));

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
  if (request.url === '/v1/me') return send(200, { subject: 'publisher', role: 'publisher', name: 'Publisher' });
  if (request.url.startsWith('/v1/skills?')) return send(200, { items: [{ id: 'weather-review', name: 'Weather Review', latestVersion: '1.0.0' }], total: 1 });
  if (request.url.startsWith('/v1/recommendations?')) return send(200, { items: [{ skill: { id: 'weather-review' }, score: 50, reasons: ['精选推荐'] }] });
  if (request.url === '/v1/trust/keys') return send(200, { keys: [{ algorithm: 'ed25519', keyId: 'test-key', publicKey: rawPublic }] });
  if (request.url === '/v1/skills/weather-review') return send(200, { skill: { id: 'weather-review', latestVersion: '1.0.0' }, versions: [{ version: '1.0.0', status: 'published' }] });
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
  return send(404, { error: { message: 'not found' } });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const address = server.address();
    const ipcHandlers = new Map();
    const capabilityService = {
      paths: () => ({ temp }),
      inspectSkill: (filePath) => {
        assert.deepEqual(fs.readFileSync(filePath), packageBytes);
        return { token: 'inspection-token', report: { skill: { id: 'weather-review', version: '1.0.0' } } };
      },
    };
    const client = createSkillHubClient({
      app: { getPath: () => temp },
      ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
      },
      capabilityService,
      skillCreatorService: null,
    });

    client.saveSettings({ baseUrl: `http://127.0.0.1:${address.port}`, token: 'publisher-token', requireSignature: true });
    assert.equal(client.publicSettings().tokenConfigured, true);
    assert.equal((await client.testConnection()).identity.role, 'publisher');
    assert.equal((await client.listSkills({ q: 'weather' })).total, 1);
    assert.equal((await client.recommendations({ connectorIds: ['weather-data'] })).items.length, 1);
    assert.equal((await client.skillDetail('weather-review')).skill.id, 'weather-review');
    const inspection = await client.downloadAndInspect({ skillId: 'weather-review', version: '1.0.0' });
    assert.equal(inspection.remote.signatureVerified, true);
    assert.equal(inspection.remote.digest, digest);
    assert.equal((await client.reportInstallation({ skillId: 'weather-review', version: '1.0.0' })).id, 'inst-1');

    client.registerIpc();
    for (const name of ['skillhub:get-settings', 'skillhub:test', 'skillhub:list-skills', 'skillhub:download-inspect', 'skillhub:publish-draft']) {
      assert.ok(ipcHandlers.has(name), `missing IPC handler ${name}`);
    }
    console.log('MeteoMate SkillHub client checks passed.');
  } finally {
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
