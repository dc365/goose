const assert = require('node:assert/strict');
const Collector = require('../capabilities/weather-result-collector.cjs');

const output = {
  structuredContent: {
    schemaVersion: 'meteomate.weather.diagnosis/v1',
    evidence: [{ id: 'e1', kind: 'Evidence', source: 'ECMWF', variable: 'rain24h', unit: 'mm', value: 100 }],
    artifact: { id: 'a1', kind: 'Artifact', path: '/tmp/risk-map.html', mediaType: 'text/html' },
  },
};
const result = Collector.collectWeatherRecords([output, JSON.stringify(output.structuredContent)], { extensionName: 'weather-data' });
assert.equal(result.evidence.length, 1);
assert.equal(result.artifacts.length, 1);
assert.equal(result.evidence[0].metadata.extensionName, 'weather-data');
console.log('weather result collector tests passed');
