'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ComputerPip = require('../capabilities/computer-pip-controller.cjs');

const DISPLAY = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };

assert.equal(ComputerPip.parseMediaSourceWindowId('window:8371:0'), 8371);
assert.equal(ComputerPip.parseMediaSourceWindowId('screen:0:0'), null);
assert.equal(ComputerPip.normalizedToolName('cua-desktop__get_window_state'), 'get_window_state');
assert.equal(ComputerPip.normalizedToolName('server__cua_driver__click'), 'click');
assert.equal(ComputerPip.isComputerEvent({ extensionName: 'cua-desktop' }), true);
assert.equal(ComputerPip.isComputerEvent({ toolName: 'office-artifacts__shell' }), false);
assert.equal(ComputerPip.PIP_TURN_CLOSE_DELAY_MS, 18_000);

const toolIdentityTracker = ComputerPip.createToolIdentityTracker();
assert.deepEqual(
  toolIdentityTracker.resolve('session-1', 'call-1', {
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
  }),
  {
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
  },
);

const fullAccessInstruction = ComputerPip.computerUsePromptInstruction({ fullAccess: true });
assert.match(fullAccessInstruction, /get_accessibility_tree/);
assert.match(fullAccessInstruction, /禁止猜测 window_id/);
assert.match(fullAccessInstruction, /无需再次请求审批/);
assert.deepEqual(
  toolIdentityTracker.resolve('session-1', 'call-1', {
    extensionName: null,
    toolName: null,
  }),
  {
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
  },
);
assert.deepEqual(
  ComputerPip.collectAcpImages({
    content: [
      { type: 'text', text: 'window state' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    ],
  }),
  [{
    type: 'image',
    mimeType: 'image/png',
    data: 'data:image/png;base64,iVBORw0KGgo=',
  }],
);
assert.deepEqual(
  ComputerPip.collectAcpImages({
    type: 'image',
    mimeType: 'image/jpeg',
    data: '/9j/4AAQ',
  }),
  [{
    type: 'image',
    mimeType: 'image/jpeg',
    data: '/9j/4AAQ',
  }],
);
assert.deepEqual(
  ComputerPip.collectAcpImages({
    type: 'image_url',
    image_url: { url: 'https://example.com/window.png' },
  }),
  [],
);

assert.deepEqual(
  ComputerPip.extractTarget({ pid: 321, window_id: 987 }),
  {
    pid: 321,
    windowId: 987,
    appName: '',
    title: '',
    bounds: null,
    isOnScreen: null,
    onCurrentSpace: null,
    zIndex: null,
  },
);
assert.equal(
  ComputerPip.extractTarget('{"structuredContent":{"pid":321,"window_id":987}}').windowId,
  987,
);

const records = ComputerPip.collectWindowRecords({
  structuredContent: {
    windows: [
      {
        window_id: 987,
        pid: 321,
        app_name: 'TextEdit',
        title: 'Forecast.txt',
        bounds: { x: 20, y: 20, width: 66, height: 20 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 8,
      },
      {
        window_id: 986,
        pid: 321,
        app_name: 'TextEdit',
        title: 'Forecast editor',
        bounds: { x: 20, y: 20, width: 640, height: 480 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 7,
      },
      {
        window_id: 1473,
        pid: 444,
        app_name: 'Calculator',
        title: 'Calculator',
        bounds: { x: 800, y: 160, width: 216, height: 385 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 6,
      },
      {
        window_id: 2222,
        pid: 555,
        app_name: 'Safari',
        title: 'Weather dashboard',
        bounds: { x: 300, y: 200, width: 1000, height: 700 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 5,
      },
      {
        window_id: 3333,
        pid: 666,
        app_name: 'Notes',
        title: 'Observations',
        bounds: { x: 500, y: 200, width: 700, height: 900 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 4,
      },
      {
        window_id: 4444,
        pid: 777,
        app_name: 'Mail',
        title: 'Forecast review',
        bounds: { x: 400, y: 180, width: 900, height: 620 },
        is_on_screen: true,
        on_current_space: true,
        z_index: 3,
      },
    ],
  },
});

assert.deepEqual(
  ComputerPip.preferredPreviewSize({ width: 216, height: 385 }, DISPLAY),
  {
    width: 168,
    height: 332,
    contentWidth: 168,
    contentHeight: 300,
    aspectRatio: 0.56,
  },
);
assert.deepEqual(
  ComputerPip.preferredPreviewSize({ width: 640, height: 480 }, DISPLAY),
  {
    width: 320,
    height: 272,
    contentWidth: 320,
    contentHeight: 240,
    aspectRatio: 4 / 3,
  },
);
assert.deepEqual(
  ComputerPip.previewStackBounds(
    [
      ComputerPip.preferredPreviewSize({ width: 640, height: 480 }, DISPLAY),
      ComputerPip.preferredPreviewSize({ width: 216, height: 385 }, DISPLAY),
    ],
    { x: 100, y: 100, width: 1200, height: 800 },
    DISPLAY,
  ),
  [
    { x: 964, y: 172, width: 320, height: 272 },
    { x: 1116, y: 452, width: 168, height: 332 },
  ],
);

function runtimeWindowRecord(record) {
  return {
    window_id: record.windowId,
    pid: record.pid,
    app_name: record.appName,
    title: record.title,
    bounds: record.bounds,
    is_on_screen: record.isOnScreen,
    on_current_space: record.onCurrentSpace,
    z_index: record.zIndex,
  };
}

function sourceFor(record) {
  return {
    id: `window:${record.windowId}:0`,
    name: record.title,
    appIcon: {
      isEmpty: () => false,
      toDataURL: () => `data:image/png;base64,${Buffer.from(record.appName).toString('base64')}`,
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function assertActiveStreamWinsOverSnapshot() {
  class ClassList {
    constructor() {
      this.values = new Set();
    }

    add(...names) {
      names.forEach((name) => this.values.add(name));
    }

    contains(name) {
      return this.values.has(name);
    }

    remove(...names) {
      names.forEach((name) => this.values.delete(name));
    }

    toggle(name, force) {
      if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
      else this.values.delete(name);
    }
  }

  const element = (id) => ({
    id,
    classList: new ClassList(),
    className: '',
    textContent: '',
    title: '',
    disabled: false,
    src: '',
    srcObject: null,
    videoWidth: 460,
    videoHeight: 816,
    addEventListener() {},
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
    async play() {},
  });
  const elementIds = [
    'preview-video',
    'fallback-image',
    'placeholder',
    'placeholder-title',
    'state-badge',
    'state-label',
    'app-icon',
    'window-label',
    'stop-button',
    'close-button',
    'return-button',
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [id, element(id)]));
  const reports = [];
  let stateHandler = null;
  let mediaCalls = 0;
  let resolveMedia;
  const pendingMedia = new Promise((resolve) => {
    resolveMedia = resolve;
  });
  const track = { addEventListener() {}, stop() {} };
  const activeStream = {
    active: true,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  const initialState = {
    sourceId: 'window:1473:0',
    status: 'live',
    windowTitle: '计算器',
    fallbackImage: '',
  };
  const context = {
    document: { getElementById: (id) => elements[id] },
    navigator: {
      mediaDevices: {
        async getDisplayMedia() {
          mediaCalls += 1;
          return pendingMedia;
        },
      },
    },
    window: {
      addEventListener() {},
      meteoComputerPip: {
        async control() {},
        async getState() {
          return initialState;
        },
        onStateChange(callback) {
          stateHandler = callback;
        },
        async reportDimensions() {},
        async reportStreamStatus(report) {
          reports.push(report);
        },
      },
    },
  };

  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '..', 'computer-pip.js'), 'utf8'),
    context,
    { filename: 'computer-pip.js' },
  );
  await flush();
  const directStart = context.window.meteoComputerPipStartPreview(initialState.sourceId);
  stateHandler({
    ...initialState,
    status: 'connecting',
  });
  await flush();
  assert.equal(mediaCalls, 1);
  resolveMedia(activeStream);
  await directStart;
  await flush();
  assert.equal(elements['state-label'].textContent, '实时');
  assert.equal(elements['preview-video'].classList.contains('visible'), true);
  assert.equal(elements['fallback-image'].classList.contains('visible'), false);

  await stateHandler({
    ...initialState,
    status: 'snapshot',
    fallbackImage: 'data:image/png;base64,c25hcHNob3Q=',
  });
  await flush();

  assert.equal(activeStream.active, true);
  assert.equal(mediaCalls, 1);
  assert.equal(elements['state-label'].textContent, '实时');
  assert.equal(elements['preview-video'].classList.contains('visible'), true);
  assert.equal(elements['fallback-image'].classList.contains('visible'), false);
  assert.ok(reports.every((report) => report.status === 'live'));

  await stateHandler({
    ...initialState,
    status: 'stopping',
    fallbackImage: 'data:image/png;base64,c25hcHNob3Q=',
  });
  await flush();

  assert.equal(elements['state-label'].textContent, '停止中');
  assert.equal(elements['stop-button'].disabled, true);
  assert.equal(elements['preview-video'].classList.contains('visible'), true);
  assert.equal(elements['fallback-image'].classList.contains('visible'), false);
}

async function run() {
  await assertActiveStreamWinsOverSnapshot();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-computer-pip-'));
  const handlers = new Map();
  const sentStates = [];
  const sources = records
    .filter((record) => ![987, 4444].includes(record.windowId))
    .map(sourceFor);

  class FakeWindow {
    static instances = [];

    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.listeners = new Map();
      this.executedScripts = [];
      this.webContents = {
        executeJavaScript: async (script) => {
          this.executedScripts.push(script);
          return true;
        },
        on: (name, callback) => {
          if (name === 'did-finish-load') this.didFinishLoad = callback;
        },
        send: (channel, state) => {
          assert.equal(channel, 'computer-pip:state');
          sentStates.push({ sender: this.webContents, state });
        },
        session: {
          setDisplayMediaRequestHandler: (handler) => {
            this.displayMediaHandler = handler;
          },
        },
      };
      FakeWindow.instances.push(this);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.listeners.get('closed')?.();
    }

    getBounds() { return this.bounds; }
    getMediaSourceId() {
      return Promise.resolve(`window:${9000 + FakeWindow.instances.indexOf(this)}:0`);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile(file) { this.loadedFile = file; }
    moveTop() { this.movedTop = true; }
    on(name, callback) { this.listeners.set(name, callback); }
    setAspectRatio(ratio, extraSize) { this.aspectRatio = { ratio, extraSize }; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setExcludedFromShownWindowsMenu(value) { this.excludedFromWindowMenu = value; }
    showInactive() { this.visible = true; }
  }

  class FakeMainWindow {
    constructor() {
      this.bounds = { x: 100, y: 100, width: 1200, height: 800 };
      this.listeners = new Map();
      this.minimized = false;
    }

    emit(name) {
      if (name === 'minimize') {
        this.minimized = true;
        for (const window of FakeWindow.instances.filter((entry) => !entry.destroyed)) {
          window.visible = false;
        }
      }
      if (name === 'restore') this.minimized = false;
      this.listeners.get(name)?.();
    }
    focus() { this.focused = true; }
    getBounds() { return this.bounds; }
    getMediaSourceId() { return Promise.resolve('window:111:0'); }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    on(name, callback) { this.listeners.set(name, callback); }
    removeListener(name, callback) {
      if (this.listeners.get(name) === callback) this.listeners.delete(name);
    }
    restore() { this.minimized = false; }
    show() { this.shown = true; }
  }

  const mainWindow = new FakeMainWindow();
  let stoppedRequest = null;
  const controller = ComputerPip.createComputerPipController({
    app: { getPath: () => temp },
    BrowserWindow: FakeWindow,
    desktopCapturer: { getSources: async () => sources },
    ipcMain: {
      handle(channel, callback) { handlers.set(channel, callback); },
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 20, y: 20 }),
      getDisplayNearestPoint: () => DISPLAY,
      getDisplayMatching: () => DISPLAY,
    },
    productRoot: path.resolve(__dirname, '..'),
    getMainWindow: () => mainWindow,
    stopTask: async (request) => {
      stoppedRequest = request;
      return true;
    },
    platform: 'darwin',
    env: {},
    streamRetryDelayMs: 5,
    turnCloseDelayMs: 5,
    toolIdleCloseDelayMs: 5_000,
  });

  assert.equal(controller.enabled, true);
  controller.handleRuntimeEvent({ type: 'turn_started', taskId: 'task-1', sessionId: 'session-1' });
  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'get_accessibility_tree',
    toolCallId: 'call-discovery',
    status: 'running',
    rawInput: {},
  });
  controller.handleRuntimeEvent({
    type: 'tool_call_updated',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'get_accessibility_tree',
    toolCallId: 'call-discovery',
    status: 'completed',
    rawOutput: {
      windows: [{
        window_id: 1968,
        pid: 403,
        app_name: 'Finder',
        title: 'linux-aarch64',
        bounds: { x: 100, y: 100, width: 900, height: 600 },
      }],
    },
  });
  await flush();
  assert.equal(FakeWindow.instances.length, 0);

  controller.handleRuntimeEvent({
    type: 'tool_call_updated',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'list_windows',
    toolCallId: 'call-list',
    status: 'completed',
    structuredContent: { windows: records.map(runtimeWindowRecord) },
  });
  assert.equal(FakeWindow.instances.length, 0);

  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
    toolCallId: 'call-text',
    status: 'running',
    rawInput: { pid: 321, window_id: 987 },
  });
  await flush();

  const textPreview = FakeWindow.instances[0];
  assert.equal(textPreview.visible, true);
  assert.equal(textPreview.options.parent, mainWindow);
  assert.equal(textPreview.options.modal, false);
  assert.equal(textPreview.options.movable, false);
  assert.equal(textPreview.options.resizable, false);
  assert.equal(textPreview.options.transparent, true);
  assert.equal(textPreview.options.webPreferences.partition, 'meteomate-computer-pip-1');
  assert.equal(textPreview.excludedFromWindowMenu, true);
  assert.deepEqual(textPreview.bounds, { x: 964, y: 172, width: 320, height: 272 });
  assert.equal(controller.publicState().sourceId, 'window:986:0');
  assert.equal(controller.publicState().appName, 'TextEdit');
  assert.equal(controller.publicState().windowTitle, 'Forecast editor');
  assert.equal(controller.publicState().windowId, 987);
  assert.equal(controller.publicState().capturedWindowId, 986);
  assert.equal(controller.publicState().status, 'connecting');
  assert.equal(controller.publicState().previewCount, 1);
  assert.ok(sentStates.some(({ state }) => state.sourceId === 'window:986:0'));

  let grantedStreams = null;
  textPreview.displayMediaHandler(
    { videoRequested: true },
    (streams) => { grantedStreams = streams; },
  );
  assert.deepEqual(grantedStreams, {
    video: {
      id: 'window:986:0',
      name: 'Forecast editor',
    },
  });

  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'click',
    toolCallId: 'call-calc',
    status: 'running',
    rawInput: { pid: 444, window_id: 1473 },
  });
  await flush();

  const calculatorPreview = FakeWindow.instances[1];
  assert.equal(calculatorPreview.options.webPreferences.partition, 'meteomate-computer-pip-2');
  assert.deepEqual(calculatorPreview.bounds, { x: 1116, y: 452, width: 168, height: 332 });
  assert.equal(controller.publicState().sourceId, 'window:1473:0');
  assert.equal(controller.publicState().previewCount, 2);
  calculatorPreview.displayMediaHandler(
    { videoRequested: true },
    (streams) => { grantedStreams = streams; },
  );
  assert.deepEqual(grantedStreams.video, { id: 'window:1473:0', name: 'Calculator' });

  const textState = await handlers.get('computer-pip:state')({ sender: textPreview.webContents });
  let calculatorState = await handlers.get('computer-pip:state')({
    sender: calculatorPreview.webContents,
  });
  assert.equal(textState.windowId, 987);
  assert.equal(calculatorState.windowId, 1473);
  assert.equal(await handlers.get('computer-pip:state')({ sender: {} }), null);
  assert.equal(
    await handlers.get('computer-pip:stream-status')(
      { sender: calculatorPreview.webContents },
      { sourceId: 'window:1473:0', status: 'unavailable' },
    ),
    true,
  );
  calculatorState = await handlers.get('computer-pip:state')({
    sender: calculatorPreview.webContents,
  });
  assert.equal(calculatorState.status, 'unavailable');
  const previewAttemptsBeforeRetry = calculatorPreview.executedScripts.length;
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.ok(
    calculatorPreview.executedScripts.length > previewAttemptsBeforeRetry,
    'unavailable live preview should retry automatically',
  );
  assert.equal(
    await handlers.get('computer-pip:stream-status')(
      { sender: calculatorPreview.webContents },
      { sourceId: 'window:1473:0', status: 'live' },
    ),
    true,
  );
  calculatorState = await handlers.get('computer-pip:state')({
    sender: calculatorPreview.webContents,
  });
  assert.equal(calculatorState.status, 'live');

  const liveScreenshotPath = path.join(temp, 'live-computer-screenshot.png');
  fs.writeFileSync(liveScreenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  controller.handleRuntimeEvent({
    type: 'artifact_created',
    taskId: 'task-1',
    sessionId: 'session-1',
    toolCallId: 'call-calc',
    artifact: {
      path: liveScreenshotPath,
      mediaType: 'image/png',
      metadata: { source: 'acp-computer-image' },
    },
  });
  calculatorState = await handlers.get('computer-pip:state')({
    sender: calculatorPreview.webContents,
  });
  assert.equal(calculatorState.status, 'live');
  assert.match(calculatorState.fallbackImage, /^data:image\/png;base64,/);

  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
    toolCallId: 'call-calc-again',
    status: 'running',
    rawInput: { pid: 444, window_id: 1473 },
  });
  calculatorState = await handlers.get('computer-pip:state')({
    sender: calculatorPreview.webContents,
  });
  assert.equal(calculatorState.status, 'live');

  assert.equal(
    await handlers.get('computer-pip:dimensions')(
      { sender: calculatorPreview.webContents },
      { width: 216, height: 385 },
    ),
    true,
  );
  assert.equal(
    await handlers.get('computer-pip:dimensions')({ sender: {} }, { width: 216, height: 385 }),
    false,
  );

  mainWindow.emit('minimize');
  assert.equal(textPreview.visible, false);
  assert.equal(calculatorPreview.visible, false);
  mainWindow.bounds = { x: 140, y: 120, width: 1100, height: 720 };
  mainWindow.emit('restore');
  assert.equal(textPreview.visible, true);
  assert.equal(calculatorPreview.visible, true);
  const restoredBounds = ComputerPip.previewStackBounds(
    [
      ComputerPip.preferredPreviewSize({ width: 640, height: 480 }, DISPLAY),
      ComputerPip.preferredPreviewSize({ width: 216, height: 385 }, DISPLAY),
    ],
    mainWindow.bounds,
    DISPLAY,
  );
  assert.deepEqual(textPreview.bounds, restoredBounds[0]);
  assert.deepEqual(calculatorPreview.bounds, restoredBounds[1]);

  await handlers.get('computer-pip:control')({ sender: textPreview.webContents }, 'close');
  assert.equal(textPreview.destroyed, true);
  assert.equal(calculatorPreview.destroyed, false);
  assert.equal(controller.publicState().previewCount, 1);
  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-1',
    sessionId: 'session-1',
    extensionName: 'cua-desktop',
    toolName: 'click',
    toolCallId: 'call-text-again',
    status: 'running',
    rawInput: { pid: 321, window_id: 987 },
  });
  await flush();
  assert.equal(FakeWindow.instances.length, 2);

  for (const [windowId, pid, toolCallId] of [
    [2222, 555, 'call-safari'],
    [3333, 666, 'call-notes'],
    [4444, 777, 'call-mail'],
  ]) {
    controller.handleRuntimeEvent({
      type: 'tool_call_started',
      taskId: 'task-1',
      sessionId: 'session-1',
      extensionName: 'cua-desktop',
      toolName: 'click',
      toolCallId,
      status: 'running',
      rawInput: { pid, window_id: windowId },
    });
    await flush();
  }
  assert.equal(controller.publicState().previewCount, ComputerPip.PIP_MAX_WINDOWS);
  assert.equal(calculatorPreview.destroyed, true);
  const alivePreviews = FakeWindow.instances.filter((entry) => !entry.destroyed);
  assert.equal(alivePreviews.length, 3);
  assert.deepEqual(
    new Set(alivePreviews.map((entry) => entry.options.webPreferences.partition)),
    new Set([
      'meteomate-computer-pip-1',
      'meteomate-computer-pip-2',
      'meteomate-computer-pip-3',
    ]),
  );

  const previewStates = await Promise.all(alivePreviews.map(async (entry) => ({
    entry,
    state: await handlers.get('computer-pip:state')({ sender: entry.webContents }),
  })));
  const mailPreview = previewStates.find(({ state }) => state.windowId === 4444)?.entry;
  assert.ok(mailPreview);

  const screenshotPath = path.join(temp, 'computer-screenshot.png');
  fs.writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  controller.handleRuntimeEvent({
    type: 'artifact_created',
    taskId: 'task-1',
    sessionId: 'session-1',
    toolCallId: 'call-mail',
    artifact: {
      path: screenshotPath,
      mediaType: 'image/png',
      metadata: { source: 'acp-computer-image' },
    },
  });
  let mailState = await handlers.get('computer-pip:state')({ sender: mailPreview.webContents });
  assert.match(mailState.fallbackImage, /^data:image\/png;base64,/);
  assert.equal(mailState.status, 'snapshot');

  controller.handleRuntimeEvent({
    type: 'turn_started',
    taskId: 'task-2',
    sessionId: 'session-2',
  });
  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'task-2',
    sessionId: 'session-2',
    extensionName: 'cua-desktop',
    toolName: 'click',
    toolCallId: 'call-task-2',
    status: 'running',
    rawInput: { pid: 444, window_id: 1473 },
  });
  await flush();
  const taskTwoPreview = FakeWindow.instances.at(-1);
  const taskTwoState = await handlers.get('computer-pip:state')({
    sender: taskTwoPreview.webContents,
  });
  assert.equal(taskTwoState.taskId, 'task-2');

  controller.handleRuntimeEvent({
    type: 'permission_requested',
    taskId: 'task-1',
    sessionId: 'session-1',
    toolCallId: 'call-mail',
    toolCall: { title: 'cua-desktop__click' },
  });
  mailState = await handlers.get('computer-pip:state')({ sender: mailPreview.webContents });
  assert.equal(mailState.status, 'waiting');
  assert.notEqual(
    (await handlers.get('computer-pip:state')({ sender: taskTwoPreview.webContents })).status,
    'waiting',
  );
  controller.handleRuntimeEvent({
    type: 'permission_resolved',
    taskId: 'task-1',
    sessionId: 'session-1',
    toolCallId: 'call-mail',
  });
  mailState = await handlers.get('computer-pip:state')({ sender: mailPreview.webContents });
  assert.equal(mailState.status, 'snapshot');

  await handlers.get('computer-pip:control')({ sender: mailPreview.webContents }, 'stop');
  assert.deepEqual(stoppedRequest, { taskId: 'task-1', sessionId: 'session-1' });
  for (const preview of FakeWindow.instances.filter((entry) => !entry.destroyed)) {
    const state = await handlers.get('computer-pip:state')({ sender: preview.webContents });
    assert.equal(state.status === 'stopping', state.taskId === 'task-1');
  }

  controller.handleRuntimeEvent({
    type: 'turn_completed',
    taskId: 'task-1',
    sessionId: 'session-1',
  });
  controller.handleRuntimeEvent({
    type: 'turn_started',
    taskId: 'task-1',
    sessionId: 'session-1',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(mailPreview.destroyed, false);
  controller.handleRuntimeEvent({
    type: 'turn_completed',
    taskId: 'task-1',
    sessionId: 'session-1',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(mailPreview.destroyed, true);
  assert.equal(taskTwoPreview.destroyed, false);
  assert.equal(controller.publicState().previewCount, 1);
  controller.handleRuntimeEvent({
    type: 'turn_completed',
    taskId: 'task-2',
    sessionId: 'session-2',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(FakeWindow.instances.every((entry) => entry.destroyed), true);
  assert.equal(controller.publicState().previewCount, 0);
  fs.rmSync(temp, { recursive: true, force: true });
}

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
assert.ok(mainSource.includes('structuredContent: safeJson(sanitizeAcpPayload(update.structuredContent))'));

run().then(
  () => console.log('MeteoMate Computer Use picture-in-picture tests passed.'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
