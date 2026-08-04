'use strict';

const assert = require('node:assert/strict');
const Layout = require('../capabilities/companion-window-layout.cjs');

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
const leftMonitor = { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 800 } };

assert.deepEqual(Layout.windowSize('avatar', 'medium'), { width: 132, height: 132 });
assert.ok(Layout.windowSize('avatar', 'large').width > Layout.windowSize('avatar', 'medium').width);
assert.deepEqual(Layout.windowSize('panel', 'small'), Layout.windowSize('panel', 'large'));

const anchor = Layout.defaultAnchor(primary, 'medium');
assert.equal(anchor.edge, 'right');
const avatarBounds = Layout.boundsForMode({ mode: 'avatar', anchor, display: primary, scale: 'medium' });
assert.equal(avatarBounds.x, 1440 - 132 - Layout.EDGE_INSET);
assert.ok(avatarBounds.y >= primary.workArea.y);
assert.ok(avatarBounds.y + avatarBounds.height <= primary.workArea.height);

const panelBounds = Layout.boundsForMode({ mode: 'panel', anchor, display: primary, scale: 'medium' });
assert.equal(panelBounds.x, 1440 - Layout.BASE_SIZES.panel.width - Layout.EDGE_INSET);
assert.ok(panelBounds.y >= primary.workArea.y);
assert.ok(panelBounds.y + panelBounds.height <= primary.workArea.height);

const dragged = Layout.dragBounds({
  startBounds: avatarBounds,
  startPointer: { x: 1400, y: 700 },
  pointer: { x: -2000, y: -500 },
  display: leftMonitor,
});
assert.ok(dragged.x >= leftMonitor.workArea.x);
assert.ok(dragged.x + dragged.width <= leftMonitor.workArea.x + leftMonitor.workArea.width);
assert.ok(dragged.y >= leftMonitor.workArea.y);

const leftAnchor = Layout.anchorFromBounds({
  x: leftMonitor.workArea.x + 10,
  y: 300,
  width: 132,
  height: 132,
}, leftMonitor, 'medium');
assert.equal(leftAnchor.edge, 'left');
assert.equal(leftAnchor.displayId, '2');

const rightAnchor = Layout.anchorFromBounds({
  x: 1200,
  y: 780,
  width: 132,
  height: 132,
}, primary, 'medium');
assert.equal(rightAnchor.edge, 'right');
assert.ok(rightAnchor.y <= primary.workArea.height - 132 - 16);

assert.equal(
  Layout.nearestDisplay([primary, leftMonitor], { x: -1200, y: 100, width: 100, height: 100 }).id,
  2,
);
assert.equal(
  Layout.nearestDisplay([primary, leftMonitor], { x: 100, y: 100, width: 100, height: 100 }).id,
  1,
);

console.log('companion layout checks passed');
