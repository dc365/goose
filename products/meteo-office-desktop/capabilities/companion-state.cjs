'use strict';

const MAX_TASKS = 48;
const MAX_RECENT_TASKS = 6;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const STATE_PRIORITY = Object.freeze({
  waiting_approval: 100,
  waiting_input: 90,
  failed: 80,
  running: 70,
  planning: 65,
  partial: 55,
  completed: 40,
  cancelled: 20,
  draft: 10,
  idle: 0,
});

const DEFAULT_COMPANION_PREFERENCES = Object.freeze({
  enabled: true,
  scale: 'medium',
  opacity: 1,
  showBubbles: true,
  lockPosition: false,
  showOnAllWorkspaces: true,
  showInFullscreen: false,
  reduceMotion: false,
  completionNotification: true,
  approvalNotification: true,
  failureNotification: true,
  keepRunningInBackground: true,
});

const VISUAL_LABELS = Object.freeze({
  idle: '随时可以开始',
  draft: '等待开始任务',
  planning: '正在规划任务',
  running: '正在处理任务',
  waiting_input: '需要你补充信息',
  waiting_approval: '等待你批准操作',
  partial: '已完成部分结果',
  completed: '任务已完成',
  failed: '任务执行失败',
  cancelled: '任务已停止',
  offline: '模型服务未连接',
});

const RUNTIME_STAGE_LABELS = Object.freeze({
  preparing_context: '正在准备任务资料',
  preparing_runtime: '正在连接模型与工具',
  model_requested: '正在等待模型响应',
  analyzing: '正在分析资料与证据',
  responding: '正在整理业务结果',
  compacting: '正在整理长期上下文',
});

