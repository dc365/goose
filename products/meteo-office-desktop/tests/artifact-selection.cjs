const assert = require('node:assert/strict');
const path = require('node:path');
const Selection = require('../capabilities/artifact-selection.cjs');

const draft = Selection.sanitizeSelectionDraft({
  quote: '  一段\n  被选择的   原文  ',
  pages: [2, 1, 2],
  rects: [{ page: 2, x: 0.2, y: 0.3, width: 0.4, height: 0.05 }],
});
assert.equal(draft.quote, '一段 被选择的 原文');
assert.deepEqual(draft.pages, [1, 2]);
assert.equal(Selection.selectionPageLabel(draft), '第 1–2 页');
assert.throws(() => Selection.sanitizeSelectionDraft({ quote: '', pages: [1] }), /选择一段文字/);

const root = path.resolve('/tmp/project');
assert.equal(Selection.relativeSelectionPath(root, path.join(root, 'report.docx')), 'report.docx');
assert.equal(Selection.relativeSelectionPath(root, path.resolve('/tmp/outside.docx')), null);

const context = Selection.buildSelectionContext([{
  selectionId: 'selection-1',
  artifactId: 'artifact-1',
  path: 'report.docx',
  title: '预报稿.docx',
  format: 'DOCX',
  pages: [2],
  sourceHash: 'abc123',
  quote: '未来三天以多云天气为主。',
  editability: 'editable',
  editReason: '唯一段落',
  editAnchor: {
    version: 'meteomate.docx-anchor/v1',
    paragraphId: 'paragraph:2',
    paragraphIndex: 2,
    paragraphTextHash: 'a'.repeat(64),
    selectedTextHash: 'b'.repeat(64),
    normalizedStart: 0,
    normalizedEnd: 13,
  },
}]);
assert.match(context.prompt, /不得仅凭 quote 做全局文本替换/);
assert.match(context.prompt, /docx_edit_selection/);
assert.match(context.prompt, /"editability": "editable"/);
assert.match(context.prompt, /未来三天以多云天气为主/);
assert.deepEqual(context.sourceIds, ['artifact-selection:selection-1']);

assert.deepEqual(
  Selection.sanitizeEditResolution({ editability: 'editable' }, 'PDF'),
  { editability: 'reference_only', editReason: '当前格式在本阶段仅供引用' },
);
assert.equal(
  Selection.sanitizeEditResolution({ editability: 'editable', editAnchor: {} }, 'DOCX').editability,
  'reference_only',
);

console.log('artifact selection tests passed');
