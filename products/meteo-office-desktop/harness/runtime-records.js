(function (root, factory) {
  const EventNormalizer = typeof module === 'object' && module.exports
    ? require('./event-normalizer')
    : root.MeteoMateHarness.EventNormalizer;
  const ArtifactRegistry = typeof module === 'object' && module.exports
    ? require('./artifact-registry')
    : root.MeteoMateHarness.ArtifactRegistry;
  const EvidenceLedger = typeof module === 'object' && module.exports
    ? require('./evidence-ledger')
    : root.MeteoMateHarness.EvidenceLedger;
  const api = factory(EventNormalizer, ArtifactRegistry, EvidenceLedger);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.RuntimeRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  EventNormalizer,
  ArtifactRegistry,
  EvidenceLedger
) {
  'use strict';

  function eventPayload(event, key) {
    return event?.[key] || event?.record || event?.payload || null;
  }

  function recordMetadata(payload) {
    const metadata = { ...(payload?.metadata || {}) };
    delete metadata.responseId;
    return metadata;
  }

  function recordRuntimeEvent(task, event = {}, lineage = {}, options = {}) {
    if (!task?.id) throw new Error('Runtime event requires a task');
    if (!event?.type) throw new Error('Runtime event requires a type');
    const runId = event.runId || lineage.runId || null;
    const normalizedEvent = EventNormalizer.normalizeRuntimeEvent(event, {
      taskId: task.id,
      runId,
      runtime: lineage.runtime || event.runtime || null,
    });
    const limit = Math.max(1, Number(options.eventLimit) || 200);
    task.harnessEvents = [...(task.harnessEvents || []), normalizedEvent].slice(-limit);
    const responseId = event.responseId || options.responseId || null;

    let artifact = null;
    let evidence = null;
    let artifactChanged = false;
    let evidenceChanged = false;
    if (event.type === 'artifact_created') {
      const payload = eventPayload(event, 'artifact');
      if (payload) {
        const previousCount = (task.artifacts || []).length;
        artifact = ArtifactRegistry.registerArtifact(task, {
          ...payload,
          metadata: recordMetadata(payload),
        }, {
          runId,
          toolCallId: event.toolCallId || null,
        });
        artifactChanged = (task.artifacts || []).length > previousCount;
      }
    } else if (event.type === 'evidence_created') {
      const payload = eventPayload(event, 'evidence');
      if (payload) {
        const previousCount = (task.evidence || []).length;
        evidence = EvidenceLedger.registerEvidence(task, {
          ...payload,
          metadata: recordMetadata(payload),
        }, {
          runId,
          toolCallId: event.toolCallId || null,
        });
        evidenceChanged = (task.evidence || []).length > previousCount;
      }
    }
    if ((artifactChanged || evidenceChanged) && task.publication) {
      task.publication = {
        ...task.publication,
        dirty: true,
        error: null,
      };
    }
    return {
      normalizedEvent,
      artifact,
      evidence,
      artifactChanged,
      evidenceChanged,
      responseId,
    };
  }

  return { recordRuntimeEvent };
});
