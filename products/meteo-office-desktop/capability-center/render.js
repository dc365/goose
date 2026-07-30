(function capabilityCenterRender(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;

  const statusLabel = (status) => ({
    'installed-enabled': '已启用', 'installed-disabled': '已关闭', bundled: '可安装',
    connected: '已连接', disabled: '已禁用', planned: '待接入', runtime: '可用', beta: 'Beta',
    available: '可启用', demo: '构造演示', experimental: '实验性', production: '生产级',
    deprecated: '已弃用',
    'policy-blocked': '组织策略限制',
    'built-in': '随产品提供',
  })[status] || status || '未配置';

  const riskLabel = (risk) => ({ low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险' })[risk] || risk;
  const maturityLabel = (maturity) => ({
    planned: '规划中',
    demo: '构造演示',
    experimental: '实验性',
    beta: 'Beta',
    production: '生产级',
    deprecated: '已弃用',
  })[maturity] || maturity || '未声明';

  function card(item) {
    const action = item.capabilityType === 'skill'
      ? item.installation?.managedByPolicy ? '组织默认' : item.updateAvailable ? '发现更新' : item.installation ? '管理技能' : item.bundled ? '安装技能' : item.status === 'planned' ? '查看规划' : '查看技能'
      : item.status === 'policy-blocked' ? '查看限制' : item.binding ? '管理工具服务' : '配置工具服务';
    return `<article class="capability-card capability-center-card">
      <div class="capability-icon">${escapeHtml(item.icon)}</div>
      <div class="capability-copy"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category)}</span></div>
      <div class="capability-badges">
        <span class="capability-status ${['installed-enabled', 'connected'].includes(item.status) ? 'ready' : ''}">${escapeHtml(statusLabel(item.status))}</span>
        <span class="capability-maturity maturity-${escapeHtml(item.maturity || 'experimental')}">${escapeHtml(maturityLabel(item.maturity))}</span>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row small">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}${item.toolCount !== null && item.toolCount !== undefined ? `<span>${item.toolCount} 个工具</span>` : ''}${item.risk?.level ? `<span class="risk-${escapeHtml(item.risk.level)}">${escapeHtml(riskLabel(item.risk.level))}</span>` : ''}</div>
      <button class="secondary-action" data-capability-action="open" data-capability-type="${item.capabilityType}" data-capability-id="${escapeHtml(item.id)}">${action}</button>
    </article>`;
  }

  function skillAddMenu() {
    return `<div class="capability-add-menu"><button class="my-experts" id="add-capability">${icon('plus')} 添加技能</button>
      <div class="capability-add-popover skill-add-popover" id="capability-add-popover" hidden>
        <button data-add-skill="upload">上传技能</button>
        <button data-add-skill="create">创建技能</button>
      </div></div>`;
  }

  api.skillAddMenu = skillAddMenu;

  const originalCatalogTitlebarActions = renderCatalogTitlebarActions;
  renderCatalogTitlebarActions = function renderCapabilityTitlebarActions() {
    if (state.view !== 'catalog' || ['experts', 'workflows'].includes(state.catalogTab)) {
      return originalCatalogTitlebarActions();
    }
    const skillTab = state.catalogTab === 'skills';
    const connected = api.configuredConnectors().filter((item) => item.enabled).length;
    return `<div class="top-actions capability-top-actions">
      <label class="search-box">${icon('search')}<input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="${skillTab ? '搜索技能' : '搜索工具'}" /></label>
      ${skillTab ? '' : `<button class="my-experts ${api.center.connectedOnly ? 'active' : ''}" id="toggle-installed-capabilities">${icon('check')} 已连接 ${connected}</button>`}
      ${skillTab
        ? skillAddMenu()
        : `<div class="capability-add-menu"><button class="my-experts" id="add-capability">${icon('plus')} 添加工具服务</button>
            <div class="capability-add-popover" id="capability-add-popover" hidden><button data-add-connector="stdio">添加 STDIO MCP<small>运行本地命令型工具服务</small></button><button data-add-connector="streamable-http">添加 HTTP MCP<small>连接远程 MCP 工具服务</small></button></div>
          </div>`}
    </div>`;
  };

  const originalCatalog = renderCatalogView;
  renderCatalogView = function renderCapabilityCatalog() {
    if (['experts', 'workflows'].includes(state.catalogTab)) return originalCatalog();
    const skillTab = state.catalogTab === 'skills';
    let items = skillTab
      ? api.skillCatalog()
      : api.connectorCatalog().filter((item) => item.id !== 'goose-runtime');
    if (skillTab && api.center.installedOnly) items = items.filter((item) => item.installation);
    if (!skillTab && api.center.connectedOnly) items = items.filter((item) => item.binding);
    const query = state.search.trim().toLowerCase();
    const categories = ['全部', ...new Set(items.map((item) => item.category).filter(Boolean))];
    items = items.filter((item) => (state.category === '全部' || item.category === state.category)
      && (!query || `${item.name} ${item.description} ${(item.tags || []).join(' ')} ${(item.tools || []).map((tool) => `${tool.name || ''} ${tool.description || ''}`).join(' ')}`.toLowerCase().includes(query)));
    return `<div class="content-scroll window-content-full"><section class="catalog-section capability-center-section">
        <div class="section-heading"><div><h2>${skillTab ? (api.center.installedOnly ? '我的安装' : '技能中心') : (api.center.connectedOnly ? '已连接' : '工具中心')}</h2><p>${skillTab ? '安装、启停和审查可复用的气象与办公能力' : '配置 MCP 工具服务、验证连接并按项目授权'}</p></div><span class="capability-local-badge">本地能力中心 V1</span></div>
        ${api.center.status === 'error' ? `<div class="capability-error">${escapeHtml(api.center.error)}</div>` : ''}
        <div class="capability-subtabs"><button class="${!skillTab || !api.center.installedOnly ? 'active' : ''}" data-capability-view="all">${skillTab ? '推荐' : '全部'}</button><button class="${skillTab ? api.center.installedOnly : api.center.connectedOnly ? 'active' : ''}" data-capability-view="installed">${skillTab ? '我的安装' : '已连接'}</button>${skillTab ? '<button disabled>SkillHub</button><button disabled>套件</button>' : ''}</div>
        <div class="category-strip">${categories.map((category) => `<button class="category-pill ${state.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}</div>
        <div class="catalog-grid compact">${api.center.status === 'loading' ? '<div class="empty-result">正在读取本地能力…</div>' : items.length ? items.map(card).join('') : '<div class="empty-result">没有找到匹配内容</div>'}</div>
      </section></div>`;
  };

  const originalTask = renderTaskView;
  renderTaskView = function renderTaskCapabilities(options) {
    let html = originalTask(options);
    const task = getActiveTask();
    const project = task ? getConversationProject(task) : getActiveProject();
    const enabledSkills = api.enabledSkillCatalog(project?.id || null);
    const enabledSkillIds = new Set(enabledSkills.map((item) => item.id));
    const skillIds = (task?.skillIds || state.draftSkillIds || []).filter((id) => enabledSkillIds.has(id));
    const effective = api.effectiveConnectorSelection(task, project);
    const connectorIds = effective.connectorIds.filter((id) => id !== 'goose-runtime');
    const toolSelections = effective.toolSelections;
    const skillChips = skillIds.map((id) => {
      const name = enabledSkills.find((item) => item.id === id)?.name || id;
      return `<button type="button" class="composer-draft-chip capability" data-remove-task-skill="${escapeHtml(id)}" aria-label="移除技能${escapeHtml(name)}"><span>技能：${escapeHtml(name)}</span><b>×</b></button>`;
    });
    const connectorChips = connectorIds.map((id) => {
      const connector = api.connectorCatalog().find((item) => item.id === id);
      const name = connector?.name || id;
      const tools = connectorTools(connector);
      const selectedCount = selectedConnectorToolNames(connector || { id, tools: [] }, connectorIds, toolSelections).length;
      const loaded = task?.capabilityLoad?.connectors?.find((item) => item.id === id);
      const loadStatus = task?.capabilityLoad?.status === 'error' || loaded?.status === 'error'
        ? '加载失败'
        : loaded?.status === 'loaded'
          ? '已加载'
          : task?.status === 'running'
            ? '加载中'
            : '待加载';
      const suffix = `${tools.length ? ` · ${selectedCount}/${tools.length}` : ''} · ${loadStatus}`;
      return `<button type="button" class="composer-draft-chip capability load-${escapeHtml(loaded?.status || 'pending')}" data-remove-task-tool="${escapeHtml(id)}" aria-label="移除工具${escapeHtml(name)}"><span>工具：${escapeHtml(name)}${escapeHtml(suffix)}</span><b>×</b></button>`;
    });
    html = html.replace(
      '<div id="composer-capability-chips"></div>',
      `<div id="composer-capability-chips" class="composer-capability-chips">${[...skillChips, ...connectorChips].join('')}</div>`
    );
    return html;
  };

  function modal(content, { wide = false, onReady } = {}) {
    document.getElementById('capability-modal-root')?.remove();
    const element = document.createElement('div');
    element.id = 'capability-modal-root';
    element.className = 'capability-modal-backdrop';
    element.innerHTML = `<section class="capability-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${content}</section>`;
    document.body.appendChild(element);
    element.addEventListener('click', (event) => { if (event.target === element || event.target.closest('[data-modal-close]')) element.remove(); });
    onReady?.(element);
    return element;
  }

  function error(title, message) {
    modal(`<header class="capability-modal-header"><div><h2>${escapeHtml(title)}</h2><p>没有对本地能力做任何修改</p></div><button data-modal-close>×</button></header><div class="capability-modal-body"><div class="capability-error-block">${escapeHtml(message)}</div></div><footer class="capability-modal-footer"><button class="primary-button" data-modal-close>知道了</button></footer>`);
  }

  function projectOptions(selected = []) {
    if (!state.projects.length) return '<p class="capability-muted">还没有项目；可先安装到当前用户。</p>';
    return state.projects.map((project) => `<label class="capability-project-option"><input type="checkbox" name="projectIds" value="${escapeHtml(project.id)}" ${selected.includes(project.id) ? 'checked' : ''}/><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></span></label>`).join('');
  }

  api.ui = { modal, error, projectOptions, statusLabel, riskLabel };
})(typeof globalThis !== 'undefined' ? globalThis : window);
