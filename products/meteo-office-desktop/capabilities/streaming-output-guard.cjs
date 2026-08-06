'use strict';

const MAX_CAPTURED_CHARS = 2 * 1024 * 1024;
const OFFICE_URL_PATTERN = /https?:\/\/[^\r\n<>"']+?\.(?:docx|pptx|xlsx|pdf)(?:[?#][^\s<>"'`]*)?/giu;
const COMPLETION_PATTERN = /(?:产品|文档|文件).{0,24}(?:已成功生成|生成成功|已生成|已就绪)/gu;
const RESTART_HEADER_PATTERN = /(?:^|\n)\s{0,8}(?:#{1,4}\s*)?(?:产品信息|产品基本信息|生成结果摘要)\s*[:：]?\s*(?=\n|$)/gu;

function firstMatchEnd(text, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  pattern.lastIndex = 0;
  return match ? match.index + match[0].length : -1;
}

function firstRestartAfter(text, offset) {
  RESTART_HEADER_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(RESTART_HEADER_PATTERN)) {
    const headerStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    if (headerStart >= offset) {
      RESTART_HEADER_PATTERN.lastIndex = 0;
      return headerStart;
    }
  }
  RESTART_HEADER_PATTERN.lastIndex = 0;
  return -1;
}

function officeRepetitionBoundary(text) {
  OFFICE_URL_PATTERN.lastIndex = 0;
  const firstUrl = OFFICE_URL_PATTERN.exec(text);
  OFFICE_URL_PATTERN.lastIndex = 0;
  if (!firstUrl?.[0] || firstUrl.index == null) return -1;
  const firstUrlEnd = firstUrl.index + firstUrl[0].length;
  const completionEnd = firstMatchEnd(text, COMPLETION_PATTERN);
  if (completionEnd < 0) return -1;
  return firstRestartAfter(text, Math.max(firstUrlEnd, completionEnd));
}

function createOfficeOutputGuard(enabled = true) {
  return {
    enabled: enabled === true,
    rawText: '',
    forwardedText: '',
    downloadReady: false,
    blocked: false,
    cancelRequested: false,
  };
}

function appendOfficeOutput(guard, chunk) {
  const state = guard || createOfficeOutputGuard(false);
  const text = String(chunk || '');
  if (!text) return { text: '', downloadReady: false, shouldCancel: false };
  if (!state.enabled) {
    state.rawText = `${state.rawText}${text}`.slice(-MAX_CAPTURED_CHARS);
    state.forwardedText = `${state.forwardedText}${text}`.slice(-MAX_CAPTURED_CHARS);
    return { text, downloadReady: false, shouldCancel: false };
  }
  if (state.blocked) return { text: '', downloadReady: false, shouldCancel: false };

  state.rawText = `${state.rawText}${text}`.slice(-MAX_CAPTURED_CHARS);
  const boundary = officeRepetitionBoundary(state.rawText);
  const accepted = boundary >= 0 ? state.rawText.slice(0, boundary).trimEnd() : state.rawText;
  const delta = accepted.startsWith(state.forwardedText)
    ? accepted.slice(state.forwardedText.length)
    : text;
  state.forwardedText = accepted;

  const hasOfficeUrl = OFFICE_URL_PATTERN.test(state.forwardedText);
  OFFICE_URL_PATTERN.lastIndex = 0;
  const downloadReady = hasOfficeUrl && !state.downloadReady;
  if (downloadReady) state.downloadReady = true;

  let shouldCancel = false;
  if (boundary >= 0) {
    state.blocked = true;
    shouldCancel = !state.cancelRequested;
    state.cancelRequested = true;
  }
  return { text: delta, downloadReady, shouldCancel };
}

module.exports = {
  MAX_CAPTURED_CHARS,
  appendOfficeOutput,
  createOfficeOutputGuard,
  officeRepetitionBoundary,
};
