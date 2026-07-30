'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SafeWorkspace = require('../safe-workspace.cjs');
const SecurityMode = require('../security-mode.cjs');
const Contracts = require('./contracts.cjs');
const SchemaValidator = require('./schema-validator.cjs');

const CONFIG_RELATIVE_PATH = '.meteomate/weather-sources.json';
const PROVIDER_RESPONSE_API_VERSION = 'meteomate.weather.provider/v1';
const PROVIDER_RESPONSE_KIND = 'WeatherDatasetResponse';
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_LOCAL_FILE_BYTES = 64 * 1024 * 1024;
const DEPLOYMENT_MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const DEPLOYMENT_MAX_LOCAL_FILE_BYTES = 256 * 1024 * 1024;
const SUPPORTED_SOURCE_TYPES = new Set(['local', 'http-json']);
const SENSITIVE_STATIC_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key',
]);
const CREDENTIAL_REF_PREFIX = 'weather:';
const CREDENTIAL_BINDINGS_ENV = 'METEOMATE_WEATHER_CREDENTIAL_BINDINGS';
const SOURCE_AUTHORITIES_ENV = 'METEOMATE_WEATHER_SOURCE_AUTHORITIES';
const SENSITIVE_NAME_PATTERN = /(?:^|[-_])(?:api[-_]?key|auth(?:entication|orization)?[-_]?key|subscription[-_]?key|access[-_]?key|token|secret|credential|password)(?:$|[-_])/i;

class WeatherProviderError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'WeatherProviderError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function providerError(code, message, details = undefined, cause = undefined) {
  return new WeatherProviderError(code, message, details, cause ? { cause } : undefined);
}

function credentialReference(sourceId) {
  return `${CREDENTIAL_REF_PREFIX}${String(sourceId || '').trim()}`;
}

function credentialEnvironmentName(sourceId) {
  const encoded = [...String(sourceId || '').trim()]
    .map((character) => {
      if (/[a-z0-9]/.test(character)) return character.toUpperCase();
      if (/[A-Z]/.test(character)) return `_UPPER_${character}_`;
      if (character === '-') return '_DASH_';
      if (character === '.') return '_DOT_';
      if (character === '_') return '_UNDERSCORE_';
      throw new Error(`气象资料源 ID 无法映射到凭据环境变量：${sourceId}`);
    })
    .join('');
  if (!encoded) throw new Error('气象资料源 ID 不能为空');
  return `METEOMATE_WEATHER_TOKEN_${encoded}`;
}

function protectedSource(source = {}) {
  return source.official === true || String(source.classification || '').trim().toLowerCase() === 'production';
}

function sensitiveHeaderNames(value) {
  const headers = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.keys(headers).filter((name) => {
    const normalized = String(name || '').trim().toLowerCase();
    return SENSITIVE_STATIC_HEADERS.has(normalized) || SENSITIVE_NAME_PATTERN.test(normalized);
  });
}

function sensitiveURLParameterNames(url) {
  return [...url.searchParams.keys()].filter((name) => SENSITIVE_NAME_PATTERN.test(name));
}

function validateURLParameters(source, url, options = {}) {
  const sensitive = sensitiveURLParameterNames(url);
  if (sensitive.length && (securityMode(options) === SecurityMode.MODES.STRICT || protectedSource(source))) {
    throw providerError(
      'WEATHER_PROVIDER_CREDENTIAL_POLICY_DENIED',
      `气象资料源 URL 不能内联敏感查询参数 ${sensitive.join('/')}; 请使用 credentialRef`,
    );
  }
}

function credentialBindings(options = {}) {
  const configured = options.credentialBindings ?? process.env[CREDENTIAL_BINDINGS_ENV];
  if (!configured) return {};
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) return configured;
  try {
    const parsed = JSON.parse(String(configured));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(`${CREDENTIAL_BINDINGS_ENV} 必须是 Credential Reference 到可信 Origin 的 JSON 对象`);
  }
}

function deploymentSourceAuthorities(options = {}) {
  const configured = options.sourceAuthorities ?? process.env[SOURCE_AUTHORITIES_ENV];
  if (!configured) return {};
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) return configured;
  try {
    const parsed = JSON.parse(String(configured));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw providerError(
      'WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID',
      `${SOURCE_AUTHORITIES_ENV} 必须是由资料源 ID 映射到部署授权的 JSON 对象`,
    );
  }
}

