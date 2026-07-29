(function (root) {
  'use strict';

  const Harness = root.MeteoMateHarness.Workflow;
  const ui = {
    screen: 'library',
    mode: 'canvas',
    query: '',
    filter: 'all',
    selectedWorkflowId: null,
    selectedNodeId: null,
    selectedRunId: null,
    selectedRunNodeId: null,
    inspectorTab: 'settings',
    variableTargetId: null,
    runDrawerOpen: false,
    runDrawerTab: 'input',
    editingMetadata: false,
    paletteOpen: false,
    connectingFrom: null,
    contextMenu: null,
    viewport: { x: 40, y: 40, zoom: 1 },
    undoStack: [],
    redoStack: [],
    message: '',
    error: '',
  };

  function workflowState() {
    state.workflows = Array.isArray(state.workflows) ? state.workflows : [];
    state.workflowVersions = Array.isArray(state.workflowVersions) ? state.workflowVersions : [];
    state.workflowRuns = Array.isArray(state.workflowRuns) ? state.workflowRuns : [];
    return state;
  }

  function normalizeState() {
    const current = workflowState();
    if (current.view === 'workflows') {
      current.view = 'catalog';
      current.catalogTab = 'workflows';
    }
    current.workflows = current.workflows.map((workflow) => Harness.normalizeWorkflow(workflow));
    current.workflowVersions = current.workflowVersions.map((workflow) =>
      window.MeteoMateHarness.Shared.deepFreeze(
        Harness.normalizeWorkflow(workflow, {
          preserveDigest: true,
          migrateLegacyExperts: false,
        })
      )
    );
    current.workflowRuns = current.workflowRuns.slice(0, 120).map((run) => {
      if (!['running', 'waiting_input', 'waiting_approval'].includes(run.status)) return run;
      return { ...run, status: 'partial', finishedAt: run.finishedAt || Date.now() };
    });
  }

  function workflows() {
    workflowState();
    return state.workflows;
  }

  function versions() {
    workflowState();
    return state.workflowVersions;
  }

  function runs() {
    workflowState();
    return state.workflowRuns;
  }

  function publishedWorkflowCatalog() {
    const catalog = new Map();
    for (const workflow of [
      ...versions(),
      ...workflows().filter((item) => item.metadata.status === 'published'),
    ]) {
      if (workflow.spec?.nodes?.some((node) =>
        node.type === 'expert' || node.capability?.kind === 'Expert'
      )) continue;
      const key = `${workflow.metadata.id}@${workflow.metadata.version}`;
      if (!catalog.has(key)) catalog.set(key, workflow);
    }
    return [...catalog.values()];
  }

  function selectedWorkflow() {
    return workflows().find((workflow) => workflow.metadata.id === ui.selectedWorkflowId) || null;
  }

  function selectedRun() {
    return runs().find((run) => run.id === ui.selectedRunId) || null;
  }

  function selectedNode() {
    return selectedWorkflow()?.spec.nodes.find((node) => node.id === ui.selectedNodeId) || null;
  }

  function uniqueId(base) {
    const requested = String(base || 'workflow').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const existing = new Set(workflows().map((item) => item.metadata.id));
    if (!existing.has(requested)) return requested;
    let suffix = 2;
    while (existing.has(`${requested}-${suffix}`)) suffix += 1;
    return `${requested}-${suffix}`;
  }

  function createBlankWorkflow() {
    return Harness.normalizeWorkflow({
      metadata: {
        id: uniqueId('new-workflow'),
        name: '未命名工作流',
        version: '0.1.0',
        description: '描述这个流程解决什么业务问题。',
      },
      spec: {
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
        nodes: [
          {
            id: 'input',
            type: 'input',
            name: '业务输入',
            description: '声明运行这个流程需要的资料。',
            position: { x: 120, y: 220 },
          },
          {
            id: 'output',
            type: 'output',
            name: '交付结果',
            description: '定义工作流最终返回的结果。',
            position: { x: 460, y: 220 },
          },
        ],
        edges: [{ from: 'input.success', to: 'output.input' }],
      },
    });
  }

  function saveWorkflow(workflow, options = {}) {
    const normalized = Harness.normalizeWorkflow({
      ...workflow,
      updatedAt: Date.now(),
    });
    const index = workflows().findIndex((item) => item.metadata.id === normalized.metadata.id);
    if (index >= 0 && options.history !== false) {
      ui.undoStack.push({
        workflowId: normalized.metadata.id,
        snapshot: structuredClone(state.workflows[index]),
      });
      ui.undoStack = ui.undoStack.slice(-50);
      ui.redoStack = [];
    }
    if (index >= 0) state.workflows[index] = normalized;
    else state.workflows.unshift(normalized);
    ui.selectedWorkflowId = normalized.metadata.id;
    if (!options.quiet) ui.message = '草稿已保存';
    ui.error = '';
    saveState();
    return normalized;
  }

  function historyEntry(stack, workflowId) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].workflowId === workflowId) return stack.splice(index, 1)[0];
    }
    return null;
  }

  function restoreHistory(source, destination, message) {
    const workflow = selectedWorkflow();
    if (!workflow) return false;
    const entry = historyEntry(source, workflow.metadata.id);
    if (!entry) return false;
    destination.push({
      workflowId: workflow.metadata.id,
      snapshot: structuredClone(workflow),
    });
    const restored = Harness.normalizeWorkflow(entry.snapshot, { preserveDigest: true });
    const index = workflows().findIndex((item) => item.metadata.id === workflow.metadata.id);
    state.workflows[index] = restored;
    ui.selectedNodeId = restored.spec.nodes.some((node) => node.id === ui.selectedNodeId)
      ? ui.selectedNodeId
      : null;
    ui.message = message;
    ui.error = '';
    saveState();
    render();
    return true;
  }

  function undo() {
    return restoreHistory(ui.undoStack, ui.redoStack, '已撤销上一步');
  }

  function redo() {
    return restoreHistory(ui.redoStack, ui.undoStack, '已恢复上一步');
  }

  function openWorkflow(workflowId) {
    const workflow = workflows().find((item) => item.metadata.id === workflowId);
    if (!workflow) return;
    ui.selectedWorkflowId = workflow.metadata.id;
    ui.selectedNodeId = null;
    ui.selectedRunId = null;
    ui.selectedRunNodeId = null;
    ui.inspectorTab = 'settings';
    ui.variableTargetId = null;
    ui.runDrawerOpen = false;
    ui.runDrawerTab = 'input';
    ui.mode = workflow.spec.ui?.defaultMode || 'canvas';
    ui.screen = 'editor';
    ui.paletteOpen = false;
    ui.connectingFrom = null;
    ui.contextMenu = null;
    ui.undoStack = [];
    ui.redoStack = [];
    ui.viewport = { x: 40, y: 40, zoom: 1 };
    ui.message = '';
    ui.error = '';
    ui.editingMetadata = false;
    state.view = 'catalog';
    state.catalogTab = 'workflows';
    saveState();
    render();
  }

  function createWorkflow(templateId = 'blank') {
    const workflow = templateId === 'heavy-rain'
      ? Harness.createHeavyRainTemplate()
      : createBlankWorkflow();
    workflow.metadata.id = uniqueId(workflow.metadata.id);
    workflow.metadata.name = templateId === 'heavy-rain'
      ? workflow.metadata.name
      : '未命名工作流';
    workflow.digest = '';
    const saved = saveWorkflow(workflow, { quiet: true });
    openWorkflow(saved.metadata.id);
  }

  function closeEditor() {
    ui.screen = 'library';
    ui.selectedNodeId = null;
    ui.selectedRunId = null;
    ui.selectedRunNodeId = null;
    ui.runDrawerOpen = false;
    ui.paletteOpen = false;
    ui.connectingFrom = null;
    ui.contextMenu = null;
    ui.message = '';
    ui.error = '';
    ui.editingMetadata = false;
    render();
  }

  function markDraft(workflow) {
    if (workflow.metadata.status !== 'published') return workflow;
    return {
      ...workflow,
      metadata: {
        ...workflow.metadata,
        status: 'draft',
        revision: Number(workflow.metadata.revision || 1) + 1,
      },
      publishedAt: null,
    };
  }

  function updateWorkflowMetadata(patch) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const draft = markDraft(workflow);
    saveWorkflow({
      ...draft,
      metadata: {
        ...draft.metadata,
        ...patch,
      },
    });
    ui.editingMetadata = false;
  }

  function updateWorkflowSettings({ metadata = {}, policy = {} }) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const draft = markDraft(workflow);
    saveWorkflow({
      ...draft,
      metadata: {
        ...draft.metadata,
        ...metadata,
      },
      spec: {
        ...draft.spec,
        policy: {
          ...draft.spec.policy,
          ...policy,
        },
      },
    });
    ui.editingMetadata = false;
  }

  function updateNode(nodeId, patch) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const draft = markDraft(workflow);
    const nodes = draft.spec.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node
    );
    const saved = saveWorkflow({
      ...draft,
      spec: { ...draft.spec, nodes },
    }, { quiet: true });
    ui.selectedNodeId = nodeId;
    ui.message = '节点设置已保存';
    return saved;
  }

  function defaultNode(type, index) {
    const workflow = selectedWorkflow();
    const childWorkflow = publishedWorkflowCatalog()
      .find((item) => item.metadata.id !== workflow?.metadata.id);
    const existing = new Set(workflow?.spec.nodes.map((node) => node.id) || []);
    let sequence = index + 1;
    let id = `${type}-${sequence}`;
    while (existing.has(id)) {
      sequence += 1;
      id = `${type}-${sequence}`;
    }
    const labels = {
      input: '业务输入',
      trigger: '触发器',
      llm: '大模型',
      classifier: '问题分类',
      extractor: '参数提取',
      knowledge: '知识检索',
      document: '文档提取',
      tool: '工具调用',
      http: 'HTTP 请求',
      code: '代码执行',
      workflow: '子工作流',
      condition: '条件判断',
      iteration: '循环迭代',
      join: '汇合结果',
      transform: '数据转换',
      assign: '变量赋值',
      approval: '人工审批',
      template: '整理内容',
      delay: '延时等待',
      output: '交付结果',
    };
    const capability = type === 'tool'
      ? { kind: 'Tool', connectorId: 'local-workspace', toolName: '' }
      : type === 'workflow'
        ? {
            kind: 'Workflow',
            id: childWorkflow?.metadata.id || '',
            version: childWorkflow?.metadata.version || '',
          }
        : null;
    const configs = {
      trigger: { mode: 'manual' },
      llm: { model: '', prompt: '' },
      classifier: { model: '', classes: '', instruction: '' },
      extractor: { model: '', schema: '', instruction: '' },
      knowledge: { sourceId: '', query: '' },
      document: { source: '${input.files}' },
      http: {
        method: 'GET',
        url: '',
        authMode: 'none',
        credentialRef: '',
        headers: '',
        query: '',
        body: '',
        responseType: 'json',
      },
      code: { language: 'javascript', source: '' },
      condition: { expression: '' },
      iteration: { items: '${input.items}' },
      transform: { expression: '' },
      assign: { mapping: '' },
      template: { template: '' },
      delay: { seconds: 60 },
      approval: { assignee: 'workflow-owner' },
    };
    return Harness.normalizeNode({
      id,
      type,
      name: labels[type] || '新节点',
      capability,
      config: configs[type] || {},
      position: { x: 120 + (index % 5) * 280, y: 160 + Math.floor(index / 5) * 190 },
    }, index);
  }

  function addNode(type, options = {}) {
    const workflow = selectedWorkflow();
    if (!workflow || !Harness.NODE_TYPES.includes(type)) return;
    const draft = markDraft(workflow);
    const node = defaultNode(type, draft.spec.nodes.length);
    const selected = options.connectFromNodeId
      ? draft.spec.nodes.find((item) => item.id === options.connectFromNodeId)
      : selectedNode();
    if (options.position) {
      node.position = {
        x: Math.round(Number(options.position.x) || 0),
        y: Math.round(Number(options.position.y) || 0),
      };
    } else if (selected) {
      node.position = {
        x: selected.position.x + 280,
        y: selected.position.y,
      };
      while (draft.spec.nodes.some((item) =>
        Math.abs(item.position.x - node.position.x) < 80
        && Math.abs(item.position.y - node.position.y) < 80
      )) {
        node.position.y += 170;
      }
    }
    const edges = [...draft.spec.edges];
    const shouldConnect = selected
      && selected.type !== 'output'
      && !['input', 'trigger'].includes(node.type)
      && (!options.position || Boolean(options.connectFromNodeId));
    if (shouldConnect) {
      const fromPort = options.fromPort
        || (selected.type === 'approval' ? 'approved' : 'success');
      edges.push(Harness.normalizeEdge({
        from: `${selected.id}.${fromPort}`,
        to: `${node.id}.input`,
      }, edges.length));
    }
    saveWorkflow({
      ...draft,
      spec: {
        ...draft.spec,
        nodes: [...draft.spec.nodes, node],
        edges,
      },
    }, { quiet: true });
    ui.selectedNodeId = node.id;
    ui.paletteOpen = false;
    ui.contextMenu = null;
    ui.message = `已添加${node.name}`;
    render();
  }

  function moveNode(nodeId, position) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const draft = markDraft(workflow);
    saveWorkflow({
      ...draft,
      spec: {
        ...draft.spec,
        nodes: draft.spec.nodes.map((node) => node.id === nodeId
          ? {
              ...node,
              position: {
                x: Math.round(Math.max(-10_000, Math.min(10_000, Number(position.x) || 0))),
                y: Math.round(Math.max(-10_000, Math.min(10_000, Number(position.y) || 0))),
              },
            }
          : node),
      },
    }, { quiet: true });
    ui.selectedNodeId = nodeId;
  }

  function connectNodes(fromNodeId, toNodeId, fromPort = 'success') {
    const workflow = selectedWorkflow();
    if (!workflow || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return false;
    const fromNode = workflow.spec.nodes.find((node) => node.id === fromNodeId);
    const toNode = workflow.spec.nodes.find((node) => node.id === toNodeId);
    if (!fromNode || !toNode || fromNode.type === 'output' || ['input', 'trigger'].includes(toNode.type)) {
      ui.error = '这两个节点不能按当前方向连接';
      return false;
    }
    if (fromNode.type === 'condition' && !['true', 'false'].includes(fromPort)) {
      ui.error = '条件节点必须从“是”或“否”分支连接';
      return false;
    }
    if (fromNode.type === 'approval' && !['approved', 'rejected'].includes(fromPort)) {
      ui.error = '审批节点必须从“通过”或“驳回”分支连接';
      return false;
    }
    const adjacency = new Map(workflow.spec.nodes.map((node) => [node.id, []]));
    for (const edge of workflow.spec.edges) adjacency.get(edge.from.nodeId)?.push(edge.to.nodeId);
    const pending = [toNodeId];
    const visited = new Set(pending);
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      for (const next of adjacency.get(pending[cursor]) || []) {
        if (next === fromNodeId) {
          ui.error = '该连线会形成循环，已取消';
          return false;
        }
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    const duplicate = workflow.spec.edges.some((edge) =>
      edge.from.nodeId === fromNodeId
      && edge.from.port === fromPort
      && edge.to.nodeId === toNodeId
    );
    if (duplicate) {
      ui.message = '这两个节点已经连接';
      ui.connectingFrom = null;
      return false;
    }
    const draft = markDraft(workflow);
    const edge = Harness.normalizeEdge({
      id: `${fromNodeId}-${toNodeId}-${Date.now().toString(36)}`,
      from: `${fromNodeId}.${fromPort}`,
      to: `${toNodeId}.input`,
    }, draft.spec.edges.length);
    saveWorkflow({
      ...draft,
      spec: {
        ...draft.spec,
        edges: [...draft.spec.edges, edge],
      },
    }, { quiet: true });
    ui.connectingFrom = null;
    ui.selectedNodeId = toNodeId;
    ui.message = '节点已连接';
    ui.error = '';
    return true;
  }

  function removeEdge(edgeId) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const draft = markDraft(workflow);
    saveWorkflow({
      ...draft,
      spec: {
        ...draft.spec,
        edges: draft.spec.edges.filter((edge) => edge.id !== edgeId),
      },
    }, { quiet: true });
    ui.message = '连线已移除';
  }

  function setViewport(patch) {
    ui.viewport = {
      x: Number.isFinite(Number(patch.x)) ? Number(patch.x) : ui.viewport.x,
      y: Number.isFinite(Number(patch.y)) ? Number(patch.y) : ui.viewport.y,
      zoom: Math.max(0.35, Math.min(1.8, Number(patch.zoom) || ui.viewport.zoom)),
    };
  }

  function removeNode(nodeId) {
    const workflow = selectedWorkflow();
    const node = workflow?.spec.nodes.find((item) => item.id === nodeId);
    if (!workflow || !node || workflow.spec.nodes.length <= 1) return;
    const connected = workflow.spec.edges.filter((edge) =>
      edge.from.nodeId === nodeId || edge.to.nodeId === nodeId
    ).length;
    if (!confirm(`确定删除节点“${node.name}”吗？${connected ? `同时会移除 ${connected} 条连线。` : ''}`)) return;
    const draft = markDraft(workflow);
    saveWorkflow({
      ...draft,
      spec: {
        ...draft.spec,
        nodes: draft.spec.nodes.filter((item) => item.id !== nodeId),
        edges: draft.spec.edges.filter((edge) =>
          edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId
        ),
      },
    }, { quiet: true });
    ui.selectedNodeId = draft.spec.nodes.find((item) => item.id !== nodeId)?.id || null;
    ui.message = `已移除${node.name}`;
    render();
  }

  function nextPatchVersion(version) {
    const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return '1.0.0';
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }

  function publishSelected() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    try {
      const existing = versions().find((item) =>
        item.metadata.id === workflow.metadata.id
        && item.metadata.version === workflow.metadata.version
      );
      const version = existing && existing.digest !== workflow.digest
        ? nextPatchVersion(workflow.metadata.version)
        : workflow.metadata.version === '0.1.0' ? '1.0.0' : workflow.metadata.version;
      const published = Harness.publishWorkflow(workflow, {
        version,
        catalog: publishedWorkflowCatalog(),
      });
      const versionAlreadyRecorded = versions().some((item) =>
        item.metadata.id === published.metadata.id
        && item.metadata.version === published.metadata.version
      );
      if (!versionAlreadyRecorded) state.workflowVersions = [published, ...versions()];
      saveWorkflow(published, { quiet: true });
      ui.message = `已发布 ${published.metadata.version}`;
      ui.error = '';
      render();
    } catch (error) {
      ui.error = error?.message || '发布失败';
      ui.message = '';
      render();
    }
  }

  function openRunDrawer(runId = '') {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const run = runs().find((item) =>
      item.id === runId && item.workflowId === workflow.metadata.id
    );
    ui.selectedRunId = run?.id || null;
    ui.selectedRunNodeId = run?.nodeRuns?.find((item) => item.status === 'waiting_approval')?.nodeId
      || [...(run?.nodeRuns || [])].reverse().find((item) => item.status === 'completed')?.nodeId
      || run?.nodeRuns?.[0]?.nodeId
      || null;
    ui.runDrawerTab = run ? 'result' : 'input';
    ui.runDrawerOpen = true;
    ui.selectedNodeId = null;
    render();
  }

  function closeRunDrawer() {
    ui.runDrawerOpen = false;
    ui.selectedRunNodeId = null;
    render();
  }

  function runStructuralTest(inputs = {}) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    try {
      const run = Harness.createStructuralRun(workflow, {
        id: `workflow-run-${Date.now()}`,
        source: 'structural-test',
        inputs,
        catalog: publishedWorkflowCatalog(),
      });
      state.workflowRuns.unshift(run);
      state.workflowRuns = state.workflowRuns.slice(0, 120);
      ui.selectedRunId = run.id;
      ui.selectedRunNodeId = run.nodeRuns.find((item) => item.status === 'waiting_approval')?.nodeId
        || [...run.nodeRuns].reverse().find((item) => item.status === 'completed')?.nodeId
        || run.nodeRuns[0]?.nodeId
        || null;
      ui.runDrawerOpen = true;
      ui.runDrawerTab = 'result';
      ui.screen = 'editor';
      ui.error = '';
      ui.message = run.status === 'waiting_approval'
        ? '结构试跑等待审批'
        : '结构试跑已完成';
      saveState();
      render();
    } catch (error) {
      ui.error = error?.message || '结构试跑失败';
      ui.message = '';
      render();
    }
  }

  function approveSelectedRun(approved) {
    const run = selectedRun();
    if (!run || run.status !== 'waiting_approval') return;
    const workflow = workflows().find((item) => item.metadata.id === run.workflowId);
    if (!workflow) return;
    try {
      Harness.resolveStructuralApproval(workflow, run, {
        approved,
        at: Date.now(),
        catalog: publishedWorkflowCatalog(),
      });
      ui.message = approved
        ? run.status === 'waiting_approval'
          ? '当前审批已通过，等待下一项审批'
          : '审批通过，结构试跑已完成'
        : run.status === 'failed'
          ? '审批已驳回，结构试跑结束'
          : run.status === 'waiting_approval'
            ? '已进入驳回分支，等待下一项审批'
            : '已沿驳回分支完成结构试跑';
      ui.selectedRunNodeId = run.nodeRuns.find((item) => item.status === 'waiting_approval')?.nodeId
        || [...run.nodeRuns].reverse().find((item) => item.status === 'completed')?.nodeId
        || ui.selectedRunNodeId;
      ui.error = '';
    } catch (error) {
      ui.error = error?.message || '审批处理失败';
      ui.message = '';
    }
    saveState();
    render();
  }

  async function importWorkflow() {
    ui.error = '';
    try {
      const result = await root.meteoDesktop.importWorkflow();
      if (!result?.workflow) return;
      const validation = Harness.validateWorkflow(result.workflow, {
        catalog: publishedWorkflowCatalog(),
      });
      if (!validation.valid) throw new Error(validation.errors.join('；'));
      const imported = Harness.normalizeWorkflow({
        ...validation.definition,
        metadata: {
          ...validation.definition.metadata,
          status: 'draft',
          revision: Math.max(1, Number(validation.definition.metadata.revision) || 1),
        },
        publishedAt: null,
      });
      const conflict = workflows().find((item) => item.metadata.id === imported.metadata.id);
      if (conflict && conflict.digest !== imported.digest) {
        imported.metadata.id = uniqueId(imported.metadata.id);
        imported.metadata.name = `${imported.metadata.name}（导入）`;
      }
      const saved = saveWorkflow(imported, { quiet: true });
      ui.message = `已导入 ${saved.metadata.name}，请确认后发布`;
      openWorkflow(saved.metadata.id);
    } catch (error) {
      ui.error = error?.message || '导入失败';
      render();
    }
  }

  async function exportWorkflow() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    ui.error = '';
    try {
      const result = await root.meteoDesktop.exportWorkflow({
        workflow,
        suggestedName: `${workflow.metadata.id}.workflow.yml`,
      });
      if (result?.saved) ui.message = `已导出到 ${result.path}`;
    } catch (error) {
      ui.error = error?.message || '导出失败';
    }
    render();
  }

  function deleteSelected() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    if (!confirm(`确定删除工作流“${workflow.metadata.name}”吗？已生成的任务和运行记录不会删除。`)) return;
    state.workflows = workflows().filter((item) => item.metadata.id !== workflow.metadata.id);
    ui.selectedWorkflowId = null;
    ui.selectedNodeId = null;
    ui.screen = 'library';
    ui.message = '工作流已删除';
    saveState();
    render();
  }

  function onNavigate(view) {
    const viewingWorkflows = view === 'catalog' && state.catalogTab === 'workflows';
    if (viewingWorkflows && !ui.selectedWorkflowId) ui.screen = 'library';
    if (!viewingWorkflows) {
      ui.message = '';
      ui.error = '';
      ui.paletteOpen = false;
      ui.connectingFrom = null;
      ui.contextMenu = null;
      ui.runDrawerOpen = false;
    }
  }

  root.MeteoMateWorkflowCenter = {
    ui,
    normalizeState,
    workflows,
    versions,
    runs,
    publishedWorkflowCatalog,
    selectedWorkflow,
    selectedNode,
    selectedRun,
    saveWorkflow,
    undo,
    redo,
    openWorkflow,
    createWorkflow,
    closeEditor,
    updateWorkflowMetadata,
    updateWorkflowSettings,
    updateNode,
    addNode,
    removeNode,
    moveNode,
    connectNodes,
    removeEdge,
    setViewport,
    publishSelected,
    openRunDrawer,
    closeRunDrawer,
    runStructuralTest,
    approveSelectedRun,
    importWorkflow,
    exportWorkflow,
    deleteSelected,
    onNavigate,
  };
})(window);
