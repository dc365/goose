'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CompanionState = require('../capabilities/companion-state.cjs');
const { createCompanionController } = require('../capabilities/companion-window-controller.cjs');

let webContentsSequence = 100;
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = ++webContentsSequence;
    this.sent = [];
  }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
}

class FakeWindow extends EventEmitter {
  static instances = [];
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.visible = Boolean(options.show);
    this.focused = false;
    this.destroyed = false;
    this.webContents = new FakeWebContents();
    FakeWindow.instances.push(this);
  }
  loadFile(file) {
    this.file = file;
    this.webContents.emit('did-finish-load');
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  isFocused() { return this.focused; }
  isMinimized() { return false; }
  restore() {}
  showInactive() { this.visible = true; this.focused = false; }
  show() { this.visible = true; }
  hide() { this.visible = false; this.focused = false; }
  focus() { this.focused = true; this.visible = true; }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; }
  setOpacity(value) { this.opacity = value; }
  setAlwaysOnTop(...args) { this.alwaysOnTop = args; }
  setVisibleOnAllWorkspaces(value, options) { this.allWorkspaces = { value, options }; }
  setExcludedFromShownWindowsMenu(value) { this.excluded = value; }
  setIgnoreMouseEvents(value, options) { this.ignoreMouse = { value, options }; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }
}

class FakeTray extends EventEmitter {
  static instances = [];
  constructor(icon) {
    super();
    this.icon = icon;
    this.destroyed = false;
    FakeTray.instances.push(this);
  }
  isDestroyed() { return this.destroyed; }
  setToolTip(value) { this.tooltip = value; }
  setContextMenu(value) { this.menu = value; }
  destroy() { this.destroyed = true; }
}

const Menu = {
  buildFromTemplate(template) {
    return { template, popup() {} };
  },
};

const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 1_000, height: 800 } },
  { id: 2, workArea: { x: 1_000, y: 0, width: 1_000, height: 800 } },
];
const screen = new EventEmitter();
screen.getAllDisplays = () => displays;
screen.getPrimaryDisplay = () => displays[0];
screen.getCursorScreenPoint = () => ({ x: 850, y: 500 });
screen.getDisplayNearestPoint = (point) => point.x >= 1_000 ? displays[1] : displays[0];
screen.getDisplayMatching = (bounds) => {
  const center = Number(bounds.x) + Number(bounds.width || 0) / 2;
  return center >= 1_000 ? displays[1] : displays[0];
};

const handlers = new Map();
const ipcMain = {
  handle(name, handler) { handlers.set(name, handler); },
  removeHandler(name) { handlers.delete(name); },
};

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-companion-controller-'));
let active = true;
let profileId = 'profile-1';
let desktop = {
  sendOnEnter: true,
  companion: { ...CompanionState.DEFAULT_COMPANION_PREFERENCES },
};
const profileListeners = new Set();
const preferenceListeners = new Set();
const profileContext = {
  publicState: () => ({ profileKey: active ? profileId : null }),
  hasActiveProfile: () => active,
  desktopPreferences: () => structuredClone(desktop),
  saveDesktopPreferences(input = {}) {
    desktop = {
      ...desktop,
      ...input,
      companion: {
        ...desktop.companion,
        ...(input.companion || {}),
      },
    };
    preferenceListeners.forEach((listener) => listener(structuredClone(desktop)));
    return structuredClone(desktop);
  },
  onChange(listener) {
    profileListeners.add(listener);
    return () => profileListeners.delete(listener);
  },
  onDesktopPreferencesChange(listener) {
    preferenceListeners.add(listener);
    return () => preferenceListeners.delete(listener);
  },
};
const app = { getPath: () => temp, quit() {} };
const openedTasks = [];
const controller = createCompanionController({
  app,
  BrowserWindow: FakeWindow,
  Menu,
  Tray: FakeTray,
  ipcMain,
  screen,
  productRoot: path.resolve(__dirname, '..'),
  iconPath: path.join(temp, 'icon.png'),
  profileContext,
  openMainWindow: (taskId) => openedTasks.push(taskId),
  quitApplication: () => {},
  now: (() => { let value = 1_900_000_000_000; return () => ++value; })(),
});

