'use strict';

const crypto = require('node:crypto');

const DATASET_SCHEMA_VERSION = 'meteomate.weather.dataset/v1';
const DIAGNOSIS_SCHEMA_VERSION = 'meteomate.weather.diagnosis/v1';
const EVIDENCE_API_VERSION = 'meteomate/v1';
const CLASSIFICATIONS = new Set(['demo', 'experimental', 'beta', 'production']);
const PROVIDER_ATTESTATION_VERSION = 'v1';
const PROVIDER_ATTESTATION_KEY = crypto.randomBytes(32);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function isoTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function datasetContentHash(value) {
  const payload = clone(value) || {};
  delete payload.contentHash;
  if (payload.source && typeof payload.source === 'object') {
    delete payload.source.retrievedAt;
    if (payload.source.type === 'local') delete payload.source.uri;
  }
  if (payload.metadata && typeof payload.metadata === 'object') {
    delete payload.metadata.localPath;
    delete payload.metadata.localRelativePath;
    delete payload.metadata.sourcePath;
    delete payload.metadata.retrievedAt;
    delete payload.metadata.providerAttestation;
  }
  return digest(payload);
}

function hasProviderAuthority(fallback = {}) {
  return Boolean(text(fallback.id));
}

function normalizedSource(source = {}, fallback = {}, options = {}) {
  const preferFallback = options.preferFallback === true;
  const primary = preferFallback ? fallback : source;
  const secondary = preferFallback ? {} : fallback;
  const synthetic = primary.synthetic === true || secondary.synthetic === true;
  const classification = synthetic
    ? 'demo'
    : CLASSIFICATIONS.has(primary.classification)
      ? primary.classification
      : CLASSIFICATIONS.has(secondary.classification)
        ? secondary.classification
        : 'beta';
  return {
    id: text(primary.id, text(secondary.id, 'weather-source')),
    name: text(primary.name, text(secondary.name, text(primary.id, '气象资料源'))),
    type: text(primary.type, text(secondary.type, 'unknown')),
    version: text(primary.version, text(secondary.version, '1')),
    uri: text(primary.uri, text(secondary.uri, '')) || null,
    official: primary.official === true || secondary.official === true,
    synthetic,
    classification,
    retrievedAt: isoTime(primary.retrievedAt || secondary.retrievedAt) || new Date().toISOString(),
  };
}

function providerTrustIdentity(dataset = {}) {
  return {
    datasetHash: datasetContentHash(dataset),
    source: {
      id: text(dataset.source?.id),
      type: text(dataset.source?.type),
      version: text(dataset.source?.version),
      classification: text(dataset.source?.classification),
      official: dataset.source?.official === true,
      synthetic: dataset.source?.synthetic === true,
    },
  };
}

function providerAttestationValue(dataset) {
  return crypto.createHmac('sha256', PROVIDER_ATTESTATION_KEY)
    .update(JSON.stringify(stable(providerTrustIdentity(dataset))))
    .digest('hex');
}

