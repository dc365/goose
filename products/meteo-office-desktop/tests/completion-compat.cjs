'use strict';

const assert = require('node:assert/strict');
const CompletionCompat = require('../harness/completion-compat.cjs');

const contract = {
  required: true,
  requiresArtifact: false,
  expectedOutputs: [],
};

assert.equal(CompletionCompat.nativeRecipeApplied({ _meta: { hasRecipe: true } }), true);
assert.equal(CompletionCompat.nativeRecipeApplied({ _meta: { recipe: { title: 'Completion' } } }), true);
assert.equal(CompletionCompat.nativeRecipeApplied({ _meta: {} }), false);
assert.equal(CompletionCompat.needsPromptFallback(contract, { _meta: { hasRecipe: true } }), false);
assert.equal(CompletionCompat.needsPromptFallback(contract, { _meta: { recipe: { title: 'Completion' } } }), false);
assert.equal(CompletionCompat.needsPromptFallback(contract, { _meta: {} }), true);
assert.equal(CompletionCompat.needsPromptFallback({ required: false }, {}), false);

const fallback = CompletionCompat.fallbackInstruction(contract);
assert.ok(fallback.includes('纯文本完成块'));
assert.ok(fallback.includes('METEOMATE_COMPLETION'));
assert.ok(fallback.includes('EVIDENCE 至少包含一条'));
assert.ok(fallback.includes('ARTIFACTS 写 - none'));
assert.ok(fallback.includes('即使任务很简单或没有调用工具'));
assert.ok(fallback.endsWith('END_METEOMATE_COMPLETION'));
assert.equal(CompletionCompat.fallbackInstruction({ required: false }), '');

const artifactFallback = CompletionCompat.fallbackInstruction({
  ...contract,
  requiresArtifact: true,
  expectedOutputs: [{ kind: 'document', name: '天气产品' }],
});
assert.ok(artifactFallback.includes('ARTIFACTS 至少包含一个'));
assert.ok(artifactFallback.includes('天气产品'));

console.log('MeteoMate completion compatibility checks passed.');
