'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'companion.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'companion.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'companion-preload.cjs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'companion-bridge.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'capabilities', 'companion-state.cjs'), 'utf8');

assert.match(html, /Content-Security-Policy/);
assert.match(html, /id="mascot-button"/);
assert.match(html, /id="panel-view"/);
assert.match(html, /src="companion\.js"/);
assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
assert.match(css, /body\[data-state="waiting_approval"\]/);
assert.match(css, /body\.reduce-motion/);
assert.match(js, /drag-start/);
assert.match(js, /toggle-panel/);
assert.match(js, /event\.detail !== 0/);
assert.match(preload, /contextBridge\.exposeInMainWorld\('meteoCompanion'/);
assert.doesNotMatch(bridge, /task\.messages|artifact\?\.path|sessionId:/);
assert.doesNotMatch(state, /value\.path/);

console.log('companion asset checks passed');
