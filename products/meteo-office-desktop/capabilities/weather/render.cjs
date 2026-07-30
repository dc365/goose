'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const SafeWorkspace = require('../safe-workspace.cjs');
const Contracts = require('./contracts.cjs');

const RENDERER_VERSION = 'meteomate-weather-risk-map/1.1.0';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rainfallColor(value) {
  if (value >= 250) return '#4c1d95';
  if (value >= 100) return '#b91c1c';
  if (value >= 50) return '#ea580c';
  if (value >= 25) return '#ca8a04';
  if (value >= 10) return '#0891b2';
  return '#2563eb';
}

function bounds(dataset) {
  if (Array.isArray(dataset.region?.bbox) && dataset.region.bbox.every(Number.isFinite)) {
    return dataset.region.bbox;
  }
  const points = (dataset.stations || []).filter((station) => Number.isFinite(station.lon) && Number.isFinite(station.lat));
  if (!points.length) return [100, 15, 130, 45];
  const lons = points.map((station) => station.lon);
  const lats = points.map((station) => station.lat);
  const paddingLon = Math.max(0.3, (Math.max(...lons) - Math.min(...lons)) * 0.15);
  const paddingLat = Math.max(0.3, (Math.max(...lats) - Math.min(...lats)) * 0.15);
  return [Math.min(...lons) - paddingLon, Math.min(...lats) - paddingLat, Math.max(...lons) + paddingLon, Math.max(...lats) + paddingLat];
}

