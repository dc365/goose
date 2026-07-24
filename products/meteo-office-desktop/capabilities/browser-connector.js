(function initializeBrowserConnector(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MeteoMateBrowserConnector = api;
  if (root?.window && root.window !== root) root.window.MeteoMateBrowserConnector = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  'use strict';

  const ID = 'playwright-browser';
  const MCP_VERSION = '0.0.78';
  const MCP_PACKAGE = `@playwright/mcp@${MCP_VERSION}`;
  const MCP_ARGS = Object.freeze([
    '--isolated',
    '--viewport-size',
    '1440x900',
  ]);

  const OBSERVE_TOOLS = Object.freeze([
    'browser_close',
    'browser_resize',
    'browser_console_messages',
    'browser_find',
    'browser_navigate',
    'browser_navigate_back',
    'browser_take_screenshot',
    'browser_snapshot',
    'browser_tabs',
    'browser_wait_for',
  ]);
  const INTERACTION_TOOLS = Object.freeze([
    'browser_fill_form',
    'browser_press_key',
    'browser_type',
    'browser_click',
    'browser_drag',
    'browser_hover',
    'browser_select_option',
  ]);
  const SENSITIVE_TOOLS = Object.freeze(['browser_handle_dialog']);
  const BLOCKED_TOOLS = Object.freeze([
    'browser_evaluate',
    'browser_file_upload',
    'browser_drop',
    'browser_network_requests',
    'browser_network_request',
    'browser_run_code_unsafe',
  ]);
  const SAFE_TOOLS = Object.freeze([
    ...OBSERVE_TOOLS,
    ...INTERACTION_TOOLS,
    ...SENSITIVE_TOOLS,
  ]);

  const PRESET = Object.freeze({
    id: ID,
    name: '浏览器操作',
    description: '使用 Goose 官方推荐的 Playwright MCP 打开网页、读取内容、截图并完成点击和表单操作。',
    version: '1.0.0',
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: MCP_ARGS,
    timeout: 300,
    riskClassification: 'medium',
    connectorType: 'browser',
    toolAllowlist: SAFE_TOOLS,
  });

  function isBrowserConnector(value) {
    return value?.id === ID || value?.connectorType === 'browser';
  }

  function allowedTools(selectedTools) {
    if (!Array.isArray(selectedTools)) return [...SAFE_TOOLS];
    const requested = new Set(selectedTools.map(String));
    return SAFE_TOOLS.filter((tool) => requested.has(tool));
  }

  function toolRisk(toolName) {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (OBSERVE_TOOLS.includes(normalized)) return 'observe';
    if (INTERACTION_TOOLS.includes(normalized)) return 'interaction';
    if (SENSITIVE_TOOLS.includes(normalized)) return 'sensitive';
    return 'blocked';
  }

  function materialize(input = {}, { runtime, outputDir = '' } = {}) {
    if (!runtime?.command || !Array.isArray(runtime.argsPrefix)) {
      throw new Error('浏览器运行时尚未准备完成');
    }
    const args = [...runtime.argsPrefix, ...PRESET.args];
    if (outputDir) args.push('--output-dir', outputDir);
    return {
      ...input,
      id: ID,
      name: String(input.name || PRESET.name),
      description: String(input.description || PRESET.description),
      version: PRESET.version,
      transport: PRESET.transport,
      command: runtime.command,
      args,
      runtimeEnv: { ...runtime.env },
      runtimeInfo: { ...runtime.info },
      cwd: outputDir || null,
      timeout: PRESET.timeout,
      riskClassification: PRESET.riskClassification,
      connectorType: PRESET.connectorType,
      managedPreset: ID,
      toolAllowlist: [...SAFE_TOOLS],
    };
  }

  return Object.freeze({
    ID,
    MCP_VERSION,
    MCP_PACKAGE,
    MCP_ARGS,
    PRESET,
    SAFE_TOOLS,
    BLOCKED_TOOLS,
    isBrowserConnector,
    allowedTools,
    toolRisk,
    materialize,
  });
});
