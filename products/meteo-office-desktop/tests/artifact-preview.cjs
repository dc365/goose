'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ArtifactPreviewModel = require('../harness/artifact-preview');
const ArtifactPreview = require('../capabilities/artifact-preview.cjs');
const ArtifactFileActions = require('../capabilities/artifact-file-actions.cjs');
const OfficePreview = require('../capabilities/office-preview.cjs');

async function main() {
  assert.equal(ArtifactPreviewModel.pathExtension('https://example.com/demo.html?theme=dark'), 'html');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/demo.html' }), 'web');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/report.pdf' }), 'document');
  assert.equal(ArtifactPreviewModel.artifactKind({ path: '/tmp/chart.png' }), 'image');
  const macApplications = ArtifactFileActions.macApplicationsForFile('/workspace/report.docx', (candidate) =>
    ['/Applications/wpsoffice.app', '/Applications/Microsoft Word.app'].includes(candidate)
  );
  assert.deepEqual(
    macApplications.map((application) => application.name),
    ['WPS Office', 'Microsoft Word']
  );
  assert.equal(ArtifactFileActions.locationMenuLabel('darwin'), '在 Finder 中显示');
  assert.equal(ArtifactFileActions.locationMenuLabel('win32'), '在文件资源管理器中显示');
  assert.equal(
    ArtifactFileActions.fileClipboardCommand('/workspace/report.docx', 'darwin').command,
    'osascript'
  );
  assert.equal(
    ArtifactFileActions.openWithChooserCommand('C:\\report.docx', 'win32').command,
    'rundll32.exe'
  );
  assert.equal(
    ArtifactPreviewModel.previewErrorDetail(
      "Error invoking remote method 'artifact-preview:show': Error: 预览文件不存在或已无法访问"
    ),
    '成果文件不存在或已无法访问。它可能已被移动、删除，或任务临时目录已清理，请重新运行任务生成。'
  );
  assert.equal(
    ArtifactPreviewModel.previewErrorDetail(
      "Error invoking remote method 'artifact-preview:show': Error: 当前成果物不是可预览文件"
    ),
    '当前成果物不是可预览文件'
  );

  const officeTab = ArtifactPreviewModel.createPreviewTab({
    id: 'artifact-report',
    name: 'report.docx',
    path: '/workspace/report.docx',
    metadata: {
      render: {
        pageCount: 2,
        previewUri: 'file:///workspace/report-preview.pdf',
      },
    },
  }, {
    taskId: 'task-1',
    workspace: '/workspace',
  });
  assert.equal(officeTab.id, 'preview-artifact-report');
  assert.equal(officeTab.kind, 'document');
  assert.equal(officeTab.pageCount, 2);
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
    const officePreview = await ArtifactPreview.resolvePreviewTarget({
      target: officePath,
      roots: [workspace],
    });
    assert.equal(officePreview.kind, 'office');
    assert.equal(officePreview.loadUrl, null);
    assert.equal(officePreview.root, fs.realpathSync(workspace));

    let workerCalls = 0;
    const renderedOffice = await OfficePreview.renderOfficePreview({
      sourcePath: officePath,
      workspace,
      productRoot: workspace,
      resolveRuntime: () => ({
        env: {
          METEOMATE_OFFICE_PYTHON: '/runtime/python',
          METEOMATE_OFFICE_WORKER: '/runtime/worker.py',
          METEOMATE_OFFICE_RUNTIME_VERSION: '1.3.0',
          METEOMATE_SOFFICE_PATH: '/runtime/soffice',
        },
        info: { libreOfficeAvailable: true },
      }),
      executeWorker: async (_configuration, input) => {
        workerCalls += 1;
        const sourceHash = await OfficePreview.sha256File(officePath);
        const previewDirectory = path.join(workspace, '.meteomate', 'previews', sourceHash.slice(0, 24));
        const previewPath = path.join(previewDirectory, 'preview.pdf');
        const thumbnailPath = path.join(previewDirectory, 'page-1.png');
        const textLayerPath = path.join(previewDirectory, 'text-layer.json');
        fs.mkdirSync(previewDirectory, { recursive: true });
        fs.writeFileSync(previewPath, '%PDF-1.4\n%%EOF\n');
        fs.writeFileSync(thumbnailPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        fs.writeFileSync(textLayerPath, JSON.stringify({
          schemaVersion: 'meteomate.preview-text/v1',
          sourceHash,
          pages: [{
            page: 1,
            width: 612,
            height: 792,
            spans: [{ text: '天气概况', x: 90, y: 80, width: 56, height: 14 }],
          }],
          spanCount: 1,
          characterCount: 4,
          truncated: false,
        }));
        const render = {
          schemaVersion: 'meteomate.preview/v1',
          sourcePath: input.sourcePath,
          sourceHash,
          previewPath: path.relative(workspace, previewPath),
          pageCount: 3,
          thumbnails: [path.relative(workspace, thumbnailPath)],
          textLayerPath: path.relative(workspace, textLayerPath),
        };
        fs.writeFileSync(
          path.join(previewDirectory, 'manifest.json'),
          `${JSON.stringify(render)}\n`,
        );
        return { render };
      },
    });
    assert.equal(renderedOffice.cached, false);
    assert.equal(renderedOffice.pageCount, 3);
    assert.equal(renderedOffice.thumbnailPaths.length, 1);
    assert.equal(renderedOffice.textLayer.pages[0].spans[0].text, '天气概况');
    assert.equal(workerCalls, 1);

    const resolvedSelection = await OfficePreview.resolveDocxSelection({
      sourcePath: officePath,
      sourceHash: await OfficePreview.sha256File(officePath),
      selectedText: '天气概况',
      workspace,
      productRoot: workspace,
      resolveRuntime: () => ({
        env: {
          METEOMATE_OFFICE_PYTHON: '/runtime/python',
          METEOMATE_OFFICE_WORKER: '/runtime/worker.py',
          METEOMATE_OFFICE_RUNTIME_VERSION: '1.3.0',
          METEOMATE_SOFFICE_PATH: '/runtime/soffice',
        },
        info: { libreOfficeAvailable: true },
      }),
      executeWorker: async (_configuration, toolName, input) => {
        assert.equal(toolName, 'docx_resolve_selection');
        assert.equal(input.sourcePath, 'report.docx');
        return {
          editable: true,
          reason: '已定位唯一正文段落',
          anchor: {
            version: 'meteomate.docx-anchor/v1',
            paragraphId: 'paragraph:0',
            paragraphIndex: 0,
            paragraphTextHash: 'a'.repeat(64),
            selectedTextHash: 'b'.repeat(64),
            normalizedStart: 0,
            normalizedEnd: 4,
          },
        };
      },
    });
    assert.equal(resolvedSelection.editable, true);
    assert.equal(resolvedSelection.anchor.paragraphId, 'paragraph:0');

    const cachedOffice = await OfficePreview.renderOfficePreview({
      sourcePath: officePath,
      workspace,
      productRoot: workspace,
      resolveRuntime: () => {
        throw new Error('缓存命中时不应解析运行时');
      },
      executeWorker: async () => {
        throw new Error('缓存命中时不应再次渲染');
      },
    });
    assert.equal(cachedOffice.cached, true);
    assert.equal(cachedOffice.pageCount, 3);
    assert.equal(cachedOffice.thumbnailPaths.length, 1);
    assert.equal(cachedOffice.textLayer.spanCount, 1);
    assert.equal(workerCalls, 1);
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
