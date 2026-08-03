(function initializeComputerConnector(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MeteoMateComputerConnector = api;
  if (root?.window && root.window !== root) root.window.MeteoMateComputerConnector = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  'use strict';

  const ID = 'cua-desktop';
  const DRIVER_VERSION = '0.12.2';

  const OBSERVE_TOOLS = Object.freeze([
    'check_permissions',
    'health_report',
    'list_apps',
    'list_windows',
    'get_window_state',
    'get_screen_size',
    'get_cursor_position',
    'zoom',
    'get_browser_state',
  ]);
  const INSPECTION_TOOLS = Object.freeze([
    'get_desktop_state',
    'get_accessibility_tree',
  ]);
  const INTERACTION_TOOLS = Object.freeze([
    'click',
    'double_click',
    'right_click',
    'drag',
    'scroll',
    'move_cursor',
    'press_key',
    'bring_to_front',
    'browser_prepare',
    'browser_navigate',
    'browser_click',
    'browser_pointer',
    'browser_dialog',
    'page',
  ]);
  const SENSITIVE_TOOLS = Object.freeze([
    'type_text',
    'hotkey',
    'set_value',
    'launch_app',
    'kill_app',
    'browser_type',
    'browser_download',
    'browser_set_input_files',
  ]);
  const BLOCKED_TOOLS = Object.freeze([
    'start_session',
    'get_session_state',
    'escalate_session',
    'end_session',
    'get_config',
    'set_config',
    'get_recording_state',
    'start_recording',
    'stop_recording',
    'replay_trajectory',
    'get_agent_cursor_state',
    'set_agent_cursor_enabled',
    'set_agent_cursor_motion',
    'set_agent_cursor_style',
    'check_for_update',
    'install_ffmpeg',
  ]);
  const SAFE_TOOLS = Object.freeze([
    ...OBSERVE_TOOLS,
    ...INSPECTION_TOOLS,
    ...INTERACTION_TOOLS,
    ...SENSITIVE_TOOLS,
  ]);

  const PRESET = Object.freeze({
    id: ID,
    name: '桌面应用操作',
    description: '使用 MeteoMate 内嵌的 Cua Driver 读取本机应用窗口，并在授权后完成点击、输入和键盘操作。',
    version: '1.0.0',
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: [],
    timeout: 300,
    riskClassification: 'high',
    connectorType: 'computer',
    toolAllowlist: SAFE_TOOLS,
  });

  function isComputerConnector(value) {
    return value?.id === ID || value?.connectorType === 'computer';
  }

  function allowedTools(selectedTools) {
    if (!Array.isArray(selectedTools)) return [...SAFE_TOOLS];
    const requested = new Set(selectedTools.map(String));
    return SAFE_TOOLS.filter((tool) => requested.has(tool));
  }

  function toolRisk(toolName) {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (OBSERVE_TOOLS.includes(normalized)) return 'observe';
    if (INSPECTION_TOOLS.includes(normalized)) return 'inspect';
    if (INTERACTION_TOOLS.includes(normalized)) return 'interaction';
    if (SENSITIVE_TOOLS.includes(normalized)) return 'sensitive';
    return 'blocked';
  }

  function materialize(input = {}, { connection = null, runtimeInfo = null } = {}) {
    const mcp = connection?.mcp;
    const runtimeEnv = Array.isArray(mcp?.environment)
      ? Object.fromEntries(mcp.environment.map((entry) => [String(entry.name), String(entry.value)]))
      : {};
    return {
      ...input,
      id: ID,
      name: String(input.name || PRESET.name),
      description: String(input.description || PRESET.description),
      version: PRESET.version,
      transport: PRESET.transport,
      command: String(mcp?.command || PRESET.command),
      args: Array.isArray(mcp?.args) ? [...mcp.args] : [],
      runtimeEnv,
      runtimeInfo: runtimeInfo ? { ...runtimeInfo } : null,
      cwd: null,
      timeout: PRESET.timeout,
      riskClassification: PRESET.riskClassification,
      connectorType: PRESET.connectorType,
      managedPreset: ID,
      toolAllowlist: [...SAFE_TOOLS],
    };
  }

  return Object.freeze({
    ID,
    DRIVER_VERSION,
    PRESET,
    SAFE_TOOLS,
    BLOCKED_TOOLS,
    isComputerConnector,
    allowedTools,
    toolRisk,
    materialize,
  });
});
