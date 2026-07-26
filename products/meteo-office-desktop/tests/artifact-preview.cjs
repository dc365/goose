'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ArtifactPreviewModel = require('../harness/artifact-preview');
const ArtifactPreview = require('../capabilities/artifact-preview.cjs');

async function main() {
  assert.equal(ArtifactPreviewModel.pathExtension('https://example.com/demo.html?theme=dark'), 'html');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/demo.html' }), 'web');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/report.pdf' }), 'document');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/chart.png' }), 'image');

  const officeTab = ArtifactPreviewModel.createPreviewTab({
    id: 'artifact-report',
    name: 'report.docx',
    path: '/workspace/report.docx',
    metadata: {
      render: {
        previewUri: 'file:///workspace/report-preview.pdf',
      },
    },
  }, {
    taskId: 'task-1',
    workspace: '/workspace',
  });
  assert.equal(officeTab.id, 'preview-artifact-report');
  assert.equal(officeTab.kind, 'document');
  assert.equal(officeTab.surfaceTarget, 'file:///workspace/report-preview.pdf');
  assert.equal(officeTab.target, '/workspace/report.docx');
  assert.equal(ArtifactPreviewModel.normalizePanelWidth(700, 900), 460);
  assert.equal(ArtifactPreviewModel.normalizePanelWidth(200, 1400), 420);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-preview-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-preview-outside-'));
  try {
    const htmlPath = path.join(workspace, 'demo.html');
    const codePath = path.join(workspace, 'demo.js');
    const markdownPath = path.join(workspace, 'notes.md');
    const officePath = path.join(workspace, 'report.docx');
    const outsidePath = path.join(outside, 'secret.txt');
    fs.writeFileSync(htmlPath, '<!doctype html><title>Demo</title><button>Start</button>');
    fs.writeFileSync(codePath, 'const weather = "rain";\n');
    fs.writeFileSync(markdownPath, '# Weather\n\n- Rain\n- Wind\n');
    fs.writeFileSync(officePath, 'PK\u0003\u0004office');
    fs.writeFileSync(outsidePath, 'private');

    const htmlPreview = await ArtifactPreview.resolvePreviewTarget({
      target: htmlPath,
      roots: [workspace],
    });
    assert.equal(htmlPreview.kind, 'web');
    assert.equal(htmlPreview.loadUrl, pathToFileURL(fs.realpathSync(htmlPath)).href);

    const codePreview = await ArtifactPreview.resolvePreviewTarget({
      target: codePath,
      roots: [workspace],
    });
    assert.equal(codePreview.kind, 'code');
    assert.ok(codePreview.loadUrl.startsWith('data:text/html'));
    assert.ok(decodeURIComponent(codePreview.loadUrl).includes('weather'));

    const markdownPreview = await ArtifactPreview.resolvePreviewTarget({
      target: markdownPath,
      roots: [workspace],
    });
    const markdownHtml = decodeURIComponent(markdownPreview.loadUrl);
    assert.equal(markdownPreview.kind, 'document');
    assert.ok(markdownHtml.includes('<h1>Weather</h1>'));
    assert.ok(markdownHtml.includes('<li>Rain</li>'));

    const remotePreview = await ArtifactPreview.resolvePreviewTarget({
      target: 'https://example.com/dashboard',
      roots: [],
    });
    assert.equal(remotePreview.kind, 'web');
    assert.equal(remotePreview.address, 'https://example.com/dashboard');

    await assert.rejects(
      ArtifactPreview.resolvePreviewTarget({ target: outsidePath, roots: [workspace] }),
      /超出当前授权工作区/
    );
    await assert.rejects(
      ArtifactPreview.resolvePreviewTarget({ target: officePath, roots: [workspace] }),
      /尚未生成可视化预览/
    );
    assert.equal(
      ArtifactPreview.navigationAllowed(pathToFileURL(htmlPath).href, htmlPreview, [workspace]),
      true
    );
    assert.equal(
      ArtifactPreview.navigationAllowed(pathToFileURL(outsidePath).href, htmlPreview, [workspace]),
      false
    );
    assert.equal(
      ArtifactPreview.navigationAllowed('javascript:alert(1)', htmlPreview, [workspace]),
      false
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }

  console.log('MeteoMate artifact preview tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
