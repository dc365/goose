'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml',
  '.xml', '.log', '.ini', '.conf', '.cfg', '.toml', '.py', '.r', '.js', '.jsx',
  '.ts', '.tsx', '.sql', '.sh', '.bat', '.ps1', '.tex', '.rst', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.css', '.geojson',
]);
const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function previewKind(extension, remote = false) {
  if (remote || ['.html', '.htm'].includes(extension)) return 'web';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(extension)) return 'image';
  if (extension === '.pdf') return 'document';
  if (TEXT_EXTENSIONS.has(extension)) return ['.md', '.markdown'].includes(extension) ? 'document' : 'code';
  if (OFFICE_EXTENSIONS.has(extension)) return 'office';
  return 'file';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function textPreviewUrl(filePath, content, truncated) {
  const title = path.basename(filePath);
  const extension = path.extname(filePath).slice(1).toUpperCase() || 'TEXT';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; color: #27303c; background: #f6f7f9; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; }
    main { max-width: 980px; min-height: calc(100vh - 64px); margin: 0 auto; border: 1px solid #e1e5eb; border-radius: 16px; background: #fff; box-shadow: 0 12px 36px rgba(23,32,44,.07); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #eceef2; padding: 18px 22px; }
    h1 { overflow: hidden; margin: 0; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    span { border-radius: 7px; background: #eef2f8; padding: 4px 7px; color: #66758c; font-size: 10px; font-weight: 700; }
    pre { overflow: auto; margin: 0; padding: 24px; color: #303946; font: 12.5px/1.72 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; tab-size: 2; white-space: pre-wrap; word-break: break-word; }
    footer { border-top: 1px solid #eceef2; padding: 12px 22px; color: #8a929e; font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <header><h1>${escapeHtml(title)}</h1><span>${escapeHtml(extension)}</span></header>
    <pre>${escapeHtml(content)}</pre>
    ${truncated ? '<footer>文件较大，当前显示前 2 MB 内容。</footer>' : ''}
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function markdownPreviewBody(content) {
  const output = [];
  let listOpen = false;
  let codeOpen = false;
  const closeList = () => {
    if (!listOpen) return;
    output.push('</ul>');
    listOpen = false;
  };
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    if (/^\s*```/.test(rawLine)) {
      closeList();
      output.push(codeOpen ? '</code></pre>' : '<pre><code>');
      codeOpen = !codeOpen;
      continue;
    }
    if (codeOpen) {
      output.push(`${escapeHtml(rawLine)}\n`);
      continue;
    }
    const heading = rawLine.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = rawLine.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${escapeHtml(listItem[1])}</li>`);
      continue;
    }
    closeList();
    if (!rawLine.trim()) {
      output.push('');
      continue;
    }
    output.push(`<p>${escapeHtml(rawLine.trim())}</p>`);
  }
  closeList();
  if (codeOpen) output.push('</code></pre>');
  return output.join('\n');
}

function markdownPreviewUrl(filePath, content, truncated) {
  const title = path.basename(filePath);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; color: #27303c; background: #f6f7f9; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; }
    main { max-width: 900px; min-height: calc(100vh - 64px); margin: 0 auto; border: 1px solid #e1e5eb; border-radius: 16px; background: #fff; box-shadow: 0 12px 36px rgba(23,32,44,.07); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #eceef2; padding: 18px 22px; }
    header strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    header span { border-radius: 7px; background: #eef2f8; padding: 4px 7px; color: #66758c; font-size: 10px; font-weight: 700; }
    article { padding: 26px 28px 34px; color: #394352; font-size: 13px; line-height: 1.8; }
    h1, h2, h3, h4 { margin: 1.4em 0 .55em; color: #242d39; line-height: 1.4; }
    h1:first-child, h2:first-child { margin-top: 0; }
    h1 { font-size: 24px; }
    h2 { border-bottom: 1px solid #edf0f4; padding-bottom: 7px; font-size: 18px; }
    h3 { font-size: 15px; }
    h4 { font-size: 13px; }
    p { margin: .75em 0; }
    ul { margin: .7em 0; padding-left: 1.5em; }
    li + li { margin-top: .3em; }
    pre { overflow: auto; border: 1px solid #e3e7ed; border-radius: 10px; background: #f6f8fb; padding: 14px; font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    footer { border-top: 1px solid #eceef2; padding: 12px 22px; color: #8a929e; font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <header><strong>${escapeHtml(title)}</strong><span>MD</span></header>
    <article>${markdownPreviewBody(content)}</article>
    ${truncated ? '<footer>文件较大，当前显示前 2 MB 内容。</footer>' : ''}
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function realDirectory(directory) {
  if (!directory || !path.isAbsolute(directory)) return null;
  try {
    const resolved = await fs.promises.realpath(directory);
    const stat = await fs.promises.stat(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function resolveLocalPreview(target, roots) {
  let requested;
  if (/^file:/i.test(target)) {
    requested = fileURLToPath(target);
  } else if (path.isAbsolute(target)) {
    requested = target;
  } else {
    const root = roots[0];
    if (!root) throw new Error('缺少可用于解析成果物的工作区');
    requested = path.resolve(root, target);
  }

  let resolved;
  let stat;
  try {
    resolved = await fs.promises.realpath(requested);
    stat = await fs.promises.stat(resolved);
  } catch {
    throw new Error('预览文件不存在或已无法访问');
  }
  if (!stat.isFile()) throw new Error('当前成果物不是可预览文件');
  if (!roots.some((root) => isInside(root, resolved))) throw new Error('预览文件已超出当前授权工作区');
  if (stat.size > MAX_PREVIEW_BYTES) throw new Error('预览文件超过 100 MB，请使用外部应用打开');

  const extension = path.extname(resolved).toLowerCase();
  const kind = previewKind(extension);
  if (kind === 'office') throw new Error('该 Office 文件尚未生成可视化预览，请先渲染成果物');

  let loadUrl = pathToFileURL(resolved).href;
  if (TEXT_EXTENSIONS.has(extension)) {
    const handle = await fs.promises.open(resolved, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_TEXT_PREVIEW_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const content = buffer.subarray(0, bytesRead).toString('utf8');
      loadUrl = ['.md', '.markdown'].includes(extension)
        ? markdownPreviewUrl(resolved, content, stat.size > bytesRead)
        : textPreviewUrl(resolved, content, stat.size > bytesRead);
    } finally {
      await handle.close();
    }
  }

  return {
    address: resolved,
    extension,
    kind,
    loadUrl,
    localPath: resolved,
    title: path.basename(resolved),
  };
}

async function resolvePreviewTarget(request = {}) {
  const target = String(request.target || '').trim();
  if (!target) throw new Error('缺少预览地址');

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    parsed = null;
  }
  if (parsed && ['http:', 'https:'].includes(parsed.protocol)) {
    return {
      address: parsed.toString(),
      extension: '',
      kind: 'web',
      loadUrl: parsed.toString(),
      localPath: null,
      title: parsed.hostname,
    };
  }
  if (parsed && parsed.protocol !== 'file:') throw new Error('预览地址仅支持本地文件、HTTP 或 HTTPS');

  const rootCandidates = [...new Set((Array.isArray(request.roots) ? request.roots : []).filter(Boolean))];
  const roots = (await Promise.all(rootCandidates.map(realDirectory))).filter(Boolean);
  if (!roots.length) throw new Error('当前没有可用于预览的授权目录');
  return resolveLocalPreview(target, roots);
}

function navigationAllowed(url, source, roots = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (['http:', 'https:'].includes(parsed.protocol)) return true;
  if (parsed.protocol === 'data:') return url === source.loadUrl;
  if (parsed.protocol !== 'file:') return false;
  let candidate;
  try {
    candidate = fs.realpathSync(fileURLToPath(parsed));
  } catch {
    return false;
  }
  return roots.some((root) => {
    try {
      return isInside(fs.realpathSync(root), candidate);
    } catch {
      return false;
    }
  });
}

module.exports = {
  MAX_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
  navigationAllowed,
  markdownPreviewBody,
  markdownPreviewUrl,
  previewKind,
  resolvePreviewTarget,
  textPreviewUrl,
};
