const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:net');
const { ReadableStream, WritableStream } = require('node:stream/web');

const activeHeadlessRuns = new Map();
const pendingPermissions = new Map();
let mainWindow = null;

function sendRuntimeEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('runtime:event', payload);
  }
}

function findExecutableInPath(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
}

async function resolveGooseBinary() {
  const candidates = [];
  if (process.env.GOOSE_BINARY) candidates.push(process.env.GOOSE_BINARY);

  try {
    const { resolveGooseBinary: resolveFromSdk } = await import('@aaif/goose-sdk/node');
    candidates.push(resolveFromSdk());
  } catch {
    // The SDK is optional at runtime; fall back to repository and PATH discovery.
  }

  const binaryName = process.platform === 'win32' ? 'goose.exe' : 'goose';
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', binaryName));
    candidates.push(path.join(process.resourcesPath, binaryName));
  } else {
    candidates.push(path.resolve(__dirname, '..', '..', 'target', 'release', binaryName));
    candidates.push(path.resolve(__dirname, '..', '..', 'target', 'debug', binaryName));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // Keep checking other candidates.
    }
  }
  return findExecutableInPath('goose');
}

function stripAnsi(value) {
  return String(value || '').replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  );
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStatus(url, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return true;
    } catch {
      // Server is still starting.
    }
    await delay(120);
  }
  return false;
}

function createWebSocketStream(wsUrl) {
  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);
  const incoming = [];
  const waiters = [];
  let closed = false;

  const wakeOne = () => waiters.shift()?.();
  const wakeAll = () => {
    closed = true;
    while (waiters.length) waiters.shift()?.();
  };

  const openPromise = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('close', () => reject(new Error('ACP WebSocket closed before opening')));
  });

  ws.on('message', (data) => {
    try {
      incoming.push(JSON.parse(data.toString()));
      wakeOne();
    } catch {
      // Ignore malformed transport messages.
    }
  });
  ws.on('close', wakeAll);
  ws.on('error', wakeAll);

  const readable = new ReadableStream({
    async pull(controller) {
      if (!incoming.length && !closed) {
        await new Promise((resolve) => waiters.push(resolve));
      }
      while (incoming.length) controller.enqueue(incoming.shift());
      if (closed && !incoming.length) controller.close();
    },
  });

  const writable = new WritableStream({
    async write(message) {
      await openPromise;
      if (closed || ws.readyState !== WebSocket.OPEN) {
        throw new Error('ACP WebSocket connection lost');
      }
      ws.send(JSON.stringify(message));
    },
    close() {
      ws.close();
    },
    abort() {
      ws.close();
    },
  });

  return {
    readable,
    writable,
    close: () => ws.close(),
  };
}

function contentText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return value.content.map(contentText).join('');
  if (Array.isArray(value)) return value.map(contentText).join('');
  return '';
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function permissionKey(request) {
  return `${request.sessionId}\u0000${request.toolCall?.toolCallId || crypto.randomUUID()}`;
}

function selectedPermissionResponse(request, action) {
  const kindMap = {
    allow_once: 'allow_once',
    always_allow: 'allow_always',
    deny_once: 'reject_once',
    always_deny: 'reject_always',
  };
  const kind = kindMap[action];
  const option = request.options?.find((candidate) => candidate.kind === kind);
  if (!option) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}

class GooseAcpRuntime {
  constructor() {
    this.binary = null;
    this.server = null;
    this.stream = null;
    this.client = null;
    this.initializePromise = null;
    this.sessionTaskMap = new Map();
    this.loadedSessions = new Set();
    this.status = {
      state: 'idle',
      active: 'unknown',
      binaryAvailable: false,
      acpAvailable: false,
      headlessAvailable: false,
      error: null,
    };
  }

  snapshot() {
    return { ...this.status, binary: this.binary };
  }

  emitStatus() {
    sendRuntimeEvent({ type: 'runtime_status', status: this.snapshot() });
  }

  async initialize() {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeInternal().catch((error) => {
      this.status.state = 'degraded';
      this.status.active = this.binary ? 'headless' : 'mock';
      this.status.acpAvailable = false;
      this.status.error = error?.message || String(error);
      this.emitStatus();
      return this.snapshot();
    });
    return this.initializePromise;
  }

