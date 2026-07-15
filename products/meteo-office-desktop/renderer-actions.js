function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach((element) => {
    element.addEventListener('click', () => navigate(element.dataset.nav));
  });
  document.querySelectorAll('[data-action="projects"]').forEach((element) => {
    element.addEventListener('click', () => navigate('projects'));
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
  document.querySelectorAll('[data-task-id]').forEach((element) => {
    element.addEventListener('click', () => {
      state.activeTaskId = element.dataset.taskId;
      state.view = 'task';
      render();
    });
  });
  document.querySelectorAll('[data-scene-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const scene = catalog.scenes.find((item) => item.id === element.dataset.sceneId);
      if (scene?.experts?.length) openExpert(scene.experts[0]);
    });
  });
  document.querySelectorAll('[data-prompt-example]').forEach((element) => {
    element.addEventListener('click', () => {
      const textarea = document.getElementById('task-prompt');
      if (textarea && !textarea.disabled) textarea.value = element.dataset.promptExample;
    });
  });

  const search = document.getElementById('catalog-search');
  if (search) {
    search.addEventListener('input', (event) => {
      state.search = event.target.value;
      window.clearTimeout(search._renderTimer);
      search._renderTimer = window.setTimeout(render, 120);
    });
  }

  document.querySelectorAll('#choose-workspace').forEach((button) => button.addEventListener('click', chooseWorkspace));
  document.querySelectorAll('#open-workspace').forEach((button) => button.addEventListener('click', () => {
    const task = getActiveTask();
    window.meteoDesktop.openWorkspace(task?.workspace || state.workspace);
  }));

  const runButton = document.getElementById('run-task');
  if (runButton) runButton.addEventListener('click', runTask);
  const cancelButton = document.getElementById('cancel-task');
  if (cancelButton) cancelButton.addEventListener('click', cancelTask);
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

async function chooseWorkspace() {
  const selected = await window.meteoDesktop.chooseWorkspace();
  if (!selected) return;
  state.workspace = selected;
  const task = getActiveTask();
  if (task && task.status !== 'running') task.workspace = selected;
  saveState();
  render();
}

async function runTask() {
  const expert = getActiveTask()
    ? [...catalog.experts, ...catalog.teams].find((item) => item.id === getActiveTask().expertId)
    : getSelectedExpert() || catalog.experts[0];
  const textarea = document.getElementById('task-prompt');
  const prompt = textarea?.value.trim();
  if (!prompt) {
    textarea?.focus();
    textarea?.classList.add('field-error');
    return;
  }

  const allowFileTools = Boolean(document.getElementById('allow-file-tools')?.checked);
  const existing = getActiveTask();
  const task = existing || {
    id: cryptoRandomId(),
    expertId: expert.id,
    expertName: expert.name,
    title: prompt.length > 26 ? `${prompt.slice(0, 26)}…` : prompt,
    createdAt: Date.now(),
  };
  Object.assign(task, {
    prompt,
    workspace: state.workspace,
    allowFileTools,
    status: 'running',
    output: '',
    mode: null,
    updatedAt: Date.now(),
  });
  if (!existing) state.tasks.unshift(task);
  state.activeTaskId = task.id;
  saveState();
  render();

  try {
    const result = await window.meteoDesktop.runTask({
      taskId: task.id,
      expertName: expert.name,
      expertInstruction: expert.instruction,
      prompt,
      workspace: task.workspace,
      allowFileTools,
    });
    task.mode = result.mode;
    saveState();
  } catch (error) {
    task.status = 'failed';
    task.output += `\n启动失败：${error?.message || error}`;
    saveState();
    render();
  }
}

async function cancelTask() {
  const task = getActiveTask();
  if (!task) return;
  await window.meteoDesktop.cancelTask(task.id);
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function handleTaskEvent(event) {
  const task = state.tasks.find((item) => item.id === event.taskId);
  if (!task) return;
  if (event.type === 'started') {
    task.status = 'running';
    task.mode = event.mode;
  } else if (event.type === 'stdout') {
    task.output += event.data;
  } else if (event.type === 'stderr') {
    task.output += `\n${event.data}`;
  } else if (event.type === 'completed') {
    task.status = event.exitCode === 0 ? 'completed' : 'failed';
    task.mode = event.mode || task.mode;
    if (event.exitCode !== 0) task.output += `\n\n任务退出码：${event.exitCode}`;
  } else if (event.type === 'cancelled') {
    task.status = 'cancelled';
  } else if (event.type === 'error') {
    task.status = 'failed';
    task.output += `\n运行错误：${event.message}`;
  }
  task.updatedAt = Date.now();
  saveState();
  if (state.activeTaskId === task.id) render();
}

async function initialize() {
  state.runtime = await window.meteoDesktop.getRuntimeStatus();
  unsubscribeTaskEvents = window.meteoDesktop.onTaskEvent(handleTaskEvent);
  render();
}

window.addEventListener('beforeunload', () => unsubscribeTaskEvents?.());
initialize().catch((error) => {
  console.error(error);
  render();
});
