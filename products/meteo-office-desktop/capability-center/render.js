(function capabilityCenterRender(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;

  const statusLabel = (status) => ({
    'installed-enabled': '已启用', 'installed-disabled': '已关闭', bundled: '可安装',
    connected: '已连接', disabled: '已禁用', planned: '待接入', runtime: '可用', beta: 'Beta',
    'built-in': '随产品提供',
  })[status] || status || '未配置';

  const riskLabel = (risk) => ({ low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险' })[risk] || risk;

  function card(item) {
    const action = item.capabilityType === 'skill'
      ? item.installation ? '管理技能' : item.bundled ? '安装技能' : item.status === 'planned' ? '查看规划' : '查看技能'
      : item.binding ? '管理连接器' : '配置连接器';
    return `<article class="capability-card capability-center-card">
      <div class="capability-icon">${escapeHtml(item.icon)}</div>
      <div class="capability-copy"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category)}</span></div>
      <span class="capability-status ${['installed-enabled', 'connected'].includes(item.status) ? 'ready' : ''}">${escapeHtml(statusLabel(item.status))}</span>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row small">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}${item.risk?.level ? `<span class="risk-${escapeHtml(item.risk.level)}">${escapeHtml(riskLabel(item.risk.level))}</span>` : ''}</div>
      <button class="secondary-action" data-capability-action="open" data-capability-type="${item.capabilityType}" data-capability-id="${escapeHtml(item.id)}">${action}</button>
    </article>`;
  }

  const originalCatalog = renderCatalogView;
  renderCatalogView = function renderCapabilityCatalog() {
    if (state.catalogTab === 'experts') return originalCatalog();
    const skillTab = state.catalogTab === 'skills';
    let items = skillTab ? api.skillCatalog() : api.connectorCatalog();
    if (skillTab && api.center.installedOnly) items = items.filter((item) => item.installation);
    if (!skillTab && api.center.connectedOnly) items = items.filter((item) => item.binding);
    const query = state.search.trim().toLowerCase();
    const categories = ['全部', ...new Set(items.map((item) => item.category).filter(Boolean))];
    items = items.filter((item) => (state.category === '全部' || item.category === state.category)
      && (!query || `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query)));
    const installed = api.installedSkills().length;
    const connected = api.configuredConnectors().filter((item) => item.enabled).length;
    return `<header class="topbar">
      <div class="top-tabs">${catalogTabButton('experts', '专家')}${catalogTabButton('skills', '技能')}${catalogTabButton('connectors', '连接器')}</div>
      <div class="top-actions capability-top-actions">
        <label class="search-box">${icon('search')}<input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="${skillTab ? '搜索技能' : '搜索连接器'}" /></label>
        <button class="my-experts ${(skillTab ? api.center.installedOnly : api.center.connectedOnly) ? 'active' : ''}" id="toggle-installed-capabilities">${icon('check')} ${skillTab ? `我的安装 ${installed}` : `已连接 ${connected}`}</button>
        <div class="capability-add-menu"><button class="my-experts" id="add-capability">${icon('plus')} ${skillTab ? '添加技能' : '添加连接器'}</button>
          <div class="capability-add-popover" id="capability-add-popover" hidden>${skillTab
            ? '<button data-add-skill="find">查找技能<small>筛选本地精选和已安装技能</small></button><button data-add-skill="zip">上传 ZIP / SKILL.md<small>隔离检查后安装</small></button><button data-add-skill="directory">导入技能目录<small>选择包含 SKILL.md 的文件夹</small></button><button data-add-skill="create">AI 创建技能<small>使用 skill-creator 生成草稿</small></button>'
            : '<button data-add-connector="stdio">添加 STDIO MCP<small>运行本地命令型连接器</small></button><button data-add-connector="streamable-http">添加 HTTP MCP<small>连接 Streamable HTTP 服务</small></button>'}
          </div></div>
      </div></header>
      <div class="content-scroll"><section class="catalog-section capability-center-section">
        <div class="section-heading"><div><h2>${skillTab ? (api.center.installedOnly ? '我的安装' : '技能中心') : (api.center.connectedOnly ? '已连接' : '连接器中心')}</h2><p>${skillTab ? '安装、启停和审查可复用的气象与办公能力' : '配置 MCP、验证连接并按项目授权工具'}</p></div><span class="capability-local-badge">本地能力中心 V1</span></div>
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
    const skillIds = task?.skillIds || state.draftSkillIds || [];
    const connectorIds = task?.connectorIds || state.draftConnectorIds || [];
    const names = [
      ...skillIds.map((id) => api.skillCatalog().find((item) => item.id === id)?.name || id),
      ...connectorIds.map((id) => api.connectorCatalog().find((item) => item.id === id)?.name || id),
    ];
    const chips = names.length ? `<div class="composer-capability-chips">${names.map((name) => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : '';
    html = html.replace('</textarea>\n            <div class="composer-footer">', `</textarea>${chips}\n            <div class="composer-footer">`);
    html = html.replace('<div class="composer-primary-tools">', `<button class="composer-capability-button" id="composer-capabilities" type="button" title="选择技能与连接器">${icon('plus')}<span>${names.length ? `能力 ${names.length}` : '添加能力'}</span></button><div class="composer-primary-tools">`);
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