function renderHtml(dataset, diagnosis = {}) {
  const [minLon, minLat, maxLon, maxLat] = bounds(dataset);
  const width = Math.max(0.1, maxLon - minLon);
  const height = Math.max(0.1, maxLat - minLat);
  const stations = (dataset.stations || [])
    .filter((station) => (
      Number.isFinite(station.lon)
      && Number.isFinite(station.lat)
      && (Number.isFinite(station.rain24h) || Number.isFinite(station.rain6h))
    ))
    .map((station) => {
      const rain = Number.isFinite(station.rain24h) ? station.rain24h : station.rain6h;
      const x = 70 + ((station.lon - minLon) / width) * 740;
      const y = 430 - ((station.lat - minLat) / height) * 340;
      const radius = Math.max(8, Math.min(30, Math.sqrt(Math.max(0, rain)) * 2.2));
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle r="${radius.toFixed(1)}" fill="${rainfallColor(rain)}" fill-opacity=".84" stroke="#fff" stroke-width="3" />
        <text y="-${(radius + 8).toFixed(1)}" text-anchor="middle">${escapeHtml(station.name)}</text>
        <text y="4" text-anchor="middle" class="amount">${escapeHtml(rain.toFixed(1))}</text>
      </g>`;
    }).join('');
  const dimensions = diagnosis.heavyRain?.dimensions || [];
  const metrics = dimensions.map((item) => {
    const evidenceText = Array.isArray(item.evidence) ? item.evidence.join('；') : String(item.evidence || '');
    const maximum = Math.max(1, Number(item.max) || 1);
    const score = Math.max(0, Number(item.score) || 0);
    return `<div class="metric"><header><strong>${escapeHtml(item.name)}</strong><span>${score}/${maximum}</span></header><i style="--score:${Math.round(Math.min(1, score / maximum) * 100)}%"></i><small>${escapeHtml(evidenceText || '资料不足')}</small></div>`;
  }).join('');
  const classification = dataset.source?.classification || 'unknown';
  const synthetic = dataset.source?.synthetic === true;
  const notice = synthetic || classification === 'demo'
    ? '构造/演示数据 · 禁止正式发布'
    : `${escapeHtml(classification.toUpperCase())} · ${dataset.source?.official ? '官方来源' : '内部或非官方来源'} · 发布前需人工签发`;
  const total = diagnosis.heavyRain?.total;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(dataset.name)} · MeteoMate 风险图</title>
<style>
:root{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#edf2f7}*{box-sizing:border-box}body{margin:0;padding:28px}.notice{border-radius:12px;padding:12px 16px;background:#fff4d6;border:1px solid #f0c357;color:#7a4b00;font-weight:700}header.page{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:22px 0}h1{margin:0;font-size:30px}.sub{margin:7px 0 0;color:#5f6b7b}.score{font-size:42px;font-weight:800;color:#b42318}.score small{font-size:13px;display:block;text-align:right;color:#64748b}.grid{display:grid;grid-template-columns:minmax(540px,1.5fr) minmax(320px,.8fr);gap:20px}.card{background:#fff;border:1px solid #dce4ee;border-radius:18px;padding:18px;box-shadow:0 10px 32px #27445f14}svg{width:100%;height:auto;background:linear-gradient(155deg,#f8fbff,#dfeaf4);border-radius:14px}svg text{font-size:14px;font-weight:700;fill:#17314d}.amount{font-size:12px;fill:#fff}.frame{fill:none;stroke:#7d91a5;stroke-width:2}.axis{font-size:11px;fill:#64748b}.metrics{display:grid;gap:14px}.metric header{display:flex;justify-content:space-between}.metric i{display:block;height:7px;margin:6px 0;background:linear-gradient(90deg,#2563eb var(--score),#e6edf5 var(--score));border-radius:99px}.metric small{color:#64748b;line-height:1.55}footer{margin-top:18px;color:#607086;font-size:13px;line-height:1.6}@media(max-width:900px){body{padding:15px}.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="notice">${notice}</div>
<header class="page"><div><h1>${escapeHtml(dataset.name)}</h1><p class="sub">${escapeHtml(dataset.region?.name || '未指定区域')} · ${escapeHtml(dataset.validTime?.start || '')} — ${escapeHtml(dataset.validTime?.end || '')}<br>${escapeHtml(dataset.source?.name || dataset.source?.id)} · 数据摘要 ${escapeHtml(dataset.contentHash?.slice(0, 16) || '无')}</p></div>${Number.isFinite(total) ? `<div class="score">${total}<small>强降水评分 / 100</small></div>` : ''}</header>
<main class="grid"><section class="card"><svg viewBox="0 0 880 500" role="img" aria-label="站点降水与风险示意图"><rect class="frame" x="55" y="55" width="770" height="390" rx="12"/>${stations}<text x="55" y="475" class="axis">圆面积与颜色表示 24h（无 24h 时使用 6h）降水量，底图仅为经纬度散点范围，不代表行政区边界。</text></svg></section><aside class="card"><h2>诊断证据</h2><div class="metrics">${metrics || '<p>尚未执行强降水诊断。</p>'}</div></aside></main>
<footer>数据分类：${escapeHtml(classification)}；来源版本：${escapeHtml(dataset.source?.version || dataset.contentHash || '未知')}。本图由 MeteoMate 生成，最终业务结论须由预报员审核签发。</footer>
</body></html>`;
}

function artifactRecord(filePath, dataset, diagnosis, evidence = []) {
  const content = fs.readFileSync(filePath);
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  return {
    apiVersion: 'meteomate/v1',
    kind: 'Artifact',
    id: `artifact-weather-${contentHash.slice(0, 24)}`,
    name: path.basename(filePath),
    type: 'HTML',
    path: filePath,
    mediaType: 'text/html',
    status: 'ready',
    sizeBytes: content.length,
    contentHash,
    createdAt: Date.now(),
    evidenceIds: evidence.map((item) => item.id).filter(Boolean),
    metadata: {
      source: 'meteomate-weather-provider',
      datasetId: dataset.id,
      datasetHash: dataset.contentHash,
      classification: dataset.source?.classification,
      synthetic: dataset.source?.synthetic === true,
      official: dataset.source?.official === true,
      algorithm: diagnosis?.algorithm || null,
    },
  };
}

function renderDatasetMap({ workspace, dataset: input, diagnosis = {}, evidence = [], outputPath = 'artifacts/weather/risk-map.html' } = {}) {
  const root = SafeWorkspace.canonicalRoot(
    workspace || process.env.METEOMATE_WEATHER_WORKSPACE,
    { securityMode: 'strict' },
  );
  const dataset = Contracts.normalizeDataset(input);
  const validation = Contracts.validateDataset(dataset);
  if (!validation.valid) {
    throw new Contracts.WeatherContractError(
      'WEATHER_DATASET_INVALID',
      `气象资料集未通过制图前校验：${validation.errors.join('；')}`,
      { validation },
    );
  }
  const target = SafeWorkspace.ensureParent(root, outputPath, { securityMode: 'strict' });
  fs.writeFileSync(target, renderHtml(dataset, diagnosis), { encoding: 'utf8', mode: 0o600 });
  return artifactRecord(target, dataset, diagnosis, evidence);
}

module.exports = { RENDERER_VERSION, renderDatasetMap, renderHtml, artifactRecord };