function cleanText(value, limit = 80) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trim()}…`;
}

function finiteTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeDisplayLabel(value, fallback = '', limit = 80) {
  let text = String(value || '').trim();
  if (/^(?:file:\/\/|[a-zA-Z]:[\\/]|[\\/])/.test(text)) {
    text = text.replace(/^file:\/\//i, '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '';
  }
  return cleanText(text || fallback, limit);
}

function normalizeLifecycleState(value, task = {}) {
  if (Number(task.pendingApprovals || task.pendingPermissions?.length || 0) > 0) return 'waiting_approval';
  const normalized = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  const compact = normalized.replaceAll('_', '');
  const map = {
    draft: 'draft',
    idle: 'idle',
    planning: 'planning',
    waitinginput: 'waiting_input',
    waitingapproval: 'waiting_approval',
    running: 'running',
    partial: 'partial',
    interrupted: 'partial',
    completed: 'completed',
    complete: 'completed',
    succeeded: 'completed',
    success: 'completed',
    failed: 'failed',
    error: 'failed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    archived: 'completed',
  };
  return map[compact] || map[normalized] || 'draft';
}

function toolLabel(event = {}) {
  const raw = event.toolName || event.title || event.extensionName || '';
  const name = cleanText(raw, 34)
    .replace(/^.*(?:__|:)/, '')
    .replaceAll('_', ' ')
    .trim();
  return name || '业务工具';
}

function stageLabel(event = {}) {
  const type = String(event.type || '');
  if (type === 'runtime_progress') {
    return RUNTIME_STAGE_LABELS[event.stage] || '正在准备任务';
  }
  if (type === 'thought_delta') return '正在分析资料与证据';
  if (type === 'assistant_message_delta') return '正在整理业务结果';
  if (type === 'tool_call_started') return `正在使用 ${toolLabel(event)}`;
  if (type === 'tool_call_updated') {
    const status = String(event.status || '').toLowerCase();
    if (['failed', 'cancelled', 'canceled'].includes(status)) return `${toolLabel(event)} 未完成，正在调整`;
    if (status === 'completed') return `${toolLabel(event)} 已完成`;
    return `正在使用 ${toolLabel(event)}`;
  }
  if (type === 'team_started') return '专家团正在分工研判';
  if (type === 'team_member_started') return `${cleanText(event.member?.name || event.teamMemberName, 24) || '专家'}正在分析`;
  if (type === 'team_member_progress' || type === 'team_member_activity') {
    return cleanText(event.title || event.message || event.text, 56) || '专家团正在协同分析';
  }
  if (type === 'team_synthesis_started') return '正在汇总专家结论';
  if (type === 'artifact_created') return '已生成新的成果物';
  return '';
}

function normalizeRuntimeAvailability(event = {}, fallback = null) {
  if (typeof event.online === 'boolean') return event.online;
  if (typeof event.available === 'boolean') return event.available;
  if (event.acpAvailable === true || event.binaryAvailable === true || event.headlessAvailable === true) return true;
  const status = String(event.status || event.phase || '').toLowerCase();
  if (['ready', 'connected', 'available', 'running', 'online'].includes(status)) return true;
  if (['offline', 'unavailable', 'failed', 'disconnected'].includes(status)) return false;
  if (
    event.acpAvailable === false
    && event.binaryAvailable === false
    && event.headlessAvailable === false
  ) return false;
  return fallback;
}

function taskTitleFromSummary(task = {}) {
  return cleanText(task.title || task.name || task.expertName || 'MeteoMate 任务', 60);
}

function artifactSummary(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const title = safeDisplayLabel(value.title || value.name || value.label, '新成果物', 72);
  return {
    id: cleanText(value.id || value.artifactId, 120) || null,
    taskId: cleanText(value.taskId, 120) || null,
    title,
    format: cleanText(value.format || value.kind || value.type, 20),
    createdAt: finiteTime(value.createdAt || value.updatedAt, Date.now()),
  };
}

function createTask(id, now) {
  return {
    id,
    title: 'MeteoMate 任务',
    projectName: '',
    state: 'draft',
    statusText: '',
    sessionId: null,
    pendingApprovals: 0,
    artifactCount: 0,
    unread: false,
    startedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    notifiedTerminalState: '',
    lastTransitionKey: '',
  };
}

function cloneTask(task) {
  return { ...task };
}

function createInitialState(now = Date.now()) {
  return {
    revision: 0,
    runtime: {
      online: null,
      mode: '',
      label: '正在连接运行时',
      updatedAt: now,
    },
    tasks: Object.create(null),
    activeTaskId: null,
    latestArtifact: null,
    mainWindowVisible: true,
    updatedAt: now,
  };
}

function taskFor(state, taskId, now) {
  const id = cleanText(taskId, 120);
  if (!id) return null;
  if (!state.tasks[id]) state.tasks[id] = createTask(id, now);
  return state.tasks[id];
}

function terminalNotification(task, kind, now) {
  const titles = {
    completed: '任务已完成',
    failed: '任务执行失败',
    cancelled: '任务已停止',
  };
  const messages = {
    completed: task.statusText || '结果已准备好，可以打开 MeteoMate 查看。',
    failed: task.statusText || '请打开 MeteoMate 检查失败原因。',
    cancelled: task.statusText || '任务已停止，已保留停止前的可用结果。',
  };
  return {
    id: `${kind}:${task.id}:${now}`,
    kind,
    taskId: task.id,
    title: titles[kind],
    text: cleanText(`${task.title} · ${messages[kind]}`, 96),
    sticky: kind === 'failed',
    createdAt: now,
  };
}

function transitionNotification(task, previous, next, now) {
  const key = `${previous}->${next}`;
  if (task.lastTransitionKey === key && now - task.updatedAt < 2_000) return null;
  task.lastTransitionKey = key;
  if (next === 'waiting_approval') {
    return {
      id: `approval:${task.id}:${now}`,
      kind: 'approval',
      taskId: task.id,
      title: '等待操作批准',
      text: cleanText(`${task.title} 需要你确认一项操作。`, 96),
      sticky: true,
      createdAt: now,
    };
  }
  if (next === 'waiting_input') {
    return {
      id: `input:${task.id}:${now}`,
      kind: 'input',
      taskId: task.id,
      title: '需要补充信息',
      text: cleanText(`${task.title} 正在等待你的输入。`, 96),
      sticky: true,
      createdAt: now,
    };
  }
  if (TERMINAL_STATES.has(next) && task.notifiedTerminalState !== next) {
    task.notifiedTerminalState = next;
    return terminalNotification(task, next, now);
  }
  return null;
}

function markTaskState(task, nextState, now, statusText = '') {
  const previous = task.state;
  task.state = normalizeLifecycleState(nextState, task);
  if (statusText) task.statusText = cleanText(statusText, 72);
  task.updatedAt = now;
  if (!TERMINAL_STATES.has(task.state) && TERMINAL_STATES.has(previous)) {
    task.notifiedTerminalState = '';
    task.unread = false;
    task.endedAt = null;
  }
  if (['planning', 'running'].includes(task.state) && (
    !task.startedAt || TERMINAL_STATES.has(previous) || previous === 'draft' || previous === 'idle'
  )) {
    task.startedAt = now;
  }
  if (TERMINAL_STATES.has(task.state)) task.endedAt = now;
  if (['completed', 'failed'].includes(task.state) && previous !== task.state) task.unread = true;
  return transitionNotification(task, previous, task.state, now);
}

function mergeNotification(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  const priority = { approval: 100, input: 90, failed: 80, completed: 60, cancelled: 20 };
  return (priority[candidate.kind] || 0) >= (priority[current.kind] || 0) ? candidate : current;
}

function trimTasks(state) {
  const tasks = Object.values(state.tasks);
  if (tasks.length <= MAX_TASKS) return;
  const keep = new Set(
    tasks
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_TASKS)
      .map((task) => task.id)
  );
  if (state.activeTaskId) keep.add(state.activeTaskId);
  for (const id of Object.keys(state.tasks)) {
    if (!keep.has(id)) delete state.tasks[id];
  }
}

function handleRuntimeEventMutable(state, event = {}, now = Date.now()) {
  let notification = null;
  const type = String(event.type || '');
  if (!type) return { notification: null, clearNotificationTaskId: null };

  if (type === 'runtime_status') {
    state.runtime.online = normalizeRuntimeAvailability(event, state.runtime.online);
    state.runtime.mode = cleanText(event.runtime || event.mode, 24);
    state.runtime.label = state.runtime.online === false
      ? '模型服务未连接'
      : state.runtime.online === true ? '运行时已连接' : '正在连接运行时';
    state.runtime.updatedAt = now;
    state.updatedAt = now;
    state.revision += 1;
    return { notification: null, clearNotificationTaskId: null };
  }

  const task = taskFor(state, event.taskId, now);
  if (!task) return { notification: null, clearNotificationTaskId: null };
  state.activeTaskId = task.id;
  task.sessionId = cleanText(event.sessionId || task.sessionId, 160) || null;

  switch (type) {
    case 'runtime_progress':
      if (!['waiting_approval', 'waiting_input'].includes(task.state)) {
        notification = markTaskState(task, event.stage === 'preparing_context' ? 'planning' : 'running', now, stageLabel(event));
      }
      break;
    case 'turn_started':
      notification = markTaskState(task, 'running', now, '正在等待模型响应');
      break;
    case 'team_started':
    case 'team_member_started':
    case 'team_member_progress':
    case 'team_member_activity':
    case 'team_synthesis_started':
    case 'thought_delta':
    case 'assistant_message_delta':
    case 'tool_call_started':
    case 'tool_call_updated':
      if (!['waiting_approval', 'waiting_input'].includes(task.state)) {
        notification = markTaskState(task, 'running', now, stageLabel(event));
      }
      break;
    case 'permission_requested':
      task.pendingApprovals += 1;
      notification = markTaskState(task, 'waiting_approval', now, '等待你批准一项操作');
      break;
    case 'permission_resolved':
      task.pendingApprovals = Math.max(0, task.pendingApprovals - 1);
      if (task.pendingApprovals === 0) markTaskState(task, 'running', now, '审批已处理，正在继续任务');
      break;
    case 'artifact_created': {
      const artifact = artifactSummary({ ...(event.artifact || {}), taskId: task.id });
      if (artifact) {
        state.latestArtifact = artifact;
        task.artifactCount += 1;
      }
      if (!TERMINAL_STATES.has(task.state)) task.statusText = stageLabel(event);
      task.updatedAt = now;
      break;
    }
    case 'turn_completed':
    case 'team_completed':
      task.pendingApprovals = 0;
      notification = markTaskState(task, 'completed', now, '结果已准备好，可以打开查看');
      break;
    case 'turn_failed':
    case 'team_failed':
      task.pendingApprovals = 0;
      notification = markTaskState(task, 'failed', now, '请打开 MeteoMate 检查失败原因');
      break;
    case 'turn_cancelled':
    case 'team_cancelled':
      task.pendingApprovals = 0;
      notification = markTaskState(task, 'cancelled', now, '任务已停止');
      break;
    default:
      task.updatedAt = now;
      break;
  }

  state.updatedAt = now;
  state.revision += 1;
  trimTasks(state);
  return {
    notification,
    clearNotificationTaskId: type === 'permission_resolved' && task.pendingApprovals === 0 ? task.id : null,
  };
}

function summaryTaskState(task = {}) {
  const pendingApprovals = Number(task.pendingApprovals || task.pendingPermissionCount || task.pendingPermissions?.length || 0);
  return normalizeLifecycleState(task.lifecycleState || task.state || task.status, { pendingApprovals });
}

function syncSummaryMutable(state, summary = {}, now = Date.now()) {
  let notification = null;
  let clearNotificationTaskId = null;
  const items = Array.isArray(summary.tasks) ? summary.tasks.slice(0, MAX_TASKS) : [];
  for (const item of items) {
    const id = cleanText(item.id, 120);
    const existed = Boolean(id && state.tasks[id]);
    const task = taskFor(state, id, now);
    if (!task) continue;
    const previousState = task.state;
    task.title = taskTitleFromSummary(item);
    task.projectName = cleanText(item.projectName || item.project || '', 48);
    task.sessionId = cleanText(item.sessionId || task.sessionId, 160) || null;
    task.pendingApprovals = Math.max(0, Number(item.pendingApprovals || item.pendingPermissionCount || 0));
    task.artifactCount = Math.max(task.artifactCount, Number(item.artifactCount || item.artifacts?.length || 0));
    task.createdAt = finiteTime(item.createdAt, task.createdAt);
    task.startedAt = finiteTime(item.startedAt, task.startedAt);
    task.endedAt = finiteTime(item.endedAt || item.completedAt, task.endedAt);
    task.statusText = cleanText(item.statusText || item.stageLabel || task.statusText, 72);
    task.state = summaryTaskState(item);
    task.updatedAt = finiteTime(item.updatedAt, now);
    if (!TERMINAL_STATES.has(task.state) && TERMINAL_STATES.has(previousState)) {
      task.notifiedTerminalState = '';
      task.unread = false;
      task.endedAt = null;
    }
    const historicalTerminal = !existed && TERMINAL_STATES.has(task.state);
    if (historicalTerminal) {
      task.unread = false;
      task.notifiedTerminalState = task.state;
      task.lastTransitionKey = `${task.state}->${task.state}`;
    } else if (['completed', 'failed'].includes(task.state) && previousState !== task.state) {
      task.unread = true;
    }
    if (
      ['waiting_approval', 'waiting_input'].includes(previousState)
      && !['waiting_approval', 'waiting_input'].includes(task.state)
    ) {
      clearNotificationTaskId = task.id;
    }
    if (!historicalTerminal) {
      notification = mergeNotification(notification, transitionNotification(task, previousState, task.state, now));
    }
  }

  const requestedActive = cleanText(summary.activeTaskId, 120);
  if (requestedActive && state.tasks[requestedActive]) state.activeTaskId = requestedActive;
  state.mainWindowVisible = summary.mainWindowVisible !== false;
  const latestArtifact = artifactSummary(summary.latestArtifact);
  if (latestArtifact && (!state.latestArtifact || latestArtifact.createdAt >= state.latestArtifact.createdAt)) {
    state.latestArtifact = latestArtifact;
  }
  state.updatedAt = now;
  state.revision += 1;
  trimTasks(state);
  return { notification, clearNotificationTaskId };
}

function taskScore(task, activeTaskId) {
  const activeBoost = task.id === activeTaskId && !TERMINAL_STATES.has(task.state) ? 25 : 0;
  const unreadBoost = task.unread ? 6 : 0;
  const base = task.state === 'failed'
    ? task.unread ? STATE_PRIORITY.failed : 18
    : task.state === 'completed'
      ? task.unread ? STATE_PRIORITY.completed : 12
      : STATE_PRIORITY[task.state] || 0;
  return base + activeBoost + unreadBoost;
}

function selectPrimaryTask(state) {
  const candidates = Object.values(state.tasks).filter((task) =>
    !TERMINAL_STATES.has(task.state) || task.unread
  );
  return candidates
    .sort((left, right) =>
      taskScore(right, state.activeTaskId) - taskScore(left, state.activeTaskId)
      || right.updatedAt - left.updatedAt
    )[0] || null;
}

function publicTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    projectName: task.projectName,
    state: task.state,
    statusText: task.statusText || VISUAL_LABELS[task.state] || '',
    pendingApprovals: task.pendingApprovals,
    artifactCount: task.artifactCount,
    unread: task.unread,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    updatedAt: task.updatedAt,
  };
}

function snapshotOf(state) {
  const tasks = Object.values(state.tasks);
  const primary = selectPrimaryTask(state);
  const counts = {
    running: tasks.filter((task) => ['planning', 'running', 'partial'].includes(task.state)).length,
    waitingApproval: tasks.filter((task) => task.state === 'waiting_approval').length,
    waitingInput: tasks.filter((task) => task.state === 'waiting_input').length,
    failed: tasks.filter((task) => task.state === 'failed').length,
    completedUnread: tasks.filter((task) => task.state === 'completed' && task.unread).length,
  };
  const visualState = primary?.state || (state.runtime.online === false ? 'offline' : 'idle');
  const recentTasks = tasks
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_TASKS)
    .map(publicTask);
  return {
    revision: state.revision,
    visualState,
    statusLabel: primary?.statusText || VISUAL_LABELS[visualState] || VISUAL_LABELS.idle,
    runtime: { ...state.runtime },
    primaryTask: publicTask(primary),
    activeTaskId: state.activeTaskId,
    counts,
    recentTasks,
    latestArtifact: state.latestArtifact ? { ...state.latestArtifact } : null,
    mainWindowVisible: state.mainWindowVisible,
    updatedAt: state.updatedAt,
  };
}

function createCompanionStateStore({ now = () => Date.now() } = {}) {
  const state = createInitialState(now());
  return Object.freeze({
    handleRuntimeEvent(event) {
      return handleRuntimeEventMutable(state, event || {}, now());
    },
    syncSummary(summary) {
      return syncSummaryMutable(state, summary || {}, now());
    },
    markRead(taskId) {
      const task = state.tasks[cleanText(taskId, 120)];
      if (!task) return false;
      task.unread = false;
      task.updatedAt = now();
      state.revision += 1;
      return true;
    },
    setMainWindowVisible(visible) {
      state.mainWindowVisible = Boolean(visible);
      state.revision += 1;
    },
    snapshot() {
      return snapshotOf(state);
    },
    reset() {
      const fresh = createInitialState(now());
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, fresh);
    },
  });
}

module.exports = {
  DEFAULT_COMPANION_PREFERENCES,
  MAX_TASKS,
  STATE_PRIORITY,
  VISUAL_LABELS,
  cleanText,
  safeDisplayLabel,
  normalizeLifecycleState,
  normalizeRuntimeAvailability,
  stageLabel,
  createInitialState,
  handleRuntimeEventMutable,
  syncSummaryMutable,
  snapshotOf,
  createCompanionStateStore,
};