function authorizedSource(source, workspace, options = {}) {
  const normalized = { ...source };
  const synthetic = source.synthetic === true;
  const authority = deploymentSourceAuthorities(options)[String(source.id || '')];
  if (!authority) {
    normalized.authority = synthetic ? 'fixture' : 'workspace';
    normalized.classification = synthetic ? 'demo' : 'experimental';
    normalized.official = false;
    return normalized;
  }
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署授权无效`);
  }
  if (String(authority.type || '') !== String(source.type || '')) {
    throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `气象资料源 ${source.id} 的类型与部署授权不一致`);
  }
  const root = SafeWorkspace.canonicalRoot(workspace, { securityMode: securityMode(options) });
  const authorizedWorkspaces = Array.isArray(authority.workspaceRoots)
    ? authority.workspaceRoots
    : authority.workspaceRoot
      ? [authority.workspaceRoot]
      : [];
  if (!authorizedWorkspaces.some((entry) => {
    try {
      return SafeWorkspace.canonicalRoot(String(entry), {
        securityMode: securityMode(options),
      }) === root;
    } catch {
      return false;
    }
  })) {
    throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `气象资料源 ${source.id} 未获准用于当前工作区`);
  }
  if (source.type === 'http-json') {
    if (!authority.origin) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署授权缺少 Origin`);
    }
    let sourceURL;
    let authorizedURL;
    try {
      sourceURL = new URL(String(source.baseUrl || ''));
      authorizedURL = new URL(String(authority.origin));
    } catch {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的 URL 或部署 Origin 无效`);
    }
    if (
      !['http:', 'https:'].includes(authorizedURL.protocol)
      || authorizedURL.username
      || authorizedURL.password
      || authorizedURL.pathname !== '/'
      || authorizedURL.search
      || authorizedURL.hash
    ) {
      throw providerError(
        'WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID',
        `气象资料源 ${source.id} 的部署 Origin 不能包含用户信息、路径、查询或片段`,
      );
    }
    if (authorizedURL.origin !== sourceURL.origin) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `气象资料源 ${source.id} 的 Origin 与部署授权不一致`);
    }
    const sourceMethod = String(source.method || 'POST').toUpperCase();
    const authorityMethod = String(authority.method || '').toUpperCase();
    if (!['GET', 'POST'].includes(authorityMethod)) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署授权缺少有效 method`);
    }
    if (authorityMethod !== sourceMethod) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `气象资料源 ${source.id} 的 method 与部署授权不一致`);
    }
    const configuredEndpoint = new URL(String(source.queryPath || '/query').trim(), sourceURL);
    const authorizedQueryPath = String(authority.queryPath || '').trim();
    if (!authorizedQueryPath.startsWith('/')) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署授权缺少绝对 queryPath`);
    }
    const authorizedEndpoint = new URL(authorizedQueryPath, authorizedURL);
    if (
      authorizedEndpoint.origin !== authorizedURL.origin
      || authorizedEndpoint.hash
      || `${authorizedEndpoint.pathname}${authorizedEndpoint.search}`
        !== `${configuredEndpoint.pathname}${configuredEndpoint.search}`
    ) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `气象资料源 ${source.id} 的 queryPath 与部署授权不一致`);
    }
  }
  if (source.type === 'local') {
    if (!authority.root) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `本地气象资料源 ${source.id} 的部署授权缺少 root`);
    }
    const configuredRoot = SafeWorkspace.resolveInside(root, source.root || '.', {
      allowMissing: true,
      securityMode: securityMode(options),
    }).path;
    const authorizedRoot = SafeWorkspace.resolveInside(root, authority.root, {
      allowMissing: true,
      securityMode: securityMode(options),
    }).path;
    if (configuredRoot !== authorizedRoot) {
      throw providerError('WEATHER_PROVIDER_AUTHORITY_MISMATCH', `本地气象资料源 ${source.id} 的 root 与部署授权不一致`);
    }
  }
  const classification = String(authority.classification || '').trim().toLowerCase();
  if (!['beta', 'production'].includes(classification)) {
    throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署成熟度必须为 beta 或 production`);
  }
  const version = String(authority.version || '').trim();
  if (!version) {
    throw providerError('WEATHER_PROVIDER_AUTHORITY_CONFIG_INVALID', `气象资料源 ${source.id} 的部署授权缺少版本`);
  }
  return {
    ...normalized,
    version,
    classification,
    official: authority.official === true,
    synthetic: false,
    authority: 'deployment',
  };
}

function normalizedCredentialBinding(reference, options = {}) {
  if (!reference) return null;
  const entry = credentialBindings(options)[reference];
  const configuredOrigin = typeof entry === 'string' ? entry : entry?.origin;
  if (!configuredOrigin) throw new Error(`凭据引用 ${reference} 未在部署方可信 Origin 注册表中登记`);
  let parsed;
  try {
    parsed = new URL(String(configuredOrigin));
  } catch {
    throw new Error(`凭据引用 ${reference} 的可信 Origin 无效`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`凭据引用 ${reference} 的可信 Origin 必须为无用户信息的 HTTP/HTTPS Origin`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`凭据引用 ${reference} 必须绑定 Origin，不能包含路径、查询或片段`);
  }
  const authScheme = String(typeof entry === 'object' ? entry.authScheme || 'Bearer' : 'Bearer').trim();
  if (!/^[A-Za-z][A-Za-z0-9._~-]{0,31}$/.test(authScheme)) {
    throw new Error(`凭据引用 ${reference} 的认证方案无效`);
  }
  return { reference, origin: parsed.origin, authScheme };
}

