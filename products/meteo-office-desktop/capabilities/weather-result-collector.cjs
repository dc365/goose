'use strict';

const MAX_JSON_CHARS = 2 * 1024 * 1024;
const TRUSTED_WEATHER_TOOLS = Object.freeze({
  weather_build_evidence: Object.freeze({
    extensionName: 'weather-data',
    evidence: true,
  }),
  weather_diagnose_dataset: Object.freeze({
    extensionName: 'weather-diagnosis',
    evidence: true,
  }),
  weather_render_dataset_map: Object.freeze({
    extensionName: 'gis-map',
    evidence: true,
    artifact: true,
  }),
  weather_render_risk_map: Object.freeze({
    extensionName: 'gis-map',
    artifact: true,
  }),
  weather_export_demo_bundle: Object.freeze({
    extensionName: 'weather-data',
    artifacts: true,
  }),
});
const TRUSTED_WEATHER_EXTENSIONS = new Set(
  Object.values(TRUSTED_WEATHER_TOOLS).map((contract) => contract.extensionName)
);

function parseJSONText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_JSON_CHARS || !['{', '['].includes(text[0])) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resultRoots(value) {
  if (typeof value === 'string') {
    const parsed = parseJSONText(value);
    return parsed && !Array.isArray(parsed) ? [parsed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item?.type === 'text' && typeof item.text === 'string') {
        const parsed = parseJSONText(item.text);
        return parsed && !Array.isArray(parsed) ? [parsed] : [];
      }
      return [];
    });
  }
  if (!value || typeof value !== 'object') return [];
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return [value.structuredContent];
  }
  return value.schemaVersion ? [value] : [];
}

function evidenceRecord(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind !== 'Evidence' && !value.source) return null;
  const record = { ...value };
  record.apiVersion ||= 'meteomate/v1';
  record.kind ||= 'Evidence';
  record.metadata = {
    ...(record.metadata || {}),
    extensionName: context.extensionName || null,
    toolName: context.toolName || null,
  };
  return record;
}

function artifactRecord(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind !== 'Artifact' && !value.path && !value.uri) return null;
  const record = { ...value };
  record.apiVersion ||= 'meteomate/v1';
  record.kind ||= 'Artifact';
  record.metadata = {
    ...(record.metadata || {}),
    extensionName: context.extensionName || null,
    toolName: context.toolName || null,
  };
  return record;
}

function collectWeatherRecords(values = [], context = {}) {
  const evidence = [];
  const artifacts = [];
  const evidenceKeys = new Set();
  const artifactKeys = new Set();
  const extension = String(context.extensionName || '').toLowerCase();
  const toolName = String(context.toolName || '').trim();
  const contract = TRUSTED_WEATHER_TOOLS[toolName];
  if (!contract || contract.extensionName !== extension) return { evidence, artifacts };

  for (const value of values) {
    for (const candidate of resultRoots(value)) {
      if (!String(candidate.schemaVersion || '').startsWith('meteomate.weather.')) continue;
      const candidateEvidence = contract.evidence && Array.isArray(candidate.evidence)
        ? candidate.evidence
        : [];
      for (const item of candidateEvidence) {
        const record = evidenceRecord(item, context);
        if (!record || record.kind !== 'Evidence') continue;
        const key = record.id || record.recordHash || JSON.stringify([record.source, record.variable, record.validTime, record.value]);
        if (evidenceKeys.has(key)) continue;
        evidenceKeys.add(key);
        evidence.push(record);
      }

      const candidateArtifacts = [
        ...(contract.artifact && candidate.artifact ? [candidate.artifact] : []),
        ...(contract.artifacts && Array.isArray(candidate.artifacts) ? candidate.artifacts : []),
      ];
      for (const item of candidateArtifacts) {
        const record = artifactRecord(item, context);
        if (!record || record.kind !== 'Artifact') continue;
        const key = record.id || record.contentHash || record.path || record.uri;
        if (artifactKeys.has(key)) continue;
        artifactKeys.add(key);
        artifacts.push(record);
      }
    }
  }
  return { evidence, artifacts };
}

module.exports = {
  TRUSTED_WEATHER_EXTENSIONS,
  TRUSTED_WEATHER_TOOLS,
  collectWeatherRecords,
  parseJSONText,
};
