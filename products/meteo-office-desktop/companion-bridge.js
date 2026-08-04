'use strict';

(function installCompanionBridge() {
  if (!window.meteoDesktop?.syncCompanionSummary || typeof state === 'undefined') return;

  let lastSerialized = '';
  let syncPending = false;
  let disposed = false;

  function cleanText(value, limit = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
  }

  function normalizedTaskState(task = {}) {
    if ((task.pendingPermissions || []).length) return 'WAITING_APPROVAL';
    const raw = String(task.lifecycleState || task.status || 'DRAFT').toUpperCase().replaceAll('-', '_');
    const map = {
      INTERRUPTED: 'PARTIAL',
      CANCELED: 'CANCELLED',
      COMPLETE: 'COMPLETED',
      SUCCESS: 'COMPLETED',
      ERROR: 'FAILED',
    };
    return map[raw] || raw;
  }

  function taskTitle(task = {}) {
    return cleanText(task.title || task.expertName || 'MeteoMate 任务', 60);
  }

  function taskProjectName(task) {
    let project = null;
    try {
      if (typeof getConversationProject === 'function') project = getConversationProject(task);
      else if (typeof getTaskProject === 'function') project = getTaskProject(task);
    } catch {}
    if (!project && task?.projectId) project = (state.projects || []).find((item) => item.id === task.projectId);
    return cleanText(project?.name || '', 48);
  }

  function taskStatusText(task = {}) {
    const lifecycle = normalizedTaskState(task);
    return ({
      DRAFT: '等待开始任务',
      PLANNING: '正在规划任务',
      WAITING_INPUT: '需要你补充信息',
      WAITING_APPROVAL: '等待你批准操作',
      RUNNING: '正在处理任务',
      PARTIAL: '已完成部分结果',
      COMPLETED: '结果已准备好',
      FAILED: '任务执行失败',
      CANCELLED: '任务已停止',
      ARCHIVED: '任务已归档',
    })[lifecycle] || '任务状态已更新';
  }

  function taskArtifactCount(task = {}) {
    const artifacts = Array.isArray(task.artifacts) ? task.artifacts.length : 0;
    const ids = Array.isArray(task.artifactIds) ? task.artifactIds.length : 0;
    return Math.max(artifacts, ids);
  }

  function taskSummary(task = {}) {
    return {
      id: String(task.id || ''),
      title: taskTitle(task),
      projectName: taskProjectName(task),
      lifecycleState: normalizedTaskState(task),
      status: String(task.status || ''),
      statusText: taskStatusText(task),
      pendingApprovals: (task.pendingPermissions || []).length,
      artifactCount: taskArtifactCount(task),
      createdAt: Number(task.createdAt || 0) || null,
      startedAt: Number(task.runAttempts?.at(-1)?.startedAt || task.startedAt || 0) || null,
      endedAt: Number(task.runAttempts?.at(-1)?.completedAt || task.completedAt || 0) || null,
      updatedAt: Number(task.updatedAt || task.lifecycleUpdatedAt || task.createdAt || Date.now()),
    };
  }

  function latestArtifact(tasks) {
    const candidates = tasks.flatMap((task) =>
      (Array.isArray(task.artifacts) ? task.artifacts : []).map((artifact) => ({
        id: artifact?.id || null,
        taskId: task.id,
        title: (() => {
          const raw = String(artifact?.title || artifact?.name || '新成果物').trim();
          const label = /^(?:file:\/\/|[a-zA-Z]:[\\/]|[\\/])/.test(raw)
            ? raw.replace(/^file:\/\//i, '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '新成果物'
            : raw;
          return cleanText(label, 72);
        })(),
        format: cleanText(artifact?.format || artifact?.kind || artifact?.type || '', 20),
        createdAt: Number(artifact?.createdAt || artifact?.updatedAt || task.updatedAt || 0),
      }))
    );
    return candidates.sort((left, right) => right.createdAt - left.createdAt)[0] || null;
  }

  function buildSummary() {
    const tasks = [...(state.tasks || [])]
      .filter((task) => task?.id)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 48);
    return {
      activeTaskId: state.activeTaskId || state.assistantTaskId || null,
      tasks: tasks.map(taskSummary),
      latestArtifact: latestArtifact(tasks),
      mainWindowVisible: document.visibilityState !== 'hidden',
    };
  }

  async function sync({ force = false } = {}) {
    if (disposed || syncPending) return;
    const payload = buildSummary();
    const serialized = JSON.stringify(payload);
    if (!force && serialized === lastSerialized) return;
    syncPending = true;
    try {
      await window.meteoDesktop.syncCompanionSummary(payload);
      lastSerialized = serialized;
    } catch {
      // The companion is optional. Main workspace operation must remain unaffected.
    } finally {
      syncPending = false;
    }
  }

  function focusTask(request = {}) {
    const taskId = String(request.taskId || '');
    if (!taskId) return;
    const task = (state.tasks || []).find((item) => item.id === taskId);
    if (!task) return;
    state.activeTaskId = task.id;
    if (task.projectId) state.activeProjectId = task.projectId;
    state.view = 'task';
    if (typeof saveState === 'function') saveState();
    if (typeof render === 'function') render();
    void sync({ force: true });
  }

  const unsubscribe = window.meteoDesktop.onCompanionFocusTask?.(focusTask) || (() => {});
  const timer = window.setInterval(() => void sync(), 900);
  window.addEventListener('focus', () => void sync({ force: true }));
  document.addEventListener('visibilitychange', () => void sync({ force: true }));
  window.addEventListener('beforeunload', () => {
    disposed = true;
    window.clearInterval(timer);
    unsubscribe();
  }, { once: true });

  void sync({ force: true });
})();
