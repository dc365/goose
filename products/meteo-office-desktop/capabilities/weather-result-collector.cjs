'use strict';

const MAX_JSON_CHARS = 2 * 1024 * 1024;
const TRUSTED_WEATHER_EXTENSIONS = new Set(['weather-data', 'weather-diagnosis', 'gis-map']);

function parseJSONText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_JSON_CHARS || !['{', '['].includes(text[0])) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function visit(value, visitor, seen = new Set(), depth = 0) {
  if (value == null || depth > 10) return;
  if (typeof value === 'string') {
    const parsed = parseJSONText(value);
    if (parsed) visit(parsed, visitor, seen, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, visitor, seen, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (['rawInput', 'inputSchema'].includes(key)) continue;
    visit(item, visitor, seen, depth + 1);
  }
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
  };
  return record;
}

function collectWeatherRecords(values = [], context = {}) {
  const evidence = [];
  const artifacts = [];
  const evidenceKeys = new Set();
  const artifactKeys = new Set();
  const extension = String(context.extensionName || '').toLowerCase();
  if (!TRUSTED_WEATHER_EXTENSIONS.has(extension)) return { evidence, artifacts };

  for (const value of values) {
    visit(value, (candidate) => {
      const candidateEvidence = [];
      if (Array.isArray(candidate.evidence)) candidateEvidence.push(...candidate.evidence);
      if (candidate.kind === 'Evidence') candidateEvidence.push(candidate);
      for (const item of candidateEvidence) {
        const record = evidenceRecord(item, context);
        if (!record) continue;
        const key = record.id || record.recordHash || JSON.stringify([record.source, record.variable, record.validTime, record.value]);
        if (evidenceKeys.has(key)) continue;
        evidenceKeys.add(key);
        evidence.push(record);
      }

      const candidateArtifacts = [];
      if (candidate.artifact) candidateArtifacts.push(candidate.artifact);
      if (Array.isArray(candidate.artifacts)) candidateArtifacts.push(...candidate.artifacts);
      if (candidate.kind === 'Artifact') candidateArtifacts.push(candidate);
      for (const item of candidateArtifacts) {
        const record = artifactRecord(item, context);
        if (!record) continue;
        const key = record.id || record.contentHash || record.path || record.uri;
        if (artifactKeys.has(key)) continue;
        artifactKeys.add(key);
        artifacts.push(record);
      }
    });
  }
  return { evidence, artifacts };
}

module.exports = { TRUSTED_WEATHER_EXTENSIONS, collectWeatherRecords, parseJSONText };