function verifyProviderAttestation(dataset = {}) {
  const attestation = dataset.metadata?.providerAttestation;
  if (attestation?.version !== PROVIDER_ATTESTATION_VERSION || !/^[a-f0-9]{64}$/.test(String(attestation.value || ''))) {
    return false;
  }
  const expected = Buffer.from(providerAttestationValue(dataset), 'hex');
  const actual = Buffer.from(attestation.value, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function attestProviderDataset(dataset) {
  dataset.metadata = {
    ...(dataset.metadata || {}),
    providerAttestation: {
      version: PROVIDER_ATTESTATION_VERSION,
      value: providerAttestationValue(dataset),
    },
  };
  return dataset;
}

function normalizeStation(station = {}, index = 0) {
  const rain = station.rain && typeof station.rain === 'object' ? station.rain : {};
  const wind = station.wind && typeof station.wind === 'object' ? station.wind : {};
  return {
    id: text(station.id || station.stationId, `station-${index + 1}`),
    name: text(station.name || station.stationName, text(station.id, `站点 ${index + 1}`)),
    lon: number(station.lon ?? station.longitude),
    lat: number(station.lat ?? station.latitude),
    rain1h: number(station.rain1h ?? rain['1h'] ?? rain.hour1),
    rain3h: number(station.rain3h ?? rain['3h'] ?? rain.hour3),
    rain6h: number(station.rain6h ?? rain['6h'] ?? rain.hour6),
    rain12h: number(station.rain12h ?? rain['12h'] ?? rain.hour12),
    rain24h: number(station.rain24h ?? rain['24h'] ?? rain.hour24),
    temperature: number(station.temperature ?? station.temp),
    dewpoint: number(station.dewpoint ?? station.dewPoint),
    windDirection: number(station.windDirection ?? wind.direction),
    windSpeed: number(station.windSpeed ?? wind.speed),
    gust: number(station.gust ?? wind.gust),
    pressure: number(station.pressure),
    quality: text(station.quality, 'unknown'),
    validTime: isoTime(station.validTime),
    metadata: station.metadata && typeof station.metadata === 'object' ? clone(station.metadata) : {},
  };
}

function normalizeGuidance(item = {}, index = 0) {
  return {
    model: text(item.model, `model-${index + 1}`),
    cycle: isoTime(item.cycle || item.initTime),
    validTime: isoTime(item.validTime),
    forecastHour: number(item.forecastHour),
    regionalMax24h: number(item.regionalMax24h ?? item.max24h),
    hotspot: text(item.hotspot),
    timing: text(item.timing),
    confidence: number(item.confidence),
    metadata: item.metadata && typeof item.metadata === 'object' ? clone(item.metadata) : {},
  };
}

function normalizeDataset(input = {}, sourceFallback = {}) {
  const raw = input.dataset && typeof input.dataset === 'object' ? input.dataset : input;
  const providerAuthority = hasProviderAuthority(sourceFallback);
  const trustedInput = !providerAuthority && verifyProviderAttestation(raw);
  const validTime = raw.validTime && typeof raw.validTime === 'object' ? raw.validTime : {};
  const source = normalizedSource(
    raw.source || raw.provenance || {},
    sourceFallback,
    { preferFallback: providerAuthority },
  );
  if (!providerAuthority && !trustedInput) {
    source.official = false;
    source.classification = source.synthetic ? 'demo' : 'experimental';
  }
  const region = raw.region && typeof raw.region === 'object' ? raw.region : {};
  const stations = Array.isArray(raw.stations) ? raw.stations.map(normalizeStation) : [];
  const guidance = Array.isArray(raw.guidance) ? raw.guidance.map(normalizeGuidance) : [];
  const stableSourceIdentity = clone(source);
  delete stableSourceIdentity.retrievedAt;
  if (stableSourceIdentity.type === 'local') delete stableSourceIdentity.uri;
  const normalized = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: text(raw.id, `dataset-${digest({ source: stableSourceIdentity, region, validTime, stations: stations.slice(0, 8) }).slice(0, 20)}`),
    name: text(raw.name, '气象资料集'),
    source,
    region: {
      name: text(region.name || raw.regionName),
      bbox: Array.isArray(region.bbox) && region.bbox.length === 4
        ? region.bbox.map((item) => number(item))
        : null,
      timezone: text(region.timezone || raw.timezone, 'Asia/Shanghai'),
      projection: text(region.projection),
    },
    issueTime: isoTime(raw.issueTime || validTime.issueTime || raw.initTime),
    validTime: {
      start: isoTime(validTime.start || raw.validStart || raw.validTimeStart),
      end: isoTime(validTime.end || raw.validEnd || raw.validTimeEnd || raw.validTime),
    },
    model: text(raw.model),
    forecastHour: number(raw.forecastHour),
    stations,
    upperAir: raw.upperAir && typeof raw.upperAir === 'object' ? clone(raw.upperAir) : {},
    radar: raw.radar && typeof raw.radar === 'object' ? clone(raw.radar) : {},
    satellite: raw.satellite && typeof raw.satellite === 'object' ? clone(raw.satellite) : {},
    guidance,
    fields: raw.fields && typeof raw.fields === 'object' ? clone(raw.fields) : {},
    quality: raw.quality && typeof raw.quality === 'object' ? clone(raw.quality) : {},
    metadata: raw.metadata && typeof raw.metadata === 'object' ? clone(raw.metadata) : {},
  };
  normalized.contentHash = datasetContentHash(normalized);
  if (providerAuthority || trustedInput) attestProviderDataset(normalized);
  return normalized;
}

function validateDataset(dataset = {}) {
  const errors = [];
  const warnings = [];
  if (dataset.schemaVersion !== DATASET_SCHEMA_VERSION) errors.push('资料集 Schema 版本不受支持');
  if (!dataset.id) errors.push('资料集缺少 ID');
  if (!dataset.source?.id) errors.push('资料集缺少来源 ID');
  if (!dataset.source?.classification) errors.push('资料集缺少成熟度分类');
  if (!dataset.region?.name && !dataset.region?.bbox) warnings.push('资料集未声明区域');
  if (Array.isArray(dataset.region?.bbox)) {
    const [minLon, minLat, maxLon, maxLat] = dataset.region.bbox;
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite) || minLon >= maxLon || minLat >= maxLat) {
      errors.push('资料集区域 bbox 无效');
    }
  }
  if (!dataset.issueTime) warnings.push('资料集未声明起报或发布时间');
  if (!dataset.validTime?.start && !dataset.validTime?.end) errors.push('资料集未声明有效时间');
  if (dataset.validTime?.start && dataset.validTime?.end && new Date(dataset.validTime.end) < new Date(dataset.validTime.start)) {
    errors.push('资料集有效时间结束早于开始');
  }
  if (!dataset.stations?.length && !Object.keys(dataset.upperAir || {}).length && !Object.keys(dataset.fields || {}).length) {
    errors.push('资料集没有可诊断的站点、高空场或格点字段');
  }
  const stationIds = new Set();
  for (const station of dataset.stations || []) {
    if (stationIds.has(station.id)) errors.push(`站点 ID 重复：${station.id}`);
    stationIds.add(station.id);
    if (station.lon == null || station.lat == null) warnings.push(`站点 ${station.name || station.id} 缺少经纬度`);
    if (station.lon != null && (station.lon < -180 || station.lon > 180)) errors.push(`站点 ${station.name || station.id} 经度越界`);
    if (station.lat != null && (station.lat < -90 || station.lat > 90)) errors.push(`站点 ${station.name || station.id} 纬度越界`);
    if (station.quality === 'bad' || station.quality === 'rejected') errors.push(`站点 ${station.name || station.id} 质控未通过`);
  }
  if (['bad', 'rejected'].includes(String(dataset.quality?.status || '').toLowerCase())) errors.push('资料集总体质控未通过');
  if (!dataset.contentHash) warnings.push('资料集缺少内容摘要');
  return { valid: errors.length === 0, errors, warnings };
}

