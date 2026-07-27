'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
} = require('electron');
const ComputerPip = require('../capabilities/computer-pip-controller.cjs');

const productRoot = path.resolve(__dirname, '..');
const wideImage = process.argv[2] || process.env.METEOMATE_PIP_WIDE_IMAGE;
const tallImage = process.argv[3] || process.env.METEOMATE_PIP_TALL_IMAGE;
let mainWindow = null;
let controller = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: 'MeteoMate PiP Visual QA',
    backgroundColor: '#f4f6fa',
  });
  const content = encodeURIComponent(`
    <!doctype html>
    <html lang="zh-CN">
      <meta charset="UTF-8">
      <style>
        body {
          margin: 0;
          padding: 64px;
          color: #202633;
          font: 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
          background: #f4f6fa;
        }
        h1 { margin: 0 0 12px; font-size: 28px; }
        p { max-width: 560px; color: #687486; line-height: 1.7; }
      </style>
      <body>
        <h1>MeteoMate 实时窗口轨道</h1>
        <p>右上角同时展示横向应用和竖向计算器预览。预览保持目标比例，并作为原生子窗口跟随主窗口。</p>
      </body>
    </html>
  `);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${content}`);
}

function openPreview({ toolCallId, windowId, pid, title, bounds, image }) {
  controller.handleRuntimeEvent({
    type: 'tool_call_started',
    taskId: 'visual-task',
    sessionId: 'visual-session',
    extensionName: 'cua-desktop',
    toolName: 'get_window_state',
    toolCallId,
    status: 'running',
    rawInput: {
      window_id: windowId,
      pid,
      app_name: title,
      title,
      bounds,
    },
  });
  if (!image) return;
  setTimeout(() => {
    controller.handleRuntimeEvent({
      type: 'artifact_created',
      taskId: 'visual-task',
      toolCallId,
      artifact: {
        path: image,
        mediaType: /\.jpe?g$/i.test(image) ? 'image/jpeg' : 'image/png',
        metadata: { source: 'acp-computer-image' },
      },
    });
  }, 240);
}

app.whenReady().then(() => {
  createMainWindow();
  controller = ComputerPip.createComputerPipController({
    app,
    BrowserWindow,
    desktopCapturer,
    ipcMain,
    screen,
    productRoot,
    getMainWindow: () => mainWindow,
    turnCloseDelayMs: 100,
    toolIdleCloseDelayMs: 60_000,
  });
  controller.handleRuntimeEvent({
    type: 'turn_started',
    taskId: 'visual-task',
    sessionId: 'visual-session',
  });
  mainWindow.webContents.once('did-finish-load', () => {
    openPreview({
      toolCallId: 'visual-wide',
      windowId: 999_991,
      pid: 99_991,
      title: 'MeteoMate',
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      image: wideImage,
    });
    setTimeout(() => {
      openPreview({
        toolCallId: 'visual-tall',
        windowId: 999_992,
        pid: 99_992,
        title: '计算器',
        bounds: { x: 0, y: 0, width: 230, height: 408 },
        image: tallImage,
      });
    }, 320);
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => controller?.close());
