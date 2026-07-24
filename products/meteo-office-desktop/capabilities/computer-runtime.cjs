'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ComputerConnector = require('./computer-connector.js');

const MODULE_ROOT = path.resolve(__dirname, '..');
const HOST_BUNDLE_ID = 'com.meteomate.desktop';
const BOUNDED_SESSION_RENEWAL_MS = 23 * 60 * 60 * 1000;
const CUA_MODULE_FILES = Object.freeze({
  embedded: 'embedded.js',
  electron: 'electron.js',
  index: 'index.js',
});

function isExecutable(filePath, platform = process.platform) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function productRoots(productRoot) {
  const roots = [path.resolve(productRoot || MODULE_ROOT)];
  if (roots[0].endsWith('.asar')) roots.push(`${roots[0]}.unpacked`);
  return [...new Set(roots)];
}

function cuaModuleSpecifier(entry, productRoot = MODULE_ROOT) {
  const fileName = CUA_MODULE_FILES[entry];
  if (!fileName) throw new Error(`未知的 Cua SDK 入口：${entry}`);
  const root = path.resolve(productRoot || MODULE_ROOT);
  if (!root.endsWith('.asar')) {
    return entry === 'index' ? '@trycua/cua-driver' : `@trycua/cua-driver/${entry}`;
  }
  const unpackedPath = path.join(
    `${root}.unpacked`,
    'node_modules',
    '@trycua',
    'cua-driver',
    'dist',
    fileName,
  );
  if (!fs.existsSync(unpackedPath)) {
    throw new Error(`桌面操作 SDK 未正确解包：缺少 ${unpackedPath}`);
  }
  return pathToFileURL(unpackedPath).href;
}

function executableName(platform) {
  return platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
}

