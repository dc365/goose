'use strict';

const SafeWorkspace = require('./safe-workspace.cjs');
const WeatherContracts = require('./weather/contracts.cjs');
const WeatherProviders = require('./weather/providers.cjs');
const WeatherDiagnosis = require('./weather/diagnosis.cjs');
const WeatherRender = require('./weather/render.cjs');

const SCHEMA_VERSION = 'meteomate.weather/v1';
const SERVER_VERSION = '1.1.0';
const CASE_ID = 'synthetic-fujian-rainstorm-001';

const SYNTHETIC_CASE = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  id: CASE_ID,
  name: '福建暖区暴雨构造样例 A',
  synthetic: true,
  official: false,
  dataNotice: 'MeteoMate 内置构造测试数据，仅用于功能演示、联调和培训，不代表任何一次真实天气过程或官方预报。',
  region: {
    name: '福建中东部示范区域',
    bbox: [117.2, 24.8, 120.6, 27.7],
    timezone: 'Asia/Shanghai',
  },
  validTime: {
    start: '2026-06-18T08:00:00+08:00',
    end: '2026-06-19T08:00:00+08:00',
    issueTime: '2026-06-18T08:30:00+08:00',
  },
  provenance: {
    source: 'MeteoMate synthetic fixture',
    generation: '依据天气分析最小闭环构造：水汽、抬升、不稳定、持续条件和模式一致性。',
    knowledgeReferences: [
      'weather_course_site/lessons/lesson-01.html',
      'weather_course_site/lessons/lesson-06.html',
      'weather_course_site/lessons/lesson-07.html',
      'weather_course_site/lessons/lesson-08.html',
      'weather_course_site/lessons/lesson-09.html',
      'weather_course_site/lessons/lesson-10.html',
      'weather_course_site/lessons/lesson-15.html',
    ],
  },
  stations: [
    { id: '58847', name: '福州', lon: 119.29, lat: 26.08, rain1h: 18.6, rain6h: 48.2, rain24h: 86.4, temperature: 26.8, dewpoint: 25.1, windDirection: 190, windSpeed: 6.8, gust: 14.1, pressure: 997.8, quality: 'checked' },
    { id: '58844', name: '闽侯', lon: 119.14, lat: 26.15, rain1h: 24.1, rain6h: 67.5, rain24h: 118.3, temperature: 26.2, dewpoint: 24.9, windDirection: 205, windSpeed: 5.9, gust: 13.4, pressure: 996.9, quality: 'checked' },
    { id: '58911', name: '永泰', lon: 118.93, lat: 25.87, rain1h: 31.7, rain6h: 82.9, rain24h: 146.8, temperature: 25.4, dewpoint: 24.6, windDirection: 180, windSpeed: 4.7, gust: 11.8, pressure: 988.6, quality: 'checked' },
    { id: '58942', name: '福清', lon: 119.38, lat: 25.72, rain1h: 15.2, rain6h: 39.6, rain24h: 73.5, temperature: 27.1, dewpoint: 25.2, windDirection: 175, windSpeed: 7.6, gust: 15.9, pressure: 998.1, quality: 'checked' },
    { id: '58848', name: '连江', lon: 119.54, lat: 26.20, rain1h: 12.8, rain6h: 42.7, rain24h: 79.1, temperature: 26.5, dewpoint: 24.8, windDirection: 195, windSpeed: 7.2, gust: 16.2, pressure: 998.4, quality: 'checked' },
    { id: '58845', name: '罗源', lon: 119.55, lat: 26.49, rain1h: 8.4, rain6h: 31.2, rain24h: 61.7, temperature: 26.0, dewpoint: 24.2, windDirection: 200, windSpeed: 5.5, gust: 12.6, pressure: 997.6, quality: 'checked' },
  ],
  upperAir: {
    surface: { pressureCenter: 996, pressureUnit: 'hPa', feature: '闽中沿海构造性低压倒槽', convergence: '中等偏强' },
    '850hPa': { height: 1510, temperature: 19.2, dewpoint: 17.8, windDirection: 205, windSpeed: 18.0, specificHumidity: 14.8, moistureFluxConvergence: -4.2e-5, feature: '西南低空急流与暖湿输送' },
    '700hPa': { height: 3120, temperature: 8.4, dewpoint: 6.2, omega: -0.42, feature: '持续上升运动区' },
    '500hPa': { height: 5860, temperature: -7.8, windDirection: 235, windSpeed: 22.0, feature: '短波槽东移，副高西北侧西南气流' },
    '200hPa': { height: 12480, windDirection: 255, windSpeed: 38.0, divergence: 3.1e-5, feature: '高空急流入口区辐散' },
    indices: {
      precipitableWater: 63,
      cape: 1450,
      cin: 28,
      kIndex: 38,
      liftedIndex: -3.4,
      shear0to6km: 17,
      lcl: 620,
      freezingLevel: 5100,
    },
  },
  radar: {
    product: '构造组合反射率摘要',
    validTime: '2026-06-18T14:00:00+08:00',
    maxDbz: 55,
    coverage: '闽侯—永泰—福州西部',
    morphology: '西南—东北向带状回波，多单体合并',
    movement: { direction: '东北', speedKmh: 28 },
    signals: ['局地 50 dBZ 以上强回波', '上游持续生成', '存在列车效应倾向'],
  },
  guidance: [
    { model: 'ECMWF-like synthetic', cycle: '2026-06-18T08:00:00+08:00', regionalMax24h: 132, fuzhou24h: 78, yongtai24h: 126, timing: '18 日 14 时至 19 日 02 时', confidence: 0.78 },
    { model: 'CMA-MESO-like synthetic', cycle: '2026-06-18T08:00:00+08:00', regionalMax24h: 168, fuzhou24h: 96, yongtai24h: 151, timing: '18 日 12 时至 19 日 03 时', confidence: 0.72 },
    { model: 'GRAPES-like synthetic', cycle: '2026-06-18T08:00:00+08:00', regionalMax24h: 112, fuzhou24h: 69, yongtai24h: 104, timing: '18 日 15 时至 19 日 00 时', confidence: 0.67 },
  ],
  diagnoses: {
    synoptic: {
      confidence: 0.82,
      systems: [
        { type: 'subtropical-high-edge', name: '副热带高压西北侧', evidence: '500hPa 586 dagpm 附近西南气流维持' },
        { type: 'short-wave-trough', name: '东移短波槽', evidence: '500hPa 槽前正涡度平流与高空辐散配置' },
        { type: 'low-level-jet', name: '850hPa 西南低空急流', evidence: '风速 18 m/s、比湿 14.8 g/kg' },
        { type: 'surface-convergence', name: '沿海低压倒槽与辐合带', evidence: '地面 996 hPa 倒槽叠加暖湿气流' },
      ],
      evolution: '短波槽缓慢东移，低空急流在傍晚前后维持，夜间后水汽通道减弱，强降水由西南向东北收缩。',
      uncertainty: '构造样例未包含真实地形订正与资料同化误差，落区只能用于流程演示。',
    },
    heavyRain: {
      total: 85,
      level: '高风险',
      dimensions: [
        { key: 'moisture', name: '水汽条件', score: 23, max: 25, evidence: 'PW 63 mm，850hPa 比湿 14.8 g/kg，西南急流持续输送' },
        { key: 'lift', name: '动力抬升', score: 21, max: 25, evidence: '700hPa ω=-0.42 Pa/s，低层辐合与高空辐散配合' },
        { key: 'instability', name: '热力不稳定', score: 17, max: 20, evidence: 'CAPE 1450 J/kg，CIN 28 J/kg，K 指数 38℃' },
        { key: 'persistence', name: '持续条件', score: 16, max: 20, evidence: '带状回波沿低空急流方向移动，上游持续生成' },
        { key: 'consistency', name: '模式一致性', score: 8, max: 10, evidence: '三套构造模式均报出永泰附近 100 mm 以上中心' },
      ],
      hotspots: [
        { name: '永泰—闽侯', level: '高', expected24h: '100–160 mm', maxHourly: '30–50 mm', confidence: 0.82 },
        { name: '福州西部—福清北部', level: '较高', expected24h: '60–100 mm', maxHourly: '20–40 mm', confidence: 0.74 },
        { name: '连江—罗源', level: '中等', expected24h: '40–80 mm', maxHourly: '15–30 mm', confidence: 0.63 },
      ],
      uncertainty: '强中心位置在不同构造模式间有约 30–50 km 偏差；需用雷达回波演变和逐小时站点雨量滚动订正。',
    },
    convection: {
      total: 72,
      level: '较高风险',
      hazards: [
        { type: '短时强降水', probability: 0.82, confidence: '高', evidence: '高 PW、低 LCL、中等 CAPE 与列车效应倾向' },
        { type: '雷暴大风', probability: 0.46, confidence: '中', evidence: '0–6 km 风切变 17 m/s，阵风潜势存在但冷池证据有限' },
        { type: '冰雹', probability: 0.18, confidence: '低', evidence: '0℃层约 5.1 km 偏高，主要上升区暖云层深' },
      ],
      trigger: '低压倒槽辐合叠加地形抬升，午后边界层加热削弱 CIN。',
      uncertainty: '未提供真实雷达径向速度、卫星云顶温度和高频探空，旋转与大风风险不可作确定判断。',
    },
  },
  forecastDraft: {
    title: '福建中东部强降水天气提示（演示稿）',
    summary: '预计示范区域 18 日午后至 19 日凌晨有一次明显降水过程，永泰—闽侯一带存在暴雨到大暴雨构造性风险。',
    keyPeriod: '18 日 14 时至 19 日 02 时',
    impacts: ['城乡积涝', '山洪与地质灾害', '低能见度和道路湿滑', '局地雷暴大风'],
    reviewRequired: ['所有数值均为构造数据', '发布前必须替换为业务实况和最新模式', '风险用语须经值班预报员审核'],
  },
});

