'use strict';

const api = window.meteoCompanion;
const body = document.body;
const mascotButton = document.getElementById('mascot-button');
const stateBadge = document.getElementById('state-badge');
const taskCountBadge = document.getElementById('task-count-badge');
const bubbleTitle = document.getElementById('bubble-title');
const bubbleText = document.getElementById('bubble-text');
const runtimeDot = document.getElementById('runtime-dot');
const runtimeLabel = document.getElementById('runtime-label');
const taskProject = document.getElementById('task-project');
const taskTitle = document.getElementById('task-title');
const taskStatus = document.getElementById('task-status');
const taskMeta = document.getElementById('task-meta');
const openTaskButton = document.getElementById('open-task-button');
const metricRunning = document.getElementById('metric-running');
const metricWaiting = document.getElementById('metric-waiting');
const metricCompleted = document.getElementById('metric-completed');
const recentCount = document.getElementById('recent-count');
const recentTaskList = document.getElementById('recent-task-list');

let snapshot = null;
let clickTimer = null;
let dragState = null;
let lastInteractive = true;

const BADGES = Object.freeze({
  waiting_approval: '!',
  waiting_input: '?',
  partial: '◐',
  completed: '✓',
  failed: '×',
  cancelled: 'Ⅱ',
  offline: 'Z',
});

const STATE_LABELS = Object.freeze({
  idle: '空闲',
  draft: '待开始',
  planning: '规划中',
  running: '运行中',
  waiting_input: '待输入',
  waiting_approval: '待审批',
  partial: '部分完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  offline: '离线',
});

function safeDateTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat('zh-CN', sameDay
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'numeric', day: 'numeric' }
  ).format(date);
}

function elapsedLabel(startedAt) {
  const start = Number(startedAt);
  if (!Number.isFinite(start) || start <= 0) return '';
  const seconds = Math.max(0, Math.round((Date.now() - start) / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function renderBadge(state, counts) {
  const badge = BADGES[state] || '';
  stateBadge.textContent = badge;
  stateBadge.style.display = badge ? 'grid' : '';
  const activeCount = Number(counts?.running || 0)
    + Number(counts?.waitingApproval || 0)
    + Number(counts?.waitingInput || 0);
  taskCountBadge.textContent = activeCount > 9 ? '9+' : String(activeCount);
  taskCountBadge.style.display = activeCount > 1 ? 'grid' : 'none';
}

function renderRuntime(runtime = {}) {
  runtimeDot.classList.toggle('online', runtime.online === true);
  runtimeDot.classList.toggle('offline', runtime.online === false);
  runtimeLabel.textContent = runtime.label
    || (runtime.online === true ? '运行时已连接' : runtime.online === false ? '模型服务未连接' : '正在连接运行时');
}

function taskMetaText(task) {
  if (!task) return '';
  const parts = [];
  const elapsed = elapsedLabel(task.startedAt);
  if (elapsed && ['planning', 'running', 'waiting_approval', 'waiting_input', 'partial'].includes(task.state)) {
    parts.push(`已运行 ${elapsed}`);
  }
  if (task.pendingApprovals) parts.push(`${task.pendingApprovals} 项待批准`);
  if (task.artifactCount) parts.push(`${task.artifactCount} 个成果物`);
  return parts.join(' · ');
}

function renderPrimaryTask(task) {
  taskProject.textContent = task?.projectName || '当前任务';
  taskTitle.textContent = task?.title || '暂无运行中的任务';
  taskStatus.textContent = task?.statusText || snapshot?.statusLabel || '随时可以开始';
  taskMeta.textContent = taskMetaText(task);
  openTaskButton.textContent = task ? '打开对应任务' : '打开 MeteoMate';
  openTaskButton.dataset.taskId = task?.id || '';
}

function recentTaskButton(task) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'recent-task';
  button.dataset.taskId = task.id;
  button.dataset.taskState = task.state;
  button.setAttribute('aria-label', `打开任务：${task.title}`);

  const dot = document.createElement('span');
  dot.className = 'recent-task-dot';

  const copy = document.createElement('span');
  copy.className = 'recent-task-copy';
  const title = document.createElement('strong');
  title.textContent = task.title;
  const detail = document.createElement('small');
  detail.textContent = `${STATE_LABELS[task.state] || task.state}${task.projectName ? ` · ${task.projectName}` : ''}`;
  copy.append(title, detail);

  const time = document.createElement('span');
  time.className = 'recent-task-time';
  time.textContent = safeDateTime(task.updatedAt);

  button.append(dot, copy, time);
  button.addEventListener('click', () => void api.action({ type: 'open-main', taskId: task.id }));
  return button;
}

function renderRecentTasks(tasks = []) {
  const visible = tasks.slice(0, 4);
  recentCount.textContent = `${tasks.length} 项`;
  recentTaskList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = '还没有任务记录。';
    recentTaskList.append(empty);
    return;
  }
  visible.forEach((task) => recentTaskList.append(recentTaskButton(task)));
}

function renderBubble(value) {
  const notification = value.notification;
  const task = value.primaryTask;
  bubbleTitle.textContent = notification?.title || task?.title || 'MeteoMate 桌面智伴';
  bubbleText.textContent = notification?.text || task?.statusText || value.statusLabel || '随时可以开始新的气象任务。';
  document.querySelectorAll('[data-action="open-main"]').forEach((button) => {
    if (button.closest('.bubble-card')) button.dataset.taskId = notification?.taskId || task?.id || '';
  });
}

function render(value) {
  snapshot = value || {};
  const visualState = snapshot.visualState || 'idle';
  const mode = snapshot.mode || 'avatar';
  body.dataset.state = visualState;
  body.dataset.mode = mode;
  body.classList.toggle('reduce-motion', Boolean(snapshot.settings?.reduceMotion));
  mascotButton.title = snapshot.primaryTask
    ? `${snapshot.primaryTask.title}：${snapshot.primaryTask.statusText || snapshot.statusLabel}`
    : snapshot.statusLabel || 'MeteoMate 桌面智伴';
  renderBadge(visualState, snapshot.counts);
  renderRuntime(snapshot.runtime);
  renderPrimaryTask(snapshot.primaryTask);
  renderBubble(snapshot);
  renderRecentTasks(snapshot.recentTasks || []);
  metricRunning.textContent = String(snapshot.counts?.running || 0);
  metricWaiting.textContent = String(
    Number(snapshot.counts?.waitingApproval || 0) + Number(snapshot.counts?.waitingInput || 0)
  );
  metricCompleted.textContent = String(snapshot.counts?.completedUnread || 0);
}

function actionForElement(element) {
  const button = element.closest('[data-action]');
  if (!button) return null;
  return {
    type: button.dataset.action,
    taskId: button.dataset.taskId || snapshot?.primaryTask?.id || '',
  };
}

document.addEventListener('click', (event) => {
  const action = actionForElement(event.target);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  void api.action(action);
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  void api.action({ type: 'context-menu' });
});

mascotButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || body.dataset.mode !== 'avatar') return;
  dragState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
    dragAllowed: !snapshot?.settings?.lockPosition,
  };
  mascotButton.setPointerCapture(event.pointerId);
  if (dragState.dragAllowed) {
    void api.action({ type: 'drag-start', screenX: event.screenX, screenY: event.screenY });
  }
});