function findOnPath(name, env, platform) {
  const result = spawnSync(platform === 'win32' ? 'where' : 'which', [name], {
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
}

function resolveComputerRuntime({
  productRoot = MODULE_ROOT,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  allowSystemFallback = true,
} = {}) {
  if (env.METEOMATE_CUA_DRIVER_PATH) {
    const binaryPath = path.resolve(env.METEOMATE_CUA_DRIVER_PATH);
    if (!isExecutable(binaryPath, platform)) throw new Error(`指定的 Cua Driver 不可执行：${binaryPath}`);
    return {
      binaryPath,
      info: { source: 'developer-override', driverVersion: ComputerConnector.DRIVER_VERSION, managed: true },
    };
  }

  const name = executableName(platform);
  for (const root of productRoots(productRoot).reverse()) {
    const candidates = [
      path.join(root, 'runtime', 'cua-driver', `${platform}-${arch}`, name),
      path.join(root, 'runtime', 'cua-driver', name),
    ];
    const binaryPath = candidates.find((candidate) => isExecutable(candidate, platform));
    if (binaryPath) {
      return {
        binaryPath,
        info: { source: 'bundled-runtime', driverVersion: ComputerConnector.DRIVER_VERSION, managed: true },
      };
    }
  }

  if (allowSystemFallback) {
    const binaryPath = findOnPath(name, env, platform);
    if (binaryPath && isExecutable(binaryPath, platform)) {
      return {
        binaryPath,
        info: { source: 'system-runtime', driverVersion: ComputerConnector.DRIVER_VERSION, managed: false },
      };
    }
  }

  throw new Error('桌面操作运行时不完整：缺少产品内置的 Cua Driver，请重新安装或修复 MeteoMate');
}

function yamlList(values, indent = 4) {
  const prefix = ' '.repeat(indent);
  return values.map((value) => `${prefix}- ${value}`).join('\n');
}

function boundedSessionPolicySource() {
  return [
    'version: 1',
    'mode: bounded',
    'expires_after: 24h',
    'idle_timeout: 24h',
    'allow:',
    '  tools:',
    yamlList(ComputerConnector.SAFE_TOOLS),
    'deny:',
    '  tools:',
    yamlList(ComputerConnector.BLOCKED_TOOLS),
    '',
  ].join('\n');
}

function writeBoundedSessionPolicy(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const policyPath = path.join(directory, 'bounded-session-policy-v1.yaml');
  const source = boundedSessionPolicySource();
  let current = '';
  try {
    current = fs.readFileSync(policyPath, 'utf8');
  } catch {
    current = '';
  }
  if (current !== source) {
    const tempPath = `${policyPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, source, { mode: 0o600 });
    try {
      fs.renameSync(tempPath, policyPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.unlinkSync(policyPath);
      fs.renameSync(tempPath, policyPath);
    }
  }
  if (process.platform !== 'win32') fs.chmodSync(policyPath, 0o600);
  return policyPath;
}

function createComputerRuntimeManager({
  app,
  productRoot = MODULE_ROOT,
  hostBundleId = HOST_BUNDLE_ID,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  sdkLoader = null,
  permissionLoader = null,
  statusLoader = null,
  openAccessibilitySettings = null,
} = {}) {
  let host = null;
  let activeConnection = null;
  let activeSince = 0;
  let startPromise = null;
  const loadSdk = sdkLoader || (() => import(cuaModuleSpecifier('embedded', productRoot)));
  const loadPermissions = permissionLoader || (() => import(cuaModuleSpecifier('electron', productRoot)));
  const loadStatus = statusLoader || (() => import(cuaModuleSpecifier('index', productRoot)));

  function runtime() {
    return resolveComputerRuntime({
      productRoot,
      env,
      platform,
      arch,
      allowSystemFallback: app?.isPackaged !== true || env.METEOMATE_ALLOW_SYSTEM_COMPUTER_RUNTIME === '1',
    });
  }

  function runtimeDirectory() {
    const userData = app?.getPath ? app.getPath('userData') : path.join(productRoot, '.meteomate-runtime');
    return path.join(userData, 'runtime', 'cua-driver');
  }

  async function requirePermissions(requestPermissions) {
    if (platform !== 'darwin') return null;
    const permissions = await loadPermissions();
    const status = requestPermissions
      ? permissions.requestMacOSPermissions()
      : (await loadStatus()).currentMacOsPermissionStatus();
    if (!permissions.hasRequiredMacOSPermissions(status)) {
      const missing = [
        !status.accessibility ? '辅助功能' : '',
        !status.screenRecording ? '屏幕与系统音频录制' : '',
      ].filter(Boolean).join('、');
      let openedSettings = '';
      if (requestPermissions) {
        if (!status.screenRecording && typeof permissions.openMacOSScreenRecordingSettings === 'function') {
          await permissions.openMacOSScreenRecordingSettings();
          openedSettings = '屏幕与系统音频录制';
        } else if (!status.accessibility && typeof openAccessibilitySettings === 'function') {
          await openAccessibilitySettings();
          openedSettings = '辅助功能';
        }
      }
      const nextStep = openedSettings
        ? `已为你打开“${openedSettings}”设置页，请授权后返回 MeteoMate 再次测试；若仍提示，请完全退出并重新打开 MeteoMate`
        : '请在“系统设置 → 隐私与安全性”中授权后重试';
      throw new Error(`MeteoMate 尚未获得${missing}权限。${nextStep}`);
    }
    return status;
  }

  async function start({ requestPermissions = false } = {}) {
    if (activeConnection && Date.now() - activeSince < BOUNDED_SESSION_RENEWAL_MS) {
      return activeConnection;
    }
    if (activeConnection) await stop();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (app?.whenReady) await app.whenReady();
      const resolved = runtime();
      await requirePermissions(requestPermissions);
      const policyPath = writeBoundedSessionPolicy(runtimeDirectory());
      const sdk = await loadSdk();
      const options = {
        binaryPath: resolved.binaryPath,
        hostBundleId,
        permissionMode: sdk.EmbeddedPermissionMode.Bounded,
        sessionPolicyPath: policyPath,
        approveSessionPolicy: true,
        dangerouslyBypassApprovals: false,
        environment: [],
        inheritStderr: app?.isPackaged !== true,
      };
      const nextHost = sdk.EmbeddedCuaDriverHost.withOptions(options);
      try {
        const connection = await nextHost.start();
        host = nextHost;
        activeConnection = connection;
        activeSince = Date.now();
        void nextHost.waitForExit(connection.generation).then(
          () => {
            if (host !== nextHost) return;
            host = null;
            activeConnection = null;
            activeSince = 0;
            nextHost.uniffiDestroy?.();
          },
          () => {
            if (host !== nextHost) return;
            host = null;
            activeConnection = null;
            activeSince = 0;
            nextHost.uniffiDestroy?.();
          }
        );
        return connection;
      } catch (error) {
        nextHost.uniffiDestroy?.();
        throw error;
      }
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    const currentHost = host;
    host = null;
    activeConnection = null;
    activeSince = 0;
    if (!currentHost) return;
    try {
      await currentHost.stop();
    } finally {
      currentHost.uniffiDestroy?.();
    }
  }

  function connection() {
    return activeConnection;
  }

  function runtimeInfo() {
    const connectionInfo = activeConnection
      ? {
          pid: activeConnection.pid,
          generation: activeConnection.generation,
          driverVersion: activeConnection.driverVersion,
          contractVersion: activeConnection.contractVersion,
          mcpProtocolVersion: activeConnection.mcpProtocolVersion,
        }
      : {};
    let resolved = null;
    try {
      resolved = runtime();
    } catch {
      resolved = null;
    }
    return {
      ...(resolved?.info || { source: 'unavailable', driverVersion: ComputerConnector.DRIVER_VERSION, managed: true }),
      embedded: Boolean(activeConnection),
      telemetry: false,
      updateCheck: false,
      ...connectionInfo,
    };
  }

  return Object.freeze({ start, stop, connection, runtimeInfo });
}

module.exports = {
  HOST_BUNDLE_ID,
  boundedSessionPolicySource,
  cuaModuleSpecifier,
  createComputerRuntimeManager,
  productRoots,
  resolveComputerRuntime,
};