  async initializeInternal() {
    this.status.state = 'starting';
    this.status.error = null;
    this.emitStatus();

    this.binary = await resolveGooseBinary();
    this.status.binaryAvailable = Boolean(this.binary);
    this.status.headlessAvailable = Boolean(this.binary);

    if (!this.binary || process.env.METEOMATE_MOCK === '1') {
      this.status.state = 'ready';
      this.status.active = 'mock';
      this.status.acpAvailable = false;
      this.emitStatus();
      return this.snapshot();
    }

    const [{ GooseClient, DEFAULT_GOOSE_MCP_HOST_CAPABILITIES }, { PROTOCOL_VERSION }] =
      await Promise.all([import('@aaif/goose-sdk'), import('@agentclientprotocol/sdk')]);

    const port = await findAvailablePort();
    const secret = crypto.randomBytes(32).toString('hex');
    const args = ['serve', '--platform', 'desktop', '--host', '127.0.0.1', '--port', String(port)];
    const child = spawn(this.binary, args, {
      cwd: os.homedir(),
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GOOSE_SERVER__SECRET_KEY: secret,
        GOOSE_MODE: process.env.METEOMATE_GOOSE_MODE || 'approve',
        GOOSE_CONTEXT_STRATEGY: process.env.GOOSE_CONTEXT_STRATEGY || 'summarize',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.server = child;

    let stderrTail = '';
    child.stderr?.on('data', (data) => {
      stderrTail = `${stderrTail}${stripAnsi(data.toString())}`.slice(-8_000);
    });
    child.on('exit', (code, signal) => {
      this.status.acpAvailable = false;
      this.status.active = this.binary ? 'headless' : 'mock';
      this.status.state = 'degraded';
      this.status.error = `Goose ACP 服务已退出（code=${code}, signal=${signal || 'none'}）`;
      this.client = null;
      this.stream = null;
      this.emitStatus();
    });

    const ready = await waitForStatus(`http://127.0.0.1:${port}/status`, child);
    if (!ready) {
      throw new Error(`Goose ACP 启动超时${stderrTail ? `：${stderrTail.trim()}` : ''}`);
    }

    const wsUrl = `ws://127.0.0.1:${port}/acp?token=${encodeURIComponent(secret)}`;
    this.stream = createWebSocketStream(wsUrl);
    this.client = new GooseClient(
      () => ({
        requestPermission: (request) => this.requestPermission(request),
        sessionUpdate: (notification) => this.handleSessionUpdate(notification),
        unstable_sessionUpdate: (notification) => this.handleGooseUpdate(notification),
      }),
      this.stream
    );

    await this.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      _meta: { 'goose/useLoginShellPath': true },
      clientCapabilities: {
        _meta: {
          goose: {
            mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
            customNotifications: true,
            recipeParameterRequests: false,
          },
        },
      },
      clientInfo: {
        name: 'meteomate-desktop',
        version: '0.2.0-beta.1',
      },
    });

    this.status.state = 'ready';
    this.status.active = 'acp';
    this.status.acpAvailable = true;
    this.status.error = null;
    this.emitStatus();
    return this.snapshot();
  }

  async ensureSession(request) {
    await this.initialize();
    if (!this.client || !this.status.acpAvailable) {
      throw new Error('ACP runtime is unavailable');
    }

    if (request.sessionId) {
      if (!this.loadedSessions.has(request.sessionId)) {
        await this.client.loadSession({
          sessionId: request.sessionId,
          cwd: request.workspace || os.homedir(),
          mcpServers: [],
        });
        this.loadedSessions.add(request.sessionId);
      }
      this.sessionTaskMap.set(request.sessionId, request.taskId);
      return request.sessionId;
    }

    const enabledExtensions = request.allowFileTools
      ? [
          {
            type: 'builtin',
            name: 'developer',
            display_name: 'Developer',
            timeout: 300,
            bundled: true,
          },
        ]
      : [];

    const response = await this.client.newSession({
      cwd: request.workspace || os.homedir(),
      mcpServers: [],
      _meta: {
        client: 'meteomate-desktop',
        enabledExtensions,
      },
    });
    const sessionId = String(response.sessionId);
    this.loadedSessions.add(sessionId);
    this.sessionTaskMap.set(sessionId, request.taskId);
    sendRuntimeEvent({
      type: 'session_started',
      taskId: request.taskId,
      sessionId,
      runtime: 'acp',
    });
    return sessionId;
  }

