'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const OfficeRuntime = require('./office-runtime.cjs');

const SCHEMA_VERSION = 'meteomate.office/v1';
const PREVIEW_SCHEMA_VERSION = 'meteomate.preview/v1';
const MAX_WORKER_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LAYER_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.pdf']);
const pendingRenders = new Map();

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest('hex');
}

async function verifiedPreviewFile(workspace, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const workspaceReal = await fs.promises.realpath(workspace);
  const candidate = path.resolve(workspaceReal, relativePath);
  if (!isInside(workspaceReal, candidate)) return null;
  let resolved;
  try {
    resolved = await fs.promises.realpath(candidate);
  } catch {
    return null;
  }
  if (!isInside(workspaceReal, resolved) || path.extname(resolved).toLowerCase() !== '.pdf') return null;
  let handle;
  try {
    handle = await fs.promises.open(resolved, 'r');
    const signature = Buffer.alloc(5);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === signature.length && signature.toString('ascii') === '%PDF-'
      ? resolved
      : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function verifiedPreviewImages(workspace, relativePaths) {
  const workspaceReal = await fs.promises.realpath(workspace);
  const images = [];
  for (const relativePath of Array.isArray(relativePaths) ? relativePaths.slice(0, 200) : []) {
    if (!relativePath || path.isAbsolute(relativePath)) return [];
    const candidate = path.resolve(workspaceReal, relativePath);
    if (!isInside(workspaceReal, candidate) || path.extname(candidate).toLowerCase() !== '.png') return [];
    let resolved;
    try {
      resolved = await fs.promises.realpath(candidate);
      const stat = await fs.promises.stat(resolved);
      if (!isInside(workspaceReal, resolved) || !stat.isFile() || stat.size > 12 * 1024 * 1024) return [];
      const handle = await fs.promises.open(resolved, 'r');
      try {
        const signature = Buffer.alloc(8);
        const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
        if (bytesRead !== 8 || !signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return [];
      } finally {
        await handle.close();
      }
    } catch {
      return [];
    }
    images.push(resolved);
  }
  return images;
}

async function verifiedPreviewTextLayer(workspace, relativePath, sourceHash) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const workspaceReal = await fs.promises.realpath(workspace);
  const candidate = path.resolve(workspaceReal, relativePath);
  if (!isInside(workspaceReal, candidate) || path.extname(candidate).toLowerCase() !== '.json') return null;
  let resolved;
  let document;
  try {
    resolved = await fs.promises.realpath(candidate);
    const stat = await fs.promises.stat(resolved);
    if (!isInside(workspaceReal, resolved) || !stat.isFile() || stat.size > MAX_TEXT_LAYER_BYTES) return null;
    document = JSON.parse(await fs.promises.readFile(resolved, 'utf8'));
  } catch {
    return null;
  }
  if (
    document?.schemaVersion !== 'meteomate.preview-text/v1'
    || document.sourceHash !== sourceHash
    || !Array.isArray(document.pages)
  ) return null;
  let spanCount = 0;
  const pages = [];
  for (const page of document.pages.slice(0, 300)) {
    const pageNumber = Math.round(Number(page?.page));
    const width = Number(page?.width);
    const height = Number(page?.height);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    const spans = [];
    for (const span of Array.isArray(page.spans) ? page.spans : []) {
      if (spanCount >= 150_000) return null;
      const text = String(span?.text || '').replace(/\u0000/g, '').slice(0, 4_000);
      const x = Number(span?.x);
      const y = Number(span?.y);
      const spanWidth = Number(span?.width);
      const spanHeight = Number(span?.height);
      if (!text || ![x, y, spanWidth, spanHeight].every(Number.isFinite)) continue;
      if (x < 0 || y < 0 || spanWidth <= 0 || spanHeight <= 0 || x + spanWidth > width + 1 || y + spanHeight > height + 1) continue;
      spans.push({ text, x, y, width: spanWidth, height: spanHeight });
      spanCount += 1;
    }
    pages.push({ page: pageNumber, width, height, spans });
  }
  return { pages, spanCount, truncated: document.truncated === true };
}

async function cachedPreview(workspace, sourceHash) {
  const manifestPath = path.join(
    workspace,
    '.meteomate',
    'previews',
    sourceHash.slice(0, 24),
    'manifest.json',
  );
  let manifest;
  try {
    const stat = await fs.promises.stat(manifestPath);
    if (!stat.isFile() || stat.size > 256 * 1024) return null;
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  if (
    manifest?.schemaVersion !== PREVIEW_SCHEMA_VERSION
    || manifest.sourceHash !== sourceHash
  ) return null;
  const previewPath = await verifiedPreviewFile(workspace, manifest.previewPath);
  if (!previewPath) return null;
  const thumbnailPaths = await verifiedPreviewImages(workspace, manifest.thumbnails);
  const textLayer = await verifiedPreviewTextLayer(workspace, manifest.textLayerPath, sourceHash);
  if (!textLayer) return null;
  return {
    cached: true,
    pageCount: Number(manifest.pageCount) || null,
    previewPath,
    sourceHash,
    thumbnailPaths,
    textLayer,
  };
}

function workerError(stderr, code, signal) {
  const message = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (message) return message.replace(/^[A-Z_]+:\s*/, '');
  return `Office 预览进程已退出（code=${code ?? 'none'}, signal=${signal || 'none'}）`;
}

function runWorkerTool(
  configuration,
  toolName,
  input,
  { timeoutMs = DEFAULT_TIMEOUT_MS, spawnProcess = spawn } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(configuration.python, [configuration.worker, toolName], {
      cwd: configuration.workspace,
      env: {
        PATH: configuration.path || process.env.PATH || '',
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL || '',
        METEOMATE_OFFICE_WORKSPACE: configuration.workspace,
        METEOMATE_OFFICE_RUNTIME_VERSION: configuration.runtimeVersion,
        METEOMATE_SOFFICE_PATH: configuration.soffice,
        ...(configuration.pythonHome ? { PYTHONHOME: configuration.pythonHome } : {}),
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Office ${toolName} 执行超过 ${Math.ceil(timeoutMs / 1000)} 秒`)));
    }, timeoutMs);
    const append = (current, chunk, label) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length <= MAX_WORKER_OUTPUT_BYTES) return next;
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Office ${toolName} 进程${label}超过限制`)));
      return current;
    };
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk, '输出');
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk, '错误输出');
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(workerError(stderr.toString('utf8'), code, signal)));
          return;
        }
        try {
          resolve(JSON.parse(stdout.toString('utf8')));
        } catch {
          reject(new Error(`Office ${toolName} 进程返回了无效数据`));
        }
      });
    });
    child.stdin.end(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...input }));
  });
}

