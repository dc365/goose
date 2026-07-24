'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE_ROOT = path.resolve(__dirname, '..');

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function productRoots(productRoot) {
  const roots = [path.resolve(productRoot || MODULE_ROOT)];
  if (roots[0].endsWith('.asar')) roots.push(`${roots[0]}.unpacked`);
  return [...new Set(roots)];
}

function executableName(platform, name) {
  return platform === 'win32' ? `${name}.exe` : name;
}

function findOnPath(name, env, platform) {
  const suffixes = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, platform === 'win32' ? `${name}${suffix}` : name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function prependPath(directory, currentPath) {
  return [...new Set([directory, ...String(currentPath || '').split(path.delimiter).filter(Boolean)])]
    .join(path.delimiter);
}

function readPackage(packagePath) {
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    return null;
  }
}

function packageDescriptor(productRoot, env) {
  if (env.METEOMATE_PLAYWRIGHT_MCP_PATH) {
    const entryPath = path.resolve(env.METEOMATE_PLAYWRIGHT_MCP_PATH);
    if (!isFile(entryPath)) throw new Error(`指定的 Playwright MCP 入口不存在：${entryPath}`);
    return { entryPath, version: 'developer-override', source: 'developer-override' };
  }

  for (const root of productRoots(productRoot)) {
    const packagePath = path.join(root, 'runtime', 'playwright-mcp', 'node_modules', '@playwright', 'mcp', 'package.json');
    const manifest = readPackage(packagePath);
    if (!manifest) continue;
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['playwright-mcp'];
    const entryPath = path.resolve(path.dirname(packagePath), bin || 'cli.js');
    if (isFile(entryPath)) return { entryPath, version: manifest.version, source: 'bundled-runtime' };
  }

  const searchRoots = [...productRoots(productRoot), MODULE_ROOT];
  try {
    const packagePath = require.resolve('@playwright/mcp/package.json', { paths: searchRoots });
    const manifest = readPackage(packagePath);
    const bin = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.['playwright-mcp'];
    const entryPath = path.resolve(path.dirname(packagePath), bin || 'cli.js');
    if (manifest && isFile(entryPath)) {
      return { entryPath, version: manifest.version, source: 'application-dependency' };
    }
  } catch {
    return null;
  }
  return null;
}

function nodeVersion(command, env, fallback) {
  if (fallback) return fallback;
  const result = spawnSync(command, ['--version'], {
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : 'unknown';
}

function nodeRuntime({ productRoot, env, execPath, versions, platform, arch }) {
  const roots = productRoots(productRoot);
  const nodeName = executableName(platform, 'node');
  const bundledCandidates = roots.flatMap((root) => [
    path.join(root, 'runtime', 'node', `${platform}-${arch}`, platform === 'win32' ? '' : 'bin', nodeName),
    path.join(root, 'runtime', 'node', platform === 'win32' ? '' : 'bin', nodeName),
  ]);
  for (const candidate of bundledCandidates) {
    if (!isFile(candidate)) continue;
    const runtimeEnv = { PATH: prependPath(path.dirname(candidate), env.PATH) };
    return {
      command: candidate,
      env: runtimeEnv,
      source: 'bundled-node',
      version: nodeVersion(candidate, { ...env, ...runtimeEnv }),
    };
  }

  if (env.METEOMATE_NODE_PATH) {
    const command = path.resolve(env.METEOMATE_NODE_PATH);
    if (!isFile(command)) throw new Error(`指定的 Node.js 不存在：${command}`);
    const runtimeEnv = { PATH: prependPath(path.dirname(command), env.PATH) };
    return {
      command,
      env: runtimeEnv,
      source: 'developer-override',
      version: nodeVersion(command, { ...env, ...runtimeEnv }),
    };
  }

  if (versions.electron && isFile(execPath)) {
    const runtimeEnv = { ELECTRON_RUN_AS_NODE: '1' };
    return {
      command: execPath,
      env: runtimeEnv,
      source: 'electron-node',
      version: versions.node ? `v${versions.node}` : 'unknown',
    };
  }

  if (isFile(execPath) && path.basename(execPath).toLowerCase().startsWith('node')) {
    const runtimeEnv = { PATH: prependPath(path.dirname(execPath), env.PATH) };
    return {
      command: execPath,
      env: runtimeEnv,
      source: 'node-process',
      version: versions.node ? `v${versions.node}` : nodeVersion(execPath, { ...env, ...runtimeEnv }),
    };
  }

  return null;
}

function bundledBrowserPath(productRoot) {
  for (const root of productRoots(productRoot).reverse()) {
    const candidate = path.join(root, 'runtime', 'browsers');
    if (!isDirectory(candidate)) continue;
    if (fs.readdirSync(candidate).some((entry) => !entry.startsWith('.'))) return candidate;
  }
  return null;
}

function npxFallback({ env, platform, mcpPackage }) {
  const commonDirectories = platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [];
  const npxName = platform === 'win32' ? 'npx.cmd' : 'npx';
  const candidates = [
    env.METEOMATE_NPX_PATH,
    findOnPath('npx', env, platform),
    ...commonDirectories.map((directory) => path.join(directory, npxName)),
  ].filter(Boolean);
  const command = candidates.find(isFile);
  if (!command) return null;

  const commandDirectory = path.dirname(command);
  const node = [
    env.METEOMATE_NODE_PATH,
    path.join(commandDirectory, executableName(platform, 'node')),
    findOnPath('node', env, platform),
  ].filter(Boolean).find(isFile);
  if (!node) throw new Error('找到了 npx，但没有找到可供它启动的 Node.js');

  const runtimeEnv = { PATH: prependPath(path.dirname(node), env.PATH) };
  return {
    command,
    argsPrefix: ['-y', mcpPackage],
    env: runtimeEnv,
    info: {
      source: 'system-npx',
      nodeVersion: nodeVersion(node, { ...env, ...runtimeEnv }),
      mcpVersion: mcpPackage.split('@').pop(),
      browserRuntime: 'playwright-cache',
      managed: false,
    },
  };
}

function resolveBrowserRuntime({
  productRoot = MODULE_ROOT,
  env = process.env,
  execPath = process.execPath,
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
  allowSystemFallback = true,
  mcpPackage,
} = {}) {
  const descriptor = packageDescriptor(productRoot, env);
  const node = nodeRuntime({ productRoot, env, execPath, versions, platform, arch });
  if (descriptor && node) {
    const browserPath = bundledBrowserPath(productRoot);
    const runtimeEnv = { ...node.env };
    if (browserPath) runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = browserPath;
    return {
      command: node.command,
      argsPrefix: [descriptor.entryPath],
      env: runtimeEnv,
      info: {
        source: node.source,
        nodeVersion: node.version,
        mcpVersion: descriptor.version,
        packageSource: descriptor.source,
        browserRuntime: browserPath ? 'bundled-chromium' : 'playwright-cache',
        managed: true,
      },
    };
  }

  if (allowSystemFallback) {
    const fallback = npxFallback({ env, platform, mcpPackage });
    if (fallback) return fallback;
  }

  if (!descriptor) {
    throw new Error('浏览器运行时不完整：缺少产品内置的 Playwright MCP，请重新安装或修复 MeteoMate');
  }
  throw new Error('浏览器运行时不完整：缺少可用的产品 Node.js，请重新安装或修复 MeteoMate');
}

module.exports = { resolveBrowserRuntime, productRoots };
