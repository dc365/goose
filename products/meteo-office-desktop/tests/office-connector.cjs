'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConnectorClient = require('../capabilities/connector-client.cjs');
const OfficeConnector = require('../capabilities/office-connector.js');

async function main() {
  const productRoot = path.resolve(__dirname, '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-connector-'));
  try {
    const runtime = {
      command: process.execPath,
      argsPrefix: [path.join(productRoot, 'services', 'office-mcp', 'src', 'server.mjs')],
      env: {
        METEOMATE_OFFICE_PYTHON: process.execPath,
        METEOMATE_OFFICE_WORKER: path.join(productRoot, 'services', 'office-mcp', 'python', 'worker.py'),
        METEOMATE_OFFICE_RUNTIME_VERSION: OfficeConnector.RUNTIME_VERSION,
      },
      info: {
        source: 'test-runtime',
        managed: true,
        runtimeVersion: OfficeConnector.RUNTIME_VERSION,
      },
    };
    const materialized = OfficeConnector.materialize(OfficeConnector.PRESET, { runtime, workspace });
    assert.equal(materialized.id, OfficeConnector.ID);
    assert.equal(materialized.cwd, workspace);
    assert.equal(materialized.runtimeEnv.METEOMATE_OFFICE_WORKSPACE, workspace);
    assert.deepEqual(materialized.toolAllowlist, OfficeConnector.SAFE_TOOLS);

    const result = await ConnectorClient.testConnector(materialized);
    assert.equal(result.ok, true);
    assert.equal(result.transport, 'stdio');
    assert.equal(result.serverInfo.name, 'meteomate-office-artifacts');
    assert.deepEqual(
      result.tools.map((tool) => tool.name).sort(),
      [...OfficeConnector.SAFE_TOOLS].sort()
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log('MeteoMate Office MCP connector passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
