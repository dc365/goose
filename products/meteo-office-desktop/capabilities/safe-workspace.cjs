'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SecurityMode = require('./security-mode.cjs');

function comparable(value) {
  const normalized = path.normalize(String(value || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function selectedMode(options = {}) {
  return SecurityMode.normalizeSecurityMode(options.securityMode);
}

function canonicalRoot(workspace, options = {}) {
  const requested = String(workspace || '').trim();
  if (!requested || !path.isAbsolute(requested)) throw new Error('请先选择有效的项目工作区');
  let root;
  let stat;
  try {
    root = selectedMode(options) === SecurityMode.MODES.STRICT
      ? fs.realpathSync.native(requested)
      : path.resolve(requested);
    stat = fs.statSync(root);
  } catch {
    throw new Error('项目工作区不存在或无法访问');
  }
  if (!stat.isDirectory()) throw new Error('项目工作区不是目录');
  return root;
}

function nearestExisting(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('无法解析目标路径');
    missing.unshift(path.basename(current));
    current = parent;
  }
  return { existing: current, missing };
}

function assertNoSymlinkPath(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative) return;
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`工作区路径包含符号链接，已拒绝访问：${current}`);
  }
}

function relaxedResolve(root, requestedPath, options = {}) {
  const requested = String(requestedPath?.path || requestedPath || '').trim();
  if (!requested) return { root, path: root, exists: true, relative: '', outsideWorkspace: false };
  const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  const exists = fs.existsSync(candidate);
  if (!options.allowMissing && !exists) throw new Error('目标路径不存在');
  let resolved = candidate;
  if (exists) {
    try {
      resolved = fs.realpathSync.native(candidate);
    } catch {
      resolved = candidate;
    }
  }
  return {
    root,
    path: resolved,
    exists,
    relative: path.relative(root, resolved),
    outsideWorkspace: !inside(comparable(root), comparable(resolved)),
  };
}

function strictResolve(root, requestedPath, options = {}) {
  const requested = String(requestedPath?.path || requestedPath || '').trim();
  if (!requested) return { root, path: root, exists: true, relative: '', outsideWorkspace: false };
  const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  const initialRelative = path.relative(root, candidate);
  if (initialRelative.startsWith('..') || path.isAbsolute(initialRelative)) {
    throw new Error('目标路径超出项目工作区');
  }

  const { existing, missing } = nearestExisting(candidate);
  const canonicalExisting = fs.realpathSync.native(existing);
  if (!inside(comparable(root), comparable(canonicalExisting))) {
    throw new Error('目标路径通过符号链接逃逸出项目工作区');
  }
  assertNoSymlinkPath(root, existing);

  const resolved = path.resolve(canonicalExisting, ...missing);
  if (!inside(comparable(root), comparable(resolved))) throw new Error('目标路径超出项目工作区');
  if (!options.allowMissing && !fs.existsSync(resolved)) throw new Error('目标路径不存在');

  if (fs.existsSync(resolved)) {
    assertNoSymlinkPath(root, resolved);
    const canonical = fs.realpathSync.native(resolved);
    if (!inside(comparable(root), comparable(canonical))) throw new Error('目标路径超出项目工作区');
    return {
      root,
      path: canonical,
      exists: true,
      relative: path.relative(root, canonical),
      outsideWorkspace: false,
    };
  }

  return {
    root,
    path: resolved,
    exists: false,
    relative: path.relative(root, resolved),
    outsideWorkspace: false,
  };
}

function resolveInside(workspace, requestedPath, options = {}) {
  const mode = selectedMode(options);
  const root = canonicalRoot(workspace, { securityMode: mode });
  return mode === SecurityMode.MODES.STRICT
    ? strictResolve(root, requestedPath, options)
    : relaxedResolve(root, requestedPath, options);
}

function pathInsideWorkspace(workspace, requestedPath, options = {}) {
  try {
    const result = resolveInside(workspace, requestedPath, { ...options, allowMissing: options.allowMissing !== false });
    return selectedMode(options) === SecurityMode.MODES.STRICT ? !result.outsideWorkspace : true;
  } catch {
    return false;
  }
}

function ensureDirectory(workspace, requestedPath, options = {}) {
  const target = resolveInside(workspace, requestedPath, { ...options, allowMissing: true });
  fs.mkdirSync(target.path, { recursive: true, mode: 0o700 });
  return resolveInside(workspace, target.path, { ...options, allowMissing: false }).path;
}

function ensureParent(workspace, requestedPath, options = {}) {
  const target = resolveInside(workspace, requestedPath, { ...options, allowMissing: true });
  const parent = resolveInside(workspace, path.dirname(target.path), { ...options, allowMissing: true });
  fs.mkdirSync(parent.path, { recursive: true, mode: 0o700 });
  resolveInside(workspace, parent.path, { ...options, allowMissing: false });
  return target.path;
}

module.exports = {
  canonicalRoot,
  resolveInside,
  pathInsideWorkspace,
  ensureDirectory,
  ensureParent,
};
