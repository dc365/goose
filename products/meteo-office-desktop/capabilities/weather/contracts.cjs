'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QcPolicy = require('../../harness/qc-policy');

const DATASET_SCHEMA_VERSION = 'meteomate.weather.dataset/v1';
const DIAGNOSIS_SCHEMA_VERSION = 'meteomate.weather.diagnosis/v1';
const EVIDENCE_API_VERSION = 'meteomate/v1';
const NORMALIZER_VERSION = 'meteomate-weather-normalizer/1.1.0';
const CLASSIFICATIONS = new Set(['demo', 'experimental', 'beta', 'production']);
const SOURCE_AUTHORITIES = new Set(['fixture', 'workspace', 'deployment']);
const QUALITY_CODES = new Set(['unknown', 'unchecked', 'checked', 'good', 'suspect', 'bad', 'rejected', 'missing']);
const CANONICAL_UNITS = Object.freeze({
  rain1h: 'mm',
  rain3h: 'mm',
  rain6h: 'mm',
  rain12h: 'mm',
  rain24h: 'mm',
  regionalMax24h: 'mm',
  temperature: '°C',
  dewpoint: '°C',
  windDirection: 'degree',
  windSpeed: 'm/s',
  gust: 'm/s',
  pressure: 'hPa',
  precipitableWater: 'mm',
  cape: 'J/kg',
  cin: 'J/kg',
  kIndex: '°C',
  liftedIndex: '°C',
  shear0to6km: 'm/s',
  lcl: 'm',
  freezingLevel: 'm',
  specificHumidity: 'g/kg',
  moistureFluxConvergence: 's^-1',
  omega: 'Pa/s',
  height: 'gpm',
  divergence: 's^-1',
  maxDbz: 'dBZ',
});
const CANONICAL_UNIT_ORDER = new Map(
  Object.keys(CANONICAL_UNITS).map((field, index) => [field, index]),
);
const TEMPERATURE_DIFFERENCE_FIELDS = new Set(['kIndex', 'liftedIndex']);
const UPPER_AIR_INDEX_FIELDS = new Set([
  'precipitableWater',
  'cape',
  'cin',
  'kIndex',
  'liftedIndex',
  'shear0to6km',
  'lcl',
  'freezingLevel',
]);
const ISSUE_KEYS = new WeakMap();
const MAX_NORMALIZATION_ISSUES = 10_000;
const MAX_STATIONS = 600;
const MAX_GUIDANCE = 1_000;
const MAX_EVIDENCE_RECORDS = 5_000;
const DEFAULT_EVIDENCE_PAGE_SIZE = 100;
const MAX_EVIDENCE_PAGE_SIZE = 200;
const PROVIDER_ATTESTATION_VERSION = 'v1';
const PROVIDER_ATTESTATION_KEY_FILE_ENV = 'METEOMATE_WEATHER_ATTESTATION_KEY_FILE';
const VOLATILE_PROVIDER_ATTESTATION_KEY = crypto.randomBytes(32);
const PROVIDER_ATTESTATION_KEYS = new Map();
const EVIDENCE_RESERVED_METADATA_FIELDS = new Set([
  'datasetId',
  'datasetHash',
  'sourceId',
  'sourceType',
  'sourceAuthority',
  'classification',
  'synthetic',
  'official',
  'quality',
  'qc',
  'qcStatus',
  'qcVersion',
]);

class WeatherContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WeatherContractError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback = null) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  if (typeof value === 'boolean' || typeof value === 'object') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function compareText(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function isoTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isRfc3339(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function issue(issues, code, path, message) {
  const entry = { code, path, message };
  let keys = ISSUE_KEYS.get(issues);
  if (!keys) {
    keys = new Set(issues.map((item) => JSON.stringify([item?.code, item?.path, item?.message])));
    ISSUE_KEYS.set(issues, keys);
  }
  const key = JSON.stringify([code, path, message]);
  if (keys.has(key)) return;
  if (issues.length >= MAX_NORMALIZATION_ISSUES) {
    const truncated = {
      code: 'WEATHER_NORMALIZATION_ISSUES_TRUNCATED',
      path: '',
      message: `标准化问题超过 ${MAX_NORMALIZATION_ISSUES} 条，后续问题已省略`,
    };
    const truncatedKey = JSON.stringify([truncated.code, truncated.path, truncated.message]);
    if (!keys.has(truncatedKey)) {
      issues.push(truncated);
      keys.add(truncatedKey);
    }
    return;
  }
  issues.push(entry);
  keys.add(key);
}

function normalizedNumber(value, path, issues) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = number(value);
  if (parsed == null) issue(issues, 'WEATHER_VALUE_INVALID', path, `${path} 必须是有限数值`);
  return parsed;
}

function normalizedTime(value, path, issues) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!isRfc3339(raw)) {
    issue(issues, 'WEATHER_TIME_INVALID', path, `${path} 必须是带时区的 RFC3339 时间`);
    return null;
  }
  const parsed = isoTime(raw);
  if (!parsed) issue(issues, 'WEATHER_TIME_INVALID', path, `${path} 不是有效时间`);
  return parsed;
}

