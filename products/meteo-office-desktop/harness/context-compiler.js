(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Shared = isNode ? require('./shared') : root.MeteoMateHarness.Shared;
  const Project = isNode ? require('./project') : root.MeteoMateHarness.Project;
  const Resolver = isNode ? require('./capability-resolver') : root.MeteoMateHarness.CapabilityResolver;
  const Policy = isNode ? require('./policy-engine') : root.MeteoMateHarness.PolicyEngine;
  const api = factory(Shared, Project, Resolver, Policy);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ContextCompiler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared, Project, Resolver, Policy) {
  'use strict';

  function latestUserPrompt(task, explicitPrompt) {
    if (explicitPrompt) return explicitPrompt;
    const messages = Array.isArray(task?.messages) ? task.messages : [];
    return [...messages].reverse().find((message) => message.role === 'user' && message.text)?.text || '';
  }

  function normalizeIterationLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 24;
    return Math.min(64, Math.max(4, Math.round(parsed)));
  }

  function promptRequiresArtifact(value) {
    const prompt = String(value || '').trim();
    if (!prompt) return false;
    return /(?:生成|创建|制作|导出|整理成|写成).{0,18}(?:文档|文件|报告|预报稿|专题稿|材料|Word|DOCX|PDF|PPTX?|Excel|XLSX)/i.test(prompt)
      || /(?:create|generate|export|produce|write).{0,40}(?:document|file|report|docx|pdf|pptx?|xlsx)/i.test(prompt);
  }

  function compileCompletionContract(context = {}) {
    const expectedOutputs = Shared.deepClone(context.task?.expectedOutputs || []);
    const capabilities = context.capabilities || {};
    const hasCapabilities = Boolean(
      (capabilities.skills || []).length
      || (capabilities.workflows || []).length
      || (capabilities.connectors || []).length
      || Object.keys(capabilities.toolSelections || {}).length
    );
    const required = Boolean(
      expectedOutputs.length
      || (context.task?.workMode === 'execute' && hasCapabilities)
    );
    const requiresArtifact = expectedOutputs.some((output) => {
      if (!output || typeof output !== 'object') return false;
      const kind = String(output.kind || output.type || output.delivery || '').toLowerCase();
      return ['artifact', 'file', 'document', 'attachment'].includes(kind);
    }) || promptRequiresArtifact(context.task?.prompt);
    const body = {
      version: 1,
      required,
      requiresArtifact,
      maxIterations: normalizeIterationLimit(context.outputContract?.maxIterations),
      expectedOutputs,
    };
    return Shared.deepFreeze({
      ...body,
      id: `completion-${Shared.contentHash(body)}`,
    });
  }

  function completionJsonSchema(contract) {
    const artifacts = {
      type: 'array',
      description: '本轮实际生成或更新的成果；没有成果时返回空数组。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          uri: { type: 'string' },
          mediaType: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'uri'],
      },
    };
    const completedProperties = {
      blockers: { maxItems: 0 },
      ...(contract.requiresArtifact ? { artifacts: { minItems: 1 } } : {}),
    };
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: ['completed', 'partial', 'blocked', 'failed'],
          description: '只有用户目标已经实际达成时才可使用 completed。',
        },
        summary: { type: 'string', description: '简洁说明本轮实际完成了什么。' },
        answer: { type: 'string', description: '直接展示给用户的最终答复。' },
        artifacts,
        evidence: {
          type: 'array',
          description: '证明任务状态的可核验事实、工具结果或成果说明。',
          items: { type: 'string' },
          minItems: 1,
        },
        blockers: {
          type: 'array',
          description: '尚未完成或无法继续的原因；完成时必须为空。',
          items: { type: 'string' },
        },
        nextActions: {
          type: 'array',
          description: '部分完成或阻塞时建议的后续动作。',
          items: { type: 'string' },
        },
      },
      required: ['status', 'summary', 'answer', 'artifacts', 'evidence', 'blockers', 'nextActions'],
      allOf: [
        {
          if: { properties: { status: { const: 'completed' } }, required: ['status'] },
          then: { properties: completedProperties },
        },
        {
          if: {
            properties: { status: { enum: ['partial', 'blocked', 'failed'] } },
            required: ['status'],
          },
          then: { properties: { blockers: { minItems: 1 } } },
        },
      ],
    };
  }

  function completionRecipe(contract) {
    if (!contract?.required) return null;
    const expected = contract.expectedOutputs.length
      ? `\n预期输出：${JSON.stringify(contract.expectedOutputs)}`
      : '';
    return {
      version: '1.0.0',
      title: `MeteoMate Completion ${contract.id}`,
      description: `meteomate-completion:${contract.id}`,
      instructions: [
        '你正在执行一个通用 Agent 任务循环。根据用户目标、会话上下文、已选技能和可用工具持续推进任务。',
        '计划、进度说明、准备执行或“接下来将做什么”都不是最终结果，不得因此结束任务。',
        '只有目标已经实际达成并有可核验依据时，才以 completed 提交 final_output。',
        '用户要求生成文档、报告或其他文件时，文件本身就是交付结果；必须在当前任务内调用可用成果物工具完成创建和校验，并直接交付，不得只返回正文、文件名、计划或要求用户再次追问。',
        'artifacts 只能列出本轮工具实际返回且已经验证的成果；URI 必须逐字采用工具结果，禁止拼接、补全或猜测绝对路径。创建或校验失败时不得使用 completed。',
        '需要用户补充信息时使用 blocked；已有可交付结果但仍有缺口时使用 partial；不可恢复错误使用 failed。',
        '不得虚构工具调用、数据、文件、链接或成果。最终状态必须与实际工具结果一致。',
        expected,
      ].filter(Boolean).join('\n'),
      settings: { max_turns: contract.maxIterations },
      response: { json_schema: completionJsonSchema(contract) },
    };
  }

  function parseCompletionEnvelope(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    const candidates = [text, text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
    for (let index = text.lastIndexOf('{'); index >= 0;) {
      candidates.push(text.slice(index));
      if (index === 0) break;
      index = text.lastIndexOf('{', index - 1);
    }
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        // Continue until the trailing final-output object is found.
      }
    }
    return parseFallbackCompletionBlock(text);
  }

  function parseFallbackCompletionBlock(text) {
    const startMarker = 'METEOMATE_COMPLETION';
    const endMarker = 'END_METEOMATE_COMPLETION';
    const normalizedText = text.toUpperCase();
    const start = normalizedText.indexOf(startMarker);
    const end = normalizedText.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) return null;
    const lines = text.slice(start + startMarker.length, end).split(/\r?\n/);
    const envelope = {
      status: '',
      summary: '',
      answer: '',
      artifacts: [],
      evidence: [],
      blockers: [],
      nextActions: [],
    };
    const sectionNames = {
      'ANSWER:': 'answer',
      'ARTIFACTS:': 'artifacts',
      'EVIDENCE:': 'evidence',
      'BLOCKERS:': 'blockers',
      'NEXT_ACTIONS:': 'nextActions',
    };
    let section = null;
    const answerLines = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const normalizedLine = line.toUpperCase();
      if (normalizedLine.startsWith('STATUS:')) {
        envelope.status = line.slice('STATUS:'.length).trim();
        section = null;
        continue;
      }
      if (normalizedLine.startsWith('SUMMARY:')) {
        envelope.summary = line.slice('SUMMARY:'.length).trim();
        section = null;
        continue;
      }
      if (normalizedLine.startsWith('ANSWER:')) {
        section = 'answer';
        const inlineAnswer = rawLine.slice(rawLine.indexOf(':') + 1).trim();
        if (inlineAnswer) answerLines.push(inlineAnswer);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(sectionNames, normalizedLine)) {
        section = sectionNames[normalizedLine];
        continue;
      }
      if (!section || !line) continue;
      if (section === 'answer') {
        answerLines.push(rawLine.trimEnd());
        continue;
      }
      if (!line.startsWith('-')) continue;
      const item = line.slice(1).trim();
      if (!item || item.toLowerCase() === 'none') continue;
      if (section === 'artifacts') {
        const [name = '', uri = '', mediaType = '', description = ''] = item
          .split('|')
          .map((part) => part.trim());
        envelope.artifacts.push({
          name,
          uri,
          ...(mediaType ? { mediaType } : {}),
          ...(description ? { description } : {}),
        });
      } else {
        envelope[section].push(item);
      }
    }
    envelope.answer = answerLines.join('\n').trim();
    return envelope;
  }

  function evaluateCompletion(contract, value) {
    if (!contract?.required) return { required: false, valid: true, status: 'completed', envelope: null };
    const envelope = parseCompletionEnvelope(value);
    if (!envelope) {
      return { required: true, valid: false, status: 'partial', envelope: null, reason: '缺少结构化完成结果' };
    }
    const status = String(envelope.status || '');
    const artifacts = Array.isArray(envelope.artifacts) ? envelope.artifacts : [];
    const evidence = Array.isArray(envelope.evidence) ? envelope.evidence.filter(Boolean) : [];
    const blockers = Array.isArray(envelope.blockers) ? envelope.blockers.filter(Boolean) : [];
    const validStatus = ['completed', 'partial', 'blocked', 'failed'].includes(status);
    const validShape = validStatus
      && typeof envelope.summary === 'string'
      && typeof envelope.answer === 'string'
      && Array.isArray(envelope.artifacts)
      && Array.isArray(envelope.evidence)
      && Array.isArray(envelope.blockers)
      && Array.isArray(envelope.nextActions);
    const terminalStateIsValid = evidence.length > 0
      && (status === 'completed'
        ? blockers.length === 0 && (!contract.requiresArtifact || artifacts.length > 0)
        : blockers.length > 0);
    if (!validShape || !terminalStateIsValid) {
      return { required: true, valid: false, status: 'partial', envelope, reason: '完成结果与契约不一致' };
    }
    return { required: true, valid: true, status, envelope, reason: blockers.join('；') };
  }

  function compileTaskContext({ task = {}, project = {}, expert = {}, catalog = {}, prompt = '', clock = Date }) {
    const normalizedProject = Project.normalizeProject(project);
    const currentPrompt = latestUserPrompt(task, prompt);
    const capabilities = Resolver.resolveCapabilities({
      project: normalizedProject,
      expert,
      task,
      catalog,
      prompt: currentPrompt,
    });
    const policy = Policy.resolvePolicy({
      project: normalizedProject,
      expert,
      task,
      capabilities,
      permissionProfiles: catalog.permissionProfiles || {},
    });
    const body = {
      apiVersion: 'meteomate/v1',
      kind: 'TaskContextSnapshot',
      schemaVersion: Shared.SCHEMA_VERSION,
      compiledAt: Shared.nowIso(clock),
      task: {
        id: task.id || null,
        kind: task.kind || 'task',
        title: task.title || '',
        prompt: currentPrompt,
        workMode: policy.workMode,
        expectedOutputs: Shared.deepClone(task.expectedOutputs || []),
      },
      project: Project.projectSnapshot(normalizedProject),
      expert: {
        id: expert.id || null,
        kind: expert.kind || 'Expert',
        name: expert.name || '',
        version: expert.version || '1.0.0',
        revision: Number(expert.revision || 1),
        source: Shared.deepClone(expert.source || { type: 'system' }),
        instruction: expert.instruction || '',
        methodology: Shared.deepClone(expert.methodology || []),
        playbook: Shared.deepClone(expert.playbook || expert.workflow || []),
        workflow: Shared.deepClone(expert.workflow || []),
        limitations: Shared.deepClone(expert.limitations || []),
        inputs: Shared.deepClone(expert.inputs || []),
        outputs: Shared.deepClone(expert.outputs || []),
        prompts: Shared.deepClone(expert.prompts || []),
        requiredSkills: Shared.deepClone(expert.requiredSkills || []),
        recommendedSkills: Shared.deepClone(expert.recommendedSkills || []),
        requiredWorkflows: Shared.deepClone(expert.requiredWorkflows || []),
        recommendedWorkflows: Shared.deepClone(expert.recommendedWorkflows || []),
        requiredConnectors: Shared.deepClone(expert.requiredConnectors || []),
        recommendedConnectors: Shared.deepClone(expert.recommendedConnectors || []),
        toolSelections: Shared.deepClone(expert.toolSelections || {}),
        inputSchema: expert.inputSchema || null,
        outputSchema: expert.outputSchema || null,
        members: Shared.deepClone(expert.members || []),
        nodes: Shared.deepClone(expert.nodes || []),
        orchestrator: expert.orchestrator || null,
        execution: Shared.deepClone(expert.execution || null),
        memberSnapshots: Shared.deepClone(expert.memberSnapshots || []),
      },
      capabilities: Shared.deepClone(capabilities),
      meteorologicalContext: Shared.deepClone(normalizedProject.spec.meteorologicalContext),
      assets: Shared.deepClone(normalizedProject.spec.assets),
      modelPolicy: {
        id: policy.modelPolicy,
        providerId: task.providerId || '',
        modelId: task.modelId || '',
      },
      permissionPolicy: {
        id: policy.permissionProfileId,
        requestedId: policy.requestedPermissionProfileId,
        workflowConstraints: Shared.deepClone(policy.workflowPermissionProfiles),
        workMode: policy.workMode,
        profile: Shared.deepClone(policy.permissionProfile),
      },
      workspaceGrant: {
        root: task.workspace || normalizedProject.workspace || '',
        access: normalizedProject.spec.workspaces[0]?.access || 'read-only',
      },
      outputContract: Shared.deepClone(normalizedProject.spec.outputs),
      memoryPolicy: {
        weatherFactsTtlHours: 168,
        preserveUserPreferences: true,
        preserveProjectDecisions: true,
      },
    };
    body.completionContract = compileCompletionContract(body);
    const hash = Shared.contentHash(body);
    const snapshot = { ...body, id: `ctx-${hash}`, hash };
    return Shared.deepFreeze(snapshot);
  }

  function runtimeEnvelope(snapshot) {
    return {
      contextSnapshotId: snapshot.id,
      contextSnapshotHash: snapshot.hash,
      workMode: snapshot.task.workMode,
      permissionPolicyId: snapshot.permissionPolicy.id,
      capabilities: {
        hash: snapshot.capabilities.id,
        grantMode: snapshot.capabilities.grantMode || 'inherit',
        skillIds: snapshot.capabilities.skills.map((item) => item.id),
        workflows: snapshot.capabilities.workflows.map((item) => ({
          id: item.id,
          version: item.version,
          digest: item.digest,
          role: item.role || 'selected',
        })),
        connectorIds: snapshot.capabilities.connectors.map((item) => item.id),
        toolSelections: Shared.deepClone(snapshot.capabilities.toolSelections || {}),
        connectorSources: Shared.deepClone(snapshot.capabilities.connectorSources || {}),
      },
      knowledgeSourceIds: Shared.uniqueStrings(snapshot.assets.knowledgeSources),
      meteorologicalContext: snapshot.meteorologicalContext,
      expectedOutputs: snapshot.task.expectedOutputs,
      expertTeam: snapshot.expert.kind === 'team'
        ? {
            id: snapshot.expert.id,
            orchestrator: snapshot.expert.orchestrator,
            nodes: Shared.deepClone(snapshot.expert.nodes),
          }
        : null,
      completionContract: Shared.deepClone(snapshot.completionContract),
    };
  }

  return {
    compileTaskContext,
    runtimeEnvelope,
    compileCompletionContract,
    promptRequiresArtifact,
    completionJsonSchema,
    completionRecipe,
    parseCompletionEnvelope,
    evaluateCompletion,
  };
});
