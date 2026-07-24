'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const ComputerConnector = require('../capabilities/computer-connector.js');

const productRoot = path.resolve(__dirname, '..');
const version = ComputerConnector.DRIVER_VERSION;
const downloadAttempts = 5;
const connectTimeoutSeconds = 20;
const transferTimeoutSeconds = 900;
const lowSpeedTimeoutSeconds = 60;
const release = {
  darwin: {
    arm64: {
      asset: `cua-driver-rs-${version}-darwin-arm64.tar.gz`,
      sha256: '9cdd30d71c8b327bed711b39c1c642a3c3d5f2c86ff6dbbe85eee36c66b24ee7',
    },
    x64: {
      asset: `cua-driver-rs-${version}-darwin-x86_64.tar.gz`,
      sha256: '678548fa9028b7ffce215d71a8ebe889b8b6eeb4590e84b53c668986e49f45d9',
    },
  },
  linux: {
    arm64: {
      asset: `cua-driver-rs-${version}-linux-arm64-binary.tar.gz`,
      sha256: '176365815fac4fc7e1f472a9ce18c5c67aa0cd0b7453950651c24cf8b9d7d52c',
    },
    x64: {
      asset: `cua-driver-rs-${version}-linux-x86_64-binary.tar.gz`,
      sha256: '686bb354420a3019c812bb940cf531a830db6a86ccaeb329ad754cac2b869c6e',
    },
  },
}[process.platform]?.[process.arch];

if (!release) {
  throw new Error(`Cua Driver 暂不支持当前打包目标：${process.platform}-${process.arch}`);
}

const destination = path.join(productRoot, 'runtime', 'cua-driver', `${process.platform}-${process.arch}`);
const binaryName = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
const binaryPath = path.join(destination, binaryName);
const nativeBinaryName = process.platform === 'win32' ? 'cua-driver-bin.exe' : 'cua-driver-bin';
const nativeBinaryPath = path.join(destination, nativeBinaryName);
const manifestPath = path.join(destination, 'runtime.json');

function currentRuntimeMatches() {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest.schemaVersion === 2
      && manifest.version === version
      && manifest.sha256 === release.sha256
      && fs.statSync(binaryPath).isFile()
      && fs.statSync(nativeBinaryPath).isFile()
      && manifest.binarySha256 === sha256(nativeBinaryPath)
      && manifest.launcherSha256 === sha256(binaryPath);
  } catch {
    return false;
  }
}

function driverLauncherSource(executableName = nativeBinaryName) {
  return [
    '#!/bin/sh',
    'set -eu',
    'export CUA_DRIVER_RS_TELEMETRY_ENABLED=false',
    'export CUA_DRIVER_RS_UPDATE_CHECK=false',
    `exec "$(dirname "$0")/${executableName}" "$@"`,
    '',
  ].join('\n');
}

function releaseDownloadUrl(env = process.env) {
  const defaultBase = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${version}/`;
  const configuredBase = String(env.METEOMATE_CUA_DRIVER_DOWNLOAD_BASE_URL || defaultBase).trim();
  const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
  return new URL(release.asset, base).toString();
}

function curlDownloadArgs(url, target) {
  return [
    '--location',
    '--fail',
    '--show-error',
    '--progress-bar',
    '--connect-timeout',
    String(connectTimeoutSeconds),
    '--max-time',
    String(transferTimeoutSeconds),
    '--speed-limit',
    '1024',
    '--speed-time',
    String(lowSpeedTimeoutSeconds),
    '--continue-at',
    '-',
    '--user-agent',
    'MeteoMate Runtime Builder',
    '--output',
    target,
    '--url',
    String(url),
  ];
}

function runCurl(url, target, {
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl('curl', curlDownloadArgs(url, target), {
        env: { ...env },
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(new Error('准备 Cua Driver 需要系统 curl 命令'));
        return;
      }
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `信号 ${signal}` : `退出码 ${code}`;
      reject(new Error(`下载 Cua Driver 失败：curl ${detail}`));
    });
  });
}

async function download(url, target, {
  attempts = downloadAttempts,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const resumedBytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
    const resumeLabel = resumedBytes > 0 ? `，从 ${resumedBytes} 字节继续` : '';
    console.log(`正在下载 Cua Driver ${version}（第 ${attempt}/${attempts} 次${resumeLabel}）...`);
    try {
      await runCurl(url, target, { env, spawnImpl });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const waitMilliseconds = Math.min(2 ** (attempt - 1) * 1000, 8000);
      console.warn(`${error.message}，${waitMilliseconds / 1000} 秒后重试。`);
      await delay(waitMilliseconds);
    }
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function findExtractedFile(root, names) {
  const queue = [root];
  while (queue.length) {
    const directory = queue.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (names.includes(entry.name)) return candidate;
    }
  }
  return null;
}

async function prepare() {
  if (currentRuntimeMatches()) {
    console.log(`MeteoMate computer runtime ready: Cua Driver ${version}.`);
    return;
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-cua-driver-'));
  try {
    const cacheDirectory = path.join(os.tmpdir(), 'meteomate-runtime-downloads');
    const archive = path.join(cacheDirectory, `${release.asset}.part`);
    const url = releaseDownloadUrl();
    let digest = fs.existsSync(archive) ? sha256(archive) : '';
    if (digest !== release.sha256) {
      await download(url, archive);
      digest = sha256(archive);
    }
    if (digest !== release.sha256) {
      console.warn('Cua Driver 下载缓存校验失败，将清除缓存后重新下载。');
      fs.rmSync(archive, { force: true });
      await download(url, archive);
      digest = sha256(archive);
    }
    if (digest !== release.sha256) {
      fs.rmSync(archive, { force: true });
      throw new Error(`Cua Driver 完整性校验失败：期望 ${release.sha256}，实际 ${digest}`);
    }

    const extracted = path.join(temp, 'extracted');
    fs.mkdirSync(extracted);
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', extracted], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (unpack.error) throw unpack.error;
    if (unpack.status !== 0) throw new Error(`解压 Cua Driver 失败：${String(unpack.stderr || '').trim()}`);
    const source = findExtractedFile(extracted, [binaryName]);
    if (!source) throw new Error('Cua Driver 发布包中缺少可执行文件');
    const license = findExtractedFile(extracted, ['LICENSE', 'LICENSE.txt', 'LICENSE.md']);

    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, nativeBinaryPath);
    fs.writeFileSync(binaryPath, driverLauncherSource(), { mode: 0o755 });
    if (process.platform !== 'win32') fs.chmodSync(nativeBinaryPath, 0o755);
    if (license) fs.copyFileSync(license, path.join(destination, 'LICENSE.cua-driver'));
    const binarySha256 = sha256(nativeBinaryPath);
    const launcherSha256 = sha256(binaryPath);
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 2,
      version,
      platform: process.platform,
      arch: process.arch,
      asset: release.asset,
      sha256: release.sha256,
      binarySha256,
      launcherSha256,
      source: `trycua/cua@cua-driver-rs-v${version}`,
      telemetryEnabled: false,
      updateCheckEnabled: false,
    }, null, 2)}\n`, { mode: 0o600 });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`MeteoMate computer runtime prepared: Cua Driver ${version}.`);
}

if (require.main === module) {
  prepare().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  curlDownloadArgs,
  download,
  driverLauncherSource,
  releaseDownloadUrl,
  runCurl,
};
