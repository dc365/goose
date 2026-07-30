'use strict';

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const RESERVED_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_AUDIT',
  'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_FRAMEWORK_PATH', 'PYTHONPATH',
  'PYTHONHOME', 'NODE_OPTIONS', 'RUBYOPT', 'CLASSPATH', 'COMSPEC', 'TEMP', 'TMP',
  'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
]);

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value || '')
    .split(/\r?\n|\s+(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function normalizeObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [String(key).trim(), String(item ?? '')])
        .filter(([key]) => key)
    );
  }
  const result = {};
  for (const line of String(value).split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function validateSecretObject(input, label) {
  const object = normalizeObject(input);
  for (const key of Object.keys(object)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) throw new Error(`${label} 名称无效：${key}`);
    if (RESERVED_ENV_KEYS.has(key.toUpperCase())) throw new Error(`${label} 不允许覆盖受保护变量：${key}`);
  }
  return object;
}

function normalizeConnector(input = {}) {
  const transport = input.transport === 'streamable-http' || input.transport === 'streamable_http'
    ? 'streamable-http'
    : 'stdio';
  const name = String(input.name || '').trim();
  const id = slug(input.id || name);
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('工具服务 ID 只能包含小写字母、数字和连字符');
  if (!name) throw new Error('工具服务名称不能为空');
  const timeout = Math.max(3, Math.min(600, Number(input.timeout || 30)));
  const normalized = {
    apiVersion: 'meteomate.ai/v1',
    kind: 'ConnectorBinding',
    id,
    name,
    description: String(input.description || '').trim(),
    version: String(input.version || '0.1.0'),
    transport,
    enabled: input.enabled !== false,
    projectIds: [...new Set((Array.isArray(input.projectIds) ? input.projectIds : []).map(String).filter(Boolean))],
    timeout,
    riskClassification: input.riskClassification || 'medium',
    connectorType: String(input.connectorType || '').trim() || null,
    managedPreset: String(input.managedPreset || '').trim() || null,
    toolAllowlist: Array.isArray(input.toolAllowlist)
      ? [...new Set(input.toolAllowlist.map(String).filter(Boolean))]
      : null,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (transport === 'stdio') {
    normalized.command = String(input.command || '').trim();
    normalized.args = normalizeStringArray(input.args);
    normalized.cwd = String(input.cwd || '').trim() || null;
    if (!normalized.command) throw new Error('STDIO 工具服务需要命令');
  } else {
    normalized.url = String(input.url || '').trim();
    let parsed;
    try {
      parsed = new URL(normalized.url);
    } catch {
      throw new Error('Streamable HTTP 工具服务 URL 无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('工具服务 URL 只支持 HTTP 或 HTTPS');
    normalized.url = parsed.toString();
  }
  return {
    record: normalized,
    secrets: {
      env: validateSecretObject(input.env, '环境变量'),
      headers: validateSecretObject(input.headers, 'Header'),
    },
  };
}

function executableExists(command) {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) {
    try {
      return require('node:fs').statSync(path.resolve(command)).isFile();
    } catch {
      return false;
    }
  }
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], { stdio: 'ignore', windowsHide: true, shell: false });
  return result.status === 0;
}

function parseJsonRpcLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed.startsWith('data:')) {
      try {
        return JSON.parse(trimmed.slice(5).trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDiscoveredTool(tool = {}) {
  const properties = tool.inputSchema?.properties;
  const parameters = Array.isArray(tool.parameters)
    ? tool.parameters.map(String).slice(0, 200)
    : properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.keys(properties).slice(0, 200)
      : [];
  const declaredRequired = Array.isArray(tool.requiredParameters)
    ? tool.requiredParameters
    : tool.inputSchema?.required;
  const required = Array.isArray(declaredRequired)
    ? declaredRequired.map(String).filter((name) => parameters.includes(name))
    : [];
  const annotations = tool.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations)
    ? { ...tool.annotations }
    : {};
  const effects = tool.effects && typeof tool.effects === 'object' && !Array.isArray(tool.effects)
    ? { ...tool.effects }
    : annotations.effects && typeof annotations.effects === 'object'
      ? { ...annotations.effects }
      : {};
  const declaredMaturity = String(tool.maturity || annotations.maturity || '').trim().toLowerCase();
  const maturity = ['planned', 'demo', 'experimental', 'beta', 'production', 'deprecated']
    .includes(declaredMaturity)
    ? declaredMaturity
    : null;
  return {
    name: String(tool.name || '').slice(0, 512),
    description: String(tool.description || '').slice(0, 12000),
    maturity,
    parameters,
    requiredParameters: required,
    annotations,
    effects,
  };
}

function normalizeLastTest(value) {
  if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean') return null;
  const normalized = {
    ok: value.ok,
    checkedAt: Number.isFinite(Number(value.checkedAt)) ? Number(value.checkedAt) : Date.now(),
    durationMs: Math.max(0, Number(value.durationMs) || 0),
  };
  if (!value.ok) {
    normalized.error = String(value.error || '连接失败').slice(0, 2000);
    return normalized;
  }
  const result = value.result && typeof value.result === 'object' ? value.result : {};
  normalized.result = {
    ok: result.ok !== false,
    transport: String(result.transport || ''),
    status: Number(result.status) || undefined,
    serverInfo: result.serverInfo && typeof result.serverInfo === 'object'
      ? { name: String(result.serverInfo.name || ''), version: String(result.serverInfo.version || '') }
      : null,
    tools: (Array.isArray(result.tools) ? result.tools : []).slice(0, 5000).map(normalizeDiscoveredTool),
  };
  return normalized;
}

async function testStdioConnector(config, secrets = {}) {
  if (!executableExists(config.command)) throw new Error(`找不到命令：${config.command}`);
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args || [], {
      cwd: config.cwd || undefined,
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...(config.runtimeEnv || {}), ...(secrets.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => finish(new Error('工具服务初始化超时')), (config.timeout || 30) * 1000);
    let settled = false;
    let stdoutBuffer = '';
    let stderrTail = '';
    let initialized = false;
    let serverInfo = null;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore process cleanup errors.
      }
      if (error) reject(error);
      else resolve(result);
    }

    child.on('error', (error) => finish(error));
    child.stderr.on('data', (data) => {
      stderrTail = `${stderrTail}${data.toString()}`.slice(-4000);
    });
    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const message = parseJsonRpcLine(line);
        if (!message) continue;
        if (message.id === 1 && message.result) {
          initialized = true;
          serverInfo = message.result.serverInfo || null;
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (message.id === 2) {
          const tools = Array.isArray(message.result?.tools) ? message.result.tools : [];
          finish(null, {
            ok: true,
            transport: 'stdio',
            serverInfo,
            tools: tools.slice(0, 5000).map(normalizeDiscoveredTool),
            stderr: stderrTail.trim(),
          });
        }
      }
    });
    child.on('close', (code) => {
      if (!settled && !initialized) finish(new Error(`工具服务进程提前退出（code=${code}）${stderrTail ? `：${stderrTail.trim()}` : ''}`));
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'meteomate-capability-center', version: '0.1.0' },
      },
    })}\n`);
  });
}

function parseHttpJson(text, expectedId = null) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const messages = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]')
      .map(parseJsonRpcLine)
      .filter(Boolean);
    return messages.find((message) => expectedId === null || message.id === expectedId) || messages[0] || null;
  }
}

async function postHttpMcpMessage(config, headers, payload) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout((config.timeout || 30) * 1000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 400)}`);
  const message = payload.id === undefined ? null : parseHttpJson(text, payload.id);
  if (message?.error) throw new Error(message.error.message || `MCP ${payload.method} failed`);
  if (payload.id !== undefined && !message?.result) throw new Error(`MCP ${payload.method} 未返回有效结果`);
  return { response, message };
}

