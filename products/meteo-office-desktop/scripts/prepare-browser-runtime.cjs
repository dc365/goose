'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const productRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(productRoot, 'runtime');
const browsersPath = path.join(runtimeRoot, 'browsers');
const mcpPackagePath = require.resolve('@playwright/mcp/package.json', { paths: [productRoot] });
const playwrightPackagePath = require.resolve('playwright/package.json', { paths: [productRoot] });
const mcpPackage = require(mcpPackagePath);
const playwrightPackage = require(playwrightPackagePath);
const playwrightBin = typeof playwrightPackage.bin === 'string'
  ? playwrightPackage.bin
  : playwrightPackage.bin?.playwright;
const playwrightCliPath = path.resolve(path.dirname(playwrightPackagePath), playwrightBin || 'cli.js');

fs.mkdirSync(browsersPath, { recursive: true });
const install = spawnSync(process.execPath, [playwrightCliPath, 'install', 'chromium'], {
  cwd: productRoot,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

const runtimeManifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  nodeStrategy: 'electron-run-as-node',
  playwrightMcpVersion: mcpPackage.version,
  playwrightVersion: playwrightPackage.version,
  browsersPath: 'runtime/browsers',
};
fs.writeFileSync(path.join(runtimeRoot, 'runtime.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, { mode: 0o600 });
console.log(`MeteoMate browser runtime prepared: Playwright MCP ${mcpPackage.version}, Playwright ${playwrightPackage.version}.`);