function runWorker(configuration, input, options = {}) {
  return runWorkerTool(configuration, 'artifact_render', input, options);
}

function runtimeConfiguration(runtime, workspace) {
  const env = runtime?.env || {};
  const python = String(env.METEOMATE_OFFICE_PYTHON || '');
  const worker = String(env.METEOMATE_OFFICE_WORKER || '');
  const soffice = String(env.METEOMATE_SOFFICE_PATH || '');
  if (!python || !worker) throw new Error('Office 预览运行时不完整，请重新安装 MeteoMate');
  if (!soffice || runtime.info?.libreOfficeAvailable === false) {
    throw new Error('Office 预览需要 LibreOffice Runtime，请重新打包或安装运行时');
  }
  return {
    path: env.PATH,
    python,
    pythonHome: env.PYTHONHOME,
    runtimeVersion: env.METEOMATE_OFFICE_RUNTIME_VERSION || '1.3.0',
    soffice,
    worker,
    workspace,
  };
}

async function resolveDocxSelection({
  sourcePath,
  sourceHash,
  selectedText,
  workspace,
  productRoot,
  allowSystemFallback = true,
  resolveRuntime = OfficeRuntime.resolveOfficeRuntime,
  executeWorker = runWorkerTool,
} = {}) {
  const source = await fs.promises.realpath(String(sourcePath || ''));
  const workspaceReal = await fs.promises.realpath(String(workspace || ''));
  if (!isInside(workspaceReal, source)) throw new Error('DOCX 选区来源已超出当前授权工作区');
  if (!(await fs.promises.stat(source)).isFile() || path.extname(source).toLowerCase() !== '.docx') {
    return { editable: false, status: 'reference_only', reason: '当前格式仅供引用' };
  }
  const expectedSourceHash = String(sourceHash || '');
  if (!/^[a-f0-9]{64}$/i.test(expectedSourceHash)) throw new Error('DOCX 选区缺少有效源文件校验值');
  if (await sha256File(source) !== expectedSourceHash) {
    throw new Error('DOCX 文件已发生变化，请重新选择原文');
  }
  const runtime = resolveRuntime({ productRoot, allowSystemFallback });
  const relativeSource = path.relative(workspaceReal, source).split(path.sep).join('/');
  const result = await executeWorker(
    runtimeConfiguration(runtime, workspaceReal),
    'docx_resolve_selection',
    {
      workspaceId: path.basename(workspaceReal),
      sourcePath: relativeSource,
      sourceHash: expectedSourceHash,
      selectedText: String(selectedText || ''),
    },
  );
  return {
    editable: result?.editable === true,
    status: result?.editable === true ? 'editable' : 'reference_only',
    reason: String(result?.reason || (result?.editable === true ? '可精确修改' : '当前选区仅供引用')),
    ...(result?.editable === true && result?.anchor ? { anchor: result.anchor } : {}),
  };
}

