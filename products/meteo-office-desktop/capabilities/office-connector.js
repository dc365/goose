(function initializeOfficeConnector(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MeteoMateOfficeConnector = api;
  if (root?.window && root.window !== root) root.window.MeteoMateOfficeConnector = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  'use strict';

  const ID = 'office-artifacts';
  const RUNTIME_VERSION = '1.2.0';

  const OBSERVE_TOOLS = Object.freeze([
    'docx_inspect',
    'pptx_inspect',
    'xlsx_inspect',
    'pdf_inspect',
    'artifact_render',
    'artifact_validate',
  ]);
  const MUTATION_TOOLS = Object.freeze([
    'docx_create_from_markdown',
    'docx_create',
    'docx_edit',
    'pptx_create',
    'pptx_edit',
    'xlsx_create',
    'xlsx_edit',
    'pdf_create',
    'pdf_transform',
  ]);
  const SAFE_TOOLS = Object.freeze([...OBSERVE_TOOLS, ...MUTATION_TOOLS]);

  const PRESET = Object.freeze({
    id: ID,
    name: 'Office 成果物',
    description: '在当前项目内创建、编辑、渲染并校验 DOCX、PPTX、XLSX 和 PDF 成果物。',
    version: '1.2.0',
    transport: 'stdio',
    command: 'MeteoMate Runtime',
    args: [],
    timeout: 180,
    riskClassification: 'medium',
    connectorType: 'office',
    toolAllowlist: SAFE_TOOLS,
  });

  function isOfficeConnector(value) {
    return value?.id === ID || value?.connectorType === 'office';
  }

  function allowedTools(selectedTools) {
    if (!Array.isArray(selectedTools)) return [...SAFE_TOOLS];
    const requested = new Set(selectedTools.map(String));
    return SAFE_TOOLS.filter((tool) => requested.has(tool));
  }

  function toolRisk(toolName) {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (OBSERVE_TOOLS.includes(normalized)) return 'observe';
    if (MUTATION_TOOLS.includes(normalized)) return 'mutation';
    return 'blocked';
  }

  function materialize(input = {}, { runtime, workspace } = {}) {
    if (!runtime?.command || !Array.isArray(runtime.argsPrefix)) {
      throw new Error('Office 运行时尚未准备完成');
    }
    if (!workspace) throw new Error('Office 成果物必须绑定项目工作区');
    return {
      ...input,
      id: ID,
      name: String(input.name || PRESET.name),
      description: String(input.description || PRESET.description),
      version: PRESET.version,
      transport: PRESET.transport,
      command: runtime.command,
      args: [...runtime.argsPrefix],
      runtimeEnv: {
        ...runtime.env,
        METEOMATE_OFFICE_WORKSPACE: workspace,
      },
      runtimeInfo: { ...runtime.info },
      cwd: workspace,
      timeout: PRESET.timeout,
      riskClassification: PRESET.riskClassification,
      connectorType: PRESET.connectorType,
      managedPreset: ID,
      toolAllowlist: [...SAFE_TOOLS],
    };
  }

  return Object.freeze({
    ID,
    RUNTIME_VERSION,
    PRESET,
    OBSERVE_TOOLS,
    MUTATION_TOOLS,
    SAFE_TOOLS,
    isOfficeConnector,
    allowedTools,
    toolRisk,
    materialize,
  });
});
