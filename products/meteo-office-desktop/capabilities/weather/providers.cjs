'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SafeWorkspace = require('../safe-workspace.cjs');
const SecurityMode = require('../security-mode.cjs');
const Contracts = require('./contracts.cjs');

const CONFIG_RELATIVE_PATH = '.meteomate/weather-sources.json';
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_LOCAL_FILE_BYTES = 512 * 1024 * 1024;
const SENSITIVE_STATIC_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key',
]);

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
  result.push(value);
  return result;
}

function scalar(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function csvDataset(content, metadata = {}) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const headers = parseCSVLine(lines[0]).map((header) => header.trim());
  const stations = lines.slice(1).map((line, index) => {
    const cells = parseCSVLine(line);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, scalar(cells[cellIndex])]));
    return {
      id: row.id ?? row.stationId ?? row.station_id ?? `station-${index + 1}`,
      name: row.name ?? row.stationName ?? row.station_name ?? row.id,
      lon: row.lon ?? row.longitude,
      lat: row.lat ?? row.latitude,
      rain1h: row.rain1h ?? row.rain_1h,
      rain3h: row.rain3h ?? row.rain_3h,
      rain6h: row.rain6h ?? row.rain_6h,
      rain12h: row.rain12h ?? row.rain_12h,
      rain24h: row.rain24h ?? row.rain_24h,
      temperature: row.temperature ?? row.temp,
      dewpoint: row.dewpoint ?? row.dew_point,
      windDirection: row.windDirection ?? row.wind_direction,
      windSpeed: row.windSpeed ?? row.wind_speed,
      gust: row.gust,
      pressure: row.pressure,
      quality: row.quality ?? 'unknown',
      validTime: row.validTime ?? row.valid_time,
      metadata: row,
    };
  });
  return {
    id: metadata.datasetId,
    name: metadata.name || path.basename(metadata.path || 'stations.csv'),
    source: metadata.source,
    region: metadata.region,
    issueTime: metadata.issueTime,
    validTime: metadata.validTime,
    model: metadata.model,
    forecastHour: metadata.forecastHour,
    stations,
    metadata: { importedFormat: 'csv', sourcePath: metadata.path },
  };
}

function readJSON(target) {
  const text = fs.readFileSync(target, 'utf8');
  const parsed = JSON.parse(text);
  return parsed?.dataset && typeof parsed.dataset === 'object' ? parsed.dataset : parsed;
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
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
  const ids = new Set();
  for (const source of sources) {
    const id = String(source?.id || '').trim();
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id)) throw new Error(`气象资料源 ID 无效：${id || '空'}`);
    if (ids.has(id)) throw new Error(`气象资料源 ID 重复：${id}`);
    ids.add(id);
  }
  return {
    apiVersion: parsed.apiVersion || 'meteomate.weather/v1',
    kind: parsed.kind || 'WeatherSourceRegistry',
    sources,
    path: target,
  };
}