function evidenceId(record) {
  const identity = clone(record) || {};
  delete identity.createdAt;
  return `evidence-weather-${digest(identity).slice(0, 24)}`;
}

function expiryFor(dataset, fallbackHours = 12) {
  const base = dataset.validTime?.end || dataset.validTime?.start;
  const timestamp = base ? new Date(base).getTime() : Date.now();
  return new Date(timestamp + fallbackHours * 60 * 60 * 1000).toISOString();
}

function createEvidence(dataset, input = {}) {
  const core = {
    apiVersion: EVIDENCE_API_VERSION,
    kind: 'Evidence',
    evidenceType: input.evidenceType || 'meteorological-fact',
    source: input.source || dataset.source?.name || dataset.source?.id,
    sourceVersion: input.sourceVersion || dataset.source?.version || dataset.contentHash,
    model: input.model ?? dataset.model ?? null,
    initTime: input.initTime ?? dataset.issueTime ?? null,
    validTime: input.validTime ?? dataset.validTime?.end ?? dataset.validTime?.start ?? null,
    forecastHour: Number.isFinite(input.forecastHour) ? input.forecastHour : dataset.forecastHour,
    region: input.region || dataset.region?.name || null,
    variable: input.variable || null,
    level: input.level || null,
    unit: input.unit || null,
    value: input.value ?? null,
    algorithm: input.algorithm ? clone(input.algorithm) : null,
    confidence: number(input.confidence),
    uncertainty: input.uncertainty || null,
    createdAt: input.createdAt || Date.now(),
    expiresAt: input.expiresAt || expiryFor(dataset),
    metadata: {
      datasetId: dataset.id,
      datasetHash: dataset.contentHash,
      sourceId: dataset.source?.id,
      sourceType: dataset.source?.type,
      classification: dataset.source?.classification,
      synthetic: dataset.source?.synthetic === true,
      official: dataset.source?.official === true,
      quality: clone(dataset.quality || {}),
      ...(input.metadata || {}),
    },
  };
  return { id: input.id || evidenceId(core), ...core };
}

