'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCompanionPreferences,
  normalizeDesktopPreferences,
} = require('../capabilities/profile-context.cjs');

const defaults = normalizeDesktopPreferences({});
assert.equal(defaults.memoryEnabled, false);
assert.deepEqual(defaults.companion, DEFAULT_COMPANION_PREFERENCES);

const normalized = normalizeCompanionPreferences({
  enabled: false,
  scale: 'huge',
  opacity: 4,
  showBubbles: false,
  lockPosition: true,
  reduceMotion: true,
  completionNotification: false,
  keepRunningInBackground: false,
});
assert.equal(normalized.enabled, false);
assert.equal(normalized.scale, 'medium');
assert.equal(normalized.opacity, 1);
assert.equal(normalized.showBubbles, false);
assert.equal(normalized.lockPosition, true);
assert.equal(normalized.reduceMotion, true);
assert.equal(normalized.completionNotification, false);
assert.equal(normalized.keepRunningInBackground, false);

const lowOpacity = normalizeCompanionPreferences({ opacity: 0.1 });
assert.equal(lowOpacity.opacity, 0.65);

const desktop = normalizeDesktopPreferences({
  sendOnEnter: false,
  memoryEnabled: true,
  companion: { scale: 'large', showOnAllWorkspaces: false },
});
assert.equal(desktop.sendOnEnter, false);
assert.equal(desktop.memoryEnabled, true);
assert.equal(desktop.companion.scale, 'large');
assert.equal(desktop.companion.showOnAllWorkspaces, false);
assert.equal(desktop.companion.approvalNotification, true);

console.log('companion preference checks passed');
