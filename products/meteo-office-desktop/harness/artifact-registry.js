(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ArtifactRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const ARTIFACT_STATUSES = Object.freeze(['draft', 'validated', 'ready', 'published', 'failed']);

  function createArtifact(input = {}, lineage = {}) {
    if (!input.path && !input.uri) throw new Error('Artifact requires path or uri');
    const createdAt = input.createdAt || Date.now();
    const record = {
      apiVersion: 'meteomate/v1',
      kind: 'Artifact',
      id: input.id || Shared.createId('artifact'),
      name: input.name || String(input.path || input.uri).split(/[\\/]/).pop(),
      type: String(input.type || 'FILE').toUpperCase(),
      path: input.path || null,
      uri: input.uri || null,
      mediaType: input.mediaType || null,
      status: ARTIFACT_STATUSES.includes(input.status) ? input.status : 'draft',
      createdAt,
      updatedAt: input.updatedAt || createdAt,
      sizeBytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : null,
      contentHash: input.contentHash || null,
      metadata: Shared.deepClone(input.metadata || {}),
      lineage: {
        taskId: lineage.taskId || input.lineage?.taskId || input.taskId || null,
        runId: lineage.runId || input.lineage?.runId || input.runId || null,
        contextSnapshotId: lineage.contextSnapshotId || input.lineage?.contextSnapshotId || input.contextSnapshotId || null,
        expertId: lineage.expertId || input.lineage?.expertId || input.expertId || null,
        templateId: lineage.templateId || input.lineage?.templateId || input.templateId || null,
        evidenceIds: Shared.uniqueStrings(lineage.evidenceIds || input.lineage?.evidenceIds || input.evidenceIds),
        toolCallId: lineage.toolCallId || input.lineage?.toolCallId || input.toolCallId || null,
      },
    };
    record.recordHash = Shared.contentHash(record);
    return record;
  }

  function semanticHash(record = {}) {
    const metadata = Shared.deepClone(record.metadata || {});
    delete metadata.responseId;
    delete metadata.publicationAttestation;
    const semantic = {
      ...record,
      metadata,
    };
    delete semantic.id;
    delete semantic.createdAt;
    delete semantic.updatedAt;
    delete semantic.lineage;
    delete semantic.recordHash;
    return Shared.contentHash(semantic);
  }

  function registerArtifact(task, input, lineage = {}) {
    task.artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
    const record = createArtifact(input, { taskId: task.id, contextSnapshotId: task.contextSnapshotId, ...lineage });
    const duplicateId = task.artifacts.find((artifact) => artifact.id === record.id);
    if (duplicateId) {
      const reconciled = {
        ...duplicateId,
        metadata: {
          ...(duplicateId.metadata || {}),
          ...(input.metadata || {}),
        },
      };
      for (const key of Object.keys(input)) {
        if (['id', 'createdAt', 'updatedAt', 'lineage', 'recordHash', 'metadata'].includes(key)) continue;
        if (Object.prototype.hasOwnProperty.call(record, key)) reconciled[key] = record[key];
      }
      if (semanticHash(duplicateId) !== semanticHash(reconciled)) {
        throw new Error(`Artifact ID conflict: ${record.id}`);
      }
      return duplicateId;
    }
    const duplicateSemantic = task.artifacts.find((artifact) => semanticHash(artifact) === semanticHash(record));
    if (duplicateSemantic) return duplicateSemantic;
    task.artifacts.push(record);
    task.artifactIds = Shared.uniqueStrings([...(task.artifactIds || []), record.id]);
    return record;
  }

  function validateArtifact(record) {
    const errors = [];
    if (!record?.id) errors.push('missing id');
    if (!record?.name) errors.push('missing name');
    if (!record?.path && !record?.uri) errors.push('missing path or uri');
    if (!ARTIFACT_STATUSES.includes(record?.status)) errors.push('invalid status');
    return { valid: errors.length === 0, errors };
  }

  return { ARTIFACT_STATUSES, createArtifact, semanticHash, registerArtifact, validateArtifact };
});
