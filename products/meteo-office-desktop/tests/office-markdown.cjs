'use strict';

const assert = require('node:assert/strict');

async function main() {
  const {
    MAX_DOCUMENT_BLOCKS,
    MAX_DOCUMENT_TABLE_CELLS,
    MAX_MARKDOWN_BYTES,
    MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS,
    markdownDocumentInput,
    markdownToDocumentBlocks,
  } = await import('../services/office-mcp/src/markdown-document.mjs');

  assert.deepEqual(
    markdownToDocumentBlocks([
      '# 天气预报',
      '',
      '发布时间：2026年7月25日20时',
      '',
      '---',
      '',
      '## 一、天气概况',
      '',
      '- 午后有阵雨',
      '- 夜间多云',
      '',
      '| 日期 | 天气 |',
      '| --- | --- |',
      '| 7月26日 | 多云 |',
    ].join('\n'), { title: '天气预报' }),
    [
      { type: 'paragraph', text: '发布时间：2026年7月25日20时' },
      { type: 'heading', level: 2, text: '一、天气概况' },
      { type: 'paragraph', text: '• 午后有阵雨' },
      { type: 'paragraph', text: '• 夜间多云' },
      { type: 'table', rows: [['日期', '天气'], ['7月26日', '多云']] },
    ]
  );

  assert.deepEqual(
    markdownDocumentInput({
      schemaVersion: 'meteomate.office/v1',
      workspaceId: 'project-current',
      outputPath: 'artifacts/forecast.docx',
      title: '天气预报',
      contentLines: ['## 天气概况', '', '多云。'],
      footer: '测试数据',
    }),
    {
      schemaVersion: 'meteomate.office/v1',
      workspaceId: 'project-current',
      outputPath: 'artifacts/forecast.docx',
      spec: {
        title: '天气预报',
        footer: '测试数据',
        defaultFont: 'Noto Sans CJK SC',
        defaultFontSize: 11,
        blocks: [
          { type: 'heading', level: 2, text: '天气概况' },
          { type: 'paragraph', text: '多云。' },
        ],
      },
    }
  );

  assert.throws(
    () => markdownToDocumentBlocks([
      `| ${Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, index) => `列${index}`).join(' | ')} |`,
      `| ${Array.from({ length: MAX_TABLE_COLUMNS + 1 }, () => '---').join(' | ')} |`,
    ].join('\n')),
    /不能超过 100 列/
  );
  assert.throws(
    () => markdownToDocumentBlocks([
      '| 日期 | 天气 |',
      '| --- | --- |',
      ...Array.from({ length: MAX_TABLE_ROWS }, () => '| 7月26日 | 多云 |'),
    ].join('\n')),
    /不能超过 1000 行/
  );
  const wideTable = (rows) => [
    `| ${Array.from({ length: MAX_TABLE_COLUMNS }, (_, index) => `列${index}`).join(' | ')} |`,
    `| ${Array.from({ length: MAX_TABLE_COLUMNS }, () => '---').join(' | ')} |`,
    ...Array.from(
      { length: rows - 1 },
      () => `| ${Array.from({ length: MAX_TABLE_COLUMNS }, () => '').join(' | ')} |`
    ),
  ];
  assert.throws(
    () => markdownToDocumentBlocks([
      ...wideTable(2),
      ...Array.from(
        { length: MAX_DOCUMENT_TABLE_CELLS / MAX_TABLE_COLUMNS },
        () => '| |'
      ),
    ].join('\n')),
    /表格总单元格不能超过 10000 个/
  );
  assert.throws(
    () => markdownToDocumentBlocks(
      Array.from({ length: MAX_DOCUMENT_BLOCKS + 1 }, (_, index) => `- 项目 ${index}`).join('\n')
    ),
    /不能生成超过 500 个内容块/
  );
  assert.throws(
    () => markdownDocumentInput({
      outputPath: 'artifacts/too-large.docx',
      title: '超限',
      contentLines: ['测'.repeat(Math.floor(MAX_MARKDOWN_BYTES / 3) + 1)],
    }),
    /不能超过 2097152 字节/
  );

  console.log('office markdown conversion tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