  async send(request) {
    const sessionId = await this.ensureSession(request);
    const firstTurn = !request.sessionId;
    const prompt = firstTurn
      ? [
          `你是“${request.expertName}”，是 MeteoMate 气象办公工作空间中的专业智能体。`,
          request.expertInstruction,
          '使用清晰、可审计的中文表达。区分实况事实、算法结果、推断、不确定性与建议；不得虚构气象数据。',
          request.allowFileTools
            ? `文件操作仅限用户选择的工作区：${request.workspace || '未选择'}。任何写入、删除、命令执行或工作区外访问都必须请求用户审批。`
            : '当前为只读分析模式，不修改本地文件，不执行系统命令。',
          '',
          `用户任务：${request.prompt}`,
        ].join('\n')
      : request.prompt;

    sendRuntimeEvent({
      type: 'turn_started',
      taskId: request.taskId,
      sessionId,
      runtime: 'acp',
    });

    this.client
      .prompt({
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      })
      .then((response) => {
        sendRuntimeEvent({
          type: 'turn_completed',
          taskId: request.taskId,
          sessionId,
          runtime: 'acp',
          stopReason: response.stopReason,
          response: safeJson(response),
        });
      })
      .catch((error) => {
        sendRuntimeEvent({
          type: 'turn_failed',
          taskId: request.taskId,
          sessionId,
          runtime: 'acp',
          message: error?.message || String(error),
        });
      });

    return { accepted: true, runtime: 'acp', sessionId };
  }

  async cancel({ taskId, sessionId }) {
    if (!sessionId || !this.client) return false;
    for (const [key, pending] of pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        pendingPermissions.delete(key);
        pending.resolve({ outcome: { outcome: 'cancelled' } });
      }
    }
    await this.client.cancel({ sessionId });
    sendRuntimeEvent({ type: 'turn_cancelled', taskId, sessionId, runtime: 'acp' });
    return true;
  }

  requestPermission(request) {
    const key = permissionKey(request);
    const taskId = this.sessionTaskMap.get(request.sessionId) || null;
    return new Promise((resolve) => {
      pendingPermissions.set(key, { request, resolve, taskId });
      sendRuntimeEvent({
        type: 'permission_requested',
        taskId,
        sessionId: request.sessionId,
        permissionId: key,
        toolCall: safeJson(request.toolCall),
        options: safeJson(request.options || []),
      });
    });
  }

  resolvePermission({ permissionId, action }) {
    const pending = pendingPermissions.get(permissionId);
    if (!pending) return false;
    pendingPermissions.delete(permissionId);
    pending.resolve(selectedPermissionResponse(pending.request, action));
    sendRuntimeEvent({
      type: 'permission_resolved',
      taskId: pending.taskId,
      sessionId: pending.request.sessionId,
      permissionId,
      action,
    });
    return true;
  }

  handleSessionUpdate(notification) {
    const taskId = this.sessionTaskMap.get(notification.sessionId);
    if (!taskId) return;
    const update = notification.update || {};
    const common = {
      taskId,
      sessionId: notification.sessionId,
      runtime: 'acp',
      raw: safeJson(update),
    };

    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        sendRuntimeEvent({ ...common, type: 'user_message_delta', text: contentText(update.content) });
        break;
      case 'agent_message_chunk':
        sendRuntimeEvent({ ...common, type: 'assistant_message_delta', text: contentText(update.content) });
        break;
      case 'agent_thought_chunk':
        sendRuntimeEvent({ ...common, type: 'thought_delta', text: contentText(update.content) });
        break;
      case 'tool_call':
        sendRuntimeEvent({
          ...common,
          type: 'tool_call_started',
          toolCallId: update.toolCallId,
          title: update.title || update.name || '调用工具',
          kind: update.kind || 'other',
          status: update.status || 'pending',
          rawInput: safeJson(update.rawInput),
        });
        break;
      case 'tool_call_update':
        sendRuntimeEvent({
          ...common,
          type: 'tool_call_updated',
          toolCallId: update.toolCallId,
          title: update.title,
          status: update.status,
          rawOutput: safeJson(update.rawOutput),
          content: safeJson(update.content),
        });
        break;
      case 'session_info_update':
        sendRuntimeEvent({
          ...common,
          type: 'session_info',
          title: update.title,
          meta: safeJson(update._meta),
        });
        break;
      case 'usage_update':
        sendRuntimeEvent({ ...common, type: 'usage_update', usage: safeJson(update) });
        break;
      default:
        sendRuntimeEvent({ ...common, type: 'session_update' });
    }
  }

  handleGooseUpdate(notification) {
    const taskId = this.sessionTaskMap.get(notification.sessionId);
    if (!taskId) return;
    sendRuntimeEvent({
      type: 'goose_session_update',
      taskId,
      sessionId: notification.sessionId,
      runtime: 'acp',
      update: safeJson(notification.update),
    });
  }

  async shutdown() {
    for (const pending of pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }
    pendingPermissions.clear();
    this.stream?.close();
    this.stream = null;
    this.client = null;

    if (this.server && this.server.exitCode === null) {
      if (process.platform === 'win32' && this.server.pid) {
        spawn('taskkill', ['/pid', String(this.server.pid), '/f', '/t'], { windowsHide: true });
      } else {
        this.server.kill('SIGTERM');
      }
    }
    this.server = null;
  }
}

