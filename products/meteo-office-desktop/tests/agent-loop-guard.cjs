'use strict';

const assert = require('node:assert/strict');
const AgentLoopGuard = require('../capabilities/agent-loop-guard.cjs');

function tool(rawInput = { value: 10 }) {
  return {
    extensionName: 'cua-desktop',
    toolName: 'press_key',
    rawInput,
  };
}

{
  const guard = AgentLoopGuard.create({ enabled: true });
  AgentLoopGuard.observeToolCall(guard, tool());
  assert.equal(AgentLoopGuard.observeToolCall(guard, tool()).shouldCancel, false);
}

{
  const guard = AgentLoopGuard.create({ enabled: true });
  AgentLoopGuard.observeToolCall(guard, tool({ a: 1, b: 2 }));
  AgentLoopGuard.observeText(guard, '计算结果为 10，任务');
  AgentLoopGuard.observeText(guard, '已完成。');
  const result = AgentLoopGuard.observeToolCall(guard, tool({ b: 2, a: 1 }));
  assert.equal(result.shouldCancel, true, 'a repeated call after an explicit completion claim should stop');
  assert.equal(
    AgentLoopGuard.observeToolCall(guard, tool({ a: 1, b: 2 })).shouldCancel,
    false,
    'one guard should trip only once'
  );
}

{
  const guard = AgentLoopGuard.create({ enabled: true });
  AgentLoopGuard.observeToolCall(guard, tool({ value: 5 }));
  AgentLoopGuard.observeText(guard, '任务尚未完成，还需要读取结果。');
  assert.equal(AgentLoopGuard.observeToolCall(guard, tool({ value: 5 })).shouldCancel, false);
  AgentLoopGuard.observeText(guard, '结果已经确认，任务已完成。');
  assert.equal(AgentLoopGuard.observeToolCall(guard, tool({ value: 5 })).shouldCancel, true);
}

{
  const guard = AgentLoopGuard.create({ enabled: true });
  AgentLoopGuard.observeToolCall(guard, tool({ value: 5 }));
  AgentLoopGuard.observeText(guard, '任务已完成。');
  assert.equal(AgentLoopGuard.observeToolCall(guard, tool({ value: 10 })).shouldCancel, false);
}

{
  const guard = AgentLoopGuard.create({ enabled: true });
  AgentLoopGuard.observeText(guard, 'METEOMATE_COMPLETION');
  const finalOutput = {
    extensionName: 'recipe',
    toolName: 'final_output',
    rawInput: { status: 'completed' },
  };
  AgentLoopGuard.observeToolCall(guard, finalOutput);
  assert.equal(AgentLoopGuard.observeToolCall(guard, finalOutput).shouldCancel, false);
}

{
  const guard = AgentLoopGuard.create({ enabled: false });
  AgentLoopGuard.observeToolCall(guard, tool());
  AgentLoopGuard.observeText(guard, '任务已完成。');
  assert.equal(AgentLoopGuard.observeToolCall(guard, tool()).shouldCancel, false);
}

console.log('agent loop guard tests passed');
