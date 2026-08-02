'use strict';

const WORK_AREA_INSET = 48;

const WINDOW_MODES = Object.freeze({
  account: Object.freeze({ width: 460, height: 560, minWidth: 420, minHeight: 520 }),
  workspace: Object.freeze({ width: 1360, height: 820, minWidth: 1040, minHeight: 680 }),
});

function availableDimension(value, fallback) {
  const measured = Number(value);
  if (!Number.isFinite(measured) || measured <= 0) return fallback;
  return Math.max(1, Math.floor(measured) - WORK_AREA_INSET);
}

function resolveWindowMode(mode, workArea = {}) {
  const target = WINDOW_MODES[mode];
  if (!target) throw new Error('Invalid window mode');
  const availableWidth = availableDimension(workArea.width, target.width);
  const availableHeight = availableDimension(workArea.height, target.height);
  const minWidth = Math.min(target.minWidth, availableWidth);
  const minHeight = Math.min(target.minHeight, availableHeight);
  return {
    width: Math.max(minWidth, Math.min(target.width, availableWidth)),
    height: Math.max(minHeight, Math.min(target.height, availableHeight)),
    minWidth,
    minHeight,
  };
}

module.exports = { WINDOW_MODES, WORK_AREA_INSET, resolveWindowMode };
