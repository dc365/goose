'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SkillPackage = require('./skill-package.cjs');

function connectorIds(report) {
  const raw = report?.sidecar?.data?.requires?.connectors || [];
  const values = Array.isArray(raw) ? raw : [];
  return values
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
    .map((entry) => String(entry || '').split('@')[0])
    .filter(Boolean);
}

function readTests(root) {
  const directory = path.join(root, 'tests');
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
    const filePath = path.join(directory, entry.name);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      result.push({ file: `tests/${entry.name}`, data, parseError: null });
    } catch (error) {
      result.push({ file: `tests/${entry.name}`, data: null, parseError: error.message });
    }
  }
  return result.sort((left, right) => left.file.localeCompare(right.file));
}

function contains(source, expected) {
  return String(source || '').toLocaleLowerCase('zh-CN').includes(String(expected || '').toLocaleLowerCase('zh-CN'));
}

function checkTest(root, skillSource, report, item, index) {
  const name = String(item.data?.name || `测试 ${index + 1}`);
  const failures = [];
  const warnings = [];
  if (item.parseError) failures.push(`JSON 无法解析：${item.parseError}`);
  const test = item.data || {};
  if (!String(test.prompt || '').trim()) failures.push('缺少 prompt');
  if (!test.expected || typeof test.expected !== 'object') failures.push('缺少 expected 对象');

  const sections = Array.isArray(test.expected?.sections) ? test.expected.sections : [];
  for (const section of sections) {
    if (!contains(skillSource, section)) failures.push(`SKILL.md 未包含预期章节或关键词：${section}`);
  }

  const files = Array.isArray(test.expected?.files) ? test.expected.files : [];
  for (const relative of files) {
    const normalized = path.normalize(String(relative || ''));
    const target = path.resolve(root, normalized);
    const rel = path.relative(path.resolve(root), target);
    if (!relative || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      failures.push(`测试文件路径无效：${relative}`);
    } else if (!fs.existsSync(target)) {
      failures.push(`缺少预期文件：${relative}`);
    }
  }

  const availableConnectors = new Set(connectorIds(report));
  const expectedConnectors = Array.isArray(test.expected?.connectors) ? test.expected.connectors : [];
  for (const connector of expectedConnectors) {
    if (!availableConnectors.has(String(connector).split('@')[0])) {
      failures.push(`未声明预期连接器：${connector}`);
    }
  }

  const forbidden = Array.isArray(test.forbiddenPhrases) ? test.forbiddenPhrases : [];
  for (const phrase of forbidden) {
    if (contains(skillSource, phrase)) failures.push(`包含禁止短语：${phrase}`);
  }

  if (!sections.length) warnings.push('建议使用 expected.sections 检查关键流程和验收章节');
  if (!files.length) warnings.push('建议使用 expected.files 检查交付文件');
  return {
    name,
    file: item.file,
    prompt: String(test.prompt || ''),
    passed: failures.length === 0,
    failures,
    warnings,
  };
}

function qualityChecks(skillSource, report) {
  const checks = [];
  const description = String(report?.skill?.description || '');
  checks.push({
    id: 'description-trigger',
    label: 'Description 同时说明能力和触发场景',
    passed: description.length >= 30 && /(?:当|用于|用户|需要|要求|when|use)/i.test(description),
  });
  checks.push({
    id: 'workflow',
    label: '包含清晰的执行流程',
    passed: /(?:执行流程|工作流程|步骤|workflow|steps)/i.test(skillSource),
  });
  checks.push({
    id: 'validation',
    label: '包含验证或完成标准',
    passed: /(?:验证|完成标准|验收|verify|validation|success criteria)/i.test(skillSource),
  });
  checks.push({
    id: 'boundaries',
    label: '说明限制、禁止场景或安全边界',
    passed: /(?:限制|禁止|不要|不得|边界|do not|never|limitations)/i.test(skillSource),
  });
  return checks;
}

function runStaticTests(root, report = SkillPackage.inspectRoot(root)) {
  const skillPath = path.join(root, 'SKILL.md');
  const skillSource = fs.readFileSync(skillPath, 'utf8');
  const tests = readTests(root);
  const cases = tests.map((item, index) => checkTest(root, skillSource, report, item, index));
  const quality = qualityChecks(skillSource, report);
  const failures = cases.reduce((total, item) => total + item.failures.length, 0);
  const qualityFailures = quality.filter((item) => !item.passed).length;
  const ready = tests.length > 0
    && failures === 0
    && qualityFailures === 0
    && report.risk?.level !== 'critical';
  return {
    apiVersion: 'meteomate.ai/v1',
    kind: 'SkillTestReport',
    checkedAt: Date.now(),
    ready,
    summary: {
      total: cases.length,
      passed: cases.filter((item) => item.passed).length,
      failed: cases.filter((item) => !item.passed).length,
      qualityPassed: quality.filter((item) => item.passed).length,
      qualityTotal: quality.length,
    },
    cases,
    quality,
    warnings: tests.length ? [] : ['缺少 tests/*.json；至少需要一个最小验收用例'],
  };
}

module.exports = { readTests, runStaticTests, qualityChecks, connectorIds };
