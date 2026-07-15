function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach((element) => {
    element.addEventListener('click', () => navigate(element.dataset.nav));
  });

  document.querySelectorAll('[data-catalog-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      state.catalogTab = element.dataset.catalogTab;
      state.category = '全部';
      render();
    });
  });

  document.querySelectorAll('[data-team-mode]').forEach((element) => {
    element.addEventListener('click', () => {
      state.teamMode = element.dataset.teamMode === 'true';
      state.category = '全部';
      render();
    });
  });

  document.querySelectorAll('[data-category]').forEach((element) => {
    element.addEventListener('click', () => {
      state.category = element.dataset.category;
      render();
    });
  });

  document.querySelectorAll('[data-expert-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      openExpert(element.dataset.expertId);
    });
  });

  document.querySelectorAll('[data-favorite-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(element.dataset.favoriteId);
    });
  });

  document.querySelectorAll('[data-task-id]').forEach((element) => {
    element.addEventListener('click', () => {
      state.activeTaskId = element.dataset.taskId;
      state.view = 'task';
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-scene-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const scene = catalog.scenes.find((item) => item.id === element.dataset.sceneId);
      if (scene?.expertId) openExpert(scene.expertId);
    });
  });

  document.querySelectorAll('[data-prompt-example]').forEach((element) => {
    element.addEventListener('click', () => {
      const textarea = document.getElementById('task-prompt');
      if (textarea && !textarea.disabled) {
        textarea.value = element.dataset.promptExample;
        textarea.focus();
      }
    });
  });

  document.querySelectorAll('[data-action="add-project"]').forEach((element) => {
    element.addEventListener('click', addProject);
  });

  document.querySelectorAll('[data-project-id]').forEach((element) => {
    element.addEventListener('click', () => selectProject(element.dataset.projectId));
  });

  document.querySelectorAll('[data-open-project]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      window.meteoDesktop.openWorkspace(element.dataset.openProject);
    });
  });

  document.querySelectorAll('[data-open-artifact]').forEach((element) => {
    element.addEventListener('click', () => window.meteoDesktop.openWorkspace(element.dataset.openArtifact));
  });

  document.querySelectorAll('[data-permission-id]').forEach((element) => {
    element.addEventListener('click', () =>
      resolvePermission(element.dataset.permissionId, element.dataset.permissionAction)
    );
  });

  const search = document.getElementById('catalog-search');
  if (search) {
    search.addEventListener('input', (event) => {
      state.search = event.target.value;
      window.clearTimeout(search._renderTimer);
      search._renderTimer = window.setTimeout(render, 120);
    });
  }

  const favorites = document.getElementById('toggle-favorites');
  if (favorites) {
    favorites.addEventListener('click', () => {
      state.favoritesOnly = !state.favoritesOnly;
      render();
    });
  }

  const chooseWorkspace = document.getElementById('choose-workspace');
  if (chooseWorkspace) chooseWorkspace.addEventListener('click', chooseWorkspaceForTask);

  const openWorkspace = document.getElementById('open-workspace');
  if (openWorkspace) {
    openWorkspace.addEventListener('click', () => {
      const project = getTaskProject(getActiveTask());
      if (project?.workspace) window.meteoDesktop.openWorkspace(project.workspace);
    });
  }

  const sendButton = document.getElementById('send-task');
  if (sendButton) sendButton.addEventListener('click', sendTaskMessage);

  const cancelButton = document.getElementById('cancel-task');
  if (cancelButton) cancelButton.addEventListener('click', cancelTask);

  const prompt = document.getElementById('task-prompt');
  if (prompt) {
    prompt.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!prompt.disabled) sendTaskMessage();
      }
    });
  }
}

function navigate(view) {
  if (view === 'task-new') {
    state.selectedExpertId = catalog.experts[0].id;
    state.activeTaskId = null;
    state.view = 'task';
  } else {
    state.view = view;
    if (view !== 'task') state.activeTaskId = null;
  }
  saveState();
  render();
}

function openExpert(expertId) {
  state.selectedExpertId = expertId;
  state.activeTaskId = null;
  state.view = 'task';
  saveState();
  render();
}

function toggleFavorite(expertId) {
  const index = state.favoriteExpertIds.indexOf(expertId);
  if (index >= 0) state.favoriteExpertIds.splice(index, 1);
  else state.favoriteExpertIds.push(expertId);
  saveState();
  render();
}

