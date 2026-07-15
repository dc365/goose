const catalog = window.METEO_CATALOG;

const STORAGE_KEY = 'meteo-office-desktop-state-v1';

const initialState = {
  view: 'catalog',
  catalogTab: 'experts',
  category: '全部',
  search: '',
  teamMode: false,
  selectedExpertId: null,
  workspace: '',
  tasks: [],
  activeTaskId: null,
  runtime: { available: false, binary: null, mockForced: false, platform: '' },
};

let state = loadState();
const appElement = document.getElementById('app');
let unsubscribeTaskEvents = null;

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...initialState,
      ...stored,
      runtime: initialState.runtime,
      activeTaskId: null,
      tasks: Array.isArray(stored.tasks)
        ? stored.tasks.map((task) => ({ ...task, status: task.status === 'running' ? 'interrupted' : task.status }))
        : [],
    };
  } catch {
    return { ...initialState };
  }
}

function saveState() {
  const serializable = {
    ...state,
    runtime: undefined,
    activeTaskId: null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function icon(name) {
  const icons = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    assistant: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 3 3 2v8l-3 2H8l-3-2V9l3-2 1-3Z"/><path d="M9 12h.01M15 12h.01M9 16h6"/></svg>',
    project: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="m8 11 8-4M8 13l8 4"/></svg>',
    expert: '<svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z"/><path d="M7 10v5.5c2 2 8 2 10 0V10M20 8v6"/></svg>',
    automation: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 9"/><path d="M20 4v5h-5M20 12a8 8 0 0 1-13.5 5.8L4 15"/><path d="M4 20v-5h5"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v10H3V6Z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    external: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v6H5V6h6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 19v-2c0-3 2.5-5 6-5s6 2 6 5v2"/><circle cx="17" cy="9" r="2"/><path d="M16 14c3 0 5 1.7 5 4v1"/></svg>',
  };
  return `<span class="icon">${icons[name] || icons.more}</span>`;
}

function getSelectedExpert() {
  return [...catalog.experts, ...catalog.teams].find((item) => item.id === state.selectedExpertId) || null;
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function runtimeLabel() {
  if (state.runtime.mockForced) return '演示模式';
  return state.runtime.available ? 'Goose 已连接' : '演示模式';
}

function render() {
  appElement.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <main class="main-shell">
        ${renderMain()}
      </main>
    </div>
  `;
  bindEvents();
}

function renderSidebar() {
  const recentTasks = state.tasks.slice(0, 6);
  return `
    <aside class="sidebar">
      <div class="window-dots"><i></i><i></i><i></i></div>
      <div class="brand-row">
        <div><strong>气象智伴</strong><span>MVP v0.1.0</span></div>
        <button class="icon-button" title="搜索">${icon('search')}</button>
      </div>
      <nav class="primary-nav">
        ${navItem('task-new', 'plus', '新建任务', state.view === 'task' && !state.activeTaskId)}
        ${navItem('assistants', 'assistant', '助理', state.view === 'assistants')}
        ${navItem('projects', 'project', '项目', state.view === 'projects')}
        ${navItem('catalog', 'expert', '专家 · 技能 · 连接器', state.view === 'catalog')}
        ${navItem('automation', 'automation', '自动化', state.view === 'automation')}
        ${navItem('more', 'more', '更多', state.view === 'more')}
      </nav>
      <section class="sidebar-section">
        <div class="sidebar-section-title"><span>任务 (${state.tasks.length})</span><span>⌄</span></div>
        <div class="sidebar-list">
          ${recentTasks.length ? recentTasks.map(renderSidebarTask).join('') : '<div class="sidebar-empty">还没有任务</div>'}
        </div>
      </section>
      <section class="sidebar-section workspace-section">
        <div class="sidebar-section-title"><span>空间 (1)</span><span>⌄</span></div>
        <button class="workspace-row" data-action="projects">
          <span class="workspace-mark">气</span>
          <span><strong>气象办公空间</strong><small>${state.workspace ? escapeHtml(shortPath(state.workspace)) : '选择本地工作区'}</small></span>
          <span class="row-chevron">›</span>
        </button>
      </section>
      <div class="sidebar-footer">
        <span class="runtime-dot ${state.runtime.available && !state.runtime.mockForced ? 'online' : 'demo'}"></span>
        <span>${runtimeLabel()}</span>
      </div>
    </aside>
  `;
}

function navItem(view, iconName, label, active) {
  return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${view}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderSidebarTask(task) {
  const statusClass = task.status || 'draft';
  return `
    <button class="sidebar-task ${state.activeTaskId === task.id ? 'active' : ''}" data-task-id="${task.id}">
      <span class="task-status ${statusClass}"></span>
      <span class="task-copy"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.expertName)} · ${formatTime(task.createdAt)}</small></span>
    </button>
  `;
}

function renderMain() {
  if (state.view === 'task') return renderTaskView();
  if (state.view === 'projects') return renderProjectsView();
  if (state.view === 'automation') return renderAutomationView();
  if (state.view === 'assistants') return renderAssistantsView();
  if (state.view === 'more') return renderMoreView();
  return renderCatalogView();
}

function renderCatalogView() {
  const tab = state.catalogTab;
  const items = tab === 'experts'
    ? (state.teamMode ? catalog.teams : catalog.experts)
    : tab === 'skills'
      ? catalog.skills
      : catalog.connectors;
  const categories = ['全部', ...new Set(items.map((item) => item.category))];
  const query = state.search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const matchesCategory = state.category === '全部' || item.category === state.category;
    const haystack = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  return `
    <header class="topbar">
      <div class="top-tabs">
        ${catalogTabButton('experts', '专家')}
        ${catalogTabButton('skills', '技能')}
        ${catalogTabButton('connectors', '连接器')}
      </div>
      <div class="top-actions">
        <label class="search-box">${icon('search')}<input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="搜索专家名称或描述" /></label>
        <button class="my-experts">${icon('expert')} 我的专家</button>
      </div>
    </header>
    <div class="content-scroll">
      ${tab === 'experts' ? renderScenes() : ''}
      <section class="catalog-section">
        ${tab === 'experts' ? `
          <div class="section-heading expert-heading">
            <div class="mode-tabs">
              <button class="mode-tab ${!state.teamMode ? 'active' : ''}" data-team-mode="false">专家</button>
              <button class="mode-tab ${state.teamMode ? 'active' : ''}" data-team-mode="true">专家团</button>
            </div>
            <div class="sort-tabs"><button class="active">最热</button><button>最新</button></div>
          </div>` : `
          <div class="section-heading">
            <div><h2>${tab === 'skills' ? '技能中心' : '连接器中心'}</h2><p>${tab === 'skills' ? '复用气象知识、工作流程、模板和脚本' : '连接气象数据、算法、知识库与办公系统'}</p></div>
          </div>`}
        <div class="category-strip">
          ${categories.map((category) => `<button class="category-pill ${state.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}
        </div>
        <div class="catalog-grid ${tab !== 'experts' ? 'compact' : ''}">
          ${filtered.length ? filtered.map((item) => tab === 'experts' ? renderExpertCard(item) : renderCapabilityCard(item, tab)).join('') : '<div class="empty-result">没有找到匹配内容</div>'}
        </div>
      </section>
    </div>
  `;
}

function catalogTabButton(id, label) {
  return `<button class="top-tab ${state.catalogTab === id ? 'active' : ''}" data-catalog-tab="${id}">${label}</button>`;
}

function renderScenes() {
  return `
    <section class="scenes-section">
      <div class="section-title-row"><div><h2>精选气象场景</h2><p>从常见业务任务快速启动专家与工具组合</p></div><span class="runtime-chip">${runtimeLabel()}</span></div>
      <div class="scene-grid">
        ${catalog.scenes.map((scene) => `
          <button class="scene-card ${scene.gradient}" data-scene-id="${scene.id}">
            <span class="scene-orb">${scene.icon}</span>
            <span class="scene-copy"><strong>${scene.title}</strong><small>${scene.subtitle}</small></span>
            <span class="scene-arrow">›</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderExpertCard(item) {
  return `
    <article class="expert-card" data-expert-id="${item.id}">
      <div class="expert-top">
        <span class="avatar avatar-${item.avatar.codePointAt(0) % 6}">${escapeHtml(item.avatar)}</span>
        <div class="expert-title"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.owner)}</span></div>
        <button class="card-more" aria-label="更多">•••</button>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <button class="card-launch" data-expert-id="${item.id}">开始任务 <span>→</span></button>
    </article>
  `;
}

function renderCapabilityCard(item, tab) {
  const isRuntime = item.status === 'runtime';
  const runtimeReady = state.runtime.available && !state.runtime.mockForced;
  const statusText = isRuntime ? (runtimeReady ? '已连接' : '演示模式') : item.status === 'planned' ? '待接入' : item.status;
  return `
    <article class="capability-card">
      <div class="capability-icon">${escapeHtml(item.icon)}</div>
      <div class="capability-copy"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category)}</span></div>
      <span class="capability-status ${isRuntime && runtimeReady ? 'ready' : ''}">${escapeHtml(statusText)}</span>
      <p>${escapeHtml(item.description)}</p>
      <button class="secondary-action">${tab === 'skills' ? '查看技能' : '配置连接器'}</button>
    </article>
  `;
}

function renderTaskView() {
  const activeTask = getActiveTask();
  const expert = activeTask
    ? [...catalog.experts, ...catalog.teams].find((item) => item.id === activeTask.expertId)
    : getSelectedExpert() || catalog.experts[0];
  const output = activeTask?.output || '';
  const isRunning = activeTask?.status === 'running';
  const selectedWorkspace = activeTask?.workspace || state.workspace;

  return `
    <header class="task-topbar">
      <button class="back-button" data-nav="catalog">${icon('back')} 返回专家中心</button>
      <div class="task-topbar-title"><span class="avatar small">${escapeHtml(expert.avatar)}</span><div><strong>${escapeHtml(activeTask?.title || expert.name)}</strong><small>${escapeHtml(expert.name)}</small></div></div>
      <span class="runtime-chip">${runtimeLabel()}</span>
    </header>
    <div class="task-workspace">
      <section class="task-compose-panel">
        <div class="panel-heading"><span>任务设置</span><span class="step-badge">MVP</span></div>
        <div class="selected-expert-card">
          <span class="avatar">${escapeHtml(expert.avatar)}</span>
          <div><strong>${escapeHtml(expert.name)}</strong><p>${escapeHtml(expert.description)}</p></div>
        </div>
        <label class="field-label">项目工作区</label>
        <div class="workspace-picker">
          <button id="choose-workspace">${icon('folder')}<span>${selectedWorkspace ? escapeHtml(shortPath(selectedWorkspace)) : '选择本地目录'}</span></button>
          ${selectedWorkspace ? `<button id="open-workspace" class="square-action" title="打开目录">${icon('external')}</button>` : ''}
        </div>
        <label class="field-label" for="task-prompt">任务描述</label>
        <textarea id="task-prompt" ${isRunning ? 'disabled' : ''} placeholder="例如：根据今天 08 时 EC 模式和实况资料，分析华南未来 24 小时强降水风险，并生成专题材料提纲。">${activeTask ? escapeHtml(activeTask.prompt) : ''}</textarea>
        <div class="prompt-examples">
          ${expert.prompts.map((prompt) => `<button class="prompt-example" data-prompt-example="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}
        </div>
        <label class="permission-row ${expert.fileToolsRecommended ? 'recommended' : ''}">
          <input id="allow-file-tools" type="checkbox" ${activeTask?.allowFileTools ? 'checked' : ''} ${isRunning ? 'disabled' : ''}/>
          <span><strong>允许文件工具</strong><small>仅用于已选择的工作区；启用后 Goose 可读写文件和运行命令</small></span>
          ${expert.fileToolsRecommended ? '<em>建议</em>' : ''}
        </label>
        <div class="task-actions">
          ${isRunning
            ? `<button class="danger-button" id="cancel-task">${icon('stop')} 停止任务</button>`
            : `<button class="primary-button" id="run-task">${icon('play')} ${activeTask ? '重新运行' : '开始执行'}</button>`}
          <button class="ghost-button" data-nav="catalog">选择其他专家</button>
        </div>
      </section>
      <section class="task-output-panel">
        <div class="output-header">
          <div><span>执行过程与结果</span><small>${activeTask ? taskStatusText(activeTask.status) : '尚未开始'}</small></div>
          ${activeTask ? `<span class="status-badge ${activeTask.status}">${taskStatusText(activeTask.status)}</span>` : ''}
        </div>
        <div class="output-body ${output ? '' : 'empty'}">
          ${output
            ? `<pre>${escapeHtml(output)}</pre>`
            : `<div class="output-placeholder"><span>✦</span><h3>让气象专家开始工作</h3><p>选择工作区并描述任务。MVP 会调用本机 Goose；没有安装或配置时自动进入演示模式。</p></div>`}
        </div>
        <div class="output-footer">
          <span>${selectedWorkspace ? `工作区：${escapeHtml(shortPath(selectedWorkspace))}` : '只读分析模式'}</span>
          <span>${activeTask?.mode === 'goose' ? 'Goose Runtime' : activeTask?.mode === 'mock' ? '演示输出' : runtimeLabel()}</span>
        </div>
      </section>
    </div>
  `;
}

function taskStatusText(status) {
  return ({ draft: '草稿', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' })[status] || status;
}

function renderProjectsView() {
  return `
    <header class="simple-topbar"><div><h1>项目空间</h1><p>管理本地气象资料、算法工程和办公成果物目录</p></div><button class="primary-button small-button" id="choose-workspace">${icon('plus')} 添加项目</button></header>
    <div class="content-scroll page-content">
      <section class="project-hero">
        <div class="project-hero-icon">气</div>
        <div><h2>气象办公空间</h2><p>${state.workspace ? escapeHtml(state.workspace) : '尚未选择本地项目目录。选择后，任务可以在授权范围内读取资料和生成成果物。'}</p></div>
        ${state.workspace ? `<button id="open-workspace" class="secondary-action">打开目录</button>` : ''}
      </section>
      <div class="section-heading"><div><h2>推荐目录结构</h2><p>保持气象数据、模板、结果和临时文件分离</p></div></div>
      <div class="folder-grid">
        ${['data/ 原始气象数据', 'products/ 业务产品', 'templates/ Word/PPT 模板', 'figures/ 天气图与图表', 'reports/ 分析与总结', '.agents/ 项目技能'].map((folder, index) => `<div class="folder-card"><span>${icon('folder')}</span><strong>${escapeHtml(folder)}</strong><small>${index < 2 ? '业务核心目录' : '建议创建'}</small></div>`).join('')}
      </div>
    </div>
  `;
}

function renderAutomationView() {
  const automations = [
    ['每日天气形势摘要', '每天 08:15', '读取最新资料，生成形势摘要和待确认清单'],
    ['强降水风险巡检', '每 3 小时', '运行诊断算法，发现高风险区后生成提醒'],
    ['周报材料汇总', '每周五 16:00', '汇总任务、图表和稿件，生成周报提纲'],
  ];
  return `
    <header class="simple-topbar"><div><h1>自动化</h1><p>把稳定的气象办公流程保存为 Recipe，并在本地或服务器 Worker 中调度</p></div><button class="primary-button small-button" disabled>${icon('plus')} 新建自动化</button></header>
    <div class="content-scroll page-content">
      <div class="notice-card"><strong>当前为产品 MVP</strong><p>界面先定义自动化产品形态。下一阶段接入 Goose Recipe、计划任务和远程 Worker；企业级定时任务不会依赖用户电脑持续在线。</p></div>
      <div class="automation-list">
        ${automations.map(([name, schedule, description]) => `<article class="automation-card"><span class="automation-icon">${icon('automation')}</span><div><h3>${name}</h3><p>${description}</p><small>${schedule}</small></div><span class="planned-badge">规划中</span></article>`).join('')}
      </div>
    </div>
  `;
}

function renderAssistantsView() {
  return `
    <header class="simple-topbar"><div><h1>我的助理</h1><p>固定常用专家、工作区和输出偏好，快速发起日常任务</p></div><button class="primary-button small-button" data-nav="catalog">浏览专家</button></header>
    <div class="content-scroll page-content">
      <div class="assistant-grid">
        ${catalog.experts.slice(0, 4).map((expert) => `<article class="assistant-card"><span class="avatar">${expert.avatar}</span><h3>${expert.name}</h3><p>${expert.description}</p><button class="card-launch" data-expert-id="${expert.id}">发起任务 →</button></article>`).join('')}
      </div>
    </div>
  `;
}

function renderMoreView() {
  return `
    <header class="simple-topbar"><div><h1>产品路线</h1><p>保持 Goose 底座可更新，把气象业务、多用户和技能共享放在独立产品层</p></div></header>
    <div class="content-scroll page-content">
      <div class="roadmap-grid">
        ${[
          ['MVP', '桌面工作台、专家目录、本地任务、工作区选择、Goose 一次性执行'],
          ['下一阶段', 'ACP 多轮会话、气象数据 MCP、天气诊断 MCP、Office Artifact Service'],
          ['团队版', 'Go Control Plane、用户与空间、专家/技能/连接器注册中心、版本和权限'],
          ['高级模式', 'Codex Worker、文件 Diff、Git Worktree、安全命令执行和并行任务'],
        ].map(([title, text], index) => `<article class="roadmap-card"><span>0${index + 1}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}
      </div>
    </div>
  `;
}

function shortPath(value) {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : normalized;
}

