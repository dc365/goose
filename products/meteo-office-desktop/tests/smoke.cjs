const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });

for (const file of [
  'manifests/brand.js',
  'manifests/experts.js',
  'manifests/capabilities.js',
  'manifests/scenes.js',
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}


const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of [
  'styles-base.css',
  'styles-app.css',
  'manifests/brand.js',
  'manifests/experts.js',
  'manifests/capabilities.js',
  'manifests/scenes.js',
  'runtime.js',
  'renderer-core.js',
  'renderer-actions.js',
]) {
  assert.ok(fs.existsSync(path.join(root, asset)), `missing asset: ${asset}`);
  assert.ok(html.includes(asset), `index.html does not reference: ${asset}`);
}

assert.equal(context.window.METEOMATE_BRAND.name, 'MeteoMate');
assert.equal(context.window.METEOMATE_BRAND.chineseName, '气象智伴');
assert.ok(context.window.METEOMATE_EXPERTS.length >= 8);
assert.ok(context.window.METEOMATE_TEAMS.length >= 3);
assert.ok(context.window.METEOMATE_SKILLS.length >= 8);
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'goose-runtime'));
assert.ok(context.window.METEOMATE_SCENES.every((scene) =>
  context.window.METEOMATE_EXPERTS.some((expert) => expert.id === scene.expertId)
));

for (const expert of context.window.METEOMATE_EXPERTS) {
  assert.ok(expert.id);
  assert.ok(expert.name);
  assert.ok(expert.instruction);
  assert.ok(context.window.METEOMATE_PERMISSION_PROFILES[expert.permissionProfile]);
}

console.log('MeteoMate manifest smoke test passed.');
