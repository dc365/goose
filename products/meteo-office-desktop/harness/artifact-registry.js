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
        taskId: lineage.taskId || input.taskId || null,
        runId: lineage.runId || input.runId || null,
        contextSnapshotId: lineage.contextSnapshotId || input.contextSnapshotId || null,
        expertId: lineage.expertId || input.expertId || null,
        templateId: lineage.templateId || input.templateId || null,
        evidenceIds: Shared.uniqueStrings(lineage.evidenceIds || input.evidenceIds),
        toolCallId: lineage.toolCallId || input.toolCallId || null,
      },
    };
    record.recordHash = Shared.contentHash(record);
    return record;
  }

  function registerArtifact(task, input, lineage = {}) {
    task.artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
    const record = createArtifact(input, { taskId: task.id, contextSnapshotId: task.contextSnapshotId, ...lineage });
    const duplicate = task.artifacts.find((artifact) =>
      artifact.id === record.id ||
      (record.contentHash && artifact.contentHash === record.contentHash) ||
      (record.path && artifact.path === record.path)
    );
    if (duplicate) {
      Object.assign(duplicate, record, { id: duplicate.id, updatedAt: Date.now() });
      return duplicate;
    }
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

  return { ARTIFACT_STATUSES, createArtifact, registerArtifact, validateArtifact };
});
