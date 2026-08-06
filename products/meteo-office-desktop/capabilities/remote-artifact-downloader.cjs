'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const SafeWorkspace = require('./safe-workspace.cjs');
const SecurityMode = require('./security-mode.cjs');

const OFFICE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.pdf']);
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_ARTIFACTS_PER_TURN = 3;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function isOfficeProductRequest(prompt) {
  const text = String(prompt || '').toLowerCase();
  const asksForOutput = /生成|制作|创建|导出|下载|产出|编制|出一份|做一份/.test(text);
  const namesOfficeProduct = /\b(?:word|docx|ppt|pptx|powerpoint|excel|xlsx|pdf)\b|文档|演示文稿|表格|办公产品|产品/.test(text);
  return asksForOutput && namesOfficeProduct;
}

function officeExtension(url) {
  try {
    return path.extname(decodeURIComponent(url.pathname)).toLowerCase();
  } catch {
    return path.extname(url.pathname).toLowerCase();
  }
}

function validateRemoteUrl(input, securityMode, options = {}) {
  const url = input instanceof URL ? new URL(input.href) : new URL(String(input || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 产品地址');
  if (url.username || url.password) throw new Error('产品地址不得包含身份凭据');
  if (url.href.length > 8_192) throw new Error('产品地址过长');
  if (options.requireOfficeExtension !== false && !OFFICE_EXTENSIONS.has(officeExtension(url))) {
    throw new Error('地址不是受支持的 Office 产品');
  }
  if (SecurityMode.isStrictSecurityMode(securityMode) && url.protocol !== 'https:') {
    throw new Error('严格安全模式仅允许通过 HTTPS 下载产品');
  }
  return url;
}

function extractRemoteOfficeUrls(text, options = {}) {
  let sourceText = '';
  if (typeof text === 'string') {
    sourceText = text;
  } else if (text != null) {
    try {
      sourceText = JSON.stringify(text);
    } catch {
      sourceText = '';
    }
  }
  const matches = sourceText.matchAll(
    /https?:\/\/[^\r\n<>"']+?\.(?:docx|pptx|xlsx|pdf)(?:[?#][^\s<>"'`]*)?/giu
  );
  const urls = [];
  const seen = new Set();
  for (const match of matches) {
    if (urls.length >= (options.limit || MAX_ARTIFACTS_PER_TURN)) break;
    try {
      const url = validateRemoteUrl(match[0].replace(/[`\])，。；;]+$/u, '').trim(), 'internal');
      const key = url.href;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    } catch {
      continue;
    }
  }
  return urls;
}

function decodeHeaderFilename(value) {
  const extended = String(value || '').match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return extended[1].trim().replace(/^"|"$/g, '');
    }
  }
  const basic = String(value || '').match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return (basic?.[1] || basic?.[2] || '').trim();
}

function sanitizeFilename(value, fallbackExtension) {
  const decoded = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const cleaned = decoded
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  let extension = path.extname(cleaned).toLowerCase();
  if (!OFFICE_EXTENSIONS.has(extension)) extension = fallbackExtension;
  const rawStem = path.basename(cleaned || '下载产品', path.extname(cleaned || ''))
    .replace(/[. ]+$/g, '')
    .trim() || '下载产品';
  const stem = rawStem.slice(0, Math.max(1, 180 - extension.length));
  return `${stem}${extension}`;
}

function filenameForResponse(response, url, expectedExtension) {
  let pathname = '';
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  const fallbackExtension = officeExtension(url) || expectedExtension;
  const headerName = decodeHeaderFilename(response.headers.get('content-disposition'));
  return sanitizeFilename(headerName || path.basename(pathname), fallbackExtension);
}

function publicRemoteSource(url) {
  return { origin: url.origin, pathname: url.pathname };
}

async function fetchWithRedirects(initialUrl, options = {}) {
  let url = validateRemoteUrl(initialUrl, options.securityMode);
  const expectedExtension = officeExtension(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await options.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/pdf,application/vnd.openxmlformats-officedocument.*' },
      redirect: 'manual',
      signal: options.signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url, expectedExtension };
    }
    if (redirects === MAX_REDIRECTS) throw new Error('产品下载重定向次数过多');
    const location = response.headers.get('location');
    if (!location) throw new Error('产品下载重定向缺少目标地址');
    await response.body?.cancel().catch(() => {});
    url = validateRemoteUrl(new URL(location, url), options.securityMode, {
      requireOfficeExtension: false,
    });
  }
  throw new Error('产品下载重定向次数过多');
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest('hex');
}

async function validateFileSignature(filePath, extension) {
  const handle = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(8);
  try {
    await handle.read(buffer, 0, buffer.length, 0);
  } finally {
    await handle.close();
  }
  if (extension === '.pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('下载内容不是有效的 PDF 文件');
  }
  if (extension !== '.pdf' && buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error(`下载内容不是有效的 ${extension.slice(1).toUpperCase()} 文件`);
  }
}

async function placeWithoutOverwrite(tempPath, directory, filename, contentHash) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  for (let version = 1; version < 10_000; version += 1) {
    const candidate = path.join(directory, version === 1 ? filename : `${stem}_${version}${extension}`);
    if (fs.existsSync(candidate)) {
      if (await sha256File(candidate) === contentHash) {
        await fs.promises.unlink(tempPath);
        return { path: candidate, reused: true };
      }
      continue;
    }
    try {
      await fs.promises.link(tempPath, candidate);
      await fs.promises.unlink(tempPath);
      if (process.platform !== 'win32') await fs.promises.chmod(candidate, 0o600);
      return { path: candidate, reused: false };
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('无法为下载产品分配本地文件名');
}

async function downloadRemoteOfficeArtifact(input = {}) {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持产品下载');
  const securityMode = SecurityMode.normalizeSecurityMode(input.securityMode);
  const workspace = SafeWorkspace.canonicalRoot(input.workspace, { securityMode });
  const directory = SafeWorkspace.ensureDirectory(workspace, 'artifacts/downloads', { securityMode });
  const workspaceReal = fs.realpathSync(workspace);
  const initialUrl = validateRemoteUrl(input.url, securityMode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs || DOWNLOAD_TIMEOUT_MS);
  const tempPath = path.join(directory, `.download-${crypto.randomUUID()}.part`);
  try {
    const { response, url, expectedExtension } = await fetchWithRedirects(initialUrl, {
      fetchImpl,
      securityMode,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`产品下载失败（HTTP ${response.status}）`);
    if (!response.body) throw new Error('产品下载响应为空');
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ARTIFACT_BYTES) {
      throw new Error('产品文件超过 100 MiB');
    }
    const filename = filenameForResponse(response, url, expectedExtension);
    const extension = path.extname(filename).toLowerCase();
    let sizeBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        callback(sizeBytes > MAX_ARTIFACT_BYTES ? new Error('产品文件超过 100 MiB') : null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }),
    );
    await validateFileSignature(tempPath, extension);
    const contentHash = await sha256File(tempPath);
    const placed = await placeWithoutOverwrite(tempPath, directory, filename, contentHash);
    return {
      path: placed.path,
      relativePath: path.relative(workspaceReal, placed.path).split(path.sep).join('/'),
      name: path.basename(placed.path),
      extension,
      sizeBytes: (await fs.promises.stat(placed.path)).size,
      contentHash,
      reused: placed.reused,
      remoteSource: publicRemoteSource(url),
      downloadedAt: new Date().toISOString(),
    };
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    if (error?.name === 'AbortError') throw new Error('产品下载超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadOfficeArtifacts(input = {}) {
  if (!isOfficeProductRequest(input.userPrompt)) return { downloads: [], failures: [], skipped: true };
  const urls = extractRemoteOfficeUrls([
    input.assistantText || '',
    ...(Array.isArray(input.artifactSources) ? input.artifactSources : []),
  ], {
    securityMode: input.securityMode,
    limit: input.maxArtifacts || MAX_ARTIFACTS_PER_TURN,
  });
  const downloads = [];
  const failures = [];
  for (const url of urls) {
    try {
      downloads.push(await downloadRemoteOfficeArtifact({ ...input, url }));
    } catch (error) {
      failures.push({
        remoteSource: publicRemoteSource(url),
        message: error?.message || String(error),
      });
    }
  }
  return { downloads, failures, skipped: false };
}

module.exports = {
  DOWNLOAD_TIMEOUT_MS,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACTS_PER_TURN,
  downloadOfficeArtifacts,
  downloadRemoteOfficeArtifact,
  extractRemoteOfficeUrls,
  isOfficeProductRequest,
  sanitizeFilename,
  validateRemoteUrl,
};
