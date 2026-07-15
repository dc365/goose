const brand = window.METEOMATE_BRAND;
const catalog = Object.freeze({
  experts: window.METEOMATE_EXPERTS,
  teams: window.METEOMATE_TEAMS,
  skills: window.METEOMATE_SKILLS,
  connectors: window.METEOMATE_CONNECTORS,
  scenes: window.METEOMATE_SCENES,
  permissionProfiles: window.METEOMATE_PERMISSION_PROFILES,
});

const STORAGE_KEY = 'meteomate-desktop-state-v2';
const LEGACY_STORAGE_KEY = 'meteo-office-desktop-state-v1';

const initialState = {
  view: 'catalog',
  catalogTab: 'experts',
  category: '全部',
  search: '',
  teamMode: false,
  favoritesOnly: false,
  favoriteExpertIds: [],
  customExperts: [],
  projects: [],
  activeProjectId: null,
  tasks: [],
  activeTaskId: null,
  selectedExpertId: null,
  runtime: {
    state: 'starting',
    active: 'unknown',
    binaryAvailable: false,
    acpAvailable: false,
    headlessAvailable: false,
    error: null,
  },
};

const appElement = document.getElementById('app');
const runtimeRouter = new window.MeteoMateRuntime.RuntimeRouter();
let state = loadState();
let unsubscribeRuntimeEvents = null;