function validateSourceCredentials(source, options = {}) {
  const mode = securityMode(options);
  const strict = mode === SecurityMode.MODES.STRICT;
  const sourceId = String(source?.id || '').trim();
  const expectedRef = credentialReference(sourceId);
  const expectedEnv = credentialEnvironmentName(sourceId);
  const configuredRef = String(source?.credentialRef || '').trim();
  const configuredEnv = String(source?.tokenEnv || '').trim();
  const inlineTokenFields = ['token', 'apiKey'].filter((name) => String(source?.[name] || '').trim());
  const sensitiveHeaders = sensitiveHeaderNames(source?.headers);
  let hasURLCredentials = false;
  let sensitiveQueryParameters = [];
  if (source?.baseUrl) {
    try {
      const parsed = new URL(String(source.baseUrl));
      hasURLCredentials = Boolean(parsed.username || parsed.password);
      sensitiveQueryParameters = sensitiveURLParameterNames(parsed);
    } catch {
      hasURLCredentials = false;
      sensitiveQueryParameters = [];
    }
  }

  if (configuredRef && configuredRef !== expectedRef) {
    throw new Error(`气象资料源 ${sourceId} 的 credentialRef 必须为 ${expectedRef}`);
  }
  if (configuredEnv && configuredEnv !== expectedEnv) {
    throw new Error(`气象资料源 ${sourceId} 的 tokenEnv 只能使用固定凭据环境变量 ${expectedEnv}`);
  }
  if (
    (configuredRef || configuredEnv)
    && (inlineTokenFields.length || sensitiveHeaders.length || hasURLCredentials || sensitiveQueryParameters.length)
  ) {
    throw new Error(`气象资料源 ${sourceId} 不能同时配置 credentialRef/tokenEnv 和内联凭据`);
  }
  if ((configuredRef || configuredEnv) && source?.authority !== 'deployment') {
    throw providerError(
      'WEATHER_PROVIDER_CREDENTIAL_AUTHORITY_REQUIRED',
      `气象资料源 ${sourceId} 只有在部署授权绑定工作区、方法和路径后才能使用 credentialRef/tokenEnv`,
    );
  }
  if ((strict || protectedSource(source)) && inlineTokenFields.length) {
    throw new Error(`气象资料源 ${sourceId} 不能内联配置 ${inlineTokenFields.join('/')}; 请使用 ${expectedRef}`);
  }
  if ((strict || protectedSource(source)) && sensitiveHeaders.length) {
    throw new Error(`气象资料源 ${sourceId} 不能内联配置敏感 Header ${sensitiveHeaders.join('/')}; 请使用 ${expectedRef}`);
  }
  if ((strict || protectedSource(source)) && hasURLCredentials) {
    throw new Error(`气象资料源 ${sourceId} 的 URL 不能包含用户名或密码; 请使用 ${expectedRef}`);
  }
  if ((strict || protectedSource(source)) && sensitiveQueryParameters.length) {
    throw new Error(`气象资料源 ${sourceId} 的 URL 不能内联敏感查询参数 ${sensitiveQueryParameters.join('/')}; 请使用 ${expectedRef}`);
  }
  const reference = configuredRef || configuredEnv ? expectedRef : '';
  const binding = normalizedCredentialBinding(reference, options);
  if (binding) {
    if (source?.type !== 'http-json') throw new Error(`凭据引用 ${reference} 只能用于 HTTP JSON 资料源`);
    const base = new URL(String(source.baseUrl || ''));
    if (base.origin !== binding.origin) {
      throw new Error(`凭据引用 ${reference} 只能发送到可信 Origin ${binding.origin}`);
    }
    if ((source.allowedHosts || []).some((host) => String(host).trim() === '*')) {
      throw new Error(`凭据引用 ${reference} 禁止使用通配 allowedHosts`);
    }
  }
  return {
    credentialRef: configuredRef,
    environmentName: configuredRef || configuredEnv ? expectedEnv : '',
    binding,
  };
}

function parseCSVLine(line) {
  const result = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw providerError('WEATHER_PROVIDER_CSV_INVALID', 'CSV 包含未闭合的引号');
  result.push(value);
  return result;
}

function parseCSVRecords(content) {
  const source = String(content || '').replace(/^\uFEFF/, '');
  const records = [];
  let record = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      record += character;
      if (quoted && source[index + 1] === '"') {
        record += source[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (record.trim()) records.push(record);
      record = '';
      if (character === '\r' && source[index + 1] === '\n') index += 1;
    } else {
      record += character;
    }
  }
  if (quoted) throw providerError('WEATHER_PROVIDER_CSV_INVALID', 'CSV 包含未闭合的引号');
  if (record.trim()) records.push(record);
  return records;
}

