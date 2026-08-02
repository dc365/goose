'use strict';

const assert = require('node:assert/strict');
const WindowLayout = require('../capabilities/window-layout.cjs');

assert.deepEqual(
  WindowLayout.resolveWindowMode('workspace', { width: 1920, height: 1080 }),
  { width: 1360, height: 820, minWidth: 1040, minHeight: 680 },
);
assert.deepEqual(
  WindowLayout.resolveWindowMode('workspace', { width: 1440, height: 900 }),
  { width: 1360, height: 820, minWidth: 1040, minHeight: 680 },
);
assert.deepEqual(
  WindowLayout.resolveWindowMode('workspace', { width: 1280, height: 800 }),
  { width: 1232, height: 752, minWidth: 1040, minHeight: 680 },
);
assert.deepEqual(
  WindowLayout.resolveWindowMode('workspace', { width: 1024, height: 720 }),
  { width: 976, height: 672, minWidth: 976, minHeight: 672 },
);
assert.deepEqual(
  WindowLayout.resolveWindowMode('account', { width: 1440, height: 900 }),
  { width: 460, height: 560, minWidth: 420, minHeight: 520 },
);
assert.throws(() => WindowLayout.resolveWindowMode('unknown'), /Invalid window mode/);

console.log('window layout checks passed');
