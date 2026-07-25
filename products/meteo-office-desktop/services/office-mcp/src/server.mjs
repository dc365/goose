#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  MAX_DOCUMENT_TABLE_CELLS,
  MAX_MARKDOWN_BYTES,
  markdownDocumentInput,
} from './markdown-document.mjs';

const SERVER_VERSION = '1.2.0';
const MAX_WORKER_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const SCHEMA_VERSION = 'meteomate.office/v1';

function runtimeConfiguration(env = process.env) {
  const workspace = path.resolve(String(env.METEOMATE_OFFICE_WORKSPACE || ''));
  const python = String(env.METEOMATE_OFFICE_PYTHON || '');
  const worker = path.resolve(String(env.METEOMATE_OFFICE_WORKER || ''));
  if (!env.METEOMATE_OFFICE_WORKSPACE || !path.isAbsolute(workspace)) {
    throw new Error('Office Connector 未绑定绝对项目工作区');
  }
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error('Office Connector 的项目工作区不存在');
  }
  if (!python || !fs.existsSync(python)) throw new Error('Office Python 运行时不存在');
  if (!env.METEOMATE_OFFICE_WORKER || !fs.existsSync(worker)) {
    throw new Error('Office Python Worker 不存在');
  }
  return {
    workspace,
    python,
    worker,
    soffice: env.METEOMATE_SOFFICE_PATH || '',
    runtimeVersion: env.METEOMATE_OFFICE_RUNTIME_VERSION || SERVER_VERSION,
  };
}

function workerError(stderr, code, signal) {
  const message = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (message) return message;
  return `Office Worker 已退出（code=${code ?? 'none'}, signal=${signal || 'none'}）`;
}