function scalar(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function csvDataset(content, metadata = {}) {
  const lines = parseCSVRecords(content);
  if (lines.length < 2) throw providerError('WEATHER_PROVIDER_CSV_INVALID', 'CSV 至少需要表头和一行数据');
  if (lines.length - 1 > Contracts.MAX_STATIONS) {
    throw providerError(
      'WEATHER_STATION_LIMIT_EXCEEDED',
      `CSV 站点数超过 ${Contracts.MAX_STATIONS} 条限制`,
      { maximum: Contracts.MAX_STATIONS, actual: lines.length - 1 },
    );
  }
  const headers = parseCSVLine(lines[0]).map((header) => header.trim());
  if (headers.some((header) => !header)) throw providerError('WEATHER_PROVIDER_CSV_INVALID', 'CSV 表头不能为空');
  if (new Set(headers).size !== headers.length) throw providerError('WEATHER_PROVIDER_CSV_INVALID', 'CSV 表头不能重复');
  const units = {
    ...(metadata.units && typeof metadata.units === 'object' ? metadata.units : {}),
  };
  const explicitColumns = {
    rain_1h_mm: ['rain1h', 'mm'],
    rain_3h_mm: ['rain3h', 'mm'],
    rain_6h_mm: ['rain6h', 'mm'],
    rain_12h_mm: ['rain12h', 'mm'],
    rain_24h_mm: ['rain24h', 'mm'],
    temperature_c: ['temperature', '°C'],
    dewpoint_c: ['dewpoint', '°C'],
    wind_direction_degree: ['windDirection', 'degree'],
    wind_speed_ms: ['windSpeed', 'm/s'],
    gust_ms: ['gust', 'm/s'],
    pressure_hpa: ['pressure', 'hPa'],
  };
  for (const header of headers) {
    const declaration = explicitColumns[header];
    if (declaration) units[declaration[0]] = declaration[1];
  }
  const stations = lines.slice(1).map((line, index) => {
    const cells = parseCSVLine(line);
    if (cells.length !== headers.length) {
      throw providerError('WEATHER_PROVIDER_CSV_INVALID', `CSV 第 ${index + 2} 行列数与表头不一致`);
    }
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, String(cells[cellIndex] ?? '').trim()]));
    const value = (...names) => {
      const entry = names.find((name) => row[name] != null && row[name] !== '');
      return entry ? scalar(row[entry]) : null;
    };
    const stringValue = (...names) => {
      const entry = names.find((name) => row[name] != null && row[name] !== '');
      return entry ? row[entry] : '';
    };
    return {
      id: stringValue('id', 'stationId', 'station_id') || `station-${index + 1}`,
      name: stringValue('name', 'stationName', 'station_name') || stringValue('id', 'stationId', 'station_id'),
      lon: value('lon', 'longitude'),
      lat: value('lat', 'latitude'),
      rain1h: value('rain1h', 'rain_1h', 'rain_1h_mm'),
      rain3h: value('rain3h', 'rain_3h', 'rain_3h_mm'),
      rain6h: value('rain6h', 'rain_6h', 'rain_6h_mm'),
      rain12h: value('rain12h', 'rain_12h', 'rain_12h_mm'),
      rain24h: value('rain24h', 'rain_24h', 'rain_24h_mm'),
      temperature: value('temperature', 'temp', 'temperature_c'),
      dewpoint: value('dewpoint', 'dew_point', 'dewpoint_c'),
      windDirection: value('windDirection', 'wind_direction', 'wind_direction_degree'),
      windSpeed: value('windSpeed', 'wind_speed', 'wind_speed_ms'),
      gust: value('gust', 'gust_ms'),
      pressure: value('pressure', 'pressure_hpa'),
      quality: stringValue('quality') || 'unknown',
      validTime: stringValue('validTime', 'valid_time') || null,
      metadata: row,
    };
  });
  return {
    schemaVersion: Contracts.DATASET_SCHEMA_VERSION,
    id: metadata.datasetId,
    name: metadata.name || path.basename(metadata.path || 'stations.csv'),
    source: metadata.source,
    region: metadata.region,
    issueTime: metadata.issueTime,
    validTime: metadata.validTime,
    model: metadata.model,
    forecastHour: metadata.forecastHour,
    units,
    stations,
    metadata: { importedFormat: 'csv', sourcePath: metadata.path },
  };
}

function readJSON(target) {
  const text = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw providerError('WEATHER_PROVIDER_INVALID_JSON', '本地气象资料包含无效 JSON', undefined, error);
  }
  return parsed;
}

function unwrapProviderDataset(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw providerError('WEATHER_PROVIDER_RESPONSE_SCHEMA_INVALID', '气象 Provider 响应必须是对象');
  }
  if (!Object.hasOwn(value, 'dataset')) {
    if (options.requireEnvelope === true) {
      throw providerError(
        'WEATHER_PROVIDER_RESPONSE_SCHEMA_INVALID',
        `气象 HTTP Provider 必须返回 ${PROVIDER_RESPONSE_API_VERSION} / ${PROVIDER_RESPONSE_KIND} Envelope`,
      );
    }
    return value;
  }
  if (
    value.apiVersion !== PROVIDER_RESPONSE_API_VERSION
    || value.kind !== PROVIDER_RESPONSE_KIND
    || !value.dataset
    || typeof value.dataset !== 'object'
    || Array.isArray(value.dataset)
  ) {
    throw providerError(
      'WEATHER_PROVIDER_RESPONSE_SCHEMA_INVALID',
      `气象 Provider Envelope 必须声明 ${PROVIDER_RESPONSE_API_VERSION} / ${PROVIDER_RESPONSE_KIND}`,
    );
  }
  return value.dataset;
}

function geoJSONDataset(value, metadata = {}) {
  if (value?.type !== 'FeatureCollection') return unwrapProviderDataset(value);
  if (!Array.isArray(value.features)) {
    throw providerError('WEATHER_PROVIDER_GEOJSON_INVALID', 'GeoJSON FeatureCollection 缺少 features 数组');
  }
  if (value.features.length > Contracts.MAX_STATIONS) {
    throw providerError(
      'WEATHER_STATION_LIMIT_EXCEEDED',
      `GeoJSON 站点数超过 ${Contracts.MAX_STATIONS} 条限制`,
      { maximum: Contracts.MAX_STATIONS, actual: value.features.length },
    );
  }
  const properties = value.properties && typeof value.properties === 'object' ? value.properties : {};
  const stations = value.features.map((feature, index) => {
    if (
      feature?.type !== 'Feature'
      || feature.geometry?.type !== 'Point'
      || !Array.isArray(feature.geometry.coordinates)
      || feature.geometry.coordinates.length < 2
    ) {
      throw providerError('WEATHER_PROVIDER_GEOJSON_INVALID', `GeoJSON 第 ${index + 1} 个要素必须是 Point Feature`);
    }
    const station = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    return {
      ...station,
      id: station.id || feature.id,
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      metadata: {
        ...(station.metadata && typeof station.metadata === 'object' ? station.metadata : {}),
        geojsonFeatureId: feature.id ?? null,
      },
    };
  });
  const region = properties.region && typeof properties.region === 'object'
    ? properties.region
    : metadata.region && typeof metadata.region === 'object'
      ? metadata.region
      : {
          name: properties.regionName || '',
          bbox: Array.isArray(value.bbox) ? value.bbox.slice(0, 4) : null,
          timezone: properties.timezone || '',
          projection: properties.projection || properties.crs || '',
        };
  return {
    schemaVersion: properties.schemaVersion || Contracts.DATASET_SCHEMA_VERSION,
    id: properties.id || metadata.datasetId,
    name: properties.name || metadata.name,
    region,
    issueTime: properties.issueTime || metadata.issueTime,
    validTime: properties.validTime || metadata.validTime,
    model: properties.model || metadata.model,
    forecastHour: properties.forecastHour ?? metadata.forecastHour,
    units: properties.units || metadata.units,
    stations,
    quality: properties.quality || {},
    metadata: {
      ...(properties.metadata && typeof properties.metadata === 'object' ? properties.metadata : {}),
      importedFormat: 'geojson',
      sourcePath: metadata.path,
    },
  };
}