async function renderOfficePreview({
  sourcePath,
  workspace,
  productRoot,
  allowSystemFallback = true,
  resolveRuntime = OfficeRuntime.resolveOfficeRuntime,
  executeWorker = runWorker,
} = {}) {
  const source = await fs.promises.realpath(String(sourcePath || ''));
  const workspaceReal = await fs.promises.realpath(String(workspace || ''));
  if (!isInside(workspaceReal, source)) throw new Error('Office 预览文件已超出当前授权工作区');
  if (!(await fs.promises.stat(source)).isFile()) throw new Error('Office 预览目标不是文件');
  const extension = path.extname(source).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('当前仅支持 DOCX、PPTX、XLSX 和 PDF 预览；旧版 DOC/PPT 请先另存为新版格式');
  }
  const sourceHash = await sha256File(source);
  const cached = await cachedPreview(workspaceReal, sourceHash);
  if (cached) return cached;

  const cacheKey = `${workspaceReal}:${sourceHash}`;
  if (pendingRenders.has(cacheKey)) return pendingRenders.get(cacheKey);
  const rendering = (async () => {
    const runtime = resolveRuntime({ productRoot, allowSystemFallback });
    const relativeSource = path.relative(workspaceReal, source).split(path.sep).join('/');
    const result = await executeWorker(
      runtimeConfiguration(runtime, workspaceReal),
      { workspaceId: path.basename(workspaceReal), sourcePath: relativeSource, dpi: 144 },
    );
    const render = result?.render || result?.artifact?.metadata?.render;
    if (render?.sourceHash && render.sourceHash !== sourceHash) {
      throw new Error('Office 文件在预览生成过程中发生变化，请重试');
    }
    const previewPath = await verifiedPreviewFile(workspaceReal, render?.previewPath);
    if (!previewPath) throw new Error('Office Runtime 未生成有效的 PDF 预览');
    const thumbnailPaths = await verifiedPreviewImages(workspaceReal, render?.thumbnails);
    const textLayer = await verifiedPreviewTextLayer(workspaceReal, render?.textLayerPath, sourceHash);
    if (!textLayer) throw new Error('Office Runtime 未生成有效的语义文本层');
    return {
      cached: false,
      pageCount: Number(render.pageCount) || null,
      previewPath,
      sourceHash: String(render.sourceHash || sourceHash),
      thumbnailPaths,
      textLayer,
    };
  })();
  pendingRenders.set(cacheKey, rendering);
  try {
    return await rendering;
  } finally {
    pendingRenders.delete(cacheKey);
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  SUPPORTED_EXTENSIONS,
  cachedPreview,
  renderOfficePreview,
  resolveDocxSelection,
  runWorker,
  runWorkerTool,
  sha256File,
  verifiedPreviewImages,
  verifiedPreviewTextLayer,
};