function runWorker(toolName, input, configuration, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(configuration.python, [configuration.worker, toolName], {
      cwd: configuration.workspace,
      env: {
        PATH: process.env.PATH || '',
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL || '',
        METEOMATE_OFFICE_WORKSPACE: configuration.workspace,
        METEOMATE_OFFICE_RUNTIME_VERSION: configuration.runtimeVersion,
        ...(process.env.PYTHONHOME ? { PYTHONHOME: process.env.PYTHONHOME } : {}),
        ...(configuration.soffice ? { METEOMATE_SOFFICE_PATH: configuration.soffice } : {}),
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Office 工具执行超过 ${Math.ceil(timeoutMs / 1000)} 秒`)));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > MAX_WORKER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('Office Worker 输出超过限制')));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > MAX_WORKER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('Office Worker 错误输出超过限制')));
      }
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(workerError(stderr.toString('utf8'), code, signal)));
          return;
        }
        try {
          resolve(JSON.parse(stdout.toString('utf8')));
        } catch {
          reject(new Error('Office Worker 返回了无效 JSON'));
        }
      });
    });
    child.stdin.end(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...input,
    }));
  });
}

function errorCode(error) {
  const match = String(error?.message || '').match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/s);
  return match ? { code: match[1], message: match[2] } : {
    code: 'OFFICE_TOOL_FAILED',
    message: String(error?.message || 'Office 工具执行失败'),
  };
}

function toolResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function toolFailure(error) {
  const detail = errorCode(error);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    error: detail,
  };
  return {
    isError: true,
    content: [{ type: 'text', text: `${detail.code}: ${detail.message}` }],
    structuredContent: result,
  };
}

const schemaVersion = z.literal(SCHEMA_VERSION).optional().default(SCHEMA_VERSION);
const workspaceId = z.string().max(128).optional().default('project-current');
const relativePath = z.string().min(1).max(1024)
  .refine((value) => !path.isAbsolute(value), '必须使用工作区相对路径')
  .refine((value) => !value.split(/[\\/]/).includes('..'), '路径不能包含 ..');
const sourceHash = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/i);
const objectValue = z.record(z.string(), z.unknown());
const documentText = z.string().max(100_000);
const documentCell = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);
const documentBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('paragraph'),
    text: documentText,
    style: z.string().min(1).max(128).optional(),
  }).strict(),
  z.object({
    type: z.literal('heading'),
    text: documentText,
    level: z.number().int().min(1).max(9).optional(),
  }).strict(),
  z.object({
    type: z.literal('table'),
    rows: z.array(z.array(documentCell).min(1).max(100)).min(1).max(1_000),
    style: z.string().min(1).max(128).optional(),
  }).strict(),
  z.object({
    type: z.literal('image'),
    path: relativePath,
    widthInches: z.number().positive().max(30).optional(),
    heightInches: z.number().positive().max(30).optional(),
  }).strict(),
  z.object({ type: z.literal('page_break') }).strict(),
  z.object({ type: z.literal('spacer') }).strict(),
]);
const documentSpec = z.object({
  title: documentText.optional(),
  header: documentText.optional(),
  footer: documentText.optional(),
  defaultFont: z.string().min(1).max(128).optional(),
  defaultFontSize: z.number().positive().max(200).optional(),
  page: z.object({
    orientation: z.enum(['portrait', 'landscape']).optional(),
    topMarginInches: z.number().min(0).max(10).optional(),
    bottomMarginInches: z.number().min(0).max(10).optional(),
    leftMarginInches: z.number().min(0).max(10).optional(),
    rightMarginInches: z.number().min(0).max(10).optional(),
  }).strict().optional(),
  anchors: z.record(z.string().min(1).max(256), documentCell).optional(),
  blocks: z.array(documentBlock).min(1).max(500).optional(),
}).strict().superRefine((spec, context) => {
  const tableCellCount = (spec.blocks || [])
    .filter((block) => block.type === 'table')
    .reduce(
      (total, block) => total + (
        block.rows.length * Math.max(...block.rows.map((row) => row.length))
      ),
      0
    );
  if (tableCellCount > MAX_DOCUMENT_TABLE_CELLS) {
    context.addIssue({
      code: 'custom',
      path: ['blocks'],
      message: `表格总单元格不能超过 ${MAX_DOCUMENT_TABLE_CELLS} 个`,
    });
  }
});

function validatedMarkdownDocumentInput(input) {
  const transformed = markdownDocumentInput(input);
  return {
    ...transformed,
    spec: documentSpec.parse(transformed.spec),
  };
}

const operation = z.object({
  op: z.string().min(1).max(64),
}).catchall(z.unknown());

const server = new McpServer({
  name: 'meteomate-office-artifacts',
  version: SERVER_VERSION,
});
const configuration = runtimeConfiguration();
let workerQueue = Promise.resolve();

function enqueueWorker(toolName, input, timeoutMs) {
  const run = workerQueue.then(() => runWorker(toolName, input, configuration, timeoutMs));
  workerQueue = run.catch(() => undefined);
  return run;
}

function registerTool(
  name,
  description,
  inputSchema,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  { workerToolName = name, transformInput = (input) => input } = {}
) {
  server.registerTool(name, { description, inputSchema }, async (input) => {
    try {
      return toolResult(await enqueueWorker(
        workerToolName,
        transformInput(input),
        timeoutMs
      ));
    } catch (error) {
      return toolFailure(error);
    }
  });
}

registerTool('docx_inspect', '检查工作区内 DOCX 的段落、表格、样式、模板锚点、媒体和安全风险。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  include: z.array(z.enum(['structure', 'anchors', 'fonts', 'media', 'security'])).max(5).optional(),
});

registerTool('docx_create_from_markdown', '普通 Word 新建的首选工具。标题单独提交，Markdown 正文按单行字符串数组 contentLines 提交；默认拒绝覆盖现有文件。', {
  schemaVersion,
  workspaceId,
  outputPath: relativePath,
  title: z.string().min(1).max(1_000),
  contentLines: z.array(
    z.string().max(20_000)
      .refine((value) => !/[\r\n]/.test(value), '每个正文元素必须是单行字符串')
  ).min(1).max(5_000)
    .refine((lines) => lines.some((line) => Boolean(line.trim())), '正文不能为空')
    .refine(
      (lines) => Buffer.byteLength(lines.join('\n'), 'utf8') <= MAX_MARKDOWN_BYTES,
      `正文不能超过 ${MAX_MARKDOWN_BYTES} 字节`
    ),
  header: documentText.optional(),
  footer: documentText.optional(),
}, DEFAULT_TIMEOUT_MS, {
  workerToolName: 'docx_create',
  transformInput: validatedMarkdownDocumentInput,
});

registerTool('docx_create', '仅用于模板锚点、表格、图片或精确版式等高级结构化 DOCX。普通 Word 新建必须优先使用 docx_create_from_markdown；默认拒绝覆盖现有文件。', {
  schemaVersion,
  workspaceId,
  outputPath: relativePath,
  templatePath: relativePath.optional(),
  templateHash: sourceHash.optional(),
  spec: documentSpec,
});

registerTool('docx_edit', '以乐观锁方式对 DOCX 执行白名单结构化编辑，并写入新文件。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  sourceHash,
  outputPath: relativePath,
  operations: z.array(operation).min(1).max(200),
});

registerTool('pptx_inspect', '检查工作区内 PPTX 的页面、布局、命名形状、表格、图表、媒体和安全风险。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  include: z.array(z.enum(['structure', 'anchors', 'fonts', 'media', 'security'])).max(5).optional(),
});

registerTool('pptx_create', '从受控规范或工作区模板创建新的 PPTX；默认拒绝覆盖现有文件。', {
  schemaVersion,
  workspaceId,
  outputPath: relativePath,
  templatePath: relativePath.optional(),
  templateHash: sourceHash.optional(),
  spec: objectValue,
});

registerTool('pptx_edit', '以乐观锁方式更新 PPTX 的命名形状、图片、表格、图表和备注，并写入新文件。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  sourceHash,
  outputPath: relativePath,
  operations: z.array(operation).min(1).max(200),
});

registerTool('xlsx_inspect', '检查工作区内 XLSX 的工作表、命名区域、公式、表格、图表、打印设置和安全风险。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  include: z.array(z.enum(['structure', 'formulas', 'styles', 'charts', 'security'])).max(5).optional(),
});

registerTool('xlsx_create', '从受控规范或工作区模板创建 XLSX，并通过 LibreOffice 重算公式缓存。', {
  schemaVersion,
  workspaceId,
  outputPath: relativePath,
  templatePath: relativePath.optional(),
  templateHash: sourceHash.optional(),
  spec: objectValue,
});

registerTool('xlsx_edit', '以乐观锁方式更新 XLSX 的值、公式、样式、表格、图表和打印区域，并写入新文件。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  sourceHash,
  outputPath: relativePath,
  operations: z.array(operation).min(1).max(500),
});

registerTool('pdf_inspect', '检查工作区内 PDF 的页面、文本、表单、附件、脚本和安全风险。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  include: z.array(z.enum(['structure', 'text', 'forms', 'metadata', 'security'])).max(5).optional(),
});

registerTool('pdf_create', '从受控内容规范创建新的 PDF；默认拒绝覆盖现有文件。', {
  schemaVersion,
  workspaceId,
  outputPath: relativePath,
  spec: objectValue,
});

registerTool('pdf_transform', '对工作区内 PDF 执行合并、拆分、旋转、加水印或填写表单。', {
  schemaVersion,
  workspaceId,
  inputs: z.array(relativePath).min(1).max(50),
  outputPath: relativePath,
  operations: z.array(operation).min(1).max(200),
});

registerTool('artifact_render', '将工作区内 DOCX、PPTX、XLSX 或 PDF 渲染为预览 PDF、页面缩略图和预览清单。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  pages: z.object({
    from: z.number().int().min(1).optional(),
    to: z.number().int().min(1).optional(),
  }).optional(),
  dpi: z.number().int().min(72).max(240).optional().default(144),
}, 180_000);

registerTool('artifact_validate', '执行 DOCX、PPTX、XLSX 或 PDF 的结构、安全、公式、渲染和兼容性校验。', {
  schemaVersion,
  workspaceId,
  sourcePath: relativePath,
  requireRender: z.boolean().optional().default(true),
}, 180_000);

const transport = new StdioServerTransport();
await server.connect(transport);

function close() {
  void transport.close().finally(() => process.exit(0));
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
