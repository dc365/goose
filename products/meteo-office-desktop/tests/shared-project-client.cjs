const assert = require('node:assert/strict');
const { createSharedProjectService } = require('../capabilities/shared-project-service.cjs');

function testHarness(securityMode = 'internal') {
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: options.method === 'POST' ? 201 : 200,
      text: async () => JSON.stringify({ id: 'project-1', revision: 1 }),
    };
  };
  const profileContext = {
    isAuthenticated: () => true,
    baseUrl: () => 'http://meteomate.internal:8088',
    authHeaders: (extra) => ({ ...extra, Authorization: 'Bearer token' }),
  };
  const service = createSharedProjectService({ ipcMain, profileContext, fetchImpl, securityMode });
  service.registerIpc();
  return { handlers, requests, service };
}

(async () => {
  const internal = testHarness('internal');
  assert.ok(internal.handlers.has('shared-project:publish'));
  await internal.service.publish({
    project: {
      id: 'local-1',
      name: '天气过程',
      workspace: '/Users/local/weather',
      spec: { workspaces: [{ id: 'primary', root: '/Users/local/weather', access: 'read-write-approved' }] },
    },
    visibility: 'organization',
  });
  const internalBody = JSON.parse(internal.requests[0].options.body);
  assert.equal(internalBody.workspaceURI, '/Users/local/weather');
  assert.equal(internalBody.spec.workspaces[0].root, '/Users/local/weather');
  assert.equal(internal.requests[0].url.startsWith('http://'), true);

  await internal.service.setMember({ id: 'project-1', userId: 'usr-2', role: 'editor', baseRevision: 3 });
  const memberBody = JSON.parse(internal.requests.at(-1).options.body);
  assert.deepEqual(memberBody, { role: 'editor', baseRevision: 3 });
  await internal.service.removeMember({ id: 'project-1', userId: 'usr-2', baseRevision: 4 });
  assert.ok(internal.requests.at(-1).url.endsWith('/members/usr-2?baseRevision=4'));
  await assert.rejects(
    () => internal.service.setMember({ id: 'project-1', userId: 'usr-2', role: 'editor', baseRevision: 0 }),
    /baseRevision/,
  );

  const strict = testHarness('strict');
  await strict.service.publish({
    project: {
      id: 'local-2',
      name: '严格模式项目',
      workspace: '/Users/local/private',
      spec: { workspaces: [{ id: 'primary', root: '/Users/local/private', access: 'read-write-approved' }] },
    },
    visibility: 'private',
    workspaceURI: 'smb://weather/projects/process-2',
  });
  const strictBody = JSON.parse(strict.requests[0].options.body);
  assert.equal(strictBody.workspaceURI, 'smb://weather/projects/process-2');
  assert.equal(strictBody.spec.workspaces[0].root, '');
  assert.equal(JSON.stringify(strictBody).includes('/Users/local/private'), false);

  console.log('shared project client intranet-mode tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
