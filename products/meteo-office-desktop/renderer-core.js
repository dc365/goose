const brand = window.METEOMATE_BRAND;
const catalog = Object.freeze({
  experts: window.METEOMATE_EXPERTS,
  teams: window.METEOMATE_TEAMS,
  skills: window.METEOMATE_SKILLS,
  connectors: window.METEOMATE_CONNECTORS,
  scenes: window.METEOMATE_SCENES,
  permissionProfiles: window.METEOMATE_PERMISSION_PROFILES,
});

const primaryAssistant = Object.freeze({
  id: 'meteomate-assistant',
  kind: 'assistant',
  name: 'MeteoMate 助理',
  avatar: 'M',
  description: '你的长期气象办公助理，可在固定工作区中持续对话、整理资料并协助推进日常任务。',
  instruction:
    '你是 MeteoMate 的长期个人助理。围绕用户的气象办公工作持续协作，记住当前会话上下文，优先使用用户指定的工作区资料。需要专业分析时调用合适的专家能力，但始终以一个统一助理身份与用户对话。',
  prompts: ['介绍一下你能帮我做什么', '整理当前工作区中的近期材料', '帮我规划今天的气象办公任务'],
  permissionProfile: 'artifact-approval',
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
  assistantWorkspace: '',
  tasks: [],
  activeTaskId: null,
  assistantTaskId: null,
  selectedExpertId: null,
  draftPermissionProfileId: null,
  draftModelId: null,
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
if (state.view === 'assistants') {
  state.activeTaskId =
    state.tasks.find((task) => task.id === state.assistantTaskId && task.kind === 'assistant')?.id ||
    state.tasks.find((task) => task.kind === 'assistant')?.id ||
    null;
}
let unsubscribeRuntimeEvents = null;
let responseElapsedTimer = null;
const modelSettings = {
  status: 'idle',
  providerId: '',
  modelId: '',
  providers: [],
  message: '',
  error: '',
};

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

    const storedPlan =
      Array.isArray(message.processPlan) && message.processPlan.length
        ? message.processPlan
        : fallbackPlan;
    const planTitles = new Map(createDefaultPlan().map((item) => [item.id, item.title]));
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
        ? stored.tasks.map(normalizeStoredTask)
        : [],
      projects: Array.isArray(stored.projects) ? stored.projects : [],
      favoriteExpertIds: Array.isArray(stored.favoriteExpertIds) ? stored.favoriteExpertIds : [],
      customExperts: Array.isArray(stored.customExperts) ? stored.customExperts : [],
    };
  } catch {
    return structuredClone(initialState);
  }
}

function normalizeStoredTask(task) {
  const messages = Array.isArray(task.messages) ? task.messages : [];
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const latestAssistant = assistantMessages.at(-1) || null;
  const normalizedMessages = messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const startedAt = message.startedAt || message.createdAt || task.createdAt || Date.now();
    const isLatest = message.id === latestAssistant?.id;
    const completedAt =
      message.completedAt ||
      (isLatest && task.status !== 'running' && task.updatedAt >= startedAt ? task.updatedAt : null);
    const completed = message.status !== 'streaming' || task.status !== 'running';
    const fallbackPlan = createDefaultPlan().map((item) => ({
      ...item,
      status: completed ? 'completed' : item.status,
    }));
    return {
      ...message,
      status: completed ? 'completed' : message.status,
      startedAt,
      completedAt,
      durationMs:
        message.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : null),
      runStatus: message.runStatus || (task.status === 'failed' && isLatest ? 'failed' : 'completed'),
      processPlan: storedPlan.map((item) => ({
        ...item,
        title: planTitles.get(item.id) || item.title,
      })),
      usage: message.usage || (isLatest ? task.usage || null : null),
      modelId: message.modelId || task.modelId || '',
    };
  });
  const normalizedAssistantMessages = normalizedMessages.filter((message) => message.role === 'assistant');
  const latestAssistantId = normalizedAssistantMessages.at(-1)?.id;
  const legacyResponseId = normalizedAssistantMessages.length === 1 ? latestAssistantId : null;
  const responseTiming = new Map(
    normalizedAssistantMessages.map((message) => [
      message.id,
      {
        startedAt: message.startedAt || 0,
        completedAt: message.completedAt || Number.POSITIVE_INFINITY,
        runStatus: message.runStatus,
      },
    ])
  );
  const activities = Array.isArray(task.activities)
    ? task.activities.map((activity) => {
        const responseId = activity.responseId || legacyResponseId || null;
        const timing = responseTiming.get(responseId);
        const createdAt = activity.createdAt || 0;
        const belongsToResponse =
          !timing || (createdAt >= timing.startedAt && createdAt <= timing.completedAt + 1000);
        return {
          ...activity,
          responseId: belongsToResponse ? responseId : null,
          status:
            belongsToResponse &&
            timing?.runStatus === 'completed' &&
            ['running', 'waiting', 'pending', 'in_progress'].includes(activity.status)
              ? 'completed'
              : activity.status,
        };
      })
    : [];
  return {
    ...task,
    status: task.status === 'running' ? 'interrupted' : task.status,
    messages: normalizedMessages,
    activities,
    artifacts: Array.isArray(task.artifacts) ? task.artifacts : [],
    plan: Array.isArray(task.plan) && task.plan.length ? task.plan : createDefaultPlan(),
    pendingPermissions: [],
  };
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
    { id: 'analyze', title: '调用所需能力与工具完成分析', status: 'pending' },
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
  if (expertId === primaryAssistant.id) return primaryAssistant;
  return allExperts().find((item) => item.id === expertId) || catalog.experts[0];
}

