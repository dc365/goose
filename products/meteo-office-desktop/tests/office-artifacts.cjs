'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OfficeArtifacts = require('../capabilities/office-artifact-collector.cjs');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-artifacts-'));
try {
  const artifactPath = path.join(workspace, 'artifacts', 'report.pdf');
  const previewPath = path.join(workspace, '.meteomate', 'previews', 'report', 'preview.pdf');
  const thumbnailPath = path.join(workspace, '.meteomate', 'previews', 'report', 'page-1.png');
  const manifestPath = path.join(workspace, '.meteomate', 'previews', 'report', 'manifest.json');
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  fs.writeFileSync(artifactPath, '%PDF-1.4\n%%EOF\n');
  fs.writeFileSync(previewPath, '%PDF-1.4\n%%EOF\n');
  fs.writeFileSync(thumbnailPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(manifestPath, '{}');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  const input = {
    apiVersion: 'meteomate/v1',
    kind: 'Artifact',
    id: `artifact-office-${digest.slice(0, 24)}`,
    name: 'ignored-name.pdf',
    type: 'PDF',
    path: 'artifacts/report.pdf',
    mediaType: 'application/pdf',
    status: 'ready',
    sizeBytes: 1,
    contentHash: digest,
    metadata: {
      source: 'office-artifacts',
      render: {
        pageCount: 1,
        previewPath: '.meteomate/previews/report/preview.pdf',
        thumbnailPath: '.meteomate/previews/report/page-1.png',
        previewManifestPath: '.meteomate/previews/report/manifest.json',
      },
    },
  };
  const artifact = OfficeArtifacts.materializeOfficeArtifact(input, { workspace });
  assert.equal(artifact.path, fs.realpathSync(artifactPath));
  assert.equal(artifact.name, 'report.pdf');
  assert.equal(artifact.sizeBytes, fs.statSync(artifactPath).size);
  assert.ok(artifact.metadata.render.previewUri.startsWith('file:'));
  assert.ok(artifact.metadata.render.thumbnailUri.startsWith('file:'));
  assert.equal(artifact.metadata.relativePath, 'artifacts/report.pdf');

  const collected = OfficeArtifacts.collectOfficeArtifacts(
    JSON.stringify({ structuredContent: { artifact: input } }),
    { workspace }
  );
  assert.equal(collected.length, 1);
  assert.equal(collected[0].contentHash, digest);

  for (const [extension, mediaType, type] of [
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PRESENTATION'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'SPREADSHEET'],
  ]) {
    const filePath = path.join(workspace, 'artifacts', `sample.${extension}`);
    fs.writeFileSync(filePath, Buffer.from('PK\u0003\u0004office-artifact'));
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const materialized = OfficeArtifacts.materializeOfficeArtifact({
      ...input,
      id: `artifact-office-${fileHash.slice(0, 24)}`,
      name: `sample.${extension}`,
      type,
      path: `artifacts/sample.${extension}`,
      mediaType,
      status: 'draft',
      contentHash: fileHash,
      metadata: {
        source: 'office-artifacts',
        format: extension,
      },
    }, { workspace });
    assert.equal(materialized.type, type);
    assert.equal(materialized.mediaType, mediaType);
  }

  assert.throws(
    () => OfficeArtifacts.materializeOfficeArtifact(
      { ...input, path: '../outside.pdf' },
      { workspace }
    ),
    /工作区/
  );
  assert.throws(
    () => OfficeArtifacts.materializeOfficeArtifact(
      { ...input, contentHash: '0'.repeat(64) },
      { workspace }
    ),
    /hash/
  );
  assert.deepEqual(
    OfficeArtifacts.collectOfficeArtifacts(
      { ...input, metadata: { source: 'untrusted' } },
      { workspace }
    ),
    []
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('MeteoMate Office Artifact collector passed.');
