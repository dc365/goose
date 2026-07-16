'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(root, 'capabilities', 'main-wrapper.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.equal(packageJson.main, 'capabilities/main-wrapper.cjs');
assert.ok(mainSource.includes('const enabledExtensions = request.allowFileTools'));
assert.ok(wrapperSource.includes('extensionsForRequest(request)'));
assert.ok(wrapperSource.includes('could not locate the extension assembly point'));
assert.ok(preloadSource.includes('listCapabilities'));
assert.ok(preloadSource.includes('inspectSkill'));
assert.ok(preloadSource.includes('saveConnector'));
assert.ok(indexSource.includes('styles-capability-center.css'));
const modules = ['core.js', 'render.js', 'skills.js', 'connectors.js', 'integration.js'];
for (const moduleName of modules) {
  const relative = `capability-center/${moduleName}`;
  assert.ok(indexSource.includes(relative), `index does not load ${relative}`);
  assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
}
assert.ok(indexSource.indexOf('capability-center/core.js') > indexSource.indexOf('renderer-actions.js'));
assert.ok(indexSource.indexOf('capability-center/integration.js') > indexSource.indexOf('capability-center/connectors.js'));

for (const skillId of ['synoptic-analysis', 'heavy-rain-score', 'forecast-writing', 'skill-creator']) {
  const skillFile = path.join(root, 'bundled-skills', skillId, 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), `missing bundled skill: ${skillId}`);
  const source = fs.readFileSync(skillFile, 'utf8');
  assert.ok(source.startsWith('---\n'));
  assert.ok(source.includes(`name: ${skillId}`));
  assert.ok(source.includes('description:'));
}

console.log('MeteoMate capability wrapper checks passed.');