function readSourceConfig(workspace, options = {}) {
  const mode = securityMode(options);
  const root = SafeWorkspace.canonicalRoot(workspace, { securityMode: mode });
  const target = SafeWorkspace.resolveInside(root, CONFIG_RELATIVE_PATH, { allowMissing: true, securityMode: mode }).path;
  if (!fs.existsSync(target)) {
    return {
      apiVersion: 'meteomate.weather/v1',
      kind: 'WeatherSourceRegistry',
      sources: [],
      path: target,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', '气象资料源注册表不是有效 JSON', undefined, error);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', '气象资料源注册表必须是对象');
  }
  if (parsed.apiVersion !== 'meteomate.weather/v1' || parsed.kind !== 'WeatherSourceRegistry') {
    throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', '气象资料源注册表版本或 kind 不受支持');
  }
  if (!Array.isArray(parsed.sources)) {
    throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', '气象资料源注册表 sources 必须是数组');
  }
  const unsupportedType = parsed.sources.find((source) => !SUPPORTED_SOURCE_TYPES.has(String(source?.type || '').trim()));
  if (unsupportedType) {
    throw providerError(
      'WEATHER_PROVIDER_UNSUPPORTED_SOURCE_TYPE',
      `不支持的气象资料源类型：${String(unsupportedType?.type || '').trim() || '空'}`,
    );
  }
  const sources = [];
  const ids = new Set();
  for (const configuredSource of parsed.sources) {
    const id = String(configuredSource?.id || '').trim();
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id)) {
      throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', `气象资料源 ID 无效：${id || '空'}`);
    }
    if (ids.has(id)) throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', `气象资料源 ID 重复：${id}`);
    ids.add(id);
    const type = String(configuredSource?.type || '').trim();
    if (!SUPPORTED_SOURCE_TYPES.has(type)) {
      throw providerError('WEATHER_PROVIDER_UNSUPPORTED_SOURCE_TYPE', `不支持的气象资料源类型：${type || '空'}`);
    }
    if (type === 'http-json' && !String(configuredSource.baseUrl || '').trim()) {
      throw providerError('WEATHER_PROVIDER_REGISTRY_INVALID', `HTTP 气象资料源 ${id} 缺少 baseUrl`);
    }
    const source = authorizedSource({ ...configuredSource, id, type }, root, {
      ...options,
      securityMode: mode,
    });
    validateSourceCredentials(source, { ...options, securityMode: mode });
    sources.push(source);
  }
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.SOURCE_REGISTRY, parsed);
  return {
    apiVersion: parsed.apiVersion || 'meteomate.weather/v1',
    kind: parsed.kind || 'WeatherSourceRegistry',
    sources,
    path: target,
  };
}

function publicSource(source) {
  let baseUrl;
  if (source.type === 'http-json') {
    try {
      const parsed = new URL(String(source.baseUrl || ''));
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      baseUrl = parsed.toString();
    } catch {
      baseUrl = '';
    }
  }
  return {
    id: String(source.id),
    name: String(source.name || source.id),
    type: String(source.type || 'local'),
    description: String(source.description || ''),
    classification: String(source.classification || 'beta'),
    official: source.official === true,
    synthetic: source.synthetic === true,
    authority: String(source.authority || 'workspace'),
    version: String(source.version || '1'),
    root: source.type === 'local' ? String(source.root || '.') : undefined,
    baseUrl: source.type === 'http-json' ? baseUrl : undefined,
  };
}

function listSources(workspace, options = {}) {
  const registry = readSourceConfig(workspace, options);
  return {
    schemaVersion: 'meteomate.weather/v1',
    registryPath: registry.path,
    sources: registry.sources.map(publicSource),
    configured: registry.sources.length > 0,
  };
}

function sourceById(workspace, sourceId, options = {}) {
  const registry = readSourceConfig(workspace, options);
  const source = registry.sources.find((item) => String(item.id) === String(sourceId));
  if (!source) throw providerError('WEATHER_PROVIDER_SOURCE_NOT_FOUND', `气象资料源不存在：${sourceId}`);
  return { source, registry };
}