const BETA_TOOL_NAMES = new Set([
  'weather_list_sources',
  'weather_query_dataset',
  'weather_validate_dataset',
  'weather_build_evidence',
  'weather_diagnose_dataset',
  'weather_render_dataset_map',
]);

const TOOL_DEFINITIONS = Object.freeze([
  { name: 'weather_list_sources', group: 'weather-data', description: '列出当前项目配置的本地或内网气象资料源及成熟度。', parameters: [], annotations: { readOnlyHint: true }, effects: { filesystemRead: 'workspace', risk: 'low' } },
  { name: 'weather_query_dataset', group: 'weather-data', description: '从本地 JSON/CSV 或内网 HTTP/HTTPS JSON Provider 读取标准化气象资料集。', parameters: ['sourceId', 'datasetRef', 'query'], annotations: { readOnlyHint: true }, effects: { filesystemRead: 'workspace', networkRead: true, risk: 'medium' } },
  { name: 'weather_validate_dataset', group: 'weather-data', description: '校验气象资料的来源、时次、区域、单位、质控与可发布性。', parameters: ['dataset'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_build_evidence', group: 'weather-data', description: '把标准化气象资料转换为可登记、可过期和可追溯的 Evidence。', parameters: ['dataset'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_diagnose_dataset', group: 'weather-diagnosis', description: '对真实资料执行可解释的形势、强降水和强对流算法，并生成诊断 Evidence。', parameters: ['dataset', 'kind'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_render_dataset_map', group: 'gis-map', description: '在项目工作区内生成带来源、成熟度、诊断和 Evidence 血缘的 HTML 风险图。', parameters: ['dataset', 'diagnosis', 'evidence', 'outputPath'], annotations: { readOnlyHint: false }, effects: { filesystemWrite: 'workspace', risk: 'medium' } },
  { name: 'weather_list_cases', group: 'weather-data', description: '列出内置可重复运行的气象演示案例及数据声明。', parameters: [], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_get_case', group: 'weather-data', description: '读取构造案例的元数据、实况、高空场、雷达、模式或预报稿。', parameters: ['caseId', 'sections'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_get_station_observations', group: 'weather-data', description: '按站点或 24 小时降水阈值查询构造站点实况。', parameters: ['caseId', 'stationIds', 'minimumRain24h'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_get_upper_air', group: 'weather-data', description: '读取构造高空层结、风场、水汽与对流参数。', parameters: ['caseId', 'levels'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_compare_guidance', group: 'weather-data', description: '比较三套构造模式的雨量中心、时段与一致性。', parameters: ['caseId'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_export_demo_bundle', group: 'weather-data', description: '把案例 JSON、站点 CSV 和分析 Markdown 导出到项目工作区。', parameters: ['caseId', 'outputDirectory'], annotations: { readOnlyHint: false }, effects: { filesystemWrite: 'workspace', risk: 'medium' } },
  { name: 'weather_diagnose_synoptic', group: 'weather-diagnosis', description: '识别构造案例中的副高、短波槽、低空急流和辐合系统。', parameters: ['caseId'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_diagnose_heavy_rain', group: 'weather-diagnosis', description: '按水汽、抬升、不稳定、持续性和模式一致性输出强降水评分。', parameters: ['caseId'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_diagnose_convection', group: 'weather-diagnosis', description: '输出短时强降水、雷暴大风和冰雹的分类风险与证据。', parameters: ['caseId'], annotations: { readOnlyHint: true }, effects: { risk: 'low' } },
  { name: 'weather_render_risk_map', group: 'gis-map', description: '在项目工作区生成带数据声明、站点雨量和风险落区的可预览 HTML 示意图。', parameters: ['caseId', 'layer', 'outputPath'], annotations: { readOnlyHint: false }, effects: { filesystemWrite: 'workspace', risk: 'medium' } },
].map((tool) => Object.freeze({
  ...tool,
  maturity: BETA_TOOL_NAMES.has(tool.name) ? 'beta' : 'demo',
})));

const GROUP_TOOLS = Object.freeze({
  'weather-data': TOOL_DEFINITIONS.filter((tool) => tool.group === 'weather-data').map((tool) => tool.name),
  'weather-diagnosis': TOOL_DEFINITIONS.filter((tool) => tool.group === 'weather-diagnosis').map((tool) => tool.name),
  'gis-map': TOOL_DEFINITIONS.filter((tool) => tool.group === 'gis-map').map((tool) => tool.name),
});

const PRESETS = Object.freeze({
  'weather-data': Object.freeze({
    id: 'weather-data',
    name: '气象数据中心',
    description: '读取项目配置的本地与内网 HTTP/HTTPS 资料源，并保留构造案例用于回归测试。',
    version: SERVER_VERSION,
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: [],
    timeout: 30,
    riskClassification: 'low',
    connectorType: 'weather-data',
    toolAllowlist: GROUP_TOOLS['weather-data'],
  }),
  'weather-diagnosis': Object.freeze({
    id: 'weather-diagnosis',
    name: '天气诊断算法服务',
    description: '对标准化气象资料执行天气形势、强降水和强对流诊断，返回可追溯 Evidence。',
    version: SERVER_VERSION,
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: [],
    timeout: 30,
    riskClassification: 'low',
    connectorType: 'weather-diagnosis',
    toolAllowlist: GROUP_TOOLS['weather-diagnosis'],
  }),
  'gis-map': Object.freeze({
    id: 'gis-map',
    name: 'GIS 制图服务',
    description: '把标准化资料、诊断和 Evidence 生成工作区内可预览的 HTML 风险图。',
    version: SERVER_VERSION,
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: [],
    timeout: 30,
    riskClassification: 'medium',
    connectorType: 'gis-map',
    toolAllowlist: GROUP_TOOLS['gis-map'],
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCaseId(caseId) {
  if (caseId && caseId !== CASE_ID) throw new Error(`演示案例不存在：${caseId}`);
}

function nodeModules() {
  if (typeof require !== 'function') throw new Error('该操作只能在 MeteoMate 本地运行时中执行');
  return {
    crypto: require('node:crypto'),
    fs: require('node:fs'),
    path: require('node:path'),
  };
}

function workspaceRoot(requestedWorkspace) {
  const { fs, path } = nodeModules();
  const workspace = path.resolve(String(requestedWorkspace || process.env.METEOMATE_WEATHER_WORKSPACE || ''));
  if (!requestedWorkspace && !process.env.METEOMATE_WEATHER_WORKSPACE) {
    throw new Error('气象工具服务未绑定项目工作区');
  }
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  return SafeWorkspace.canonicalRoot(workspace);
}

function resolveOutput(workspace, relativePath) {
  const { path } = nodeModules();
  const normalized = String(relativePath || '').trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('输出路径必须是工作区内的相对路径');
  }
  const output = path.resolve(workspace, ...normalized.split('/'));
  const relative = path.relative(workspace, output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('输出路径超出项目工作区');
  return output;
}

function rainfallColor(value) {
  if (value >= 140) return '#7c3aed';
  if (value >= 100) return '#dc2626';
  if (value >= 75) return '#f97316';
  if (value >= 50) return '#eab308';
  return '#0ea5e9';
}

function renderRiskMapHtml(layer = 'rain24h') {
  const [minLon, minLat, maxLon, maxLat] = SYNTHETIC_CASE.region.bbox;
  const plot = SYNTHETIC_CASE.stations.map((station) => {
    const x = 80 + ((station.lon - minLon) / (maxLon - minLon)) * 720;
    const y = 410 - ((station.lat - minLat) / (maxLat - minLat)) * 300;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle r="${Math.max(10, Math.min(30, station.rain24h / 5)).toFixed(1)}" fill="${rainfallColor(station.rain24h)}" fill-opacity=".82" stroke="#fff" stroke-width="3"/>
      <text y="-25" text-anchor="middle">${station.name}</text>
      <text y="5" text-anchor="middle" class="amount">${station.rain24h}</text>
    </g>`;
  }).join('');
  const scores = SYNTHETIC_CASE.diagnoses.heavyRain.dimensions
    .map((item) => `<div><span>${item.name}</span><strong>${item.score}/${item.max}</strong><i style="--score:${(item.score / item.max) * 100}%"></i><small>${item.evidence}</small></div>`)
    .join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${SYNTHETIC_CASE.name}风险图</title>
<style>
:root{color-scheme:light;font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#14233b;background:#edf3f8}*{box-sizing:border-box}
body{margin:0;padding:28px}.notice{background:#fff4d6;border:1px solid #f2c85b;border-radius:14px;padding:12px 16px;font-weight:700;color:#7a4b00}
header{display:flex;justify-content:space-between;gap:20px;align-items:end;margin:22px 0}h1{margin:0;font-size:30px}header p{margin:6px 0 0;color:#5e6b7c}.score{font-size:44px;font-weight:800;color:#b42318}.score small{display:block;font-size:14px;text-align:right;color:#5e6b7c}
.grid{display:grid;grid-template-columns:minmax(560px,1.5fr) minmax(320px,.8fr);gap:20px}.card{background:#fff;border:1px solid #dce5ee;border-radius:18px;padding:18px;box-shadow:0 10px 30px #264a6b14}
svg{width:100%;height:auto;background:linear-gradient(155deg,#f8fbff,#e2eef8);border-radius:14px}svg text{font-size:14px;font-weight:700;fill:#17314d}.amount{font-size:12px;fill:#fff}
.axis{font-size:12px;fill:#62748a}.risk{fill:#dc2626;fill-opacity:.09;stroke:#dc2626;stroke-width:2;stroke-dasharray:8 6}
.metrics{display:grid;gap:12px}.metrics div{display:grid;grid-template-columns:1fr auto;gap:4px}.metrics i{grid-column:1/-1;height:7px;background:linear-gradient(90deg,#0ea5e9 var(--score),#e8eef4 var(--score));border-radius:9px}.metrics small{grid-column:1/-1;color:#5e6b7c;line-height:1.55}
footer{margin-top:18px;color:#607086;font-size:13px}@media(max-width:900px){.grid{grid-template-columns:1fr}body{padding:16px}}
</style></head><body>
<div class="notice">构造测试数据 · 非实况 · 非官方预报 · 仅用于 MeteoMate 功能演示</div>
<header><div><h1>${SYNTHETIC_CASE.name}</h1><p>${SYNTHETIC_CASE.region.name} · ${SYNTHETIC_CASE.validTime.start} — ${SYNTHETIC_CASE.validTime.end} · 图层 ${layer}</p></div><div class="score">${SYNTHETIC_CASE.diagnoses.heavyRain.total}<small>强降水综合评分 / 100</small></div></header>
<main class="grid"><section class="card"><svg viewBox="0 0 880 500" role="img" aria-label="构造站点二十四小时降水与风险落区">
<path d="M120 92 L238 65 L372 100 L510 68 L706 120 L782 228 L720 376 L565 425 L402 392 L250 435 L115 348 L78 225 Z" fill="#d8e8dc" stroke="#7c9a83" stroke-width="2"/>
<ellipse class="risk" cx="425" cy="285" rx="210" ry="95" transform="rotate(-16 425 285)"/><text x="425" y="190" text-anchor="middle" fill="#b42318">永泰—闽侯高风险示意区</text>
${plot}<text x="24" y="474" class="axis">圆面积与颜色表示构造 24h 降水量（mm）；底图为流程演示示意，不代表行政区边界。</text></svg></section>
<aside class="card"><h2>诊断证据</h2><div class="metrics">${scores}</div><h2>风险落区</h2><ul>${SYNTHETIC_CASE.diagnoses.heavyRain.hotspots.map((item) => `<li><strong>${item.name}</strong>：${item.level}，${item.expected24h}</li>`).join('')}</ul></aside></main>
<footer>${SYNTHETIC_CASE.dataNotice}<br>知识口径参考 weather_course_site 第 1、6–10、15 课。</footer>
</body></html>`;
}

function artifactRecord(filePath, mediaType, metadata = {}) {
  const { crypto, fs, path } = nodeModules();
  const content = fs.readFileSync(filePath);
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  return {
    apiVersion: 'meteomate/v1',
    kind: 'Artifact',
    id: `artifact-weather-${contentHash.slice(0, 24)}`,
    name: path.basename(filePath),
    type: path.extname(filePath).slice(1).toUpperCase(),
    path: filePath,
    mediaType,
    status: 'ready',
    sizeBytes: content.length,
    contentHash,
    createdAt: Date.now(),
    metadata: {
      source: 'meteomate-weather-demo',
      synthetic: true,
      official: false,
      caseId: CASE_ID,
      ...metadata,
    },
  };
}

function writeRiskMap({ workspace, outputPath = 'artifacts/meteomate-demo/risk-map.html', layer = 'rain24h' } = {}) {
  const { fs, path } = nodeModules();
  const root = workspaceRoot(workspace);
  const output = resolveOutput(root, outputPath);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, renderRiskMapHtml(layer), { encoding: 'utf8', mode: 0o600 });
  return artifactRecord(output, 'text/html', { layer });
}

function analysisMarkdown() {
  const rain = SYNTHETIC_CASE.diagnoses.heavyRain;
  const convection = SYNTHETIC_CASE.diagnoses.convection;
  return `# ${SYNTHETIC_CASE.name}

> ${SYNTHETIC_CASE.dataNotice}

## 资料与形势

- 资料时段：${SYNTHETIC_CASE.validTime.start} 至 ${SYNTHETIC_CASE.validTime.end}
- 主要系统：${SYNTHETIC_CASE.diagnoses.synoptic.systems.map((item) => item.name).join('、')}
- 雷达摘要：${SYNTHETIC_CASE.radar.morphology}；${SYNTHETIC_CASE.radar.signals.join('；')}

## 强降水诊断

- 综合评分：${rain.total}/100（${rain.level}）
${rain.dimensions.map((item) => `- ${item.name}：${item.score}/${item.max}；${item.evidence}`).join('\n')}
- 重点区域：${rain.hotspots.map((item) => `${item.name} ${item.expected24h}`).join('；')}
- 不确定性：${rain.uncertainty}

## 强对流诊断

- 综合评分：${convection.total}/100（${convection.level}）
${convection.hazards.map((item) => `- ${item.type}：概率 ${(item.probability * 100).toFixed(0)}%，置信度${item.confidence}；${item.evidence}`).join('\n')}

## 演示预报稿

${SYNTHETIC_CASE.forecastDraft.summary}

重点时段：${SYNTHETIC_CASE.forecastDraft.keyPeriod}。

发布前复核：${SYNTHETIC_CASE.forecastDraft.reviewRequired.join('；')}。
`;
}

function exportDemoBundle({ workspace, outputDirectory = 'artifacts/meteomate-demo' } = {}) {
  const { fs, path } = nodeModules();
  const root = workspaceRoot(workspace);
  const directory = resolveOutput(root, outputDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(directory, 'synthetic-weather-case.json');
  const csvPath = path.join(directory, 'station-observations.csv');
  const markdownPath = path.join(directory, 'analysis-report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(SYNTHETIC_CASE, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const csvRows = [
    ['station_id', 'station_name', 'lon', 'lat', 'rain_1h_mm', 'rain_6h_mm', 'rain_24h_mm', 'temperature_c', 'dewpoint_c', 'wind_speed_ms', 'quality'],
    ...SYNTHETIC_CASE.stations.map((station) => [
      station.id, station.name, station.lon, station.lat, station.rain1h, station.rain6h,
      station.rain24h, station.temperature, station.dewpoint, station.windSpeed, station.quality,
    ]),
  ];
  fs.writeFileSync(csvPath, `${csvRows.map((row) => row.join(',')).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(markdownPath, analysisMarkdown(), { encoding: 'utf8', mode: 0o600 });
  return [
    artifactRecord(jsonPath, 'application/json'),
    artifactRecord(csvPath, 'text/csv'),
    artifactRecord(markdownPath, 'text/markdown'),
  ];
}

function createDemoArtifacts(workspace) {
  return [
    ...exportDemoBundle({ workspace }),
    writeRiskMap({ workspace }),
  ];
}

function fixtureDataset() {
  return WeatherContracts.normalizeDataset({
    ...clone(SYNTHETIC_CASE),
    metadata: {
      classification: 'demo',
      synthetic: true,
      fixture: true,
      caseId: CASE_ID,
    },
  }, {
    id: 'meteomate-synthetic-fixture',
    name: 'MeteoMate synthetic fixture',
    type: 'fixture',
    version: CASE_ID,
    uri: `fixture://${CASE_ID}`,
    classification: 'demo',
    synthetic: true,
    official: false,
  });
}

function fixturePublicationAnalysis(dataset, result) {
  const idsFor = (prefix) => result.evidence
    .filter((record) => String(record.variable || '').startsWith(prefix))
    .map((record) => record.id);
  const synoptic = result.diagnosis.synoptic;
  const heavyRain = result.diagnosis.heavyRain;
  const convection = result.diagnosis.convection;
  const hotspots = heavyRain.hotspots
    .map((item) => `${item.name} ${item.rain24h} mm`)
    .join('、');
  const hazards = convection.hazards
    .map((item) => `${item.type} ${(item.probability * 100).toFixed(0)}%`)
    .join('、');
  return {
    region: dataset.region.name,
    issueTime: dataset.issueTime,
    validPeriod: [dataset.validTime?.start, dataset.validTime?.end].filter(Boolean).join('/'),
    conclusions: [
      {
        text: `识别出${synoptic.systems.map((item) => item.name).join('、')}。`,
        evidenceIds: idsFor('synoptic.'),
      },
      {
        text: `强降水综合评分 ${heavyRain.total}/100（${heavyRain.level}），高值站点为${hotspots}。`,
        evidenceIds: idsFor('heavy-rain.'),
      },
      {
        text: `强对流分类风险为${hazards}。`,
        evidenceIds: idsFor('convection.'),
      },
    ],
  };
}

function createFixtureWeatherRun(workspace) {
  const dataset = fixtureDataset();
  const result = WeatherDiagnosis.diagnoseDataset(dataset, 'all');
  const diagnosis = {
    ...result.diagnosis,
    algorithm: result.algorithm,
  };
  const artifact = WeatherRender.renderDatasetMap({
    workspace,
    dataset,
    diagnosis,
    evidence: result.evidence,
    outputPath: 'artifacts/meteomate-demo/fixture-risk-map.html',
  });
  return {
    schemaVersion: result.schemaVersion,
    caseId: CASE_ID,
    dataset,
    validation: result.validation,
    diagnosis: result.diagnosis,
    algorithm: result.algorithm,
    evidence: result.evidence,
    artifacts: [artifact],
    publication: result.publication,
    publicationAnalysis: fixturePublicationAnalysis(dataset, result),
  };
}

function fixtureRuntimeEvents({
  taskId,
  fixture,
  runtime = 'mock',
  toolCallId = 'meteomate-weather-fixture',
} = {}) {
  return [
    ...fixture.evidence.map((evidence) => ({
      type: 'evidence_created',
      taskId,
      runtime,
      toolCallId,
      evidence: clone(evidence),
    })),
    ...fixture.artifacts.map((artifact) => ({
      type: 'artifact_created',
      taskId,
      runtime,
      toolCallId,
      artifact: clone(artifact),
    })),
    {
      type: 'turn_completed',
      taskId,
      runtime,
      sessionId: null,
      publicationAnalysis: clone(fixture.publicationAnalysis),
    },
  ];
}

function getCase(sections) {
  if (!Array.isArray(sections) || !sections.length) return clone(SYNTHETIC_CASE);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    id: CASE_ID,
    name: SYNTHETIC_CASE.name,
    synthetic: true,
    official: false,
    dataNotice: SYNTHETIC_CASE.dataNotice,
  };
  for (const section of sections) {
    if (Object.prototype.hasOwnProperty.call(SYNTHETIC_CASE, section)) {
      result[section] = clone(SYNTHETIC_CASE[section]);
    }
  }
  return result;
}

function toolOutput(name, input = {}) {
  assertCaseId(input.caseId);
  switch (name) {
    case 'weather_list_cases':
      return {
        schemaVersion: SCHEMA_VERSION,
        cases: [{
          id: CASE_ID,
          name: SYNTHETIC_CASE.name,
          synthetic: true,
          region: SYNTHETIC_CASE.region,
          validTime: SYNTHETIC_CASE.validTime,
          dataNotice: SYNTHETIC_CASE.dataNotice,
        }],
      };
    case 'weather_get_case':
      return getCase(input.sections);
    case 'weather_get_station_observations': {
      const selected = new Set(Array.isArray(input.stationIds) ? input.stationIds.map(String) : []);
      const minimum = Number(input.minimumRain24h || 0);
      return {
        schemaVersion: SCHEMA_VERSION,
        caseId: CASE_ID,
        synthetic: true,
        units: { rain: 'mm', temperature: '°C', windSpeed: 'm/s', pressure: 'hPa' },
        stations: clone(SYNTHETIC_CASE.stations.filter((station) =>
          (!selected.size || selected.has(station.id)) && station.rain24h >= minimum
        )),
      };
    }
    case 'weather_get_upper_air': {
      const source = SYNTHETIC_CASE.upperAir;
      const levels = Array.isArray(input.levels) && input.levels.length
        ? input.levels
        : Object.keys(source);
      return {
        schemaVersion: SCHEMA_VERSION,
        caseId: CASE_ID,
        synthetic: true,
        levels: Object.fromEntries(levels.filter((level) => source[level]).map((level) => [level, clone(source[level])])),
      };
    }
    case 'weather_compare_guidance':
      return {
        schemaVersion: SCHEMA_VERSION,
        caseId: CASE_ID,
        synthetic: true,
        guidance: clone(SYNTHETIC_CASE.guidance),
        consensus: {
          hotspot: '永泰—闽侯',
          regionalMax24hRange: '112–168 mm',
          commonPeriod: '18 日下午至 19 日凌晨',
          spread: '强中心位置约 30–50 km',
        },
      };
    case 'weather_diagnose_synoptic':
      return { schemaVersion: SCHEMA_VERSION, caseId: CASE_ID, synthetic: true, diagnosis: clone(SYNTHETIC_CASE.diagnoses.synoptic) };
    case 'weather_diagnose_heavy_rain':
      return { schemaVersion: SCHEMA_VERSION, caseId: CASE_ID, synthetic: true, diagnosis: clone(SYNTHETIC_CASE.diagnoses.heavyRain) };
    case 'weather_diagnose_convection':
      return { schemaVersion: SCHEMA_VERSION, caseId: CASE_ID, synthetic: true, diagnosis: clone(SYNTHETIC_CASE.diagnoses.convection) };
    case 'weather_render_risk_map':
      return {
        schemaVersion: SCHEMA_VERSION,
        caseId: CASE_ID,
        synthetic: true,
        artifact: writeRiskMap({
          outputPath: input.outputPath,
          layer: input.layer,
        }),
      };
    case 'weather_export_demo_bundle':
      return {
        schemaVersion: SCHEMA_VERSION,
        caseId: CASE_ID,
        synthetic: true,
        artifacts: exportDemoBundle({ outputDirectory: input.outputDirectory }),
      };
    default:
      throw new Error(`未知气象演示工具：${name}`);
  }
}

function markdownSections(prompt, fixture = null) {
  const text = String(prompt || '');
  const fixtureRun = Boolean(fixture?.diagnosis);
  const wantsData = fixtureRun || /数据|资料|实况|模式|探空|雷达|站点|完整|演示|介绍/.test(text);
  const wantsRain = fixtureRun || /强降水|暴雨|降水|风险|完整|演示|介绍/.test(text);
  const wantsConvection = fixtureRun || /强对流|雷暴|大风|冰雹|完整|演示|介绍/.test(text);
  const wantsProduct = fixtureRun || /预报|写稿|产品|材料|报告|完整|演示|介绍/.test(text);
  const diagnosis = fixture?.diagnosis || SYNTHETIC_CASE.diagnoses;
  const blocks = [];
  if (wantsData || (!wantsRain && !wantsConvection && !wantsProduct)) {
    blocks.push(`### 资料清单与质量

- **站点实况：** 6 站，质控状态均为 \`checked\`；24 小时雨量最大为永泰 **146.8 mm**
- **高空与环境：** 850hPa 西南风 18 m/s、比湿 14.8 g/kg；PW 63 mm；700hPa ω=-0.42 Pa/s
- **对流参数：** CAPE 1450 J/kg、CIN 28 J/kg、0–6 km 风切变 17 m/s
- **雷达摘要：** 最大 55 dBZ，西南—东北向带状回波，上游持续生成
- **模式对比：** 三套构造模式区域最大 24 小时雨量为 112–168 mm，均指向永泰—闽侯附近`);
  }
  if (wantsRain) {
    const rain = diagnosis.heavyRain;
    const synopticSystems = diagnosis.synoptic.systems.map((item) => item.name).join('、');
    const hotspots = rain.hotspots.map((item) =>
      `${item.name} ${item.expected24h || `${item.rain24h} mm`}`
    ).join('；');
    blocks.push(`### 天气形势与强降水诊断

${synopticSystems}共同构成水汽—抬升配置。

| 维度 | 得分 | 主要证据 |
| --- | ---: | --- |
${rain.dimensions.map((item) => `| ${item.name} | ${item.score}/${item.max} | ${Array.isArray(item.evidence) ? item.evidence.join('；') : item.evidence} |`).join('\n')}

**综合评分：${rain.total}/100（${rain.level}）**。高值站点或重点落区为${hotspots}。`);
  }
  if (wantsConvection) {
    const convection = diagnosis.convection;
    blocks.push(`### 强对流分类风险

${convection.hazards.map((item) => `- **${item.type}：** 概率 ${(item.probability * 100).toFixed(0)}%，置信度${item.confidence}${item.evidence ? `；${item.evidence}` : ''}`).join('\n')}

触发条件为低压倒槽辐合叠加地形抬升；缺少真实径向速度、云顶温度和高频探空，不能把旋转或大风风险写成确定结论。`);
  }
  if (wantsProduct) {
    blocks.push(fixtureRun ? `### 可审核的预报初稿

${fixture.publicationAnalysis.conclusions.map((item) => `- ${item.text}`).join('\n')}

发布门禁将把本次构造、演示和已过期资料保持为草稿，不能签发。` : `### 可审核的预报初稿

${SYNTHETIC_CASE.forecastDraft.summary}重点时段为 **${SYNTHETIC_CASE.forecastDraft.keyPeriod}**，需关注城乡积涝、山洪地质灾害、低能见度和局地雷暴大风。

发布前必须用真实业务资料替换全部构造数值，并由值班预报员审核风险用语。`);
  }
  return blocks;
}

function buildDemoResponse({ prompt, expertName, workspace, artifacts = [], fixture = null } = {}) {
  const artifactList = artifacts.length
    ? `### 已生成演示成果物\n\n${artifacts.map((artifact) => `- \`${artifact.path}\``).join('\n')}`
    : `### 成果物\n\n当前未绑定可写工作区；选择项目后可生成案例 JSON、站点 CSV、分析 Markdown 和 HTML 风险图。`;
  return [
    '## MeteoMate 可运行演示 · 构造案例',
    `> **数据声明：** ${SYNTHETIC_CASE.dataNotice}`,
    `**已选择专家：** ${expertName || 'MeteoMate 助理'}  \n**案例：** ${SYNTHETIC_CASE.name}（\`${CASE_ID}\`）  \n**工作区：** ${workspace ? `\`${workspace}\`` : 'MeteoMate 内置演示工作区'}`,
    ...markdownSections(prompt, fixture),
    artifactList,
    `### 不确定性与下一步

- 强中心位置在三套构造模式之间相差约 30–50 km，实际业务需随雷达和逐小时雨量滚动订正。
- 本结果用于验证“数据读取 → 诊断 → 风险图 → 预报稿”链路，不可直接发布。
- 知识口径参考 \`weather_course_site\` 第 1、6–10、15 课。`,
  ].join('\n\n');
}

function teamMemberSummary(expertId, fixture = null) {
  const diagnosis = fixture?.diagnosis || {};
  const synoptic = diagnosis.synoptic || {};
  const heavyRain = diagnosis.heavyRain || {};
  const convection = diagnosis.convection || {};
  const systems = (synoptic.systems || []).map((item) => item.name).filter(Boolean).join('、');
  const hotspots = (heavyRain.hotspots || []).map((item) => item.name).filter(Boolean).slice(0, 3).join('、');
  const hazards = (convection.hazards || [])
    .map((item) => `${item.type} ${Number.isFinite(item.probability) ? `${Math.round(item.probability * 100)}%` : ''}`.trim())
    .join('，');
  const summaries = {
    'synoptic-expert': systems
      ? `识别出${systems}，形势置信度 ${synoptic.confidence ?? '待复核'}。`
      : '已完成天气形势诊断，具体系统与置信度以本次 Fixture 算法结果为准。',
    'heavy-rain-expert': Number.isFinite(heavyRain.total)
      ? `按五维证据链得到强降水 ${heavyRain.total}/100（${heavyRain.level || '待分级'}）${hotspots ? `，高值站点为${hotspots}` : ''}。`
      : '已完成五维强降水诊断，评分以本次 Fixture 算法结果为准。',
    'convection-expert': hazards
      ? `强对流分类风险为${hazards}；对缺测资料保留不确定性。`
      : '已完成强对流分类诊断，风险概率以本次 Fixture 算法结果为准。',
    'writing-expert': '已把诊断结论整理为带构造数据声明、重点时段和发布前复核项的预报初稿。',
    'gis-expert': '已生成站点雨量、风险落区、诊断评分和非官方水印完整的 HTML 示意图。',
  };
  return summaries[expertId] || '已完成构造案例的专业分析，并保留数据声明、证据和不确定性。';
}

function isWeatherConnector(value) {
  return Boolean(PRESETS[value?.id] || PRESETS[value?.connectorType]);
}

function presetFor(value) {
  return PRESETS[value?.id] || PRESETS[value?.connectorType] || null;
}

function materialize(input = {}, { productRoot, workspace } = {}) {
  const { path } = nodeModules();
  const preset = presetFor(input);
  if (!preset) throw new Error('未知的内置气象工具服务');
  if (!productRoot) throw new Error('气象工具服务缺少产品目录');
  const root = workspaceRoot(workspace);
  return {
    ...input,
    ...preset,
    name: String(input.name || preset.name),
    description: String(input.description || preset.description),
    enabled: input.enabled !== false,
    projectIds: Array.isArray(input.projectIds) ? input.projectIds : [],
    command: process.execPath,
    args: [path.join(productRoot, 'capabilities', 'weather-connector.js'), '--stdio'],
    cwd: root,
    runtimeEnv: {
      ELECTRON_RUN_AS_NODE: '1',
      METEOMATE_WEATHER_WORKSPACE: root,
    },
    runtimeInfo: {
      source: 'bundled-weather-runtime',
      serverVersion: SERVER_VERSION,
      caseId: CASE_ID,
      synthetic: false,
      includesDemoFixture: true,
      productionProviders: true,
    },
    managedPreset: preset.id,
    toolAllowlist: [...preset.toolAllowlist],
  };
}

function discoveryResult(id) {
  const preset = PRESETS[id];
  const tools = TOOL_DEFINITIONS
    .filter((tool) => preset?.toolAllowlist.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      maturity: tool.maturity,
      parameters: [...tool.parameters],
      requiredParameters: [],
      annotations: {
        ...(tool.annotations || {}),
        maturity: tool.maturity,
        effects: { ...(tool.effects || {}) },
      },
      effects: { ...(tool.effects || {}) },
    }));
  return {
    ok: true,
    checkedAt: Date.now(),
    durationMs: 0,
    result: {
      ok: true,
      transport: 'stdio',
      serverInfo: { name: 'meteomate-weather-runtime', version: SERVER_VERSION },
      tools,
      runtime: {
        source: 'bundled-weather-runtime',
        serverVersion: SERVER_VERSION,
        caseId: CASE_ID,
        synthetic: true,
      },
    },
  };
}


async function executeTool(name, input = {}) {
  const workspace = workspaceRoot();
  switch (name) {
    case 'weather_list_sources':
      return WeatherProviders.listSources(workspace);
    case 'weather_query_dataset':
      return WeatherProviders.queryDataset({
        workspace,
        sourceId: input.sourceId,
        datasetRef: input.datasetRef,
        query: input.query || {},
      });
    case 'weather_validate_dataset': {
      const dataset = WeatherContracts.normalizeDataset(input.dataset);
      const validation = WeatherContracts.validateDataset(dataset);
      return {
        schemaVersion: WeatherContracts.DATASET_SCHEMA_VERSION,
        dataset,
        validation,
        evidence: WeatherContracts.datasetEvidence(dataset),
        publication: WeatherContracts.publicationAssessment(dataset, validation),
      };
    }
    case 'weather_build_evidence': {
      const dataset = WeatherContracts.normalizeDataset(input.dataset);
      const validation = WeatherContracts.validateDataset(dataset);
      return {
        schemaVersion: WeatherContracts.DATASET_SCHEMA_VERSION,
        datasetId: dataset.id,
        datasetHash: dataset.contentHash,
        validation,
        evidence: WeatherContracts.datasetEvidence(dataset),
        publication: WeatherContracts.publicationAssessment(dataset, validation),
      };
    }
    case 'weather_diagnose_dataset':
      return WeatherDiagnosis.diagnoseDataset(input.dataset, input.kind || 'all');
    case 'weather_render_dataset_map': {
      const dataset = WeatherContracts.normalizeDataset(input.dataset);
      const validation = WeatherContracts.validateDataset(dataset);
      const calculated = WeatherDiagnosis.diagnoseDataset(dataset, 'all');
      const diagnosis = {
        ...calculated.diagnosis,
        algorithm: calculated.algorithm,
      };
      const evidence = calculated.evidence;
      const artifact = WeatherRender.renderDatasetMap({
        workspace,
        dataset,
        diagnosis,
        evidence,
        outputPath: input.outputPath,
      });
      return {
        schemaVersion: WeatherContracts.DIAGNOSIS_SCHEMA_VERSION,
        dataset,
        validation,
        diagnosis,
        evidence,
        artifact,
        publication: WeatherContracts.publicationAssessment(dataset, validation),
      };
    }
    default:
      return toolOutput(name, input);
  }
}

async function startServer() {
  const [{ McpServer }, { StdioServerTransport }, z] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/mcp.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('zod/v4'),
  ]);
  const caseId = z.string().optional().default(CASE_ID);
  const objectValue = z.record(z.string(), z.any());
  const schemas = {
    weather_list_sources: {},
    weather_query_dataset: {
      sourceId: z.string().min(1).max(128),
      datasetRef: z.string().max(1024).optional(),
      query: objectValue.optional(),
    },
    weather_validate_dataset: { dataset: objectValue },
    weather_build_evidence: { dataset: objectValue },
    weather_diagnose_dataset: {
      dataset: objectValue,
      kind: z.enum(['all', 'synoptic', 'heavy-rain', 'convection']).optional().default('all'),
    },
    weather_render_dataset_map: {
      dataset: objectValue,
      diagnosis: objectValue.optional(),
      evidence: z.array(objectValue).max(5000).optional(),
      outputPath: z.string().max(512).optional().default('artifacts/weather/risk-map.html'),
    },
    weather_list_cases: {},
    weather_get_case: {
      caseId,
      sections: z.array(z.enum(['region', 'validTime', 'provenance', 'stations', 'upperAir', 'radar', 'guidance', 'diagnoses', 'forecastDraft'])).max(9).optional(),
    },
    weather_get_station_observations: {
      caseId,
      stationIds: z.array(z.string()).max(100).optional(),
      minimumRain24h: z.number().min(0).max(2000).optional().default(0),
    },
    weather_get_upper_air: {
      caseId,
      levels: z.array(z.enum(['surface', '850hPa', '700hPa', '500hPa', '200hPa', 'indices'])).max(6).optional(),
    },
    weather_compare_guidance: { caseId },
    weather_export_demo_bundle: {
      caseId,
      outputDirectory: z.string().max(512).optional().default('artifacts/meteomate-demo'),
    },
    weather_diagnose_synoptic: { caseId },
    weather_diagnose_heavy_rain: { caseId },
    weather_diagnose_convection: { caseId },
    weather_render_risk_map: {
      caseId,
      layer: z.enum(['rain24h', 'heavy-rain-risk', 'synoptic']).optional().default('rain24h'),
      outputPath: z.string().max(512).optional().default('artifacts/meteomate-demo/risk-map.html'),
    },
  };
  const server = new McpServer({ name: 'meteomate-weather-runtime', version: SERVER_VERSION });
  for (const definition of TOOL_DEFINITIONS) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: schemas[definition.name],
        annotations: {
          ...(definition.annotations || {}),
          maturity: definition.maturity,
          effects: { ...(definition.effects || {}) },
        },
      },
      async (input) => {
        try {
          const result = await executeTool(definition.name, input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          };
        } catch (error) {
          const result = {
            schemaVersion: SCHEMA_VERSION,
            error: { code: 'WEATHER_TOOL_FAILED', message: String(error?.message || error) },
          };
          return {
            isError: true,
            content: [{ type: 'text', text: `${result.error.code}: ${result.error.message}` }],
            structuredContent: result,
          };
        }
      },
    );
  }
  await server.connect(new StdioServerTransport());
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  SERVER_VERSION,
  CASE_ID,
  SYNTHETIC_CASE,
  TOOL_DEFINITIONS,
  GROUP_TOOLS,
  PRESETS,
  isWeatherConnector,
  materialize,
  discoveryResult,
  toolOutput,
  executeTool,
  writeRiskMap,
  exportDemoBundle,
  createDemoArtifacts,
  createFixtureWeatherRun,
  fixtureRuntimeEvents,
  buildDemoResponse,
  teamMemberSummary,
  startServer,
});

if (require.main === module && process.argv.includes('--stdio')) {
  startServer().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
