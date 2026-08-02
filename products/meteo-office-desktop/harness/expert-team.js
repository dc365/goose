(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Workflow = isNode ? require('./workflow') : root.MeteoMateHarness.Workflow;
  const api = factory(Workflow);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ExpertTeam = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Workflow) {
  'use strict';

  const MEMBER_STATUSES = Object.freeze([
    'pending',
    'running',
    'completed',
    'failed',
    'blocked',
    'cancelled',
    'interrupted',
  ]);
  const TIMELINE_LIMIT = 60;
  const RUN_HISTORY_LIMIT = 20;
  const SYNTHESIS_PROGRESS_LIMIT = 12_000;

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueStrings(value) {
    return [...new Set(list(value).map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function clipText(value, limit = 12_000) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n\n[内容已截断]`;
  }

  function runtimeOutputFailure(value) {
    const text = String(value || '');
    const markerIndex = text.search(/Ran into this error:\s*(?:Server error:\s*)?Failed to parse input(?: at pos \d+)?:?/i);
    if (markerIndex < 0) return null;
    const functionIndex = text.indexOf('<function=', markerIndex);
    if (functionIndex < 0 || functionIndex - markerIndex > 4_000) return null;
    return {
      code: 'tool_call_parse',
      message: '模型生成的工具调用格式无法解析，本次结果未被采纳。',
    };
  }

  function normalizeNode(node, index) {
    const embeddedExpert = node?.expert && typeof node.expert === 'object' ? node.expert : null;
    const expertId = String(embeddedExpert?.id || node?.expert || node?.expertId || '').trim();
    return {
      id: String(node?.id || expertId || `member-${index + 1}`).trim(),
      expert: expertId,
      embeddedExpert,
      dependsOn: uniqueStrings(node?.dependsOn),
      objective: String(node?.objective || node?.task || '').trim(),
    };
  }

  function fallbackNodes(team) {
    return uniqueStrings(team?.members).map((expert, index) => ({
      id: expert,
      expert,
      dependsOn: [],
      objective: '',
      order: index,
    }));
  }

  function normalizeDefinition(team = {}, experts = []) {
    if (team.kind !== 'team') throw new Error('专家团定义必须使用 kind=team');
    const expertIndex = new Map(list(experts).filter(Boolean).map((expert) => [expert.id, expert]));
    const sourceNodes = list(team.nodes).length
      ? team.nodes.map(normalizeNode)
      : fallbackNodes(team);
    if (!sourceNodes.length) throw new Error(`专家团“${team.name || team.id || '未命名'}”没有协作成员`);

    const nodeIds = new Set();
    const nodes = sourceNodes.map((node, index) => {
      if (!node.id) throw new Error(`专家团成员 ${index + 1} 缺少节点 ID`);
      if (nodeIds.has(node.id)) throw new Error(`专家团存在重复节点：${node.id}`);
      nodeIds.add(node.id);
      const expert = node.embeddedExpert || expertIndex.get(node.expert);
      if (!expert) throw new Error(`专家团节点“${node.id}”引用了不存在的专家：${node.expert}`);
      const { embeddedExpert, ...nodeDefinition } = node;
      return {
        ...nodeDefinition,
        order: index,
        expert: structuredClone(expert),
      };
    });

    for (const node of nodes) {
      for (const dependencyId of node.dependsOn) {
        if (!nodeIds.has(dependencyId)) {
          throw new Error(`专家团节点“${node.id}”依赖了不存在的节点：${dependencyId}`);
        }
        if (dependencyId === node.id) throw new Error(`专家团节点“${node.id}”不能依赖自身`);
      }
    }

    const definition = {
      id: String(team.id || '').trim(),
      kind: 'team',
      name: String(team.name || '').trim(),
      version: String(team.version || '1.0.0'),
      avatar: String(team.avatar || '团'),
      owner: String(team.owner || 'MeteoMate'),
      instruction: String(team.instruction || '').trim(),
      mission: String(team.mission || team.description || '').trim(),
      orchestrator: String(team.orchestrator || 'meteomate-team-lead'),
      execution: {
        strategy: 'dag',
        maxParallel: Math.max(1, Math.min(6, Number(team.execution?.maxParallel) || 3)),
        failurePolicy: team.execution?.failurePolicy === 'abort' ? 'abort' : 'continue',
      },
      nodes,
    };
    executionWaves(definition);
    return definition;
  }

  function executionWaves(definition = {}) {
    const nodes = list(definition.nodes);
    const pending = new Map(nodes.map((node) => [node.id, node]));
    const completed = new Set();
    const waves = [];
    const maxParallel = Math.max(1, Number(definition.execution?.maxParallel) || nodes.length || 1);

    while (pending.size) {
      const ready = [...pending.values()]
        .filter((node) => node.dependsOn.every((dependencyId) => completed.has(dependencyId)))
        .sort((left, right) => left.order - right.order);
      if (!ready.length) {
        throw new Error(`专家团“${definition.name || definition.id || '未命名'}”的执行图存在循环依赖`);
      }
      for (let index = 0; index < ready.length; index += maxParallel) {
        const wave = ready.slice(index, index + maxParallel);
        waves.push(wave);
        wave.forEach((node) => {
          pending.delete(node.id);
          completed.add(node.id);
        });
      }
    }
    return waves;
  }

  function createRunState(definition, input = {}) {
    const startedAt = input.startedAt || Date.now();
    return {
      id: input.id || `team-run-${startedAt}`,
      teamId: definition.id,
      teamName: definition.name,
      responseId: input.responseId || null,
      status: 'running',
      phase: 'dispatching',
      startedAt,
      completedAt: null,
      timeline: [],
      synthesis: {
        status: 'pending',
        text: '',
        startedAt: null,
        updatedAt: null,
        completedAt: null,
      },
      members: definition.nodes.map((node) => ({
        id: node.id,
        expertId: node.expert.id,
        name: node.expert.name,
        avatar: node.expert.avatar || node.expert.name?.slice(0, 1) || '专',
        objective: node.objective || node.expert.mission || node.expert.description || '',
        dependsOn: [...node.dependsOn],
        status: 'pending',
        sessionId: null,
        activatedAt: null,
        startedAt: null,
        completedAt: null,
        summary: '',
        detail: '',
        detailSource: '',
        detailUpdatedAt: null,
        error: '',
        activities: [],
        updates: [],
      })),
    };
  }

  function appendTimelineEntry(run, entry = {}, limit = TIMELINE_LIMIT) {
    if (!run || typeof run !== 'object') return null;
    const at = Number(entry.at || entry.updatedAt || entry.createdAt) || Date.now();
    const normalized = {
      id: String(entry.id || `team-event-${at}-${list(run.timeline).length + 1}`),
      key: String(entry.key || ''),
      type: String(entry.type || 'status'),
      memberId: entry.memberId ? String(entry.memberId) : null,
      actor: String(entry.actor || ''),
      title: String(entry.title || '协作状态更新'),
      detail: clipText(entry.detail || '', 600),
      status: String(entry.status || 'running'),
      at,
    };
    const timeline = list(run.timeline).filter((item) => item && typeof item === 'object');
    let replaceIndex = -1;
    if (normalized.key) {
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        if (timeline[index].key === normalized.key) {
          replaceIndex = index;
          break;
        }
      }
    }
    if (replaceIndex >= 0) {
      timeline[replaceIndex] = {
        ...timeline[replaceIndex],
        ...normalized,
        id: timeline[replaceIndex].id || normalized.id,
      };
    } else {
      timeline.push(normalized);
    }
    run.timeline = timeline.slice(-Math.max(1, Number(limit) || TIMELINE_LIMIT));
    return normalized;
  }

  function appendSynthesisProgress(run, chunk, options = {}) {
    if (!run || typeof run !== 'object') return null;
    const text = String(chunk || '');
    const at = Number(options.at) || Date.now();
    const limit = Math.max(12, Number(options.limit) || SYNTHESIS_PROGRESS_LIMIT);
    const current = run.synthesis && typeof run.synthesis === 'object'
      ? run.synthesis
      : {};
    let combined = `${current.text || ''}${text}`;
    if (combined.length > limit) {
      combined = `…\n\n${combined.slice(-(limit - 3))}`;
    }
    run.synthesis = {
      status: options.status || current.status || 'analyzing',
      text: combined,
      startedAt: Number(current.startedAt) || at,
      updatedAt: at,
      completedAt: current.completedAt || null,
    };
    return run.synthesis;
  }

  function settleSynthesis(run, status, at = Date.now()) {
    if (!run || typeof run !== 'object') return null;
    const completedAt = Number(at) || Date.now();
    run.synthesis = {
      ...(run.synthesis && typeof run.synthesis === 'object' ? run.synthesis : {}),
      status,
      updatedAt: completedAt,
      completedAt,
    };
    return run.synthesis;
  }

  function dependencyContext(node, results = new Map()) {
    return node.dependsOn
      .map((dependencyId) => results.get(dependencyId))
      .filter(Boolean)
      .map((result) => [
        `### ${result.name}`,
        `状态：${result.status}`,
        clipText(result.output || result.error || '未提供结果', 6_000),
      ].join('\n'))
      .join('\n\n');
  }

  function memberPrompt({ team, node, userPrompt, results }) {
    const dependencyResults = dependencyContext(node, results);
    return [
      `你是“${node.expert.name}”，正在参与“${team.name}”专家团。`,
      node.expert.instruction || '',
      `本次职责：${node.objective || node.expert.mission || node.expert.description || '完成分配给你的专业分析，并向负责人提交结果。'}`,
      '你只负责自己的专业环节，不要代替负责人汇总整个团队。',
      '结论必须区分事实、推断、不确定性与待验证项；不得虚构工具调用、数据或成果。',
      dependencyResults ? `以下是上游成员已经完成的交接结果：\n\n${dependencyResults}` : '',
      `团队收到的用户任务：${userPrompt}`,
      '请提交一份便于下游成员和负责人直接使用的交接结果，包括：完成内容、证据、结论、风险或缺口。',
    ].filter(Boolean).join('\n\n');
  }

  function synthesisPrompt({ team, userPrompt, results, firstTurn = false }) {
    const reports = team.nodes.map((node) => {
      const result = results.get(node.id) || {};
      return [
        `## ${node.expert.name}`,
        `状态：${result.status || 'blocked'}`,
        clipText(result.output || result.error || '该成员没有返回可用结果'),
      ].join('\n');
    }).join('\n\n');
    return [
      firstTurn
        ? `你是“${team.name}”的交付负责人，负责拆解任务、协调成员、保留分歧，并对最终交付负责。`
        : '继续以专家团交付负责人的身份处理本轮任务。',
      team.instruction,
      `用户任务：${userPrompt}`,
      `以下是各成员独立 Agent 的真实执行结果：\n\n${reports}`,
      '请综合成员结果形成最终答复。明确哪些成员已完成、哪些失败或受阻；保留关键证据、分歧、不确定性和待确认项。',
      '不要声称未发生的协作或工具调用。成员失败时仍应交付可用部分，并把失败原因列为 blocker。',
    ].filter(Boolean).join('\n\n');
  }

  function isTeamRequest(value) {
    return Boolean(value && value.kind === 'team' && list(value.nodes).length);
  }

  function toWorkflowDefinition(team) {
    return Workflow.legacyTeamToWorkflow(team);
  }

  return {
    MEMBER_STATUSES,
    TIMELINE_LIMIT,
    RUN_HISTORY_LIMIT,
    SYNTHESIS_PROGRESS_LIMIT,
    clipText,
    runtimeOutputFailure,
    normalizeDefinition,
    executionWaves,
    createRunState,
    appendTimelineEntry,
    appendSynthesisProgress,
    settleSynthesis,
    memberPrompt,
    synthesisPrompt,
    isTeamRequest,
    toWorkflowDefinition,
  };
});