function datasetEvidence(dataset) {
  const records = [];
  const validTime = dataset.validTime?.end || dataset.validTime?.start || null;
  for (const station of dataset.stations || []) {
    for (const [field, unit] of [['rain1h', 'mm'], ['rain6h', 'mm'], ['rain24h', 'mm'], ['temperature', '°C'], ['dewpoint', '°C'], ['windSpeed', 'm/s'], ['gust', 'm/s'], ['pressure', 'hPa']]) {
      if (station[field] == null) continue;
      records.push(createEvidence(dataset, {
        variable: field,
        unit,
        value: station[field],
        validTime: station.validTime || validTime,
        confidence: station.quality === 'checked' ? 0.95 : 0.7,
        metadata: { stationId: station.id, stationName: station.name, quality: station.quality },
      }));
    }
  }
  const indices = dataset.upperAir?.indices || {};
  const indexUnits = {
    precipitableWater: 'mm', cape: 'J/kg', cin: 'J/kg', kIndex: '°C',
    liftedIndex: '°C', shear0to6km: 'm/s', lcl: 'm', freezingLevel: 'm',
  };
  for (const [name, value] of Object.entries(indices)) {
    const parsed = number(value);
    if (parsed == null) continue;
    records.push(createEvidence(dataset, {
      variable: name,
      level: 'environment',
      unit: indexUnits[name] || '1',
      value: parsed,
      confidence: 0.85,
    }));
  }
  const levelFields = {
    '850hPa': { windSpeed: 'm/s', specificHumidity: 'g/kg', temperature: '°C', dewpoint: '°C', moistureFluxConvergence: 's^-1' },
    '700hPa': { omega: 'Pa/s', temperature: '°C', dewpoint: '°C' },
    '500hPa': { height: 'gpm', temperature: '°C', windSpeed: 'm/s' },
    '200hPa': { windSpeed: 'm/s', divergence: 's^-1', height: 'gpm' },
  };
  for (const [level, fields] of Object.entries(levelFields)) {
    const source = dataset.upperAir?.[level] || {};
    for (const [variable, unit] of Object.entries(fields)) {
      const value = number(source[variable]);
      if (value == null) continue;
      records.push(createEvidence(dataset, { variable, level, unit, value, confidence: 0.82 }));
    }
  }
  if (number(dataset.radar?.maxDbz) != null) {
    records.push(createEvidence(dataset, {
      variable: 'maximum-reflectivity', level: 'radar', unit: 'dBZ',
      value: number(dataset.radar.maxDbz), validTime: isoTime(dataset.radar.validTime) || validTime,
      confidence: 0.88,
    }));
  }
  return records;
}

function publicationAssessment(dataset, validation = validateDataset(dataset)) {
  const blockers = [...validation.errors];
  const warnings = [...validation.warnings];
  if (dataset.source?.synthetic || dataset.source?.classification === 'demo') {
    blockers.push('构造或演示数据不能进入正式发布');
  }
  if (dataset.source?.classification === 'experimental') blockers.push('实验数据不能进入正式发布');
  if (!dataset.source?.version && !dataset.contentHash) blockers.push('资料来源缺少可追溯版本或摘要');
  if (!dataset.validTime?.start && !dataset.validTime?.end) blockers.push('资料缺少有效时间');
  return {
    readyForHumanReview: blockers.length === 0,
    readyForRelease: false,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    requiresHumanSignoff: true,
    classification: dataset.source?.classification || 'unknown',
  };
}

module.exports = {
  DATASET_SCHEMA_VERSION,
  DIAGNOSIS_SCHEMA_VERSION,
  normalizeDataset,
  validateDataset,
  createEvidence,
  datasetEvidence,
  publicationAssessment,
  digest,
  datasetContentHash,
  verifyProviderAttestation,
  clone,
  number,
  isoTime,
};
