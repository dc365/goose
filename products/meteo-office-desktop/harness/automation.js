(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.Automation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const INTERVAL_UNITS = Object.freeze({
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  });

  function timeParts(value) {
    const [hours, minutes] = String(value || '08:00').split(':').map(Number);
    return {
      hours: Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 8,
      minutes: Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0,
    };
  }

  function uniqueWeekdays(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  }

  function recurringWeekdays(trigger) {
    if (trigger.cadence === 'workdays') return [1, 2, 3, 4, 5];
    if (trigger.cadence === 'weekly') {
      const selected = uniqueWeekdays(trigger.weekdays);
      return selected.length ? selected : [5];
    }
    return [0, 1, 2, 3, 4, 5, 6];
  }

  function recurringNext(trigger, after) {
    const allowed = new Set(recurringWeekdays(trigger));
    const { hours, minutes } = timeParts(trigger.time);
    const cursor = new Date(after);
    cursor.setSeconds(0, 0);
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(cursor);
      candidate.setDate(cursor.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (allowed.has(candidate.getDay()) && candidate.getTime() > after) return candidate.getTime();
    }
    return null;
  }

  function intervalNext(automation, after) {
    const trigger = automation.trigger || {};
    const value = Math.max(1, Number(trigger.intervalValue) || 1);
    const unitMs = INTERVAL_UNITS[trigger.intervalUnit] || INTERVAL_UNITS.hours;
    const step = value * unitMs;
    let candidate = Number(automation.lastRunAt || automation.createdAt || after) + step;
    while (candidate <= after) candidate += step;
    return candidate;
  }

  function computeNextRunAt(automation, after = Date.now()) {
    const trigger = automation?.trigger || {};
    if (trigger.mode === 'once') {
      const runAt = Date.parse(trigger.runAt || '');
      return Number.isFinite(runAt) ? runAt : null;
    }
    if (trigger.mode === 'interval') return intervalNext(automation, after);
    return recurringNext(trigger, after);
  }

  function normalizeAutomation(automation = {}, options = {}) {
    const now = options.now || Date.now();
    const trigger = Shared.cleanObject(automation.trigger);
    const taskTemplate = Shared.cleanObject(automation.taskTemplate);
    const executionPolicy = Shared.cleanObject(automation.executionPolicy);
    const connectorIds = Shared.uniqueStrings(taskTemplate.connectorIds || automation.connectorIds);
    const toolSelections = Shared.cleanObject(taskTemplate.toolSelections || automation.toolSelections);
    const capabilityMode = ['inherit', 'pinned'].includes(taskTemplate.capabilityMode)
      ? taskTemplate.capabilityMode
      : connectorIds.length || Object.keys(toolSelections).length ? 'pinned' : 'inherit';
    const normalized = {
      ...automation,
      apiVersion: automation.apiVersion || 'meteomate/v1',
      kind: 'Automation',
      id: automation.id || Shared.createId('automation'),
      name: automation.name || '未命名自动化',
      enabled: automation.enabled !== false,
      projectId: automation.projectId || '',
      taskTemplate: {
        prompt: taskTemplate.prompt || automation.prompt || '',
        expertId: taskTemplate.expertId || automation.expertId || '',
        skillIds: Shared.uniqueStrings(taskTemplate.skillIds || automation.skillIds),
        capabilityMode,
        connectorIds: capabilityMode === 'pinned' ? connectorIds : [],
        toolSelections: capabilityMode === 'pinned'
          ? Object.fromEntries(
              Object.entries(toolSelections)
                .filter(([connectorId, toolNames]) => connectorIds.includes(connectorId) && Array.isArray(toolNames))
                .map(([connectorId, toolNames]) => [connectorId, Shared.uniqueStrings(toolNames)])
            )
          : {},
        permissionProfileId: taskTemplate.permissionProfileId || automation.permissionProfileId || 'analysis-readonly',
        providerId: taskTemplate.providerId || automation.providerId || '',
        modelId: taskTemplate.modelId || automation.modelId || '',
      },
      trigger: {
        type: 'cron',
        mode: ['recurring', 'interval', 'once'].includes(trigger.mode) ? trigger.mode : 'recurring',
        cadence: ['daily', 'workdays', 'weekly'].includes(trigger.cadence) ? trigger.cadence : 'daily',
        time: /^\d{2}:\d{2}$/.test(trigger.time || '') ? trigger.time : '08:00',
        weekdays: uniqueWeekdays(trigger.weekdays || [5]),
        intervalValue: Math.max(1, Number(trigger.intervalValue) || 3),
        intervalUnit: INTERVAL_UNITS[trigger.intervalUnit] ? trigger.intervalUnit : 'hours',
        runAt: trigger.runAt || '',
      },
      executionPolicy: {
        mode: 'local-active',
        concurrent: false,
        approval: 'inherit-permission-profile',
        ...executionPolicy,
      },
      createdAt: automation.createdAt || now,
      updatedAt: automation.updatedAt || now,
      lastRunAt: automation.lastRunAt || null,
      nextRunAt: automation.nextRunAt || null,
      lastStatus: automation.lastStatus || 'never',
    };
    if (normalized.enabled && !normalized.nextRunAt) {
      normalized.nextRunAt = computeNextRunAt(normalized, options.after || now);
    }
    return normalized;
  }

  function scheduleLabel(automation) {
    const trigger = automation?.trigger || {};
    if (trigger.mode === 'once') {
      const date = new Date(trigger.runAt || '');
      return Number.isNaN(date.getTime())
        ? '单次执行时间未设置'
        : `单次 · ${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    }
    if (trigger.mode === 'interval') {
      const units = { minutes: '分钟', hours: '小时', days: '天' };
      return `每 ${trigger.intervalValue || 1} ${units[trigger.intervalUnit] || '小时'}`;
    }
    if (trigger.cadence === 'workdays') return `工作日 ${trigger.time || '08:00'}`;
    if (trigger.cadence === 'weekly') {
      const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const days = recurringWeekdays(trigger).map((day) => names[day]).join('、');
      return `每周 ${days} ${trigger.time || '08:00'}`;
    }
    return `每天 ${trigger.time || '08:00'}`;
  }

  function isDue(automation, now = Date.now()) {
    return Boolean(automation?.enabled && automation.nextRunAt && Number(automation.nextRunAt) <= now);
  }

  return { INTERVAL_UNITS, normalizeAutomation, computeNextRunAt, scheduleLabel, isDue };
});
