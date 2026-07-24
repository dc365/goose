'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PrepareOfficeRuntime = require('../scripts/prepare-office-runtime.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-prepare-test-'));

try {
  const runtimeDirectory = path.join(temp, 'runtime', 'office', 'darwin-arm64');
  const bundledSoffice = path.join(
    runtimeDirectory,
    'libreoffice',
    'LibreOffice.app',
    'Contents',
    'MacOS',
    'soffice',
  );
  fs.mkdirSync(path.dirname(bundledSoffice), { recursive: true });
  fs.writeFileSync(bundledSoffice, 'bundled-soffice');
  fs.chmodSync(bundledSoffice, 0o755);

  const found = PrepareOfficeRuntime.findLibreOffice({
    env: { PATH: '/usr/bin:/bin' },
    platform: 'darwin',
    runtimeDirectory,
    commandLookup: () => null,
  });
  assert.equal(found, fs.realpathSync(bundledSoffice));
  assert.equal(
    PrepareOfficeRuntime.copyLibreOffice(found, { runtimeDirectory, platform: 'darwin' }),
    fs.realpathSync(bundledSoffice),
  );
  assert.equal(fs.readFileSync(bundledSoffice, 'utf8'), 'bundled-soffice');

  const contents = path.join(runtimeDirectory, 'libreoffice', 'LibreOffice.app', 'Contents');
  const resources = path.join(contents, 'Resources');
  const senddoc = path.join(contents, 'MacOS', 'senddoc');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'senddoc'), 'senddoc');
  fs.symlinkSync('/temporary/LibreOffice.app/Contents/Resources/senddoc', senddoc);
  PrepareOfficeRuntime.normalizeBundleSymlinks(
    path.join(runtimeDirectory, 'libreoffice', 'LibreOffice.app'),
  );
  assert.equal(fs.readlinkSync(senddoc), path.join('..', 'Resources', 'senddoc'));
  assert.equal(fs.readFileSync(senddoc, 'utf8'), 'senddoc');

  const wrapper = path.join(temp, 'soffice');
  fs.writeFileSync(wrapper, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(wrapper, 0o755);
  assert.throws(
    () => PrepareOfficeRuntime.findLibreOffice({
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      runtimeDirectory: path.join(temp, 'empty-runtime'),
      commandLookup: () => wrapper,
    }),
    /未找到可打包的 LibreOffice/,
  );

  const pythonRoot = path.join(temp, 'python');
  const pkgconfig = path.join(pythonRoot, 'lib', 'pkgconfig');
  fs.mkdirSync(pkgconfig, { recursive: true });
  const versionedPkgconfig = path.join(pkgconfig, 'python-3.12.pc');
  const genericPkgconfig = path.join(pkgconfig, 'python3.pc');
  fs.writeFileSync(versionedPkgconfig, 'prefix=/portable/python');
  fs.symlinkSync('/temporary/python/lib/pkgconfig/python-3.12.pc', genericPkgconfig);
  PrepareOfficeRuntime.normalizePortableSymlinks(pythonRoot);
  assert.equal(fs.readlinkSync(genericPkgconfig), 'python-3.12.pc');
  assert.equal(fs.readFileSync(genericPkgconfig, 'utf8'), 'prefix=/portable/python');

  const brokenRelative = path.join(pkgconfig, 'broken.pc');
  fs.symlinkSync('missing.pc', brokenRelative);
  assert.throws(
    () => PrepareOfficeRuntime.normalizePortableSymlinks(pythonRoot),
    /损坏的符号链接/,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('MeteoMate Office Runtime preparation tests passed.');
