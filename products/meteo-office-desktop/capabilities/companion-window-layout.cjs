'use strict';

const EDGE_INSET = 16;
const TOP_INSET = 12;
const BOTTOM_INSET = 16;
const SCALE_FACTORS = Object.freeze({ small: 0.84, medium: 1, large: 1.18 });
const BASE_SIZES = Object.freeze({
  avatar: Object.freeze({ width: 132, height: 132 }),
  bubble: Object.freeze({ width: 372, height: 168 }),
  panel: Object.freeze({ width: 380, height: 486 }),
});

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

function normalizedWorkArea(display = {}) {
  const area = display.workArea && typeof display.workArea === 'object' ? display.workArea : display;
  const width = Math.max(1, Math.round(Number(area.width) || 1440));
  const height = Math.max(1, Math.round(Number(area.height) || 900));
  return {
    x: Math.round(Number(area.x) || 0),
    y: Math.round(Number(area.y) || 0),
    width,
    height,
  };
}

function normalizedScale(scale) {
  return Object.hasOwn(SCALE_FACTORS, scale) ? scale : 'medium';
}

function windowSize(mode = 'avatar', scale = 'medium') {
  const base = BASE_SIZES[mode] || BASE_SIZES.avatar;
  if (mode !== 'avatar') return { ...base };
  const factor = SCALE_FACTORS[normalizedScale(scale)];
  return {
    width: Math.round(base.width * factor),
    height: Math.round(base.height * factor),
  };
}

function displayKey(display = {}) {
  const id = display.id ?? display.displayId ?? 'primary';
  return String(id);
}

function defaultAnchor(display = {}, scale = 'medium') {
  const area = normalizedWorkArea(display);
  const avatar = windowSize('avatar', scale);
  return {
    displayId: displayKey(display),
    edge: 'right',
    y: clamp(
      area.y + area.height - avatar.height - 76,
      area.y + TOP_INSET,
      area.y + area.height - avatar.height - BOTTOM_INSET,
    ),
  };
}

function normalizeAnchor(anchor = {}, display = {}, scale = 'medium') {
  const area = normalizedWorkArea(display);
  const avatar = windowSize('avatar', scale);
  const fallback = defaultAnchor(display, scale);
  const edge = anchor.edge === 'left' ? 'left' : anchor.edge === 'right' ? 'right' : fallback.edge;
  return {
    displayId: displayKey(display),
    edge,
    y: clamp(
      Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : fallback.y,
      area.y + TOP_INSET,
      area.y + area.height - avatar.height - BOTTOM_INSET,
    ),
  };
}

function boundsForMode({ mode = 'avatar', anchor = {}, display = {}, scale = 'medium' } = {}) {
  const area = normalizedWorkArea(display);
  const normalized = normalizeAnchor(anchor, display, scale);
  const size = windowSize(mode, scale);
  const avatarSize = windowSize('avatar', scale);
  const x = normalized.edge === 'left'
    ? area.x + EDGE_INSET
    : area.x + area.width - size.width - EDGE_INSET;
  const yOffset = mode === 'panel' ? 54 : mode === 'bubble' ? 18 : 0;
  const preferredY = normalized.y - yOffset;
  const y = clamp(
    preferredY,
    area.y + TOP_INSET,
    area.y + area.height - size.height - BOTTOM_INSET,
  );
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height,
    edge: normalized.edge,
    displayId: normalized.displayId,
    avatarY: clamp(
      normalized.y,
      area.y + TOP_INSET,
      area.y + area.height - avatarSize.height - BOTTOM_INSET,
    ),
  };
}

function dragBounds({ startBounds = {}, startPointer = {}, pointer = {}, display = {} } = {}) {
  const area = normalizedWorkArea(display);
  const width = Math.max(1, Math.round(Number(startBounds.width) || BASE_SIZES.avatar.width));
  const height = Math.max(1, Math.round(Number(startBounds.height) || BASE_SIZES.avatar.height));
  const dx = Number(pointer.x ?? pointer.screenX) - Number(startPointer.x ?? startPointer.screenX);
  const dy = Number(pointer.y ?? pointer.screenY) - Number(startPointer.y ?? startPointer.screenY);
  return {
    x: Math.round(clamp(
      Number(startBounds.x) + (Number.isFinite(dx) ? dx : 0),
      area.x,
      area.x + area.width - width,
    )),
    y: Math.round(clamp(
      Number(startBounds.y) + (Number.isFinite(dy) ? dy : 0),
      area.y,
      area.y + area.height - height,
    )),
    width,
    height,
  };
}

function anchorFromBounds(bounds = {}, display = {}, scale = 'medium') {
  const area = normalizedWorkArea(display);
  const avatar = windowSize('avatar', scale);
  const center = Number(bounds.x) + Number(bounds.width || avatar.width) / 2;
  const displayCenter = area.x + area.width / 2;
  return normalizeAnchor({
    edge: center < displayCenter ? 'left' : 'right',
    y: clamp(
      Number(bounds.y),
      area.y + TOP_INSET,
      area.y + area.height - avatar.height - BOTTOM_INSET,
    ),
  }, display, scale);
}

function nearestDisplay(displays = [], bounds = {}) {
  if (!Array.isArray(displays) || !displays.length) return null;
  const center = {
    x: Number(bounds.x) + Number(bounds.width || 1) / 2,
    y: Number(bounds.y) + Number(bounds.height || 1) / 2,
  };
  const distance = (display) => {
    const area = normalizedWorkArea(display);
    const x = clamp(center.x, area.x, area.x + area.width);
    const y = clamp(center.y, area.y, area.y + area.height);
    return (center.x - x) ** 2 + (center.y - y) ** 2;
  };
  return [...displays].sort((left, right) => distance(left) - distance(right))[0];
}

module.exports = {
  BASE_SIZES,
  EDGE_INSET,
  SCALE_FACTORS,
  clamp,
  normalizedWorkArea,
  normalizedScale,
  windowSize,
  displayKey,
  defaultAnchor,
  normalizeAnchor,
  boundsForMode,
  dragBounds,
  anchorFromBounds,
  nearestDisplay,
};
