(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.TaskStateMachine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const STATES = Object.freeze({
    DRAFT: 'DRAFT',
    PLANNING: 'PLANNING',
    WAITING_INPUT: 'WAITING_INPUT',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    RUNNING: 'RUNNING',
    PARTIAL: 'PARTIAL',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    ARCHIVED: 'ARCHIVED',
  });

  const ALLOWED_TRANSITIONS = Object.freeze({
    DRAFT: ['PLANNING', 'RUNNING', 'CANCELLED', 'ARCHIVED'],
    PLANNING: ['WAITING_INPUT', 'WAITING_APPROVAL', 'RUNNING', 'FAILED', 'CANCELLED'],
    WAITING_INPUT: ['PLANNING', 'RUNNING', 'CANCELLED'],
    WAITING_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED'],
    RUNNING: ['WAITING_INPUT', 'WAITING_APPROVAL', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
    PARTIAL: ['PLANNING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: ['PLANNING', 'RUNNING', 'ARCHIVED'],
    FAILED: ['PLANNING', 'RUNNING', 'ARCHIVED'],
    CANCELLED: ['PLANNING', 'RUNNING', 'ARCHIVED'],
    ARCHIVED: [],
  });

  const LEGACY_STATUS_MAP = Object.freeze({
    draft: STATES.DRAFT,
    running: STATES.RUNNING,
    completed: STATES.COMPLETED,
    failed: STATES.FAILED,
    cancelled: STATES.CANCELLED,
    interrupted: STATES.PARTIAL,
  });

  function inferLifecycleState(task = {}) {
    if (Object.values(STATES).includes(task.lifecycleState)) return task.lifecycleState;
    return LEGACY_STATUS_MAP[task.status] || STATES.DRAFT;
  }

  function inferCapabilityMode(task = {}) {
    if (['inherit', 'custom'].includes(task.capabilityMode)) return task.capabilityMode;
    return (Array.isArray(task.connectorIds) && task.connectorIds.length)
      || Object.keys(task.toolSelections || {}).length
      ? 'custom'
      : 'inherit';
  }

  function normalizeTask(task = {}) {
    return {
      ...task,
      lifecycleState: inferLifecycleState(task),
      capabilityMode: inferCapabilityMode(task),
      workflowIds: Shared.uniqueStrings(task.workflowIds),
      connectorIds: Shared.uniqueStrings(task.connectorIds),
      toolSelections: Shared.cleanObject(task.toolSelections),
      workMode:
        task.workMode ||
        (['analysis-readonly', 'artifact-approval', 'workspace-approval', 'trusted-workspace'].includes(task.permissionProfileId)
          ? 'execute'
          : 'ask'),
      contextSnapshotId: task.contextSnapshotId || task.contextSnapshot?.id || null,
      runAttempts: Array.isArray(task.runAttempts) ? task.runAttempts : [],
      checkpoints: Array.isArray(task.checkpoints) ? task.checkpoints : [],
      validationResults: Array.isArray(task.validationResults) ? task.validationResults : [],
      evidenceIds: Shared.uniqueStrings(task.evidenceIds),
      artifactIds: Shared.uniqueStrings(task.artifactIds || (task.artifacts || []).map((artifact) => artifact.id)),
      expectedOutputs: Array.isArray(task.expectedOutputs) ? task.expectedOutputs : [],
    };
  }

  function canTransition(from, to) {
    return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
  }

  function transition(task, nextState, metadata = {}) {
    const current = inferLifecycleState(task);
    if (current !== nextState && !canTransition(current, nextState)) {
      throw new Error(`Invalid task transition: ${current} -> ${nextState}`);
    }
    task.lifecycleState = nextState;
    task.lifecycleUpdatedAt = metadata.at || Date.now();
    task.lifecycleReason = metadata.reason || '';
    return task;
  }

  function beginRunAttempt(task, input = {}) {
    const normalized = normalizeTask(task);
    Object.assign(task, normalized);
    const attempt = {
      id: input.id || Shared.createId('run'),
      number: task.runAttempts.length + 1,
      runtime: input.runtime || task.runtimeMode || 'unknown',
      providerId: input.providerId || task.providerId || '',
      modelId: input.modelId || task.modelId || '',
      contextSnapshotId: input.contextSnapshotId || task.contextSnapshotId || null,
      startedAt: input.startedAt || Date.now(),
      completedAt: null,
      status: 'running',
      error: null,
    };
    task.runAttempts.push(attempt);
    transition(task, STATES.RUNNING, { reason: 'run_started', at: attempt.startedAt });
    return attempt;
  }

  function finishRunAttempt(task, attemptId, status, error = null) {
    const attempt = (task.runAttempts || []).find((candidate) => candidate.id === attemptId);
    if (!attempt) return null;
    attempt.status = status;
    attempt.error = error;
    attempt.completedAt = Date.now();
    const nextState = status === 'completed' ? STATES.COMPLETED : status === 'cancelled' ? STATES.CANCELLED : STATES.FAILED;
    transition(task, nextState, { reason: `run_${status}`, at: attempt.completedAt });
    return attempt;
  }

  return {
    STATES,
    ALLOWED_TRANSITIONS,
    inferLifecycleState,
    inferCapabilityMode,
    normalizeTask,
    canTransition,
    transition,
    beginRunAttempt,
    finishRunAttempt,
  };
});
