(function (root) {
  'use strict';

  const api = root.MeteoMateWorkflowCenter;
  const Harness = root.MeteoMateHarness.Workflow;

  const nodeMeta = Object.freeze({
    input: { label: '业务输入', mark: '入', tone: 'input' },
    trigger: { label: '触发器', mark: '启', tone: 'input' },
    expert: { label: '专家任务', mark: '专', tone: 'expert' },
    llm: { label: '大模型', mark: '模', tone: 'model' },
    classifier: { label: '问题分类', mark: '分', tone: 'model' },
    extractor: { label: '参数提取', mark: '取', tone: 'model' },
    knowledge: { label: '知识检索', mark: '知', tone: 'data' },
    document: { label: '文档提取', mark: '文', tone: 'data' },
    tool: { label: '工具调用', mark: '工', tone: 'tool' },
    http: { label: 'HTTP 请求', mark: '网', tone: 'tool' },
    code: { label: '代码执行', mark: '码', tone: 'tool' },
    workflow: { label: '子工作流', mark: '流', tone: 'workflow' },
    condition: { label: '条件判断', mark: '判', tone: 'condition' },
    iteration: { label: '循环迭代', mark: '循', tone: 'condition' },
    join: { label: '汇合结果', mark: '合', tone: 'control' },
    transform: { label: '数据转换', mark: '转', tone: 'data' },
    assign: { label: '变量赋值', mark: '赋', tone: 'data' },
    approval: { label: '人工审批', mark: '审', tone: 'approval' },
    template: { label: '整理内容', mark: '整', tone: 'control' },
    delay: { label: '延时等待', mark: '等', tone: 'control' },
    output: { label: '交付结果', mark: '出', tone: 'output' },
  });

  const nodeGroups = Object.freeze([
    ['开始', ['input', 'trigger']],
    ['智能', ['expert', 'llm', 'classifier', 'extractor', 'knowledge']],
    ['数据', ['document', 'transform', 'assign']],
    ['执行', ['tool', 'http', 'code', 'workflow']],
    ['逻辑', ['condition', 'iteration', 'join']],
    ['控制', ['approval', 'template', 'delay']],
    ['交付', ['output']],
  ]);

  function nodeTypeMeta(type) {
    return nodeMeta[type] || { label: type || '未知节点', mark: '?', tone: 'control' };
  }

  function statusLabel(status) {
    return {
      draft: '草稿',
      published: '已发布',
      disabled: '已停用',
      archived: '已归档',
      ready: '待运行',
      pending: '等待',
      running: '运行中',
      waiting_approval: '等待审批',
      completed: '已完成',
      failed: '失败',
      skipped: '已跳过',
      cancelled: '已取消',
      partial: '部分完成',
    }[status] || status;
  }

  function renderFeedback() {
    if (api.ui.error) {
      return `<div class="workflow-feedback error" role="alert">${icon('warning')}<span>${escapeHtml(api.ui.error)}</span></div>`;
    }
    if (api.ui.message) {
      return `<div class="workflow-feedback success" role="status">${icon('check')}<span>${escapeHtml(api.ui.message)}</span></div>`;
    }
    return '';
  }

  function workflowRuns(workflowId) {
    return api.runs().filter((run) => run.workflowId === workflowId);
  }

  function renderLibrary() {
    const workflows = api.workflows()
      .filter((workflow) => api.ui.filter === 'all' || workflow.metadata.status === api.ui.filter)
      .filter((workflow) => {
        const query = api.ui.query.trim().toLowerCase();
        if (!query) return true;
        return [
          workflow.metadata.name,
          workflow.metadata.description,
          ...(workflow.metadata.tags || []),
        ].join(' ').toLowerCase().includes(query);
      });
    return `
      <div class="workflow-library content-scroll window-content-full">
        ${renderFeedback()}
        <section class="workflow-library-section">
          <div class="workflow-library-toolbar">
            <div><h2>工作流</h2><p>${api.workflows().length} 个能力编排，可被专家和自动化直接调用</p></div>
            <div class="workflow-library-controls">
              <label class="workflow-search">${icon('search')}<input id="workflow-search" value="${escapeHtml(api.ui.query)}" placeholder="搜索工作流" /></label>
              <div class="workflow-filter" role="tablist">
                ${[['all', '全部'], ['draft', '草稿'], ['published', '已发布']].map(([id, label]) => `<button type="button" class="${api.ui.filter === id ? 'active' : ''}" data-workflow-filter="${id}">${label}</button>`).join('')}
              </div>
            </div>
          </div>
          <div class="workflow-template-strip">
            <span>快速开始</span>
            <button type="button" data-workflow-create="blank">${icon('plus')} 空白画布</button>
            <button type="button" data-workflow-create="heavy-rain"><i>雨</i> 强降水产品模板</button>
          </div>
          ${workflows.length
            ? `<div class="workflow-list">${workflows.map(renderWorkflowRow).join('')}</div>`
            : `<div class="workflow-empty"><span>${icon('workflow')}</span><h3>${api.workflows().length ? '当前筛选没有结果' : '还没有工作流'}</h3><p>${api.workflows().length ? '调整筛选条件，或搜索其他关键词。' : '从空白画布或业务模板开始。'}</p></div>`}
        </section>
      </div>
    `;
  }

  function renderWorkflowRow(workflow) {
    const validation = Harness.validateWorkflow(workflow, {
      catalog: api.publishedWorkflowCatalog(),
    });
    const runs = workflowRuns(workflow.metadata.id);
    const lastRun = runs[0] || null;
    const experts = workflow.spec.nodes.filter((node) => node.type === 'expert').length;
    return `
      <button type="button" class="workflow-row" data-workflow-open="${escapeHtml(workflow.metadata.id)}">
        <span class="workflow-row-mark">${workflow.metadata.tags?.includes('强降水') ? '雨' : '流'}</span>
        <span class="workflow-row-copy">
          <span><strong>${escapeHtml(workflow.metadata.name)}</strong><em class="workflow-status ${escapeHtml(workflow.metadata.status)}">${statusLabel(workflow.metadata.status)}</em>${validation.valid ? '' : '<em class="workflow-status invalid">需要处理</em>'}</span>
          <small>${escapeHtml(workflow.metadata.description || '尚未填写说明')}</small>
        </span>
        <span class="workflow-row-metrics">
          <span><strong>${workflow.spec.nodes.length}</strong><small>节点</small></span>
          <span><strong>${experts}</strong><small>专家</small></span>
          <span><strong>${runs.length}</strong><small>运行</small></span>
        </span>
        <span class="workflow-row-last">${lastRun ? `<strong class="${escapeHtml(lastRun.status)}">${statusLabel(lastRun.status)}</strong><small>${formatDateTime(lastRun.startedAt)}</small>` : '<strong>尚未运行</strong><small>先进行结构试跑</small>'}</span>
        <span class="row-chevron">›</span>
      </button>
    `;
  }

  function renderNodeLibrary() {
    if (!api.ui.paletteOpen) return '';
    return `
      <aside class="workflow-node-library" role="dialog" aria-label="添加节点">
        <div class="workflow-node-library-heading"><span><strong>添加节点</strong><small>选择一个通用能力</small></span><button type="button" data-workflow-close-palette aria-label="关闭节点库">${icon('close')}</button></div>
        <label class="workflow-node-search">${icon('search')}<input data-workflow-node-search placeholder="搜索节点" autocomplete="off" /></label>
        ${renderNodeChoices('data-workflow-add-node')}
      </aside>
    `;
  }

  function renderNodeChoices(attribute) {
    return nodeGroups.map(([label, types]) => `
      <section data-workflow-node-group>
        <h3>${label}</h3>
        ${types.map((type) => {
          const meta = nodeMeta[type];
          const search = `${type} ${meta.label} ${nodeDescription(type)}`.toLowerCase();
          return `<button type="button" ${attribute}="${type}" data-workflow-node-option data-node-search="${escapeHtml(search)}"><span class="${meta.tone}">${meta.mark}</span><span><strong>${meta.label}</strong><small>${nodeDescription(type)}</small></span></button>`;
        }).join('')}
      </section>
    `).join('');
  }

  function renderCanvasContextMenu() {
    const menu = api.ui.contextMenu;
    if (!menu) return '';
    return `
      <div class="workflow-context-dismiss" data-workflow-close-context-menu></div>
      <aside class="workflow-canvas-context" role="dialog" aria-label="在画布添加节点" style="left:${menu.x}px;top:${menu.y}px" data-workflow-context-menu tabindex="-1">
        <header><span><strong>${menu.connectFromNodeId ? '在节点后添加' : '在这里添加节点'}</strong><small>${menu.connectFromNodeId ? '新节点会自动连接当前分支' : '节点会放在鼠标右键的位置'}</small></span><kbd>Esc</kbd></header>
        <label class="workflow-node-search">${icon('search')}<input data-workflow-node-search placeholder="搜索 HTTP、条件、模型…" autocomplete="off" autofocus /></label>
        <div class="workflow-context-node-list">${renderNodeChoices('data-workflow-context-add-node')}</div>
      </aside>
    `;
  }

  function nodeDescription(type) {
    return {
      input: '声明运行参数',
      trigger: '手动、定时或事件启动',
      expert: '调用专家与 Skill',
      llm: '提示词与模型推理',
      classifier: '按意图或内容分类',
      extractor: '从文本提取结构参数',
      knowledge: '检索资料和知识库',
      document: '提取文件文本与元数据',
      tool: '执行原子工具',
      http: '调用外部 API',
      code: '运行脚本处理数据',
      workflow: '复用已发布流程',
      condition: '按规则选择路径',
      iteration: '逐项处理一组数据',
      join: '等待并行结果',
      transform: '映射和整理字段',
      assign: '设置或覆盖流程变量',
      approval: '暂停并请求确认',
      template: '组合结构化内容',
      delay: '等待指定时间',
      output: '定义最终返回',
    }[type] || '';
  }

  function workflowTopology(workflow) {
    const graph = new Map(workflow.spec.nodes.map((node) => [node.id, []]));
    workflow.spec.edges.forEach((edge) => {
      if (graph.has(edge.to.nodeId)) graph.get(edge.to.nodeId).push(edge.from.nodeId);
    });
    return graph;
  }

  function renderSteps(workflow, run = null) {
    const incoming = workflowTopology(workflow);
    return `
      <div class="workflow-steps" role="list">
        ${workflow.spec.nodes.map((node, index) => {
          const meta = nodeTypeMeta(node.type);
          const nodeRun = run?.nodeRuns?.find((item) => item.nodeId === node.id);
          const parents = incoming.get(node.id) || [];
          return `
            <button type="button" class="workflow-step ${api.ui.selectedNodeId === node.id ? 'selected' : ''} ${nodeRun ? `run-${nodeRun.status}` : ''}" data-workflow-node="${escapeHtml(node.id)}" role="listitem">
              <span class="workflow-step-index">${index + 1}</span>
              <span class="workflow-node-mark ${meta.tone}">${meta.mark}</span>
              <span class="workflow-step-copy">
                <span><strong>${escapeHtml(node.name)}</strong><em>${meta.label}</em>${nodeRun ? `<i class="${escapeHtml(nodeRun.status)}">${statusLabel(nodeRun.status)}</i>` : ''}</span>
                <small>${escapeHtml(node.description || nodeDescription(node.type))}</small>
                ${parents.length > 1 ? `<span class="workflow-step-dependencies">${icon('workflow')} 汇合 ${parents.length} 个上游结果</span>` : ''}
              </span>
              <span class="workflow-step-capability">${renderCapabilityLabel(node)}</span>
              <span class="row-chevron">›</span>
            </button>
          `;
        }).join('')}
        <button type="button" class="workflow-add-step" data-workflow-add-node="expert">${icon('plus')} 添加下一步</button>
      </div>
    `;
  }

  function renderCapabilityLabel(node) {
    if (node.type === 'expert') {
      const expert = typeof allExperts === 'function'
        ? allExperts().find((item) => item.id === node.capability?.id)
        : null;
      return expert ? `<strong>${escapeHtml(expert.name)}</strong><small>${node.skills.length} 个 Skill</small>` : '<strong>未选择专家</strong>';
    }
    if (node.type === 'tool') {
      return `<strong>${escapeHtml(node.capability?.toolName || '未选择工具')}</strong><small>${escapeHtml(node.capability?.connectorId || '')}</small>`;
    }
    if (node.type === 'workflow') {
      const child = api.workflows().find((item) => item.metadata.id === node.capability?.id);
      return `<strong>${escapeHtml(child?.metadata.name || '未选择工作流')}</strong><small>${escapeHtml(node.capability?.version || '选择发布版本')}</small>`;
    }
    if (node.type === 'llm') return `<strong>${escapeHtml(node.config?.model || '默认模型')}</strong><small>模型推理</small>`;
    if (node.type === 'classifier') return `<strong>${escapeHtml(node.config?.model || '默认模型')}</strong><small>问题分类</small>`;
    if (node.type === 'extractor') return `<strong>${escapeHtml(node.config?.model || '默认模型')}</strong><small>结构参数提取</small>`;
    if (node.type === 'knowledge') return `<strong>${escapeHtml(node.config?.sourceId || '全部资料源')}</strong><small>语义检索</small>`;
    if (node.type === 'document') return `<strong>文档内容</strong><small>${escapeHtml(node.config?.source || '${input.files}')}</small>`;
    if (node.type === 'http') return `<strong>${escapeHtml(node.config?.method || 'GET')} · ${escapeHtml(node.config?.responseType || 'json')}</strong><small>${escapeHtml(node.config?.url || '未填写 URL')}</small>`;
    if (node.type === 'code') return `<strong>${escapeHtml(node.config?.language || 'javascript')}</strong><small>沙箱执行</small>`;
    if (node.type === 'condition') return `<strong>表达式</strong><small>${escapeHtml(node.config?.expression || '未配置')}</small>`;
    if (node.type === 'iteration') return `<strong>遍历数据</strong><small>${escapeHtml(node.config?.items || '${input.items}')}</small>`;
    if (node.type === 'delay') return `<strong>${Number(node.config?.seconds || 60)} 秒</strong><small>延时等待</small>`;
    if (node.type === 'assign') return `<strong>变量映射</strong><small>${escapeHtml(node.config?.mapping || '未配置')}</small>`;
    if (node.type === 'approval') return '<strong>工作流负责人</strong><small>业务审批</small>';
    return `<strong>${nodeMeta[node.type]?.label || node.type}</strong>`;
  }

  function outputPortOffset(node, port) {
    if (['condition', 'approval'].includes(node.type) && ['true', 'approved'].includes(port)) return 42;
    if (['condition', 'approval'].includes(node.type) && ['false', 'rejected'].includes(port)) return 82;
    return 61;
  }

  function renderOutputPorts(node, readonly, connectingFrom) {
    if (readonly || node.type === 'output') return '';
    const portButton = (port, label = '') => {
      const connecting = connectingFrom?.nodeId === node.id && connectingFrom?.port === port;
      return `${label ? `<b>${label}</b>` : ''}<button type="button" class="workflow-port output-port ${connecting ? 'connecting' : ''}" data-workflow-output-port="${escapeHtml(node.id)}" data-workflow-port="${escapeHtml(port)}" aria-label="拖动连接 ${escapeHtml(node.name)} 的${label || '输出'}分支，键盘用户按 Enter 开始连线"></button>`;
    };
    if (node.type === 'condition') {
      return `<span class="workflow-branch-port true-branch">${portButton('true', '是')}</span><span class="workflow-branch-port false-branch">${portButton('false', '否')}</span>`;
    }
    if (node.type === 'approval') {
      return `<span class="workflow-branch-port true-branch">${portButton('approved', '通过')}</span><span class="workflow-branch-port false-branch">${portButton('rejected', '驳回')}</span>`;
    }
    return portButton('success');
  }

  function renderCanvas(workflow, run = null) {
    const readonly = Boolean(run);
    const maxX = Math.max(3000, ...workflow.spec.nodes.map((node) => node.position.x + 520));
    const maxY = Math.max(1800, ...workflow.spec.nodes.map((node) => node.position.y + 360));
    const nodeIndex = new Map(workflow.spec.nodes.map((node) => [node.id, node]));
    const edgePaths = workflow.spec.edges.map((edge) => {
      const from = nodeIndex.get(edge.from.nodeId);
      const to = nodeIndex.get(edge.to.nodeId);
      if (!from || !to) return '';
      const x1 = from.position.x + 220;
      const y1 = from.position.y + outputPortOffset(from, edge.from.port);
      const x2 = to.position.x;
      const y2 = to.position.y + 61;
      const bend = Math.max(44, Math.abs(x2 - x1) * 0.42);
      const fromRun = run?.nodeRuns?.find((item) => item.nodeId === from.id);
      const activeClass = fromRun ? `run-${fromRun.status}` : '';
      return `<path class="${activeClass}" data-workflow-edge-path data-from-node="${escapeHtml(from.id)}" data-from-port="${escapeHtml(edge.from.port)}" data-to-node="${escapeHtml(to.id)}" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}" />`;
    }).join('');
    const viewport = api.ui.viewport;
    const connectingFrom = typeof api.ui.connectingFrom === 'string'
      ? { nodeId: api.ui.connectingFrom, port: 'success' }
      : api.ui.connectingFrom;
    return `
      <div class="workflow-canvas-shell">
        ${readonly ? '' : `<div class="workflow-canvas-controls" aria-label="画布控制">
          <button type="button" data-workflow-toggle-palette class="${api.ui.paletteOpen ? 'active' : ''}">${icon('plus')} 节点</button>
          <span></span>
          <button type="button" data-workflow-zoom="-0.1" aria-label="缩小">−</button>
          <em>${Math.round(viewport.zoom * 100)}%</em>
          <button type="button" data-workflow-zoom="0.1" aria-label="放大">＋</button>
          <button type="button" data-workflow-fit>适应</button>
        </div>`}
        ${readonly ? '' : `<div class="workflow-connection-hint" data-workflow-connection-hint ${connectingFrom ? '' : 'hidden'}><span data-workflow-connection-hint-copy>${connectingFrom ? `键盘连线：聚焦目标节点左侧端口并按 Enter，连接“${escapeHtml(nodeIndex.get(connectingFrom.nodeId)?.name || connectingFrom.nodeId)}”的${connectingFrom.port === 'true' ? '是' : connectingFrom.port === 'false' ? '否' : connectingFrom.port === 'approved' ? '通过' : connectingFrom.port === 'rejected' ? '驳回' : '输出'}分支` : ''}</span><kbd>Esc</kbd></div>`}
        ${readonly ? '' : renderNodeLibrary()}
        ${readonly ? '' : renderCanvasContextMenu()}
        <div class="workflow-canvas-viewport" data-workflow-canvas>
          <div class="workflow-canvas-stage" style="width:${maxX}px;height:${maxY}px;transform:translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})">
          <svg class="workflow-canvas-edges" width="${maxX}" height="${maxY}" aria-hidden="true">${edgePaths}<path class="workflow-connection-preview" data-workflow-connection-preview hidden /></svg>
          ${workflow.spec.nodes.map((node) => {
            const meta = nodeTypeMeta(node.type);
            const nodeRun = run?.nodeRuns?.find((item) => item.nodeId === node.id);
            return `
              <article role="button" tabindex="0" class="workflow-canvas-node ${meta.tone} ${api.ui.selectedNodeId === node.id ? 'selected' : ''} ${nodeRun ? `run-${nodeRun.status}` : ''}" style="left:${node.position.x}px;top:${node.position.y}px" data-workflow-node="${escapeHtml(node.id)}">
                <span class="workflow-canvas-node-heading"><i>${meta.mark}</i><strong>${escapeHtml(node.name)}</strong>${nodeRun ? `<em class="${escapeHtml(nodeRun.status)}">${statusLabel(nodeRun.status)}</em>` : ''}</span>
                <small>${escapeHtml(node.description || nodeDescription(node.type))}</small>
                <span class="workflow-canvas-node-detail">${renderCapabilityLabel(node)}</span>
                ${readonly || node.type === 'input' || node.type === 'trigger' ? '' : `<button type="button" class="workflow-port input-port ${connectingFrom ? 'available' : ''}" data-workflow-input-port="${escapeHtml(node.id)}" aria-label="连接到 ${escapeHtml(node.name)}"></button>`}
                ${renderOutputPorts(node, readonly, connectingFrom)}
              </article>
            `;
          }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderNodeConfig(node) {
    const config = node.config || {};
    if (node.type === 'trigger') {
      return `<section><h3>触发方式</h3><label><span>启动条件</span><select id="workflow-node-trigger-mode"><option value="manual" ${config.mode === 'manual' ? 'selected' : ''}>手动触发</option><option value="schedule" ${config.mode === 'schedule' ? 'selected' : ''}>定时触发</option><option value="event" ${config.mode === 'event' ? 'selected' : ''}>事件触发</option></select></label></section>`;
    }
    if (node.type === 'llm') {
      return `<section><h3>模型推理</h3><label><span>模型</span><input id="workflow-node-model" value="${escapeHtml(config.model || '')}" placeholder="使用当前默认模型" /></label><label><span>提示词</span><textarea id="workflow-node-prompt" rows="5" placeholder="支持使用 \${input.xxx} 或 \${nodes.xxx.outputs.xxx}">${escapeHtml(config.prompt || '')}</textarea></label></section>`;
    }
    if (node.type === 'classifier') {
      return `<section><h3>问题分类</h3><label><span>模型</span><input id="workflow-node-classifier-model" value="${escapeHtml(config.model || '')}" placeholder="使用当前默认模型" /></label><label><span>分类标签</span><textarea id="workflow-node-classes" rows="4" placeholder="每行一个分类，例如：强降水&#10;强对流&#10;其他">${escapeHtml(config.classes || '')}</textarea></label><label><span>分类说明</span><textarea id="workflow-node-classifier-instruction" rows="3">${escapeHtml(config.instruction || '')}</textarea></label></section>`;
    }
    if (node.type === 'extractor') {
      return `<section><h3>参数提取</h3><label><span>模型</span><input id="workflow-node-extractor-model" value="${escapeHtml(config.model || '')}" placeholder="使用当前默认模型" /></label><label><span>输出 Schema</span><textarea id="workflow-node-extractor-schema" class="workflow-code-field" rows="5" placeholder='{"region":"string","level":"number"}'>${escapeHtml(config.schema || '')}</textarea></label><label><span>提取说明</span><textarea id="workflow-node-extractor-instruction" rows="3">${escapeHtml(config.instruction || '')}</textarea></label></section>`;
    }
    if (node.type === 'knowledge') {
      return `<section><h3>知识检索</h3><label><span>资料源</span><input id="workflow-node-source-id" value="${escapeHtml(config.sourceId || '')}" placeholder="留空检索全部资料源" /></label><label><span>查询表达式</span><textarea id="workflow-node-query" rows="3">${escapeHtml(config.query || '')}</textarea></label></section>`;
    }
    if (node.type === 'document') {
      return `<section><h3>文档提取</h3><label><span>文件变量</span><input id="workflow-node-document-source" value="${escapeHtml(config.source || '${input.files}')}" placeholder="\${input.files}" /></label><div class="workflow-inspector-note"><strong>通用文件输入</strong><p>运行时读取文档文本和元数据，后续节点通过该节点输出变量引用。</p></div></section>`;
    }
    if (node.type === 'http') {
      return `<section><h3>HTTP 请求</h3><div class="workflow-inspector-grid"><label><span>方法</span><select id="workflow-node-http-method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => `<option value="${method}" ${config.method === method ? 'selected' : ''}>${method}</option>`).join('')}</select></label><label><span>响应格式</span><select id="workflow-node-http-response"><option value="json" ${config.responseType === 'json' ? 'selected' : ''}>JSON</option><option value="text" ${config.responseType === 'text' ? 'selected' : ''}>文本</option><option value="binary" ${config.responseType === 'binary' ? 'selected' : ''}>二进制</option></select></label><label class="wide"><span>URL</span><input id="workflow-node-http-url" value="${escapeHtml(config.url || '')}" placeholder="https://api.example.com/weather" /></label></div><label><span>查询参数</span><textarea id="workflow-node-http-query" class="workflow-code-field" rows="3" placeholder='{"region":"\${input.region}"}'>${escapeHtml(config.query || '')}</textarea></label><label><span>请求头</span><textarea id="workflow-node-http-headers" class="workflow-code-field" rows="3" placeholder='{"Content-Type":"application/json"}'>${escapeHtml(config.headers || '')}</textarea></label><label><span>请求体</span><textarea id="workflow-node-http-body" class="workflow-code-field" rows="5" placeholder='{"message":"\${nodes.previous.outputs.text}"}'>${escapeHtml(config.body || '')}</textarea></label><div class="workflow-inspector-grid"><label><span>认证</span><select id="workflow-node-http-auth"><option value="none" ${config.authMode === 'none' ? 'selected' : ''}>无</option><option value="credential" ${config.authMode === 'credential' ? 'selected' : ''}>凭据引用</option></select></label><label><span>凭据 ID</span><input id="workflow-node-http-credential" value="${escapeHtml(config.credentialRef || '')}" placeholder="weather-api" /></label></div><div class="workflow-inspector-note"><strong>敏感凭据不写入 YAML</strong><p>这里只保存凭据引用 ID，令牌与密码由运行环境安全注入。</p></div></section>`;
    }
    if (node.type === 'code') {
      return `<section><h3>代码执行</h3><label><span>语言</span><select id="workflow-node-code-language"><option value="javascript" ${config.language === 'javascript' ? 'selected' : ''}>JavaScript</option><option value="python" ${config.language === 'python' ? 'selected' : ''}>Python</option></select></label><label><span>代码</span><textarea id="workflow-node-code-source" class="workflow-code-field" rows="7">${escapeHtml(config.source || '')}</textarea></label></section>`;
    }
    if (node.type === 'condition') {
      return `<section><h3>IF / ELSE 条件</h3><label><span>判断表达式</span><textarea id="workflow-node-expression" rows="3" placeholder="\${nodes.check.outputs.score} >= 0.8">${escapeHtml(config.expression || '')}</textarea></label><div class="workflow-condition-legend"><span><i class="true"></i>是：表达式成立</span><span><i class="false"></i>否：表达式不成立</span></div></section>`;
    }
    if (node.type === 'iteration') {
      return `<section><h3>循环</h3><label><span>待遍历数据</span><input id="workflow-node-items" value="${escapeHtml(config.items || '${input.items}')}" /></label></section>`;
    }
    if (node.type === 'transform') {
      return `<section><h3>数据映射</h3><label><span>映射表达式</span><textarea id="workflow-node-transform" rows="5" placeholder="声明输出字段与上游变量的映射">${escapeHtml(config.expression || '')}</textarea></label></section>`;
    }
    if (node.type === 'assign') {
      return `<section><h3>变量赋值</h3><label><span>变量映射</span><textarea id="workflow-node-assign" class="workflow-code-field" rows="6" placeholder='{"forecast.region":"\${input.region}"}'>${escapeHtml(config.mapping || '')}</textarea></label></section>`;
    }
    if (node.type === 'template') {
      return `<section><h3>内容模板</h3><label><span>模板</span><textarea id="workflow-node-template" rows="6" placeholder="可引用上游节点输出">${escapeHtml(config.template || '')}</textarea></label></section>`;
    }
    if (node.type === 'delay') {
      return `<section><h3>等待</h3><label><span>等待秒数</span><input id="workflow-node-delay-seconds" type="number" min="1" max="86400" value="${Number(config.seconds || 60)}" /></label></section>`;
    }
    if (node.type === 'approval') {
      return `<section><h3>审批</h3><label><span>审批人</span><input id="workflow-node-assignee" value="${escapeHtml(config.assignee || 'workflow-owner')}" /></label></section>`;
    }
    return '';
  }

  function renderInspector(workflow) {
    const node = api.selectedNode();
    if (!node) return '';
    const meta = nodeTypeMeta(node.type);
    const experts = typeof allExperts === 'function' ? allExperts() : [];
    const availableSkills = typeof enabledSkillCatalog === 'function' ? enabledSkillCatalog() : [];
    const skillCatalog = [
      ...availableSkills,
      ...node.skills
        .filter((reference) => !availableSkills.some((skill) => skill.id === reference.id))
        .map((reference) => ({ ...reference, name: reference.id, status: '当前不可用' })),
    ];
    const selectedSkillIds = new Set(node.skills.map((skill) => skill.id));
    const connectors = typeof userFacingToolCatalog === 'function' ? userFacingToolCatalog() : [];
    const selectedConnector = connectors.find((item) => item.id === node.capability?.connectorId);
    const selectedConnectorTools = typeof connectorTools === 'function'
      ? connectorTools(selectedConnector)
      : [];
    const childWorkflows = api.publishedWorkflowCatalog()
      .filter((item) => item.metadata.id !== workflow.metadata.id);
    const connectedEdges = workflow.spec.edges.filter((edge) =>
      edge.from.nodeId === node.id || edge.to.nodeId === node.id
    );
    return `
      <aside class="workflow-inspector">
        <div class="workflow-inspector-heading">
          <span class="workflow-node-mark ${meta.tone}">${meta.mark}</span>
          <div><small>${meta.label}</small><strong>${escapeHtml(node.name)}</strong></div>
          <button type="button" data-workflow-close-inspector aria-label="关闭配置面板" title="关闭配置面板">${icon('close')}</button>
        </div>
        <form id="workflow-node-form" data-node-id="${escapeHtml(node.id)}">
          <section>
            <h3>基本设置</h3>
            <label><span>节点名称</span><input id="workflow-node-name" value="${escapeHtml(node.name)}" maxlength="80" required /></label>
            <label><span>业务说明</span><textarea id="workflow-node-description" rows="3" maxlength="500">${escapeHtml(node.description || '')}</textarea></label>
          </section>
          ${node.type === 'expert' ? `
            <section>
              <h3>专家与方法</h3>
              <label><span>选择专家</span><select id="workflow-node-expert">${experts.map((expert) => `<option value="${escapeHtml(expert.id)}" ${expert.id === node.capability?.id ? 'selected' : ''}>${escapeHtml(expert.name)}${expert.kind === 'team' ? ' · 专家团' : ''}</option>`).join('')}</select></label>
              <div class="workflow-node-skill-list"><span>节点 Skill</span>${skillCatalog.length ? skillCatalog.map((skill) => `<label><input type="checkbox" name="workflow-node-skills" value="${escapeHtml(skill.id)}" data-skill-version="${escapeHtml(skill.version || '')}" ${selectedSkillIds.has(skill.id) ? 'checked' : ''} /><span><strong>${escapeHtml(skill.name || skill.id)}</strong><small>${escapeHtml(skill.status || skill.version || '可用')}</small></span></label>`).join('') : '<small>当前没有可选 Skill</small>'}</div>
              <div class="workflow-inspector-note"><strong>依赖合并</strong><p>运行时会同时加载专家自身的必需 Skill 与这里显式选择的节点 Skill。</p></div>
            </section>
          ` : ''}
          ${node.type === 'tool' ? `
            <section>
              <h3>工具能力</h3>
              <label><span>工具服务</span><select id="workflow-node-connector"><option value="">请选择已连接工具服务</option>${connectors.map((connector) => `<option value="${escapeHtml(connector.id)}" ${connector.id === node.capability?.connectorId ? 'selected' : ''}>${escapeHtml(connector.name)} · ${connector.status === 'connected' ? '已连接' : '未连接'}</option>`).join('')}${node.capability?.connectorId && !selectedConnector ? `<option value="${escapeHtml(node.capability.connectorId)}" selected>${escapeHtml(node.capability.connectorId)} · 当前引用</option>` : ''}</select></label>
              <label><span>具体工具</span><input id="workflow-node-tool" list="workflow-node-tool-options" value="${escapeHtml(node.capability?.toolName || '')}" placeholder="选择或输入工具名称" /><datalist id="workflow-node-tool-options">${selectedConnectorTools.map((tool) => `<option value="${escapeHtml(tool.name)}">${escapeHtml(tool.description || tool.name)}</option>`).join('')}</datalist><small>${selectedConnector?.toolCount === null ? '请先完成连接测试以读取工具清单。' : '发布后会在任务启动前验证该工具是否可用。'}</small></label>
            </section>
          ` : ''}
          ${node.type === 'workflow' ? `
            <section>
              <h3>子工作流</h3>
              <label><span>工作流版本</span><select id="workflow-node-child"><option value="">请选择已发布工作流</option>${childWorkflows.map((item) => {
                const reference = `${item.metadata.id}@${item.metadata.version}`;
                const selected = item.metadata.id === node.capability?.id
                  && item.metadata.version === node.capability?.version;
                return `<option value="${escapeHtml(reference)}" ${selected ? 'selected' : ''}>${escapeHtml(item.metadata.name)} · v${escapeHtml(item.metadata.version)}</option>`;
              }).join('')}</select></label>
              <input id="workflow-node-version" type="hidden" value="${escapeHtml(node.capability?.version || '')}" />
            </section>
          ` : ''}
          ${renderNodeConfig(node)}
          ${connectedEdges.length ? `<section class="workflow-inspector-connections"><h3>连接</h3>${connectedEdges.map((edge) => {
            const incoming = edge.to.nodeId === node.id;
            const otherId = incoming ? edge.from.nodeId : edge.to.nodeId;
            const other = workflow.spec.nodes.find((item) => item.id === otherId);
            const relation = incoming
              ? '来自'
              : edge.from.port === 'true'
                ? '是分支前往'
                : edge.from.port === 'false'
                  ? '否分支前往'
                  : edge.from.port === 'approved'
                    ? '通过后前往'
                    : edge.from.port === 'rejected'
                      ? '驳回后前往'
                  : '前往';
            return `<div><span><small>${relation}</small><strong>${escapeHtml(other?.name || otherId)}</strong></span><button type="button" data-workflow-remove-edge="${escapeHtml(edge.id)}">移除</button></div>`;
          }).join('')}</section>` : ''}
          <section>
            <h3>失败与权限</h3>
            <div class="workflow-inspector-grid">
              <label><span>重试次数</span><input id="workflow-node-retries" type="number" min="1" max="5" value="${node.retry.maxAttempts}" /></label>
              <label><span>超时</span><input id="workflow-node-timeout" type="number" min="1" max="1440" value="${Math.round(node.timeoutSeconds / 60)}" /><small>分钟</small></label>
            </div>
            <label><span>失败后</span><select id="workflow-node-on-error"><option value="abort" ${node.onError === 'abort' ? 'selected' : ''}>停止工作流</option><option value="continue" ${node.onError === 'continue' ? 'selected' : ''}>记录错误并继续</option></select></label>
          </section>
          <footer><button type="button" class="workflow-delete-node" data-workflow-remove-node="${escapeHtml(node.id)}">删除节点</button><span>节点 ${escapeHtml(node.id)}</span><button type="submit" class="primary-button small-button">保存节点</button></footer>
        </form>
      </aside>
    `;
  }

  function renderWorkflowSettings(workflow) {
    if (!api.ui.editingMetadata) return '';
    const policy = workflow.spec.policy;
    return `
      <div class="workflow-settings-backdrop">
        <form class="workflow-settings-panel" id="workflow-settings-form" role="dialog" aria-modal="true" aria-labelledby="workflow-settings-title">
          <header><span><small>工作流设置</small><strong id="workflow-settings-title">${escapeHtml(workflow.metadata.name)}</strong></span><button type="button" data-workflow-cancel-meta aria-label="关闭设置">${icon('close')}</button></header>
          <section>
            <h3>基本信息</h3>
            <label><span>名称</span><input id="workflow-settings-name" value="${escapeHtml(workflow.metadata.name)}" maxlength="120" required /></label>
            <label><span>用途说明</span><textarea id="workflow-meta-description" rows="4" maxlength="2048">${escapeHtml(workflow.metadata.description || '')}</textarea></label>
          </section>
          <section>
            <h3>执行边界</h3>
            <label><span>权限上限</span><select id="workflow-settings-permission">
              <option value="analysis-readonly" ${policy.permissionProfile === 'analysis-readonly' ? 'selected' : ''}>请求批准</option>
              <option value="artifact-approval" ${policy.permissionProfile === 'artifact-approval' ? 'selected' : ''}>智能审批</option>
              <option value="trusted-workspace" ${policy.permissionProfile === 'trusted-workspace' ? 'selected' : ''}>受信任工作区</option>
              <option value="workspace-approval" ${policy.permissionProfile === 'workspace-approval' ? 'selected' : ''}>完全访问</option>
            </select><small>运行时取任务权限与工作流策略中更严格的一项，不会自动提权。</small></label>
            <div class="workflow-inspector-grid">
              <label><span>最大并发</span><input id="workflow-settings-parallel" type="number" min="1" max="6" value="${policy.maxParallel}" /></label>
              <label><span>总超时</span><input id="workflow-settings-timeout" type="number" min="1" max="1440" value="${Math.ceil(policy.timeoutSeconds / 60)}" /><small>分钟</small></label>
              <label><span>失败策略</span><select id="workflow-settings-failure"><option value="abort" ${policy.failurePolicy === 'abort' ? 'selected' : ''}>立即停止</option><option value="continue" ${policy.failurePolicy === 'continue' ? 'selected' : ''}>记录并继续</option></select></label>
              <label><span>嵌套深度</span><input id="workflow-settings-depth" type="number" min="1" max="5" value="${policy.maxWorkflowDepth}" /></label>
            </div>
          </section>
          <footer><button type="button" data-workflow-cancel-meta>取消</button><button type="submit" class="primary-button">保存设置</button></footer>
        </form>
      </div>
    `;
  }

  function renderEditor() {
    const workflow = api.selectedWorkflow();
    if (!workflow) return renderLibrary();
    const validation = Harness.validateWorkflow(workflow, {
      catalog: api.publishedWorkflowCatalog(),
    });
    const latestRun = workflowRuns(workflow.metadata.id)[0] || null;
    const validationItems = validation.valid ? validation.warnings : validation.errors;
    const validationPanel = validationItems.length ? `
      <details class="workflow-validation-panel ${validation.valid ? 'warning' : 'error'}" ${validation.valid ? '' : 'open'}>
        <summary>${icon('warning')}<span><strong>${validation.valid ? '配置建议' : '发布前需要处理'}</strong><small>${validationItems.length} ${validation.valid ? '项建议' : '个结构问题'}</small></span></summary>
        <ol>
          ${validationItems.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join('')}
        </ol>
        ${validationItems.length > 8 ? `<p>还有 ${validationItems.length - 8} 项，修改后列表会自动更新。</p>` : ''}
      </details>
    ` : '';
    const healthState = validation.valid
      ? validation.warnings.length ? 'warning' : 'valid'
      : 'invalid';
    return `
      <div class="workflow-editor">
        <div class="workflow-editor-toolbar">
          <div class="workflow-mode-switch" role="tablist" aria-label="编辑方式">
            <button type="button" class="${api.ui.mode === 'canvas' ? 'active' : ''}" data-workflow-mode="canvas">画布</button>
            <button type="button" class="${api.ui.mode === 'steps' ? 'active' : ''}" data-workflow-mode="steps">步骤概览</button>
          </div>
          <div class="workflow-editor-health ${healthState}">
            ${icon(validation.valid && !validation.warnings.length ? 'check' : 'warning')}
            <span>${validation.valid ? validation.warnings.length ? `${validation.warnings.length} 项配置建议` : `${workflow.spec.nodes.length} 个节点，结构有效` : `${validation.errors.length} 个问题需要处理`}</span>
          </div>
          <div class="workflow-editor-zoom">${api.ui.mode === 'canvas' ? '<span>拖动端口连线 · 右键添加节点 · ⌘/Ctrl + 滚轮缩放</span>' : '<span>按业务顺序查看节点</span>'}</div>
        </div>
        ${renderFeedback()}
        <div class="workflow-editor-body ${api.ui.selectedNodeId ? 'inspector-open' : ''}">
          <main class="workflow-design-surface">
            ${validationPanel}
            ${renderWorkflowSettings(workflow)}
            ${api.ui.mode === 'steps'
              ? `<div class="workflow-step-intro"><span>流程意图</span><p>${escapeHtml(workflow.metadata.description || '描述这个工作流解决的业务问题。')}</p><button type="button" data-workflow-edit-meta>编辑</button></div>${renderSteps(workflow)}`
              : renderCanvas(workflow)}
          </main>
          ${renderInspector(workflow)}
        </div>
        <footer class="workflow-run-dock">
          <div><span class="workflow-run-dot ${latestRun?.status || 'idle'}"></span><span><strong>${latestRun ? `最近运行 · ${statusLabel(latestRun.status)}` : '尚未运行'}</strong><small>${latestRun ? `${formatDateTime(latestRun.startedAt)} · ${latestRun.nodeRuns.filter((item) => item.status === 'completed').length}/${latestRun.nodeRuns.length} 节点完成` : '结构试跑不会调用模型或修改文件'}</small></span></div>
          ${latestRun ? `<button type="button" data-workflow-open-run="${escapeHtml(latestRun.id)}">查看运行记录</button>` : ''}
          <button type="button" class="primary-button" data-workflow-run>${icon('play')} 结构试跑</button>
        </footer>
      </div>
    `;
  }

  function renderRun() {
    const workflow = api.selectedWorkflow();
    const run = api.selectedRun();
    if (!workflow || !run) return renderEditor();
    const current = run.nodeRuns.find((item) => item.status === 'waiting_approval')
      || [...run.nodeRuns].reverse().find((item) => item.status === 'completed')
      || run.nodeRuns[0];
    api.ui.selectedNodeId = current?.nodeId || api.ui.selectedNodeId;
    return `
      <div class="workflow-run-view">
        ${renderFeedback()}
        <section class="workflow-run-map">
          <div class="workflow-run-map-heading"><div><span class="workflow-status ${escapeHtml(run.status)}">${statusLabel(run.status)}</span><strong>${escapeHtml(run.workflowName)}</strong><small>结构试跑 · ${formatDateTime(run.startedAt)} · ${escapeHtml(run.id)}</small></div><button type="button" data-workflow-back-editor>返回编辑</button></div>
          ${renderCanvas(workflow, run)}
        </section>
        <section class="workflow-run-console">
          <aside class="workflow-run-timeline">
            <div><strong>运行轨迹</strong><small>${run.nodeRuns.length} 个节点</small></div>
            ${run.nodeRuns.map((nodeRun) => `<button type="button" class="${api.ui.selectedNodeId === nodeRun.nodeId ? 'active' : ''}" data-workflow-node="${escapeHtml(nodeRun.nodeId)}"><i class="${escapeHtml(nodeRun.status)}"></i><span><strong>${escapeHtml(nodeRun.nodeName)}</strong><small>${statusLabel(nodeRun.status)}${nodeRun.finishedAt && nodeRun.startedAt ? ` · ${nodeRun.finishedAt - nodeRun.startedAt} ms` : ''}</small></span></button>`).join('')}
          </aside>
          <main class="workflow-run-detail">
            <div class="workflow-run-detail-tabs"><button class="active">输出</button><button>证据</button><button>日志</button></div>
            <div class="workflow-run-detail-heading"><span class="workflow-node-mark ${nodeMeta[current.nodeType]?.tone || 'control'}">${nodeMeta[current.nodeType]?.mark || '节'}</span><div><small>当前节点</small><h2>${escapeHtml(current.nodeName)}</h2></div><em class="${escapeHtml(current.status)}">${statusLabel(current.status)}</em></div>
            ${current.status === 'waiting_approval'
              ? `<div class="workflow-approval-summary"><span>${icon('shield')}</span><div><strong>结构已通过上游校验</strong><p>这是结构试跑，不会调用模型、工具或写入文件。批准后将继续验证后续输出路径。</p></div></div>`
              : `<div class="workflow-output-grid"><article><span>节点输出</span><strong>${escapeHtml(current.outputs?.preview || '结构和依赖关系校验通过')}</strong><small>本次未执行外部能力</small></article><article><span>尝试次数</span><strong>${current.attempt || 0}</strong><small>最大 ${workflow.spec.nodes.find((item) => item.id === current.nodeId)?.retry.maxAttempts || 1} 次</small></article></div>`}
            <div class="workflow-run-evidence"><h3>结构证据</h3><div>${run.events.filter((event) => !event.nodeId || event.nodeId === current.nodeId).map((event) => `<p><time>${formatTime(event.at)}</time><span>${escapeHtml(event.detail)}</span></p>`).join('') || '<p><span>该节点没有额外事件。</span></p>'}</div></div>
          </main>
          <aside class="workflow-run-action">
            ${run.status === 'waiting_approval'
              ? `<span class="workflow-approval-badge">需要你的审批</span><h2>是否继续验证交付路径？</h2><p>上游专家节点和汇合关系有效，后续将检查工具与输出节点。</p><div class="workflow-approval-actions"><button type="button" data-workflow-approve="false">驳回</button><button type="button" class="primary-button" data-workflow-approve="true">批准并继续</button></div>`
              : `<span class="workflow-complete-badge">${icon(run.status === 'completed' ? 'check' : 'warning')} ${statusLabel(run.status)}</span><h2>${run.status === 'completed' ? '所有执行路径有效' : '结构试跑已结束'}</h2><p>${run.status === 'completed' ? '专家、并行汇合、审批、工具和输出节点已经形成完整路径。' : '返回编辑器修正节点或连线后再次试跑。'}</p><button type="button" class="primary-button" data-workflow-back-editor>返回编辑</button>`}
            <div class="workflow-product-preview"><span>产品预览</span><article><strong>短临强降水预警产品</strong><small>Word · PDF · Web</small><div><i></i><i></i><i></i><i></i></div><p></p><p></p><p></p></article></div>
          </aside>
        </section>
      </div>
    `;
  }

  function render() {
    if (api.ui.screen === 'editor') return renderEditor();
    if (api.ui.screen === 'run') return renderRun();
    return renderLibrary();
  }

  function titlebar() {
    const workflow = api.selectedWorkflow();
    if (api.ui.screen === 'library' || !workflow) {
      return {
        title: '工作流',
        icon: 'workflow',
        backButton: '',
        actions: `<button class="titlebar-action" data-workflow-import>${icon('folder')} 导入 YAML</button><button class="titlebar-action primary" data-workflow-create="blank">${icon('plus')} 新建工作流</button>`,
      };
    }
    if (api.ui.screen === 'run') {
      const run = api.selectedRun();
      return {
        title: workflow.metadata.name,
        icon: 'workflow',
        backButton: `<button class="titlebar-button titlebar-back" data-workflow-back-editor aria-label="返回工作流编辑器" title="返回工作流编辑器">${icon('back')}</button>`,
        actions: `<span class="workflow-titlebar-run-state ${escapeHtml(run?.status || 'running')}">${statusLabel(run?.status || 'running')}</span><button class="titlebar-action" data-workflow-run>${icon('refresh')} 再次试跑</button>`,
      };
    }
    return {
      title: workflow.metadata.name,
      icon: 'workflow',
      backButton: `<button class="titlebar-button titlebar-back" data-workflow-close aria-label="返回工作流列表" title="返回工作流列表">${icon('back')}</button>`,
      actions: `<span class="workflow-titlebar-version">v${escapeHtml(workflow.metadata.version)} · ${statusLabel(workflow.metadata.status)}</span><button class="titlebar-action" data-workflow-undo ${api.ui.undoStack.length ? '' : 'disabled'}>撤销</button><button class="titlebar-action" data-workflow-redo ${api.ui.redoStack.length ? '' : 'disabled'}>重做</button><button class="titlebar-action" data-workflow-settings>设置</button><button class="titlebar-action" data-workflow-export>${icon('external')} 导出 YAML</button><button class="titlebar-action" data-workflow-run>${icon('play')} 结构试跑</button><button class="titlebar-action primary" data-workflow-publish>${workflow.metadata.status === 'published' ? '重新发布' : '发布'}</button>`,
    };
  }

  api.render = render;
  api.titlebar = titlebar;
})(window);
