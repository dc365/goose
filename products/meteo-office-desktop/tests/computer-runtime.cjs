'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ComputerConnector = require('../capabilities/computer-connector.js');
const ComputerRuntime = require('../capabilities/computer-runtime.cjs');
const PrepareComputerRuntime = require('../scripts/prepare-computer-runtime.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-computer-runtime-'));

async function run() {
  try {
    const productRoot = path.join(temp, 'product');
    const userData = path.join(temp, 'user-data');
    const binaryPath = path.join(productRoot, 'runtime', 'cua-driver', 'linux-x64', 'cua-driver');
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const resolved = ComputerRuntime.resolveComputerRuntime({
      productRoot,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'linux',
      arch: 'x64',
      allowSystemFallback: false,
    });
    assert.equal(resolved.binaryPath, binaryPath);
    assert.equal(resolved.info.source, 'bundled-runtime');
    assert.equal(resolved.info.driverVersion, ComputerConnector.DRIVER_VERSION);

    assert.equal(
      ComputerRuntime.cuaModuleSpecifier('embedded', productRoot),
      '@trycua/cua-driver/embedded',
    );
    const asarRoot = path.join(temp, 'MeteoMate.app', 'Contents', 'Resources', 'app.asar');
    const unpackedSdk = path.join(
      `${asarRoot}.unpacked`,
      'node_modules',
      '@trycua',
      'cua-driver',
      'dist',
      'embedded.js',
    );
    fs.mkdirSync(path.dirname(unpackedSdk), { recursive: true });
    fs.writeFileSync(unpackedSdk, 'export {};');
    assert.equal(
      ComputerRuntime.cuaModuleSpecifier('embedded', asarRoot),
      new URL(`file://${unpackedSdk}`).href,
    );

    const launcher = PrepareComputerRuntime.driverLauncherSource('cua-driver-bin');
    assert.match(launcher, /CUA_DRIVER_RS_TELEMETRY_ENABLED=false/);
    assert.match(launcher, /CUA_DRIVER_RS_UPDATE_CHECK=false/);
    assert.match(launcher, /cua-driver-bin/);

    const policy = ComputerRuntime.boundedSessionPolicySource();
    const [allowPolicy, denyPolicy] = policy.split('\ndeny:\n');
    const allowedTools = new Set(
      [...allowPolicy.matchAll(/^\s+- (?:tool: )?([a-z_]+)$/gm)].map((match) => match[1]),
    );
    const blockedTools = new Set(
      [...denyPolicy.matchAll(/^\s+- ([a-z_]+)$/gm)].map((match) => match[1]),
    );
    assert.deepEqual(allowedTools, new Set(ComputerConnector.SAFE_TOOLS));
    assert.deepEqual(blockedTools, new Set(ComputerConnector.BLOCKED_TOOLS));
    assert.match(policy, /^version: 1\nmode: bounded\nexpires_after: 24h\nidle_timeout: 24h/m);

    let options = null;
    let stopped = false;
    let destroyed = false;
    const connection = {
      socketPath: '/tmp/meteomate-cua.sock',
      pid: 901,
      generation: 'generation-1',
      driverVersion: ComputerConnector.DRIVER_VERSION,
      contractVersion: 'contract-1',
      mcpProtocolVersion: '2025-06-18',
      mcp: {
        command: binaryPath,
        args: ['mcp', '--embedded', '--socket', '/tmp/meteomate-cua.sock'],
        environment: [{ name: 'CUA_DRIVER_EMBEDDED', value: '1' }],
      },
    };
    const sdk = {
      EmbeddedPermissionMode: { Standard: 0, Bounded: 1 },
      EmbeddedCuaDriverHost: {
        withOptions(value) {
          options = value;
          return {
            start: async () => connection,
            stop: async () => { stopped = true; },
            waitForExit: async () => new Promise(() => {}),
            uniffiDestroy: () => { destroyed = true; },
          };
        },
      },
    };
    const manager = ComputerRuntime.createComputerRuntimeManager({
      app: {
        isPackaged: true,
        getPath: () => userData,
        whenReady: async () => {},
      },
      productRoot,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'linux',
      arch: 'x64',
      sdkLoader: async () => sdk,
    });

    assert.equal(await manager.start(), connection);
    assert.equal(manager.connection(), connection);
    assert.equal(options.binaryPath, binaryPath);
    assert.equal(options.hostBundleId, ComputerRuntime.HOST_BUNDLE_ID);
    assert.equal(options.permissionMode, sdk.EmbeddedPermissionMode.Bounded);
    assert.equal(options.approveSessionPolicy, true);
    assert.equal(options.dangerouslyBypassApprovals, false);
    assert.deepEqual(options.environment, []);
    assert.equal(fs.readFileSync(options.sessionPolicyPath, 'utf8'), policy);

    const materialized = ComputerConnector.materialize({}, {
      connection,
      runtimeInfo: manager.runtimeInfo(),
    });
    assert.equal(materialized.command, binaryPath);
    assert.deepEqual(materialized.args, connection.mcp.args);
    assert.deepEqual(materialized.toolAllowlist, ComputerConnector.SAFE_TOOLS);
    assert.equal(materialized.runtimeInfo.embedded, true);

    await manager.stop();
    assert.equal(stopped, true);
    assert.equal(destroyed, true);
    assert.equal(manager.connection(), null);

    const darwinBinaryPath = path.join(
      productRoot,
      'runtime',
      'cua-driver',
      'darwin-arm64',
      'cua-driver',
    );
    fs.mkdirSync(path.dirname(darwinBinaryPath), { recursive: true });
    fs.writeFileSync(darwinBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    let statusChecks = 0;
    let permissionRequests = 0;
    const darwinManager = ComputerRuntime.createComputerRuntimeManager({
      app: {
        isPackaged: true,
        getPath: () => userData,
        whenReady: async () => {},
      },
      productRoot,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      arch: 'arm64',
      sdkLoader: async () => sdk,
      permissionLoader: async () => ({
        hasRequiredMacOSPermissions: (status) => status.accessibility && status.screenRecording,
        requestMacOSPermissions: () => {
          permissionRequests += 1;
          return { accessibility: true, screenRecording: true };
        },
      }),
      statusLoader: async () => ({
        currentMacOsPermissionStatus: () => {
          statusChecks += 1;
          return { accessibility: true, screenRecording: true };
        },
      }),
    });
    await darwinManager.start();
    assert.equal(statusChecks, 1);
    assert.equal(permissionRequests, 0);
    await darwinManager.stop();

    let screenRecordingSettingsOpens = 0;
    const missingScreenRecordingManager = ComputerRuntime.createComputerRuntimeManager({
      app: {
        isPackaged: true,
        getPath: () => userData,
        whenReady: async () => {},
      },
      productRoot,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      arch: 'arm64',
      sdkLoader: async () => sdk,
      permissionLoader: async () => ({
        hasRequiredMacOSPermissions: (status) => status.accessibility && status.screenRecording,
        requestMacOSPermissions: () => ({ accessibility: true, screenRecording: false }),
        openMacOSScreenRecordingSettings: async () => {
          screenRecordingSettingsOpens += 1;
        },
      }),
    });
    await assert.rejects(
      missingScreenRecordingManager.start({ requestPermissions: true }),
      /已为你打开“屏幕与系统音频录制”设置页/,
    );
    assert.equal(screenRecordingSettingsOpens, 1);

    let accessibilitySettingsOpens = 0;
    const missingAccessibilityManager = ComputerRuntime.createComputerRuntimeManager({
      app: {
        isPackaged: true,
        getPath: () => userData,
        whenReady: async () => {},
      },
      productRoot,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      arch: 'arm64',
      sdkLoader: async () => sdk,
      permissionLoader: async () => ({
        hasRequiredMacOSPermissions: (status) => status.accessibility && status.screenRecording,
        requestMacOSPermissions: () => ({ accessibility: false, screenRecording: true }),
      }),
      openAccessibilitySettings: async () => {
        accessibilitySettingsOpens += 1;
      },
    });
    await assert.rejects(
      missingAccessibilityManager.start({ requestPermissions: true }),
      /已为你打开“辅助功能”设置页/,
    );
    assert.equal(accessibilitySettingsOpens, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().then(
  () => console.log('MeteoMate embedded Cua Driver runtime tests passed.'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