function getSelectedExpert() {
  if (state.view === 'assistants') return primaryAssistant;
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

function getAssistantTask() {
  return (
    state.tasks.find((task) => task.id === state.assistantTaskId && task.kind === 'assistant') ||
    state.tasks.find((task) => task.kind === 'assistant') ||
    null
  );
}

function getAssistantProject() {
  if (!state.assistantWorkspace) return null;
  return {
    id: 'meteomate-assistant-workspace',
    name: 'MeteoMate 工作区',
    workspace: state.assistantWorkspace,
  };
}

function getConversationProject(task) {
  return task?.kind === 'assistant' || (state.view === 'assistants' && !task)
    ? getAssistantProject(task)
    : getTaskProject(task);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMarkdown(value) {
  const source = String(value || '');
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    return `<p>${escapeHtml(source).replaceAll('\n', '<br />')}</p>`;
  }
  try {
    const parsed = window.marked.parse(source, {
      gfm: true,
      breaks: true,
    });
    const sanitized = window.DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio'],
      FORBID_ATTR: ['style', 'srcset'],
    });
    const template = document.createElement('template');
    template.innerHTML = sanitized;
    template.content.querySelectorAll('a').forEach((link) => {
      const targetUrl = link.getAttribute('href') || '';
      try {
        const parsedUrl = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol');
        link.setAttribute('href', '#');
        link.dataset.externalUrl = parsedUrl.toString();
        link.setAttribute('title', parsedUrl.toString());
      } catch {
        link.removeAttribute('href');
        link.classList.add('markdown-link-disabled');
      }
    });
    template.content.querySelectorAll('img').forEach((image) => {
      const sourceUrl = image.getAttribute('src') || '';
      if (!sourceUrl.startsWith('data:image/')) {
        image.replaceWith(document.createTextNode(`[图片：${image.getAttribute('alt') || '未命名'}]`));
      }
    });
    return template.innerHTML;
  } catch {
    return `<p>${escapeHtml(source).replaceAll('\n', '<br />')}</p>`;
  }
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

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1).replace('.0', '')}s`;
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
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
    arrowUp: '<svg viewBox="0 0 24 24"><path d="m6 11 6-6 6 6"/><path d="M12 5v14"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg>',
    tool: '<svg viewBox="0 0 24 24"><path d="m14 7 3-3 3 3-3 3"/><path d="m17 7-8 8"/><path d="M9 13 4 18l2 2 5-5"/></svg>',
    model: '<svg viewBox="0 0 24 24"><path d="M12 3 4.5 7.2 12 11.5l7.5-4.3L12 3Z"/><path d="m4.5 12 7.5 4.3 7.5-4.3M4.5 16.8 12 21l7.5-4.2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 2M18 15a7 7 0 0 1-11.9 3L4 16"/></svg>',
  };
  return `<span class="icon">${icons[name] || icons.more}</span>`;
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
  window.clearInterval(responseElapsedTimer);
  responseElapsedTimer = null;
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
    updateLiveResponseDurations();
    if (document.querySelector('.response-process.running .response-elapsed')) {
      responseElapsedTimer = window.setInterval(updateLiveResponseDurations, 250);
    }
  });
}

function updateLiveResponseDurations() {
  document.querySelectorAll('.response-process.running .response-elapsed').forEach((element) => {
    const startedAt = Number(element.dataset.startedAt);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      element.textContent = formatDuration(Math.max(0, Date.now() - startedAt));
    }
  });
}

function renderSidebar() {
  const taskHistory = state.tasks.filter((task) => task.kind !== 'assistant');
  const recentTasks = taskHistory.slice(0, 7);
  const recentProjects = state.projects.slice(0, 4);
  return `
    <aside class="sidebar">
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
        <div class="sidebar-section-title"><span>任务 (${taskHistory.length})</span><span>⌄</span></div>
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
    ? state.runtime.binaryAvailable
      ? '可用'
      : '未就绪'
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
      <span class="capability-status ${isRuntime && state.runtime.binaryAvailable ? 'ready' : ''}">${escapeHtml(statusText)}</span>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row small">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <button class="secondary-action" disabled>${tab === 'skills' ? '查看技能' : '配置连接器'}</button>
    </article>
  `;
}

function renderTaskView({ assistantMode = false } = {}) {
  const task = getActiveTask();
  const expert = assistantMode ? primaryAssistant : task ? getExpert(task.expertId) : getSelectedExpert();
  const project = assistantMode
    ? getAssistantProject(task)
    : task
      ? getTaskProject(task)
      : getActiveProject();
  const isRunning = task?.status === 'running';
  const messages = task?.messages || [];
  const pendingPermissions = task?.pendingPermissions || [];
  const defaultPermissionProfileId = expert.permissionProfile || 'analysis-readonly';
  const permissionProfileId =
    task?.permissionProfileId ||
    (task
      ? task.allowFileTools
        ? defaultPermissionProfileId
        : 'analysis-readonly'
      : state.draftPermissionProfileId || defaultPermissionProfileId);
  const profile =
    catalog.permissionProfiles[permissionProfileId] || catalog.permissionProfiles['analysis-readonly'];
  const permissionOptions = Object.values(catalog.permissionProfiles)
    .map(
      (entry) => {
        const selected = entry.id === profile.id;
        const optionIcon =
          entry.id === 'analysis-readonly'
            ? 'assistant'
            : entry.id === 'artifact-approval'
              ? 'shield'
              : 'folder';
        return `
          <button
            class="permission-option ${selected ? 'selected' : ''}"
            type="button"
            role="option"
            aria-selected="${selected}"
            data-permission-profile-id="${escapeHtml(entry.id)}"
          >
            <span class="permission-option-icon">${icon(optionIcon)}</span>
            <span class="permission-option-copy">
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.description)}</small>
            </span>
            <span class="permission-option-check">${selected ? icon('check') : ''}</span>
          </button>`;
      }
    )
    .join('');
  const selectedProviderId = task?.providerId || modelSettings.providerId;
  const provider =
    modelSettings.providers.find((entry) => entry.id === selectedProviderId) || null;
  const models = provider?.models || [];
  const selectedModelId =
    task?.modelId ?? state.draftModelId ?? modelSettings.modelId ?? provider?.defaultModel ?? '';
  const modelOptions = [
    `<option value="" ${selectedModelId ? '' : 'selected'}>自动选择</option>`,
    ...models.map(
      (entry) =>
        `<option value="${escapeHtml(entry.id)}" ${entry.id === selectedModelId ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`
    ),
  ].join('');
  const modelUnavailable =
    modelSettings.status === 'loading' || modelSettings.status === 'idle' || !provider;
  const modelPlaceholder = modelSettings.status === 'error' ? '模型不可用' : '读取模型中';
  const header = assistantMode
    ? `<header class="assistant-chat-topbar">
        <div class="assistant-chat-identity">
          <span class="avatar small">${escapeHtml(primaryAssistant.avatar)}</span>
          <div>
            <strong>${escapeHtml(primaryAssistant.name)}</strong>
            <small>默认工作区 · ${escapeHtml(project?.name || 'MeteoMate 工作区')}</small>
          </div>
        </div>
        ${isRunning ? `<button class="danger-button compact" id="cancel-task">${icon('stop')} 停止</button>` : ''}
      </header>`
    : `<header class="task-topbar">
        <button class="back-button" data-nav="catalog">${icon('back')} 返回专家中心</button>
        <div class="task-topbar-title">
          <span class="avatar small">${escapeHtml(expert.avatar)}</span>
          <div>
            <strong>${escapeHtml(task?.title || expert.name)}</strong>
            <small>${escapeHtml(expert.name)} · ${project ? escapeHtml(project.name) : '未选择项目'}</small>
          </div>
        </div>
        <div class="task-top-actions">
          ${isRunning ? `<button class="danger-button compact" id="cancel-task">${icon('stop')} 停止</button>` : ''}
        </div>
      </header>`;

  return `
    ${header}
    <section class="chat-workspace ${assistantMode ? 'assistant-chat-workspace' : ''}">
        <div class="conversation-scroll">
          ${
            messages.length
              ? messages.map((message) => renderMessage(message, task)).join('')
              : renderConversationWelcome(expert)
          }
          ${
            pendingPermissions.length
              ? `<section class="inline-permission-stack">
                  <div class="inline-permission-heading">
                    <span>${icon('shield')} 待确认操作</span>
                    <em>${pendingPermissions.length}</em>
                  </div>
                  ${pendingPermissions.map(renderPermissionCard).join('')}
                </section>`
              : ''
          }
        </div>
        <div class="composer-dock">
          <div class="composer-shell">
            <textarea
              id="task-prompt"
              placeholder="${task?.sessionId ? '继续追问、修改要求或补充资料…' : assistantMode ? '今天想和助理聊些什么？' : '描述一个气象办公任务…'}"
              ${isRunning ? 'disabled' : ''}
            ></textarea>
            <div class="composer-footer">
              <span>${isRunning ? '任务执行中' : '按 Command + Enter 发送'}</span>
              <div class="composer-primary-tools">
                <label class="composer-select composer-model-control ${modelUnavailable ? 'disabled' : ''}">
                  ${icon('model')}
                  <select id="composer-model" data-provider-id="${escapeHtml(provider?.id || '')}" aria-label="选择模型" ${isRunning || modelUnavailable ? 'disabled' : ''}>
                    ${modelUnavailable ? `<option>${modelPlaceholder}</option>` : modelOptions}
                  </select>
                </label>
                <button
                  class="primary-button send-icon-button"
                  id="send-task"
                  aria-label="${task?.sessionId ? '继续任务' : '开始执行'}"
                  title="${task?.sessionId ? '继续任务' : '开始执行'}"
                  ${isRunning ? 'disabled' : ''}
                >${icon('arrowUp')}</button>
              </div>
            </div>
          </div>
          <div class="composer-context-row">
            ${
              assistantMode
                ? `<span class="composer-context-status" title="${escapeHtml(project?.workspace || '')}">
                    ${icon('folder')}
                    <span>${escapeHtml(project?.name || 'MeteoMate 工作区')}</span>
                  </span>`
                : `<button class="composer-context-button" id="choose-workspace" ${isRunning ? 'disabled' : ''}>
                    ${icon('folder')}
                    <span>${project ? escapeHtml(project.name) : '选择工作区'}</span>
                  </button>`
            }
            ${project ? `<button class="composer-icon-button" id="open-workspace" title="打开工作区">${icon('external')}</button>` : ''}
            <div class="composer-permission-menu">
              <button
                class="composer-permission-trigger ${profile.fileTools ? 'elevated' : ''}"
                id="composer-permission"
                type="button"
                data-permission-profile-id="${escapeHtml(profile.id)}"
                aria-label="选择审批策略，当前为${escapeHtml(profile.name)}"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-controls="composer-permission-popover"
                title="${escapeHtml(profile.description)}"
                ${isRunning ? 'disabled' : ''}
              >
                ${icon('shield')}
                <span class="composer-permission-label">${escapeHtml(profile.name)}</span>
                ${icon('down')}
              </button>
              <div class="permission-popover" id="composer-permission-popover" role="listbox" hidden>
                <div class="permission-popover-heading">
                  <strong>应如何处理本地操作？</strong>
                  <small>权限策略仅作用于当前${assistantMode ? '助理会话' : '任务'}</small>
                </div>
                <div class="permission-option-list">${permissionOptions}</div>
              </div>
            </div>
            <span class="composer-security-copy">本地文件权限按所选策略执行</span>
          </div>
        </div>
    </section>
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

function renderMessage(message, task) {
  const pending = message.status === 'streaming' && !message.text;
  const process = message.role === 'assistant' ? renderResponseProcess(message, task) : '';
  const usage = message.role === 'assistant' ? renderResponseUsage(message, task) : '';
  return `
    <article class="message-row ${message.role}">
      <div class="message-avatar">${message.role === 'user' ? '我' : 'M'}</div>
      <div class="message-content">
        <div class="message-meta"><strong>${message.role === 'user' ? '你' : brand.name}</strong><span>${formatTime(message.createdAt)}</span></div>
        ${process}
        <div class="message-bubble ${pending ? 'typing' : ''}">
          ${
            pending
              ? '<i></i><i></i><i></i>'
              : message.role === 'assistant'
                ? `<div class="markdown-body">${renderMarkdown(message.text || '')}</div>`
                : `<pre>${escapeHtml(message.text || '')}</pre>`
          }
        </div>
        ${usage}
      </div>
    </article>
  `;
}

function renderResponseProcess(message, task) {
  const activities = (task?.activities || []).filter(
    (activity) => activity.responseId === message.id && activity.type !== 'info'
  );
  const processPlan = Array.isArray(message.processPlan) ? message.processPlan : [];
  const running = message.status === 'streaming';
  const durationMs = running
    ? Math.max(0, Date.now() - (message.startedAt || message.createdAt || Date.now()))
    : message.durationMs ??
      (message.completedAt && message.startedAt
        ? Math.max(0, message.completedAt - message.startedAt)
        : null);
  const statusText = running
    ? '执行中'
    : message.runStatus === 'failed'
      ? '未完成'
      : message.runStatus === 'cancelled'
        ? '已停止'
        : '已完成';
  const activityMarkup = activities.length
    ? activities.map(renderResponseActivity).join('')
    : '<p class="response-process-empty">本轮未调用外部工具。</p>';
  return `
    <details class="response-process ${running ? 'running' : ''}" ${running ? 'open' : ''}>
      <summary>
        <span>${statusText}<em class="response-elapsed" data-started-at="${message.startedAt || ''}">${formatDuration(durationMs)}</em></span>
        ${icon('down')}
      </summary>
      <div class="response-process-panel">
        <div class="response-process-heading">
          <strong>思考与执行过程</strong>
          <small>展示可核验的推理摘要、计划和工具活动</small>
        </div>
        ${processPlan.length ? `<div class="response-plan">${processPlan.map(renderPlanItem).join('')}</div>` : ''}
        <div class="response-activity-list">${activityMarkup}</div>
      </div>
    </details>
  `;
}

function renderResponseActivity(activity) {
  const rawDetail = String(activity.detail || '').trim();
  const cleanDetail = ['undefined', '"undefined"', 'null', '"null"', '{}', '[]'].includes(rawDetail)
    ? ''
    : rawDetail;
  const detail =
    activity.type === 'thought'
      ? '已分析任务目标、会话上下文与下一步行动。'
      : truncate(cleanDetail, 360);
  const activityIcon =
    activity.type === 'tool'
      ? icon('tool')
      : activity.type === 'permission'
        ? icon('shield')
        : activity.type === 'error'
          ? '!'
          : '·';
  return `
    <article class="response-activity ${activity.type || ''} ${activity.status || ''}">
      <span class="response-activity-icon">${activityIcon}</span>
      <div>
        <strong>${escapeHtml(activity.type === 'thought' ? '分析任务与上下文' : activity.title || '运行活动')}</strong>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
      </div>
      <small>${escapeHtml(activity.status === 'failed' || activity.status === 'cancelled' ? '失败' : activity.status === 'waiting' || activity.status === 'pending' ? '等待' : activity.status === 'running' || activity.status === 'in_progress' ? '进行中' : '完成')}</small>
    </article>
  `;
}

function renderResponseUsage(message, task) {
  const usage = message.usage || null;
  const modelId = message.modelId || task?.modelId || '';
  const parts = [];
  if (Number.isFinite(usage?.accumulatedOutputTokens)) {
    parts.push(`会话输出 ${formatTokenCount(usage.accumulatedOutputTokens)} tokens`);
  }
  if (Number.isFinite(usage?.accumulatedCost)) {
    parts.push(`累计 $${usage.accumulatedCost.toFixed(4)}`);
  }
  if (modelId) parts.push(modelId);
  if (!parts.length) return '';
  return `<div class="response-usage">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`;
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
  return renderTaskView({ assistantMode: true });
}

function renderMoreView() {
  const provider =
    modelSettings.providers.find((entry) => entry.id === modelSettings.providerId) || null;
  const models = provider?.models || [];
  const loading = modelSettings.status === 'loading' || modelSettings.status === 'saving';
  const hasProviders = modelSettings.providers.length > 0;
  const providerOptions = modelSettings.providers
    .map(
      (entry) =>
        `<option value="${escapeHtml(entry.id)}" ${entry.id === modelSettings.providerId ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`
    )
    .join('');
  const modelOptions = models.length
    ? models
        .map(
          (entry) =>
            `<option value="${escapeHtml(entry.id)}" ${entry.id === modelSettings.modelId ? 'selected' : ''}>${escapeHtml(entry.name)}${entry.recommended ? ' · 推荐' : ''}</option>`
        )
        .join('')
    : '<option value="">由 Provider 管理</option>';
  const currentProvider = provider?.name || '未读取';
  const currentModel = modelSettings.modelId || provider?.modelSelectionHint || '由 Provider 自动选择';
  return `
    <header class="simple-topbar">
      <div><h1>设置</h1><p>管理默认模型与产品信息</p></div>
    </header>
    <div class="content-scroll settings-page">
      <div class="settings-layout">
        <main class="settings-main">
          <section class="settings-panel">
            <div class="settings-panel-heading">
              <span class="settings-icon">${icon('model')}</span>
              <div><h2>默认模型</h2><p>用于之后新建的任务，已有会话继续使用原配置。</p></div>
            </div>
            ${modelSettings.status === 'loading' && !hasProviders ? '<div class="settings-loading">正在从 Goose 读取 Provider 与模型列表…</div>' : ''}
            ${modelSettings.error ? `<div class="settings-feedback error" role="alert">${escapeHtml(modelSettings.error)}</div>` : ''}
            ${modelSettings.message ? `<div class="settings-feedback success" role="status">${escapeHtml(modelSettings.message)}</div>` : ''}
            <div class="settings-form ${hasProviders ? '' : 'disabled'}">
              <label class="settings-field">
                <span>Provider</span>
                <select id="model-provider" ${loading || !hasProviders ? 'disabled' : ''}>
                  ${hasProviders ? providerOptions : '<option value="">暂无可用 Provider</option>'}
                </select>
                <small>${escapeHtml(provider?.description || '仅显示已在 Goose 中完成配置的 Provider。')}</small>
              </label>
              <label class="settings-field">
                <span>模型</span>
                <select id="model-id" ${loading || !hasProviders || !models.length ? 'disabled' : ''}>${modelOptions}</select>
                <small>${escapeHtml(provider?.modelSelectionHint || (models.length ? `共 ${models.length} 个可用模型` : '此 Provider 在自身服务中管理模型。'))}</small>
              </label>
            </div>
            <div class="settings-actions">
              <button class="primary-button" id="save-model-settings" ${loading || !hasProviders ? 'disabled' : ''}>${modelSettings.status === 'saving' ? '正在保存…' : '保存设置'}</button>
              <button class="secondary-action" id="reload-model-settings" ${loading ? 'disabled' : ''}>${icon('refresh')} 重新读取</button>
            </div>
          </section>
        </main>
        <aside class="settings-aside">
          <section class="settings-summary">
            <div class="settings-summary-heading"><h3>当前配置</h3></div>
            <p>之后新建的任务将默认使用以下配置。</p>
            <dl>
              <div><dt>Provider</dt><dd>${escapeHtml(currentProvider)}</dd></div>
              <div><dt>模型</dt><dd title="${escapeHtml(currentModel)}">${escapeHtml(currentModel)}</dd></div>
            </dl>
          </section>
          <section class="settings-summary about-summary">
            <span class="about-mark">MM</span>
            <div><h3>${brand.chineseName} ${brand.name}</h3><p>${brand.tagline}</p><small>Beta 0.2 · Goose powered</small></div>
          </section>
        </aside>
      </div>
    </div>
  `;
}
