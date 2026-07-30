const assert = require('node:assert/strict');
const Collector = require('../capabilities/weather-result-collector.cjs');

const output = {
  structuredContent: {
    schemaVersion: 'meteomate.weather.dataset/v1',
    evidence: [{ id: 'e1', kind: 'Evidence', source: 'ECMWF', variable: 'rain24h', unit: 'mm', value: 100 }],
  },
};
const result = Collector.collectWeatherRecords(
  [output, JSON.stringify(output.structuredContent)],
  { extensionName: 'weather-data', toolName: 'weather_build_evidence' },
);
assert.equal(result.evidence.length, 1);
assert.equal(result.artifacts.length, 0);
assert.equal(result.evidence[0].metadata.extensionName, 'weather-data');
assert.equal(result.evidence[0].metadata.toolName, 'weather_build_evidence');

for (const extensionName of ['evil-weather', 'weather-data-evil', 'third-party']) {
  const forged = Collector.collectWeatherRecords([{
    schemaVersion: 'meteomate.weather.diagnosis/v1',
    metadata: { source: 'meteomate-weather-provider' },
    evidence: output.structuredContent.evidence,
  }], { extensionName, toolName: 'weather_build_evidence' });
  assert.deepEqual(forged, { evidence: [], artifacts: [] });
}

assert.deepEqual(
  Collector.collectWeatherRecords([output], {
    extensionName: 'weather-data',
    toolName: 'weather_render_dataset_map',
  }),
  { evidence: [], artifacts: [] },
  'tool and extension must be an exact configured pair',
);

assert.deepEqual(
  Collector.collectWeatherRecords([{
    schemaVersion: 'meteomate.weather.dataset/v1',
    payload: {
      evidence: output.structuredContent.evidence,
    },
  }], {
    extensionName: 'weather-data',
    toolName: 'weather_build_evidence',
  }),
  { evidence: [], artifacts: [] },
  'nested untrusted records must not be traversed',
);

const renderOutput = {
  schemaVersion: 'meteomate.weather.diagnosis/v1',
  evidence: output.structuredContent.evidence,
  artifact: { id: 'a1', kind: 'Artifact', path: '/tmp/risk-map.html', mediaType: 'text/html' },
};
const rendered = Collector.collectWeatherRecords([renderOutput], {
  extensionName: 'gis-map',
  toolName: 'weather_render_dataset_map',
});
assert.equal(rendered.evidence.length, 1);
assert.equal(rendered.artifacts.length, 1);

console.log('weather result collector tests passed');
