const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const activeRuns = new Map();

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

function resolveGooseBinary() {
  const candidates = [];
  if (process.env.GOOSE_BINARY) candidates.push(process.env.GOOSE_BINARY);

  const binaryName = process.platform === 'win32' ? 'goose.exe' : 'goose';
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', binaryName));
    candidates.push(path.join(process.resourcesPath, binaryName));
  } else {
    candidates.push(path.resolve(__dirname, '..', '..', 'target', 'release', binaryName));
    candidates.push(path.resolve(__dirname, '..', '..', 'target', 'debug', binaryName));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return findExecutableInPath('goose');
}

function stripAnsi(value) {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

function sendTaskEvent(sender, taskId, event) {
  if (!sender.isDestroyed()) sender.send('task:event', { taskId, ...event });
}

function buildPrompt(request) {
  const workspaceRule = request.allowFileTools
    ? `\nYou may use file tools only inside this workspace: ${request.workspace || '(not selected)'}. Before changing files, summarize the intended changes. Do not access credentials, browser data, SSH keys, or directories outside the workspace.`
    : '\nDo not modify local files or run system commands. Return analysis and proposed deliverables in the response only.';

  return [
    `You are ${request.expertName}, a meteorological office assistant.`,
    request.expertInstruction,
    'Use concise Chinese suitable for operational meteorological work. Separate observed facts, algorithm results, assumptions, and recommendations. Never fabricate weather observations or model data.',
    workspaceRule,
    '\nUser task:',
    request.prompt.trim(),
  ].join('\n');
}

function runMockTask(sender, request) {
  const taskId = request.taskId;
  let cancelled = false;
  const timers = [];
  const chunks = [
    '演示模式：当前未调用真实 Goose 模型。\n',
    `已选择专家：${request.expertName}\n`,
    request.workspace ? `工作区：${request.workspace}\n` : '工作区：未选择（只生成分析建议）\n',
    '\n任务拆解\n1. 读取任务目标与约束\n2. 组织气象分析结构\n3. 生成可交付的办公成果建议\n',
    '\n示例结果\n- 形势概述：请接入气象数据 MCP 后生成基于实况和模式场的结论。\n- 风险区域：待算法服务返回结构化风险评分。\n- 成果物：建议生成 Word 预报稿、PPT 汇报和对应天气图。\n',
    '\n下一步：配置 Goose Provider，或接入 weather-data / artifact MCP 后运行真实任务。\n',
  ];

  sendTaskEvent(sender, taskId, { type: 'started', mode: 'mock' });
  chunks.forEach((chunk, index) => {
    const timer = setTimeout(() => {
      if (cancelled) return;
      sendTaskEvent(sender, taskId, { type: 'stdout', data: chunk });
      if (index === chunks.length - 1) {
        sendTaskEvent(sender, taskId, { type: 'completed', exitCode: 0, mode: 'mock' });
        activeRuns.delete(taskId);
      }
    }, 260 + index * 420);
    timers.push(timer);
  });

  activeRuns.set(taskId, {
    cancel() {
      cancelled = true;
      timers.forEach(clearTimeout);
      sendTaskEvent(sender, taskId, { type: 'cancelled' });
      activeRuns.delete(taskId);
    },
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1180,
    minHeight: 720,
    title: '气象智伴',
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => window.show());

  if (process.env.METEO_DESKTOP_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.handle('runtime:status', async () => {
  const binary = resolveGooseBinary();
  return {
    available: Boolean(binary),
    binary,
    mockForced: process.env.METEO_DESKTOP_MOCK === '1',
    platform: process.platform,
  };
});

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择气象项目工作区',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('workspace:open', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const error = await shell.openPath(targetPath);
  return error === '';
});

ipcMain.handle('task:run', async (event, request) => {
  if (!request || typeof request !== 'object') throw new Error('Invalid task request');
  if (!request.taskId || !request.prompt || !request.expertName || !request.expertInstruction) {
    throw new Error('Task request is missing required fields');
  }
  if (activeRuns.has(request.taskId)) throw new Error('Task is already running');

  const binary = resolveGooseBinary();
  if (process.env.METEO_DESKTOP_MOCK === '1' || !binary) {
    runMockTask(event.sender, request);
    return { accepted: true, mode: 'mock' };
  }

  const args = ['run', '--no-session', '--max-turns', '24'];
  if (request.allowFileTools) args.push('--with-builtin', 'developer');
  args.push('-t', buildPrompt(request));

  const childEnv = {
    ...process.env,
    GOOSE_CONTEXT_STRATEGY: process.env.GOOSE_CONTEXT_STRATEGY || 'summarize',
    GOOSE_DISABLE_SESSION_NAMING: 'true',
    NO_COLOR: '1',
  };
  if (request.allowFileTools) childEnv.GOOSE_MODE = 'auto';

  const child = spawn(binary, args, {
    cwd: request.workspace || os.homedir(),
    windowsHide: true,
    shell: false,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sendTaskEvent(event.sender, request.taskId, { type: 'started', mode: 'goose', pid: child.pid });

  child.stdout.on('data', (data) => {
    sendTaskEvent(event.sender, request.taskId, { type: 'stdout', data: stripAnsi(data.toString()) });
  });
  child.stderr.on('data', (data) => {
    sendTaskEvent(event.sender, request.taskId, { type: 'stderr', data: stripAnsi(data.toString()) });
  });
  child.on('error', (error) => {
    sendTaskEvent(event.sender, request.taskId, { type: 'error', message: error.message });
    activeRuns.delete(request.taskId);
  });
  child.on('close', (exitCode, signal) => {
    sendTaskEvent(event.sender, request.taskId, {
      type: 'completed',
      exitCode: exitCode ?? -1,
      signal,
      mode: 'goose',
    });
    activeRuns.delete(request.taskId);
  });

  activeRuns.set(request.taskId, {
    cancel() {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
      } else {
        child.kill('SIGTERM');
      }
      sendTaskEvent(event.sender, request.taskId, { type: 'cancelled' });
      activeRuns.delete(request.taskId);
    },
  });

  return { accepted: true, mode: 'goose', pid: child.pid };
});

ipcMain.handle('task:cancel', async (_event, taskId) => {
  const run = activeRuns.get(taskId);
  if (!run) return false;
  run.cancel();
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const run of activeRuns.values()) run.cancel();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
