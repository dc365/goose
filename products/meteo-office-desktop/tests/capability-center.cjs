'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCapabilityService } = require('../capabilities/service.cjs');
const { parseZipBuffer } = require('../capabilities/safe-zip.cjs');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content || '', 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const localBuffer = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function createSkill(root, name = 'sample-skill') {
  const directory = path.join(root, name);
  fs.mkdirSync(path.join(directory, 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A focused test skill used when validating local capability installation.\nmetadata:\n  version: "1.0.0"\n---\n\n# Test\n\n1. Read input.\n2. Return output.\n3. Verify the result.\n`
  );
  fs.writeFileSync(path.join(directory, 'references', 'guide.md'), '# Guide\n');
  fs.writeFileSync(
    path.join(directory, 'meteomate.json'),
    JSON.stringify({ requires: { connectors: ['weather-data-local'] }, permissions: { shell: false } }, null, 2)
  );
  return directory;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-capability-test-'));
const userData = path.join(temp, 'user-data');
const homeDir = path.join(temp, 'home');
const productRoot = path.join(temp, 'product');
fs.mkdirSync(path.join(productRoot, 'bundled-skills'), { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
const ipcHandlers = new Map();
const service = createCapabilityService({
  app: { getPath: (name) => (name === 'userData' ? userData : path.join(temp, name)) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').slice(4),
  },
  shell: { openPath: async () => '' },
  productRoot,
  homeDir,
});
service.registerIpc();
assert.ok(ipcHandlers.has('capability:install-skill'));
assert.ok(ipcHandlers.has('capability:save-connector'));

const sourceRoot = path.join(temp, 'source');
fs.mkdirSync(sourceRoot, { recursive: true });
const skillDirectory = createSkill(sourceRoot);
const inspection = service.inspectSkill(skillDirectory);
assert.equal(inspection.report.skill.id, 'sample-skill');
assert.equal(inspection.report.risk.level, 'low');
assert.equal(inspection.report.autoInstallEligible, true);
const installed = service.installSkill({ token: inspection.token, reportHash: inspection.report.reportHash, scope: 'user' });
assert.equal(installed.installation.enabled, true);
assert.deepEqual(installed.installation.sidecar.requires.connectors, ['weather-data-local']);
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'sample-skill', 'SKILL.md')));

const disabled = service.setSkillEnabled(installed.installation.id, false);
assert.equal(disabled.installation.enabled, false);
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'disabled-skills', 'sample-skill', 'SKILL.md')));
const enabled = service.setSkillEnabled(installed.installation.id, true);
assert.equal(enabled.installation.enabled, true);

const zipPath = path.join(temp, 'zip-skill.zip');
fs.writeFileSync(zipPath, createStoredZip([
  { name: 'zip-skill/SKILL.md', content: '---\nname: zip-skill\ndescription: Test ZIP skill used when importing a package.\n---\n\n# Steps\n\n1. Run.\n2. Verify.\n' },
  { name: 'zip-skill/assets/readme.txt', content: 'asset' },
]));
const zipInspection = service.inspectSkill(zipPath);
assert.equal(zipInspection.report.skill.id, 'zip-skill');
assert.equal(zipInspection.report.files.length, 2);
const zipInstall = service.installSkill({ token: zipInspection.token, reportHash: zipInspection.report.reportHash, scope: 'user' });
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'zip-skill', 'SKILL.md')));

assert.throws(
  () => parseZipBuffer(createStoredZip([{ name: '../escape.txt', content: 'no' }])),
  /escapes the package root/
);

const connectorResult = service.saveConnector({
  id: 'weather-data-local',
  name: 'Weather Data Local',
  description: 'Test connector',
  transport: 'stdio',
  command: process.execPath,
  args: ['--version'],
  env: 'API_TOKEN=secret-value',
  projectIds: ['project-1'],
  enabled: true,
});
assert.deepEqual(connectorResult.connector.secretKeys.env, ['API_TOKEN']);
assert.equal(Object.prototype.hasOwnProperty.call(connectorResult.connector, 'secrets'), false);
const connectorUpdate = service.saveConnector({
  id: 'weather-data-local',
  name: 'Weather Data Local Updated',
  description: 'Updated without re-entering secrets',
  transport: 'stdio',
  command: process.execPath,
  args: ['--version'],
  projectIds: ['project-1'],
  enabled: true,
});
assert.deepEqual(connectorUpdate.connector.secretKeys.env, ['API_TOKEN']);
const extensions = service.extensionsForRequest({ connectorIds: ['weather-data-local'], projectId: 'project-1' });
assert.equal(extensions.length, 1);
assert.equal(extensions[0].type, 'stdio');
assert.equal(extensions[0].envs.API_TOKEN, 'secret-value');

const removed = service.uninstallSkill(installed.installation.id);
assert.equal(removed.removed, true);
assert.equal(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'sample-skill')), false);
service.uninstallSkill(zipInstall.installation.id);

fs.rmSync(temp, { recursive: true, force: true });
console.log('MeteoMate Capability Center tests passed.');
