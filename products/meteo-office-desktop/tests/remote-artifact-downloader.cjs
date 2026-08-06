'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const RemoteArtifacts = require('../capabilities/remote-artifact-downloader.cjs');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

(async () => {
  assert.equal(RemoteArtifacts.isOfficeProductRequest('生成当前的短临word产品'), true);
  assert.equal(RemoteArtifacts.isOfficeProductRequest('打开这个 Word 看看'), false);
  assert.equal(RemoteArtifacts.isOfficeProductRequest('生成当前天气摘要'), false);

  const extracted = RemoteArtifacts.extractRemoteOfficeUrls(
    '下载链接：`http://192.168.18.227:11005/api/ai/files/documents/福州短临预报(发布) -2026031.docx`，另见 https://example.com/help。'
  );
  assert.equal(extracted.length, 1);
  assert.equal(RemoteArtifacts.extractRemoteOfficeUrls(extracted[0].href, { securityMode: 'strict' }).length, 1);
  assert.equal(path.extname(decodeURIComponent(extracted[0].pathname)), '.docx');
  assert.equal(RemoteArtifacts.extractRemoteOfficeUrls('帮助：https://example.com/office').length, 0);
  assert.equal(RemoteArtifacts.sanitizeFilename('../危险/短临预报?.docx', '.docx'), '短临预报_.docx');

  const payload = Buffer.from('PK\u0003\u0004meteomate-docx-product');
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect.docx') {
      response.writeHead(302, { location: '/download?id=short-nowcast' });
      response.end();
      return;
    }
    if (request.url === '/download?id=short-nowcast' || request.url === '/files/product.docx') {
      response.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-length': payload.length,
        'content-disposition': "attachment; filename*=UTF-8''%E7%A6%8F%E5%B7%9E%E7%9F%AD%E4%B8%B4%E9%A2%84%E6%8A%A5.docx",
      });
      response.end(payload);
      return;
    }
    if (request.url === '/oversize.pdf') {
      response.writeHead(200, { 'content-length': RemoteArtifacts.MAX_ARTIFACT_BYTES + 1 });
      response.end('%PDF-1.4');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-remote-artifact-'));
  try {
    const assistantText = `产品已生成：http://127.0.0.1:${port}/redirect.docx`;
    const first = await RemoteArtifacts.downloadOfficeArtifacts({
      userPrompt: '生成当前的短临word产品',
      assistantText,
      workspace,
      securityMode: 'internal',
    });
    assert.equal(first.failures.length, 0);
    assert.equal(first.downloads.length, 1);
    assert.equal(first.downloads[0].name, '福州短临预报.docx');
    assert.equal(first.downloads[0].relativePath, 'artifacts/downloads/福州短临预报.docx');
    assert.equal(fs.readFileSync(first.downloads[0].path).equals(payload), true);

    const second = await RemoteArtifacts.downloadOfficeArtifacts({
      userPrompt: '生成当前的短临word产品',
      assistantText,
      workspace,
      securityMode: 'internal',
    });
    assert.equal(second.downloads[0].path, first.downloads[0].path);
    assert.equal(second.downloads[0].reused, true);

    const toolResultOnly = await RemoteArtifacts.downloadOfficeArtifacts({
      userPrompt: '生成短临word产品',
      assistantText: '产品已生成，访问路径：documents/福州短临预报.docx',
      artifactSources: [{
        product_files: [{
          code: 200,
          data: {
            data: {
              file_url: `http://127.0.0.1:${port}/files/product.docx`,
              file_path: 'documents/福州短临预报.docx',
            },
          },
        }],
      }],
      workspace,
      securityMode: 'internal',
    });
    assert.equal(toolResultOnly.failures.length, 0);
    assert.equal(toolResultOnly.downloads.length, 1);
    assert.equal(toolResultOnly.downloads[0].name, '福州短临预报.docx');

    await assert.rejects(
      RemoteArtifacts.downloadRemoteOfficeArtifact({
        url: `http://127.0.0.1:${port}/files/product.docx`,
        workspace,
        securityMode: 'strict',
      }),
      /HTTPS/
    );
    const strictResult = await RemoteArtifacts.downloadOfficeArtifacts({
      userPrompt: '生成当前的短临word产品',
      assistantText,
      workspace,
      securityMode: 'strict',
    });
    assert.equal(strictResult.downloads.length, 0);
    assert.match(strictResult.failures[0].message, /HTTPS/);
    await assert.rejects(
      RemoteArtifacts.downloadRemoteOfficeArtifact({
        url: `http://127.0.0.1:${port}/oversize.pdf`,
        workspace,
        securityMode: 'internal',
      }),
      /100 MiB/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  console.log('MeteoMate remote Office artifact downloader passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