async function addProject() {
  const workspace = await window.meteoDesktop.chooseWorkspace();
  if (!workspace) return null;
  const existing = state.projects.find((project) => project.workspace === workspace);
  if (existing) {
    state.activeProjectId = existing.id;
    existing.updatedAt = Date.now();
    saveState();
    render();
    return existing;
  }

  const project = {
    id: cryptoRandomId(),
    name: pathBaseName(workspace) || `气象项目 ${state.projects.length + 1}`,
    workspace,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  saveState();
  render();
  return project;
}

function selectProject(projectId) {
  state.activeProjectId = projectId;
  const task = getActiveTask();
  if (task && task.status !== 'running' && !task.sessionId) {
    task.projectId = projectId;
    task.workspace = getActiveProject()?.workspace || '';
  }
  saveState();
  render();
}

async function chooseWorkspaceForTask() {
  const project = await addProject();
  if (!project) return;
  const task = getActiveTask();
  if (task && task.status !== 'running' && !task.sessionId) {
    task.projectId = project.id;
    task.workspace = project.workspace;
    task.updatedAt = Date.now();
  }
  saveState();
  render();
}

function createTask(expert, prompt, allowFileTools) {
  const project = getActiveProject();
  const now = Date.now();
  const task = {
    id: cryptoRandomId(),
    title: truncate(prompt, 34),
    expertId: expert.id,
    expertName: expert.name,
    projectId: project?.id || null,
    workspace: project?.workspace || '',
    runtimePreference: 'auto',
    runtimeMode: null,
    sessionId: null,
    allowFileTools,
    status: 'draft',
    messages: [],
    plan: createDefaultPlan(),
    activities: [],
    artifacts: [],
    pendingPermissions: [],
    usage: null,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.unshift(task);
  state.activeTaskId = task.id;
  return task;
}

function appendMessage(task, role, text, status = 'completed') {
  const message = {
    id: cryptoRandomId(),
    role,
    text,
    status,
    createdAt: Date.now(),
  };
  task.messages.push(message);
  return message;
}

function currentStreamingAssistant(task) {
  for (let index = task.messages.length - 1; index >= 0; index -= 1) {
    const message = task.messages[index];
    if (message.role === 'assistant' && message.status === 'streaming') return message;
    if (message.role === 'user') break;
  }
  return null;
}

function ensureStreamingAssistant(task) {
  return currentStreamingAssistant(task) || appendMessage(task, 'assistant', '', 'streaming');
}

function markPlan(task, id, status) {
  const item = task.plan.find((candidate) => candidate.id === id);
  if (item) item.status = status;
}

function addActivity(task, activity) {
  task.activities.push({
    id: activity.id || cryptoRandomId(),
    type: activity.type || 'info',
    title: activity.title || '运行活动',
    detail: activity.detail || '',
    status: activity.status || 'running',
    createdAt: activity.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  if (task.activities.length > 80) task.activities.splice(0, task.activities.length - 80);
}

function updateActivity(task, id, patch) {
  const activity = task.activities.find((candidate) => candidate.id === id);
  if (activity) Object.assign(activity, patch, { updatedAt: Date.now() });
  else addActivity(task, { id, ...patch });
}

function transcriptForRuntime(task) {
  return task.messages
    .filter((message) => message.text && message.status !== 'streaming')
    .slice(-12)
    .map((message) => ({ role: message.role, text: message.text }));
}

async function sendTaskMessage() {
  const textarea = document.getElementById('task-prompt');
  const prompt = textarea?.value.trim();
  if (!prompt) {
    textarea?.focus();
    textarea?.classList.add('field-error');
    return;
  }

  const existing = getActiveTask();
  const expert = existing ? getExpert(existing.expertId) : getSelectedExpert();
  const allowFileTools = Boolean(document.getElementById('allow-file-tools')?.checked);
  const task = existing || createTask(expert, prompt, allowFileTools);
  const previousTranscript = transcriptForRuntime(task);

  task.allowFileTools = allowFileTools;
  task.workspace = getTaskProject(task)?.workspace || task.workspace || '';
  task.status = 'running';
  task.updatedAt = Date.now();
  task.pendingPermissions = [];
  markPlan(task, 'prepare', 'running');
  if (task.sessionId) {
    markPlan(task, 'prepare', 'completed');
    markPlan(task, 'analyze', 'running');
  }

  appendMessage(task, 'user', prompt);
  ensureStreamingAssistant(task);
  addActivity(task, {
    type: 'info',
    title: task.sessionId ? '继续现有会话' : '准备新任务',
    detail: task.sessionId ? `恢复 Goose Session ${task.sessionId}` : `专家：${expert.name}`,
    status: 'running',
  });

  textarea.value = '';
  saveState();
  render();

  try {
    const result = await runtimeRouter.send(task, {
      taskId: task.id,
      sessionId: task.sessionId,
      expertName: expert.name,
      expertInstruction: expert.instruction,
      prompt,
      workspace: task.workspace,
      allowFileTools,
      transcript: previousTranscript,
    });
    task.runtimeMode = result.runtime;
    if (result.sessionId) task.sessionId = result.sessionId;
    task.updatedAt = Date.now();
    saveState();
    render();
  } catch (error) {
    task.status = 'failed';
    const assistant = ensureStreamingAssistant(task);
    assistant.status = 'completed';
    assistant.text += `\n启动失败：${error?.message || error}`;
    addActivity(task, {
      type: 'error',
      title: '任务启动失败',
      detail: error?.message || String(error),
      status: 'failed',
    });
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

async function cancelTask() {
  const task = getActiveTask();
  if (!task) return;
  await runtimeRouter.cancel(task);
}

async function resolvePermission(permissionId, action) {
  const task = getActiveTask();
  if (!task) return;
  await runtimeRouter.resolvePermission(task, permissionId, action);
}

function extractArtifactCandidates(value) {
  let text = '';
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return [];
  }
  const pattern = /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[\w\u4e00-\u9fff ._()\-\\/]+\.(?:docx|xlsx|pptx|pdf|html|md|png|jpg|jpeg|webp|csv|geojson|tif|tiff)\b/gi;
  return [...new Set(text.match(pattern) || [])].slice(0, 8);
}

function registerArtifacts(task, source) {
  for (const candidate of extractArtifactCandidates(source)) {
    const name = pathBaseName(candidate);
    if (task.artifacts.some((artifact) => artifact.path === candidate || artifact.name === name)) continue;
    const isAbsolute = /^(?:[A-Za-z]:[\\/]|\/)/.test(candidate);
    const pathValue =
      !isAbsolute && task.workspace
        ? `${task.workspace.replace(/[\\/]$/, '')}/${candidate.replace(/^[.\\/]+/, '')}`
        : candidate;
    task.artifacts.push({
      id: cryptoRandomId(),
      name,
      path: pathValue,
      type: name.split('.').pop()?.toUpperCase() || 'FILE',
      createdAt: Date.now(),
    });
  }
}

function handleRuntimeEvent(event) {
  if (event.type === 'runtime_status') {
    state.runtime = { ...state.runtime, ...event.status };
    runtimeRouter.updateStatus(state.runtime);
    render();
    return;
  }

  const task = state.tasks.find((candidate) => candidate.id === event.taskId);
  if (!task) return;

  if (event.sessionId) task.sessionId = event.sessionId;
  if (event.runtime) task.runtimeMode = event.runtime;

  switch (event.type) {
    case 'session_started':
      addActivity(task, {
        type: 'info',
        title: 'ACP 会话已建立',
        detail: `Session ${event.sessionId}`,
        status: 'completed',
      });
      break;

    case 'turn_started':
      task.status = 'running';
      markPlan(task, 'prepare', 'completed');
      markPlan(task, 'analyze', 'running');
      updateActivity(task, task.activities.at(-1)?.id, { status: 'completed' });
      break;

    case 'assistant_message_delta': {
      const assistant = ensureStreamingAssistant(task);
      assistant.text += event.text || '';
      assistant.status = 'streaming';
      registerArtifacts(task, event.text || '');
      break;
    }

    case 'user_message_delta':
      break;

    case 'thought_delta': {
      const last = task.activities.at(-1);
      if (last?.type === 'thought' && last.status === 'running') {
        last.detail += event.text || '';
        last.updatedAt = Date.now();
      } else {
        addActivity(task, {
          type: 'thought',
          title: '分析进展',
          detail: event.text || '',
          status: 'running',
        });
      }
      break;
    }

    case 'tool_call_started':
      markPlan(task, 'analyze', 'running');
      addActivity(task, {
        id: event.toolCallId || cryptoRandomId(),
        type: 'tool',
        title: event.title || '调用工具',
        detail: event.rawInput ? JSON.stringify(event.rawInput) : event.kind || '',
        status: event.status || 'running',
      });
      break;

    case 'tool_call_updated':
      updateActivity(task, event.toolCallId || cryptoRandomId(), {
        type: 'tool',
        title: event.title || '工具执行',
        detail: event.rawOutput
          ? JSON.stringify(event.rawOutput)
          : event.content
            ? JSON.stringify(event.content)
            : '',
        status: event.status || 'running',
      });
      registerArtifacts(task, event.rawOutput);
      registerArtifacts(task, event.content);
      break;

    case 'permission_requested':
      task.pendingPermissions.push({
        id: event.permissionId,
        toolCall: event.toolCall,
        options: event.options,
        createdAt: Date.now(),
      });
      addActivity(task, {
        id: `permission-${event.permissionId}`,
        type: 'permission',
        title: '等待用户审批',
        detail: event.toolCall?.title || event.toolCall?.name || '高风险工具操作',
        status: 'waiting',
      });
      break;

    case 'permission_resolved':
      task.pendingPermissions = task.pendingPermissions.filter(
        (permission) => permission.id !== event.permissionId
      );
      updateActivity(task, `permission-${event.permissionId}`, {
        status: event.action?.startsWith('allow') ? 'completed' : 'failed',
        detail: `审批结果：${event.action}`,
      });
      break;

    case 'security_notice':
      addActivity(task, {
        type: 'warning',
        title: '安全降级',
        detail: event.message,
        status: 'completed',
      });
      break;

    case 'runtime_log':
      addActivity(task, {
        type: event.level === 'error' ? 'error' : 'info',
        title: event.level === 'error' ? 'Runtime 日志' : '运行日志',
        detail: event.text || '',
        status: event.level === 'error' ? 'failed' : 'completed',
      });
      break;

    case 'session_info':
      if (event.title && task.messages.length <= 2) task.title = event.title;
      break;

    case 'usage_update':
      task.usage = event.usage;
      break;

    case 'turn_completed': {
      task.status = 'completed';
      const assistant = ensureStreamingAssistant(task);
      assistant.status = 'completed';
      if (!assistant.text.trim()) assistant.text = '任务已完成，但 Runtime 没有返回可显示的文本。';
      task.activities.forEach((activity) => {
        if (activity.status === 'running') activity.status = 'completed';
      });
      markPlan(task, 'analyze', 'completed');
      markPlan(task, 'deliver', 'completed');
      break;
    }

    case 'turn_cancelled': {
      task.status = 'cancelled';
      const assistant = currentStreamingAssistant(task);
      if (assistant) {
        assistant.status = 'completed';
        if (!assistant.text.trim()) assistant.text = '任务已由用户停止。';
      }
      task.pendingPermissions = [];
      task.activities.forEach((activity) => {
        if (activity.status === 'running' || activity.status === 'waiting') activity.status = 'failed';
      });
      break;
    }

    case 'turn_failed': {
      task.status = 'failed';
      const assistant = ensureStreamingAssistant(task);
      assistant.status = 'completed';
      assistant.text += `${assistant.text ? '\n\n' : ''}运行失败：${event.message || '未知错误'}`;
      addActivity(task, {
        type: 'error',
        title: '任务执行失败',
        detail: event.message || '未知错误',
        status: 'failed',
      });
      task.pendingPermissions = [];
      task.plan.forEach((item) => {
        if (item.status === 'running') item.status = 'failed';
      });
      break;
    }

    default:
      break;
  }

  task.updatedAt = Date.now();
  const project = getTaskProject(task);
  if (project) project.updatedAt = task.updatedAt;
  saveState();
  if (state.activeTaskId === task.id) render();
}

async function initialize() {
  unsubscribeRuntimeEvents = runtimeRouter.subscribe(handleRuntimeEvent);
  runtimeRouter.updateStatus(state.runtime);
  render();
  try {
    state.runtime = await window.meteoDesktop.getRuntimeStatus();
    runtimeRouter.updateStatus(state.runtime);
  } catch (error) {
    state.runtime = {
      ...state.runtime,
      state: 'degraded',
      active: 'mock',
      error: error?.message || String(error),
    };
    runtimeRouter.updateStatus(state.runtime);
  }
  render();
}

window.addEventListener('beforeunload', () => unsubscribeRuntimeEvents?.());

initialize().catch((error) => {
  console.error(error);
  render();
});