function validTimezone(value) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function unitRule(unit) {
  const normalized = String(unit || '').trim().toLowerCase().replaceAll(' ', '');
  const rules = new Map([
    ['mm', { unit: 'mm', convert: (value) => value }],
    ['millimeter', { unit: 'mm', convert: (value) => value }],
    ['millimetre', { unit: 'mm', convert: (value) => value }],
    ['in', { unit: 'mm', convert: (value) => value * 25.4 }],
    ['inch', { unit: 'mm', convert: (value) => value * 25.4 }],
    ['inches', { unit: 'mm', convert: (value) => value * 25.4 }],
    ['°c', { unit: '°C', convert: (value) => value }],
    ['degc', { unit: '°C', convert: (value) => value }],
    ['celsius', { unit: '°C', convert: (value) => value }],
    ['k', { unit: '°C', convert: (value) => value - 273.15 }],
    ['kelvin', { unit: '°C', convert: (value) => value - 273.15 }],
    ['m/s', { unit: 'm/s', convert: (value) => value }],
    ['ms-1', { unit: 'm/s', convert: (value) => value }],
    ['m·s⁻¹', { unit: 'm/s', convert: (value) => value }],
    ['kt', { unit: 'm/s', convert: (value) => value * 0.514444 }],
    ['knot', { unit: 'm/s', convert: (value) => value * 0.514444 }],
    ['knots', { unit: 'm/s', convert: (value) => value * 0.514444 }],
    ['degree', { unit: 'degree', convert: (value) => value }],
    ['degrees', { unit: 'degree', convert: (value) => value }],
    ['deg', { unit: 'degree', convert: (value) => value }],
    ['°', { unit: 'degree', convert: (value) => value }],
    ['hpa', { unit: 'hPa', convert: (value) => value }],
    ['mb', { unit: 'hPa', convert: (value) => value }],
    ['mbar', { unit: 'hPa', convert: (value) => value }],
    ['pa', { unit: 'hPa', convert: (value) => value / 100 }],
    ['j/kg', { unit: 'J/kg', convert: (value) => value }],
    ['g/kg', { unit: 'g/kg', convert: (value) => value }],
    ['pa/s', { unit: 'Pa/s', convert: (value) => value }],
    ['s^-1', { unit: 's^-1', convert: (value) => value }],
    ['s⁻¹', { unit: 's^-1', convert: (value) => value }],
    ['m', { unit: 'm', convert: (value) => value }],
    ['gpm', { unit: 'gpm', convert: (value) => value }],
    ['dbz', { unit: 'dBZ', convert: (value) => value }],
  ]);
  return rules.get(normalized) || null;
}

function normalizeUnits(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(Object.entries(source).map(([field, unit]) => {
    const rule = unitRule(unit);
    return [field, rule?.unit || String(unit || '').trim()];
  }));
}

function convertedNumber(value, field, path, units, issues, conversions) {
  const parsed = normalizedNumber(value, path, issues);
  if (parsed == null) return null;
  const declared = units[field];
  if (!declared) return parsed;
  const rule = unitRule(declared);
  const expected = CANONICAL_UNITS[field];
  if (!rule || (expected && rule.unit !== expected)) return parsed;
  const normalizedDeclaredUnit = String(declared).trim().toLowerCase().replaceAll(' ', '');
  const converted = TEMPERATURE_DIFFERENCE_FIELDS.has(field)
    && ['k', 'kelvin'].includes(normalizedDeclaredUnit)
    ? parsed
    : rule.convert(parsed);
  if (String(declared).trim() !== rule.unit) {
    conversions.push({ path, field, from: String(declared).trim(), to: rule.unit });
  }
  return Number(converted.toFixed(9));
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
  delete payload.kind;
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
  return Boolean(text(fallback.id) && SOURCE_AUTHORITIES.has(text(fallback.authority)));
}

function normalizedSource(source = {}, fallback = {}, options = {}) {
  const preferFallback = options.preferFallback === true;
  const primary = preferFallback ? fallback : source;
  const secondary = preferFallback ? {} : fallback;
  const synthetic = source.synthetic === true
    || fallback.synthetic === true
    || primary.synthetic === true
    || secondary.synthetic === true;
  const authority = SOURCE_AUTHORITIES.has(text(primary.authority))
    ? text(primary.authority)
    : SOURCE_AUTHORITIES.has(text(secondary.authority))
      ? text(secondary.authority)
      : 'untrusted';
  const requestedClassification = CLASSIFICATIONS.has(primary.classification)
    ? primary.classification
    : CLASSIFICATIONS.has(secondary.classification)
      ? secondary.classification
      : 'experimental';
  const classification = synthetic || authority === 'fixture'
    ? 'demo'
    : authority === 'deployment'
      ? requestedClassification
      : 'experimental';
  return {
    id: text(primary.id, text(secondary.id, 'weather-source')),
    name: text(primary.name, text(secondary.name, text(primary.id, '气象资料源'))),
    type: text(primary.type, text(secondary.type, 'unknown')),
    version: text(primary.version, text(secondary.version, '1')),
    uri: text(primary.uri, text(secondary.uri, '')) || null,
    official: !synthetic && authority === 'deployment' && (primary.official === true || secondary.official === true),
    synthetic,
    classification,
    authority,
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
      authority: text(dataset.source?.authority),
      uri: text(dataset.source?.uri),
      retrievedAt: isoTime(dataset.source?.retrievedAt),
    },
  };
}

