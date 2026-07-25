'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const OfficeRuntime = require('../capabilities/office-runtime.cjs');

const productRoot = path.resolve(__dirname, '..');
const resolvedRuntime = OfficeRuntime.resolveOfficeRuntime({
  productRoot,
  env: {
    ...process.env,
    ...(process.env.METEOMATE_OFFICE_TEST_PYTHON
      ? { METEOMATE_PYTHON_PATH: process.env.METEOMATE_OFFICE_TEST_PYTHON }
      : {}),
  },
});
const worker = path.join(productRoot, 'services', 'office-mcp', 'python', 'worker.py');
const python = resolvedRuntime.env.METEOMATE_OFFICE_PYTHON;

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-office-worker-'));
const environment = {
  ...process.env,
  ...resolvedRuntime.env,
  METEOMATE_OFFICE_WORKSPACE: workspace,
  METEOMATE_OFFICE_RUNTIME_VERSION: 'test',
};

function invoke(tool, input) {
  const result = spawnSync(python, [worker, tool], {
    cwd: workspace,
    env: environment,
    input: JSON.stringify({
      schemaVersion: 'meteomate.office/v1',
      workspaceId: 'project-current',
      ...input,
    }),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function invokeFailure(tool, input, pattern) {
  const result = spawnSync(python, [worker, tool], {
    cwd: workspace,
    env: environment,
    input: JSON.stringify({
      schemaVersion: 'meteomate.office/v1',
      workspaceId: 'project-current',
      ...input,
    }),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 180_000,
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

try {
  const pdf = invoke('pdf_create', {
    outputPath: 'artifacts/weather-report.pdf',
    spec: {
      title: '强降水天气专报',
      header: 'MeteoMate 业务测试',
      footer: '第 {page} 页',
      blocks: [
        { type: 'heading', level: 1, text: '天气概况' },
        { type: 'paragraph', text: '预计今天夜间到明天白天有强降水，请注意防范。' },
        { type: 'table', rows: [['区域', '雨量'], ['福州', '50–80 mm']] },
      ],
    },
  });
  assert.equal(pdf.artifact.status, 'draft');
  assert.ok(fs.existsSync(path.join(workspace, pdf.artifact.path)));

  const pdfInspection = invoke('pdf_inspect', { sourcePath: pdf.artifact.path });
  assert.equal(pdfInspection.pageCount, 1);
  assert.match(pdfInspection.pages[0].textPreview, /强降水/);

  const transformedPdf = invoke('pdf_transform', {
    inputs: [pdf.artifact.path],
    outputPath: 'artifacts/weather-report-watermarked.pdf',
    operations: [
      { op: 'rotate', degrees: 0 },
      { op: 'watermark', text: '内部材料', opacity: 0.12 },
    ],
  });
  assert.equal(transformedPdf.operations.length, 2);

  const pdfRender = invoke('artifact_render', { sourcePath: pdf.artifact.path, dpi: 96 });
  assert.equal(pdfRender.render.pageCount, 1);
  assert.ok(fs.existsSync(path.join(workspace, pdfRender.render.thumbnailPath)));
  const pdfValidation = invoke('artifact_validate', { sourcePath: pdf.artifact.path });
  assert.equal(pdfValidation.valid, true);
  assert.equal(pdfValidation.artifact.status, 'ready');

  const docx = invoke('docx_create', {
    outputPath: 'artifacts/weather-report.docx',
    spec: {
      title: '强降水天气专报',
      header: 'MeteoMate 业务测试',
      footer: '业务材料',
      blocks: [
        { type: 'heading', level: 1, text: '天气概况' },
        { type: 'paragraph', text: '预计今天夜间到明天白天有强降水。' },
        { type: 'table', rows: [['区域', '雨量', '备注'], ['福州', '50–80 mm', null]] },
      ],
    },
  });
  assert.equal(docx.artifact.status, 'draft');

  const docxInspection = invoke('docx_inspect', { sourcePath: docx.artifact.path });
  assert.ok(docxInspection.structure.paragraphs.some((paragraph) => paragraph.text.includes('强降水')));
  assert.equal(docxInspection.structure.tables[0].preview[1][2], '');
  const editedDocx = invoke('docx_edit', {
    sourcePath: docx.artifact.path,
    sourceHash: docx.artifact.contentHash,
    outputPath: 'artifacts/weather-report-v2.docx',
    operations: [
      { op: 'replace_text', old: '今天夜间', new: '24 日夜间' },
      { op: 'append_paragraph', text: '请加强值班值守。' },
    ],
  });
  assert.equal(editedDocx.operations[0].replacements, 1);

  const docxRender = invoke('artifact_render', { sourcePath: editedDocx.artifact.path, dpi: 96 });
  assert.ok(docxRender.render.pageCount >= 1);
  const docxPreviewInspection = invoke('pdf_inspect', {
    sourcePath: docxRender.render.previewPath,
  });
  assert.match(docxPreviewInspection.pages[0].textPreview, /强降水天气专报/);
  const docxValidation = invoke('artifact_validate', { sourcePath: editedDocx.artifact.path });
  assert.equal(docxValidation.valid, true);
  assert.equal(docxValidation.artifact.status, 'ready');

  invokeFailure('docx_create', {
    outputPath: 'artifacts/invalid-object-title.docx',
    spec: {
      title: { text: '错误对象标题', style: 'Title' },
      sections: {},
    },
  }, /INVALID_ARGUMENT: spec 包含不支持字段：sections/);
  invokeFailure('docx_create', {
    outputPath: 'artifacts/invalid-runs.docx',
    spec: {
      blocks: [{
        type: 'paragraph',
        runs: [{ text: '错误 runs 结构' }],
      }],
    },
  }, /INVALID_ARGUMENT: spec\.blocks\[0\] 包含不支持字段：runs/);
  invokeFailure('docx_create', {
    outputPath: 'artifacts/invalid-heading-level.docx',
    spec: {
      blocks: [{ type: 'heading', level: 0, text: '错误标题级别' }],
    },
  }, /INVALID_ARGUMENT: spec\.blocks\[0\]\.level 必须是 1 到 9 的整数/);
  invokeFailure('docx_create', {
    outputPath: 'artifacts/too-many-table-cells.docx',
    spec: {
      blocks: [
        {
          type: 'table',
          rows: [
            Array.from({ length: 100 }, () => ''),
            ...Array.from({ length: 999 }, () => ['']),
          ],
        },
      ],
    },
  }, /RESOURCE_LIMIT: 文档表格总单元格不能超过 10000 个/);

  const styledTemplate = invoke('docx_create', {
    outputPath: 'artifacts/styled-template.docx',
    spec: {
      title: '业务模板',
      defaultFont: 'Liberation Serif',
    },
  });
  const templatedDocx = invoke('docx_create', {
    outputPath: 'artifacts/from-styled-template.docx',
    templatePath: styledTemplate.artifact.path,
    templateHash: styledTemplate.artifact.contentHash,
    spec: {
      blocks: [{ type: 'paragraph', text: '模板字体应保持不变。' }],
    },
  });
  const templateFont = spawnSync(python, [
    '-c',
    'from docx import Document; import sys; print(Document(sys.argv[1]).styles["Normal"].font.name or "")',
    path.join(workspace, templatedDocx.artifact.path),
  ], {
    cwd: workspace,
    env: environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(templateFont.status, 0, templateFont.stderr);
  assert.equal(templateFont.stdout.trim(), 'Liberation Serif');

  const presentation = invoke('pptx_create', {
    outputPath: 'artifacts/weather-briefing.pptx',
    spec: {
      layout: 'wide',
      slides: [
        {
          title: '强降水天气会商',
          subtitle: 'MeteoMate 业务测试',
          elements: [
            {
              type: 'text',
              name: 'Conclusion',
              text: '预计今天夜间有强降水。',
              x: 0.8,
              y: 2,
              width: 5,
              height: 1,
              fontSize: 20,
            },
            {
              type: 'chart',
              name: 'RainChart',
              chartType: 'column',
              title: '逐时降水',
              x: 6,
              y: 1.8,
              width: 6.5,
              height: 4.5,
              data: {
                categories: ['20时', '21时', '22时'],
                series: [{ name: '福州', values: [12, 28, 35] }],
              },
            },
          ],
          notes: '核对资料时次和落区。',
        },
        {
          title: '防御建议',
          elements: [{
            type: 'table',
            name: 'ActionsTable',
            rows: [['区域', '建议'], ['福州', '加强值班值守']],
            x: 0.8,
            y: 1.8,
            width: 11.5,
            height: 3.5,
          }],
        },
      ],
    },
  });
  assert.equal(presentation.artifact.type, 'PRESENTATION');
  const presentationInspection = invoke('pptx_inspect', {
    sourcePath: presentation.artifact.path,
  });
  assert.equal(presentationInspection.slideCount, 2);
  assert.ok(presentationInspection.anchors.some((anchor) => anchor.id === 'RainChart'));
  assert.equal(presentationInspection.security.embeddedChartWorkbooks.length, 1);

  const editedPresentation = invoke('pptx_edit', {
    sourcePath: presentation.artifact.path,
    sourceHash: presentation.artifact.contentHash,
    outputPath: 'artifacts/weather-briefing-v2.pptx',
    operations: [
      {
        op: 'set_shape_text',
        slide: 1,
        shapeName: 'Conclusion',
        text: '预计 24 日夜间有强降水。',
      },
      {
        op: 'set_chart_data',
        slide: 1,
        shapeName: 'RainChart',
        data: {
          categories: ['20时', '21时', '22时'],
          series: [{ name: '福州', values: [15, 32, 40] }],
        },
      },
      {
        op: 'add_slide',
        slide: {
          title: '结束页',
          elements: [{ type: 'text', name: 'Closing', text: '请加强值班值守。' }],
        },
      },
    ],
  });
  assert.equal(editedPresentation.operations.length, 3);
  const presentationRender = invoke('artifact_render', {
    sourcePath: editedPresentation.artifact.path,
    dpi: 96,
  });
  assert.equal(presentationRender.render.pageCount, 3);
  const presentationValidation = invoke('artifact_validate', {
    sourcePath: editedPresentation.artifact.path,
  });
  assert.equal(presentationValidation.valid, true);
  assert.equal(presentationValidation.artifact.status, 'ready');

  const spreadsheet = invoke('xlsx_create', {
    outputPath: 'artifacts/rainfall-statistics.xlsx',
    spec: {
      worksheets: [{
        name: '降水统计',
        data: [
          ['区域', '20时', '21时', '合计'],
          ['福州', 12, 28, null],
          ['厦门', 8, 18, null],
        ],
        cells: {
          D2: { formula: '=SUM(B2:C2)' },
          D3: { formula: '=SUM(B3:C3)' },
        },
        styles: [{
          range: 'A1:D1',
          style: {
            font: { bold: true, color: 'FFFFFF' },
            fill: '2563EB',
            alignment: { horizontal: 'center' },
            border: { style: 'thin' },
          },
        }],
        freezePane: 'A2',
        autoFilter: 'A1:D3',
        printArea: 'A1:D3',
        orientation: 'landscape',
        fitToWidth: 1,
        columnWidths: { A: 16, B: 12, C: 12, D: 12 },
        tables: [{ name: 'RainfallTable', ref: 'A1:D3' }],
        charts: [{
          chartType: 'column',
          title: '逐时降水',
          dataRange: 'B1:C3',
          categoriesRange: 'A2:A3',
          anchor: 'F2',
        }],
      }],
    },
  });
  assert.equal(spreadsheet.artifact.type, 'SPREADSHEET');
  assert.equal(spreadsheet.artifact.metadata.recalculated, true);
  const spreadsheetInspection = invoke('xlsx_inspect', {
    sourcePath: spreadsheet.artifact.path,
  });
  assert.equal(spreadsheetInspection.worksheetCount, 1);
  assert.equal(spreadsheetInspection.worksheets[0].formulaCount, 2);
  assert.equal(spreadsheetInspection.worksheets[0].charts.length, 1);

  const editedSpreadsheet = invoke('xlsx_edit', {
    sourcePath: spreadsheet.artifact.path,
    sourceHash: spreadsheet.artifact.contentHash,
    outputPath: 'artifacts/rainfall-statistics-v2.xlsx',
    operations: [
      {
        op: 'set_range',
        sheet: '降水统计',
        startCell: 'B2',
        values: [[15, 32], [10, 21]],
      },
      {
        op: 'set_cells',
        sheet: '降水统计',
        cells: {
          D2: { formula: '=SUM(B2:C2)' },
          D3: { formula: '=SUM(B3:C3)' },
        },
      },
      {
        op: 'set_chart_data',
        sheet: '降水统计',
        chartIndex: 0,
        chart: {
          chartType: 'line',
          title: '逐时降水更新',
          dataRange: 'B1:C3',
          categoriesRange: 'A2:A3',
          anchor: 'F2',
        },
      },
      {
        op: 'set_print_area',
        sheet: '降水统计',
        range: 'A1:L20',
      },
    ],
  });
  assert.equal(editedSpreadsheet.operations.length, 4);
  const spreadsheetValidation = invoke('artifact_validate', {
    sourcePath: editedSpreadsheet.artifact.path,
  });
  assert.equal(spreadsheetValidation.valid, true);
  assert.equal(spreadsheetValidation.artifact.status, 'ready');
  const formulaCheck = spreadsheetValidation.checks.find((check) => check.name === 'formulas');
  assert.equal(formulaCheck.errors.length, 0);
  assert.equal(formulaCheck.unresolved.length, 0);

  const invalidFormulaSpreadsheet = invoke('xlsx_create', {
    outputPath: 'artifacts/formula-error.xlsx',
    spec: {
      worksheets: [{
        name: '错误样例',
        data: [['错误公式'], [null]],
        cells: {
          A2: { formula: '=1/0' },
        },
        printArea: 'A1:A2',
      }],
    },
  });
  const invalidFormulaValidation = invoke('artifact_validate', {
    sourcePath: invalidFormulaSpreadsheet.artifact.path,
    requireRender: false,
  });
  assert.equal(invalidFormulaValidation.valid, false);
  assert.equal(invalidFormulaValidation.artifact.status, 'failed');
  assert.match(
    invalidFormulaValidation.checks.find((check) => check.status === 'failed').message,
    /公式错误/,
  );

  invokeFailure('xlsx_create', {
    outputPath: 'artifacts/external-formula.xlsx',
    spec: {
      worksheets: [{
        name: '外链样例',
        cells: {
          A1: { formula: '=WEBSERVICE("https://example.com/data")' },
        },
      }],
    },
  }, /SECURITY_REJECTED/);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('MeteoMate Office Worker DOCX/PPTX/XLSX/PDF end-to-end passed.');
