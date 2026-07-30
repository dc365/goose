'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(root, 'capabilities', 'main-wrapper.cjs'), 'utf8');
const knowledgeSource = fs.readFileSync(path.join(root, 'capabilities', 'knowledge-service.cjs'), 'utf8');
const skillHubSource = fs.readFileSync(path.join(root, 'capabilities', 'skillhub-client.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtimeServices = require('../capabilities/runtime-services.cjs');

assert.equal(packageJson.main, 'capabilities/main-wrapper.cjs');
const macPackageScript = packageJson.scripts['package:mac'];
for (const excludedPath of [
  "^/services/skillhub($|/)",
  "^/tests($|/)",
  "^/docs($|/)",
  "^/README\\.md$",
  "^/assets/icons/MeteoMate\\.icns$",
]) {
  assert.ok(macPackageScript.includes(excludedPath), `${excludedPath} must not enter the desktop bundle`);
}
assert.ok(!macPackageScript.includes("^/services($|/)"), 'Office MCP service must enter the desktop bundle');
assert.ok(fs.existsSync(path.join(root, 'services', 'office-mcp', 'src', 'server.mjs')));
assert.ok(macPackageScript.includes('cmp assets/icons/MeteoMate.icns'), 'packaging must verify the installed app icon bytes');
assert.ok(wrapperSource.includes('safeStorage: electron.safeStorage'), 'strict mode must receive the OS secure-storage backend');
assert.ok(!knowledgeSource.includes('safeStorage'), 'knowledge sources must not access macOS Keychain');
assert.ok(wrapperSource.includes('createProfileContext'));
assert.ok(wrapperSource.includes('profileContext.registerIpc()'));
assert.ok(wrapperSource.includes('registerRuntimeServices'));
assert.ok(wrapperSource.includes("require('../main.cjs')"));
assert.ok(!wrapperSource.includes('._compile('));
assert.ok(!wrapperSource.includes('readFileSync'));
assert.ok(!wrapperSource.includes('could not locate the extension assembly point'));
assert.ok(!wrapperSource.includes('global.__METEOMATE'));
assert.ok(mainSource.includes('runtimeServices().capabilityService?.extensionsForRequest(request)'));
assert.ok(mainSource.includes('async verifySessionCapabilities('));
assert.ok(mainSource.includes('sessionCapabilityMap'));
assert.ok(mainSource.includes('sessionExtensionsAdd_unstable({ sessionId, config })'));
assert.ok(!mainSource.includes('global.__METEOMATE'));
assert.ok(mainSource.includes('filterModelSettings(settings)'));
assert.ok(mainSource.includes('saveModelPreference(request)'));
assert.ok(mainSource.includes('enforceRuntimePolicy(request)'));
assert.ok(mainSource.includes('!resolved.outsideWorkspace && resolved.relative !=='));
assert.ok(preloadSource.includes('listCapabilities'));
assert.ok(preloadSource.includes('inspectSkill'));
assert.ok(preloadSource.includes('saveConnector'));
assert.ok(preloadSource.includes('loginAccount'));
assert.ok(skillHubSource.includes('applyManagedPolicy'));
assert.ok(indexSource.includes('styles-capability-center.css'));
const modules = ['core.js', 'render.js', 'skills.js', 'connectors.js', 'integration.js'];
for (const moduleName of modules) {
  const relative = `capability-center/${moduleName}`;
  assert.ok(indexSource.includes(relative), `index does not load ${relative}`);
  assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
}
assert.ok(indexSource.indexOf('capability-center/core.js') > indexSource.indexOf('renderer-actions.js'));
assert.ok(indexSource.indexOf('capability-center/integration.js') > indexSource.indexOf('capability-center/connectors.js'));

const registered = runtimeServices.registerRuntimeServices({
  profileContext: { id: 'profile-context' },
  capabilityService: { id: 'capability-service' },
});
assert.equal(runtimeServices.runtimeServices(), registered);
assert.equal(registered.profileContext.id, 'profile-context');
assert.equal(registered.capabilityService.id, 'capability-service');

for (const skillId of ['synoptic-analysis', 'nmc-upper-air-chart-analysis', 'heavy-rain-score', 'forecast-writing', 'documents', 'pdf', 'skill-creator', 'operations-incident-response']) {
  const skillFile = path.join(root, 'bundled-skills', skillId, 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), `missing bundled skill: ${skillId}`);
  const source = fs.readFileSync(skillFile, 'utf8');
  assert.ok(source.startsWith('---\n'));
  assert.ok(source.includes(`name: ${skillId}`));
  assert.ok(source.includes('description:'));
}

console.log('MeteoMate capability wrapper checks passed.');
