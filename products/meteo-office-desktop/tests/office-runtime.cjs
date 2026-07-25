'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OfficeConnector = require('../capabilities/office-connector.js');
const OfficeRuntime = require('../capabilities/office-runtime.cjs');
const officePackage = require('../services/office-mcp/package.json');

assert.equal(OfficeConnector.SAFE_TOOLS.length, 15);
assert.equal(officePackage.version, OfficeConnector.RUNTIME_VERSION);
assert.equal(OfficeConnector.toolRisk('docx_inspect'), 'observe');
assert.equal(OfficeConnector.toolRisk('pptx_inspect'), 'observe');
assert.equal(OfficeConnector.toolRisk('xlsx_edit'), 'mutation');
assert.equal(OfficeConnector.toolRisk('pdf_create'), 'mutation');
assert.equal(OfficeConnector.toolRisk('shell'), 'blocked');

const runtime = OfficeRuntime.resolveOfficeRuntime({
  productRoot: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    METEOMATE_PYTHON_PATH: process.execPath,
  },
  execPath: process.execPath,
  versions: process.versions,
  allowSystemFallback: true,
  probePython: () => ({
    'python-docx': 'test',
    'python-pptx': 'test',
    openpyxl: 'test',
    XlsxWriter: 'test',
    pypdf: 'test',
    reportlab: 'test',
    pypdfium2: 'test',
  }),
});
assert.ok(runtime.command);
assert.equal(runtime.argsPrefix.length, 1);
assert.ok(runtime.argsPrefix[0].endsWith(path.join('services', 'office-mcp', 'src', 'server.mjs')));
assert.equal(path.basename(runtime.env.METEOMATE_OFFICE_WORKER), 'worker.py');
assert.ok(fs.existsSync(runtime.env.METEOMATE_OFFICE_WORKER));
assert.ok(!path.relative(path.resolve(__dirname, '..'), runtime.env.METEOMATE_OFFICE_WORKER).startsWith('..'));
assert.equal(runtime.info.runtimeVersion, OfficeConnector.RUNTIME_VERSION);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-manifest-'));
try {
  const runtimeRoot = path.join(temp, 'runtime', 'office', `${process.platform}-${process.arch}`);
  const pythonPath = path.join(runtimeRoot, 'python', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python3');
  const sofficePath = path.join(runtimeRoot, 'libreoffice', 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice');
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.mkdirSync(path.dirname(sofficePath), { recursive: true });
  fs.writeFileSync(pythonPath, 'python-runtime');
  fs.writeFileSync(sofficePath, 'soffice-runtime');
  const criticalFiles = [pythonPath, sofficePath].map((filePath) => ({
    path: path.relative(runtimeRoot, filePath).split(path.sep).join('/'),
    sizeBytes: fs.statSync(filePath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  }));
  fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({
    schemaVersion: 'meteomate.office-runtime/v1',
    runtimeVersion: OfficeConnector.RUNTIME_VERSION,
    platform: process.platform,
    arch: process.arch,
    criticalFiles,
  }));
  const manifest = OfficeRuntime.verifyBundledManifest({
    productRoot: temp,
    platform: process.platform,
    arch: process.arch,
    python: { command: pythonPath },
    soffice: { command: sofficePath },
  });
  assert.equal(manifest.criticalFiles.length, 2);
  fs.appendFileSync(sofficePath, '-tampered');
  assert.throws(
    () => OfficeRuntime.verifyBundledManifest({
      productRoot: temp,
      platform: process.platform,
      arch: process.arch,
      python: { command: pythonPath },
      soffice: { command: sofficePath },
    }),
    /校验失败/
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('MeteoMate Office runtime resolution passed.');
