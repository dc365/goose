'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const MacOSSigning = require('../scripts/macos-signing.cjs');

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
);
const packageMac = packageJson.scripts['package:mac'];

assert.match(packageMac, /macos-signing\.cjs assert-not-running/);
assert.match(packageMac, /macos-signing\.cjs sign/);
assert.doesNotMatch(packageMac, /--osx-sign/);
assert.doesNotMatch(packageMac, /codesign\b[^&]*--sign\s+-\b/);

const identityHash = '0123456789ABCDEF0123456789ABCDEF01234567';
assert.equal(
  MacOSSigning.parseCodesigningIdentity(
    `  1) ${identityHash} "${MacOSSigning.LOCAL_SIGNING_COMMON_NAME}" (CSSMERR_TP_NOT_TRUSTED)`,
  ),
  identityHash,
);
assert.equal(MacOSSigning.parseCodesigningIdentity('0 valid identities found'), '');
assert.equal(
  MacOSSigning.codesignRequirementIsStable(
    'designated => anchor trusted and certificate leaf[subject.CN] = "MeteoMate Local Signing"',
  ),
  true,
);
assert.equal(
  MacOSSigning.codesignRequirementIsStable(
    'designated => cdhash H"2541c8fb3399e79a36114d1a29862a3bc180ed95"',
  ),
  false,
);
assert.deepEqual(
  MacOSSigning.runningProcessIds('123\n456\n'),
  ['123', '456'],
);
assert.match(MacOSSigning.localSigningRequestSource(), /extendedKeyUsage=critical,codeSigning/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-signing-test-'));
try {
  const machOPath = path.join(temporaryDirectory, 'helper');
  const resourcePath = path.join(temporaryDirectory, 'Assets.car');
  fs.writeFileSync(machOPath, Buffer.from('feedfacf00000000', 'hex'));
  fs.writeFileSync(resourcePath, Buffer.from('424f4d53746f7265', 'hex'));
  assert.equal(MacOSSigning.isMachOFile(machOPath), true);
  assert.equal(MacOSSigning.skipNonCodeFile(machOPath), false);
  assert.equal(MacOSSigning.isMachOFile(resourcePath), false);
  assert.equal(MacOSSigning.skipNonCodeFile(resourcePath), true);

  const sourceBrowserRoot = path.join(temporaryDirectory, 'source-browsers');
  const sourceFramework = path.join(sourceBrowserRoot, 'Browser.framework');
  const sourceVersion = path.join(sourceFramework, 'Versions', '1');
  fs.mkdirSync(sourceVersion, { recursive: true });
  fs.writeFileSync(path.join(sourceVersion, 'Browser'), Buffer.from('feedfacf00000000', 'hex'));
  fs.symlinkSync('1', path.join(sourceFramework, 'Versions', 'Current'));
  fs.symlinkSync(
    path.join('Versions', 'Current', 'Browser'),
    path.join(sourceFramework, 'Browser'),
  );

  const appPath = path.join(temporaryDirectory, 'MeteoMate.app');
  const packagedFramework = path.join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'runtime',
    'browsers',
    'Browser.framework',
  );
  fs.mkdirSync(path.join(packagedFramework, 'Versions', 'Current'), { recursive: true });
  fs.writeFileSync(
    path.join(packagedFramework, 'Versions', 'Current', 'Browser'),
    Buffer.from('feedfacf00000000', 'hex'),
  );
  fs.writeFileSync(
    path.join(packagedFramework, 'Browser'),
    Buffer.from('feedfacf00000000', 'hex'),
  );

  assert.equal(
    MacOSSigning.repairPackagedBrowserSymlinks(appPath, sourceBrowserRoot),
    2,
  );
  assert.equal(
    fs.readlinkSync(path.join(packagedFramework, 'Versions', 'Current')),
    '1',
  );
  assert.equal(
    fs.readlinkSync(path.join(packagedFramework, 'Browser')),
    path.join('Versions', 'Current', 'Browser'),
  );

  const sourceOfficeRoot = path.join(temporaryDirectory, 'source-office');
  const sourceOfficeMacOS = path.join(
    sourceOfficeRoot,
    'darwin-arm64',
    'libreoffice',
    'LibreOffice.app',
    'Contents',
    'MacOS',
  );
  fs.mkdirSync(sourceOfficeMacOS, { recursive: true });
  const sourceOfficeSenddoc = path.join(sourceOfficeMacOS, '..', 'Resources', 'senddoc');
  fs.mkdirSync(path.dirname(sourceOfficeSenddoc), { recursive: true });
  fs.writeFileSync(sourceOfficeSenddoc, 'senddoc');
  fs.symlinkSync(
    path.join('..', 'Resources', 'senddoc'),
    path.join(sourceOfficeMacOS, 'senddoc'),
  );
  const packagedOfficeMacOS = path.join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'runtime',
    'office',
    'darwin-arm64',
    'libreoffice',
    'LibreOffice.app',
    'Contents',
    'MacOS',
  );
  const packagedOfficeSenddoc = path.join(packagedOfficeMacOS, '..', 'Resources', 'senddoc');
  fs.mkdirSync(path.dirname(packagedOfficeSenddoc), { recursive: true });
  fs.writeFileSync(packagedOfficeSenddoc, 'senddoc');
  fs.mkdirSync(path.join(packagedOfficeMacOS, 'senddoc'), { recursive: true });
  fs.writeFileSync(path.join(packagedOfficeMacOS, 'senddoc', 'dereferenced'), 'senddoc');
  assert.equal(
    MacOSSigning.repairPackagedOfficeSymlinks(appPath, sourceOfficeRoot),
    1,
  );
  assert.equal(
    fs.readlinkSync(path.join(packagedOfficeMacOS, 'senddoc')),
    path.join('..', 'Resources', 'senddoc'),
  );
  assert.equal(fs.readFileSync(path.join(packagedOfficeMacOS, 'senddoc'), 'utf8'), 'senddoc');

  const packagedOfficeRuntime = path.join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'runtime',
    'office',
    'darwin-arm64',
  );
  const criticalFile = path.join(packagedOfficeRuntime, 'python', 'bin', 'python3');
  fs.mkdirSync(path.dirname(criticalFile), { recursive: true });
  fs.writeFileSync(criticalFile, Buffer.from('feedfacf00000000', 'hex'));
  const manifestPath = path.join(packagedOfficeRuntime, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 'meteomate.office-runtime/v1',
    criticalFiles: [{
      path: 'python/bin/python3',
      sizeBytes: 1,
      sha256: 'stale',
    }],
  }));
  assert.equal(MacOSSigning.refreshPackagedOfficeManifests(appPath), 1);
  const refreshedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(refreshedManifest.criticalFiles[0].sizeBytes, 8);
  assert.match(refreshedManifest.criticalFiles[0].sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(refreshedManifest.criticalFiles[0].sha256, 'stale');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('MeteoMate stable macOS signing tests passed.');
