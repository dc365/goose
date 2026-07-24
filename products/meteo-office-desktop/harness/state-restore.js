(function restoreMeteoMateState(root) {
  'use strict';
  const harness = root.MeteoMateHarness;
  const bootstrap = root.__METEOMATE_STATE_BOOTSTRAP__;
  if (!harness?.StateStore || !bootstrap) return;

  function latestRunningAttempt(task) {
    return [...(task?.runAttempts || [])].reverse().find((attempt) => attempt.status === 'running') || null;
  }

  function latestAssistantText(task) {
    return [...(task?.messages || [])].reverse().find((message) => message.role === 'assistant')?.text || '';
  }

  function finishPartialAttempt(task, attempt, reason) {
    attempt.status = 'partial';
    attempt.error = reason || null;
    attempt.completedAt = Date.now();
    harness.TaskStateMachine.transition(task, harness.TaskStateMachine.STATES.PARTIAL, {
      reason: 'run_partial',
      at: attempt.completedAt,
    });
  }

  const originalSend = runtimeRouter.send.bind(runtimeRouter);
  runtimeRouter.send = async (task, request) => {
    const project = getConversationProject(task) || getActiveProject() || {};
    const expert = getTaskExpert(task) || getSelectedExpert() || primaryAssistant;
    const normalizedProject = harness.Project.normalizeProject(project);
    const snapshot = harness.ContextCompiler.compileTaskContext({
      task,
      project: normalizedProject,
      expert,
      catalog,
      prompt: request.prompt,
    });
    task.contextSnapshot = snapshot;
    task.contextSnapshotId = snapshot.id;
    task.workMode = snapshot.task.workMode;
    task.capabilityResolution = snapshot.capabilities;
    task.updatedAt = Date.now();
    if (task.sessionId && task.sessionCapabilityHash !== snapshot.capabilities.id) {
      task.sessionId = null;
      task.runtimeMode = null;
      task.capabilityLoad = null;
    }
    if (!snapshot.capabilities.ready) {
      saveState();
      harness.CapabilityResolver.assertCapabilitiesReady(snapshot.capabilities);
    }
    const attempt = harness.TaskStateMachine.beginRunAttempt(task, {
      runtime: task.runtimeMode || 'auto',
      providerId: request.providerId,
      modelId: request.modelId,
      contextSnapshotId: snapshot.id,
    });
    request.contextSnapshot = snapshot;
    request.contextEnvelope = harness.ContextCompiler.runtimeEnvelope(snapshot);
    request.completionContract = structuredClone(snapshot.completionContract);
    request.completionRecipe = harness.ContextCompiler.completionRecipe(snapshot.completionContract);
    request.skillIds = snapshot.capabilities.skills.map((item) => item.id);
    request.connectorIds = snapshot.capabilities.connectors.map((item) => item.id);
    request.toolSelections = structuredClone(snapshot.capabilities.toolSelections || {});
    request.capabilityHash = snapshot.capabilities.id;
    request.sessionCapabilityHash = task.sessionCapabilityHash || null;
    request.runAttemptId = attempt.id;
    saveState();
    try {
      return await originalSend(task, request);
    } catch (error) {
      harness.TaskStateMachine.finishRunAttempt(task, attempt.id, 'failed', error?.message || String(error));
      saveState();
      throw error;
    }
  };

  const originalSubscribe = runtimeRouter.subscribe.bind(runtimeRouter);
  runtimeRouter.subscribe = (listener) =>
    originalSubscribe((event) => {
      const task = state.tasks.find((candidate) => candidate.id === event.taskId);
      if (task) {
        const attempt = latestRunningAttempt(task);
        const normalizedEvent = harness.EventNormalizer.normalizeRuntimeEvent(event, {
          taskId: task.id,
          runId: attempt?.id || null,
          runtime: event.runtime || task.runtimeMode || null,
        });
        task.harnessEvents = [...(task.harnessEvents || []), normalizedEvent].slice(-200);

        if (event.type === 'turn_started' && attempt) {
          attempt.runtime = event.runtime || attempt.runtime;
          attempt.sessionId = event.sessionId || attempt.sessionId || null;
        } else if (event.type === 'permission_requested') {
          try {
            harness.TaskStateMachine.transition(task, harness.TaskStateMachine.STATES.WAITING_APPROVAL, {
              reason: 'permission_requested',
            });
          } catch {
            // UI status remains authoritative when an older task cannot transition cleanly.
          }
        } else if (event.type === 'permission_resolved' && task.lifecycleState === harness.TaskStateMachine.STATES.WAITING_APPROVAL) {
          harness.TaskStateMachine.transition(task, harness.TaskStateMachine.STATES.RUNNING, {
            reason: 'permission_resolved',
          });
        } else if (event.type === 'artifact_created') {
          const artifact = event.artifact || event.record || event.payload;
          if (artifact) {
            harness.ArtifactRegistry.registerArtifact(task, artifact, {
              runId: attempt?.id || null,
              toolCallId: event.toolCallId || null,
            });
          }
        } else if (event.type === 'evidence_created') {
          const evidence = event.evidence || event.record || event.payload;
          if (evidence) {
            harness.EvidenceLedger.registerEvidence(task, evidence, {
              runId: attempt?.id || null,
              toolCallId: event.toolCallId || null,
            });
          }
        } else if (event.type === 'turn_completed' && attempt) {
          const contract = task.contextSnapshot?.completionContract;
          const completion = event.runtime === 'acp'
            ? harness.ContextCompiler.evaluateCompletion(contract, latestAssistantText(task))
            : { required: false, valid: true, status: 'completed' };
          if (!completion.required || (completion.valid && completion.status === 'completed')) {
            harness.TaskStateMachine.finishRunAttempt(task, attempt.id, 'completed');
          } else if (completion.valid && completion.status === 'failed') {
            harness.TaskStateMachine.finishRunAttempt(task, attempt.id, 'failed', completion.reason || '任务执行失败');
          } else {
            finishPartialAttempt(task, attempt, completion.reason || '任务尚未完整交付');
          }
        } else if (event.type === 'turn_cancelled' && attempt) {
          harness.TaskStateMachine.finishRunAttempt(task, attempt.id, 'cancelled');
        } else if (event.type === 'turn_failed' && attempt) {
          harness.TaskStateMachine.finishRunAttempt(task, attempt.id, 'failed', event.message || 'runtime failed');
        }
      }
      listener(event);
    });

  root.MeteoMateHarnessRuntime = Object.freeze({
    getState: () => state,
    compileActiveTask: () => {
      const task = getActiveTask();
      if (!task) return null;
      return harness.ContextCompiler.compileTaskContext({
        task,
        project: getConversationProject(task) || {},
        expert: getTaskExpert(task) || primaryAssistant,
        catalog,
      });
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