const acpRuntime = new GooseAcpRuntime();

function buildHeadlessPrompt(request) {
  const recentMessages = Array.isArray(request.transcript)
    ? request.transcript.slice(-10).map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`).join('\n\n')
    : '';

  return [
    `你是“${request.expertName}”，是 MeteoMate 气象办公工作空间中的专业智能体。`,
    request.expertInstruction,
    '使用清晰、可审计的中文表达。区分实况事实、算法结果、推断、不确定性与建议；不得虚构气象数据。',
    '当前运行于 Headless 降级模式，不进行本地文件写入或系统命令执行。',
    recentMessages ? `\n已有对话：\n${recentMessages}` : '',
    `\n本轮用户任务：${request.prompt}`,
  ].join('\n');
}

function runMockTask(request) {
  const taskId = request.taskId;
  let cancelled = false;
  const timers = [];
  const chunks = [
    '当前处于 MeteoMate 演示模式，尚未调用真实 Goose 模型。\n\n',
    `已选择专家：${request.expertName}\n`,
    request.workspace ? `项目工作区：${request.workspace}\n\n` : '项目工作区：未选择\n\n',
    '建议执行计划：\n1. 核验资料时次与数据来源\n2. 调用气象数据和诊断连接器\n3. 生成结构化结论与证据链\n4. 通过 Artifact Service 生成 Word/PDF 成果物\n\n',
    '请先完成 Goose Provider 配置，或接入 weather-data-mcp、weather-diagnosis-mcp 与 artifact-mcp。\n',
  ];

  sendRuntimeEvent({ type: 'turn_started', taskId, runtime: 'mock', sessionId: null });
  chunks.forEach((chunk, index) => {
    const timer = setTimeout(() => {
      if (cancelled) return;
      sendRuntimeEvent({ type: 'assistant_message_delta', taskId, runtime: 'mock', text: chunk });
      if (index === chunks.length - 1) {
        sendRuntimeEvent({ type: 'turn_completed', taskId, runtime: 'mock', sessionId: null });
        activeHeadlessRuns.delete(taskId);
      }
    }, 180 + index * 280);
    timers.push(timer);
  });

  activeHeadlessRuns.set(taskId, {
    cancel() {
      cancelled = true;
      timers.forEach(clearTimeout);
      sendRuntimeEvent({ type: 'turn_cancelled', taskId, runtime: 'mock', sessionId: null });
      activeHeadlessRuns.delete(taskId);
    },
  });

  return { accepted: true, runtime: 'mock', sessionId: null };
}

async function runHeadlessTask(request) {
  await acpRuntime.initialize();
  const binary = acpRuntime.binary || (await resolveGooseBinary());
  if (!binary || process.env.METEOMATE_MOCK === '1') return runMockTask(request);

  if (request.allowFileTools) {
    sendRuntimeEvent({
      type: 'security_notice',
      taskId: request.taskId,
      runtime: 'headless',
      message: 'ACP 不可用，已自动关闭文件工具。Headless 降级模式无法提供逐次审批。',
    });
  }

  const args = ['run', '--no-session', '--max-turns', '24', '-t', buildHeadlessPrompt(request)];
  const child = spawn(binary, args, {
    cwd: request.workspace || os.homedir(),
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      GOOSE_CONTEXT_STRATEGY: process.env.GOOSE_CONTEXT_STRATEGY || 'summarize',
      GOOSE_DISABLE_SESSION_NAMING: 'true',
      GOOSE_MODE: 'chat',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sendRuntimeEvent({
    type: 'turn_started',
    taskId: request.taskId,
    runtime: 'headless',
    sessionId: null,
    pid: child.pid,
  });
  child.stdout.on('data', (data) => {
    sendRuntimeEvent({
      type: 'assistant_message_delta',
      taskId: request.taskId,
      runtime: 'headless',
      text: stripAnsi(data.toString()),
    });
  });
  child.stderr.on('data', (data) => {
    sendRuntimeEvent({
      type: 'runtime_log',
      taskId: request.taskId,
      runtime: 'headless',
      level: 'error',
      text: stripAnsi(data.toString()),
    });
  });
  child.on('error', (error) => {
    sendRuntimeEvent({
      type: 'turn_failed',
      taskId: request.taskId,
      runtime: 'headless',
      message: error.message,
    });
    activeHeadlessRuns.delete(request.taskId);
  });
  child.on('close', (exitCode, signal) => {
    if (exitCode === 0) {
      sendRuntimeEvent({
        type: 'turn_completed',
        taskId: request.taskId,
        runtime: 'headless',
        sessionId: null,
      });
    } else {
      sendRuntimeEvent({
        type: 'turn_failed',
        taskId: request.taskId,
        runtime: 'headless',
        message: `Headless 任务退出（code=${exitCode}, signal=${signal || 'none'}）`,
      });
    }
    activeHeadlessRuns.delete(request.taskId);
  });

  activeHeadlessRuns.set(request.taskId, {
    cancel() {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
      } else {
        child.kill('SIGTERM');
      }
      sendRuntimeEvent({ type: 'turn_cancelled', taskId: request.taskId, runtime: 'headless' });
      activeHeadlessRuns.delete(request.taskId);
    },
  });

  return { accepted: true, runtime: 'headless', sessionId: null, pid: child.pid };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1220,
    minHeight: 760,
    title: '气象智伴 MeteoMate',
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.METEOMATE_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.handle('runtime:status', async () => {
  await acpRuntime.initialize();
  return acpRuntime.snapshot();
});

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 MeteoMate 项目工作区',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('workspace:open', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const error = await shell.openPath(targetPath);
  return error === '';
});

ipcMain.handle('runtime:send', async (_event, request) => {
  if (!request || typeof request !== 'object') throw new Error('Invalid runtime request');
  if (!request.taskId || !request.prompt || !request.expertName || !request.expertInstruction) {
    throw new Error('Runtime request is missing required fields');
  }

  if (request.preferredRuntime !== 'headless') {
    await acpRuntime.initialize();
    if (acpRuntime.status.acpAvailable) {
      return acpRuntime.send(request);
    }
  }
  return runHeadlessTask(request);
});

ipcMain.handle('runtime:cancel', async (_event, request) => {
  if (request?.sessionId && acpRuntime.client) {
    return acpRuntime.cancel(request);
  }
  const run = activeHeadlessRuns.get(request?.taskId);
  if (!run) return false;
  run.cancel();
  return true;
});

ipcMain.handle('runtime:permission', async (_event, request) => {
  if (!request?.permissionId || !request?.action) return false;
  return acpRuntime.resolvePermission(request);
});

app.whenReady().then(() => {
  createWindow();
  void acpRuntime.initialize();
});

app.on('window-all-closed', () => {
  for (const run of activeHeadlessRuns.values()) run.cancel();
  if (process.platform !== 'darwin') {
    void acpRuntime.shutdown();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  void acpRuntime.shutdown();
});
