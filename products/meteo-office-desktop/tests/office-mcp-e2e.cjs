'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OfficeRuntime = require('../capabilities/office-runtime.cjs');

async function main() {
  const productRoot = path.resolve(__dirname, '..');
  const resolvedRuntime = OfficeRuntime.resolveOfficeRuntime({
    productRoot,
    env: {
      ...process.env,
      ...(process.env.METEOMATE_OFFICE_TEST_PYTHON
        ? { METEOMATE_PYTHON_PATH: process.env.METEOMATE_OFFICE_TEST_PYTHON }
        : {}),
    },
  });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-mcp-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const transport = new StdioClientTransport({
    command: resolvedRuntime.command,
    args: resolvedRuntime.argsPrefix,
    cwd: workspace,
    env: {
      PATH: process.env.PATH || '',
      LANG: process.env.LANG || 'C.UTF-8',
      ...resolvedRuntime.env,
      METEOMATE_OFFICE_WORKSPACE: workspace,
      METEOMATE_OFFICE_RUNTIME_VERSION: 'test',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'meteomate-office-e2e', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        'artifact_render',
        'artifact_validate',
        'docx_create',
        'docx_edit',
        'docx_inspect',
        'pdf_create',
        'pdf_inspect',
        'pdf_transform',
        'pptx_create',
        'pptx_edit',
        'pptx_inspect',
        'xlsx_create',
        'xlsx_edit',
        'xlsx_inspect',
      ],
    );
    const created = await client.callTool({
      name: 'pdf_create',
      arguments: {
        schemaVersion: 'meteomate.office/v1',
        workspaceId: 'project-current',
        outputPath: 'artifacts/mcp-report.pdf',
        spec: {
          title: 'MCP 天气专报',
          blocks: [{ type: 'paragraph', text: '结构化 Artifact 测试。' }],
        },
      },
    });
    assert.equal(created.isError, undefined);
    assert.equal(created.structuredContent.schemaVersion, 'meteomate.office/v1');
    assert.equal(created.structuredContent.artifact.status, 'draft');
    assert.ok(fs.existsSync(path.join(workspace, created.structuredContent.artifact.path)));

    const validated = await client.callTool({
      name: 'artifact_validate',
      arguments: {
        schemaVersion: 'meteomate.office/v1',
        workspaceId: 'project-current',
        sourcePath: created.structuredContent.artifact.path,
        requireRender: true,
      },
    });
    assert.equal(validated.isError, undefined);
    assert.equal(validated.structuredContent.valid, true);
    assert.equal(validated.structuredContent.artifact.status, 'ready');
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log('MeteoMate Office MCP tool calls end-to-end passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
