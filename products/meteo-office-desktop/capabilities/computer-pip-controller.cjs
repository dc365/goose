'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CUA_EXTENSION_ID = 'cua-desktop';
const WINDOW_SOURCE_PATTERN = /^window:(\d+):/;
const PIP_HEADER_HEIGHT = 32;
const PIP_RIGHT_INSET = 16;
const PIP_TOP_INSET = 72;
const PIP_BOTTOM_INSET = 16;
const PIP_STACK_GAP = 8;
const PIP_MAX_WINDOWS = 3;
const PIP_MIN_CONTENT_WIDTH = 112;
const PIP_MIN_CONTENT_HEIGHT = 94;
const PIP_MAX_CONTENT_WIDTH = 320;
const PIP_MAX_CONTENT_HEIGHT = 300;
const PIP_STREAM_RETRY_DELAY_MS = 1_500;
const PIP_TURN_CLOSE_DELAY_MS = 18_000;
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled']);
const PASSIVE_TOOLS = new Set([
  'get_accessibility_tree',
  'get_cursor_position',
  'get_desktop_state',
  'get_screen_size',
  'list_apps',
  'list_windows',
]);
const ACTION_LABELS = Object.freeze({
  click: '正在点击目标窗口',
  double_click: '正在双击目标窗口',
  drag: '正在拖动',
  get_window_state: '正在读取窗口',
  hotkey: '正在使用快捷键',
  move_cursor: '正在移动指针',
  press_key: '正在按键',
  right_click: '正在打开菜单',
  scroll: '正在滚动',
  type_text: '正在输入文本',
  zoom: '正在查看局部画面',
});

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizedToolName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!name) return '';
  return name
    .replace(/^.*cua-desktop(?:__|:|\s)+/, '')
    .replace(/^.*cua_driver(?:__|:|\s)+/, '')
    .split('__')
    .at(-1)
    .trim();
}

function isComputerEvent(event = {}) {
  const extensionName = String(event.extensionName || '').trim().toLowerCase();
  const toolName = String(event.toolName || event.title || '').trim().toLowerCase();
  return extensionName === CUA_EXTENSION_ID
    || toolName.includes('cua-desktop')
    || toolName.includes('cua_driver');
}

function parseMediaSourceWindowId(sourceId) {
  const match = String(sourceId || '').match(WINDOW_SOURCE_PATTERN);
  return match ? positiveInteger(match[1]) : null;
}

function parseJsonString(value) {
  const text = String(value || '').trim();
  if (!text || !['{', '['].includes(text[0])) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectAcpImages(value, images = [], seen = new WeakSet()) {
  if (!value) return images;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAcpImages(entry, images, seen));
    return images;
  }
  if (typeof value !== 'object' || seen.has(value)) return images;
  seen.add(value);
  if (value.type === 'image' && typeof value.data === 'string' && typeof value.mimeType === 'string') {
    images.push(value);
    return images;
  }
  if (value.type === 'image_url') {
    const url = typeof value.image_url === 'string'
      ? value.image_url
      : value.image_url?.url;
    const match = String(url || '').match(/^data:(image\/[^;,]+);base64,([\s\S]+)$/i);
    if (match) {
      images.push({
        type: 'image',
        mimeType: match[1].toLowerCase(),
        data: url,
      });
    }
    return images;
  }
  Object.values(value).forEach((entry) => collectAcpImages(entry, images, seen));
  return images;
}

function createToolIdentityTracker({ limit = 256 } = {}) {
  const identities = new Map();
  const keyFor = (sessionId, toolCallId) => `${String(sessionId || '')}:${String(toolCallId || '')}`;

  return Object.freeze({
    clear: () => identities.clear(),
    resolve(sessionId, toolCallId, identity = {}) {
      const key = keyFor(sessionId, toolCallId);
      const previous = identities.get(key) || {};
      const resolved = {
        extensionName: identity.extensionName || previous.extensionName || null,
        toolName: identity.toolName || previous.toolName || null,
      };
      if (sessionId && toolCallId && (resolved.extensionName || resolved.toolName)) {
        identities.delete(key);
        identities.set(key, resolved);
        while (identities.size > limit) identities.delete(identities.keys().next().value);
      }
      return resolved;
    },
  });
}

function computerUsePromptInstruction({ fullAccess = false, approval = '' } = {}) {
  const approvalText = approval || (fullAccess
    ? '完全访问下，已允许的桌面操作无需再次请求审批；'
    : '每次请求交互审批时说明目标应用、窗口和预期结果；');
  return ` 使用桌面应用操作前，必须先通过 list_apps、list_windows 和 get_window_state 明确目标应用与窗口。若 list_windows 仅返回窗口数量摘要，必须调用 get_accessibility_tree 读取可见窗口的 pid 和 window_id 明细，禁止猜测 window_id。${approvalText}仍不得操作终端、密码管理器、系统隐私设置或 MeteoMate 自身窗口。`;
}

