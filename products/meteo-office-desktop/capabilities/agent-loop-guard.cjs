'use strict';

const COMPLETION_PATTERNS = [
  /METEOMATE_COMPLETION/i,
  /(?:任务|操作|计算).{0,16}(?:已完成|已经完成|完成了|成功完成)/,
  /(?:结果|答案).{0,12}(?:为|是).{0,24}(?:任务|操作).{0,12}(?:已完成|完成了)/,
  /\b(?:task|operation|calculation)\b.{0,32}\b(?:is done|is complete|has been completed|completed successfully)\b/i,
];

const INCOMPLETE_PATTERNS = [
  /(?:任务|操作|计算).{0,12}(?:未完成|尚未完成|无法完成|失败)/,
  /\b(?:task|operation|calculation)\b.{0,24}\b(?:is not complete|is not completed|cannot be completed|failed)\b/i,
];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function toolSignature(toolCall = {}) {
  return JSON.stringify(stableValue({
    extensionName: String(toolCall.extensionName || ''),
    toolName: String(toolCall.toolName || ''),
    rawInput: toolCall.rawInput ?? null,
  }));
}

function lastPatternIndex(text, patterns) {
  let lastIndex = -1;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      lastIndex = Math.max(lastIndex, match.index || 0);
    }
  }
  return lastIndex;
}

function completionClaimed(value) {
  const text = String(value || '').slice(-1_200);
  if (!text) return false;
  const completionIndex = lastPatternIndex(text, COMPLETION_PATTERNS);
  return completionIndex >= 0 && completionIndex > lastPatternIndex(text, INCOMPLETE_PATTERNS);
}

function isCompletionTool(toolCall = {}) {
  const name = `${toolCall.extensionName || ''}__${toolCall.toolName || ''}`;
  return /(?:^|[_-])final[_-]?output(?:$|[_-])/i.test(name);
}

function create({ enabled = false, historyLimit = 12 } = {}) {
  return {
    enabled: Boolean(enabled),
    historyLimit: Math.max(2, Number(historyLimit) || 12),
    completionClaimed: false,
    textTail: '',
    toolHistory: [],
    tripped: false,
  };
}

function observeText(state, value) {
  if (!state?.enabled || state.tripped || state.completionClaimed) return state;
  state.textTail = `${state.textTail}${String(value || '')}`.slice(-1_200);
  if (completionClaimed(state.textTail)) state.completionClaimed = true;
  return state;
}

function observeToolCall(state, toolCall = {}) {
  if (!state?.enabled || state.tripped || isCompletionTool(toolCall)) {
    return { shouldCancel: false };
  }
  const signature = toolSignature(toolCall);
  const repeated = state.toolHistory.includes(signature);
  state.toolHistory.push(signature);
  state.toolHistory = state.toolHistory.slice(-state.historyLimit);
  if (!state.completionClaimed || !repeated) return { shouldCancel: false };
  state.tripped = true;
  return {
    shouldCancel: true,
    reason: 'completion-claimed-repeated-tool-call',
    signature,
  };
}

module.exports = {
  completionClaimed,
  create,
  observeText,
  observeToolCall,
  toolSignature,
};
