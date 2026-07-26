(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Shared = isNode ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.Workflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const NODE_TYPES = Object.freeze([
    'input',
    'trigger',
    'expert',
    'llm',
    'classifier',
    'extractor',
    'knowledge',
    'document',
    'tool',
    'http',
    'code',
    'workflow',
    'condition',
    'iteration',
    'join',
    'transform',
    'assign',
    'approval',
    'template',
    'delay',
    'output',
  ]);

  const RUN_STATUSES = Object.freeze([
    'queued',
    'running',
    'waiting_input',
    'waiting_approval',
    'completed',
    'partial',
    'failed',
    'cancelled',
  ]);

  const NODE_RUN_STATUSES = Object.freeze([
    'pending',
    'ready',
    'running',
    'waiting_approval',
    'completed',
    'skipped',
    'failed',
    'cancelled',
  ]);

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function idValue(value, fallback = '') {
    const normalized = String(value || fallback).trim();
    return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeCapability(capability) {
    const source = object(capability);
    if (!source.kind) return null;
    return {
      kind: String(source.kind),
      id: String(source.id || '').trim(),
      version: String(source.version || '').trim(),
      connectorId: String(source.connectorId || '').trim(),
      toolName: String(source.toolName || '').trim(),
    };
  }

  function normalizeNode(node = {}, index = 0) {
    const requestedType = String(node.type || '').trim();
    const type = requestedType || 'expert';
    const id = idValue(node.id, `${type}-${index + 1}`);
    return {
      id,
      type,
      name: String(node.name || node.title || id).trim(),
      description: String(node.description || '').trim(),
      capability: normalizeCapability(node.capability),
      skills: list(node.skills)
        .map((item) => typeof item === 'string'
          ? { id: item, version: '' }
          : { id: String(item?.id || '').trim(), version: String(item?.version || '').trim() })
        .filter((item) => item.id),
      inputs: Shared.deepClone(object(node.inputs)),
      outputs: Shared.deepClone(object(node.outputs)),
      config: Shared.deepClone(object(node.config)),
      retry: {
        maxAttempts: Shared.clampNumber(node.retry?.maxAttempts, 1, 5, 1),
        delaySeconds: Shared.clampNumber(node.retry?.delaySeconds, 0, 300, 0),
      },
      timeoutSeconds: Shared.clampNumber(node.timeoutSeconds, 1, 86_400, 900),
      onError: ['abort', 'continue'].includes(node.onError) ? node.onError : 'abort',
      position: {
        x: Shared.clampNumber(node.position?.x, -10_000, 10_000, index * 240),
        y: Shared.clampNumber(node.position?.y, -10_000, 10_000, 120),
      },
    };
  }

  function endpoint(value, defaultPort) {
    if (typeof value === 'string') {
      const [nodeId, ...portParts] = value.split('.');
      return { nodeId, port: portParts.join('.') || defaultPort };
    }
    const source = object(value);
    return {
      nodeId: String(source.nodeId || source.node || '').trim(),
      port: String(source.port || defaultPort).trim(),
    };
  }

  function normalizeEdge(edge = {}, index = 0) {
    const from = endpoint(edge.from, 'success');
    const to = endpoint(edge.to, 'input');
    return {
      id: idValue(edge.id, `edge-${index + 1}`),
      from,
      to,
      label: String(edge.label || '').trim(),
    };
  }

  function semanticDefinition(workflow) {
    const clone = Shared.deepClone(workflow);
    delete clone.digest;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.publishedAt;
    delete clone.ui;
    if (clone.metadata) {
      delete clone.metadata.status;
      delete clone.metadata.revision;
    }
    if (clone.spec) {
      delete clone.spec.ui;
      for (const node of clone.spec.nodes || []) delete node.position;
    }
    return clone;
  }

  function normalizeWorkflow(workflow = {}, options = {}) {
    const metadata = object(workflow.metadata);
    const spec = object(workflow.spec);
    const now = options.now || Date.now();
    const normalized = {
      apiVersion: workflow.apiVersion || 'meteomate.ai/v1alpha1',
      kind: workflow.kind || 'Workflow',
      metadata: {
        id: idValue(metadata.id || workflow.id, `workflow-${now.toString(36)}`),
        name: String(metadata.name || workflow.name || '未命名工作流').trim(),
        version: String(metadata.version || workflow.version || '0.1.0').trim(),
        description: String(metadata.description || workflow.description || '').trim(),
        tags: Shared.uniqueStrings(metadata.tags || workflow.tags),
        owner: String(metadata.owner || workflow.owner || 'MeteoMate 用户').trim(),
        visibility: ['private', 'organization', 'public'].includes(metadata.visibility)
          ? metadata.visibility
          : 'private',
        status: ['draft', 'published', 'disabled', 'archived'].includes(metadata.status)
          ? metadata.status
          : 'draft',
        revision: Math.max(1, Number(metadata.revision || workflow.revision) || 1),
      },
      spec: {
        inputSchema: Shared.deepClone(object(spec.inputSchema)),
        outputSchema: Shared.deepClone(object(spec.outputSchema)),
        policy: {
          permissionProfile: String(spec.policy?.permissionProfile || 'analysis-readonly'),
          maxParallel: Shared.clampNumber(spec.policy?.maxParallel, 1, 6, 3),
          timeoutSeconds: Shared.clampNumber(spec.policy?.timeoutSeconds, 1, 86_400, 1800),
          failurePolicy: spec.policy?.failurePolicy === 'continue' ? 'continue' : 'abort',
          maxWorkflowDepth: Shared.clampNumber(spec.policy?.maxWorkflowDepth, 1, 5, 3),
        },
        nodes: list(spec.nodes || workflow.nodes).map(normalizeNode),
        edges: list(spec.edges || workflow.edges).map(normalizeEdge),
        ui: {
          defaultMode: spec.ui?.defaultMode === 'steps' ? 'steps' : 'canvas',
          layout: Shared.deepClone(object(spec.ui?.layout)),
        },
      },
      createdAt: Number(workflow.createdAt) || now,
      updatedAt: Number(workflow.updatedAt) || now,
      publishedAt: workflow.publishedAt ? Number(workflow.publishedAt) : null,
    };
    const conditionNodeIds = new Set(
      normalized.spec.nodes.filter((node) => node.type === 'condition').map((node) => node.id)
    );
    normalized.spec.edges = normalized.spec.edges.map((edge) =>
      conditionNodeIds.has(edge.from.nodeId) && edge.from.port === 'success'
        ? { ...edge, from: { ...edge.from, port: 'true' } }
        : edge
    );
    normalized.digest = options.preserveDigest && workflow.digest
      ? String(workflow.digest)
      : Shared.contentHash(semanticDefinition(normalized));
    return normalized;
  }

  function graph(workflow) {
    const definition = normalizeWorkflow(workflow);
    const nodeIndex = new Map(definition.spec.nodes.map((node) => [node.id, node]));
    const incoming = new Map(definition.spec.nodes.map((node) => [node.id, []]));
    const outgoing = new Map(definition.spec.nodes.map((node) => [node.id, []]));
    for (const edge of definition.spec.edges) {
      if (incoming.has(edge.to.nodeId)) incoming.get(edge.to.nodeId).push(edge);
      if (outgoing.has(edge.from.nodeId)) outgoing.get(edge.from.nodeId).push(edge);
    }
    return { definition, nodeIndex, incoming, outgoing };
  }

  function executionWaves(workflow) {
    const { definition, nodeIndex, incoming, outgoing } = graph(workflow);
    const indegree = new Map(
      definition.spec.nodes.map((node) => [node.id, incoming.get(node.id).length])
    );
    const ready = definition.spec.nodes.filter((node) => indegree.get(node.id) === 0);
    const waves = [];
    let completed = 0;
    while (ready.length) {
      const wave = ready.splice(0, definition.spec.policy.maxParallel);
      waves.push(wave);
      completed += wave.length;
      for (const node of wave) {
        for (const edge of outgoing.get(node.id)) {
          const next = indegree.get(edge.to.nodeId) - 1;
          indegree.set(edge.to.nodeId, next);
          if (next === 0 && nodeIndex.has(edge.to.nodeId)) ready.push(nodeIndex.get(edge.to.nodeId));
        }
      }
    }
    if (completed !== definition.spec.nodes.length) {
      throw new Error(`工作流“${definition.metadata.name}”存在循环依赖`);
    }
    return waves;
  }

  function variableReferences(value) {
    const serialized = JSON.stringify(value || {});
    return [...serialized.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]);
  }

  function workflowCatalog(options = {}) {
    return list(options.catalog || options.workflows)
      .map((workflow) => normalizeWorkflow(workflow, { preserveDigest: true }));
  }

  function workflowKey(id, version) {
    return `${String(id || '').trim()}@${String(version || '').trim()}`;
  }

  function validateWorkflowDependencies(definition, options, errors) {
    const references = definition.spec.nodes.filter((node) => node.type === 'workflow');
    if (!references.length) return;
    const catalog = workflowCatalog(options);
    const published = new Map(
      catalog
        .filter((workflow) => workflow.metadata.status === 'published')
        .map((workflow) => [workflowKey(workflow.metadata.id, workflow.metadata.version), workflow])
    );
    const messages = new Set();
    const add = (message) => messages.add(message);

    for (const node of references) {
      if (!node.capability?.version) add(`子工作流节点“${node.name}”必须固定发布版本`);
      if (node.capability?.id === definition.metadata.id) {
        add(`子工作流节点“${node.name}”不能引用当前工作流`);
      }
    }

    const visit = (current, path, depth) => {
      if (depth > definition.spec.policy.maxWorkflowDepth) {
        add(`子工作流深度超过上限 ${definition.spec.policy.maxWorkflowDepth}`);
        return;
      }
      for (const node of current.spec.nodes.filter((item) => item.type === 'workflow')) {
        const id = node.capability?.id || '';
        const version = node.capability?.version || '';
        if (!id || !version) continue;
        const key = workflowKey(id, version);
        if (path.includes(key)) {
          add(`子工作流存在递归引用：${[...path, key].join(' → ')}`);
          continue;
        }
        const child = published.get(key);
        if (!child) {
          add(`子工作流不存在或未发布：${key}`);
          continue;
        }
        visit(child, [...path, key], depth + 1);
      }
    };

    visit(definition, [workflowKey(definition.metadata.id, definition.metadata.version)], 0);
    errors.push(...messages);
  }

  function validateJsonObjectField(node, key, errors) {
    const value = node.config?.[key];
    if (!value || typeof value !== 'string') return;
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push(`节点“${node.name}”的${key}必须是 JSON 对象`);
      }
    } catch {
      errors.push(`节点“${node.name}”的${key}不是合法 JSON`);
    }
  }

  function validateWorkflow(workflow, options = {}) {
    const definition = normalizeWorkflow(workflow);
    const errors = [];
    const warnings = [];
    if (definition.apiVersion !== 'meteomate.ai/v1alpha1') {
      errors.push(`不支持的工作流版本：${definition.apiVersion}`);
    }
    if (definition.kind !== 'Workflow') errors.push(`工作流 kind 必须是 Workflow`);
    if (!definition.metadata.id) errors.push('工作流缺少 ID');
    if (!definition.metadata.name) errors.push('工作流缺少名称');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(definition.metadata.version)) {
      errors.push('工作流版本必须使用 SemVer，例如 1.0.0');
    }
    if (!['analysis-readonly', 'artifact-approval', 'trusted-workspace', 'workspace-approval']
      .includes(definition.spec.policy.permissionProfile)) {
      errors.push(`不支持的权限策略：${definition.spec.policy.permissionProfile}`);
    }
    if (!definition.spec.nodes.length) errors.push('工作流至少需要一个节点');
    const nodeIds = new Set();
    const nodeIndex = new Map();
    for (const node of definition.spec.nodes) {
      if (nodeIds.has(node.id)) errors.push(`节点 ID 重复：${node.id}`);
      nodeIds.add(node.id);
      nodeIndex.set(node.id, node);
      if (!NODE_TYPES.includes(node.type)) errors.push(`节点“${node.name}”类型不受支持`);
      if (['expert', 'tool', 'workflow'].includes(node.type) && !node.capability) {
        errors.push(`节点“${node.name}”缺少能力引用`);
      }
      if (node.type === 'expert' && node.capability?.kind !== 'Expert') {
        errors.push(`节点“${node.name}”必须引用 Expert 能力`);
      }
      if (node.type === 'tool' && node.capability?.kind !== 'Tool') {
        errors.push(`节点“${node.name}”必须引用 Tool 能力`);
      }
      if (node.type === 'workflow' && node.capability?.kind !== 'Workflow') {
        errors.push(`节点“${node.name}”必须引用 Workflow 能力`);
      }
      if (node.type === 'expert' && !node.capability?.id) errors.push(`节点“${node.name}”缺少专家 ID`);
      if (node.type === 'workflow' && !node.capability?.id) errors.push(`节点“${node.name}”缺少工作流 ID`);
      if (node.type === 'tool' && (!node.capability?.connectorId || !node.capability?.toolName)) {
        errors.push(`节点“${node.name}”缺少工具服务或工具名称`);
      }
      if (node.type === 'http' && !node.config?.url) errors.push(`节点“${node.name}”缺少请求 URL`);
      if (node.type === 'http' && node.config?.url && !/^https?:\/\//i.test(node.config.url)) {
        errors.push(`节点“${node.name}”只允许 HTTP 或 HTTPS URL`);
      }
      if (node.type === 'http' && /^https?:\/\/[^/@]+@/i.test(node.config?.url || '')) {
        errors.push(`节点“${node.name}”不能在 URL 中写入用户名或密码`);
      }
      if (node.type === 'http' && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
        .includes(String(node.config?.method || 'GET').toUpperCase())) {
        errors.push(`节点“${node.name}”使用了不支持的 HTTP 方法`);
      }
      if (node.type === 'http' && !['none', 'credential'].includes(node.config?.authMode || 'none')) {
        errors.push(`节点“${node.name}”使用了不支持的认证方式`);
      }
      if (node.type === 'http' && !['json', 'text', 'binary'].includes(node.config?.responseType || 'json')) {
        errors.push(`节点“${node.name}”使用了不支持的响应格式`);
      }
      if (node.type === 'http' && node.config?.authMode === 'credential' && !node.config?.credentialRef) {
        errors.push(`节点“${node.name}”缺少凭据引用 ID`);
      }
      if (node.type === 'http') {
        validateJsonObjectField(node, 'headers', errors);
        validateJsonObjectField(node, 'query', errors);
      }
      if (node.type === 'condition' && !node.config?.expression) {
        errors.push(`节点“${node.name}”缺少判断表达式`);
      }
      if (node.type === 'classifier' && !node.config?.classes) {
        warnings.push(`节点“${node.name}”尚未配置分类标签`);
      }
      if (node.type === 'extractor' && !node.config?.schema) {
        warnings.push(`节点“${node.name}”尚未配置输出 Schema`);
      }
    }
    const edgeIds = new Set();
    const edgeKeys = new Set();
    const incoming = new Map(definition.spec.nodes.map((node) => [node.id, []]));
    const outgoing = new Map(definition.spec.nodes.map((node) => [node.id, []]));
    for (const edge of definition.spec.edges) {
      if (edgeIds.has(edge.id)) errors.push(`连线 ID 重复：${edge.id}`);
      edgeIds.add(edge.id);
      const edgeKey = `${edge.from.nodeId}.${edge.from.port}->${edge.to.nodeId}.${edge.to.port}`;
      if (edgeKeys.has(edgeKey)) errors.push(`连线重复：${edgeKey}`);
      edgeKeys.add(edgeKey);
      if (!nodeIds.has(edge.from.nodeId)) errors.push(`连线引用了不存在的起点：${edge.from.nodeId}`);
      if (!nodeIds.has(edge.to.nodeId)) errors.push(`连线引用了不存在的终点：${edge.to.nodeId}`);
      if (edge.from.nodeId === edge.to.nodeId) errors.push(`节点“${edge.from.nodeId}”不能连接自身`);
      if (outgoing.has(edge.from.nodeId)) outgoing.get(edge.from.nodeId).push(edge);
      if (incoming.has(edge.to.nodeId)) incoming.get(edge.to.nodeId).push(edge);
      const fromNode = nodeIndex.get(edge.from.nodeId);
      if (fromNode?.type === 'condition' && !['true', 'false'].includes(edge.from.port)) {
        errors.push(`条件节点“${fromNode.name}”只能从“是”或“否”分支连线`);
      }
      if (fromNode?.type === 'approval' && !['approved', 'rejected'].includes(edge.from.port)) {
        errors.push(`审批节点“${fromNode.name}”只能从“通过”或“驳回”分支连线`);
      }
    }

    const starts = definition.spec.nodes.filter((node) => ['input', 'trigger'].includes(node.type));
    const outputs = definition.spec.nodes.filter((node) => node.type === 'output');
    if (!starts.length) errors.push('工作流至少需要一个 Input 或 Trigger 节点');
    if (!outputs.length) errors.push('工作流至少需要一个 Output 节点');
    for (const node of starts) {
      if (incoming.get(node.id).length) errors.push(`入口节点“${node.name}”不能有上游连线`);
    }
    for (const node of outputs) {
      if (outgoing.get(node.id).length) errors.push(`输出节点“${node.name}”不能有下游连线`);
    }
    for (const node of definition.spec.nodes.filter((item) => item.type === 'condition')) {
      const ports = new Set(outgoing.get(node.id).map((edge) => edge.from.port));
      if (!ports.has('true') || !ports.has('false')) {
        errors.push(`条件节点“${node.name}”必须同时连接“是”和“否”分支`);
      }
    }

    const walk = (seedIds, adjacency, selectNext) => {
      const visited = new Set(seedIds);
      const queue = [...seedIds];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        for (const edge of adjacency.get(current) || []) {
          const next = selectNext(edge);
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      return visited;
    };
    const reachable = walk(starts.map((node) => node.id), outgoing, (edge) => edge.to.nodeId);
    const reachesOutput = walk(outputs.map((node) => node.id), incoming, (edge) => edge.from.nodeId);
    for (const node of definition.spec.nodes) {
      if (starts.length && !reachable.has(node.id)) errors.push(`节点“${node.name}”无法从入口到达`);
      if (outputs.length && !reachesOutput.has(node.id)) errors.push(`节点“${node.name}”无法到达输出`);
    }

    const canReach = (fromId, toId) => {
      if (fromId === toId) return true;
      return walk([fromId], outgoing, (edge) => edge.to.nodeId).has(toId);
    };
    for (const node of definition.spec.nodes) {
      for (const reference of variableReferences({
        inputs: node.inputs,
        outputs: node.outputs,
        config: node.config,
      })) {
        const match = reference.match(/^nodes\.([^.]+)\.outputs(?:\.|$)/);
        if (!match) continue;
        if (!nodeIds.has(match[1])) {
          errors.push(`节点“${node.name}”引用了不存在的节点：${match[1]}`);
        } else if (match[1] === node.id) {
          errors.push(`节点“${node.name}”不能引用自身尚未生成的输出`);
        } else if (!canReach(match[1], node.id)) {
          errors.push(`节点“${node.name}”引用的“${match[1]}”不是其上游节点`);
        }
      }
    }
    validateWorkflowDependencies(definition, options, errors);
    if (!errors.length) {
      try {
        executionWaves(definition);
      } catch (error) {
        errors.push(error.message);
      }
    }
    return { valid: errors.length === 0, errors, warnings, definition };
  }

  function publishWorkflow(workflow, options = {}) {
    const result = validateWorkflow(workflow, options);
    if (!result.valid) {
      const error = new Error(result.errors.join('；'));
      error.code = 'WORKFLOW_INVALID';
      error.validation = result;
      throw error;
    }
    const now = options.now || Date.now();
    const published = normalizeWorkflow({
      ...result.definition,
      metadata: {
        ...result.definition.metadata,
        version: String(options.version || result.definition.metadata.version || '1.0.0'),
        status: 'published',
        revision: Math.max(1, Number(result.definition.metadata.revision) || 1),
      },
      publishedAt: now,
      updatedAt: now,
    }, { now });
    return Shared.deepFreeze(published);
  }

  function createRun(workflow, input = {}) {
    const result = validateWorkflow(workflow, input);
    if (!result.valid) {
      const error = new Error(result.errors.join('；'));
      error.code = 'WORKFLOW_INVALID';
      error.validation = result;
      throw error;
    }
    const now = input.startedAt || Date.now();
    const waves = executionWaves(result.definition);
    const firstWave = new Set((waves[0] || []).map((node) => node.id));
    return {
      apiVersion: 'meteomate.ai/v1alpha1',
      kind: 'WorkflowRun',
      id: input.id || Shared.createId('workflow-run'),
      workflowId: result.definition.metadata.id,
      workflowVersion: result.definition.metadata.version,
      workflowDigest: result.definition.digest,
      workflowName: result.definition.metadata.name,
      invocation: {
        source: input.source || 'manual',
        parentRunId: input.parentRunId || null,
        parentNodeId: input.parentNodeId || null,
        depth: Math.max(0, Number(input.depth) || 0),
      },
      taskId: input.taskId || null,
      status: 'running',
      inputs: Shared.deepClone(object(input.inputs)),
      outputs: {},
      startedAt: now,
      finishedAt: null,
      nodeRuns: result.definition.spec.nodes.map((node) => ({
        id: `${input.id || 'run'}:${node.id}`,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: firstWave.has(node.id) ? 'ready' : 'pending',
        attempt: 0,
        inputs: {},
        outputs: {},
        error: '',
        startedAt: null,
        finishedAt: null,
      })),
      events: [{
        id: Shared.createId('workflow-event'),
        type: 'workflow.started',
        at: now,
        detail: `开始运行 ${result.definition.metadata.name}`,
      }],
    };
  }

  function structuralCursor(run, requestedAt) {
    const latest = run.nodeRuns.reduce(
      (value, nodeRun) => Math.max(value, Number(nodeRun.finishedAt || nodeRun.startedAt || 0)),
      Number(run.startedAt || 0)
    );
    return Math.max(latest, Number(requestedAt) || latest);
  }

  function advanceStructuralRun(workflow, run, options = {}) {
    const validation = validateWorkflow(workflow, options);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (validation.definition.digest !== run.workflowDigest) {
      throw new Error('工作流定义已变化，请重新开始结构试跑');
    }
    const waves = executionWaves(validation.definition);
    let cursor = structuralCursor(run, options.at);
    for (const wave of waves) {
      const waveRuns = wave.map((node) => ({
        node,
        nodeRun: run.nodeRuns.find((item) => item.nodeId === node.id),
      }));
      if (waveRuns.some(({ nodeRun }) => nodeRun?.status === 'waiting_approval')) {
        run.status = 'waiting_approval';
        run.finishedAt = null;
        return run;
      }
      for (const { node, nodeRun } of waveRuns) {
        if (!nodeRun || ['completed', 'skipped'].includes(nodeRun.status)) continue;
        nodeRun.attempt = Math.max(1, Number(nodeRun.attempt) || 0);
        nodeRun.startedAt = nodeRun.startedAt || cursor;
        if (node.type === 'approval') {
          nodeRun.status = 'waiting_approval';
          nodeRun.finishedAt = null;
          nodeRun.outputs = {};
          run.events.push({
            id: Shared.createId('workflow-event'),
            type: 'node.waiting_approval',
            nodeId: node.id,
            at: nodeRun.startedAt,
            detail: `${node.name}等待审批`,
          });
        } else {
          nodeRun.status = 'completed';
          nodeRun.finishedAt = nodeRun.startedAt + 180 + (node.id.length * 17);
          nodeRun.outputs = node.type === 'output'
            ? { valid: true }
            : { preview: `${node.name} 的结构校验通过` };
          run.events.push({
            id: Shared.createId('workflow-event'),
            type: 'node.completed',
            nodeId: node.id,
            at: nodeRun.finishedAt,
            detail: `${node.name}结构校验通过`,
          });
        }
        cursor += 240;
      }
      if (waveRuns.some(({ nodeRun }) => nodeRun?.status === 'waiting_approval')) {
        run.status = 'waiting_approval';
        run.finishedAt = null;
        return run;
      }
    }
    run.status = 'completed';
    run.finishedAt = cursor;
    run.outputs = { valid: true };
    return run;
  }

  function resolveStructuralApproval(workflow, run, options = {}) {
    if (run.status !== 'waiting_approval') return run;
    const validation = validateWorkflow(workflow, options);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (validation.definition.digest !== run.workflowDigest) {
      throw new Error('工作流定义已变化，请重新开始结构试跑');
    }
    const approval = run.nodeRuns.find((nodeRun) =>
      nodeRun.status === 'waiting_approval'
      && (!options.nodeId || nodeRun.nodeId === options.nodeId)
    );
    if (!approval) throw new Error('没有可处理的审批节点');
    const approved = options.approved === true;
    const now = Number(options.at) || Date.now();
    const { outgoing } = graph(validation.definition);
    const selectedPort = approved ? 'approved' : 'rejected';
    const unselectedPort = approved ? 'rejected' : 'approved';
    const selectedStarts = outgoing.get(approval.nodeId)
      .filter((edge) => edge.from.port === selectedPort)
      .map((edge) => edge.to.nodeId);
    const unselectedStarts = outgoing.get(approval.nodeId)
      .filter((edge) => edge.from.port === unselectedPort)
      .map((edge) => edge.to.nodeId);
    const reachableFrom = (startIds) => {
      const reachable = new Set(startIds);
      const queue = [...startIds];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        for (const edge of outgoing.get(queue[cursor]) || []) {
          if (reachable.has(edge.to.nodeId)) continue;
          reachable.add(edge.to.nodeId);
          queue.push(edge.to.nodeId);
        }
      }
      return reachable;
    };
    const selectedReachable = reachableFrom(selectedStarts);
    const unselectedReachable = reachableFrom(unselectedStarts);
    for (const nodeId of unselectedReachable) {
      if (selectedReachable.has(nodeId)) continue;
      const nodeRun = run.nodeRuns.find((item) => item.nodeId === nodeId);
      if (!nodeRun || !['pending', 'ready'].includes(nodeRun.status)) continue;
      nodeRun.status = 'skipped';
      nodeRun.finishedAt = now;
    }
    const followsRejectedBranch = !approved && selectedStarts.length > 0;
    approval.status = approved || followsRejectedBranch ? 'completed' : 'failed';
    approval.finishedAt = now;
    approval.outputs = { decision: approved ? 'approved' : 'rejected' };
    run.events.push({
      id: Shared.createId('workflow-event'),
      type: approved ? 'approval.approved' : 'approval.rejected',
      nodeId: approval.nodeId,
      at: now,
      detail: approved
        ? '用户批准，进入通过分支'
        : followsRejectedBranch ? '用户驳回，进入驳回分支' : '用户驳回并结束运行',
    });
    if (!approved && !followsRejectedBranch) {
      for (const nodeRun of run.nodeRuns) {
        if (['pending', 'ready', 'waiting_approval'].includes(nodeRun.status)) {
          nodeRun.status = 'cancelled';
          nodeRun.finishedAt = now;
        }
      }
      run.status = 'failed';
      run.finishedAt = now;
      return run;
    }
    if (run.nodeRuns.some((nodeRun) => nodeRun.status === 'waiting_approval')) return run;
    return advanceStructuralRun(workflow, run, { ...options, at: now });
  }

  function createStructuralRun(workflow, input = {}) {
    const run = createRun(workflow, input);
    return advanceStructuralRun(workflow, run, input);
  }

  function legacyTeamToWorkflow(team = {}) {
    const nodes = list(team.nodes).map((node, index) => normalizeNode({
      id: node.id || node.expert,
      type: 'expert',
      name: node.name || node.objective || node.expert,
      description: node.objective || '',
      capability: {
        kind: 'Expert',
        id: typeof node.expert === 'object' ? node.expert.id : node.expert,
        version: typeof node.expert === 'object' ? node.expert.version : '',
      },
      position: { x: index * 240, y: 120 },
    }, index));
    const edges = [];
    const roots = list(team.nodes).filter((node) => !list(node.dependsOn).length);
    for (const node of list(team.nodes)) {
      for (const dependencyId of list(node.dependsOn)) {
        edges.push(normalizeEdge({
          id: `${dependencyId}-${node.id}`,
          from: `${dependencyId}.success`,
          to: `${node.id}.input`,
        }, edges.length));
      }
    }
    nodes.unshift(normalizeNode({
      id: 'team-input',
      type: 'input',
      name: '团队输入',
      position: { x: -240, y: 120 },
    }));
    roots.forEach((node) => edges.push(normalizeEdge({
      from: 'team-input.success',
      to: `${node.id}.input`,
    }, edges.length)));
    const leaves = nodes
      .filter((node) => node.type === 'expert')
      .filter((node) => !edges.some((edge) => edge.from.nodeId === node.id));
    nodes.push(normalizeNode({
      id: 'team-output',
      type: 'output',
      name: '汇总交付',
      outputs: {
        summary: leaves[0] ? `\${nodes.${leaves[0].id}.outputs.result}` : '',
        results: leaves.map((node) => `\${nodes.${node.id}.outputs.result}`),
      },
      position: { x: Math.max(1, nodes.length) * 240, y: 120 },
    }, nodes.length));
    leaves.forEach((node) => edges.push(normalizeEdge({
      from: `${node.id}.success`,
      to: 'team-output.input',
    }, edges.length)));
    return normalizeWorkflow({
      metadata: {
        id: `team-${idValue(team.id || team.name, 'legacy')}`,
        name: team.name || '历史专家团',
        version: team.version || '1.0.0',
        description: team.mission || team.description || '',
        status: 'published',
      },
      spec: {
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        policy: {
          maxParallel: team.execution?.maxParallel || 3,
          failurePolicy: team.execution?.failurePolicy || 'continue',
        },
        nodes,
        edges,
      },
    });
  }

  function legacyAutomationToWorkflow(automation = {}) {
    const template = object(automation.taskTemplate);
    return normalizeWorkflow({
      metadata: {
        id: `automation-${idValue(automation.id || automation.name, 'legacy')}`,
        name: automation.name || '历史自动化',
        version: '1.0.0',
        description: '由旧定时任务兼容转换',
        status: 'published',
      },
      spec: {
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        policy: { permissionProfile: template.permissionProfileId || 'analysis-readonly' },
        nodes: [
          {
            id: 'automation-trigger',
            type: 'trigger',
            name: '自动化触发',
            config: { mode: 'schedule' },
          },
          {
            id: 'scheduled-task',
            type: 'expert',
            name: automation.name || '定时任务',
            description: template.prompt || '',
            capability: { kind: 'Expert', id: template.expertId || '' },
            skills: list(template.skillIds),
            inputs: { prompt: template.prompt || '' },
          },
          {
            id: 'finish',
            type: 'output',
            name: '交付结果',
            outputs: { result: '${nodes.scheduled-task.outputs.result}' },
          },
        ],
        edges: [
          { from: 'automation-trigger.success', to: 'scheduled-task.input' },
          { from: 'scheduled-task.success', to: 'finish.input' },
        ],
      },
    });
  }

  function createHeavyRainTemplate() {
    const expertNode = (id, name, expertId, x, y, description) => ({
      id,
      type: 'expert',
      name,
      description,
      capability: { kind: 'Expert', id: expertId, version: '1.0.0' },
      position: { x, y },
    });
    return normalizeWorkflow({
      metadata: {
        id: 'daily-heavy-rain-product',
        name: '每日短临强降水产品',
        version: '0.1.0',
        description: '资料检查、专家并行研判、质量审核、人工审批和多格式交付。',
        tags: ['短临', '强降水', '业务产品'],
      },
      spec: {
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', title: '预报区域' },
            forecastDate: { type: 'string', format: 'date', title: '预报日期' },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            report: { type: 'object' },
            summary: { type: 'string' },
          },
        },
        policy: {
          permissionProfile: 'artifact-approval',
          maxParallel: 3,
          failurePolicy: 'abort',
        },
        nodes: [
          {
            id: 'input',
            type: 'input',
            name: '业务输入',
            description: '预报区域、时次和需要使用的资料。',
            position: { x: 40, y: 180 },
          },
          expertNode('data-check', '资料检查', 'data-expert', 280, 180, '检查雷达、实况和数值预报资料完整性。'),
          expertNode('situation', '形势分析', 'synoptic-expert', 520, 180, '识别影响系统和未来演变。'),
          expertNode('heavy-rain', '强降水研判', 'heavy-rain-expert', 760, 80, '评估落区、强度、持续时间和证据。'),
          expertNode('convection', '强对流研判', 'convection-expert', 760, 280, '评估触发条件、风险类型和影响。'),
          expertNode('quality-review', '汇总与 QA', 'writing-expert', 1000, 180, '汇总结论，核对证据、事实和业务表达。'),
          {
            id: 'approval',
            type: 'approval',
            name: '人工审批',
            description: '由工作流负责人确认最终产品。',
            config: { assignee: 'workflow-owner', timeoutSeconds: 86400 },
            position: { x: 1240, y: 180 },
          },
          {
            id: 'report',
            type: 'tool',
            name: '生成 Word / PDF / Web',
            description: '生成业务产品并登记成果血缘。',
            capability: {
              kind: 'Tool',
              connectorId: 'office-artifacts',
              toolName: 'artifact_create',
            },
            position: { x: 1480, y: 180 },
          },
          {
            id: 'output',
            type: 'output',
            name: '交付产品',
            outputs: {
              report: '${nodes.report.outputs.artifact}',
              summary: '${nodes.quality-review.outputs.summary}',
            },
            position: { x: 1720, y: 180 },
          },
        ],
        edges: [
          { from: 'input.success', to: 'data-check.input' },
          { from: 'data-check.success', to: 'situation.input' },
          { from: 'situation.success', to: 'heavy-rain.input' },
          { from: 'situation.success', to: 'convection.input' },
          { from: 'heavy-rain.success', to: 'quality-review.input' },
          { from: 'convection.success', to: 'quality-review.input' },
          { from: 'quality-review.success', to: 'approval.input' },
          { from: 'approval.approved', to: 'report.input' },
          { from: 'report.success', to: 'output.input' },
        ],
        ui: { defaultMode: 'canvas', layout: { direction: 'horizontal' } },
      },
    });
  }

  return {
    NODE_TYPES,
    RUN_STATUSES,
    NODE_RUN_STATUSES,
    normalizeNode,
    normalizeEdge,
    normalizeWorkflow,
    validateWorkflow,
    publishWorkflow,
    executionWaves,
    createRun,
    createStructuralRun,
    advanceStructuralRun,
    resolveStructuralApproval,
    legacyTeamToWorkflow,
    legacyAutomationToWorkflow,
    createHeavyRainTemplate,
  };
});
