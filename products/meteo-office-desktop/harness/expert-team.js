(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ExpertTeam = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
      status: 'running',
      phase: 'dispatching',
      startedAt,
      completedAt: null,
      members: definition.nodes.map((node) => ({
        id: node.id,
        expertId: node.expert.id,
        name: node.expert.name,
        avatar: node.expert.avatar || node.expert.name?.slice(0, 1) || '专',
        objective: node.objective || node.expert.mission || node.expert.description || '',
        dependsOn: [...node.dependsOn],
        status: 'pending',
        sessionId: null,
        startedAt: null,
        completedAt: null,
        summary: '',
        detail: '',
        error: '',
      })),
    };
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

  return {
    MEMBER_STATUSES,
    clipText,
    normalizeDefinition,
    executionWaves,
    createRunState,
    memberPrompt,
    synthesisPrompt,
    isTeamRequest,
  };
});
