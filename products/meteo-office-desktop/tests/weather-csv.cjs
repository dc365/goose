'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Contracts = require('../capabilities/weather/contracts.cjs');
const Providers = require('../capabilities/weather/providers.cjs');
const WeatherConnector = require('../capabilities/weather-connector.js');

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-weather-csv-'));
  try {
  const artifacts = WeatherConnector.exportDemoBundle({ workspace });
  const csvArtifact = artifacts.find((artifact) => artifact.mediaType === 'text/csv');
  assert.ok(csvArtifact);
  const imported = Providers.csvDataset(fs.readFileSync(csvArtifact.path, 'utf8'), {
    datasetId: 'csv-roundtrip',
    name: 'CSV 往返资料',
    region: WeatherConnector.SYNTHETIC_CASE.region,
    issueTime: WeatherConnector.SYNTHETIC_CASE.validTime.issueTime,
    validTime: {
      start: WeatherConnector.SYNTHETIC_CASE.validTime.start,
      end: WeatherConnector.SYNTHETIC_CASE.validTime.end,
    },
  });
  const normalized = Contracts.normalizeDataset(imported, {
    id: 'csv-replay',
    name: 'CSV Replay',
    type: 'local',
    version: '1',
    classification: 'experimental',
    official: false,
    synthetic: false,
    authority: 'workspace',
  });

  assert.equal(Contracts.validateDataset(normalized).valid, true);
  assert.equal(normalized.stations.length, WeatherConnector.SYNTHETIC_CASE.stations.length);
  for (const expected of WeatherConnector.SYNTHETIC_CASE.stations) {
    const actual = normalized.stations.find((station) => station.id === expected.id);
    assert.ok(actual, `missing station ${expected.id}`);
    for (const field of ['rain1h', 'rain6h', 'rain24h', 'temperature', 'dewpoint', 'windSpeed']) {
      assert.equal(actual[field], expected[field], `${expected.id}.${field} changed during CSV roundtrip`);
    }
  }

  const leadingZero = Providers.csvDataset([
    'station_id,station_name,lon,lat,rain_24h_mm,quality',
    '001,"匿名,一号站",112.5,23.1,88,checked',
  ].join('\n'), {
    datasetId: 'leading-zero',
    region: {
      name: '匿名区域',
      bbox: [110, 20, 116, 26],
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
    },
    issueTime: '2026-07-30T00:00:00Z',
    validTime: { end: '2026-07-31T00:00:00Z' },
  });
  assert.equal(leadingZero.stations[0].id, '001');
  assert.equal(leadingZero.stations[0].name, '匿名,一号站');
  assert.equal(leadingZero.stations[0].rain24h, 88);
  assert.equal(leadingZero.units.rain24h, 'mm');

  const multiline = Providers.csvDataset([
    'station_id,station_name,lon,lat,rain_24h_mm,quality',
    '001,"匿名',
    '一号站",112.5,23.1,88,checked',
  ].join('\n'), {
    datasetId: 'multiline',
    region: {
      name: '匿名区域',
      bbox: [110, 20, 116, 26],
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
    },
    issueTime: '2026-07-30T00:00:00Z',
    validTime: { end: '2026-07-31T00:00:00Z' },
  });
  assert.equal(multiline.stations[0].name, '匿名\n一号站');

  assert.throws(
    () => Providers.csvDataset('id,id,lon\n001,duplicate,112'),
    /表头不能重复/,
  );
  assert.throws(
    () => Providers.csvDataset('id,name,lon\n001,name'),
    /列数与表头不一致/,
  );
  assert.throws(
    () => Providers.csvDataset('id,name\n001,\"unterminated'),
    /未闭合的引号/,
  );

  const geojson = Providers.geoJSONDataset({
    type: 'FeatureCollection',
    bbox: [110, 20, 116, 26],
    properties: {
      id: 'geojson-roundtrip',
      name: 'GeoJSON 站点资料',
      regionName: '匿名区域',
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
      issueTime: '2026-07-30T00:00:00Z',
      validTime: { end: '2026-07-31T00:00:00Z' },
      units: { rain24h: 'mm' },
    },
    features: [{
      type: 'Feature',
      id: 'G001',
      geometry: { type: 'Point', coordinates: [112.5, 23.1] },
      properties: { name: '匿名 GeoJSON 站', rain24h: 66, quality: 'checked' },
    }],
  });
  const normalizedGeojson = Contracts.normalizeDataset(geojson, {
    id: 'geojson-replay',
    type: 'local',
    version: '1',
    classification: 'experimental',
    authority: 'workspace',
  });
  assert.equal(Contracts.validateDataset(normalizedGeojson).valid, true);
  assert.equal(normalizedGeojson.stations[0].id, 'G001');
  assert.equal(normalizedGeojson.stations[0].rain24h, 66);
  assert.throws(
    () => Providers.geoJSONDataset({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }],
    }),
    /Point Feature/,
  );

  const localData = path.join(workspace, 'provider-data');
  const registryDirectory = path.join(workspace, '.meteomate');
  fs.mkdirSync(localData, { recursive: true });
  fs.mkdirSync(registryDirectory, { recursive: true });
  fs.writeFileSync(path.join(registryDirectory, 'weather-sources.json'), JSON.stringify({
    apiVersion: 'meteomate.weather/v1',
    kind: 'WeatherSourceRegistry',
    sources: [{
      id: 'adapter-local',
      name: 'Adapter local source',
      type: 'local',
      root: 'provider-data',
    }],
  }));
  fs.writeFileSync(path.join(localData, 'stations.csv'), [
    'station_id,station_name,lon,lat,rain_24h_mm,quality',
    'CSV-001,CSV station,112.5,23.1,88,checked',
  ].join('\n'));
  fs.writeFileSync(path.join(localData, 'stations.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    bbox: [110, 20, 116, 26],
    properties: {
      name: 'GeoJSON without explicit id',
      regionName: '匿名区域',
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
      issueTime: '2026-07-30T00:00:00Z',
      validTime: { end: '2026-07-31T00:00:00Z' },
      units: { rain24h: 'mm' },
    },
    features: [{
      type: 'Feature',
      id: 'G-NO-ID',
      geometry: { type: 'Point', coordinates: [112.5, 23.1] },
      properties: { name: 'GeoJSON station', rain24h: 66, quality: 'checked' },
    }],
  }));
  const csvQuery = {
    region: {
      name: '匿名区域',
      bbox: [110, 20, 116, 26],
      timezone: 'Asia/Shanghai',
      projection: 'EPSG:4326',
    },
    issueTime: '2026-07-30T00:00:00Z',
    validTime: { end: '2026-07-31T00:00:00Z' },
  };
  const queriedCsv = await Providers.queryDataset({
    workspace,
    sourceId: 'adapter-local',
    datasetRef: 'stations.csv',
    query: csvQuery,
    securityMode: 'internal',
  });
  const queriedCsvAgain = await Providers.queryDataset({
    workspace,
    sourceId: 'adapter-local',
    datasetRef: 'stations.csv',
    query: csvQuery,
    securityMode: 'internal',
  });
  const queriedGeojson = await Providers.queryDataset({
    workspace,
    sourceId: 'adapter-local',
    datasetRef: 'stations.geojson',
    securityMode: 'internal',
  });
  assert.match(queriedCsv.dataset.id, /^dataset-[a-f0-9]{24}$/);
  assert.equal(queriedCsvAgain.dataset.id, queriedCsv.dataset.id);
  assert.match(queriedGeojson.dataset.id, /^dataset-[a-f0-9]{24}$/);

    console.log('weather CSV roundtrip tests passed');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
