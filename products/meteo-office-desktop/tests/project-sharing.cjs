const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const Shared = {
  cleanObject: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
  uniqueStrings: (values) => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))],
  asArray: (value) => Array.isArray(value) ? value : value == null ? [] : [value],
  deepClone: (value) => structuredClone(value),
  createId: (prefix) => `${prefix}-test`,
  contentHash: (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith('harness/project.js') && request === './shared') return Shared;
  return originalLoad.call(this, request, parent, isMain);
};
const Project = require('../harness/project.js');
Module._load = originalLoad;

let local = Project.normalizeProject({
  id: 'local-1', name: '华南暴雨', workspace: '/data/local',
  sharing: { remoteId: 'project-1', revision: 2, visibility: 'organization', syncStatus: 'synced' },
});
assert.equal(local.spec.sharing.remoteId, 'project-1');
assert.equal(local.sharing.revision, 2);
local = Project.applyRemoteProject(local, {
  id: 'project-1', revision: 5, ownerId: 'usr-a', orgId: 'org-1', visibility: 'organization',
  workspaceURI: 'smb://weather/projects/rain',
  members: { 'usr-b': { userId: 'usr-b', role: 'editor' } },
  name: '华南暴雨协同项目',
  spec: { instructions: ['统一口径'] },
});
assert.equal(local.name, '华南暴雨协同项目');
assert.equal(local.sharing.revision, 5);
assert.equal(local.sharing.workspaceURI, 'smb://weather/projects/rain');
assert.equal(local.sharing.members['usr-b'].role, 'editor');
assert.equal(local.workspace, '/data/local', 'remote metadata must not overwrite local workspace path');
assert.equal(local.spec.workspaces[0].root, '/data/local', 'remote spec must not erase device-local workspace binding');
assert.deepEqual(local.spec.instructions, ['统一口径']);
console.log('project sharing model tests passed');