function publicSource(source) {
  return {
    id: String(source.id),
    name: String(source.name || source.id),
    type: String(source.type || 'local'),
    description: String(source.description || ''),
    classification: String(source.classification || 'beta'),
    official: source.official === true,
    synthetic: source.synthetic === true,
    version: String(source.version || '1'),
    root: source.type === 'local' ? String(source.root || '.') : undefined,
    baseUrl: source.type === 'http-json' ? String(source.baseUrl || '') : undefined,
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
  if (!source) throw new Error(`气象资料源不存在：${sourceId}`);
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
  const maxLocalFileBytes = configuredLimit(source, 'maxLocalFileBytes', 'METEOMATE_WEATHER_LOCAL_MAX_BYTES', DEFAULT_MAX_LOCAL_FILE_BYTES, 4 * 1024 * 1024 * 1024);
  if (targetStat.size > maxLocalFileBytes) throw new Error(`本地 JSON/CSV 气象资料超过 ${(maxLocalFileBytes / 1024 / 1024).toFixed(0)} MB 限制`);
  const extension = path.extname(target.path).toLowerCase();
  let raw;
  if (extension === '.json' || extension === '.geojson') {
    raw = readJSON(target.path);
  } else if (extension === '.csv') {
    raw = csvDataset(fs.readFileSync(target.path, 'utf8'), {
      path: target.relative,
      datasetId: query.datasetId,
      name: query.name,
      region: query.region,
      issueTime: query.issueTime,
      validTime: query.validTime,
      model: query.model,
      forecastHour: query.forecastHour,
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
    if (!normalized || normalized === '*') return true;
    if (normalized === hostname || normalized === host) return true;
    return normalized.startsWith('*.') && hostname.endsWith(normalized.slice(1));
  });
}

function validateStaticHeaders(value, options = {}) {
  const headers = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const strict = securityMode(options) === SecurityMode.MODES.STRICT;
  for (const [name, entry] of Object.entries(headers)) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized)) throw new Error(`气象资料源 Header 名称无效：${name}`);
    if (strict && (SENSITIVE_STATIC_HEADERS.has(normalized) || /(?:token|secret|credential|password)/i.test(normalized))) {
      throw new Error(`严格安全模式下敏感 Header 必须通过 tokenEnv/Secret Store 配置：${name}`);
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
    if (strict) throw new Error('严格安全模式下气象资料源 URL 不能包含用户名或密码');
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

function configuredLimit(source, sourceKey, envKey, fallback, maximum) {
  const configured = Number(source?.[sourceKey] ?? process.env[envKey] ?? fallback);
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  return Math.min(maximum, Math.round(configured));
}

async function readResponseBytes(response, maximumBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new Error(`气象资料响应超过 ${(maximumBytes / 1024 / 1024).toFixed(0)} MB 限制`);
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
        throw new Error(`气象资料响应超过 ${(maximumBytes / 1024 / 1024).toFixed(0)} MB 限制`);
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
  const strict = mode === SecurityMode.MODES.STRICT;
  const base = validateBaseURL(source, { securityMode: mode });
  const queryPath = String(source.queryPath || '/query').trim();
  const url = new URL(queryPath, base);
  if (!allowedHost(source, url, { securityMode: mode })) throw new Error('查询地址跳出了资料源允许主机');
  const method = String(source.method || 'POST').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('气象 HTTP Provider 只支持 GET 或 POST');
  const tokenEnv = String(source.tokenEnv || '').trim();
  const token = tokenEnv ? process.env[tokenEnv] : String(source.token || source.apiKey || '').trim();
  if (tokenEnv && !token) throw new Error(`资料源凭据环境变量未配置：${tokenEnv}`);
  const staticHeaders = validateStaticHeaders(source.headers, { securityMode: mode });
  const headers = {
    Accept: 'application/json',
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...staticHeaders,
  };
  if (!headers.Authorization && base.meteomateAuthorization) headers.Authorization = base.meteomateAuthorization;
  if (!headers.Authorization && token) headers.Authorization = `${source.authScheme || 'Bearer'} ${token}`;
  if (method === 'GET') {
    if (datasetRef) url.searchParams.set('datasetRef', String(datasetRef));
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null && typeof value !== 'object') url.searchParams.set(key, String(value));
    }
  }
  const maxResponseBytes = configuredLimit(
    source,
    'maxResponseBytes',
    'METEOMATE_WEATHER_HTTP_MAX_BYTES',
    DEFAULT_MAX_RESPONSE_BYTES,
    2 * 1024 * 1024 * 1024,
  );
  const timeoutMs = Math.max(1_000, Math.min(600_000, Number(source.timeoutMs) || 30_000));
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify({ datasetRef: datasetRef || null, query }) : undefined,
    redirect: strict || source.followRedirects === false ? 'error' : 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxResponseBytes) throw new Error(`气象资料响应超过 ${(maxResponseBytes / 1024 / 1024).toFixed(0)} MB 限制`);
  const bytes = await readResponseBytes(response, maxResponseBytes);
  if (!response.ok) throw new Error(`气象资料源返回 HTTP ${response.status}：${bytes.toString('utf8').slice(0, 500)}`);
  let raw;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('气象资料源返回了无效 JSON');
  }
  const responseUrl = new URL(response.url || url.toString());
  if (strict && !allowedHost(source, responseUrl, { securityMode: mode })) {
    throw new Error('气象资料源重定向到了未授权主机');
  }
  const sourceMetadata = {
    ...publicSource(source),
    type: 'http-json',
    uri: `${responseUrl.origin}${responseUrl.pathname}`,
    retrievedAt: new Date().toISOString(),
  };
  return Contracts.normalizeDataset(raw?.dataset || raw, sourceMetadata);
}

async function queryDataset({ workspace, sourceId, datasetRef, query = {}, securityMode: requestedSecurityMode } = {}) {
  const mode = securityMode({ securityMode: requestedSecurityMode });
  const root = SafeWorkspace.canonicalRoot(workspace || process.env.METEOMATE_WEATHER_WORKSPACE, { securityMode: mode });
  const { source } = sourceById(root, sourceId, { securityMode: mode });
  let dataset;
  if (source.type === 'http-json') dataset = await httpDataset(root, source, datasetRef, query, { securityMode: mode });
  else dataset = localDataset(root, source, datasetRef, query, { securityMode: mode });
  const validation = Contracts.validateDataset(dataset);
  return {
    schemaVersion: Contracts.DATASET_SCHEMA_VERSION,
    provider: publicSource(source),
    dataset,
    validation,
    evidence: Contracts.datasetEvidence(dataset),
    publication: Contracts.publicationAssessment(dataset, validation),
  };
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  readSourceConfig,
  listSources,
  queryDataset,
  csvDataset,
  validateBaseURL,
  validateStaticHeaders,
  allowedHost,
};