async function testHttpConnector(config, secrets = {}) {
  const baseHeaders = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(secrets.headers || {}),
  };
  const initializeRequest = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'meteomate-capability-center', version: '0.1.0' },
    },
  };
  const initialized = await postHttpMcpMessage(config, baseHeaders, initializeRequest);
  const sessionId = initialized.response.headers.get('mcp-session-id');
  const protocolVersion = initialized.message.result?.protocolVersion || '2025-06-18';
  const sessionHeaders = {
    ...baseHeaders,
    'MCP-Protocol-Version': protocolVersion,
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  };
  await postHttpMcpMessage(config, sessionHeaders, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  const tools = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const listed = await postHttpMcpMessage(config, sessionHeaders, {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/list',
      params: cursor ? { cursor } : {},
    });
    if (Array.isArray(listed.message.result?.tools)) tools.push(...listed.message.result.tools);
    cursor = listed.message.result?.nextCursor || null;
    if (!cursor) break;
    if (page === 99) throw new Error('MCP tools/list 分页过多，已停止读取');
  }
  return {
    ok: true,
    transport: 'streamable-http',
    status: initialized.response.status,
    serverInfo: initialized.message.result?.serverInfo || null,
    sessionId,
    tools: tools.slice(0, 5000).map(normalizeDiscoveredTool),
  };
}

async function testConnector(config, secrets = {}) {
  return config.transport === 'streamable-http'
    ? testHttpConnector(config, secrets)
    : testStdioConnector(config, secrets);
}

function extensionConfig(config, secrets = {}, availableTools) {
  const toolAllowlist = Array.isArray(availableTools) && availableTools.length
    ? { available_tools: [...new Set(availableTools.map(String).filter(Boolean))] }
    : {};
  if (config.transport === 'streamable-http') {
    return {
      type: 'streamable_http',
      name: config.id,
      description: config.description || config.name,
      uri: config.url,
      envs: secrets.env || {},
      env_keys: [],
      headers: secrets.headers || {},
      timeout: config.timeout || 30,
      bundled: false,
      ...toolAllowlist,
    };
  }
  return {
    type: 'stdio',
    name: config.id,
    description: config.description || config.name,
    cmd: config.command,
    args: config.args || [],
    envs: { ...(config.runtimeEnv || {}), ...(secrets.env || {}) },
    env_keys: [],
    timeout: config.timeout || 30,
    cwd: config.cwd || undefined,
    bundled: false,
    ...toolAllowlist,
  };
}

function gooseExtensionConfig(config, secrets = {}, availableTools) {
  const extension = extensionConfig(config, secrets, availableTools);
  const shared = {
    type: 'mcp',
    envKeys: extension.env_keys || [],
    description: extension.description,
    timeout: extension.timeout,
    bundled: extension.bundled,
    ...(extension.available_tools ? { available_tools: extension.available_tools } : {}),
  };
  if (extension.type === 'streamable_http') {
    return {
      ...shared,
      server: {
        type: 'http',
        name: extension.name,
        url: extension.uri,
        headers: Object.entries(extension.headers || {}).map(([name, value]) => ({ name, value })),
      },
    };
  }
  return {
    ...shared,
    server: {
      name: extension.name,
      command: extension.cmd,
      args: extension.args || [],
      env: Object.entries(extension.envs || {}).map(([name, value]) => ({ name, value })),
    },
  };
}

module.exports = {
  RESERVED_ENV_KEYS,
  slug,
  normalizeConnector,
  normalizeLastTest,
  testConnector,
  extensionConfig,
  gooseExtensionConfig,
  executableExists,
};
