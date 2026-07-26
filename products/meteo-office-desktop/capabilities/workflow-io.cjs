'use strict';

const Ajv2020 = require('ajv/dist/2020');
const yaml = require('js-yaml');
const workflowSchema = require('../schemas/workflow.schema.json');

const WORKFLOW_FILE_SIZE_LIMIT = 2 * 1024 * 1024;
const WORKFLOW_OBJECT_DEPTH_LIMIT = 40;
const WORKFLOW_OBJECT_VISIT_LIMIT = 20_000;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const validateWorkflowSchema = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(workflowSchema);

function workflowSchemaError() {
  const details = (validateWorkflowSchema.errors || [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('；');
  return new Error(`工作流 YAML 不符合 v1alpha1 契约：${details || '结构不合法'}`);
}

function assertSafeWorkflowObjectGraph(value) {
  const seen = new WeakSet();
  let visits = 0;
  const visit = (current, depth) => {
    if (!current || typeof current !== 'object') return;
    if (depth > WORKFLOW_OBJECT_DEPTH_LIMIT) throw new Error('工作流 YAML 嵌套层级过深');
    if (seen.has(current)) throw new Error('工作流 YAML 不支持锚点、别名或循环引用');
    seen.add(current);
    visits += 1;
    if (visits > WORKFLOW_OBJECT_VISIT_LIMIT) throw new Error('工作流 YAML 结构过于复杂');
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`工作流 YAML 包含不安全字段：${key}`);
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function plaintextWorkflowSecret(workflow) {
  const sensitiveKey = /^(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|cookie|set-cookie)$/i;
  const sensitiveText = /(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie)\s*["']?\s*[:=]/i;
  const inspect = (value, pathParts = []) => {
    if (typeof value === 'string') {
      if (sensitiveText.test(value) && !/^\$\{credentials?\.[^}]+\}$/.test(value.trim())) {
        return pathParts.join('.');
      }
      return '';
    }
    if (!value || typeof value !== 'object') return '';
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKey.test(key) && key !== 'credentialRef' && String(child || '').trim()) {
        return [...pathParts, key].join('.');
      }
      const match = inspect(child, [...pathParts, key]);
      if (match) return match;
    }
    return '';
  };
  for (const node of workflow?.spec?.nodes || []) {
    if (node?.type !== 'http') continue;
    if (/^https?:\/\/[^/@]+@/i.test(node.config?.url || '')) {
      return `nodes.${node.id || 'http'}.config.url`;
    }
    const match = inspect(node.config || {}, ['nodes', node.id || 'http', 'config']);
    if (match) return match;
  }
  return '';
}

function assertWorkflowSchema(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('工作流文件必须包含一个对象');
  }
  assertSafeWorkflowObjectGraph(workflow);
  if (!validateWorkflowSchema(workflow)) throw workflowSchemaError();
  return workflow;
}

function parseWorkflowYaml(text) {
  if (Buffer.byteLength(text, 'utf8') > WORKFLOW_FILE_SIZE_LIMIT) {
    throw new Error('工作流文件不能超过 2 MB');
  }
  let hasYamlReferences = false;
  const workflow = yaml.load(text, {
    schema: yaml.CORE_SCHEMA,
    json: false,
    listener: (_event, state) => {
      if (Object.keys(state.anchorMap || {}).length) hasYamlReferences = true;
    },
  });
  if (hasYamlReferences) throw new Error('工作流 YAML 不支持锚点、别名或循环引用');
  const validated = assertWorkflowSchema(workflow);
  const secretPath = plaintextWorkflowSecret(validated);
  if (secretPath) {
    throw new Error(`HTTP 节点包含疑似明文凭据（${secretPath}），请改用 credentialRef 后再导入`);
  }
  return validated;
}

function serializeWorkflowYaml(workflow) {
  assertWorkflowSchema(workflow);
  const secretPath = plaintextWorkflowSecret(workflow);
  if (secretPath) {
    throw new Error(`HTTP 节点包含疑似明文凭据（${secretPath}），请改用 credentialRef 后再导出`);
  }
  return yaml.dump(JSON.parse(JSON.stringify(workflow)), {
    schema: yaml.CORE_SCHEMA,
    noRefs: true,
    noCompatMode: true,
    lineWidth: 110,
    sortKeys: false,
  });
}

module.exports = {
  WORKFLOW_FILE_SIZE_LIMIT,
  assertSafeWorkflowObjectGraph,
  assertWorkflowSchema,
  plaintextWorkflowSecret,
  parseWorkflowYaml,
  serializeWorkflowYaml,
};
