(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.EventNormalizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const TYPE_MAP = Object.freeze({
    runtime_status: 'runtime.status',
    session_started: 'session.started',
    turn_started: 'run.started',
    assistant_message_delta: 'message.delta',
    user_message_delta: 'user.delta',
    thought_delta: 'process.summary',
    tool_call_started: 'tool.started',
    tool_call_updated: 'tool.updated',
    permission_requested: 'approval.requested',
    usage_updated: 'usage.updated',
    turn_completed: 'run.completed',
    turn_failed: 'run.failed',
    turn_cancelled: 'run.cancelled',
    artifact_created: 'artifact.created',
    evidence_created: 'evidence.created',
  });

  function normalizeRuntimeEvent(event = {}, options = {}) {
    return {
      id: event.eventId || Shared.createId('event'),
      type: TYPE_MAP[event.type] || `runtime.${event.type || 'unknown'}`,
      sourceType: event.type || 'unknown',
      taskId: event.taskId || options.taskId || null,
      sessionId: event.sessionId || null,
      runId: event.runId || options.runId || null,
      runtime: event.runtime || options.runtime || null,
      timestamp: event.timestamp || Date.now(),
      payload: Shared.deepClone(event),
    };
  }

  function normalizeMany(events, options) {
    return (Array.isArray(events) ? events : []).map((event) => normalizeRuntimeEvent(event, options));
  }

  return { TYPE_MAP, normalizeRuntimeEvent, normalizeMany };
});
