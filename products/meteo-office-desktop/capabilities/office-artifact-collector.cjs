'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_JSON_CHARS = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.pdf', '.png']);
const STATUS_VALUES = new Set(['draft', 'validated', 'ready', 'failed']);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspaceFile(workspace, inputPath) {
  const root = fs.realpathSync(path.resolve(workspace));
  const candidate = path.resolve(root, String(inputPath || ''));
  if (!isInside(root, candidate)) throw new Error('Office Artifact 已超出项目工作区');
  const resolved = fs.realpathSync(candidate);
  if (!isInside(root, resolved)) throw new Error('Office Artifact 通过符号链接逃逸');
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Office Artifact 不是普通文件');
  if (stat.size > MAX_ARTIFACT_BYTES) throw new Error('Office Artifact 超过 100 MiB');
  return { root, resolved, stat };
}

function sha256(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function validateSignature(filePath, extension) {
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(8);
  try {
    fs.readSync(handle, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (extension === '.pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('PDF Artifact 文件签名不合法');
  }
  if (
    ['.docx', '.pptx', '.xlsx'].includes(extension)
    && buffer.subarray(0, 2).toString('ascii') !== 'PK'
  ) {
    throw new Error(`${extension.slice(1).toUpperCase()} Artifact 文件签名不合法`);
  }
  if (
    extension === '.png'
    && !buffer.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    throw new Error('PNG Artifact 文件签名不合法');
  }
}

function mediaType(extension) {
  return {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
  }[extension];
}

function previewMetadata(metadata, workspace) {
  const result = { ...(metadata || {}) };
  const render = result.render && typeof result.render === 'object' ? { ...result.render } : null;
  if (!render) return result;
  const mappings = [
    ['previewPath', 'previewUri'],
    ['thumbnailPath', 'thumbnailUri'],
    ['previewManifestPath', 'previewManifestUri'],
  ];
  for (const [pathKey, uriKey] of mappings) {
    if (!render[pathKey]) continue;
    const { resolved } = resolveWorkspaceFile(workspace, render[pathKey]);
    render[uriKey] = pathToFileURL(resolved).href;
  }
  result.render = render;
  if (render.previewUri) result.previewUri = render.previewUri;
  if (render.thumbnailUri) result.thumbnailUri = render.thumbnailUri;
  return result;
}

function materializeOfficeArtifact(input, context = {}) {
  if (!context.workspace) throw new Error('Office Artifact 缺少项目工作区');
  if (input?.apiVersion !== 'meteomate/v1' || input?.kind !== 'Artifact') {
    throw new Error('Office Artifact 契约版本不受支持');
  }
  if (input.metadata?.source !== 'office-artifacts') {
    throw new Error('Office Artifact 来源不受信任');
  }
  const { root, resolved, stat } = resolveWorkspaceFile(context.workspace, input.path);
  const extension = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Office Artifact 文件格式不受支持');
  validateSignature(resolved, extension);
  const contentHash = sha256(resolved);
  const reportedHash = String(input.contentHash || '').replace(/^sha256:/i, '').toLowerCase();
  if (reportedHash && reportedHash !== contentHash) throw new Error('Office Artifact hash 校验失败');
  if (process.platform !== 'win32') fs.chmodSync(resolved, 0o600);
  return {
    apiVersion: 'meteomate/v1',
    kind: 'Artifact',
    id: /^artifact-office-[a-f0-9]{24}$/i.test(String(input.id || ''))
      ? input.id
      : `artifact-office-${contentHash.slice(0, 24)}`,
    name: path.basename(resolved),
    type: String(input.type || extension.slice(1)).toUpperCase(),
    path: resolved,
    mediaType: mediaType(extension),
    status: STATUS_VALUES.has(input.status) ? input.status : 'draft',
    sizeBytes: stat.size,
    contentHash,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    metadata: previewMetadata({
      ...(input.metadata || {}),
      relativePath: path.relative(root, resolved).split(path.sep).join('/'),
      workspaceRoot: undefined,
    }, root),
  };
}

function collectCandidates(value, candidates, seen, depth = 0) {
  if (value == null || depth > 8 || candidates.length >= 50) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (
      text.length > 1
      && text.length <= MAX_JSON_CHARS
      && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))
    ) {
      try {
        collectCandidates(JSON.parse(text), candidates, seen, depth + 1);
      } catch {
        return;
      }
    }
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (
    value.apiVersion === 'meteomate/v1'
    && value.kind === 'Artifact'
    && value.metadata?.source === 'office-artifacts'
  ) {
    candidates.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidates(entry, candidates, seen, depth + 1));
    return;
  }
  Object.values(value).forEach((entry) => collectCandidates(entry, candidates, seen, depth + 1));
}

function collectOfficeArtifacts(value, context = {}) {
  const candidates = [];
  collectCandidates(value, candidates, new WeakSet());
  const artifacts = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const artifact = materializeOfficeArtifact(candidate, context);
      const key = `${artifact.path}:${artifact.contentHash}:${artifact.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push(artifact);
    } catch {
      continue;
    }
  }
  return artifacts;
}

module.exports = {
  MAX_ARTIFACT_BYTES,
  collectOfficeArtifacts,
  materializeOfficeArtifact,
  resolveWorkspaceFile,
};