function windowBounds(value = {}) {
  const bounds = value.bounds && typeof value.bounds === 'object'
    ? value.bounds
    : value.frame && typeof value.frame === 'object'
      ? value.frame
      : {};
  const width = Number(bounds.width ?? bounds.w);
  const height = Number(bounds.height ?? bounds.h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    x: Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : 0,
    y: Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

function windowArea(value = {}) {
  const bounds = value.bounds || windowBounds(value);
  return Math.max(0, Number(bounds?.width) || 0) * Math.max(0, Number(bounds?.height) || 0);
}

function extractTarget(value, seen = new WeakSet()) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    return parsed ? extractTarget(parsed, seen) : null;
  }
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = extractTarget(entry, seen);
      if (target) return target;
    }
    return null;
  }

  const windowId = positiveInteger(value.window_id ?? value.windowId);
  const pid = positiveInteger(value.pid ?? value.process_id ?? value.processId);
  if (windowId || pid) {
    return {
      windowId,
      pid,
      appName: String(value.app_name ?? value.appName ?? '').trim(),
      title: String(value.title ?? value.window_title ?? value.windowTitle ?? '').trim(),
      bounds: windowBounds(value),
      isOnScreen: value.is_on_screen ?? value.isOnScreen ?? null,
      onCurrentSpace: value.on_current_space ?? value.onCurrentSpace ?? null,
      zIndex: Number.isFinite(Number(value.z_index ?? value.zIndex))
        ? Number(value.z_index ?? value.zIndex)
        : null,
    };
  }
  for (const [key, entry] of Object.entries(value)) {
    if (['data', 'dataBase64', 'base64'].includes(key)) continue;
    const target = extractTarget(entry, seen);
    if (target) return target;
  }
  return null;
}

function collectWindowRecords(value, records = [], seen = new WeakSet()) {
  if (!value) return records;
  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    if (parsed) collectWindowRecords(parsed, records, seen);
    return records;
  }
  if (typeof value !== 'object' || seen.has(value)) return records;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectWindowRecords(entry, records, seen));
    return records;
  }

  const windowId = positiveInteger(value.window_id ?? value.windowId);
  const pid = positiveInteger(value.pid ?? value.process_id ?? value.processId);
  if (windowId && pid) {
    records.push({
      windowId,
      pid,
      appName: String(value.app_name ?? value.appName ?? '').trim(),
      title: String(value.title ?? value.window_title ?? value.windowTitle ?? '').trim(),
      bounds: windowBounds(value),
      isOnScreen: value.is_on_screen ?? value.isOnScreen ?? null,
      onCurrentSpace: value.on_current_space ?? value.onCurrentSpace ?? null,
      zIndex: Number.isFinite(Number(value.z_index ?? value.zIndex))
        ? Number(value.z_index ?? value.zIndex)
        : null,
    });
  }
  for (const [key, entry] of Object.entries(value)) {
    if (['data', 'dataBase64', 'base64'].includes(key)) continue;
    collectWindowRecords(entry, records, seen);
  }
  return records;
}

function actionLabel(toolName, status = 'running') {
  const normalized = normalizedToolName(toolName);
  if (['failed', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase())) {
    return '桌面操作未完成';
  }
  if (String(status || '').toLowerCase() === 'completed') return '桌面操作已完成';
  return ACTION_LABELS[normalized] || '正在操作目标窗口';
}

function safeIconDataUrl(source) {
  try {
    if (source?.appIcon && !source.appIcon.isEmpty()) return source.appIcon.toDataURL();
  } catch {
    return '';
  }
  return '';
}

