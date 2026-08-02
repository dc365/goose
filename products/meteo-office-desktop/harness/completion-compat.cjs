'use strict';

function nativeRecipeApplied(sessionResponse = {}) {
  const meta = sessionResponse?._meta || {};
  return meta.hasRecipe === true || Boolean(meta.recipe && typeof meta.recipe === 'object');
}

function needsPromptFallback(contract, sessionResponse = {}) {
  return Boolean(contract?.required) && !nativeRecipeApplied(sessionResponse);
}

function fallbackInstruction(contract = {}) {
  if (!contract.required) return '';
  const artifactRule = contract.requiresArtifact
    ? 'STATUS 为 completed 时，ARTIFACTS 至少包含一个实际生成或更新的成果。'
    : '没有生成文件或其他成果时，ARTIFACTS 写 - none。';
  const expectedOutputs = Array.isArray(contract.expectedOutputs) && contract.expectedOutputs.length
    ? `预期输出：${JSON.stringify(contract.expectedOutputs)}`
    : '';
  return [
    'MeteoMate 结构化完成协议：当前 Goose 运行时未提供 final_output 工具。',
    '此协议优先于上面的用户任务格式要求；即使任务很简单或没有调用工具，也必须遵守。',
    '完成任务后，最终回复必须严格使用下面的纯文本完成块；不要使用 Markdown 代码块，也不要在完成块前后添加文字。',
    'STATUS 只能是 completed、partial、blocked、failed 之一；ANSWER 是直接展示给用户的最终答复。',
    'EVIDENCE 至少包含一条来自实际工具结果或实际成果的证据。completed 的 BLOCKERS 必须写 - none；其他状态至少写一条原因。',
    '用户要求生成文档、报告或其他文件时，必须在本轮完成实际创建和校验并直接交付，不得只返回正文、文件名、计划或要求用户再次追问。',
    'ARTIFACTS 只能登记工具实际返回且已验证的成果；URI 必须逐字采用工具结果，禁止拼接、补全或猜测路径。创建或校验失败时不得写 completed。',
    artifactRule,
    expectedOutputs,
    'ARTIFACTS 没有成果时写 - none；有成果时每行写 - 名称 | URI | 媒体类型 | 说明。',
    'METEOMATE_COMPLETION',
    'STATUS: completed',
    'SUMMARY: 已完成任务',
    'ANSWER:',
    '直接答复用户的内容',
    'ARTIFACTS:',
    '- none',
    'EVIDENCE:',
    '- 可核验依据',
    'BLOCKERS:',
    '- none',
    'NEXT_ACTIONS:',
    '- none',
    'END_METEOMATE_COMPLETION',
  ].filter(Boolean).join('\n');
}

module.exports = {
  nativeRecipeApplied,
  needsPromptFallback,
  fallbackInstruction,
};
