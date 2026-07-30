const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConnectorClient = require('../capabilities/connector-client.cjs');
const WeatherConnector = require('../capabilities/weather-connector.js');

async function main() {
  const productRoot = path.resolve(__dirname, '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-runtime-'));
  try {
    const materialized = WeatherConnector.materialize(
      WeatherConnector.PRESETS['weather-data'],
      {
        productRoot,
        workspace,
        attestationKeyFile: path.join(workspace, 'profile', 'weather-provider.key'),
      },
    );
    assert.equal(
      materialized.runtimeEnv.METEOMATE_WEATHER_ATTESTATION_KEY_FILE,
      path.join(workspace, 'profile', 'weather-provider.key'),
    );
    const result = await ConnectorClient.testConnector(materialized);
    assert.equal(result.ok, true);
    assert.equal(result.transport, 'stdio');
    assert.equal(result.serverInfo.name, 'meteomate-weather-runtime');

    const discovered = new Map(result.tools.map((tool) => [tool.name, tool]));
    assert.deepEqual(
      [...discovered.keys()].sort(),
      WeatherConnector.TOOL_DEFINITIONS.map((tool) => tool.name).sort(),
    );
    for (const definition of WeatherConnector.TOOL_DEFINITIONS) {
      const tool = discovered.get(definition.name);
      assert.equal(tool.maturity, definition.maturity, `${definition.name} maturity`);
      assert.deepEqual(tool.effects, definition.effects, `${definition.name} effects`);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log('weather MCP runtime discovery tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
