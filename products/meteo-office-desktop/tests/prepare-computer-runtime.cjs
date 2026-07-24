'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PrepareComputerRuntime = require('../scripts/prepare-computer-runtime.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-cua-download-test-'));

function fakeChild(exitCode) {
  const child = new EventEmitter();
  process.nextTick(() => child.emit('close', exitCode, null));
  return child;
}

async function run() {
  try {
    const target = path.join(temp, 'driver.tar.gz.part');
    const calls = [];
    const proxyEnv = {
      https_proxy: 'http://127.0.0.1:7897',
      PATH: process.env.PATH,
    };
    await PrepareComputerRuntime.download('https://example.test/driver.tar.gz', target, {
      attempts: 1,
      env: proxyEnv,
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return fakeChild(0);
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'curl');
    assert.equal(calls[0].options.env.https_proxy, proxyEnv.https_proxy);
    assert.equal(calls[0].options.shell, false);
    const continueIndex = calls[0].args.indexOf('--continue-at');
    assert.deepEqual(calls[0].args.slice(continueIndex, continueIndex + 2), ['--continue-at', '-']);
    assert.ok(calls[0].args.includes('--connect-timeout'));
    assert.ok(calls[0].args.includes('--max-time'));
    assert.equal(calls[0].args.at(-1), 'https://example.test/driver.tar.gz');

    fs.writeFileSync(target, 'partial archive');
    let retryCalls = 0;
    const delays = [];
    await PrepareComputerRuntime.download('https://example.test/driver.tar.gz', target, {
      attempts: 3,
      delay: async (milliseconds) => delays.push(milliseconds),
      spawnImpl() {
        retryCalls += 1;
        return fakeChild(retryCalls === 1 ? 28 : 0);
      },
    });
    assert.equal(retryCalls, 2);
    assert.deepEqual(delays, [1000]);

    const customUrl = PrepareComputerRuntime.releaseDownloadUrl({
      METEOMATE_CUA_DRIVER_DOWNLOAD_BASE_URL: 'https://mirror.example.test/cua',
    });
    assert.match(customUrl, /^https:\/\/mirror\.example\.test\/cua\/cua-driver-rs-/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().then(
  () => console.log('MeteoMate Cua Driver download tests passed.'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