function localDataset(workspace, source, datasetRef, query = {}, options = {}) {
  const mode = securityMode(options);
  const sourceRoot = SafeWorkspace.resolveInside(workspace, source.root || '.', { allowMissing: false, securityMode: mode });
  if (!fs.statSync(sourceRoot.path).isDirectory()) throw new Error('本地气象资料源 root 必须是目录');
  const reference = String(datasetRef || query.path || '').trim();
  if (!reference) throw new Error('本地资料查询需要 datasetRef 或 query.path');
  const target = SafeWorkspace.resolveInside(sourceRoot.path, reference, { allowMissing: false, securityMode: mode });
  const targetStat = fs.statSync(target.path);
  if (!targetStat.isFile()) throw new Error('本地气象资料必须是文件');
  const maxLocalFileBytes = configuredLimit(
    source,
    'maxLocalFileBytes',
    'METEOMATE_WEATHER_LOCAL_MAX_BYTES',
    DEFAULT_MAX_LOCAL_FILE_BYTES,
    DEPLOYMENT_MAX_LOCAL_FILE_BYTES,
  );
  if (targetStat.size > maxLocalFileBytes) throw new Error(`本地 JSON/CSV 气象资料超过 ${(maxLocalFileBytes / 1024 / 1024).toFixed(0)} MB 限制`);
  const extension = path.extname(target.path).toLowerCase();
  const adapterDatasetId = query.datasetId || `dataset-${Contracts.digest({
    sourceId: source.id,
    relativePath: String(target.relative).split(path.sep).join('/'),
  }).slice(0, 24)}`;
  let raw;
  if (extension === '.json') {
    raw = unwrapProviderDataset(readJSON(target.path));
  } else if (extension === '.geojson') {
    raw = geoJSONDataset(readJSON(target.path), {
      path: target.relative,
      datasetId: adapterDatasetId,
      name: query.name,
      region: query.region,
      issueTime: query.issueTime,
      validTime: query.validTime,
      model: query.model,
      forecastHour: query.forecastHour,
      units: query.units,
    });
  } else if (extension === '.csv') {
    raw = csvDataset(fs.readFileSync(target.path, 'utf8'), {
      path: target.relative,
      datasetId: adapterDatasetId,
      name: query.name,
      region: query.region,
      issueTime: query.issueTime,
      validTime: query.validTime,
      model: query.model,
      forecastHour: query.forecastHour,
      units: query.units,
    });
  } else {
    throw new Error(`暂不支持本地资料格式：${extension || '无扩展名'}；当前支持 JSON、GeoJSON 和 CSV`);
  }
  const sourceMetadata = {
    ...publicSource(source),
    type: 'local',
    uri: `file://${target.path}`,
    retrievedAt: new Date().toISOString(),
  };
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.RAW_DATASET, raw);
  const dataset = Contracts.normalizeDataset(raw, sourceMetadata);
  dataset.metadata = {
    ...(dataset.metadata || {}),
    localPath: target.path,
    localRelativePath: target.relative,
  };
  dataset.contentHash = Contracts.datasetContentHash(dataset);
  return dataset;
}

function securityMode(options = {}) {
  return SecurityMode.normalizeSecurityMode(options.securityMode ?? process.env.METEOMATE_SECURITY_MODE);
}

function allowedHost(source, parsed, options = {}) {
  const allowed = Array.isArray(source.allowedHosts) ? source.allowedHosts.map(String) : [];
  if (!allowed.length) return securityMode(options) !== SecurityMode.MODES.STRICT;
  const hostname = parsed.hostname.toLowerCase();
  const host = parsed.host.toLowerCase();
  return allowed.some((candidate) => {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '*') {
      return securityMode(options) !== SecurityMode.MODES.STRICT && !protectedSource(source);
    }
    if (normalized === hostname || normalized === host) return true;
    return normalized.startsWith('*.') && hostname.endsWith(normalized.slice(1));
  });
}

function validateStaticHeaders(value, options = {}) {
  const headers = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const strict = securityMode(options) === SecurityMode.MODES.STRICT;
  const rejectSensitive = strict || protectedSource(options.source);
  for (const [name, entry] of Object.entries(headers)) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized)) throw new Error(`气象资料源 Header 名称无效：${name}`);
    if (rejectSensitive && (SENSITIVE_STATIC_HEADERS.has(normalized) || /(?:token|secret|credential|password)/i.test(normalized))) {
      throw new Error(`敏感 Header 必须通过 credentialRef 配置：${name}`);
    }
    if (/[\r\n]/.test(String(entry ?? ''))) throw new Error(`气象资料源 Header 含非法换行：${name}`);
  }
  return Object.fromEntries(Object.entries(headers).map(([name, entry]) => [String(name), String(entry ?? '')]));
}

