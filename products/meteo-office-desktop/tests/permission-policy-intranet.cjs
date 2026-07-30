const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const connectors = {
  './browser-connector.js': { toolRisk: (name) => name === 'browser_click' ? 'interaction' : name === 'blocked' ? 'blocked' : 'observe' },
  './computer-connector.js': { toolRisk: (name) => name === 'click' ? 'interaction' : name === 'type_text' ? 'sensitive' : 'observe' },
  './office-connector.js': { toolRisk: (name) => name.includes('create') ? 'mutation' : 'observe' },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith('permission-policy.cjs') && connectors[request]) return connectors[request];
  return originalLoad.call(this, request, parent, isMain);
};
const Policy = require('../capabilities/permission-policy.cjs');
Module._load = originalLoad;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-policy-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-outside-'));
fs.mkdirSync(path.join(root, 'data'));

let result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'read_file', kind: 'other', rawInput: { path: path.join(outside, 'a.txt') } } },
  { workspace: root, securityMode: 'internal' },
);
assert.equal(result.securityMode, 'internal');
assert.equal(result.outsideWorkspace, false);
assert.equal(Policy.permissionHandling('analysis-readonly', result), 'allow_once');

const connector = {
  id: 'weather-data', connectorType: 'weather-data', transport: 'stdio', riskClassification: 'medium',
  verified: true, explicitToolSelection: true, selectedTools: ['weather_query_dataset', 'weather_render_dataset_map'],
  tools: [
    { name: 'weather_query_dataset', annotations: { readOnlyHint: true, effects: { networkRead: true, allowedHosts: ['weather.internal'] } } },
    { name: 'weather_render_dataset_map', annotations: { effects: { filesystemWrite: 'workspace' } } },
  ],
};
result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'weather-data__weather_query_dataset', kind: 'other', rawInput: { url: 'http://10.0.0.8/data' } } },
  { workspace: root, connectors: [connector], securityMode: 'internal' },
);
assert.equal(result.networkHostBlocked, false);
assert.equal(Policy.permissionHandling('workspace-approval', result), 'allow_always');
assert.equal(Policy.permissionHandling('analysis-readonly', result), 'allow_once');

result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'weather-data__weather_render_dataset_map', kind: 'other', rawInput: { outputPath: path.join(outside, 'map.html') } } },
  { workspace: root, connectors: [connector], securityMode: 'internal' },
);
assert.equal(result.kind, 'edit');
assert.equal(Policy.permissionHandling('artifact-approval', result), 'allow_once');
assert.equal(Policy.permissionHandling('workspace-approval', result), 'allow_always');

const destructiveConnector = {
  id: 'managed', connectorType: 'managed', transport: 'streamable-http', riskClassification: 'medium',
  verified: true, explicitToolSelection: true, selectedTools: ['delete_dataset'],
  tools: [{ name: 'delete_dataset', effects: { destructive: true, networkMutation: true } }],
};
result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'managed__delete_dataset', kind: 'other', rawInput: {} } },
  { workspace: root, connectors: [destructiveConnector], securityMode: 'internal' },
);
assert.equal(Policy.permissionHandling('artifact-approval', result), 'prompt');
assert.equal(Policy.permissionHandling('workspace-approval', result), 'allow_always');

const blockedConnector = {
  id: 'blocked-service', connectorType: 'managed', transport: 'stdio',
  verified: true, explicitToolSelection: true, selectedTools: ['blocked'],
  tools: [{ name: 'blocked', effects: { blocked: true } }],
};
result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'blocked-service__blocked', kind: 'other', rawInput: {} } },
  { workspace: root, connectors: [blockedConnector], securityMode: 'internal' },
);
assert.equal(Policy.permissionHandling('workspace-approval', result), 'deny');

result = Policy.classifyPermissionRequest(
  { toolCall: { title: 'weather-data__weather_query_dataset', kind: 'other', rawInput: { url: 'http://evil.example/data' } } },
  { workspace: root, connectors: [connector], securityMode: 'strict' },
);
assert.equal(result.networkHostBlocked, true);
assert.equal(Policy.permissionHandling('workspace-approval', result), 'prompt');

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('permission policy intranet-mode tests passed');