function defaultProjectFromLegacy(stored) {
  const workspace = typeof stored?.workspace === 'string' ? stored.workspace : '';
  if (!workspace) return [];
  return [
    {
      id: cryptoRandomId(),
      name: pathBaseName(workspace) || '气象办公空间',
      workspace,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
}

function migrateLegacyState() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    if (!legacy) return null;
    const projects = defaultProjectFromLegacy(legacy);
    const projectId = projects[0]?.id || null;
    const tasks = Array.isArray(legacy.tasks)
      ? legacy.tasks.map((task) => ({
          id: task.id || cryptoRandomId(),
          title: task.title || '历史任务',
          expertId: task.expertId || catalog.experts[0].id,
          expertName: task.expertName || catalog.experts[0].name,
          projectId,
          workspace: task.workspace || projects[0]?.workspace || '',
          status: task.status === 'running' ? 'interrupted' : task.status || 'completed',
          runtimeMode: task.mode || 'headless',
          runtimePreference: 'auto',
          sessionId: null,
          allowFileTools: Boolean(task.allowFileTools),
          messages: [
            ...(task.prompt
              ? [{ id: cryptoRandomId(), role: 'user', text: task.prompt, createdAt: task.createdAt || Date.now() }]
              : []),
            ...(task.output
              ? [{ id: cryptoRandomId(), role: 'assistant', text: task.output, createdAt: task.updatedAt || Date.now() }]
              : []),
          ],
          activities: [],
          artifacts: [],
          plan: createDefaultPlan(),
          pendingPermissions: [],
          createdAt: task.createdAt || Date.now(),
          updatedAt: task.updatedAt || Date.now(),
        }))
      : [];

    return {
      ...initialState,
      projects,
      activeProjectId: projectId,
      tasks,
      favoriteExpertIds: [],
    };
  } catch {
    return null;
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored) {
      const migrated = migrateLegacyState();
      if (migrated) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return structuredClone(initialState);
    }

    return {
      ...structuredClone(initialState),
      ...stored,
      runtime: structuredClone(initialState.runtime),
      activeTaskId: null,
      tasks: Array.isArray(stored.tasks)
        ? stored.tasks.map((task) => ({
            ...task,
            status: task.status === 'running' ? 'interrupted' : task.status,
            messages: Array.isArray(task.messages) ? task.messages : [],
            activities: Array.isArray(task.activities) ? task.activities : [],
            artifacts: Array.isArray(task.artifacts) ? task.artifacts : [],
            plan: Array.isArray(task.plan) && task.plan.length ? task.plan : createDefaultPlan(),
            pendingPermissions: [],
          }))
        : [],
      projects: Array.isArray(stored.projects) ? stored.projects : [],
      favoriteExpertIds: Array.isArray(stored.favoriteExpertIds) ? stored.favoriteExpertIds : [],
      customExperts: Array.isArray(stored.customExperts) ? stored.customExperts : [],
    };
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  const tasks = state.tasks.slice(0, 80).map((task) => ({
    ...task,
    messages: task.messages.slice(-120),
    activities: task.activities.slice(-80),
    artifacts: task.artifacts.slice(-40),
    pendingPermissions: [],
  }));
  const serializable = {
    ...state,
    runtime: undefined,
    activeTaskId: null,
    tasks,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function createDefaultPlan() {
  return [
    { id: 'prepare', title: '准备任务上下文与资料约束', status: 'pending' },
    { id: 'analyze', title: '调用专家能力与工具完成分析', status: 'pending' },
    { id: 'deliver', title: '整理结论、证据与成果物', status: 'pending' },
  ];
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function allExperts() {
  return [...catalog.experts, ...catalog.teams, ...state.customExperts];
}

function getExpert(expertId) {
  return allExperts().find((item) => item.id === expertId) || catalog.experts[0];
}

function getSelectedExpert() {
  return getExpert(state.selectedExpertId || catalog.experts[0].id);
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0] || null;
}

function getTaskProject(task) {
  return state.projects.find((project) => project.id === task?.projectId) || getActiveProject();
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
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pathBaseName(value) {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function shortPath(value) {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : normalized;
}

function truncate(value, limit = 80) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
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
    send: '<svg viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    tool: '<svg viewBox="0 0 24 24"><path d="m14 7 3-3 3 3-3 3"/><path d="m17 7-8 8"/><path d="M9 13 4 18l2 2 5-5"/></svg>',
  };
  return `<span class="icon">${icons[name] || icons.more}</span>`;
}

function runtimeLabel() {
  if (state.runtime.state === 'starting') return '正在连接 Goose';
  if (state.runtime.acpAvailable) return 'Goose ACP 已连接';
  if (state.runtime.headlessAvailable) return 'Headless 降级模式';
  return '演示模式';
}

function runtimeTone() {
  if (state.runtime.acpAvailable) return 'online';
  if (state.runtime.headlessAvailable) return 'warning';
  return 'demo';
}

function taskStatusText(status) {
  return (
    {
      draft: '草稿',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已停止',
      interrupted: '可继续',
    }[status] || status
  );
}

function render() {
  appElement.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <main class="main-shell">${renderMain()}</main>
    </div>
  `;
  bindEvents();
  requestAnimationFrame(() => {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
}

function renderSidebar() {
  const recentTasks = state.tasks.slice(0, 7);
  const recentProjects = state.projects.slice(0, 4);
  return `
    <aside class="sidebar">
      <div class="window-dots"><i></i><i></i><i></i></div>
      <div class="brand-row">
        <div class="brand-lockup">
          <strong>${brand.name}</strong>
          <span>${brand.chineseName} · ${brand.version}</span>
        </div>
        <button class="icon-button" data-nav="catalog" title="搜索专家">${icon('search')}</button>
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
          ${
            recentTasks.length
              ? recentTasks.map(renderSidebarTask).join('')
              : '<div class="sidebar-empty">还没有任务</div>'
          }
        </div>
      </section>
      <section class="sidebar-section workspace-section">
        <div class="sidebar-section-title"><span>空间 (${state.projects.length})</span><span>⌄</span></div>
        <div class="sidebar-list">
          ${
            recentProjects.length
              ? recentProjects.map(renderSidebarProject).join('')
              : `<button class="workspace-row empty-workspace" data-action="add-project">${icon('plus')}<span>添加本地项目</span></button>`
          }
        </div>
      </section>
      <div class="sidebar-footer">
        <span class="runtime-dot ${runtimeTone()}"></span>
        <span>${runtimeLabel()}</span>
      </div>
    </aside>
  `;
}

function navItem(view, iconName, label, active) {
  return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${view}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderSidebarTask(task) {
  return `
    <button class="sidebar-task ${state.activeTaskId === task.id ? 'active' : ''}" data-task-id="${task.id}">
      <span class="task-status ${task.status || 'draft'}"></span>
      <span class="task-copy">
        <strong>${escapeHtml(task.title)}</strong>
        <small>${escapeHtml(task.expertName)} · ${formatTime(task.updatedAt || task.createdAt)}</small>
      </span>
    </button>
  `;
}

function renderSidebarProject(project) {
  return `
    <button class="workspace-row ${state.activeProjectId === project.id ? 'active' : ''}" data-project-id="${project.id}">
      <span class="workspace-mark">${escapeHtml(project.name.slice(0, 1))}</span>
      <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></span>
      <span class="row-chevron">›</span>
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
  const allItems =
    tab === 'experts'
      ? state.teamMode
        ? catalog.teams
        : [...catalog.experts, ...state.customExperts]
      : tab === 'skills'
        ? catalog.skills
        : catalog.connectors;

  const query = state.search.trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    const categoryMatch = state.category === '全部' || item.category === state.category;
    const favoriteMatch =
      tab !== 'experts' || !state.favoritesOnly || state.favoriteExpertIds.includes(item.id);
    const haystack = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
    return categoryMatch && favoriteMatch && (!query || haystack.includes(query));
  });
  const categories = ['全部', ...new Set(allItems.map((item) => item.category))];

  return `
    <header class="topbar">
      <div class="top-tabs">
        ${catalogTabButton('experts', '专家')}
        ${catalogTabButton('skills', '技能')}
        ${catalogTabButton('connectors', '连接器')}
      </div>
      <div class="top-actions">
        <label class="search-box">${icon('search')}<input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="搜索专家名称或描述" /></label>
        <button class="my-experts ${state.favoritesOnly ? 'active' : ''}" id="toggle-favorites">${icon('star')} 我的专家</button>
      </div>
    </header>
    <div class="content-scroll">
      ${tab === 'experts' ? renderScenes() : ''}
      <section class="catalog-section">
        ${
          tab === 'experts'
            ? `
          <div class="section-heading expert-heading">
            <div class="mode-tabs">
              <button class="mode-tab ${!state.teamMode ? 'active' : ''}" data-team-mode="false">专家</button>
              <button class="mode-tab ${state.teamMode ? 'active' : ''}" data-team-mode="true">专家团</button>
            </div>
            <div class="sort-tabs"><button class="active">推荐</button><button>最新</button></div>
          </div>`
            : `
          <div class="section-heading">
            <div>
              <h2>${tab === 'skills' ? '技能中心' : '连接器中心'}</h2>
              <p>${tab === 'skills' ? '复用气象知识、工作流程、模板和脚本' : '连接气象数据、算法、知识库与办公系统'}</p>
            </div>
          </div>`
        }
        <div class="category-strip">
          ${categories
            .map(
              (category) =>
                `<button class="category-pill ${state.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
            )
            .join('')}
        </div>
        <div class="catalog-grid ${tab !== 'experts' ? 'compact' : ''}">
          ${
            filtered.length
              ? filtered
                  .map((item) =>
                    tab === 'experts' ? renderExpertCard(item) : renderCapabilityCard(item, tab)
                  )
                  .join('')
              : '<div class="empty-result">没有找到匹配内容</div>'
          }
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
      <div class="section-title-row">
        <div><h2>精选气象场景</h2><p>${brand.tagline}</p></div>
        <span class="runtime-chip ${runtimeTone()}">${runtimeLabel()}</span>
      </div>
      <div class="scene-grid">
        ${catalog.scenes
          .map(
            (scene) => `
          <button class="scene-card ${scene.gradient}" data-scene-id="${scene.id}">
            <span class="scene-orb">${scene.icon}</span>
            <span class="scene-copy"><strong>${scene.title}</strong><small>${scene.subtitle}</small></span>
            <span class="scene-arrow">›</span>
          </button>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderExpertCard(item) {
  const favorite = state.favoriteExpertIds.includes(item.id);
  return `
    <article class="expert-card">
      <div class="expert-top">
        <span class="avatar avatar-${item.avatar.codePointAt(0) % 6}">${escapeHtml(item.avatar)}</span>
        <div class="expert-title"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.owner)}</span></div>
        <button class="card-favorite ${favorite ? 'active' : ''}" data-favorite-id="${item.id}" title="收藏专家">${icon('star')}</button>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <button class="card-launch" data-expert-id="${item.id}">开始任务 <span>→</span></button>
    </article>
  `;
}

function renderCapabilityCard(item, tab) {
  const isRuntime = item.status === 'runtime';
  const statusText = isRuntime
    ? runtimeLabel()
    : item.status === 'planned'
      ? '待接入'
      : item.status === 'built-in'
        ? '已内置'
        : item.status === 'beta'
          ? 'Beta'
          : item.status;

  return `
    <article class="capability-card">
      <div class="capability-icon">${escapeHtml(item.icon)}</div>
      <div class="capability-copy"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category)}</span></div>
      <span class="capability-status ${isRuntime && state.runtime.acpAvailable ? 'ready' : ''}">${escapeHtml(statusText)}</span>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row small">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <button class="secondary-action" disabled>${tab === 'skills' ? '查看技能' : '配置连接器'}</button>
    </article>
  `;
}

function renderTaskView() {
  const task = getActiveTask();
  const expert = task ? getExpert(task.expertId) : getSelectedExpert();
  const project = task ? getTaskProject(task) : getActiveProject();
  const profile = catalog.permissionProfiles[expert.permissionProfile] || catalog.permissionProfiles['analysis-readonly'];
  const allowFileTools = task?.allowFileTools ?? false;
  const isRunning = task?.status === 'running';
  const messages = task?.messages || [];
  const pendingPermissions = task?.pendingPermissions || [];

  return `
    <header class="task-topbar">
      <button class="back-button" data-nav="catalog">${icon('back')} 返回专家中心</button>
      <div class="task-topbar-title">
        <span class="avatar small">${escapeHtml(expert.avatar)}</span>
        <div>
          <strong>${escapeHtml(task?.title || expert.name)}</strong>
          <small>${escapeHtml(expert.name)} · ${project ? escapeHtml(project.name) : '未选择项目'}</small>
        </div>
      </div>
      <div class="task-top-actions">
        <span class="runtime-chip ${runtimeTone()}">${task?.runtimeMode ? `${task.runtimeMode.toUpperCase()} · ${taskStatusText(task.status)}` : runtimeLabel()}</span>
        ${isRunning ? `<button class="danger-button compact" id="cancel-task">${icon('stop')} 停止</button>` : ''}
      </div>
    </header>
    <div class="task-layout">
      <aside class="task-context-panel">
        <div class="context-section">
          <span class="context-label">当前专家</span>
          <div class="selected-expert-card">
            <span class="avatar">${escapeHtml(expert.avatar)}</span>
            <div><strong>${escapeHtml(expert.name)}</strong><p>${escapeHtml(expert.description)}</p></div>
          </div>
        </div>
        <div class="context-section">
          <span class="context-label">项目工作区</span>
          <button class="workspace-context-card" id="choose-workspace">
            ${icon('folder')}
            <span>
              <strong>${project ? escapeHtml(project.name) : '选择本地项目'}</strong>
              <small>${project ? escapeHtml(shortPath(project.workspace)) : '用于资料、模板与成果物'}</small>
            </span>
          </button>
          ${project ? `<button class="inline-link" id="open-workspace">${icon('external')} 打开目录</button>` : ''}
        </div>
        <div class="context-section">
          <span class="context-label">权限策略</span>
          <label class="permission-toggle">
            <input id="allow-file-tools" type="checkbox" ${allowFileTools ? 'checked' : ''} ${isRunning ? 'disabled' : ''} />
            <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.description)}</small></span>
          </label>
          <div class="security-note">${icon('shield')} ACP 模式下写入与命令逐次审批；降级模式自动关闭文件工具。</div>
        </div>
        <div class="context-section session-meta">
          <span class="context-label">会话</span>
          <dl>
            <div><dt>Runtime</dt><dd>${escapeHtml(task?.runtimeMode || runtimeLabel())}</dd></div>
            <div><dt>Session</dt><dd>${task?.sessionId ? escapeHtml(task.sessionId.slice(0, 12)) : '未建立'}</dd></div>
            <div><dt>更新</dt><dd>${task ? formatDateTime(task.updatedAt) : '—'}</dd></div>
          </dl>
        </div>
      </aside>

      <section class="conversation-panel">
        <div class="conversation-scroll">
          ${
            messages.length
              ? messages.map(renderMessage).join('')
              : renderConversationWelcome(expert)
          }
        </div>
        <div class="composer-shell">
          <textarea
            id="task-prompt"
            placeholder="${task?.sessionId ? '继续追问、修改要求或补充资料…' : '描述一个气象办公任务…'}"
            ${isRunning ? 'disabled' : ''}
          ></textarea>
          <div class="composer-footer">
            <span>${task?.sessionId ? '将继续当前 Goose 会话' : state.runtime.acpAvailable ? '将创建可恢复的 ACP 会话' : '将使用安全降级模式'}</span>
            <button class="primary-button send-button" id="send-task" ${isRunning ? 'disabled' : ''}>
              ${icon('send')} ${task?.sessionId ? '继续任务' : '开始执行'}
            </button>
          </div>
        </div>
      </section>

      <aside class="inspector-panel">
        ${
          pendingPermissions.length
            ? `<section class="inspector-section permission-section">
                <div class="inspector-heading"><span>${icon('shield')} 待审批操作</span><em>${pendingPermissions.length}</em></div>
                ${pendingPermissions.map(renderPermissionCard).join('')}
              </section>`
            : ''
        }
        <section class="inspector-section">
          <div class="inspector-heading"><span>执行计划</span><small>${task ? taskStatusText(task.status) : '待开始'}</small></div>
          <div class="plan-list">${(task?.plan || createDefaultPlan()).map(renderPlanItem).join('')}</div>
        </section>
        <section class="inspector-section">
          <div class="inspector-heading"><span>工具与活动</span><small>${task?.activities?.length || 0}</small></div>
          <div class="activity-list">
            ${
              task?.activities?.length
                ? task.activities.slice(-10).reverse().map(renderActivityItem).join('')
                : '<div class="inspector-empty">工具调用、思考摘要和运行日志将在这里显示。</div>'
            }
          </div>
        </section>
        <section class="inspector-section">
          <div class="inspector-heading"><span>成果物</span><small>${task?.artifacts?.length || 0}</small></div>
          <div class="artifact-list">
            ${
              task?.artifacts?.length
                ? task.artifacts.map(renderArtifact).join('')
                : '<div class="inspector-empty">接入 Artifact MCP 后，可在此预览 Word、PDF、表格、PPT 和天气图。</div>'
            }
          </div>
        </section>
      </aside>
    </div>
  `;
}

function renderConversationWelcome(expert) {
  return `
    <div class="conversation-welcome">
      <span class="welcome-mark">${escapeHtml(expert.avatar)}</span>
      <h2>${escapeHtml(expert.name)}</h2>
      <p>${escapeHtml(expert.description)}</p>
      <div class="prompt-examples">
        ${expert.prompts
          .map(
            (prompt) =>
              `<button class="prompt-example" data-prompt-example="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderMessage(message) {
  const pending = message.status === 'streaming' && !message.text;
  return `
    <article class="message-row ${message.role}">
      <div class="message-avatar">${message.role === 'user' ? '我' : 'M'}</div>
      <div class="message-content">
        <div class="message-meta"><strong>${message.role === 'user' ? '你' : brand.name}</strong><span>${formatTime(message.createdAt)}</span></div>
        <div class="message-bubble ${pending ? 'typing' : ''}">
          ${pending ? '<i></i><i></i><i></i>' : `<pre>${escapeHtml(message.text || '')}</pre>`}
        </div>
      </div>
    </article>
  `;
}

function renderPlanItem(item) {
  return `
    <div class="plan-item ${item.status}">
      <span class="plan-check">${item.status === 'completed' ? icon('check') : item.status === 'running' ? '<i></i>' : ''}</span>
      <span>${escapeHtml(item.title)}</span>
    </div>
  `;
}

function renderActivityItem(activity) {
  return `
    <article class="activity-item ${activity.status || ''}">
      <span class="activity-icon">${activity.type === 'tool' ? icon('tool') : activity.type === 'error' ? '!' : '·'}</span>
      <div>
        <strong>${escapeHtml(activity.title || '运行活动')}</strong>
        <p>${escapeHtml(truncate(activity.detail || '', 110))}</p>
        <small>${formatTime(activity.createdAt)}</small>
      </div>
    </article>
  `;
}

function renderPermissionCard(permission) {
  const title = permission.toolCall?.title || permission.toolCall?.name || '高风险工具操作';
  const detail = permission.toolCall?.rawInput
    ? JSON.stringify(permission.toolCall.rawInput, null, 2)
    : permission.toolCall?.kind || '需要用户确认';
  return `
    <article class="permission-card">
      <strong>${escapeHtml(title)}</strong>
      <pre>${escapeHtml(truncate(detail, 240))}</pre>
      <div class="permission-actions">
        <button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="allow_once" class="primary-button compact">允许一次</button>
        <button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="always_allow" class="ghost-button compact">本会话允许</button>
        <button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="deny_once" class="danger-text-button">拒绝</button>
      </div>
    </article>
  `;
}

function renderArtifact(artifact) {
  return `
    <button class="artifact-item" ${artifact.path ? `data-open-artifact="${escapeHtml(artifact.path)}"` : 'disabled'}>
      <span>${icon('file')}</span>
      <span><strong>${escapeHtml(artifact.name)}</strong><small>${escapeHtml(artifact.type || '文件')}</small></span>
    </button>
  `;
}

function renderProjectsView() {
  return `
    <header class="simple-topbar">
      <div><h1>项目空间</h1><p>管理本地气象资料、算法工程、业务模板和成果物</p></div>
      <button class="primary-button small-button" data-action="add-project">${icon('plus')} 添加项目</button>
    </header>
    <div class="content-scroll page-content">
      ${
        state.projects.length
          ? `<div class="project-grid">${state.projects.map(renderProjectCard).join('')}</div>`
          : `<div class="large-empty">
              <span>${icon('folder')}</span><h2>创建第一个气象项目</h2>
              <p>选择本地目录后，任务、会话和成果物将与项目关联。</p>
              <button class="primary-button" data-action="add-project">${icon('plus')} 选择目录</button>
            </div>`
      }
      <div class="section-heading"><div><h2>推荐目录结构</h2><p>保持数据、模板、结果和临时文件分离</p></div></div>
      <div class="folder-grid">
        ${[
          'data/ 原始气象数据',
          'products/ 业务产品',
          'templates/ Word/PPT 模板',
          'figures/ 天气图与图表',
          'reports/ 分析与总结',
          '.agents/ 项目技能',
        ]
          .map(
            (folder, index) =>
              `<div class="folder-card"><span>${icon('folder')}</span><strong>${escapeHtml(folder)}</strong><small>${index < 2 ? '业务核心目录' : '建议创建'}</small></div>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderProjectCard(project) {
  const taskCount = state.tasks.filter((task) => task.projectId === project.id).length;
  return `
    <article class="project-card ${state.activeProjectId === project.id ? 'active' : ''}">
      <div class="project-card-icon">${escapeHtml(project.name.slice(0, 1))}</div>
      <div class="project-card-copy"><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.workspace)}</p><small>${taskCount} 个任务 · ${formatDateTime(project.updatedAt)}</small></div>
      <div class="project-card-actions">
        <button class="secondary-action" data-project-id="${project.id}">设为当前</button>
        <button class="icon-button" data-open-project="${escapeHtml(project.workspace)}">${icon('external')}</button>
      </div>
    </article>
  `;
}

function renderAutomationView() {
  const automations = [
    ['每日天气形势摘要', '每天 08:15', '读取最新资料，生成形势摘要和待确认清单'],
    ['强降水风险巡检', '每 3 小时', '运行诊断算法，发现高风险区后生成提醒'],
    ['周报材料汇总', '每周五 16:00', '汇总任务、图表和稿件，生成周报提纲'],
  ];
  return `
    <header class="simple-topbar"><div><h1>自动化</h1><p>把稳定流程保存为 Recipe，并在本地或服务端 Worker 中运行</p></div><button class="primary-button small-button" disabled>${icon('plus')} 新建自动化</button></header>
    <div class="content-scroll page-content">
      <div class="notice-card"><strong>Beta 路线</strong><p>当前先完成多轮会话、工具审批与项目工作台。下一阶段接入 Goose Recipe、定时任务和远程 Worker。</p></div>
      <div class="automation-list">
        ${automations
          .map(
            ([name, schedule, description]) =>
              `<article class="automation-card"><span class="automation-icon">${icon('automation')}</span><div><h3>${name}</h3><p>${description}</p><small>${schedule}</small></div><span class="planned-badge">规划中</span></article>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderAssistantsView() {
  const favorites = catalog.experts.filter((expert) => state.favoriteExpertIds.includes(expert.id));
  const experts = favorites.length ? favorites : catalog.experts.slice(0, 4);
  return `
    <header class="simple-topbar"><div><h1>我的助理</h1><p>固定常用专家、项目和权限偏好，快速发起日常任务</p></div><button class="primary-button small-button" data-nav="catalog">浏览专家</button></header>
    <div class="content-scroll page-content">
      <div class="assistant-grid">
        ${experts
          .map(
            (expert) =>
              `<article class="assistant-card"><span class="avatar">${expert.avatar}</span><h3>${expert.name}</h3><p>${expert.description}</p><button class="card-launch" data-expert-id="${expert.id}">发起任务 →</button></article>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderMoreView() {
  return `
    <header class="simple-topbar"><div><h1>${brand.name} 产品路线</h1><p>${brand.englishDescription}</p></div></header>
    <div class="content-scroll page-content">
      <section class="brand-hero">
        <div><span>${brand.chineseName}</span><h2>${brand.tagline}</h2><p>${brand.englishTagline}</p></div>
        <strong>${brand.name}</strong>
      </section>
      <div class="roadmap-grid">
        ${[
          ['Beta 0.2', 'Goose ACP 多轮会话、恢复、工具事件、用户审批、项目与任务持久化'],
          ['气象闭环', '气象数据 MCP、天气诊断 MCP、GIS 制图和 Word/PDF Artifact Service'],
          ['团队版', 'Go Control Plane、多用户空间、专家/技能/连接器共享、版本与审计'],
          ['高级模式', 'Codex Worker、文件 Diff、Git Worktree、安全命令执行和并行任务'],
        ]
          .map(
            ([title, text], index) =>
              `<article class="roadmap-card"><span>0${index + 1}</span><h3>${title}</h3><p>${text}</p></article>`
          )
          .join('')}
      </div>
    </div>
  `;
}
