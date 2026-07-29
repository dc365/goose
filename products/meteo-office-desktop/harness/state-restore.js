(function restoreMeteoMateState(root) {
  'use strict';
  const harness = root.MeteoMateHarness;
  const bootstrap = root.__METEOMATE_STATE_BOOTSTRAP__;
  if (!harness?.StateStore || !bootstrap) return;

  function runtimeWorkflowCatalog() {
    return [
      ...(state.workflowVersions || []),
      ...(state.workflows || []).filter((workflow) => workflow.metadata?.status === 'published'),
    ];
  }

  function runtimeCatalog() {
    const experts = (typeof allExperts === 'function' ? allExperts() : catalog.experts) || [];
    return {
      ...catalog,
      experts,
      teams: experts.filter((expert) => expert.kind === 'team'),
      workflows: runtimeWorkflowCatalog(),
    };
  }

  function workflowDefinitions(capabilities = {}) {
    return (capabilities.workflows || []).map((reference) =>
      runtimeWorkflowCatalog().find((workflow) =>
        workflow.metadata?.id === reference.id
        && workflow.metadata?.version === reference.version
        && workflow.digest === reference.digest
      )
    ).filter(Boolean);
  }

  function workflowRuntimeInstruction(workflows, capabilities = {}) {
    if (!workflows.length) return '';
    const contracts = workflows.map((workflow) => ({
      id: workflow.metadata.id,
      name: workflow.metadata.name,
      version: workflow.metadata.version,
      digest: workflow.digest,
      role: capabilities.workflows?.find((reference) =>
        reference.id === workflow.metadata.id
        && reference.version === workflow.metadata.version
      )?.role || 'selected',
      inputSchema: workflow.spec.inputSchema,
      outputSchema: workflow.spec.outputSchema,
      policy: workflow.spec.policy,
      nodes: workflow.spec.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        name: node.name,
        description: node.description,
        capability: node.capability,
        skills: node.skills,
        inputs: node.inputs,
        outputs: node.outputs,
        config: node.config,
        retry: node.retry,
        timeoutSeconds: node.timeoutSeconds,
        onError: node.onError,
      })),
      edges: workflow.spec.edges,
    }));
    return [
      '以下是本次任务已授权的已发布工作流。它们是版本固定的执行契约。',
      '仅在用户目标匹配或任务明确绑定时采用。role=dependency 的工作流只在其父工作流调用时执行，不应作为独立顶层流程重复执行。按依赖顺序推进，审批节点必须暂停并请求用户确认，不能虚构节点、工具调用或运行结果。',
      '当前客户端会把工作流作为编排契约加载；若没有专用 workflow.call 工具，应使用模型、Skill 和工具逐步完成，并如实说明实际执行范围。',
      `<selected-workflows>\n${JSON.stringify(contracts, null, 2)}\n</selected-workflows>`,
    ].join('\n\n');
  }

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
      catalog: runtimeCatalog(),
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
    request.permissionProfileId = snapshot.permissionPolicy.id;
    request.permissionProfileName = snapshot.permissionPolicy.profile?.name || snapshot.permissionPolicy.id;
    request.permissionProfileDescription = snapshot.permissionPolicy.profile?.description || '';
    request.completionContract = structuredClone(snapshot.completionContract);
    request.completionRecipe = harness.ContextCompiler.completionRecipe(snapshot.completionContract);
    request.skillIds = snapshot.capabilities.skills.map((item) => item.id);
    request.workflowDefinitions = workflowDefinitions(snapshot.capabilities);
    request.workflowRefs = snapshot.capabilities.workflows.map((item) => ({
      id: item.id,
      version: item.version,
      digest: item.digest,
      role: item.role || 'selected',
    }));
    const workflowInstruction = workflowRuntimeInstruction(
      request.workflowDefinitions,
      snapshot.capabilities
    );
    if (workflowInstruction) {
      request.expertInstruction = [request.expertInstruction, workflowInstruction].filter(Boolean).join('\n\n');
    }
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
        catalog: runtimeCatalog(),
      });
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