function validateBaseURL(source, options = {}) {
  const mode = securityMode(options);
  const strict = mode === SecurityMode.MODES.STRICT;
  const parsed = new URL(String(source.baseUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('气象资料源只支持 HTTP 或 HTTPS');
  let embeddedAuthorization = '';
  if (parsed.username || parsed.password) {
    if (strict || protectedSource(source)) throw new Error('气象资料源 URL 不能包含用户名或密码，请使用 credentialRef');
    const username = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    embeddedAuthorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
    parsed.username = '';
    parsed.password = '';
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (strict && parsed.protocol !== 'https:' && !(source.allowInsecure === true && loopback)) {
    throw new Error('严格安全模式要求 HTTPS；仅显式配置的本机回环地址允许 HTTP');
  }
  if (!allowedHost(source, parsed, { securityMode: mode })) {
    throw new Error(`气象资料源主机不在 allowedHosts 中：${parsed.hostname}`);
  }
  parsed.hash = '';
  Object.defineProperty(parsed, 'meteomateAuthorization', {
    value: embeddedAuthorization,
    enumerable: false,
    configurable: false,
  });
  return parsed;
}

function validateRequestURL(source, base, target, options = {}) {
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw providerError('WEATHER_PROVIDER_URL_POLICY_DENIED', '气象资料最终请求地址必须是无用户信息的 HTTP/HTTPS URL');
  }
  if (target.origin !== base.origin) {
    if (base.protocol === 'https:' && target.protocol !== 'https:') {
      throw providerError('WEATHER_PROVIDER_HTTP_DOWNGRADE', '气象资料 queryPath 禁止从 HTTPS 降级或跳到其他 Origin');
    }
    throw providerError('WEATHER_PROVIDER_URL_POLICY_DENIED', '气象资料 queryPath 必须与 baseUrl 使用同一 Origin');
  }
  if (target.protocol !== base.protocol) {
    throw providerError('WEATHER_PROVIDER_HTTP_DOWNGRADE', '气象资料最终请求地址禁止协议降级');
  }
  if (!allowedHost(source, target, options)) {
    throw providerError('WEATHER_PROVIDER_URL_POLICY_DENIED', `气象资料源主机不在 allowedHosts 中：${target.hostname}`);
  }
  return target;
}

function configuredLimit(source, sourceKey, envKey, fallback, maximum) {
  const sourceValue = source?.[sourceKey];
  const configured = Number(sourceValue ?? process.env[envKey] ?? fallback);
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  const trustedMaximum = sourceValue == null || source?.authority === 'deployment'
    ? maximum
    : fallback;
  return Math.min(trustedMaximum, Math.round(configured));
}

async function readResponseBytes(response, maximumBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) {
      throw providerError(
        'WEATHER_PROVIDER_RESPONSE_TOO_LARGE',
        `气象资料响应超过 ${(maximumBytes / 1024 / 1024).toFixed(0)} MB 限制`,
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel('response size limit exceeded');
        throw providerError(
          'WEATHER_PROVIDER_RESPONSE_TOO_LARGE',
          `气象资料响应超过 ${(maximumBytes / 1024 / 1024).toFixed(0)} MB 限制`,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function httpDataset(workspace, source, datasetRef, query = {}, options = {}) {
  const mode = securityMode(options);
  const credential = validateSourceCredentials(source, { ...options, securityMode: mode });
  const base = validateBaseURL(source, { securityMode: mode });
  const queryPath = String(source.queryPath || '/query').trim();
  const url = new URL(queryPath, base);
  validateRequestURL(source, base, url, { securityMode: mode });
  validateURLParameters(source, url, { securityMode: mode });
  if (mode === SecurityMode.MODES.STRICT && source.authority !== 'deployment') {
    throw providerError(
      'WEATHER_PROVIDER_SOURCE_NOT_AUTHORIZED',
      '严格安全模式仅允许访问部署方授权的 HTTP 气象资料源',
    );
  }
  if (credential.binding && url.origin !== credential.binding.origin) {
    throw providerError(
      'WEATHER_PROVIDER_CREDENTIAL_ORIGIN_DENIED',
      `凭据引用 ${credential.binding.reference} 不能发送到未登记 Origin`,
    );
  }
  const method = String(source.method || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    throw providerError('WEATHER_PROVIDER_QUERY_INVALID', '气象 HTTP Provider 只支持 GET 或 POST');
  }
  const token = credential.environmentName
    ? String(process.env[credential.environmentName] || '').trim()
    : String(source.token || source.apiKey || '').trim();
  if (credential.environmentName && !token) {
    throw providerError('WEATHER_PROVIDER_CREDENTIAL_MISSING', `资料源凭据环境变量未配置：${credential.environmentName}`);
  }
  const staticHeaders = validateStaticHeaders(source.headers, { securityMode: mode, source });
  const headers = {
    Accept: 'application/json',
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...staticHeaders,
  };
  const hasAuthorizationHeader = () => Object.keys(headers)
    .some((name) => String(name).toLowerCase() === 'authorization');
  if (!hasAuthorizationHeader() && base.meteomateAuthorization) headers.Authorization = base.meteomateAuthorization;
  if (!hasAuthorizationHeader() && token) {
    headers.Authorization = `${credential.binding?.authScheme || source.authScheme || 'Bearer'} ${token}`;
  }
  if (datasetRef != null && query && Object.hasOwn(query, 'datasetRef') && query.datasetRef != null) {
    throw providerError('WEATHER_PROVIDER_QUERY_INVALID', 'datasetRef 不能同时在顶层和 query 中声明');
  }
  if (method === 'GET') {
    if (datasetRef) url.searchParams.set('datasetRef', String(datasetRef));
    for (const [key, value] of Object.entries(query || {})) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry != null) url.searchParams.append(key, String(entry));
        }
      } else if (value != null && typeof value !== 'object') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  validateURLParameters(source, url, { securityMode: mode });
  const maxResponseBytes = configuredLimit(
    source,
    'maxResponseBytes',
    'METEOMATE_WEATHER_HTTP_MAX_BYTES',
    DEFAULT_MAX_RESPONSE_BYTES,
    DEPLOYMENT_MAX_RESPONSE_BYTES,
  );
  const timeoutMs = Math.max(1_000, Math.min(600_000, Number(source.timeoutMs) || 30_000));
  if (method === 'POST' && source.authority !== 'deployment') {
    throw providerError(
      'WEATHER_PROVIDER_METHOD_NOT_AUTHORIZED',
      'HTTP POST 气象查询仅允许使用部署方授权的资料源',
    );
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ datasetRef: datasetRef || null, query }) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const causeText = `${error?.message || ''} ${error?.cause?.message || ''}`;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout/i.test(causeText)) {
      throw providerError('WEATHER_PROVIDER_TIMEOUT', '气象资料源请求超时', { timeoutMs }, error);
    }
    if (/redirect/i.test(causeText)) {
      throw providerError('WEATHER_PROVIDER_REDIRECT_BLOCKED', '气象资料源重定向已被安全策略阻止', undefined, error);
    }
    throw providerError('WEATHER_PROVIDER_NETWORK_ERROR', '气象资料源网络请求失败', undefined, error);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxResponseBytes) {
    throw providerError(
      'WEATHER_PROVIDER_RESPONSE_TOO_LARGE',
      `气象资料响应超过 ${(maxResponseBytes / 1024 / 1024).toFixed(0)} MB 限制`,
    );
  }
  let bytes;
  try {
    bytes = await readResponseBytes(response, maxResponseBytes);
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout/i.test(String(error?.message || ''))) {
      throw providerError('WEATHER_PROVIDER_TIMEOUT', '读取气象资料响应超时', { timeoutMs }, error);
    }
    throw providerError('WEATHER_PROVIDER_NETWORK_ERROR', '读取气象资料响应失败', undefined, error);
  }
  if (!response.ok) {
    throw providerError(
      'WEATHER_PROVIDER_HTTP_ERROR',
      `气象资料源返回 HTTP ${response.status}`,
      {
        status: response.status,
        retryAfter: response.headers.get('retry-after') || null,
      },
    );
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const mediaType = contentType.split(';', 1)[0].trim();
  if (mediaType !== 'application/json' && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)) {
    throw providerError('WEATHER_PROVIDER_CONTENT_TYPE_INVALID', '气象资料源响应 Content-Type 必须是 JSON');
  }
  let raw;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw providerError('WEATHER_PROVIDER_INVALID_JSON', '气象资料源返回了无效 JSON', undefined, error);
  }
  const responseUrl = new URL(response.url || url.toString());
  if (credential.binding && responseUrl.origin !== credential.binding.origin) {
    throw providerError('WEATHER_PROVIDER_CREDENTIAL_ORIGIN_DENIED', `凭据引用 ${credential.binding.reference} 的响应来自未登记 Origin`);
  }
  if (responseUrl.protocol !== base.protocol && base.protocol === 'https:') {
    throw providerError('WEATHER_PROVIDER_HTTP_DOWNGRADE', '气象资料源响应发生 HTTPS 降级');
  }
  if (
    responseUrl.origin !== base.origin
    && (
      !Array.isArray(source.allowedHosts)
      || !source.allowedHosts.length
      || !allowedHost(source, responseUrl, { securityMode: mode })
    )
  ) {
    throw providerError('WEATHER_PROVIDER_REDIRECT_BLOCKED', '气象资料源重定向到了未授权 Origin');
  }
  const sourceMetadata = {
    ...publicSource(source),
    type: 'http-json',
    uri: `${responseUrl.origin}${responseUrl.pathname}`,
    retrievedAt: new Date().toISOString(),
  };
  const rawDataset = unwrapProviderDataset(raw, { requireEnvelope: true });
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.RAW_DATASET, rawDataset);
  return Contracts.normalizeDataset(rawDataset, sourceMetadata);
}