mascotButton.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId || !dragState.dragAllowed) return;
  const distance = Math.hypot(event.screenX - dragState.startX, event.screenY - dragState.startY);
  if (distance > 4) dragState.moved = true;
  if (dragState.moved) {
    void api.action({ type: 'drag-move', screenX: event.screenX, screenY: event.screenY });
  }
});

function finishPointer(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const moved = dragState.moved;
  const dragAllowed = dragState.dragAllowed;
  dragState = null;
  try { mascotButton.releasePointerCapture(event.pointerId); } catch {}
  if (dragAllowed) void api.action({ type: 'drag-end' });
  if (moved) {
    clearTimeout(clickTimer);
    return;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    clickTimer = null;
    void api.action({ type: 'toggle-panel' });
  }, 360);
}

mascotButton.addEventListener('pointerup', finishPointer);
mascotButton.addEventListener('pointercancel', (event) => {
  if (dragState?.pointerId === event.pointerId) {
    const dragAllowed = dragState.dragAllowed;
    dragState = null;
    if (dragAllowed) void api.action({ type: 'drag-end' });
  }
});
mascotButton.addEventListener('click', (event) => {
  if (event.detail !== 0 || body.dataset.mode !== 'avatar') return;
  clearTimeout(clickTimer);
  clickTimer = null;
  void api.action({ type: 'toggle-panel' });
});
mascotButton.addEventListener('dblclick', (event) => {
  event.preventDefault();
  clearTimeout(clickTimer);
  clickTimer = null;
  void api.action({ type: 'open-main', taskId: snapshot?.primaryTask?.id || '' });
});

document.addEventListener('mousemove', (event) => {
  const nextInteractive = Boolean(event.target.closest('[data-interactive]'));
  if (nextInteractive === lastInteractive) return;
  lastInteractive = nextInteractive;
  void api.action({ type: 'set-interactive', interactive: nextInteractive });
});

document.addEventListener('mouseleave', () => {
  if (!lastInteractive) return;
  lastInteractive = false;
  void api.action({ type: 'set-interactive', interactive: false });
});

api.onState(render);
void api.getState().then(render).catch(() => {
  render({
    mode: 'avatar',
    visualState: 'offline',
    statusLabel: '桌面智伴暂时不可用',
    runtime: { online: false, label: '无法读取 MeteoMate 状态' },
    counts: {},
    recentTasks: [],
    settings: {},
  });
});