try {
  controller.start();
  assert.equal(FakeWindow.instances.length, 1);
  assert.equal(controller.windows().length, 1);
  assert.equal(controller.keepsAppAlive(), true);
  for (const channel of ['companion:get-state', 'companion:action', 'companion:summary-sync']) {
    assert.ok(handlers.has(channel), `missing ${channel}`);
  }

  const window = controller.windows()[0];
  const companionEvent = { sender: window.webContents };
  controller.syncSummary({
    activeTaskId: 'task-1',
    tasks: [{ id: 'task-1', title: '华东强降水研判', lifecycleState: 'RUNNING' }],
  });
  controller.handleRuntimeEvent({ type: 'turn_completed', taskId: 'task-1' });
  assert.equal(controller.snapshot().mode, 'bubble');
  assert.equal(controller.snapshot().notification.kind, 'completed');

  handlers.get('companion:action')(companionEvent, {
    type: 'clear-notification',
    taskId: 'task-1',
  });
  assert.equal(controller.snapshot().notification, null);
  assert.equal(controller.snapshot().primaryTask, null, 'acknowledged terminal tasks should not remain primary');

  const startBounds = window.getBounds();
  handlers.get('companion:action')(companionEvent, {
    type: 'drag-start',
    screenX: startBounds.x + 40,
    screenY: startBounds.y + 40,
  });
  handlers.get('companion:action')(companionEvent, {
    type: 'drag-move',
    screenX: 1_240,
    screenY: 420,
  });
  handlers.get('companion:action')(companionEvent, { type: 'drag-end' });
  assert.ok(window.getBounds().x >= 1_000, 'dragging should cross to the second display');
  const localState = JSON.parse(fs.readFileSync(path.join(temp, 'companion', 'window-state.json'), 'utf8'));
  assert.equal(localState.lastDisplayByProfile['profile-1'], '2');

  desktop.companion.keepRunningInBackground = false;
  profileListeners.forEach((listener) => listener());
  assert.equal(controller.keepsAppAlive(), false);
  profileContext.saveDesktopPreferences({ companion: { enabled: false } });
  assert.equal(window.isVisible(), false, 'disabling the companion preference must hide the pet');
  profileContext.saveDesktopPreferences({ companion: { enabled: true } });
  assert.equal(window.isVisible(), true, 'enabling the companion preference must show the pet');
  desktop.companion.keepRunningInBackground = true;
  active = false;
  profileListeners.forEach((listener) => listener());
  assert.equal(controller.keepsAppAlive(), false, 'signed-out tray must not keep the process alive');
  assert.equal(window.isVisible(), false);
  assert.equal(controller.snapshot().recentTasks.length, 0, 'logout must clear the previous profile projection');

  active = true;
  profileId = 'profile-2';
  profileListeners.forEach((listener) => listener());
  assert.equal(controller.snapshot().recentTasks.length, 0, 'profile switch must not expose the previous user tasks');
  handlers.get('companion:action')(companionEvent, { type: 'open-main', taskId: 'task-1' });
  assert.deepEqual(openedTasks, ['task-1']);

  desktop.companion.failureNotification = false;
  profileListeners.forEach((listener) => listener());
  controller.handleRuntimeEvent({ type: 'turn_started', taskId: 'task-muted-failure' });
  controller.handleRuntimeEvent({ type: 'turn_failed', taskId: 'task-muted-failure', message: '测试失败' });
  assert.equal(controller.snapshot().notification, null, 'disabled failure notifications must not remain in tray/bubble state');
  assert.equal(controller.snapshot().visualState, 'failed', 'the task state remains visible even when its bubble is disabled');

  console.log('companion controller checks passed');
} finally {
  controller.shutdown();
  assert.equal(handlers.size, 0);
  assert.equal(preferenceListeners.size, 0);
  fs.rmSync(temp, { recursive: true, force: true });
}

const disabledController = createCompanionController({
  app,
  BrowserWindow: FakeWindow,
  Menu,
  Tray: FakeTray,
  ipcMain,
  screen,
  productRoot: path.resolve(__dirname, '..'),
  iconPath: path.join(temp, 'icon.png'),
  profileContext,
  env: { METEOMATE_COMPANION: '0' },
});
const windowCountBeforeDisabledStart = FakeWindow.instances.length;
const trayCountBeforeDisabledStart = FakeTray.instances.length;
try {
  disabledController.start();
  assert.equal(FakeWindow.instances.length, windowCountBeforeDisabledStart);
  assert.equal(FakeTray.instances.length, trayCountBeforeDisabledStart);
  assert.equal(disabledController.windows().length, 0);
  assert.equal(disabledController.keepsAppAlive(), false);
} finally {
  disabledController.shutdown();
  assert.equal(handlers.size, 0);
}
