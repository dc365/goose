'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const CompanionState = require('./companion-state.cjs');
const Layout = require('./companion-window-layout.cjs');

const IPC_STATE = 'companion:state';
const IPC_GET_STATE = 'companion:get-state';
const IPC_ACTION = 'companion:action';
const IPC_SUMMARY_SYNC = 'companion:summary-sync';
const BUBBLE_TIMEOUT_MS = 7_200;
const LOCAL_STATE_VERSION = 1;

function safeReadJson(target, fallback) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function normalizedLocalState(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    version: LOCAL_STATE_VERSION,
    positions: input.positions && typeof input.positions === 'object' ? input.positions : {},
    lastDisplayByProfile:
      input.lastDisplayByProfile && typeof input.lastDisplayByProfile === 'object'
        ? input.lastDisplayByProfile
        : {},
    mutedUntil: Math.max(0, Number(input.mutedUntil || 0)),
    updatedAt: input.updatedAt || null,
  };
}

function createCompanionController({
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  screen,
  productRoot,
  iconPath,
  profileContext,
  getMainWindow = () => null,
  openMainWindow = null,
  quitApplication = () => app.quit(),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  if (!app || !BrowserWindow || !Menu || !Tray || !ipcMain || !screen || !productRoot) {
    throw new Error('Companion controller requires Electron window, tray, IPC and screen services');
  }

  const stateStore = CompanionState.createCompanionStateStore({ now });
  const localStatePath = path.join(app.getPath('userData'), 'companion', 'window-state.json');
  let localState = normalizedLocalState(safeReadJson(localStatePath, {}));
  let preferences = { ...CompanionState.DEFAULT_COMPANION_PREFERENCES };
  let companionWindow = null;
  let tray = null;
  let mode = 'avatar';
  let currentNotification = null;
  let bubbleTimer = null;
  let loaded = false;
  let started = false;
  let shuttingDown = false;
  let profileUnsubscribe = null;
  let preferencesUnsubscribe = null;
  let dragSession = null;
  let interactive = true;
  let lastProfileKey = null;
  const screenBindings = [];

  function profileState() {
    try {
      return profileContext?.publicState?.() || {};
    } catch {
      return {};
    }
  }

  function profileKey() {
    return String(profileState().profileKey || 'signed-out');
  }

  function profileActive() {
    return Boolean(profileContext?.hasActiveProfile?.());
  }

  function persistLocalState() {
    localState.updatedAt = new Date(now()).toISOString();
    atomicWriteJson(localStatePath, localState);
  }

  function allDisplays() {
    try {
      return screen.getAllDisplays();
    } catch {
      return [screen.getPrimaryDisplay()];
    }
  }

  function displayById(id) {
    return allDisplays().find((display) => Layout.displayKey(display) === String(id)) || null;
  }

  function preferredDisplay() {
    const key = profileKey();
    const stored = displayById(localState.lastDisplayByProfile[key]);
    if (stored) return stored;
    if (companionWindow && !companionWindow.isDestroyed()) {
      try {
        return screen.getDisplayMatching(companionWindow.getBounds());
      } catch {}
    }
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  function storedAnchor(display) {
    const key = profileKey();
    const displayId = Layout.displayKey(display);
    const positions = localState.positions[key] || {};
    return Layout.normalizeAnchor(positions[displayId], display, preferences.scale);
  }

  function saveAnchor(anchor) {
    const key = profileKey();
    const displayId = String(anchor.displayId);
    localState.positions[key] = localState.positions[key] || {};
    localState.positions[key][displayId] = {
      edge: anchor.edge,
      y: Math.round(anchor.y),
    };
    localState.lastDisplayByProfile[key] = displayId;
    persistLocalState();
  }

  function enabled() {
    return env.METEOMATE_COMPANION !== '0' && profileActive() && preferences.enabled !== false;
  }

  function featureAvailable() {
    return env.METEOMATE_COMPANION !== '0';
  }

  function safeCompanionPreferences() {
    return {
      enabled: preferences.enabled !== false,
      scale: Layout.normalizedScale(preferences.scale),
      opacity: Math.min(1, Math.max(0.65, Number(preferences.opacity) || 1)),
      showBubbles: preferences.showBubbles !== false,
      lockPosition: Boolean(preferences.lockPosition),
      showOnAllWorkspaces: preferences.showOnAllWorkspaces !== false,
      showInFullscreen: Boolean(preferences.showInFullscreen),
      reduceMotion: Boolean(preferences.reduceMotion),
      completionNotification: preferences.completionNotification !== false,
      approvalNotification: preferences.approvalNotification !== false,
      failureNotification: preferences.failureNotification !== false,
      keepRunningInBackground: preferences.keepRunningInBackground !== false,
    };
  }

  function publicSnapshot() {
    return {
      ...stateStore.snapshot(),
      mode,
      notification: currentNotification ? { ...currentNotification } : null,
      profileActive: profileActive(),
      mutedUntil: localState.mutedUntil,
      muted: localState.mutedUntil > now(),
      settings: safeCompanionPreferences(),
    };
  }

  function sendState() {
    if (!loaded || !companionWindow || companionWindow.isDestroyed()) return;
    companionWindow.webContents.send(IPC_STATE, publicSnapshot());
  }

  function windowBounds(nextMode = mode, display = preferredDisplay()) {
    const anchor = storedAnchor(display);
    return Layout.boundsForMode({
      mode: nextMode,
      anchor,
      display,
      scale: preferences.scale,
    });
  }

  function applyWindowBehavior() {
    if (!companionWindow || companionWindow.isDestroyed()) return;
    const safePreferences = safeCompanionPreferences();
    if (typeof companionWindow.setOpacity === 'function') {
      try { companionWindow.setOpacity(safePreferences.opacity); } catch {}
    }
    try {
      companionWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'normal');
    } catch {
      companionWindow.setAlwaysOnTop(true);
    }
    if (typeof companionWindow.setVisibleOnAllWorkspaces === 'function') {
      companionWindow.setVisibleOnAllWorkspaces(safePreferences.showOnAllWorkspaces, {
        visibleOnFullScreen: safePreferences.showInFullscreen,
      });
    }
  }

  function createWindow() {
    if (companionWindow && !companionWindow.isDestroyed()) return companionWindow;
    const bounds = windowBounds('avatar');
    companionWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: Math.round(Layout.BASE_SIZES.avatar.width * 0.8),
      minHeight: Math.round(Layout.BASE_SIZES.avatar.height * 0.8),
      title: 'MeteoMate 桌面智伴',
      frame: false,
      transparent: true,
      hasShadow: false,
      movable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(productRoot, 'companion-preload.cjs'),
        partition: 'persist:meteomate-companion',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    applyWindowBehavior();
    if (typeof companionWindow.setExcludedFromShownWindowsMenu === 'function') {
      companionWindow.setExcludedFromShownWindowsMenu(true);
    }
    companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    companionWindow.webContents.on('will-navigate', (event, url) => {
      const allowed = pathToFileURL(path.join(productRoot, 'companion.html')).href;
      if (url !== allowed) event.preventDefault();
    });
    companionWindow.webContents.on('did-finish-load', () => {
      loaded = true;
      sendState();
    });
    companionWindow.on('closed', () => {
      loaded = false;
      companionWindow = null;
      dragSession = null;
    });
    companionWindow.loadFile(path.join(productRoot, 'companion.html'));
    return companionWindow;
  }

  function showInactive() {
    if (!enabled()) return false;
    const window = createWindow();
    applyWindowBehavior();
    if (!window.isVisible()) window.showInactive();
    sendState();
    return true;
  }

  function hideWindow() {
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.hide();
  }

  function setMode(nextMode, { focus = false } = {}) {
    if (!['avatar', 'bubble', 'panel'].includes(nextMode)) nextMode = 'avatar';
    mode = nextMode;
    if (!enabled()) return false;
    const window = createWindow();
    if (nextMode !== 'avatar') {
      interactive = true;
      try { window.setIgnoreMouseEvents(false); } catch {}
    }
    const display = preferredDisplay();
    const bounds = windowBounds(nextMode, display);
    window.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, true);
    if (focus) {
      window.show();
      window.focus();
    } else {
      window.showInactive();
    }
    sendState();
    return true;
  }

  function clearBubbleTimer() {
    if (!bubbleTimer) return;
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }

  function notificationAllowed(notification) {
    if (!notification || preferences.showBubbles === false || localState.mutedUntil > now()) return false;
    if (['approval', 'input'].includes(notification.kind)) return preferences.approvalNotification !== false;
    if (notification.kind === 'completed') return preferences.completionNotification !== false;
    if (notification.kind === 'failed') return preferences.failureNotification !== false;
    return true;
  }

  function clearNotification(taskId = '') {
    if (taskId && currentNotification?.taskId && currentNotification.taskId !== taskId) return false;
    if (taskId) stateStore.markRead(taskId);
    currentNotification = null;
    clearBubbleTimer();
    if (mode === 'bubble') setMode('avatar');
    else sendState();
    updateTray();
    return true;
  }

  function presentNotification(notification) {
    if (!notification) return;
    const allowed = notificationAllowed(notification);
    currentNotification = allowed ? { ...notification } : null;
    updateTray();
    if (!enabled()) return;
    const main = getMainWindow();
    const mainFocused = Boolean(main && !main.isDestroyed() && main.isFocused());
    if (mode === 'panel' || mainFocused || !allowed) {
      showInactive();
      sendState();
      return;
    }
    clearBubbleTimer();
    setMode('bubble');
    if (!notification.sticky) {
      bubbleTimer = setTimeout(() => {
        bubbleTimer = null;
        currentNotification = null;
        if (mode === 'bubble') setMode('avatar');
        else sendState();
        updateTray();
      }, BUBBLE_TIMEOUT_MS);
    }
  }

  function openMain(taskId = '') {
    const normalizedTaskId = CompanionState.cleanText(taskId, 120);
    if (typeof openMainWindow === 'function') {
      openMainWindow(normalizedTaskId);
    } else {
      const main = getMainWindow();
      if (main && !main.isDestroyed()) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
        if (normalizedTaskId) main.webContents.send('companion:focus-task', { taskId: normalizedTaskId });
      }
    }
    if (normalizedTaskId) stateStore.markRead(normalizedTaskId);
    clearNotification(normalizedTaskId);
    if (mode !== 'avatar') setMode('avatar');
    sendState();
  }

  function refreshPreferences() {
    const nextProfileKey = profileKey();
    if (nextProfileKey !== lastProfileKey) {
      lastProfileKey = nextProfileKey;
      clearBubbleTimer();
      currentNotification = null;
      dragSession = null;
      mode = 'avatar';
      stateStore.reset();
    }
    let profilePreferences = null;
    if (profileActive()) {
      try {
        profilePreferences = profileContext?.desktopPreferences?.()?.companion || null;
      } catch {
        profilePreferences = null;
      }
    }
    preferences = {
      ...CompanionState.DEFAULT_COMPANION_PREFERENCES,
      ...(profilePreferences || {}),
      scale: Layout.normalizedScale(profilePreferences?.scale),
    };
    if (enabled()) {
      showInactive();
      setMode(mode === 'panel' ? 'panel' : 'avatar');
    } else {
      hideWindow();
    }
    updateTray();
    return safeCompanionPreferences();
  }

  function savePreferences(patch = {}) {
    if (!profileActive()) {
      openMain();
      return safeCompanionPreferences();
    }
    const desktop = profileContext.desktopPreferences();
    const saved = profileContext.saveDesktopPreferences({
      companion: {
        ...desktop.companion,
        ...patch,
      },
    });
    preferences = {
      ...CompanionState.DEFAULT_COMPANION_PREFERENCES,
      ...(saved.companion || {}),
      scale: Layout.normalizedScale(saved.companion?.scale),
    };
    if (enabled()) {
      showInactive();
      setMode(mode === 'panel' ? 'panel' : 'avatar');
    } else {
      hideWindow();
    }
    updateTray();
    sendState();
    return safeCompanionPreferences();
  }

  function muteFor(milliseconds) {
    localState.mutedUntil = Math.max(localState.mutedUntil, now() + Math.max(0, Number(milliseconds) || 0));
    persistLocalState();
    clearNotification();
    updateTray();
    sendState();
  }

  function resetPosition() {
    const key = profileKey();
    delete localState.positions[key];
    delete localState.lastDisplayByProfile[key];
    persistLocalState();
    if (enabled()) setMode('avatar');
  }

  function contextMenuTemplate({ trayMenu = false } = {}) {
    const snapshot = stateStore.snapshot();
    const task = snapshot.primaryTask;
    const profileReady = profileActive();
    const scaleMenu = ['small', 'medium', 'large'].map((scale) => ({
      label: ({ small: '小', medium: '中', large: '大' })[scale],
      type: 'radio',
      checked: preferences.scale === scale,
      enabled: profileReady,
      click: () => savePreferences({ scale }),
    }));
    return [
      {
        label: '打开 MeteoMate',
        click: () => openMain(task?.id || ''),
      },
      {
        label: task ? `查看：${CompanionState.cleanText(task.title, 26)}` : '查看当前任务',
        enabled: Boolean(task),
        click: () => openMain(task?.id || ''),
      },
      { type: 'separator' },
      {
        label: '显示桌面智伴',
        type: 'checkbox',
        checked: enabled(),
        enabled: profileReady,
        click: (item) => savePreferences({ enabled: Boolean(item.checked) }),
      },
      {
        label: '锁定位置',
        type: 'checkbox',
        checked: Boolean(preferences.lockPosition),
        enabled: profileReady && preferences.enabled !== false,
        click: (item) => savePreferences({ lockPosition: Boolean(item.checked) }),
      },
      {
        label: '尺寸',
        submenu: scaleMenu,
      },
      {
        label: '不透明度',
        submenu: [0.7, 0.85, 1].map((opacity) => ({
          label: `${Math.round(opacity * 100)}%`,
          type: 'radio',
          checked: Math.abs(Number(preferences.opacity || 1) - opacity) < 0.01,
          enabled: profileReady,
          click: () => savePreferences({ opacity }),
        })),
      },
      {
        label: '显示状态气泡',
        type: 'checkbox',
        checked: preferences.showBubbles !== false,
        enabled: profileReady,
        click: (item) => savePreferences({ showBubbles: Boolean(item.checked) }),
      },
      {
        label: '提醒类型',
        submenu: [
          {
            label: '等待输入与审批',
            type: 'checkbox',
            checked: preferences.approvalNotification !== false,
            enabled: profileReady,
            click: (item) => savePreferences({ approvalNotification: Boolean(item.checked) }),
          },
          {
            label: '任务完成',
            type: 'checkbox',
            checked: preferences.completionNotification !== false,
            enabled: profileReady,
            click: (item) => savePreferences({ completionNotification: Boolean(item.checked) }),
          },
          {
            label: '任务失败',
            type: 'checkbox',
            checked: preferences.failureNotification !== false,
            enabled: profileReady,
            click: (item) => savePreferences({ failureNotification: Boolean(item.checked) }),
          },
        ],
      },
      {
        label: '减少动态效果',
        type: 'checkbox',
        checked: Boolean(preferences.reduceMotion),
        enabled: profileReady,
        click: (item) => savePreferences({ reduceMotion: Boolean(item.checked) }),
      },
      {
        label: '显示在所有桌面',
        type: 'checkbox',
        checked: preferences.showOnAllWorkspaces !== false,
        enabled: profileReady,
        click: (item) => savePreferences({ showOnAllWorkspaces: Boolean(item.checked) }),
      },
      {
        label: '全屏应用上方显示',
        type: 'checkbox',
        checked: Boolean(preferences.showInFullscreen),
        enabled: profileReady,
        click: (item) => savePreferences({ showInFullscreen: Boolean(item.checked) }),
      },
      {
        label: '关闭主窗口后继续运行',
        type: 'checkbox',
        checked: preferences.keepRunningInBackground !== false,
        enabled: profileReady,
        click: (item) => savePreferences({ keepRunningInBackground: Boolean(item.checked) }),
      },
      { type: 'separator' },
      {
        label: localState.mutedUntil > now() ? '取消静默' : '静默 1 小时',
        click: () => {
          if (localState.mutedUntil > now()) {
            localState.mutedUntil = 0;
            persistLocalState();
            updateTray();
            sendState();
          } else {
            muteFor(60 * 60 * 1_000);
          }
        },
      },
      {
        label: '重置桌面位置',
        enabled: profileReady,
        click: resetPosition,
      },
      ...(trayMenu ? [] : [{
        label: '暂时隐藏（有新提醒时显示）',
        click: hideWindow,
      }]),
      { type: 'separator' },
      {
        label: '退出 MeteoMate',
        click: quitApplication,
      },
    ];
  }

  function showContextMenu() {
    const menu = Menu.buildFromTemplate(contextMenuTemplate());
    menu.popup({ window: companionWindow || undefined });
  }

  function updateTray() {
    if (!tray || tray.isDestroyed?.()) return;
    const snapshot = stateStore.snapshot();
    const suffix = currentNotification?.title || snapshot.statusLabel;
    tray.setToolTip(`MeteoMate · ${suffix}`);
    tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate({ trayMenu: true })));
  }

  function createTray() {
    if (tray && !tray.isDestroyed?.()) return tray;
    tray = new Tray(iconPath);
    tray.setToolTip('MeteoMate 桌面智伴');
    tray.on('click', () => openMain(stateStore.snapshot().primaryTask?.id || ''));
    updateTray();
    return tray;
  }

  function beginDrag(request = {}) {
    if (!companionWindow || companionWindow.isDestroyed() || mode !== 'avatar' || preferences.lockPosition) return false;
    const x = Number(request.screenX);
    const y = Number(request.screenY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    dragSession = {
      startPointer: { x, y },
      startBounds: companionWindow.getBounds(),
      display: screen.getDisplayMatching(companionWindow.getBounds()),
    };
    interactive = true;
    companionWindow.setIgnoreMouseEvents(false);
    return true;
  }

  function updateDrag(request = {}) {
    if (!dragSession || !companionWindow || companionWindow.isDestroyed()) return false;
    const x = Number(request.screenX);
    const y = Number(request.screenY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const displays = allDisplays();
    const nextDisplay = Layout.nearestDisplay(displays, { x, y, width: 1, height: 1 })
      || dragSession.display;
    const nextBounds = Layout.dragBounds({
      startBounds: dragSession.startBounds,
      startPointer: dragSession.startPointer,
      pointer: { x, y },
      display: nextDisplay,
    });
    companionWindow.setBounds(nextBounds, false);
    dragSession.lastDisplay = nextDisplay;
    return true;
  }

  function endDrag() {
    if (!dragSession || !companionWindow || companionWindow.isDestroyed()) return false;
    const display = dragSession.lastDisplay || screen.getDisplayMatching(companionWindow.getBounds());
    const anchor = Layout.anchorFromBounds(companionWindow.getBounds(), display, preferences.scale);
    saveAnchor(anchor);
    dragSession = null;
    setMode('avatar');
    return true;
  }

  function setInteractive(value) {
    if (!companionWindow || companionWindow.isDestroyed() || dragSession) return false;
    // Electron's forwarded mouse-move mode is not consistently available on Linux.
    // Keep the compact window interactive there instead of risking a permanently click-through pet.
    if (process.platform === 'linux') return true;
    const next = Boolean(value);
    if (next === interactive) return true;
    interactive = next;
    try {
      companionWindow.setIgnoreMouseEvents(!interactive, { forward: true });
    } catch {
      companionWindow.setIgnoreMouseEvents(!interactive);
    }
    return true;
  }

  function handleAction(request = {}) {
    switch (String(request.type || '')) {
      case 'toggle-panel':
        return setMode(mode === 'panel' ? 'avatar' : 'panel', { focus: mode !== 'panel' });
      case 'close-panel':
        return setMode('avatar');
      case 'open-main':
        openMain(request.taskId || stateStore.snapshot().primaryTask?.id || '');
        return true;
      case 'hide':
        hideWindow();
        return true;
      case 'context-menu':
        showContextMenu();
        return true;
      case 'mute-hour':
        muteFor(60 * 60 * 1_000);
        return true;
      case 'clear-notification':
        return clearNotification(request.taskId || '');
      case 'drag-start':
        return beginDrag(request);
      case 'drag-move':
        return updateDrag(request);
      case 'drag-end':
        return endDrag();
      case 'set-interactive':
        return setInteractive(request.interactive);
      default:
        return false;
    }
  }

  function isCompanionSender(event) {
    return Boolean(
      companionWindow
      && !companionWindow.isDestroyed()
      && event?.sender?.id === companionWindow.webContents.id
    );
  }

  function isMainSender(event) {
    const main = getMainWindow();
    return Boolean(main && !main.isDestroyed() && event?.sender?.id === main.webContents.id);
  }

  function registerIpc() {
    ipcMain.handle(IPC_GET_STATE, (event) => {
      if (!isCompanionSender(event)) throw new Error('Companion state is only available to the companion window');
      return publicSnapshot();
    });
    ipcMain.handle(IPC_ACTION, (event, request) => {
      if (!isCompanionSender(event)) throw new Error('Companion action source is invalid');
      return handleAction(request || {});
    });
    ipcMain.handle(IPC_SUMMARY_SYNC, (event, summary) => {
      if (!isMainSender(event)) throw new Error('Companion summary source is invalid');
      const result = stateStore.syncSummary(summary || {});
      if (result.clearNotificationTaskId) clearNotification(result.clearNotificationTaskId);
      if (result.notification) presentNotification(result.notification);
      else sendState();
      updateTray();
      return publicSnapshot();
    });
  }

  function unregisterIpc() {
    ipcMain.removeHandler(IPC_GET_STATE);
    ipcMain.removeHandler(IPC_ACTION);
    ipcMain.removeHandler(IPC_SUMMARY_SYNC);
  }

  function bindScreenEvent(name, listener) {
    screen.on(name, listener);
    screenBindings.push(() => screen.removeListener(name, listener));
  }

  function handleDisplaysChanged() {
    if (!enabled() || !companionWindow || companionWindow.isDestroyed()) return;
    const display = preferredDisplay();
    const bounds = windowBounds(mode, display);
    companionWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, false);
  }

  function start() {
    if (started) return;
    started = true;
    registerIpc();
    if (!featureAvailable()) return;
    createTray();
    profileUnsubscribe = profileContext?.onChange?.(() => refreshPreferences()) || null;
    preferencesUnsubscribe = profileContext?.onDesktopPreferencesChange?.(() => refreshPreferences()) || null;
    bindScreenEvent('display-added', handleDisplaysChanged);
    bindScreenEvent('display-removed', handleDisplaysChanged);
    bindScreenEvent('display-metrics-changed', handleDisplaysChanged);
    refreshPreferences();
  }

  function handleRuntimeEvent(event) {
    const result = stateStore.handleRuntimeEvent(event || {});
    if (result.clearNotificationTaskId) clearNotification(result.clearNotificationTaskId);
    if (result.notification) presentNotification(result.notification);
    else sendState();
    updateTray();
  }

  function setMainWindowVisible(visible) {
    stateStore.setMainWindowVisible(visible);
    sendState();
  }

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearBubbleTimer();
    profileUnsubscribe?.();
    profileUnsubscribe = null;
    preferencesUnsubscribe?.();
    preferencesUnsubscribe = null;
    while (screenBindings.length) screenBindings.pop()();
    if (started) unregisterIpc();
    started = false;
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.destroy();
    companionWindow = null;
    if (tray && !tray.isDestroyed?.()) tray.destroy();
    tray = null;
  }

  return Object.freeze({
    start,
    shutdown,
    refreshPreferences,
    handleRuntimeEvent,
    setMainWindowVisible,
    syncSummary(summary) {
      const result = stateStore.syncSummary(summary || {});
      if (result.clearNotificationTaskId) clearNotification(result.clearNotificationTaskId);
      if (result.notification) presentNotification(result.notification);
      else sendState();
      updateTray();
      return publicSnapshot();
    },
    snapshot: publicSnapshot,
    windows: () => companionWindow && !companionWindow.isDestroyed() ? [companionWindow] : [],
    keepsAppAlive: () => featureAvailable()
      && profileActive()
      && preferences.keepRunningInBackground !== false
      && Boolean(tray && !tray.isDestroyed?.()),
  });
}

module.exports = {
  BUBBLE_TIMEOUT_MS,
  IPC_ACTION,
  IPC_GET_STATE,
  IPC_STATE,
  IPC_SUMMARY_SYNC,
  createCompanionController,
  normalizedLocalState,
};
