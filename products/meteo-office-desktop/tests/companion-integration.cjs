'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('main.cjs');
const preload = read('preload.cjs');
const index = read('index.html');
const profile = read('capabilities/profile-context.cjs');
const computerPip = read('capabilities/computer-pip-controller.cjs');
const companionController = read('capabilities/companion-window-controller.cjs');
const bridge = read('companion-bridge.js');
const renderer = read('renderer-core.js');
const rendererActions = read('renderer-actions.js');

assert.match(main, /\bTray,\n\s+WebContentsView/);
assert.match(main, /require\('\.\/capabilities\/companion-window-controller\.cjs'\)/);
assert.match(main, /companionController\?\.handleRuntimeEvent\(event\)/);
assert.match(main, /getExcludedWindows: \(\) => companionController\?\.windows\(\) \|\| \[\]/);
assert.match(main, /if \(companionController\?\.keepsAppAlive\(\)\)/);
assert.match(main, /appIsQuitting = true;\n\s+app\.quit\(\)/);
assert.match(main, /companionController\?\.shutdown\(\)/);

assert.match(preload, /syncCompanionSummary: \(summary\) => ipcRenderer\.invoke\('companion:summary-sync', summary\)/);
assert.match(preload, /onCompanionFocusTask/);
assert.ok(index.indexOf('memory-center.js') < index.indexOf('companion-bridge.js'));
assert.match(bridge, /state\.view = 'task'/);
assert.doesNotMatch(bridge, /state\.view = task\.kind === 'assistant'/);
assert.match(renderer, /id="account-toggle-companion"/);
assert.match(renderer, /petVisible \? '隐藏宠物' : '显示宠物'/);
assert.match(renderer, /aria-pressed="\$\{petVisible\}"/);
assert.match(rendererActions, /function toggleCompanionVisibility\(\)/);
assert.match(rendererActions, /persistDesktopSetting\('companion'/);
assert.match(rendererActions, /getElementById\('account-toggle-companion'\)/);

assert.match(profile, /const DEFAULT_COMPANION_PREFERENCES = Object\.freeze/);
assert.match(profile, /memoryEnabled: input\.memoryEnabled === true/);
assert.match(profile, /companion: normalizeCompanionPreferences\(input\.companion\)/);
assert.match(profile, /onDesktopPreferencesChange\(listener\)/);
assert.match(companionController, /profileContext\?\.onDesktopPreferencesChange/);
assert.match(computerPip, /getExcludedWindows = \(\) => \[\]/);
assert.match(companionController, /关闭主窗口后继续运行/);
assert.match(computerPip, /\.\.\.additionalWindows/);

console.log('companion integration wiring checks passed');
