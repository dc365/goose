const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SafeWorkspace = require('../capabilities/safe-workspace.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-workspace-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-outside-'));
fs.mkdirSync(path.join(root, 'data'));
fs.writeFileSync(path.join(root, 'data', 'input.json'), '{}');
fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside');

assert.equal(SafeWorkspace.resolveInside(root, 'data/input.json', { securityMode: 'internal' }).exists, true);
assert.equal(SafeWorkspace.resolveInside(root, 'artifacts/output.json', { allowMissing: true, securityMode: 'internal' }).exists, false);
const relaxedOutside = SafeWorkspace.resolveInside(root, path.join(outside, 'outside.txt'), { securityMode: 'internal' });
assert.equal(relaxedOutside.exists, true);
assert.equal(relaxedOutside.outsideWorkspace, true);
assert.equal(SafeWorkspace.pathInsideWorkspace(root, path.join(outside, 'outside.txt'), { securityMode: 'internal' }), true);

assert.equal(SafeWorkspace.pathInsideWorkspace(root, path.join(outside, 'outside.txt'), { securityMode: 'strict' }), false);
if (process.platform !== 'win32') {
  fs.symlinkSync(outside, path.join(root, 'escape'));
  assert.equal(SafeWorkspace.resolveInside(root, 'escape/outside.txt', { securityMode: 'internal' }).exists, true);
  assert.throws(
    () => SafeWorkspace.resolveInside(root, 'escape/outside.txt', { allowMissing: true, securityMode: 'strict' }),
    /符号链接|逃逸/,
  );
}

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('workspace internal/strict mode tests passed');
