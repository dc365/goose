'use strict';

const Contracts = require('./contracts.cjs');

const ALGORITHM_VERSION = 'meteomate-weather-diagnosis/1.0.0';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function scale(value, low, high, maximum, invert = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const ratio = clamp((number - low) / Math.max(1e-9, high - low), 0, 1);
  return (invert ? 1 - ratio : ratio) * maximum;
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function max(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : null;
}

function textIncludes(value, patterns) {
  const text = String(value || '').toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function upper(dataset, level) {
  return dataset.upperAir?.[level] || {};
}

function indices(dataset) {
  return dataset.upperAir?.indices || {};
}

function moistureDimension(dataset) {
  const env = indices(dataset);
  const low = upper(dataset, '850hPa');
  const pw = Number(env.precipitableWater);
  const q = Number(low.specificHumidity);
  const dewpoint = Number(low.dewpoint);
  const score = clamp(
    scale(pw, 30, 70, 12)
      + scale(q, 6, 18, 8)
      + scale(dewpoint, 5, 22, 5),
    0,
    25,
  );
  return {
    key: 'moisture', name: '水汽条件', score: Math.round(score), max: 25,
    evidence: [
      Number.isFinite(pw) ? `可降水量 ${pw} mm` : null,
      Number.isFinite(q) ? `850hPa 比湿 ${q} g/kg` : null,
      Number.isFinite(dewpoint) ? `850hPa 露点 ${dewpoint} °C` : null,
    ].filter(Boolean),
  };
}

function liftDimension(dataset) {
  const mid = upper(dataset, '700hPa');
  const high = upper(dataset, '200hPa');
  const low = upper(dataset, '850hPa');
  const omega = Number(mid.omega);
  const divergence = Number(high.divergence);
  const convergence = Number(low.moistureFluxConvergence ?? low.convergence);
  const omegaScore = Number.isFinite(omega) ? scale(-omega, 0, 0.8, 12) : 0;
  const upperScore = Number.isFinite(divergence) ? scale(divergence, 0, 6e-5, 7) : 0;
  const lowScore = Number.isFinite(convergence) ? scale(Math.abs(Math.min(0, convergence)), 0, 8e-5, 6) : 0;
  const score = clamp(omegaScore + upperScore + lowScore, 0, 25);
  return {
    key: 'lift', name: '动力抬升', score: Math.round(score), max: 25,
    evidence: [
      Number.isFinite(omega) ? `700hPa 垂直速度 ${omega} Pa/s` : null,
      Number.isFinite(divergence) ? `200hPa 辐散 ${divergence} s^-1` : null,
      Number.isFinite(convergence) ? `850hPa 水汽通量辐合 ${convergence} s^-1` : null,
    ].filter(Boolean),
  };
}

function instabilityDimension(dataset) {
  const env = indices(dataset);
  const cape = Number(env.cape);
  const cin = Number(env.cin);
  const k = Number(env.kIndex);
  const li = Number(env.liftedIndex);
  const score = clamp(
    scale(cape, 200, 2500, 10)
      + (Number.isFinite(cin) ? scale(cin, 0, 180, 3, true) : 0)
      + scale(k, 20, 40, 4)
      + (Number.isFinite(li) ? scale(-li, 0, 7, 3) : 0),
    0,
    20,
  );
  return {
    key: 'instability', name: '热力不稳定', score: Math.round(score), max: 20,
    evidence: [
      Number.isFinite(cape) ? `CAPE ${cape} J/kg` : null,
      Number.isFinite(cin) ? `CIN ${cin} J/kg` : null,
      Number.isFinite(k) ? `K 指数 ${k} °C` : null,
      Number.isFinite(li) ? `抬升指数 ${li} °C` : null,
    ].filter(Boolean),
  };
}

function persistenceDimension(dataset) {
  const low = upper(dataset, '850hPa');
  const radar = dataset.radar || {};
  const lowJet = Number(low.windSpeed);
  const radarSignals = Array.isArray(radar.signals) ? radar.signals.join(' ') : '';
  const training = textIncludes(`${radar.morphology || ''} ${radarSignals}`, ['列车', 'training', '上游持续', '带状']);
  const rain6 = max((dataset.stations || []).map((station) => station.rain6h));
  const guidanceTimingCount = (dataset.guidance || []).filter((item) => item.timing).length;
  const score = clamp(
    scale(lowJet, 8, 25, 8)
      + (training ? 6 : 0)
      + scale(rain6, 10, 100, 4)
      + scale(guidanceTimingCount, 1, 3, 2),
    0,
    20,
  );
  return {
    key: 'persistence', name: '持续条件', score: Math.round(score), max: 20,
    evidence: [
      Number.isFinite(lowJet) ? `850hPa 风速 ${lowJet} m/s` : null,
      training ? '雷达摘要存在带状、上游持续生成或列车效应信号' : null,
      Number.isFinite(rain6) ? `站点最大 6 小时雨量 ${rain6} mm` : null,
      guidanceTimingCount ? `${guidanceTimingCount} 套指导资料提供持续时段` : null,
    ].filter(Boolean),
  };
}

function consistencyDimension(dataset) {
  const values = (dataset.guidance || []).map((item) => item.regionalMax24h).filter(Number.isFinite);
  if (!values.length) {
    return { key: 'consistency', name: '模式一致性', score: 0, max: 10, evidence: ['没有可比较的多模式定量结果'] };
  }
  const spread = Math.max(...values) - Math.min(...values);
  const mean = average(values) || 1;
  const relativeSpread = spread / Math.max(1, mean);
  const countScore = scale(values.length, 1, 4, 4);
  const spreadScore = scale(relativeSpread, 0.1, 0.8, 6, true);
  return {
    key: 'consistency', name: '模式一致性', score: Math.round(clamp(countScore + spreadScore, 0, 10)), max: 10,
    evidence: [`${values.length} 套资料区域最大 24 小时雨量范围 ${Math.min(...values)}–${Math.max(...values)} mm`, `相对离散度 ${(relativeSpread * 100).toFixed(0)}%`],
  };
}

function diagnoseHeavyRain(dataset) {
  const dimensions = [
    moistureDimension(dataset),
    liftDimension(dataset),
    instabilityDimension(dataset),
    persistenceDimension(dataset),
    consistencyDimension(dataset),
  ];
  const total = dimensions.reduce((sum, item) => sum + item.score, 0);
  const level = total >= 80 ? '高风险' : total >= 65 ? '较高风险' : total >= 45 ? '中等风险' : total >= 25 ? '较低风险' : '低风险';
  const stations = [...(dataset.stations || [])]
    .filter((station) => Number.isFinite(station.rain24h))
    .sort((left, right) => right.rain24h - left.rain24h)
    .slice(0, 6);
  const hotspots = stations.map((station) => ({
    id: station.id,
    name: station.name,
    rain24h: station.rain24h,
    level: station.rain24h >= 100 ? '高' : station.rain24h >= 50 ? '较高' : station.rain24h >= 25 ? '中等' : '较低',
    confidence: station.quality === 'checked' ? 0.9 : 0.7,
  }));
  return {
    total,
    level,
    dimensions,
    hotspots,
    uncertainty: dataset.guidance?.length < 2 ? '多模式资料不足，模式一致性维度置信度较低。' : null,
  };
}

function diagnoseConvection(dataset) {
  const env = indices(dataset);
  const radar = dataset.radar || {};
  const cape = Number(env.cape);
  const cin = Number(env.cin);
  const shear = Number(env.shear0to6km);
  const freezing = Number(env.freezingLevel);
  const lcl = Number(env.lcl);
  const maxDbz = Number(radar.maxDbz);
  const pw = Number(env.precipitableWater);
  const shortRain = clamp(
    scale(pw, 30, 70, 0.35)
      + scale(cape, 200, 2200, 0.25)
      + scale(maxDbz, 35, 60, 0.25)
      + (Number.isFinite(lcl) ? scale(lcl, 400, 1800, 0.15, true) : 0),
    0,
    0.98,
  );
  const wind = clamp(
    scale(cape, 500, 3000, 0.3)
      + scale(shear, 8, 30, 0.45)
      + scale(maxDbz, 40, 65, 0.15)
      + (Number.isFinite(cin) ? scale(cin, 0, 180, 0.1, true) : 0),
    0,
    0.95,
  );
  const hail = clamp(
    scale(cape, 800, 3500, 0.4)
      + scale(shear, 10, 30, 0.3)
      + (Number.isFinite(freezing) ? scale(freezing, 2800, 5200, 0.3, true) : 0),
    0,
    0.9,
  );
  const hazards = [
    { type: '短时强降水', probability: Number(shortRain.toFixed(2)) },
    { type: '雷暴大风', probability: Number(wind.toFixed(2)) },
    { type: '冰雹', probability: Number(hail.toFixed(2)) },
  ].map((item) => ({
    ...item,
    confidence: item.probability >= 0.75 ? '高' : item.probability >= 0.45 ? '中' : '低',
  }));
  const total = Math.round(Math.max(...hazards.map((item) => item.probability)) * 100);
  return {
    total,
    level: total >= 75 ? '高风险' : total >= 55 ? '较高风险' : total >= 35 ? '中等风险' : '较低风险',
    hazards,
    uncertainty: !Number.isFinite(maxDbz) ? '缺少雷达最大反射率，分类风险主要依据环境参数。' : null,
  };
}

function diagnoseSynoptic(dataset) {
  const systems = [];
  const low = upper(dataset, '850hPa');
  const mid = upper(dataset, '500hPa');
  const high = upper(dataset, '200hPa');
  const surface = upper(dataset, 'surface');
  const lowFeature = `${low.feature || ''} ${surface.feature || ''}`;
  const midFeature = String(mid.feature || '');
  const highFeature = String(high.feature || '');
  if (Number(low.windSpeed) >= 12 || textIncludes(lowFeature, ['低空急流', 'low-level jet'])) {
    systems.push({ type: 'low-level-jet', name: '低空急流', confidence: 0.82, evidence: `850hPa 风速 ${low.windSpeed ?? '未知'} m/s；${low.feature || ''}`.trim() });
  }
  if (textIncludes(midFeature, ['槽', 'trough'])) {
    systems.push({ type: 'trough', name: '中层槽', confidence: 0.78, evidence: midFeature });
  }
  if (textIncludes(midFeature, ['副高', 'subtropical'])) {
    systems.push({ type: 'subtropical-high-edge', name: '副热带高压边缘', confidence: 0.75, evidence: midFeature });
  }
  if (Number(high.divergence) > 0 || textIncludes(highFeature, ['辐散', 'divergence'])) {
    systems.push({ type: 'upper-divergence', name: '高空辐散', confidence: 0.76, evidence: `${highFeature} ${high.divergence ?? ''}`.trim() });
  }
  if (textIncludes(lowFeature, ['辐合', '切变', '倒槽', 'convergence'])) {
    systems.push({ type: 'low-level-convergence', name: '低层辐合系统', confidence: 0.8, evidence: lowFeature.trim() });
  }
  return {
    systems,
    confidence: systems.length ? Number(average(systems.map((item) => item.confidence)).toFixed(2)) : 0.35,
    uncertainty: systems.length ? null : '资料没有提供足够的天气系统特征字段，未强行识别天气系统。',
  };
}

function diagnosisEvidence(dataset, diagnosis) {
  const records = [];
  for (const dimension of diagnosis.heavyRain?.dimensions || []) {
    records.push(Contracts.createEvidence(dataset, {
      evidenceType: 'algorithm-diagnosis',
      variable: `heavy-rain.${dimension.key}`,
      unit: 'score',
      value: dimension.score,
      algorithm: { name: 'heavy-rain-score', version: ALGORITHM_VERSION, max: dimension.max },
      confidence: dimension.evidence.length >= 2 ? 0.82 : 0.62,
      uncertainty: dimension.evidence.length ? null : '缺少该维度输入资料',
      metadata: { evidenceText: dimension.evidence },
    }));
  }
  for (const hazard of diagnosis.convection?.hazards || []) {
    records.push(Contracts.createEvidence(dataset, {
      evidenceType: 'algorithm-diagnosis',
      variable: `convection.${hazard.type}`,
      unit: 'probability',
      value: hazard.probability,
      algorithm: { name: 'convection-classifier', version: ALGORITHM_VERSION },
      confidence: hazard.confidence === '高' ? 0.85 : hazard.confidence === '中' ? 0.68 : 0.48,
    }));
  }
  for (const system of diagnosis.synoptic?.systems || []) {
    records.push(Contracts.createEvidence(dataset, {
      evidenceType: 'algorithm-diagnosis',
      variable: `synoptic.${system.type}`,
      unit: 'boolean',
      value: true,
      algorithm: { name: 'synoptic-rule-diagnosis', version: ALGORITHM_VERSION },
      confidence: system.confidence,
      metadata: { name: system.name, evidenceText: system.evidence },
    }));
  }
  return records;
}

function diagnoseDataset(datasetInput, kind = 'all') {
  const dataset = Contracts.normalizeDataset(datasetInput);
  const validation = Contracts.validateDataset(dataset);
  const diagnosis = {};
  if (kind === 'all' || kind === 'synoptic') diagnosis.synoptic = diagnoseSynoptic(dataset);
  if (kind === 'all' || kind === 'heavy-rain') diagnosis.heavyRain = diagnoseHeavyRain(dataset);
  if (kind === 'all' || kind === 'convection') diagnosis.convection = diagnoseConvection(dataset);
  const evidence = [...Contracts.datasetEvidence(dataset), ...diagnosisEvidence(dataset, diagnosis)];
  return {
    schemaVersion: Contracts.DIAGNOSIS_SCHEMA_VERSION,
    dataset: {
      id: dataset.id,
      name: dataset.name,
      contentHash: dataset.contentHash,
      source: dataset.source,
      region: dataset.region,
      issueTime: dataset.issueTime,
      validTime: dataset.validTime,
    },
    validation,
    diagnosis,
    evidence,
    publication: Contracts.publicationAssessment(dataset, validation),
    algorithm: { name: 'meteomate-weather-diagnosis', version: ALGORITHM_VERSION },
  };
}

module.exports = {
  ALGORITHM_VERSION,
  diagnoseDataset,
  diagnoseHeavyRain,
  diagnoseConvection,
  diagnoseSynoptic,
};
