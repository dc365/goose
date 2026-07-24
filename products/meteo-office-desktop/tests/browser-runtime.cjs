'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const BrowserConnector = require('../capabilities/browser-connector.js');
const BrowserRuntime = require('../capabilities/browser-runtime.cjs');

const productRoot = path.resolve(__dirname, '..');
const minimalPath = process.platform === 'win32'
  ? String(process.env.SystemRoot || 'C:\\Windows')
  : '/usr/bin:/bin:/usr/sbin:/sbin';
const electronRuntime = BrowserRuntime.resolveBrowserRuntime({
  productRoot,
  env: { PATH: minimalPath },
  execPath: process.execPath,
  versions: { ...process.versions, electron: 'test-electron' },
  allowSystemFallback: false,
  mcpPackage: BrowserConnector.MCP_PACKAGE,
});

assert.equal(electronRuntime.command, process.execPath);
assert.equal(electronRuntime.info.source, 'electron-node');
assert.equal(electronRuntime.info.managed, true);
assert.equal(electronRuntime.info.mcpVersion, BrowserConnector.MCP_VERSION);
assert.equal(electronRuntime.env.ELECTRON_RUN_AS_NODE, '1');
assert.ok(electronRuntime.argsPrefix[0].endsWith(path.join('@playwright', 'mcp', 'cli.js')));
assert.ok(!electronRuntime.argsPrefix.includes(BrowserConnector.MCP_PACKAGE));

const version = spawnSync(electronRuntime.command, [...electronRuntime.argsPrefix, '--version'], {
  env: { PATH: minimalPath, ...electronRuntime.env },
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});
assert.equal(version.status, 0, version.stderr);
assert.equal(String(version.stdout).trim(), `Version ${BrowserConnector.MCP_VERSION}`);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-browser-runtime-'));
try {
  const nodeDirectory = path.join(temp, 'runtime', 'node', `${process.platform}-${process.arch}`, process.platform === 'win32' ? '' : 'bin');
  fs.mkdirSync(nodeDirectory, { recursive: true });
  const nodePath = path.join(nodeDirectory, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, nodePath);
  fs.chmodSync(nodePath, 0o755);
  const bundledRuntime = BrowserRuntime.resolveBrowserRuntime({
    productRoot: temp,
    env: { PATH: minimalPath },
    execPath: '/missing/electron',
    versions: process.versions,
    allowSystemFallback: false,
    mcpPackage: BrowserConnector.MCP_PACKAGE,
  });
  assert.equal(bundledRuntime.command, nodePath);
  assert.equal(bundledRuntime.info.source, 'bundled-node');
  assert.equal(bundledRuntime.env.PATH.split(path.delimiter)[0], nodeDirectory);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('MeteoMate managed browser runtime resolution passed.');
