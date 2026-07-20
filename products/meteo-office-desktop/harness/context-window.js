(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ContextWindow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.8;
  const WARNING_MARGIN = 0.1;

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeAutoCompactThreshold(value) {
    const threshold = finiteNumber(value, DEFAULT_AUTO_COMPACT_THRESHOLD);
    return threshold > 0 && threshold < 1 ? threshold : DEFAULT_AUTO_COMPACT_THRESHOLD;
  }

  function mergeUsage(current, incoming) {
    return {
      ...(current && typeof current === 'object' ? current : {}),
      ...(incoming && typeof incoming === 'object' ? incoming : {}),
    };
  }

  function contextStatus({ usage = {}, modelContextLimit = 0, autoCompactThreshold, contextState = {} } = {}) {
    const threshold = normalizeAutoCompactThreshold(autoCompactThreshold);
    const rawUsed = usage.used ?? usage.totalTokens;
    const usedKnown = Number.isFinite(Number(rawUsed));
    const used = Math.max(0, finiteNumber(rawUsed, 0));
    const limit = Math.max(
      0,
      finiteNumber(usage.contextLimit ?? usage.size ?? modelContextLimit, 0)
    );
    const limitKnown = limit > 0;
    const known = usedKnown && limitKnown;
    const ratio = known ? Math.min(1, used / limit) : 0;
    const phase = ['compacting', 'compacted', 'failed'].includes(contextState.phase)
      ? contextState.phase
      : 'idle';
    const tone = phase === 'failed'
      ? 'danger'
      : phase === 'compacting'
        ? 'active'
        : phase === 'compacted'
          ? 'success'
          : ratio > threshold
            ? 'danger'
            : ratio >= Math.max(0, threshold - WARNING_MARGIN)
              ? 'warning'
              : 'normal';
    return {
      known,
      usedKnown,
      limitKnown,
      used,
      limit,
      remaining: known ? Math.max(0, limit - used) : null,
      ratio,
      percent: known ? Math.round(ratio * 100) : null,
      threshold,
      thresholdPercent: Math.round(threshold * 100),
      phase,
      tone,
      shouldCompact: known && ratio > threshold,
    };
  }

  function compactionStatus(update) {
    if (update?.sessionUpdate !== 'status_message') return null;
    const message = String(update.status?.message || '').trim();
    if (!/compact/i.test(message)) return null;
    if (/complete|completed/i.test(message)) return { phase: 'compacted', message };
    if (/fail|failed|error/i.test(message)) return { phase: 'failed', message };
    return { phase: 'compacting', message };
  }

  return {
    DEFAULT_AUTO_COMPACT_THRESHOLD,
    normalizeAutoCompactThreshold,
    mergeUsage,
    contextStatus,
    compactionStatus,
  };
});