function displayWorkArea(display) {
  return display?.workArea || { x: 0, y: 0, width: 1440, height: 900 };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function preferredPreviewSize(sourceBounds, display) {
  const workArea = displayWorkArea(display);
  const sourceWidth = Number(sourceBounds?.width);
  const sourceHeight = Number(sourceBounds?.height);
  const sourceAspect = sourceWidth > 0 && sourceHeight > 0
    ? sourceWidth / sourceHeight
    : 16 / 10;
  const aspect = clamp(sourceAspect, 0.35, 3.4);
  const maxContentWidth = Math.min(
    PIP_MAX_CONTENT_WIDTH,
    Math.max(PIP_MIN_CONTENT_WIDTH, workArea.width - PIP_RIGHT_INSET * 2),
  );
  const maxContentHeight = Math.min(
    PIP_MAX_CONTENT_HEIGHT,
    Math.max(
      PIP_MIN_CONTENT_HEIGHT,
      workArea.height - PIP_HEADER_HEIGHT - PIP_TOP_INSET - PIP_BOTTOM_INSET,
    ),
  );
  const availableAspect = maxContentWidth / maxContentHeight;
  let contentWidth;
  let contentHeight;
  if (aspect >= availableAspect) {
    contentWidth = maxContentWidth;
    contentHeight = Math.round(contentWidth / aspect);
  } else {
    contentHeight = maxContentHeight;
    contentWidth = Math.round(contentHeight * aspect);
  }
  contentWidth = Math.max(PIP_MIN_CONTENT_WIDTH, contentWidth);
  contentHeight = Math.max(PIP_MIN_CONTENT_HEIGHT, contentHeight);
  return {
    width: contentWidth,
    height: contentHeight + PIP_HEADER_HEIGHT,
    contentWidth,
    contentHeight,
    aspectRatio: contentWidth / contentHeight,
  };
}

function normalizedBounds(value, display) {
  const workArea = displayWorkArea(display);
  const width = Math.min(
    Math.max(PIP_MIN_CONTENT_WIDTH, Math.round(Number(value?.width) || PIP_MAX_CONTENT_WIDTH)),
    workArea.width,
  );
  const height = Math.min(
    Math.max(
      PIP_HEADER_HEIGHT + PIP_MIN_CONTENT_HEIGHT,
      Math.round(Number(value?.height) || PIP_HEADER_HEIGHT + 202),
    ),
    workArea.height,
  );
  const defaultX = workArea.x + workArea.width - width - PIP_RIGHT_INSET;
  const defaultY = workArea.y + PIP_TOP_INSET;
  const x = clamp(
    Math.round(Number.isFinite(Number(value?.x)) ? Number(value.x) : defaultX),
    workArea.x,
    workArea.x + workArea.width - width,
  );
  const y = clamp(
    Math.round(Number.isFinite(Number(value?.y)) ? Number(value.y) : defaultY),
    workArea.y,
    workArea.y + workArea.height - height,
  );
  return { x, y, width, height };
}

function anchoredBounds(value, mainBounds, display) {
  const bounds = normalizedBounds(value, display);
  if (!mainBounds) return bounds;
  const workArea = displayWorkArea(display);
  const preferredX = Number(mainBounds.x) + Number(mainBounds.width) - bounds.width - PIP_RIGHT_INSET;
  const preferredY = Number(mainBounds.y) + PIP_TOP_INSET;
  return {
    x: clamp(Math.round(preferredX), workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(Math.round(preferredY), workArea.y, workArea.y + workArea.height - bounds.height),
    width: bounds.width,
    height: bounds.height,
  };
}

function previewStackBounds(sizes, mainBounds, display) {
  if (!Array.isArray(sizes) || !sizes.length) return [];
  const workArea = displayWorkArea(display);
  const parentBounds = mainBounds || workArea;
  const right = clamp(
    Number(parentBounds.x) + Number(parentBounds.width) - PIP_RIGHT_INSET,
    workArea.x,
    workArea.x + workArea.width,
  );
  const top = clamp(
    Number(parentBounds.y) + PIP_TOP_INSET,
    workArea.y,
    workArea.y + workArea.height - 1,
  );
  const bottom = clamp(
    Number(parentBounds.y) + Number(parentBounds.height) - PIP_BOTTOM_INSET,
    top + 1,
    workArea.y + workArea.height,
  );
  const availableHeight = Math.max(1, bottom - top);
  const contentHeight = sizes.reduce(
    (total, size) => total + Math.max(1, Number(size.height) - PIP_HEADER_HEIGHT),
    0,
  );
  const fixedHeight = sizes.length * PIP_HEADER_HEIGHT + (sizes.length - 1) * PIP_STACK_GAP;
  const scale = Math.min(1, Math.max(0.42, (availableHeight - fixedHeight) / contentHeight));
  const scaled = sizes.map((size) => {
    const previewWidth = Math.max(1, Math.round(Number(size.width) * scale));
    const previewContentHeight = Math.max(
      1,
      Math.round((Number(size.height) - PIP_HEADER_HEIGHT) * scale),
    );
    return {
      width: previewWidth,
      height: previewContentHeight + PIP_HEADER_HEIGHT,
    };
  });
  const scaledHeight = scaled.reduce((total, size) => total + size.height, 0);
  const naturalTotal = scaledHeight + (scaled.length - 1) * PIP_STACK_GAP;
  const step = scaled.length > 1 && naturalTotal > availableHeight
    ? Math.max(PIP_HEADER_HEIGHT - 4, (availableHeight - scaled.at(-1).height) / (scaled.length - 1))
    : null;
  let y = top;
  return scaled.map((size, index) => {
    const x = clamp(
      Math.round(right - size.width),
      workArea.x,
      workArea.x + workArea.width - size.width,
    );
    const bounds = { x, y: Math.round(y), width: size.width, height: size.height };
    y += step === null ? size.height + PIP_STACK_GAP : step;
    return bounds;
  });
}

function createComputerPipController({
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  productRoot,
  getMainWindow = () => null,
  getExcludedWindows = () => [],
  stopTask = async () => false,
  platform = process.platform,
  env = process.env,
  streamRetryDelayMs = PIP_STREAM_RETRY_DELAY_MS,
  turnCloseDelayMs = PIP_TURN_CLOSE_DELAY_MS,
  toolIdleCloseDelayMs = 30_000,
} = {}) {
  let stateRevision = 0;
  let anchorTimer = null;
  let activeTaskId = null;
  let activeSessionId = null;
  let activePreviewId = null;
  let previewSequence = 0;
  let activitySequence = 0;
  let closeSequence = 0;
  const previews = new Map();
  const suppressedTargets = new Set();
  const endedOwners = new Set();
  const closeTimers = new Map();
  const toolCalls = new Map();
  const windowsById = new Map();
  const windowsByPid = new Map();
  const parentWindowBindings = [];
  const enabled = platform === 'darwin' && env.METEOMATE_CUA_PIP !== '0';

  function ownerKey(value = {}) {
    if (value.taskId) return `task:${value.taskId}`;
    if (value.sessionId) return `session:${value.sessionId}`;
    return '';
  }

  function toolCallKey(value = {}) {
    const toolCallId = String(value.toolCallId || '').trim();
    if (!toolCallId) return '';
    return `${String(value.taskId || '')}:${String(value.sessionId || '')}:${toolCallId}`;
  }

  function sameOwner(entry, value = {}) {
    if (value.taskId) return entry.taskId === value.taskId;
    if (value.sessionId) return entry.sessionId === value.sessionId;
    return false;
  }

  function clearOwnerCloseTimer(value = {}) {
    const key = ownerKey(value);
    const scheduled = key ? closeTimers.get(key) : null;
    if (!scheduled) return;
    clearTimeout(scheduled.timer);
    closeTimers.delete(key);
  }

  function clearAllCloseTimers() {
    for (const scheduled of closeTimers.values()) clearTimeout(scheduled.timer);
    closeTimers.clear();
  }

  function activePreview() {
    return previews.get(activePreviewId)
      || [...previews.values()].sort((left, right) => right.lastActive - left.lastActive)[0]
      || null;
  }

  function publicState(entry = activePreview()) {
    return {
      revision: stateRevision,
      visible: Boolean(entry?.window && !entry.window.isDestroyed() && entry.window.isVisible()),
      previewCount: previews.size,
      taskId: entry?.taskId || activeTaskId,
      sessionId: entry?.sessionId || activeSessionId,
      sourceId: entry?.source?.id || '',
      sourceName: entry?.source?.name || '',
      appIcon: entry?.source?.appIcon || '',
      appName: entry?.source?.appName || entry?.target?.appName || entry?.source?.name || '目标应用',
      windowTitle: entry?.source?.windowTitle || entry?.target?.title || entry?.source?.name || '',
      windowId: entry?.target?.windowId || null,
      capturedWindowId: entry?.source?.capturedWindowId || null,
      pid: entry?.target?.pid || null,
      action: entry?.action || '正在连接目标窗口',
      status: entry?.status || 'idle',
      error: entry?.error || '',
      fallbackImage: entry?.fallbackImage || '',
    };
  }

  function sendState(entry) {
    if (!entry) return;
    stateRevision += 1;
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('computer-pip:state', publicState(entry));
    }
  }

  function requestLivePreview(entry) {
    if (!entry?.source?.id || !entry.window || entry.window.isDestroyed()) return;
    const sourceId = JSON.stringify(entry.source.id);
    void entry.window.webContents
      .executeJavaScript(`window.meteoComputerPipStartPreview?.(${sourceId})`, true)
      .catch(() => {});
  }

  function setStatusUnlessLive(entry, status) {
    if (entry.status !== 'live') entry.status = status;
  }

  function clearStreamRetry(entry) {
    if (!entry?.streamRetryTimer) return;
    clearTimeout(entry.streamRetryTimer);
    entry.streamRetryTimer = null;
  }

  function scheduleStreamRetry(entry) {
    if (!entry || !previews.has(entry.id) || entry.streamRetryTimer) return;
    entry.streamRetryTimer = setTimeout(() => {
      entry.streamRetryTimer = null;
      if (!previews.has(entry.id) || !entry.window || entry.window.isDestroyed()) return;
      if (entry.source?.id) requestLivePreview(entry);
      else resolveEntrySource(entry);
    }, streamRetryDelayMs);
  }

  function mainWindowDisplay(mainBounds) {
    if (typeof screen.getDisplayMatching === 'function') return screen.getDisplayMatching(mainBounds);
    return screen.getDisplayNearestPoint({
      x: mainBounds.x + Math.round(mainBounds.width / 2),
      y: mainBounds.y + Math.round(mainBounds.height / 2),
    });
  }

  function displayForPreviews() {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindowDisplay(mainWindow.getBounds());
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  function sortedPreviews() {
    return [...previews.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  function layoutPreviews() {
    const entries = sortedPreviews().filter((entry) => entry.window && !entry.window.isDestroyed());
    if (!entries.length) return;
    const mainWindow = getMainWindow();
    const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const display = mainBounds ? mainWindowDisplay(mainBounds) : displayForPreviews();
    const boundsList = previewStackBounds(entries.map((entry) => entry.size), mainBounds, display);
    entries.forEach((entry, index) => {
      entry.window.setBounds(boundsList[index], false);
    });
  }

  function scheduleLayout() {
    clearTimeout(anchorTimer);
    anchorTimer = setTimeout(layoutPreviews, 16);
  }

  function detachParentWindow() {
    while (parentWindowBindings.length) parentWindowBindings.pop()();
  }

  function attachParentWindow(mainWindow) {
    if (parentWindowBindings.length) return;
    const bind = (event, listener) => {
      mainWindow.on(event, listener);
      parentWindowBindings.push(() => mainWindow.removeListener(event, listener));
    };
    const show = () => {
      layoutPreviews();
      for (const entry of previews.values()) {
        if (entry.window && !entry.window.isDestroyed()) entry.window.showInactive();
      }
    };
    for (const event of [
      'resize',
      'maximize',
      'unmaximize',
      'enter-full-screen',
      'leave-full-screen',
    ]) {
      bind(event, scheduleLayout);
    }
    bind('restore', show);
    bind('show', show);
    bind('closed', () => close());
  }

  function releaseParentWindowIfUnused() {
    if (!previews.size) detachParentWindow();
  }

  function availableSlot() {
    const used = new Set([...previews.values()].map((entry) => entry.slot));
    for (let slot = 1; slot <= PIP_MAX_WINDOWS; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  function removePreview(entry, { suppress = false, relayout = true } = {}) {
    if (!entry || !previews.has(entry.id)) return;
    clearStreamRetry(entry);
    if (suppress) {
      const key = ownerKey(entry);
      for (const windowId of entry.targetWindowIds) {
        if (key) suppressedTargets.add(`${key}:${windowId}`);
      }
    }
    previews.delete(entry.id);
    entry.removing = true;
    if (entry.window && !entry.window.isDestroyed()) entry.window.destroy();
    entry.window = null;
    if (activePreviewId === entry.id) {
      activePreviewId = [...previews.values()]
        .sort((left, right) => right.lastActive - left.lastActive)[0]?.id || null;
    }
    releaseParentWindowIfUnused();
    if (relayout) layoutPreviews();
  }

  function removeLeastRecentlyActive() {
    const victim = [...previews.values()]
      .sort((left, right) => left.lastActive - right.lastActive)[0];
    if (!victim) return null;
    const slot = victim.slot;
    removePreview(victim, { relayout: false });
    return slot;
  }

  function createWindow(entry) {
    if (!enabled || entry.window) return entry.window;
    const mainWindow = getMainWindow();
    const hasMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
    const display = hasMainWindow
      ? mainWindowDisplay(mainWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    entry.size = preferredPreviewSize(entry.target?.bounds, display);
    const initialBounds = anchoredBounds(entry.size, hasMainWindow ? mainWindow.getBounds() : null, display);
    entry.window = new BrowserWindow({
      ...initialBounds,
      ...(hasMainWindow ? { parent: mainWindow } : {}),
      modal: false,
      minWidth: PIP_MIN_CONTENT_WIDTH,
      minHeight: PIP_HEADER_HEIGHT + PIP_MIN_CONTENT_HEIGHT,
      maxWidth: PIP_MAX_CONTENT_WIDTH,
      maxHeight: PIP_HEADER_HEIGHT + PIP_MAX_CONTENT_HEIGHT,
      title: 'MeteoMate 桌面操作',
      frame: false,
      transparent: true,
      hasShadow: true,
      movable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(productRoot, 'computer-pip-preload.cjs'),
        partition: `meteomate-computer-pip-${entry.slot}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (typeof entry.window.setExcludedFromShownWindowsMenu === 'function') {
      entry.window.setExcludedFromShownWindowsMenu(true);
    }
    if (typeof entry.window.setAspectRatio === 'function') {
      entry.window.setAspectRatio(entry.size.aspectRatio, { width: 0, height: PIP_HEADER_HEIGHT });
    }
    if (hasMainWindow) attachParentWindow(mainWindow);
    entry.window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      if (!request.videoRequested || !entry.source?.id) {
        callback({});
        return;
      }
      callback({
        video: {
          id: entry.source.id,
          name: entry.source.name || 'MeteoMate desktop operation',
        },
      });
    });
    entry.window.webContents.on('did-finish-load', () => {
      sendState(entry);
      requestLivePreview(entry);
    });
    entry.window.loadFile(path.join(productRoot, 'computer-pip.html'));
    entry.window.on('closed', () => {
      if (!entry.removing && previews.has(entry.id)) {
        previews.delete(entry.id);
        if (activePreviewId === entry.id) activePreviewId = null;
        releaseParentWindowIfUnused();
        layoutPreviews();
      }
      entry.window = null;
    });
    return entry.window;
  }

  async function excludedSourceIds() {
    const excluded = new Set();
    const mainWindow = getMainWindow();
    let additionalWindows = [];
    try {
      const candidates = getExcludedWindows();
      if (Array.isArray(candidates)) additionalWindows = candidates;
    } catch {
      additionalWindows = [];
    }
    const windows = [
      mainWindow,
      ...[...previews.values()].map((entry) => entry.window),
      ...additionalWindows,
    ];
    for (const window of windows) {
      if (!window || window.isDestroyed() || typeof window.getMediaSourceId !== 'function') continue;
      try {
        excluded.add(await window.getMediaSourceId());
      } catch {
        // A preview can disappear while sources are being enumerated.
      }
    }
    return excluded;
  }

  async function resolveSource(target) {
    if (!target?.windowId) return null;
    const excluded = await excludedSourceIds();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: true,
    });
    const candidates = sources
      .filter((candidate) => !excluded.has(candidate.id))
      .map((source) => {
        const windowId = parseMediaSourceWindowId(source.id);
        return { source, windowId, record: windowsById.get(windowId) || null };
      })
      .filter((candidate) =>
        candidate.windowId === target.windowId
        || (target.pid && candidate.record?.pid === target.pid)
      );
    if (!candidates.length) return null;

    const exact = candidates.find((candidate) => candidate.windowId === target.windowId);
    const sameProcess = candidates
      .filter((candidate) => candidate.record?.pid === target.pid)
      .sort((left, right) =>
        Number(right.record?.isOnScreen) - Number(left.record?.isOnScreen)
        || Number(right.record?.onCurrentSpace) - Number(left.record?.onCurrentSpace)
        || windowArea(right.record) - windowArea(left.record)
        || Number(right.record?.zIndex || 0) - Number(left.record?.zIndex || 0)
      );
    const exactIsUseful = exact && (
      windowArea(exact.record || target) >= 16_000
      || sameProcess.length <= 1
    );
    const selected = exactIsUseful ? exact : sameProcess[0] || exact;
    if (!selected) return null;
    const source = selected.source;
    const record = selected.record || target;
    return {
      id: source.id,
      name: source.name || record.title || record.appName || '目标窗口',
      appIcon: safeIconDataUrl(source),
      appName: record.appName || target.appName || '',
      windowTitle: record.title || source.name || target.title || '',
      capturedWindowId: selected.windowId,
      bounds: record.bounds || target.bounds || null,
    };
  }

  function rememberWindow(target) {
    if (!target?.windowId || !target?.pid) return;
    const existing = windowsById.get(target.windowId) || {};
    const merged = {
      ...existing,
      ...target,
      appName: target.appName || existing.appName || '',
      title: target.title || existing.title || '',
      bounds: target.bounds || existing.bounds || null,
      isOnScreen: target.isOnScreen ?? existing.isOnScreen ?? null,
      onCurrentSpace: target.onCurrentSpace ?? existing.onCurrentSpace ?? null,
      zIndex: target.zIndex ?? existing.zIndex ?? null,
    };
    windowsById.set(merged.windowId, merged);
    const candidates = windowsByPid.get(merged.pid) || [];
    windowsByPid.set(
      merged.pid,
      [merged, ...candidates.filter((candidate) => candidate.windowId !== merged.windowId)]
        .sort((left, right) => Number(right.isOnScreen) - Number(left.isOnScreen)
          || Number(right.onCurrentSpace) - Number(left.onCurrentSpace)
          || Number(right.zIndex || 0) - Number(left.zIndex || 0)),
    );
  }

  function entryForTarget(target, event) {
    if (!target?.windowId) return null;
    return [...previews.values()]
      .find((entry) => sameOwner(entry, event) && entry.targetWindowIds.has(target.windowId))
      || null;
  }

  function enrichTarget(target, owner) {
    if (!target) return null;
    const known = target.windowId ? windowsById.get(target.windowId) : null;
    if (known) {
      return {
        ...known,
        ...target,
        appName: target.appName || known.appName,
        title: target.title || known.title,
        bounds: target.bounds || known.bounds || null,
        isOnScreen: target.isOnScreen ?? known.isOnScreen ?? null,
        onCurrentSpace: target.onCurrentSpace ?? known.onCurrentSpace ?? null,
        zIndex: target.zIndex ?? known.zIndex ?? null,
      };
    }
    if (!target.windowId && target.pid) {
      const recent = [...previews.values()]
        .sort((left, right) => right.lastActive - left.lastActive)
        .find((entry) => sameOwner(entry, owner) && entry.target?.pid === target.pid)?.target;
      const samePid = recent || windowsByPid.get(target.pid)?.[0];
      if (samePid) return { ...samePid, ...target, windowId: samePid.windowId };
    }
    return target;
  }

  function updatePreviewSize(entry, bounds) {
    if (!entry || !bounds) return;
    const size = preferredPreviewSize(bounds, displayForPreviews());
    if (
      entry.size
      && Math.abs(entry.size.aspectRatio - size.aspectRatio) < 0.01
      && entry.size.width === size.width
      && entry.size.height === size.height
    ) return;
    entry.size = size;
    if (entry.window && !entry.window.isDestroyed() && typeof entry.window.setAspectRatio === 'function') {
      entry.window.setAspectRatio(size.aspectRatio, { width: 0, height: PIP_HEADER_HEIGHT });
    }
    layoutPreviews();
  }

  function mergeDuplicateSource(entry) {
    if (!entry?.source?.id) return entry;
    const duplicate = [...previews.values()]
      .find((candidate) =>
        candidate.id !== entry.id
        && candidate.taskId === entry.taskId
        && candidate.sessionId === entry.sessionId
        && candidate.source?.id === entry.source.id
      );
    if (!duplicate) return entry;
    for (const windowId of entry.targetWindowIds) duplicate.targetWindowIds.add(windowId);
    for (const callKey of entry.toolCallKeys) duplicate.toolCallKeys.add(callKey);
    duplicate.target = entry.target;
    duplicate.toolCallId = entry.toolCallId;
    duplicate.action = entry.action;
    if (entry.status === 'live' || duplicate.status !== 'live') {
      duplicate.status = entry.status;
    }
    duplicate.error = entry.error;
    duplicate.lastActive = entry.lastActive;
    activePreviewId = duplicate.id;
    removePreview(entry, { relayout: false });
    updatePreviewSize(duplicate, duplicate.source.bounds || duplicate.target.bounds);
    sendState(duplicate);
    layoutPreviews();
    return duplicate;
  }

  function resolveEntrySource(entry) {
    entry.sourceResolution = (entry.sourceResolution || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const source = await resolveSource(entry.target);
        if (!previews.has(entry.id)) return;
        entry.source = source;
        if (source?.capturedWindowId) entry.targetWindowIds.add(source.capturedWindowId);
        const nextStatus = source
          ? entry.fallbackImage ? 'snapshot' : 'connecting'
          : entry.fallbackImage ? 'snapshot' : 'unavailable';
        setStatusUnlessLive(entry, nextStatus);
        entry.error = source || entry.status === 'live'
          ? ''
          : '暂时无法捕获目标窗口，操作仍在后台继续';
        if (source?.bounds) updatePreviewSize(entry, source.bounds);
        const resolvedEntry = mergeDuplicateSource(entry);
        sendState(resolvedEntry);
        requestLivePreview(resolvedEntry);
      })
      .catch((error) => {
        if (!previews.has(entry.id)) return;
        entry.source = null;
        entry.status = 'unavailable';
        entry.error = error?.message || '目标窗口捕获失败';
        sendState(entry);
      });
  }

  function openForTarget(target, event) {
    if (!enabled || !target?.windowId || !ownerKey(event)) return null;
    const enriched = enrichTarget(target, event);
    const eventOwnerKey = ownerKey(event);
    if (suppressedTargets.has(`${eventOwnerKey}:${enriched.windowId}`)) return null;
    rememberWindow(enriched);
    let entry = entryForTarget(enriched, event);
    if (!entry) {
      let slot = availableSlot();
      if (!slot) slot = removeLeastRecentlyActive();
      entry = {
        id: `preview-${++previewSequence}`,
        slot,
        taskId: event.taskId || null,
        sessionId: event.sessionId || null,
        target: enriched,
        targetWindowIds: new Set([enriched.windowId]),
        source: null,
        toolCallId: null,
        toolCallKeys: new Set(),
        action: '',
        status: 'connecting',
        error: '',
        fallbackImage: '',
        size: null,
        window: null,
        sourceResolution: Promise.resolve(),
        streamRetryTimer: null,
        createdAt: previewSequence,
        lastActive: 0,
        removing: false,
      };
      previews.set(entry.id, entry);
      createWindow(entry);
    } else {
      entry.target = {
        ...entry.target,
        ...enriched,
        appName: enriched.appName || entry.target.appName,
        title: enriched.title || entry.target.title,
      };
      entry.removing = false;
    }
    const callKey = toolCallKey(event);
    entry.toolCallId = event.toolCallId || entry.toolCallId;
    if (callKey) {
      entry.toolCallKeys.delete(callKey);
      entry.toolCallKeys.add(callKey);
      while (entry.toolCallKeys.size > 64) {
        entry.toolCallKeys.delete(entry.toolCallKeys.values().next().value);
      }
    }
    entry.action = actionLabel(event.toolName || event.title, event.status);
    setStatusUnlessLive(entry, entry.fallbackImage ? 'snapshot' : 'connecting');
    entry.error = '';
    entry.lastActive = ++activitySequence;
    activePreviewId = entry.id;
    clearOwnerCloseTimer(entry);
    entry.window?.showInactive();
    if (typeof entry.window?.moveTop === 'function') entry.window.moveTop();
    updatePreviewSize(entry, entry.source?.bounds || entry.target.bounds);
    layoutPreviews();
    sendState(entry);
    if (!entry.source) resolveEntrySource(entry);
    return entry;
  }

  function destroyAllPreviews() {
    for (const entry of [...previews.values()]) removePreview(entry, { relayout: false });
    activePreviewId = null;
    detachParentWindow();
  }

  function destroyOwnerPreviews(owner) {
    for (const entry of [...previews.values()]) {
      if (sameOwner(entry, owner)) removePreview(entry, { relayout: false });
    }
    for (const [key, toolCall] of toolCalls) {
      if (sameOwner(toolCall, owner)) toolCalls.delete(key);
    }
    layoutPreviews();
  }

  function scheduleOwnerClose(owner, delayMs) {
    const key = ownerKey(owner);
    if (!key) return;
    clearOwnerCloseTimer(owner);
    const generation = ++closeSequence;
    const timer = setTimeout(() => {
      const scheduled = closeTimers.get(key);
      if (!scheduled || scheduled.generation !== generation) return;
      closeTimers.delete(key);
      destroyOwnerPreviews(owner);
    }, delayMs);
    closeTimers.set(key, { generation, timer });
  }

  function close({ immediate = true, taskId = null, sessionId = null } = {}) {
    const owner = { taskId, sessionId };
    if (!ownerKey(owner)) {
      clearAllCloseTimers();
      destroyAllPreviews();
      toolCalls.clear();
      return;
    }
    if (immediate) {
      clearOwnerCloseTimer(owner);
      destroyOwnerPreviews(owner);
    } else {
      scheduleOwnerClose(owner, turnCloseDelayMs);
    }
  }

  function scheduleIdleClose(owner) {
    const hasRunningCall = [...toolCalls.values()].some((toolCall) => sameOwner(toolCall, owner));
    if (!hasRunningCall) scheduleOwnerClose(owner, toolIdleCloseDelayMs);
  }

  function rememberedToolCall(event) {
    const exact = toolCalls.get(toolCallKey(event));
    if (exact) return exact;
    const matches = [...toolCalls.values()]
      .filter((toolCall) =>
        toolCall.toolCallId === event.toolCallId
        && (!event.taskId || toolCall.taskId === event.taskId)
        && (!event.sessionId || toolCall.sessionId === event.sessionId)
      );
    return matches.length === 1 ? matches[0] : {};
  }

  function handleToolStarted(event) {
    if (!isComputerEvent(event)) return;
    const eventOwnerKey = ownerKey(event);
    if (eventOwnerKey && endedOwners.has(eventOwnerKey)) return;
    clearOwnerCloseTimer(event);
    const toolName = normalizedToolName(event.toolName || event.title);
    const target = enrichTarget(extractTarget(event.rawInput), event);
    const callKey = toolCallKey(event);
    if (callKey) {
      toolCalls.set(callKey, {
        taskId: event.taskId || null,
        sessionId: event.sessionId || null,
        toolCallId: event.toolCallId,
        toolName,
        target,
      });
    }
    if (!target?.windowId || PASSIVE_TOOLS.has(toolName)) return;
    openForTarget(target, { ...event, toolName });
  }

  function handleToolUpdated(event) {
    const remembered = rememberedToolCall(event);
    if (!isComputerEvent(event) && !remembered.toolName) return;
    const eventOwnerKey = ownerKey(event);
    if (eventOwnerKey && endedOwners.has(eventOwnerKey)) return;
    clearOwnerCloseTimer(event);
    const toolName = normalizedToolName(event.toolName || event.title || remembered.toolName);
    const records = collectWindowRecords([
      event.structuredContent,
      event.rawOutput,
      event.content,
      event.result,
    ]);
    records.forEach(rememberWindow);
    const target = enrichTarget(
      extractTarget(event.rawInput)
      || remembered.target,
      event,
    );
    if (target?.windowId && !PASSIVE_TOOLS.has(toolName)) {
      const entry = openForTarget(target, { ...event, toolName });
      if (entry) {
        entry.toolCallId = event.toolCallId || entry.toolCallId;
        entry.action = actionLabel(toolName, event.status);
        entry.error = TERMINAL_TOOL_STATUSES.has(String(event.status || '').toLowerCase())
          && ['failed', 'cancelled', 'canceled'].includes(String(event.status || '').toLowerCase())
          ? '本次桌面操作未完成'
          : entry.error;
        sendState(entry);
      }
    }
    if (TERMINAL_TOOL_STATUSES.has(String(event.status || '').toLowerCase())) {
      const callKey = toolCallKey(event);
      if (callKey) toolCalls.delete(callKey);
      if (previews.size && (!eventOwnerKey || !endedOwners.has(eventOwnerKey))) {
        scheduleIdleClose(event);
      }
    }
  }

  function previewForToolCall(event) {
    const callKey = toolCallKey(event);
    if (!callKey) return null;
    return [...previews.values()]
      .find((entry) => entry.toolCallKeys.has(callKey)) || null;
  }

  function handleRuntimeEvent(event = {}) {
    switch (event.type) {
      case 'turn_started':
        activeTaskId = event.taskId || null;
        activeSessionId = event.sessionId || null;
        clearOwnerCloseTimer(event);
        for (const targetKey of suppressedTargets) {
          if (targetKey.startsWith(`${ownerKey(event)}:`)) suppressedTargets.delete(targetKey);
        }
        endedOwners.delete(ownerKey(event));
        break;
      case 'tool_call_started':
        activeTaskId = event.taskId || activeTaskId;
        activeSessionId = event.sessionId || activeSessionId;
        handleToolStarted(event);
        break;
      case 'tool_call_updated':
        activeTaskId = event.taskId || activeTaskId;
        activeSessionId = event.sessionId || activeSessionId;
        handleToolUpdated(event);
        break;
      case 'team_member_activity': {
        activeTaskId = event.taskId || activeTaskId;
        activeSessionId = event.sessionId || activeSessionId;
        const activity = {
          ...event,
          ...(event.activity || {}),
          toolCallId: event.activity?.id || event.toolCallId,
        };
        if (!toolCalls.has(toolCallKey(activity)) && activity.rawInput) handleToolStarted(activity);
        handleToolUpdated(activity);
        break;
      }
      case 'permission_requested': {
        const permissionEntry = previewForToolCall(event);
        if (!permissionEntry && !isComputerEvent(event.toolCall || {})) break;
        if (!permissionEntry) break;
        setStatusUnlessLive(permissionEntry, 'waiting');
        permissionEntry.action = '等待桌面操作授权';
        sendState(permissionEntry);
        break;
      }
      case 'permission_resolved': {
        const entry = previewForToolCall(event);
        if (entry) {
          setStatusUnlessLive(entry, entry.fallbackImage ? 'snapshot' : 'connecting');
          entry.action = '正在继续桌面操作';
          sendState(entry);
        }
        break;
      }
      case 'artifact_created': {
        const entry = previewForToolCall(event);
        if (
          entry
          && event.artifact?.metadata?.source === 'acp-computer-image'
          && typeof event.artifact.path === 'string'
        ) {
          try {
            const stat = fs.statSync(event.artifact.path);
            if (stat.isFile() && stat.size > 0 && stat.size <= 25 * 1024 * 1024) {
              const mediaType = String(event.artifact.mediaType || 'image/png');
              entry.fallbackImage = `data:${mediaType};base64,${fs.readFileSync(event.artifact.path).toString('base64')}`;
              if (entry.status !== 'live') {
                entry.status = 'snapshot';
                entry.action = '显示最近一次窗口快照';
                entry.error = '';
              }
              sendState(entry);
            }
          } catch {
            // The live stream remains the primary preview when an artifact disappears.
          }
        }
        break;
      }
      case 'turn_completed':
      case 'turn_failed':
      case 'turn_cancelled':
        {
          const eventOwnerKey = ownerKey(event);
          if (eventOwnerKey) {
            endedOwners.add(eventOwnerKey);
            while (endedOwners.size > 64) endedOwners.delete(endedOwners.values().next().value);
          }
          if (previews.size && [...previews.values()].some((entry) => sameOwner(entry, event))) {
            close({
              immediate: false,
              taskId: event.taskId || null,
              sessionId: event.sessionId || null,
            });
          }
        }
        break;
      default:
        break;
    }
  }

  function focusMainWindow() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  async function handleControl(action, entry = activePreview()) {
    if (action === 'close') {
      removePreview(entry, { suppress: true });
      return true;
    }
    if (action === 'return') {
      focusMainWindow();
      return true;
    }
    if (action === 'stop') {
      for (const preview of [...previews.values()].filter((candidate) => sameOwner(candidate, entry))) {
        preview.status = 'stopping';
        preview.action = '正在停止任务';
        sendState(preview);
      }
      return stopTask({ taskId: entry.taskId, sessionId: entry.sessionId });
    }
    return false;
  }

  function entryForSender(sender) {
    return [...previews.values()]
      .find((entry) => entry.window && !entry.window.isDestroyed() && sender === entry.window.webContents)
      || null;
  }

  ipcMain.handle('computer-pip:state', (event) => {
    const entry = entryForSender(event.sender);
    return entry ? publicState(entry) : null;
  });
  ipcMain.handle('computer-pip:control', (event, action) => {
    const entry = entryForSender(event.sender);
    if (!entry) return false;
    return handleControl(String(action || ''), entry);
  });
  ipcMain.handle('computer-pip:dimensions', (event, dimensions) => {
    const entry = entryForSender(event.sender);
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!entry || !Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
      return false;
    }
    updatePreviewSize(entry, { width, height });
    return true;
  });
  ipcMain.handle('computer-pip:stream-status', (event, report = {}) => {
    const entry = entryForSender(event.sender);
    if (
      !entry
      || !entry.source?.id
      || String(report.sourceId || '') !== entry.source.id
      || !['live', 'unavailable'].includes(String(report.status || ''))
    ) {
      return false;
    }
    const nextStatus = report.status === 'live'
      ? 'live'
      : entry.fallbackImage ? 'snapshot' : 'unavailable';
    const reportedError = String(report.error || '').trim().slice(0, 240);
    const nextError = nextStatus === 'unavailable'
      ? reportedError || '目标窗口暂不可见'
      : '';
    if (nextStatus === 'live') clearStreamRetry(entry);
    else scheduleStreamRetry(entry);
    if (entry.status === nextStatus && entry.error === nextError) return true;
    entry.status = nextStatus;
    entry.error = nextError;
    sendState(entry);
    return true;
  });

  return Object.freeze({
    close,
    enabled,
    handleControl,
    handleRuntimeEvent,
    publicState,
  });
}

module.exports = {
  CUA_EXTENSION_ID,
  PIP_HEADER_HEIGHT,
  PIP_MAX_WINDOWS,
  PIP_STREAM_RETRY_DELAY_MS,
  PIP_TURN_CLOSE_DELAY_MS,
  actionLabel,
  anchoredBounds,
  collectAcpImages,
  collectWindowRecords,
  computerUsePromptInstruction,
  createComputerPipController,
  createToolIdentityTracker,
  extractTarget,
  isComputerEvent,
  normalizedBounds,
  normalizedToolName,
  parseMediaSourceWindowId,
  preferredPreviewSize,
  previewStackBounds,
};
