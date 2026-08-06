'use strict';

const assert = require('node:assert/strict');
const Guard = require('../capabilities/streaming-output-guard.cjs');

const url = 'http://192.168.18.227:11005/api/ai/files/documents/福州-强天气过程短临预报(2026年06月16日15时10分发布）-2026031.docx';

const streaming = Guard.createOfficeOutputGuard(true);
const first = Guard.appendOfficeOutput(streaming, [
  '福州短时强天气过程短临预报Word产品已成功生成。',
  '',
  '## 产品信息',
  '',
  '- 文件名：短临产品.docx',
  `- 访问地址：${url}`,
  '',
  '天气摘要：未来2小时有强降水。',
].join('\n'));
assert.equal(first.text.includes('天气摘要'), true);
assert.equal(first.downloadReady, true);
assert.equal(first.shouldCancel, false);

const repeated = Guard.appendOfficeOutput(streaming, [
  '',
  '福州短时强天气过程短临预报Word产品已成功生成。',
  '',
  '## 产品信息',
  '',
  '- 文件名：短临产品.docx',
  `- 访问地址：${url}`,
].join('\n'));
assert.equal(repeated.text.trim(), '福州短时强天气过程短临预报Word产品已成功生成。');
assert.equal(repeated.downloadReady, false);
assert.equal(repeated.shouldCancel, true);
assert.equal(streaming.forwardedText.match(/## 产品信息/g).length, 1);

const afterBlocked = Guard.appendOfficeOutput(streaming, '\n## 产品基本信息\n继续重复');
assert.deepEqual(afterBlocked, { text: '', downloadReady: false, shouldCancel: false });

const singleChunk = Guard.createOfficeOutputGuard(true);
const guarded = Guard.appendOfficeOutput(singleChunk, [
  '产品文件已成功生成。',
  `访问地址：${url}`,
  '',
  '## 产品信息',
  '- 这是重复内容',
].join('\n'));
assert.equal(guarded.shouldCancel, true);
assert.equal(guarded.text.includes('这是重复内容'), false);

const normal = Guard.createOfficeOutputGuard(false);
const normalResult = Guard.appendOfficeOutput(normal, `普通分析正文。\n${url}\n## 产品信息\n不应截断`);
assert.equal(normalResult.shouldCancel, false);
assert.equal(normalResult.text.includes('不应截断'), true);

console.log('MeteoMate streaming Office output guard passed.');