async function queryDataset({ workspace, sourceId, datasetRef, query = {}, securityMode: requestedSecurityMode } = {}) {
  const mode = securityMode({ securityMode: requestedSecurityMode });
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.QUERY, {
    apiVersion: 'meteomate.weather/v1',
    kind: 'WeatherQuery',
    sourceId,
    datasetRef: datasetRef ?? null,
    securityMode: mode,
    query,
  });
  if (datasetRef != null && query && Object.hasOwn(query, 'datasetRef') && query.datasetRef != null) {
    throw providerError('WEATHER_PROVIDER_QUERY_INVALID', 'datasetRef 不能同时在顶层和 query 中声明');
  }
  const root = SafeWorkspace.canonicalRoot(workspace || process.env.METEOMATE_WEATHER_WORKSPACE, { securityMode: mode });
  const { source } = sourceById(root, sourceId, { securityMode: mode });
  let dataset;
  if (source.type === 'http-json') dataset = await httpDataset(root, source, datasetRef, query, { securityMode: mode });
  else dataset = localDataset(root, source, datasetRef, query, { securityMode: mode });
  const validation = Contracts.validateDataset(dataset);
  const evidenceSummary = Contracts.summarizeEvidence(Contracts.datasetEvidence(dataset));
  const result = {
    schemaVersion: Contracts.DATASET_SCHEMA_VERSION,
    kind: 'WeatherProviderResult',
    provider: publicSource(source),
    dataset,
    validation,
    evidenceSummary,
    publication: Contracts.publicationAssessment(dataset, validation),
  };
  SchemaValidator.validateOrThrow(SchemaValidator.CONTRACT_KINDS.PROVIDER_RESULT, result);
  return result;
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  PROVIDER_RESPONSE_API_VERSION,
  PROVIDER_RESPONSE_KIND,
  SOURCE_AUTHORITIES_ENV,
  WeatherProviderError,
  readSourceConfig,
  listSources,
  queryDataset,
  csvDataset,
  validateBaseURL,
  validateStaticHeaders,
  validateSourceCredentials,
  credentialReference,
  credentialEnvironmentName,
  credentialBindings,
  deploymentSourceAuthorities,
  authorizedSource,
  normalizedCredentialBinding,
  allowedHost,
  validateRequestURL,
  unwrapProviderDataset,
  geoJSONDataset,
};