function providerAttestationKey() {
  const configuredPath = String(process.env[PROVIDER_ATTESTATION_KEY_FILE_ENV] || '').trim();
  if (!configuredPath) return VOLATILE_PROVIDER_ATTESTATION_KEY;
  if (!path.isAbsolute(configuredPath)) {
    throw new WeatherContractError(
      'WEATHER_ATTESTATION_CONFIG_INVALID',
      `${PROVIDER_ATTESTATION_KEY_FILE_ENV} 必须是绝对路径`,
    );
  }
  const target = path.resolve(configuredPath);
  if (PROVIDER_ATTESTATION_KEYS.has(target)) return PROVIDER_ATTESTATION_KEYS.get(target);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) {
    try {
      fs.writeFileSync(target, `${crypto.randomBytes(32).toString('hex')}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new WeatherContractError(
      'WEATHER_ATTESTATION_CONFIG_INVALID',
      '气象来源证明密钥必须是普通文件',
    );
  }
  const encoded = fs.readFileSync(target, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(encoded)) {
    throw new WeatherContractError(
      'WEATHER_ATTESTATION_CONFIG_INVALID',
      '气象来源证明密钥格式无效',
    );
  }
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
  const key = Buffer.from(encoded, 'hex');
  PROVIDER_ATTESTATION_KEYS.set(target, key);
  return key;
}

function providerAttestationValue(dataset) {
  return crypto.createHmac('sha256', providerAttestationKey())
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

function requiresProviderAttestation(dataset = {}) {
  return dataset.source?.authority === 'deployment'
    || dataset.source?.official === true
    || ['beta', 'production'].includes(dataset.source?.classification);
}

function normalizeStation(station = {}, index = 0, context = {}) {
  const { units = {}, issues = [], conversions = [] } = context;
  const stationId = text(station.id || station.stationId);
  if (!stationId) issue(issues, 'WEATHER_STATION_ID_MISSING', `stations[${index}].id`, '站点缺少稳定 ID');
  const id = stationId || `station-${index + 1}`;
  const prefix = `stations[${id}]`;
  const rain = station.rain && typeof station.rain === 'object' ? station.rain : {};
  const wind = station.wind && typeof station.wind === 'object' ? station.wind : {};
  return {
    id,
    name: text(station.name || station.stationName, id),
    lon: normalizedNumber(station.lon ?? station.longitude, `${prefix}.lon`, issues),
    lat: normalizedNumber(station.lat ?? station.latitude, `${prefix}.lat`, issues),
    rain1h: convertedNumber(station.rain1h ?? rain['1h'] ?? rain.hour1, 'rain1h', `${prefix}.rain1h`, units, issues, conversions),
    rain3h: convertedNumber(station.rain3h ?? rain['3h'] ?? rain.hour3, 'rain3h', `${prefix}.rain3h`, units, issues, conversions),
    rain6h: convertedNumber(station.rain6h ?? rain['6h'] ?? rain.hour6, 'rain6h', `${prefix}.rain6h`, units, issues, conversions),
    rain12h: convertedNumber(station.rain12h ?? rain['12h'] ?? rain.hour12, 'rain12h', `${prefix}.rain12h`, units, issues, conversions),
    rain24h: convertedNumber(station.rain24h ?? rain['24h'] ?? rain.hour24, 'rain24h', `${prefix}.rain24h`, units, issues, conversions),
    temperature: convertedNumber(station.temperature ?? station.temp, 'temperature', `${prefix}.temperature`, units, issues, conversions),
    dewpoint: convertedNumber(station.dewpoint ?? station.dewPoint, 'dewpoint', `${prefix}.dewpoint`, units, issues, conversions),
    windDirection: convertedNumber(station.windDirection ?? wind.direction, 'windDirection', `${prefix}.windDirection`, units, issues, conversions),
    windSpeed: convertedNumber(station.windSpeed ?? wind.speed, 'windSpeed', `${prefix}.windSpeed`, units, issues, conversions),
    gust: convertedNumber(station.gust ?? wind.gust, 'gust', `${prefix}.gust`, units, issues, conversions),
    pressure: convertedNumber(station.pressure, 'pressure', `${prefix}.pressure`, units, issues, conversions),
    quality: text(station.quality, 'unknown').toLowerCase(),
    validTime: normalizedTime(station.validTime, `${prefix}.validTime`, issues),
    metadata: station.metadata && typeof station.metadata === 'object' ? clone(station.metadata) : {},
  };
}

function normalizeGuidance(item = {}, index = 0, context = {}) {
  const { units = {}, issues = [], conversions = [] } = context;
  const modelName = text(item.model);
  if (!modelName) issue(issues, 'WEATHER_GUIDANCE_MODEL_MISSING', `guidance[${index}].model`, '模式指导缺少稳定名称');
  const model = modelName || `model-${index + 1}`;
  const prefix = `guidance[${model}]`;
  return {
    model,
    cycle: normalizedTime(item.cycle || item.initTime, `${prefix}.cycle`, issues),
    validTime: normalizedTime(item.validTime, `${prefix}.validTime`, issues),
    forecastHour: normalizedNumber(item.forecastHour, `${prefix}.forecastHour`, issues),
    regionalMax24h: convertedNumber(item.regionalMax24h ?? item.max24h, 'regionalMax24h', `${prefix}.regionalMax24h`, units, issues, conversions),
    hotspot: text(item.hotspot),
    timing: text(item.timing),
    confidence: normalizedNumber(item.confidence, `${prefix}.confidence`, issues),
    metadata: item.metadata && typeof item.metadata === 'object' ? clone(item.metadata) : {},
  };
}

function normalizeUpperAir(raw = {}, context = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : {};
  const { units = {}, issues = [], conversions = [] } = context;
  const indices = source.indices && typeof source.indices === 'object' ? source.indices : {};
  source.indices = Object.fromEntries(
    Object.entries(indices)
      .sort(([left], [right]) => (
        (CANONICAL_UNIT_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (CANONICAL_UNIT_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
        || compareText(left, right)
      ))
      .map(([field, value]) => [
        field,
        UPPER_AIR_INDEX_FIELDS.has(field)
          ? convertedNumber(value, field, `upperAir.indices.${field}`, units, issues, conversions)
          : value,
      ]),
  );
  for (const level of ['surface', '850hPa', '700hPa', '500hPa', '200hPa']) {
    if (!source[level] || typeof source[level] !== 'object') continue;
    for (const field of ['height', 'temperature', 'dewpoint', 'windDirection', 'windSpeed', 'pressure', 'specificHumidity', 'moistureFluxConvergence', 'omega', 'divergence']) {
      if (!(field in source[level])) continue;
      source[level][field] = convertedNumber(
        source[level][field],
        field,
        `upperAir.${level}.${field}`,
        units,
        issues,
        conversions,
      );
    }
  }
  return source;
}

function normalizeRadar(raw = {}, context = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : {};
  const { units = {}, issues = [], conversions = [] } = context;
  if ('maxDbz' in source) {
    source.maxDbz = convertedNumber(source.maxDbz, 'maxDbz', 'radar.maxDbz', units, issues, conversions);
  }
  if ('validTime' in source) source.validTime = normalizedTime(source.validTime, 'radar.validTime', issues);
  return source;
}

function normalizeDataset(input = {}, sourceFallback = {}) {
  const raw = input.dataset && typeof input.dataset === 'object' ? input.dataset : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WeatherContractError('WEATHER_SCHEMA_INVALID', '气象资料集必须是对象');
  }
  if (raw.schemaVersion && raw.schemaVersion !== DATASET_SCHEMA_VERSION) {
    throw new WeatherContractError(
      'WEATHER_SCHEMA_UNSUPPORTED',
      `气象资料集 Schema 版本不受支持：${raw.schemaVersion}`,
      { expected: DATASET_SCHEMA_VERSION, actual: raw.schemaVersion },
    );
  }
  if (raw.kind != null && raw.kind !== 'WeatherDataset') {
    throw new WeatherContractError(
      'WEATHER_KIND_UNSUPPORTED',
      `气象资料集 kind 不受支持：${raw.kind}`,
      { expected: 'WeatherDataset', actual: raw.kind },
    );
  }
  if (Array.isArray(raw.stations) && raw.stations.length > MAX_STATIONS) {
    throw new WeatherContractError(
      'WEATHER_STATION_LIMIT_EXCEEDED',
      `气象资料集站点数超过 ${MAX_STATIONS} 条限制`,
      { maximum: MAX_STATIONS, actual: raw.stations.length },
    );
  }
  if (Array.isArray(raw.guidance) && raw.guidance.length > MAX_GUIDANCE) {
    throw new WeatherContractError(
      'WEATHER_GUIDANCE_LIMIT_EXCEEDED',
      `气象资料集指导产品数超过 ${MAX_GUIDANCE} 条限制`,
      { maximum: MAX_GUIDANCE, actual: raw.guidance.length },
    );
  }
  const providerAuthority = hasProviderAuthority(sourceFallback);
  const trustedInput = !providerAuthority && verifyProviderAttestation(raw);
  const validTime = raw.validTime && typeof raw.validTime === 'object' ? raw.validTime : {};
  const inputMetadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? clone(raw.metadata)
    : {};
  const metadata = { ...inputMetadata };
  for (const reserved of [
    'normalizerVersion',
    'normalizationIssues',
    'unitConversions',
    'providerAttestation',
  ]) {
    delete metadata[reserved];
  }
  const issues = trustedInput && Array.isArray(inputMetadata.normalizationIssues)
    ? inputMetadata.normalizationIssues
      .filter((entry) => (
        entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && typeof entry.code === 'string'
        && typeof entry.path === 'string'
        && typeof entry.message === 'string'
      ))
      .map(({ code, path, message }) => ({ code, path, message }))
    : [];
  const conversions = trustedInput && Array.isArray(inputMetadata.unitConversions)
    ? inputMetadata.unitConversions
      .filter((entry) => (
        entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && typeof entry.path === 'string'
        && typeof entry.field === 'string'
        && typeof entry.from === 'string'
        && typeof entry.to === 'string'
      ))
      .map(({ path, field, from, to }) => ({ path, field, from, to }))
    : [];
  const declaredUnits = raw.units && typeof raw.units === 'object' && !Array.isArray(raw.units)
    ? raw.units
    : metadata.units && typeof metadata.units === 'object' && !Array.isArray(metadata.units)
      ? metadata.units
      : {};
  const units = normalizeUnits(declaredUnits);
  const context = { units: declaredUnits, issues, conversions };
  const rawSource = raw.source && typeof raw.source === 'object'
    ? raw.source
    : raw.provenance && typeof raw.provenance === 'object'
      ? raw.provenance
      : {};
  const source = normalizedSource(
    {
      ...rawSource,
      synthetic: raw.synthetic === true || metadata.synthetic === true || rawSource.synthetic === true,
    },
    sourceFallback,
    { preferFallback: providerAuthority },
  );
  if (!providerAuthority && !trustedInput) {
    source.official = false;
    source.classification = source.synthetic ? 'demo' : 'experimental';
    source.authority = source.synthetic ? 'fixture' : 'untrusted';
  }
  const region = raw.region && typeof raw.region === 'object' ? raw.region : {};
  const stations = Array.isArray(raw.stations)
    ? raw.stations.map((station, index) => normalizeStation(station, index, context))
      .sort((left, right) => (
        compareText(left.id, right.id)
        || compareText(left.name, right.name)
        || compareText(digest(left), digest(right))
      ))
    : [];
  const guidance = Array.isArray(raw.guidance)
    ? raw.guidance.map((item, index) => normalizeGuidance(item, index, context))
      .sort((left, right) => (
        compareText(left.model, right.model)
        || compareText(left.cycle, right.cycle)
        || compareText(left.validTime, right.validTime)
        || (left.forecastHour ?? -1) - (right.forecastHour ?? -1)
        || compareText(digest(left), digest(right))
      ))
    : [];
  const timezone = text(region.timezone || raw.timezone);
  if (timezone && !validTimezone(timezone)) {
    issue(issues, 'WEATHER_TIMEZONE_INVALID', 'region.timezone', `未知时区：${timezone}`);
  }
  const projectionInput = text(region.projection || region.crs);
  const projection = ['wgs84', 'epsg:4326'].includes(projectionInput.toLowerCase())
    ? 'EPSG:4326'
    : projectionInput;
  const stableSourceIdentity = clone(source);
  delete stableSourceIdentity.retrievedAt;
  if (stableSourceIdentity.type === 'local') delete stableSourceIdentity.uri;
  const issueTime = normalizedTime(raw.issueTime || validTime.issueTime || raw.initTime, 'issueTime', issues);
  const validStart = normalizedTime(validTime.start || raw.validStart || raw.validTimeStart, 'validTime.start', issues);
  const validEnd = normalizedTime(validTime.end || raw.validEnd || raw.validTimeEnd || raw.validTime, 'validTime.end', issues);
  const forecastHour = normalizedNumber(raw.forecastHour, 'forecastHour', issues);
  const upperAir = normalizeUpperAir(raw.upperAir, context);
  const radar = normalizeRadar(raw.radar, context);
  let bbox = null;
  if (region.bbox != null) {
    if (!Array.isArray(region.bbox) || region.bbox.length !== 4) {
      issue(issues, 'WEATHER_COORDINATE_INVALID', 'region.bbox', 'region.bbox 必须包含四个坐标值');
    } else {
      bbox = region.bbox.map((item, index) => normalizedNumber(item, `region.bbox[${index}]`, issues));
    }
  }
  const unitConversions = [...new Map(conversions.map((entry) => [
    JSON.stringify([entry.path, entry.field, entry.from, entry.to]),
    entry,
  ])).values()].sort((left, right) => (
    compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.from, right.from)
  ));
  const normalizationIssues = [...new Map(issues.map((entry) => [
    JSON.stringify([entry.code, entry.path, entry.message]),
    entry,
  ])).values()].sort((left, right) => (
    compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
  ));
  const normalized = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    kind: 'WeatherDataset',
    id: text(raw.id, `dataset-${digest({ source: stableSourceIdentity, region, validTime, stations: stations.slice(0, 8) }).slice(0, 20)}`),
    name: text(raw.name, '气象资料集'),
    source,
    region: {
      name: text(region.name || raw.regionName),
      bbox,
      timezone,
      projection,
    },
    issueTime,
    validTime: {
      start: validStart,
      end: validEnd,
    },
    model: text(raw.model),
    forecastHour,
    units,
    stations,
    upperAir,
    radar,
    satellite: raw.satellite && typeof raw.satellite === 'object' ? clone(raw.satellite) : {},
    guidance,
    fields: raw.fields && typeof raw.fields === 'object' ? clone(raw.fields) : {},
    quality: raw.quality && typeof raw.quality === 'object' ? clone(raw.quality) : {},
    metadata: {
      ...metadata,
      normalizerVersion: NORMALIZER_VERSION,
      normalizationIssues,
      unitConversions,
    },
  };
  normalized.contentHash = datasetContentHash(normalized);
  if (providerAuthority || trustedInput) attestProviderDataset(normalized);
  return normalized;
}

function validateDataset(dataset = {}) {
  const errors = [];
  const warnings = [];
  const errorDetails = [];
  const warningDetails = [];
  const addError = (code, message, path = '') => {
    errors.push(message);
    errorDetails.push({ code, path, message });
  };
  const addWarning = (code, message, path = '') => {
    warnings.push(message);
    warningDetails.push({ code, path, message });
  };
  for (const entry of dataset.metadata?.normalizationIssues || []) {
    addError(entry.code || 'WEATHER_NORMALIZATION_INVALID', entry.message || '资料标准化失败', entry.path || '');
  }
  if (dataset.schemaVersion !== DATASET_SCHEMA_VERSION) addError('WEATHER_SCHEMA_UNSUPPORTED', '资料集 Schema 版本不受支持', 'schemaVersion');
  if (!dataset.id) addError('WEATHER_SCHEMA_INVALID', '资料集缺少 ID', 'id');
  if (!dataset.source?.id) addError('WEATHER_SCHEMA_INVALID', '资料集缺少来源 ID', 'source.id');
  if (!dataset.source?.classification) addError('WEATHER_SCHEMA_INVALID', '资料集缺少成熟度分类', 'source.classification');
  if (!['demo', 'experimental', 'beta', 'production'].includes(dataset.source?.classification)) {
    addError('WEATHER_SOURCE_CLASSIFICATION_INVALID', '资料集成熟度分类无效', 'source.classification');
  }
  if (
    (dataset.source?.official === true || ['beta', 'production'].includes(dataset.source?.classification))
    && dataset.source?.authority !== 'deployment'
  ) {
    addError('WEATHER_SOURCE_AUTHORITY_INVALID', '资料来源未经部署方授权，不能标记为 beta、production 或官方来源', 'source.authority');
  }
  const calculatedContentHash = datasetContentHash(dataset);
  if (!dataset.contentHash) {
    addError('WEATHER_HASH_MISSING', '资料集缺少内容摘要', 'contentHash');
  } else if (dataset.contentHash !== calculatedContentHash) {
    addError('WEATHER_HASH_MISMATCH', '资料集内容摘要与当前内容不匹配', 'contentHash');
  }
  if (requiresProviderAttestation(dataset) && !verifyProviderAttestation(dataset)) {
    addError(
      'WEATHER_PROVIDER_ATTESTATION_INVALID',
      '正式资料来源证明缺失或与当前内容不匹配',
      'metadata.providerAttestation',
    );
  }
  if (!dataset.region?.name && !dataset.region?.bbox) addWarning('WEATHER_REGION_MISSING', '资料集未声明区域', 'region');
  if (!dataset.region?.timezone) addError('WEATHER_TIMEZONE_MISSING', '资料集未声明区域时区', 'region.timezone');
  else if (!validTimezone(dataset.region.timezone)) addError('WEATHER_TIMEZONE_INVALID', `资料集区域时区无效：${dataset.region.timezone}`, 'region.timezone');
  if (dataset.region?.projection !== 'EPSG:4326') {
    addError('WEATHER_CRS_UNSUPPORTED', '资料集必须明确声明 EPSG:4326 坐标系', 'region.projection');
  }
  if (Array.isArray(dataset.region?.bbox)) {
    const [minLon, minLat, maxLon, maxLat] = dataset.region.bbox;
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite) || minLon >= maxLon || minLat >= maxLat) {
      addError('WEATHER_COORDINATE_INVALID', '资料集区域 bbox 无效', 'region.bbox');
    } else if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
      addError('WEATHER_COORDINATE_INVALID', '资料集区域 bbox 超出 EPSG:4326 范围', 'region.bbox');
    }
  }
  if (!dataset.issueTime) addError('WEATHER_TIME_INVALID', '资料集未声明起报或发布时间', 'issueTime');
  if (!dataset.validTime?.start && !dataset.validTime?.end) addError('WEATHER_TIME_INVALID', '资料集未声明有效时间', 'validTime');
  if (dataset.validTime?.start && dataset.validTime?.end && new Date(dataset.validTime.end) < new Date(dataset.validTime.start)) {
    addError('WEATHER_TIME_INCONSISTENT', '资料集有效时间结束早于开始', 'validTime');
  }
  if (
    dataset.issueTime
    && dataset.validTime?.start
    && dataset.forecastHour != null
    && new Date(dataset.issueTime) > new Date(dataset.validTime.start)
  ) {
    addError('WEATHER_TIME_INCONSISTENT', '资料集起报时间晚于有效时间开始', 'issueTime');
  }
  if (dataset.issueTime && dataset.validTime?.end && new Date(dataset.issueTime) > new Date(dataset.validTime.end)) {
    addError('WEATHER_TIME_INCONSISTENT', '资料集起报或发布时间晚于有效时间结束', 'issueTime');
  }
  if (dataset.issueTime && dataset.validTime?.end && Number.isFinite(dataset.forecastHour)) {
    const expected = new Date(dataset.issueTime).getTime() + dataset.forecastHour * 60 * 60 * 1000;
    if (Math.abs(expected - new Date(dataset.validTime.end).getTime()) > 60 * 1000) {
      addError('WEATHER_TIME_INCONSISTENT', '预报时效与起报及有效时间不一致', 'forecastHour');
    }
  }
  if (dataset.forecastHour != null && (!Number.isInteger(dataset.forecastHour) || dataset.forecastHour < 0 || dataset.forecastHour > 1440)) {
    addError('WEATHER_VALUE_OUT_OF_RANGE', '预报时效必须是 0–1440 的整数小时', 'forecastHour');
  }
  const presentVariables = new Set();
  const checkRange = (value, minimum, maximum, label, path, field) => {
    if (value == null) return;
    presentVariables.add(field);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      addError('WEATHER_VALUE_OUT_OF_RANGE', `${label}超出允许范围`, path);
    }
  };
  const stationIds = new Set();
  for (const [index, station] of (dataset.stations || []).entries()) {
    const prefix = `stations[${index}]`;
    if (stationIds.has(station.id)) addError('WEATHER_STATION_DUPLICATE', `站点 ID 重复：${station.id}`, `${prefix}.id`);
    stationIds.add(station.id);
    if (station.lon == null || station.lat == null) addError('WEATHER_COORDINATE_INVALID', `站点 ${station.name || station.id} 缺少经纬度`, prefix);
    if (station.lon != null && (station.lon < -180 || station.lon > 180)) addError('WEATHER_COORDINATE_INVALID', `站点 ${station.name || station.id} 经度越界`, `${prefix}.lon`);
    if (station.lat != null && (station.lat < -90 || station.lat > 90)) addError('WEATHER_COORDINATE_INVALID', `站点 ${station.name || station.id} 纬度越界`, `${prefix}.lat`);
    if (
      Array.isArray(dataset.region?.bbox)
      && station.lon != null
      && station.lat != null
      && (
        station.lon < dataset.region.bbox[0]
        || station.lon > dataset.region.bbox[2]
        || station.lat < dataset.region.bbox[1]
        || station.lat > dataset.region.bbox[3]
      )
    ) {
      addError('WEATHER_COORDINATE_INVALID', `站点 ${station.name || station.id} 位于资料集 bbox 之外`, prefix);
    }
    if (!QUALITY_CODES.has(station.quality)) addError('WEATHER_QUALITY_INVALID', `站点 ${station.name || station.id} 质控码无效：${station.quality}`, `${prefix}.quality`);
    if (station.quality === 'bad' || station.quality === 'rejected') addError('WEATHER_QUALITY_REJECTED', `站点 ${station.name || station.id} 质控未通过`, `${prefix}.quality`);
    if (station.validTime && dataset.validTime?.start && new Date(station.validTime) < new Date(dataset.validTime.start)) {
      addError('WEATHER_TIME_INCONSISTENT', `站点 ${station.name || station.id} 时次早于资料集有效时间`, `${prefix}.validTime`);
    }
    if (station.validTime && dataset.validTime?.end && new Date(station.validTime) > new Date(dataset.validTime.end)) {
      addError('WEATHER_TIME_INCONSISTENT', `站点 ${station.name || station.id} 时次晚于资料集有效时间`, `${prefix}.validTime`);
    }
    for (const field of ['rain1h', 'rain3h', 'rain6h', 'rain12h', 'rain24h']) {
      checkRange(station[field], 0, 3000, `${station.name || station.id} ${field}`, `${prefix}.${field}`, field);
    }
    checkRange(station.temperature, -100, 65, `${station.name || station.id} 气温`, `${prefix}.temperature`, 'temperature');
    checkRange(station.dewpoint, -120, 65, `${station.name || station.id} 露点`, `${prefix}.dewpoint`, 'dewpoint');
    checkRange(station.windDirection, 0, 360, `${station.name || station.id} 风向`, `${prefix}.windDirection`, 'windDirection');
    checkRange(station.windSpeed, 0, 150, `${station.name || station.id} 风速`, `${prefix}.windSpeed`, 'windSpeed');
    checkRange(station.gust, 0, 200, `${station.name || station.id} 阵风`, `${prefix}.gust`, 'gust');
    checkRange(station.pressure, 100, 1100, `${station.name || station.id} 气压`, `${prefix}.pressure`, 'pressure');
  }
  const upperAirRanges = {
    precipitableWater: [0, 150],
    cape: [0, 15000],
    cin: [0, 5000],
    kIndex: [-100, 100],
    liftedIndex: [-30, 30],
    shear0to6km: [0, 150],
    lcl: [0, 10000],
    freezingLevel: [0, 10000],
  };
  const upperAirLevelRanges = {
    height: [-1000, 60000],
    temperature: [-150, 80],
    dewpoint: [-180, 80],
    windDirection: [0, 360],
    windSpeed: [0, 200],
    pressure: [1, 1100],
    specificHumidity: [0, 100],
    moistureFluxConvergence: [-1, 1],
    omega: [-100, 100],
    divergence: [-1, 1],
  };
  for (const [field, value] of Object.entries(dataset.upperAir?.indices || {})) {
    if (!UPPER_AIR_INDEX_FIELDS.has(field) || value == null) continue;
    const [minimum, maximum] = upperAirRanges[field] || [-Number.MAX_VALUE, Number.MAX_VALUE];
    checkRange(value, minimum, maximum, `高空指数 ${field}`, `upperAir.indices.${field}`, field);
  }
  for (const level of ['surface', '850hPa', '700hPa', '500hPa', '200hPa']) {
    const values = dataset.upperAir?.[level] || {};
    for (const field of ['height', 'temperature', 'dewpoint', 'windDirection', 'windSpeed', 'pressure', 'specificHumidity', 'moistureFluxConvergence', 'omega', 'divergence']) {
      if (values[field] == null) continue;
      const [minimum, maximum] = upperAirLevelRanges[field];
      checkRange(values[field], minimum, maximum, `${level} ${field}`, `upperAir.${level}.${field}`, field);
    }
  }
  if (dataset.radar?.maxDbz != null) checkRange(dataset.radar.maxDbz, -40, 100, '雷达反射率', 'radar.maxDbz', 'maxDbz');
  if (dataset.radar?.validTime && dataset.validTime?.start && new Date(dataset.radar.validTime) < new Date(dataset.validTime.start)) {
    addError('WEATHER_TIME_INCONSISTENT', '雷达时次早于资料集有效时间', 'radar.validTime');
  }
  if (dataset.radar?.validTime && dataset.validTime?.end && new Date(dataset.radar.validTime) > new Date(dataset.validTime.end)) {
    addError('WEATHER_TIME_INCONSISTENT', '雷达时次晚于资料集有效时间', 'radar.validTime');
  }
  for (const [index, item] of (dataset.guidance || []).entries()) {
    if (item.regionalMax24h != null) checkRange(item.regionalMax24h, 0, 3000, `${item.model} 区域最大 24 小时雨量`, `guidance[${index}].regionalMax24h`, 'regionalMax24h');
    if (item.confidence != null && (item.confidence < 0 || item.confidence > 1)) {
      addError('WEATHER_VALUE_OUT_OF_RANGE', `${item.model} 置信度必须在 0–1 之间`, `guidance[${index}].confidence`);
    }
    if (item.forecastHour != null && (!Number.isInteger(item.forecastHour) || item.forecastHour < 0 || item.forecastHour > 1440)) {
      addError('WEATHER_VALUE_OUT_OF_RANGE', `${item.model} 预报时效必须是 0–1440 的整数小时`, `guidance[${index}].forecastHour`);
    }
    if (item.cycle && item.validTime && new Date(item.cycle) > new Date(item.validTime)) {
      addError('WEATHER_TIME_INCONSISTENT', `${item.model} 起报时间晚于有效时间`, `guidance[${index}].cycle`);
    }
    if (item.cycle && item.validTime && Number.isFinite(item.forecastHour)) {
      const expected = new Date(item.cycle).getTime() + item.forecastHour * 60 * 60 * 1000;
      if (Math.abs(expected - new Date(item.validTime).getTime()) > 60 * 1000) {
        addError('WEATHER_TIME_INCONSISTENT', `${item.model} 预报时效与起报及有效时间不一致`, `guidance[${index}].forecastHour`);
      }
    }
    if (item.validTime && dataset.validTime?.start && new Date(item.validTime) < new Date(dataset.validTime.start)) {
      addError('WEATHER_TIME_INCONSISTENT', `${item.model} 有效时间早于资料集时窗`, `guidance[${index}].validTime`);
    }
    if (item.validTime && dataset.validTime?.end && new Date(item.validTime) > new Date(dataset.validTime.end)) {
      addError('WEATHER_TIME_INCONSISTENT', `${item.model} 有效时间晚于资料集时窗`, `guidance[${index}].validTime`);
    }
  }
  for (const field of presentVariables) {
    const expected = CANONICAL_UNITS[field];
    if (!expected) continue;
    if (!dataset.units?.[field]) addError('WEATHER_UNIT_MISSING', `变量 ${field} 缺少单位声明`, `units.${field}`);
    else if (dataset.units[field] !== expected) {
      addError('WEATHER_UNIT_UNSUPPORTED', `变量 ${field} 单位 ${dataset.units[field]} 不受支持；要求 ${expected}`, `units.${field}`);
    }
  }
  const hasStationValue = (dataset.stations || []).some((station) =>
    ['rain1h', 'rain3h', 'rain6h', 'rain12h', 'rain24h', 'temperature', 'dewpoint', 'windSpeed', 'gust', 'pressure']
      .some((field) => Number.isFinite(station[field]))
  );
  const hasUpperAirValue = Object.entries(dataset.upperAir?.indices || {})
    .some(([field, value]) => UPPER_AIR_INDEX_FIELDS.has(field) && Number.isFinite(value))
    || ['surface', '850hPa', '700hPa', '500hPa', '200hPa'].some((level) =>
      ['height', 'temperature', 'dewpoint', 'windDirection', 'windSpeed', 'pressure', 'specificHumidity', 'moistureFluxConvergence', 'omega', 'divergence']
        .some((field) => Number.isFinite(dataset.upperAir?.[level]?.[field]))
    );
  const hasDiagnosticValue = hasStationValue
    || hasUpperAirValue
    || Number.isFinite(dataset.radar?.maxDbz);
  if (!hasDiagnosticValue) addError('WEATHER_DATASET_EMPTY', '资料集虽有记录，但没有可诊断变量');
  const qualityStatus = String(dataset.quality?.status || '').trim().toLowerCase();
  if (qualityStatus && !QUALITY_CODES.has(qualityStatus)) addError('WEATHER_QUALITY_INVALID', `资料集总体质控码无效：${qualityStatus}`, 'quality.status');
  if (['bad', 'rejected'].includes(qualityStatus)) addError('WEATHER_QUALITY_REJECTED', '资料集总体质控未通过', 'quality.status');
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    errorDetails,
    warningDetails,
  };
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
  const qc = QcPolicy.deriveEvidenceQc({
    qcStatus: input.qcStatus ?? dataset.quality?.status,
  });
  const calculatedDatasetHash = datasetContentHash(dataset);
  const inputMetadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? clone(input.metadata)
    : {};
  for (const field of EVIDENCE_RESERVED_METADATA_FIELDS) delete inputMetadata[field];
  const core = {
    apiVersion: EVIDENCE_API_VERSION,
    kind: 'Evidence',
    evidenceType: input.evidenceType || 'meteorological-fact',
    source: input.source || dataset.source?.name || dataset.source?.id,
    sourceVersion: input.sourceVersion || dataset.source?.version || calculatedDatasetHash,
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
    qcStatus: qc.qcStatus,
    qcVersion: qc.qcVersion,
    createdAt: input.createdAt || Date.now(),
    expiresAt: input.expiresAt || expiryFor(dataset),
    metadata: {
      ...inputMetadata,
      datasetId: dataset.id,
      datasetHash: calculatedDatasetHash,
      sourceId: dataset.source?.id,
      sourceType: dataset.source?.type,
      sourceAuthority: dataset.source?.authority,
      classification: dataset.source?.classification,
      synthetic: dataset.source?.synthetic === true,
      official: dataset.source?.official === true,
      quality: clone(dataset.quality || {}),
    },
  };
  return { id: input.id || evidenceId(core), ...core };
}

function datasetEvidence(dataset, options = {}) {
  if (options.allowInvalid !== true && !validateDataset(dataset).valid) return [];
  const records = [];
  const maximum = Number.isInteger(options.maxRecords) && options.maxRecords > 0
    ? Math.min(options.maxRecords, MAX_EVIDENCE_RECORDS)
    : MAX_EVIDENCE_RECORDS;
  const addRecord = (input) => {
    if (records.length >= maximum) {
      throw new WeatherContractError(
        'WEATHER_EVIDENCE_LIMIT_EXCEEDED',
        `气象 Evidence 超过 ${maximum} 条限制`,
        { maximum },
      );
    }
    records.push(createEvidence(dataset, input));
  };
  const validTime = dataset.validTime?.end || dataset.validTime?.start || null;
  for (const station of dataset.stations || []) {
    for (const field of ['rain1h', 'rain6h', 'rain24h', 'temperature', 'dewpoint', 'windSpeed', 'gust', 'pressure']) {
      if (station[field] == null) continue;
      addRecord({
        variable: field,
        unit: dataset.units?.[field] || null,
        value: station[field],
        validTime: station.validTime || validTime,
        confidence: station.quality === 'checked' ? 0.95 : 0.7,
        qcStatus: station.quality,
        metadata: { stationId: station.id, stationName: station.name, quality: station.quality },
      });
    }
  }
  const indices = dataset.upperAir?.indices || {};
  for (const [name, value] of Object.entries(indices)) {
    if (!UPPER_AIR_INDEX_FIELDS.has(name)) continue;
    const parsed = number(value);
    if (parsed == null) continue;
    addRecord({
      variable: name,
      level: 'environment',
      unit: dataset.units?.[name] || null,
      value: parsed,
      confidence: 0.85,
    });
  }
  const levelFields = {
    '850hPa': ['windSpeed', 'specificHumidity', 'temperature', 'dewpoint', 'moistureFluxConvergence'],
    '700hPa': ['omega', 'temperature', 'dewpoint'],
    '500hPa': ['height', 'temperature', 'windSpeed'],
    '200hPa': ['windSpeed', 'divergence', 'height'],
  };
  for (const [level, fields] of Object.entries(levelFields)) {
    const source = dataset.upperAir?.[level] || {};
    for (const variable of fields) {
      const value = number(source[variable]);
      if (value == null) continue;
      addRecord({
        variable,
        level,
        unit: dataset.units?.[variable] || null,
        value,
        confidence: 0.82,
      });
    }
  }
  if (number(dataset.radar?.maxDbz) != null) {
    addRecord({
      variable: 'maximum-reflectivity', level: 'radar', unit: dataset.units?.maxDbz || null,
      value: number(dataset.radar.maxDbz), validTime: isoTime(dataset.radar.validTime) || validTime,
      confidence: 0.88,
    });
  }
  return records;
}

function summarizeEvidence(records) {
  const evidence = Array.isArray(records) ? records : [];
  const counts = {};
  for (const record of evidence) {
    const type = String(record?.evidenceType || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return {
    total: evidence.length,
    evidenceTypeCounts: Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) => compareText(left, right)),
    ),
    evidenceSetHash: digest(evidence.map((record) => record.id)),
    pageTool: 'weather_build_evidence',
  };
}

function encodeEvidenceCursor(datasetHash, evidenceSetHash, offset) {
  return Buffer.from(JSON.stringify({
    datasetHash,
    evidenceSetHash,
    offset,
  })).toString('base64url');
}

function evidencePage(dataset, options = {}) {
  const evidence = datasetEvidence(dataset);
  const summary = summarizeEvidence(evidence);
  const requestedLimit = Number(options.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_EVIDENCE_PAGE_SIZE)
    : DEFAULT_EVIDENCE_PAGE_SIZE;
  let offset = 0;
  if (options.cursor) {
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(String(options.cursor), 'base64url').toString('utf8'));
    } catch {
      decoded = null;
    }
    if (
      !decoded
      || decoded.datasetHash !== dataset.contentHash
      || decoded.evidenceSetHash !== summary.evidenceSetHash
      || !Number.isInteger(decoded.offset)
      || decoded.offset < 0
      || decoded.offset >= evidence.length
    ) {
      throw new WeatherContractError(
        'WEATHER_EVIDENCE_CURSOR_INVALID',
        '气象 Evidence 分页游标无效或不属于当前资料集',
      );
    }
    offset = decoded.offset;
  }
  const records = evidence.slice(offset, offset + limit);
  const nextOffset = offset + records.length;
  return {
    evidence: records,
    page: {
      ...summary,
      offset,
      limit,
      returned: records.length,
      truncated: nextOffset < evidence.length,
      nextCursor: nextOffset < evidence.length
        ? encodeEvidenceCursor(dataset.contentHash, summary.evidenceSetHash, nextOffset)
        : null,
    },
  };
}

function publicationAssessment(dataset) {
  const validation = validateDataset(dataset);
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
  NORMALIZER_VERSION,
  CANONICAL_UNITS,
  MAX_STATIONS,
  MAX_GUIDANCE,
  MAX_EVIDENCE_RECORDS,
  DEFAULT_EVIDENCE_PAGE_SIZE,
  MAX_EVIDENCE_PAGE_SIZE,
  WeatherContractError,
  normalizeDataset,
  validateDataset,
  createEvidence,
  datasetEvidence,
  summarizeEvidence,
  evidencePage,
  publicationAssessment,
  digest,
  datasetContentHash,
  verifyProviderAttestation,
  clone,
  number,
  isoTime,
  isRfc3339,
};
