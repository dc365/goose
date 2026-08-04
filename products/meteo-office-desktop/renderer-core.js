const brand = window.METEOMATE_BRAND;
// 平台标记：Windows/Linux 需要为自绘窗口控制按钮预留标题栏空间
if (document.body) {
  document.body.classList.add(`platform-${window.meteoDesktop?.platform || 'darwin'}`);
}
const catalog = Object.freeze({
  experts: window.METEOMATE_EXPERTS,
  teams: window.METEOMATE_TEAMS,
  skills: window.METEOMATE_SKILLS,
  skillRoadmap: window.METEOMATE_SKILL_ROADMAP,
  connectors: window.METEOMATE_CONNECTORS,
  scenes: window.METEOMATE_SCENES,
  permissionProfiles: window.METEOMATE_PERMISSION_PROFILES,
});

function userFacingToolCatalog() {
  const capabilityItems = window.MeteoMateCapabilityCenter?.connectorCatalog?.();
  const items = Array.isArray(capabilityItems) ? capabilityItems : catalog.connectors;
  return items.filter((item) => item.id !== 'goose-runtime');
}

function userFacingSkillCatalog() {
  const capabilityItems = window.MeteoMateCapabilityCenter?.skillCatalog?.();
  return Array.isArray(capabilityItems) ? capabilityItems : catalog.skills;
}

function enabledSkillCatalog(projectId = null) {
  const capabilityItems = window.MeteoMateCapabilityCenter?.enabledSkillCatalog?.(projectId);
  return Array.isArray(capabilityItems) ? capabilityItems : [];
}

function enabledSkillIds(skillIds = [], projectId = null) {
  const available = new Set(enabledSkillCatalog(projectId).map((item) => item.id));
  return [...new Set(skillIds)].filter((id) => available.has(id));
}

function normalizeToolSelections(value, connectorIds = []) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = new Set(connectorIds);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([connectorId, toolNames]) => allowed.has(connectorId) && Array.isArray(toolNames))
      .map(([connectorId, toolNames]) => [
        connectorId,
        connectorId === 'office-artifacts'
          ? window.MeteoMateOfficeConnector.upgradeToolSelection(toolNames)
          : [...new Set(toolNames.map(String).filter(Boolean))],
      ])
  );
}

function connectorTools(connector) {
  return (Array.isArray(connector?.tools) ? connector.tools : [])
    .filter((tool) => tool?.name)
    .map((tool) => ({ ...tool, name: String(tool.name) }));
}

function selectedConnectorToolNames(connector, connectorIds, toolSelections) {
  if (!connectorIds.includes(connector.id)) return [];
  const tools = connectorTools(connector);
  const explicit = toolSelections && Object.prototype.hasOwnProperty.call(toolSelections, connector.id)
    ? toolSelections[connector.id]
    : null;
  if (!Array.isArray(explicit)) return tools.map((tool) => tool.name);
  const available = new Set(tools.map((tool) => tool.name));
  return [...new Set(explicit.map(String).filter((name) => !tools.length || available.has(name)))];
}

function connectorToolSelectionCount(connectorIds = [], toolSelections = {}, connectors = userFacingToolCatalog()) {
  return connectorIds.reduce((total, connectorId) => {
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) return total;
    const tools = connectorTools(connector);
    return total + (tools.length ? selectedConnectorToolNames(connector, connectorIds, toolSelections).length : 0);
  }, 0);
}

function renderConnectorToolSelector({ scope, connectorIds = [], toolSelections = {}, connectors = userFacingToolCatalog() }) {
  const visibleConnectors = connectors.filter((item) => item.id !== 'goose-runtime');
  if (!visibleConnectors.length) return '<p class="tool-selector-empty">还没有可用工具服务，请先连接并测试 MCP 服务。</p>';
  return `<div class="tool-granularity-selector" data-tool-selector="${escapeHtml(scope)}">
    ${visibleConnectors.map((connector) => {
      const tools = connectorTools(connector);
      const selected = connectorIds.includes(connector.id);
      const selectedNames = new Set(selectedConnectorToolNames(connector, connectorIds, toolSelections));
      const selectedCount = selectedNames.size;
      const summary = tools.length ? `${selectedCount}/${tools.length} 个工具` : '尚未发现工具';
      const searchText = `${connector.name} ${connector.description || ''} ${connector.category || ''} ${(connector.tags || []).join(' ')} ${tools.map((tool) => `${tool.name} ${tool.description || ''}`).join(' ')}`.toLowerCase();
      return `<article class="tool-service-option ${selected ? 'selected' : ''} ${selected && tools.length ? 'expanded' : ''}" data-tool-service="${escapeHtml(connector.id)}" data-capability-search-text="${escapeHtml(searchText)}">
        <div class="tool-service-row">
          <label class="tool-service-check">
            <input type="checkbox" name="${escapeHtml(scope)}-connectors" value="${escapeHtml(connector.id)}" data-tool-service-checkbox ${selected ? 'checked' : ''} />
            <span><strong>${escapeHtml(connector.name)}</strong>${scope === 'project-picker' ? `<small class="tool-service-description">${escapeHtml(connector.description || '该工具服务暂未提供介绍')}</small>` : ''}<small data-tool-selection-count>${escapeHtml(summary)}</small></span>
          </label>
          ${tools.length ? `<button type="button" class="tool-service-disclosure" data-tool-disclosure aria-expanded="${selected ? 'true' : 'false'}" aria-label="展开 ${escapeHtml(connector.name)} 的工具列表">›</button>` : ''}
        </div>
        ${tools.length
          ? `<div class="tool-service-tools" data-tool-list ${selected ? '' : 'hidden'}>
              <div class="tool-service-actions"><span>选择本范围可调用的工具</span><div><button type="button" data-tool-select-all>全选</button><button type="button" data-tool-clear>清空</button></div></div>
              <div class="tool-option-list">${tools.map((tool) => `<label class="tool-option"><input type="checkbox" name="${escapeHtml(scope)}-tools" data-tool-connector-id="${escapeHtml(connector.id)}" data-tool-name="${escapeHtml(tool.name)}" ${selectedNames.has(tool.name) ? 'checked' : ''} /><span><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.description || '该工具服务未提供描述')}</small></span></label>`).join('')}</div>
            </div>`
          : `<p class="tool-service-untested">完成连接测试后，可在这里逐项选择工具。</p>`}
      </article>`;
    }).join('')}
  </div>`;
}

const primaryAssistant = Object.freeze({
  id: 'meteomate-assistant',
  kind: 'assistant',
  name: 'MeteoMate 助理',
  avatar: 'M',
  description: '你的长期气象办公助理，可在固定工作区中持续对话、整理资料并协助推进日常任务。',
  instruction:
    '你是 MeteoMate 的长期个人助理。围绕用户的气象办公工作持续协作，记住当前会话上下文，优先使用用户指定的工作区资料。需要专业分析时调用合适的专家能力，但始终以一个统一助理身份与用户对话。',
  prompts: ['介绍一下你能帮我做什么', '整理当前工作区中的近期材料', '帮我规划今天的气象办公任务'],
  permissionProfile: 'artifact-approval',
});

const projectTemplates = Object.freeze([
  {
    id: 'weather-process-analysis',
    name: '天气过程分析',
    description: '组织多源资料、形势诊断、影响研判和结论复核',
    instruction: '围绕一次天气过程组织资料、分析形势演变、识别关键影响系统，并持续沉淀可复核的结论和成果物。',
    expertIds: ['synoptic-expert'],
    skillIds: ['synoptic-analysis'],
    connectorIds: ['local-workspace', 'weather-data'],
  },
  {
    id: 'heavy-rain-review',
    name: '强降水研判',
    description: '跟踪强降水风险、诊断指标与落区调整',
    instruction: '聚焦强降水过程，结合实况、模式和诊断指标跟踪风险演变，记录每次研判依据和落区调整。',
    expertIds: ['heavy-rain-expert'],
    skillIds: ['heavy-rain-score'],
    connectorIds: ['local-workspace', 'weather-data', 'weather-diagnosis'],
  },
  {
    id: 'forecast-consultation',
    name: '预报会商与写稿',
    description: '从会商材料、结论确认到预报产品发布',
    instruction: '围绕预报会商组织材料、结论、稿件和复核意见，确保最终产品与会商依据保持一致。',
    expertIds: ['writing-expert'],
    skillIds: ['forecast-writing', 'documents'],
    connectorIds: ['local-workspace', 'weather-data', 'office-artifacts'],
  },
  {
    id: 'data-algorithm',
    name: '气象数据与算法研发',
    description: '管理样例数据、算法实验、评估记录和输出产品',
    instruction: '围绕气象数据与算法研发管理输入样例、实验过程、评估证据和输出产品，保证结果可复现。',
    expertIds: ['algorithm-expert'],
    skillIds: ['nc-grib-inspection'],
    connectorIds: ['local-workspace'],
  },
  {
    id: 'event-retrospective',
    name: '灾害天气复盘',
    description: '汇总过程资料、服务记录、偏差分析和改进项',
    instruction: '对一次灾害天气过程进行系统复盘，汇总资料与服务记录，识别预报偏差、关键决策和可执行改进项。',
    expertIds: ['data-expert'],
    skillIds: ['spreadsheets', 'pdf'],
    connectorIds: ['local-workspace', 'knowledge-base', 'office-artifacts'],
  },
]);

const automationTemplates = Object.freeze([
  {
    id: 'daily-synoptic-briefing',
    mark: '形',
    name: '每日天气形势摘要',
    description: '每天早间汇总最新实况与模式资料，生成形势演变和关注重点。',
    prompt: '读取项目内可用的最新实况与模式资料，分析当前天气形势、主要影响系统和未来 24 小时演变，输出业务摘要、关注区域、数据缺口和待确认事项。',
    expertId: 'synoptic-expert',
    skillIds: ['synoptic-analysis'],
    connectorIds: ['weather-data', 'weather-diagnosis'],
    permissionProfileId: 'analysis-readonly',
    trigger: { mode: 'recurring', cadence: 'daily', time: '07:30' },
  },
  {
    id: 'severe-weather-patrol',
    mark: '巡',
    name: '强天气风险巡检',
    description: '按间隔检查强降水与强对流条件，记录风险区和证据变化。',
    prompt: '检查未来 24 小时强降水与强对流风险，比较最新一轮资料与上次结论，列出新增、升级、减弱的风险区域及其主要证据。没有足够数据时明确列出缺口。',
    expertId: 'heavy-rain-expert',
    skillIds: ['heavy-rain-score'],
    connectorIds: ['weather-data', 'weather-diagnosis'],
    permissionProfileId: 'analysis-readonly',
    trigger: { mode: 'interval', intervalValue: 3, intervalUnit: 'hours' },
  },
  {
    id: 'consultation-materials',
    mark: '会',
    name: '预报会商材料整理',
    description: '工作日下午自动整理当天分析、风险结论和待讨论问题。',
    prompt: '汇总项目中当天的分析记录、风险判断和成果物，整理为会商提纲。区分已确认事实、存在分歧的判断和需要会上确认的问题。',
    expertId: 'writing-expert',
    skillIds: ['forecast-writing'],
    connectorIds: ['local-workspace', 'weather-data'],
    permissionProfileId: 'analysis-readonly',
    trigger: { mode: 'recurring', cadence: 'workdays', time: '15:30' },
  },
  {
    id: 'data-quality-check',
    mark: '检',
    name: '气象资料质量检查',
    description: '定时检查文件时次、变量、单位、缺测和空间范围。',
    prompt: '检查项目数据目录中的最新气象资料，记录文件时次、变量、单位、维度、空间范围和缺测情况，列出异常文件及建议处理方式。不要修改原始数据。',
    expertId: 'data-expert',
    skillIds: ['nc-grib-inspection'],
    connectorIds: ['local-workspace'],
    permissionProfileId: 'analysis-readonly',
    trigger: { mode: 'recurring', cadence: 'daily', time: '06:30' },
  },
  {
    id: 'forecast-product-draft',
    mark: '稿',
    name: '日常预报产品初稿',
    description: '按业务时次汇总确认结论，生成待人工复核的预报初稿。',
    prompt: '根据项目中最新的已确认气象结论和业务模板，生成日常预报产品初稿。标注资料时次、适用区域、风险用语和所有需要人工复核的位置。',
    expertId: 'writing-expert',
    skillIds: ['forecast-writing', 'documents'],
    connectorIds: ['local-workspace', 'weather-data', 'office-artifacts'],
    permissionProfileId: 'artifact-approval',
    trigger: { mode: 'recurring', cadence: 'daily', time: '16:00' },
  },
  {
    id: 'weekly-weather-review',
    mark: '周',
    name: '每周天气过程复盘',
    description: '每周汇总主要天气过程、服务产品、偏差和改进事项。',
    prompt: '汇总本周项目中的主要天气过程、任务结论、成果物和服务记录，分析预报偏差与关键决策，输出可执行的下周改进事项。',
    expertId: 'data-expert',
    skillIds: ['spreadsheets', 'pdf'],
    connectorIds: ['local-workspace', 'knowledge-base', 'office-artifacts'],
    permissionProfileId: 'analysis-readonly',
    trigger: { mode: 'recurring', cadence: 'weekly', weekdays: [5], time: '16:30' },
  },
]);

const STORAGE_KEY = 'meteomate-desktop-state-v2';
const LEGACY_STORAGE_KEY = 'meteo-office-desktop-state-v1';
const PROFILE_STORAGE_PREFIX = 'meteomate-desktop-state-v3:';
const PROFILE_MIGRATION_BACKUP_KEY = 'meteomate-desktop-state-profile-migration-backup-v1';

const initialState = {
  view: 'catalog',
  sidebarCollapsed: false,
  collapsedSidebarSections: [],
  catalogTab: 'experts',
  category: '全部',
  search: '',
  teamMode: false,
  favoritesOnly: false,
  favoriteExpertIds: [],
  customExperts: [],
  projects: [],
  activeProjectId: null,
  assistantWorkspace: '',
  tasks: [],
  activeTaskId: null,
  assistantTaskId: null,
  automations: [],
  automationRuns: [],
  workflows: [],
  workflowVersions: [],
  workflowRuns: [],
  selectedExpertId: null,
  draftTaskMode: 'forecast',
  draftSceneId: null,
  draftPrompt: '',
  draftSkillIds: [],
  draftConnectorIds: [],
  draftToolSelections: {},
  draftCapabilityMode: 'inherit',
  draftFileReferences: [],
  draftArtifactSelections: [],
  draftPermissionProfileId: null,
  draftProviderId: null,
  draftModelId: null,
  runtime: {
    state: 'starting',
    active: 'unknown',
    binaryAvailable: false,
    acpAvailable: false,
    headlessAvailable: false,
    error: null,
  },
};

const appElement = document.getElementById('app');
const runtimeRouter = new window.MeteoMateRuntime.RuntimeRouter();
let accountSession = {
  status: 'loading',
  baseUrl: 'http://127.0.0.1:8088',
  profileKey: null,
  user: null,
  offlineAvailable: false,
  cachedUser: null,
  legacyDataAvailable: false,
  policyContext: null,
};
let unsubscribeAccountState = null;
let state = structuredClone(initialState);
let unsubscribeRuntimeEvents = null;
let responseElapsedTimer = null;
let automationSchedulerTimer = null;
const modelSettings = {
  status: 'idle',
  providerId: '',
  modelId: '',
  providers: [],
  message: '',
  error: '',
  organizationPolicy: null,
};
const settingsDialog = {
  open: false,
  section: 'general',
  returnContext: null,
  selectedProviderId: '',
  providerDraft: null,
  modelDraft: null,
  pendingProvider: null,
  providerTest: { status: 'idle', result: null },
};
const desktopSettings = {
  status: 'idle',
  preferences: {
    sendOnEnter: true,
    showExecutionProcess: true,
    showContextMeter: true,
    memoryEnabled: false,
    autoCompactThreshold: 0.75,
    defaultPermissionProfileId: '',
  },
  assistantWorkspace: '',
  projectWorkspace: '',
  message: '',
  error: '',
};
const settingsSections = Object.freeze({
  general: { title: '常规', description: '调整日常对话、反馈与本地工作方式', icon: 'settings' },
  personalization: { title: '个性化', description: '管理 MeteoMate 如何使用你的偏好与长期记忆', icon: 'star' },
  context: { title: '上下文与资料', description: '管理上下文压缩和气象资料接入状态', icon: 'file' },
  permissions: { title: '权限与安全', description: '设置默认审批策略并了解当前安全边界', icon: 'shield' },
  models: { title: '模型', description: '管理 OpenAI 兼容提供商与模型', icon: 'model' },
  account: { title: '账户与服务', description: '查看账户、组织服务和应用信息', icon: 'users' },
});
const projectUI = {
  tab: 'overview',
  query: '',
  dialog: null,
  capabilityPicker: null,
  error: '',
  managedWorkspaceRoot: '',
};
const catalogUI = {
  detailExpertId: null,
};
const teamUI = {
  collapsed: false,
  expanded: false,
  selectedMemberId: null,
  expandedResultIds: new Set(),
};
const messageUI = {
  editingTaskId: null,
  editingMessageId: null,
};
const sidebarTaskUI = {
  editingTaskId: null,
  menuTaskId: null,
};
const previewUI = {
  open: false,
  taskId: null,
  activeId: null,
  tabs: [],
  width: 560,
  surfaceStates: {},
};
const automationUI = {
  tab: 'schedules',
  editor: null,
  error: '',
};
const knowledgeCatalog = {
  status: 'idle',
  sources: [],
  encryptionAvailable: false,
  error: '',
};
const knowledgeUI = {
  filter: 'all',
  editor: null,
  returnView: 'more-knowledge',
  returnProjectId: null,
  error: '',
  testResult: null,
};

function effectiveOrganizationPolicy() {
  return accountSession.policyContext?.policy || {
    defaultModel: '',
    allowedModels: [],
    allowedProviderIds: [],
    requireVerifiedModels: false,
    defaultSkillIds: [],
    allowedConnectorIds: [],
    defaultPermissionProfileId: '',
    allowedPermissionProfileIds: [],
    autoCompactThreshold: null,
    sources: {},
    revision: 0,
  };
}

function allowedPermissionProfiles() {
  const allowed = effectiveOrganizationPolicy().allowedPermissionProfileIds || [];
  return Object.values(catalog.permissionProfiles).filter((profile) => !allowed.length || allowed.includes(profile.id));
}

function policyPermissionProfileId(candidate, fallback = 'analysis-readonly') {
  const policy = effectiveOrganizationPolicy();
  const available = allowedPermissionProfiles();
  const allowed = new Set(available.map((profile) => profile.id));
  return [candidate, policy.defaultPermissionProfileId, fallback, available[0]?.id]
    .find((id) => id && allowed.has(id)) || 'analysis-readonly';
}

function preferredPermissionProfileId(expertDefault = 'analysis-readonly') {
  return policyPermissionProfileId(
    effectiveOrganizationPolicy().defaultPermissionProfileId
      || desktopSettings.preferences.defaultPermissionProfileId
      || expertDefault,
    expertDefault
  );
}

function defaultProjectFromLegacy(stored) {
  const workspace = typeof stored?.workspace === 'string' ? stored.workspace : '';
  if (!workspace) return [];
  return [
    {
      id: cryptoRandomId(),
      name: pathBaseName(workspace) || '气象办公空间',
      workspace,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
}

function migrateLegacyState() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    if (!legacy) return null;
    const projects = defaultProjectFromLegacy(legacy);
    const projectId = projects[0]?.id || null;
    const tasks = Array.isArray(legacy.tasks)
      ? legacy.tasks.map((task) => ({
          id: task.id || cryptoRandomId(),
          title: task.title || '历史任务',
          expertId: task.expertId || catalog.experts[0].id,
          expertName: task.expertName || catalog.experts[0].name,
          projectId,
          workspace: task.workspace || projects[0]?.workspace || '',
          status: task.status === 'running' ? 'interrupted' : task.status || 'completed',
          runtimeMode: task.mode || 'headless',
          runtimePreference: 'auto',
          sessionId: null,
          allowFileTools: Boolean(task.allowFileTools),
          messages: [
            ...(task.prompt
              ? [{ id: cryptoRandomId(), role: 'user', text: task.prompt, createdAt: task.createdAt || Date.now() }]
              : []),
            ...(task.output
              ? [{ id: cryptoRandomId(), role: 'assistant', text: task.output, createdAt: task.updatedAt || Date.now() }]
              : []),
          ],
          activities: [],
          artifacts: [],
          plan: createDefaultPlan(),
          pendingPermissions: [],
          createdAt: task.createdAt || Date.now(),
          updatedAt: task.updatedAt || Date.now(),
        }))
      : [];

    return {
      ...initialState,
      projects,
      activeProjectId: projectId,
      tasks,
      favoriteExpertIds: [],
    };
  } catch {
    return null;
  }
}

function profileStorageKey(profileKey) {
  return `${PROFILE_STORAGE_PREFIX}${profileKey}`;
}

function loadState(profileKey) {
  if (!profileKey) return structuredClone(initialState);
  try {
    const stored = JSON.parse(localStorage.getItem(profileStorageKey(profileKey)) || 'null');
    if (!stored) return structuredClone(initialState);

    return window.MeteoMateHarness.StateStore.normalizeStoredState(stored, {
      initialState,
      createDefaultPlan,
    });
  } catch {
    return structuredClone(initialState);
  }
}

function parseStoredJson(value) {
  if (!value || value === 'null') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function legacyStateEnvelope() {
  let current = parseStoredJson(localStorage.getItem(STORAGE_KEY));
  let legacy = parseStoredJson(localStorage.getItem(LEGACY_STORAGE_KEY));
  const bootstrapBackup = parseStoredJson(localStorage.getItem('meteomate-desktop-state-bootstrap-backup-v1'));
  if (!current && bootstrapBackup?.current) current = parseStoredJson(bootstrapBackup.current);
  if (!legacy && bootstrapBackup?.legacy) legacy = parseStoredJson(bootstrapBackup.legacy);
  return { current, legacy };
}

function hasLegacyRendererState() {
  const envelope = legacyStateEnvelope();
  return Boolean(envelope.current || envelope.legacy);
}

function claimLegacyRendererState(profileKey) {
  if (!profileKey || localStorage.getItem(profileStorageKey(profileKey))) return false;
  const envelope = legacyStateEnvelope();
  if (!envelope.current && !envelope.legacy) return false;
  localStorage.setItem(PROFILE_MIGRATION_BACKUP_KEY, JSON.stringify({ ...envelope, capturedAt: Date.now() }));
  const restored = window.MeteoMateHarness.StateStore.restoreState({
    current: envelope.current,
    legacy: envelope.legacy,
    initialState,
    catalog,
    primaryAssistant,
    createDefaultPlan,
    createId: cryptoRandomId,
    pathBaseName,
  });
  localStorage.setItem(profileStorageKey(profileKey), JSON.stringify(restored));
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem('meteomate-desktop-state-bootstrap-backup-v1');
  return true;
}

function saveState() {
  if (!accountSession.profileKey) return;
  const tasks = state.tasks
    .slice(0, 80)
    .map((task) => window.MeteoMateHarness.StateStore.compactTaskForStorage(task));
  const serializable = {
    ...state,
    runtime: undefined,
    activeTaskId: null,
    tasks,
  };
  localStorage.setItem(profileStorageKey(accountSession.profileKey), JSON.stringify(serializable));
}

function createDefaultPlan() {
  return [
    { id: 'prepare', title: '准备任务上下文与资料约束', status: 'pending' },
    { id: 'analyze', title: '调用所需能力与工具完成分析', status: 'pending' },
    { id: 'deliver', title: '整理结论、证据与成果物', status: 'pending' },
  ];
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeExpertForRuntime(item, sourceType = 'system') {
  if (!item) return null;
  const strings = (value) => [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
  const requiredConnectors = strings(item.requiredConnectors);
  const recommendedConnectors = strings(item.recommendedConnectors)
    .filter((id) => !requiredConnectors.includes(id));
  return {
    ...item,
    apiVersion: item.apiVersion || 'meteomate.ai/v1',
    kind: item.kind === 'team' ? 'team' : item.kind === 'assistant' ? 'assistant' : 'Expert',
    version: item.version || '1.0.0',
    revision: Number(item.revision || 1),
    source: item.source || { type: sourceType },
    status: item.status || 'enabled',
    visibility: item.visibility || (sourceType === 'user' ? 'private' : 'public'),
    methodology: strings(item.methodology || item.workflow),
    workflow: strings(item.workflow || item.methodology),
    limitations: strings(item.limitations),
    inputs: strings(item.inputs),
    outputs: strings(item.outputs),
    prompts: strings(item.prompts),
    tags: strings(item.tags),
    requiredSkills: strings(item.requiredSkills),
    recommendedSkills: strings(item.recommendedSkills || item.skills),
    requiredWorkflows: strings(item.requiredWorkflows),
    recommendedWorkflows: strings(item.recommendedWorkflows),
    requiredConnectors,
    recommendedConnectors,
    toolSelections: normalizeToolSelections(item.toolSelections, [
      ...requiredConnectors,
      ...recommendedConnectors,
    ]),
    defaultWorkMode: ['ask', 'plan', 'execute'].includes(item.defaultWorkMode)
      ? item.defaultWorkMode
      : 'execute',
    modelPolicy: item.modelPolicy || 'inherit',
    permissionProfile: item.permissionProfile || 'artifact-approval',
  };
}

function userManagedExperts({ includeInactive = false } = {}) {
  const items = window.MeteoMateCapabilityCenter?.expertCatalog?.({ includeInactive });
  return Array.isArray(items)
    ? items.map((item) => normalizeExpertForRuntime(item, item.source?.type || 'user'))
    : [];
}

function allExperts() {
  const system = [...catalog.experts, ...catalog.teams].map((item) => normalizeExpertForRuntime(item));
  const managed = userManagedExperts();
  const merged = new Map(system.map((item) => [item.id, item]));
  for (const item of managed) merged.set(item.id, item);
  const managedIds = new Set(merged.keys());
  const legacy = (state.customExperts || [])
    .filter((item) => !managedIds.has(item.id))
    .map((item) => normalizeExpertForRuntime(item, 'user'));
  return [...merged.values(), ...legacy];
}

function getExpert(expertId) {
  if (expertId === primaryAssistant.id) return primaryAssistant;
  return allExperts().find((item) => item.id === expertId) || catalog.experts[0];
}

function getSelectedExpert() {
  if (state.view === 'assistants') return primaryAssistant;
  return getExpert(state.selectedExpertId || catalog.experts[0].id);
}

function mergeTeamToolSelections(experts) {
  const merged = new Map();
  experts.forEach((expert) => {
    Object.entries(expert.toolSelections || {}).forEach(([connectorId, toolNames]) => {
      const current = merged.get(connectorId) || [];
      merged.set(connectorId, [...new Set([...current, ...(Array.isArray(toolNames) ? toolNames : [])])]);
    });
  });
  return Object.fromEntries(merged);
}

function teamDefinitionForExpert(expert) {
  if (expert?.kind !== 'team') return null;
  const frozenMembers = Array.isArray(expert.memberSnapshots) && expert.memberSnapshots.length
    ? expert.memberSnapshots
    : allExperts().filter((item) => item.kind !== 'team' && item.kind !== 'assistant');
  return window.MeteoMateHarness.ExpertTeam.normalizeDefinition(expert, frozenMembers);
}

function expertSnapshot(expert) {
  const snapshot = structuredClone(normalizeExpertForRuntime(expert, expert?.source?.type || 'system'));
  if (snapshot.kind !== 'team') return snapshot;
  const definition = teamDefinitionForExpert(snapshot);
  const memberSnapshots = definition.nodes.map((node) =>
    structuredClone(normalizeExpertForRuntime(node.expert, node.expert.source?.type || 'system'))
  );
  const requiredSkills = [...new Set([
    ...(snapshot.requiredSkills || []),
    ...memberSnapshots.flatMap((member) => member.requiredSkills || []),
  ])];
  const recommendedSkills = [...new Set([
    ...(snapshot.recommendedSkills || []),
    ...memberSnapshots.flatMap((member) => member.recommendedSkills || []),
  ])].filter((id) => !requiredSkills.includes(id));
  const requiredConnectors = [...new Set([
    ...(snapshot.requiredConnectors || []),
    ...memberSnapshots.flatMap((member) => member.requiredConnectors || []),
  ])];
  const recommendedConnectors = [...new Set([
    ...(snapshot.recommendedConnectors || []),
    ...memberSnapshots.flatMap((member) => member.recommendedConnectors || []),
  ])].filter((id) => !requiredConnectors.includes(id));
  const requiredWorkflows = [...new Set([
    ...(snapshot.requiredWorkflows || []),
    ...memberSnapshots.flatMap((member) => member.requiredWorkflows || []),
  ])];
  const recommendedWorkflows = [...new Set([
    ...(snapshot.recommendedWorkflows || []),
    ...memberSnapshots.flatMap((member) => member.recommendedWorkflows || []),
  ])].filter((id) => !requiredWorkflows.includes(id));
  return {
    ...snapshot,
    members: definition.nodes.map((node) => node.expert.id),
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      expert: node.expert.id,
      dependsOn: [...node.dependsOn],
      objective: node.objective,
    })),
    orchestrator: definition.orchestrator,
    execution: structuredClone(definition.execution),
    memberSnapshots,
    requiredSkills,
    recommendedSkills,
    requiredWorkflows,
    recommendedWorkflows,
    requiredConnectors,
    recommendedConnectors,
    toolSelections: mergeTeamToolSelections([snapshot, ...memberSnapshots]),
  };
}

function teamDefinitionForTask(task, expert = getTaskExpert(task)) {
  if (expert?.kind !== 'team') return null;
  if (task?.teamDefinition?.nodes?.length) return structuredClone(task.teamDefinition);
  return teamDefinitionForExpert(expert);
}

function getTaskExpert(task) {
  if (task?.expertSnapshot) return normalizeExpertForRuntime(task.expertSnapshot, task.expertSnapshot.source?.type || 'system');
  return getExpert(task?.expertId);
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0] || null;
}

function getSelectedProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function getTaskProject(task) {
  if (task) return state.projects.find((project) => project.id === task.projectId) || null;
  return getSelectedProject();
}

function getAssistantTask() {
  return (
    state.tasks.find((task) => task.id === state.assistantTaskId && task.kind === 'assistant') ||
    state.tasks.find((task) => task.kind === 'assistant') ||
    null
  );
}

function getAssistantProject() {
  if (!state.assistantWorkspace) return null;
  return {
    id: 'meteomate-assistant-workspace',
    name: 'MeteoMate 工作区',
    workspace: state.assistantWorkspace,
  };
}

function getConversationProject(task) {
  return task?.kind === 'assistant' || (state.view === 'assistants' && !task)
    ? getAssistantProject(task)
    : getTaskProject(task);
}

function modelSelectionValue(providerId, modelId) {
  if (!providerId || !modelId) return '';
  return `${encodeURIComponent(providerId)}::${encodeURIComponent(modelId)}`;
}

function parseModelSelectionValue(value) {
  const text = String(value || '');
  const separator = text.indexOf('::');
  if (separator < 0) return null;
  try {
    return {
      providerId: decodeURIComponent(text.slice(0, separator)),
      modelId: decodeURIComponent(text.slice(separator + 2)),
    };
  } catch {
    return null;
  }
}

function configuredModelContextLimit(providerId, modelId) {
  const provider = modelSettings.providers.find((entry) => entry.id === providerId);
  const model = provider?.models?.find((entry) => entry.id === modelId);
  return Number(model?.contextLimit || 0);
}

function composerContextStatusTitle(status, contextState) {
  if (status.phase === 'compacting') return '正在自动压缩较早的对话，任务目标、关键结论和最近消息会保留。';
  if (status.phase === 'compacted') {
    const count = Number(contextState?.compactionCount || 0);
    return `自动压缩已完成${count ? `，本会话累计 ${count} 次` : ''}。`;
  }
  if (status.phase === 'failed') return '上下文压缩失败，本轮会保留原始对话并显示运行错误。';
  if (!status.limitKnown) return '模型未声明上下文窗口长度，由提供商自动管理。';
  if (!status.usedKnown) return `上下文上限 ${formatTokenCount(status.limit)} tokens，完成首轮后显示当前占用。`;
  if (status.shouldCompact) return `已用 ${status.percent}%，超过 ${status.thresholdPercent}% 自动压缩阈值，下次请求前会自动压缩。`;
  if (status.tone === 'warning') return `已用 ${status.percent}%，达到 ${status.thresholdPercent}% 后会自动压缩。`;
  return `已用 ${status.percent}%，剩余 ${formatTokenCount(status.remaining)} tokens。`;
}

function renderComposerContextMeter(task, providerId, modelId) {
  const contextWindow = window.MeteoMateHarness.ContextWindow;
  const usage = task ? task.usage || {} : { used: 0 };
  const contextState = task?.contextState || {};
  const status = contextWindow.contextStatus({
    usage,
    modelContextLimit: configuredModelContextLimit(providerId, modelId),
    autoCompactThreshold: state.runtime.autoCompactThreshold,
    contextState,
  });
  const label = status.phase === 'compacting'
    ? '压缩中'
    : status.phase === 'compacted'
      ? '已压缩'
      : status.phase === 'failed'
        ? '压缩失败'
        : '上下文';
  const value = status.limitKnown
    ? `${status.usedKnown ? formatTokenCount(status.used) : '--'} / ${formatTokenCount(status.limit)}`
    : '自动管理';
  const ringLength = 50.27;
  const ringOffset = (ringLength * (1 - status.ratio)).toFixed(2);
  const title = composerContextStatusTitle(status, contextState);
  return `
    <span
      class="composer-context-meter composer-tooltip-control ${status.tone} ${status.phase}"
      role="meter"
      tabindex="0"
      aria-label="当前上下文窗口"
      aria-valuemin="0"
      aria-valuemax="${status.limitKnown ? status.limit : 100}"
      aria-valuenow="${status.known ? status.used : 0}"
      aria-valuetext="${escapeHtml(`${label}，${value}`)}"
      data-tooltip="${escapeHtml(`${label}：${value}。${title}`)}"
    >
      <svg class="context-meter-ring" viewBox="0 0 20 20" aria-hidden="true">
        <circle class="context-meter-track" cx="10" cy="10" r="8"></circle>
        <circle class="context-meter-value" cx="10" cy="10" r="8" stroke-dasharray="${ringLength}" stroke-dashoffset="${ringOffset}"></circle>
      </svg>
      <span class="composer-control-details"><strong>${label}</strong><em>${escapeHtml(value)}</em></span>
    </span>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function artifactPathLabel(value) {
  const target = String(value || '').trim();
  if (!target || /^https?:\/\//i.test(target)) return '';
  if (!/^file:/i.test(target)) return target;
  try {
    const parsed = new URL(target);
    const decoded = decodeURIComponent(parsed.pathname);
    return window.meteoDesktop?.platform === 'win32' && /^\/[A-Za-z]:/.test(decoded)
      ? decoded.slice(1)
      : decoded;
  } catch {
    return target;
  }
}

function artifactPathAttributes(value) {
  const target = String(value || '').trim();
  const label = artifactPathLabel(target);
  if (!label) return '';
  return `data-artifact-path="${escapeHtml(target)}" data-artifact-path-label="${escapeHtml(label)}" aria-description="文件位置：${escapeHtml(label)}"`;
}

function renderMarkdown(value) {
  const source = String(value || '');
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    return `<p>${escapeHtml(source).replaceAll('\n', '<br />')}</p>`;
  }
  try {
    const parsed = window.marked.parse(source, {
      gfm: true,
      breaks: true,
    });
    const sanitized = window.DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio'],
      FORBID_ATTR: ['style', 'srcset'],
    });
    const template = document.createElement('template');
    template.innerHTML = sanitized;
    template.content.querySelectorAll('a').forEach((link) => {
      const targetUrl = link.getAttribute('href') || '';
      try {
        const parsedUrl = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol');
        link.setAttribute('href', '#');
        link.dataset.externalUrl = parsedUrl.toString();
        link.setAttribute('title', parsedUrl.toString());
      } catch {
        link.removeAttribute('href');
        link.classList.add('markdown-link-disabled');
      }
    });
    template.content.querySelectorAll('img').forEach((image) => {
      const sourceUrl = image.getAttribute('src') || '';
      if (!sourceUrl.startsWith('data:image/')) {
        image.replaceWith(document.createTextNode(`[图片：${image.getAttribute('alt') || '未命名'}]`));
      }
    });
    return template.innerHTML;
  } catch {
    return `<p>${escapeHtml(source).replaceAll('\n', '<br />')}</p>`;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pathBaseName(value) {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function shortPath(value) {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : normalized;
}

function truncate(value, limit = 80) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1).replace('.0', '')}s`;
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function icon(name) {
  const icons = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    windowMinimize: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    windowMaximize: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    windowRestore: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M5 15V6a1.5 1.5 0 0 1 1.5-1.5H15"/></svg>',
    windowClose: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    'scene-synoptic': '<svg viewBox="0 0 24 24"><path d="M3 8c3-2.5 6-2.5 9 0s6 2.5 9 0"/><path d="M3 13c3-2.5 6-2.5 9 0s6 2.5 9 0"/><path d="M3 18c3-2.5 6-2.5 9 0s6 2.5 9 0"/></svg>',
    'scene-severe': '<svg viewBox="0 0 24 24"><path d="M13 2 5 14h6l-2 8 8-12h-6l2-8Z"/></svg>',
    'scene-content': '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6V3Z"/><path d="M15 3v4h4M9 12h7M9 16h7"/></svg>',
    'scene-data': '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
    'scene-operations': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>',
    queue: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    assistant: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 3 3 2v8l-3 2H8l-3-2V9l3-2 1-3Z"/><path d="M9 12h.01M15 12h.01M9 16h6"/></svg>',
    project: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="m8 11 8-4M8 13l8 4"/></svg>',
    expert: '<svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z"/><path d="M7 10v5.5c2 2 8 2 10 0V10M20 8v6"/></svg>',
    skill: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    automation: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 9"/><path d="M20 4v5h-5M20 12a8 8 0 0 1-13.5 5.8L4 15"/><path d="M4 20v-5h5"/></svg>',
    workflow: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 11l3.5-3.5M13.5 7.5 17 11M17 13l-3.5 3.5M10.5 16.5 7 13"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    sidebar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v10H3V6Z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    external: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v6H5V6h6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 19v-2c0-3 2.5-5 6-5s6 2 6 5v2"/><circle cx="17" cy="9" r="2"/><path d="M16 14c3 0 5 1.7 5 4v1"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24"><path d="m6 11 6-6 6 6"/><path d="M12 5v14"/></svg>',
    voice: '<svg viewBox="0 0 24 24"><rect x="8.5" y="3" width="7" height="12" rx="3.5"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M7 12V7.5a1.5 1.5 0 0 1 3 0V11M10 11V5.5a1.5 1.5 0 0 1 3 0V11M13 11V6.5a1.5 1.5 0 0 1 3 0V12M16 12V9.5a1.5 1.5 0 0 1 3 0V14c0 4.4-2.6 7-7 7h-1c-2.2 0-3.7-1-4.8-2.8L3.5 14a1.6 1.6 0 0 1 2.6-1.8L8 14"/></svg>',
    terminal: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="M12 8v5M12 17h.01"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg>',
    tool: '<svg viewBox="0 0 24 24"><path d="m14 7 3-3 3 3-3 3"/><path d="m17 7-8 8"/><path d="M9 13 4 18l2 2 5-5"/></svg>',
    model: '<svg viewBox="0 0 24 24"><path d="M12 3 4.5 7.2 12 11.5l7.5-4.3L12 3Z"/><path d="m4.5 12 7.5 4.3 7.5-4.3M4.5 16.8 12 21l7.5-4.2"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 2M18 15a7 7 0 0 1-11.9 3L4 16"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l3.5-.7L19 7.8a2 2 0 0 0-2.8-2.8L4.7 16.5 4 20Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
    thumbUp: '<svg viewBox="0 0 24 24"><path d="M7 10v10H3V10h4Zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.7-5.3A2 2 0 0 0 18.9 10H14l.7-3.2A2.7 2.7 0 0 0 12 3.5L7 10v9Z"/></svg>',
    thumbDown: '<svg viewBox="0 0 24 24"><path d="M7 14V4H3v10h4Zm0-9h10.2a2 2 0 0 1 1.9 1.4l1.7 5.3a2 2 0 0 1-1.9 2.3H14l.7 3.2A2.7 2.7 0 0 1 12 20.5L7 14V5Z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  };
  return `<span class="icon">${icons[name] || icons.more}</span>`;
}

function sceneIcon(scene) {
  // 场景图标统一使用 SVG，避免 Unicode 符号在各平台字体下渲染不一致
  return icon(`scene-${scene?.icon || 'operations'}`);
}

function taskStatusText(status) {
  return (
    {
      draft: '草稿',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已停止',
      interrupted: '可继续',
    }[status] || status
  );
}

function captureInteractionSnapshot() {
  // 全量重绘前记录焦点元素、光标位置与对话滚动位置，重绘后恢复，
  // 避免流式输出期间打断输入、丢失光标或强制拉回底部。
  const snapshot = { focus: null, conversationScroll: null, taskId: state.activeTaskId, view: state.view };
  const active = document.activeElement;
  if (
    active &&
    active.id &&
    appElement.contains(active) &&
    ['TEXTAREA', 'INPUT', 'SELECT'].includes(active.tagName)
  ) {
    snapshot.focus = {
      id: active.id,
      selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
      scrollTop: active.scrollTop || 0,
    };
  }
  const scroll = document.querySelector('.conversation-scroll');
  if (scroll) {
    const distanceToBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    snapshot.conversationScroll = {
      atBottom: distanceToBottom < 48,
      scrollTop: scroll.scrollTop,
    };
  }
  return snapshot;
}

function restoreInteractionSnapshot(snapshot) {
  if (!snapshot) return false;
  let scrollRestored = false;
  if (snapshot.focus) {
    const element = document.getElementById(snapshot.focus.id);
    if (element && !element.disabled && document.contains(element)) {
      element.focus({ preventScroll: true });
      if (snapshot.focus.selectionStart !== null && typeof element.setSelectionRange === 'function') {
        try {
          element.setSelectionRange(snapshot.focus.selectionStart, snapshot.focus.selectionEnd);
          element.scrollTop = snapshot.focus.scrollTop;
        } catch {
          // 部分输入类型不支持选区，忽略
        }
      }
    }
  }
  if (snapshot.conversationScroll && snapshot.taskId === state.activeTaskId && snapshot.view === state.view) {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll) {
      scroll.scrollTop = snapshot.conversationScroll.atBottom
        ? scroll.scrollHeight
        : Math.min(snapshot.conversationScroll.scrollTop, scroll.scrollHeight);
      scrollRestored = true;
    }
  }
  return scrollRestored;
}

function scrollTeamProcessFeeds() {
  document.querySelectorAll('[data-team-process-feed][data-follow-output="true"]').forEach((feed) => {
    feed.scrollTop = feed.scrollHeight;
  });
}

function render() {
  window.clearInterval(responseElapsedTimer);
  responseElapsedTimer = null;
  const interactionSnapshot = captureInteractionSnapshot();
  if (accountSession.status === 'authenticated' && accountSession.user?.mustChangePassword) {
    appElement.innerHTML = `${renderAccountWindowTitlebar()}${renderPasswordChangeGate()}`;
    bindEvents();
    window.requestAnimationFrame(() => window.MeteoMatePreview?.sync?.());
    return;
  }
  if (!['authenticated', 'offline'].includes(accountSession.status)) {
    appElement.innerHTML = `${renderAccountWindowTitlebar()}${renderAccountGate()}`;
    bindEvents();
    window.requestAnimationFrame(() => window.MeteoMatePreview?.sync?.());
    return;
  }
  if (settingsDialog.open) {
    appElement.innerHTML = `${renderSettingsWindowTitlebar()}${renderAccountSettingsPage()}`;
    bindEvents();
    window.requestAnimationFrame(() => window.MeteoMatePreview?.sync?.());
    return;
  }
  appElement.innerHTML = `
    ${renderWindowTitlebar()}
    <div class="app-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      ${renderSidebar()}
      <main class="main-shell">${renderMain()}</main>
    </div>
    ${projectUI.dialog ? renderProjectDialog() : ''}
  `;
  bindEvents();
  const scrollRestored = restoreInteractionSnapshot(interactionSnapshot);
  requestAnimationFrame(() => {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll && !scrollRestored) {
      scroll.scrollTop = getActiveTask()?.messages?.length ? scroll.scrollHeight : 0;
    }
    scrollTeamProcessFeeds();
    updateLiveResponseDurations();
    if (document.querySelector('[data-live-duration]')) {
      responseElapsedTimer = window.setInterval(updateLiveResponseDurations, 250);
    }
    window.MeteoMatePreview?.sync?.();
  });
}

function desktopPlatform() {
  return window.meteoDesktop?.platform || 'darwin';
}

function usesCustomWindowControls() {
  // macOS 使用系统红绿灯（hiddenInset），Windows/Linux 需要自绘窗口控制按钮
  return !['darwin', undefined].includes(desktopPlatform());
}

function renderWindowControls() {
  if (!usesCustomWindowControls()) return '';
  return `
    <div class="window-controls" role="group" aria-label="窗口控制">
      <button type="button" class="window-control-button" id="window-minimize" aria-label="最小化" title="最小化">${icon('windowMinimize')}</button>
      <button type="button" class="window-control-button" id="window-maximize" aria-label="${state.windowMaximized ? '还原' : '最大化'}" title="${state.windowMaximized ? '还原' : '最大化'}">${icon(state.windowMaximized ? 'windowRestore' : 'windowMaximize')}</button>
      <button type="button" class="window-control-button window-control-close" id="window-close" aria-label="关闭" title="关闭">${icon('windowClose')}</button>
    </div>`;
}

function renderAccountWindowTitlebar() {
  return `
    <header class="window-titlebar account-window-titlebar" aria-label="MeteoMate 窗口标题栏">
      <span class="account-window-title">${escapeHtml(brand.chineseName)} ${escapeHtml(brand.name)}</span>
      ${renderWindowControls()}
    </header>`;
}

function renderSettingsWindowTitlebar() {
  return `
    <header class="window-titlebar settings-window-titlebar" aria-label="MeteoMate 设置窗口标题栏">
      <div class="settings-titlebar-sidebar"></div>
      <div class="settings-titlebar-main"></div>
      ${renderWindowControls()}
    </header>`;
}

function renderCatalogTitlebarActions() {
  if (state.catalogTab === 'workflows') {
    return window.MeteoMateWorkflowCenter?.titlebar?.().actions || '';
  }
  if (state.catalogTab !== 'experts') return '';
  return `<label class="search-box titlebar-catalog-search">${icon('search')}<input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="搜索专家名称或描述" /></label><button class="my-experts ${state.favoritesOnly ? 'active' : ''}" id="toggle-favorites" aria-label="我的专家" title="我的专家">${icon('star')} 我的专家</button>`;
}

function renderWindowTitlebar() {
  const assistantMode = state.view === 'assistants';
  const task = assistantMode ? getAssistantTask() : getActiveTask();
  const taskMode = state.view === 'task';
  let title = assistantMode ? primaryAssistant.name : taskMode ? task?.title || '新建任务' : '';
  let titleIcon = assistantMode ? 'assistant' : taskMode ? (task ? 'folder' : 'plus') : null;
  let backButton = taskMode && task
    ? `<button class="titlebar-button titlebar-back" data-nav="catalog" aria-label="返回专家中心" title="返回专家中心">${icon('back')}</button>`
    : '';
  let navigation = '';
  let actions = '';
  let previewToggle = '';

  if (state.view === 'projects') {
    title = '项目';
    titleIcon = 'project';
    actions = `<button class="titlebar-action primary" data-action="add-project">${icon('plus')} 新建项目</button>`;
  } else if (state.view === 'project-detail') {
    const project = getActiveProject();
    title = project?.name || '项目详情';
    titleIcon = 'project';
    backButton = `<button class="titlebar-button titlebar-back" data-nav="projects" aria-label="返回项目" title="返回项目">${icon('back')}</button>`;
    actions = project
      ? `<button class="titlebar-action" data-open-project="${escapeHtml(project.workspace)}">${icon('folder')} 打开目录</button><button class="titlebar-action primary" data-project-new-task="${escapeHtml(project.id)}">${icon('plus')} 新建任务</button>`
      : '';
  } else if (state.view === 'catalog') {
    const workflowTitlebar = state.catalogTab === 'workflows'
      ? window.MeteoMateWorkflowCenter?.titlebar?.() || {}
      : {};
    title = workflowTitlebar.immersive ? workflowTitlebar.title || '' : '';
    titleIcon = workflowTitlebar.immersive ? workflowTitlebar.icon || null : null;
    backButton = workflowTitlebar.backButton || '';
    navigation = workflowTitlebar.immersive
      ? ''
      : `<nav class="titlebar-catalog-tabs" aria-label="能力中心">${catalogTabButton('experts', '专家')}${catalogTabButton('skills', '技能')}${catalogTabButton('connectors', '工具')}${catalogTabButton('workflows', '工作流')}</nav>`;
    actions = renderCatalogTitlebarActions();
  } else if (state.view === 'automation') {
    const draft = automationUI.editor;
    title = draft ? (draft.id ? draft.name || '编辑自动化' : '添加自动化任务') : '自动化';
    titleIcon = 'automation';
    if (draft) {
      backButton = `<button class="titlebar-button titlebar-back" data-automation-cancel aria-label="返回自动化" title="返回自动化">${icon('back')}</button>`;
      actions = `${draft.id ? `<button class="titlebar-action danger" data-automation-delete="${escapeHtml(draft.id)}">删除</button>` : ''}<button class="titlebar-action" data-automation-cancel>取消</button><button class="titlebar-action primary" type="submit" form="automation-editor-form" ${state.projects.length ? '' : 'disabled'}>${draft.id ? '保存' : '创建自动化'}</button>`;
    } else {
      actions = `<button class="titlebar-action primary" data-automation-create>${icon('plus')} 添加自动化</button>`;
    }
  } else if (state.view === 'more-knowledge') {
    const draft = knowledgeUI.editor;
    title = draft ? (draft.id ? draft.name || '管理资料源' : '连接在线知识库') : '资料库';
    titleIcon = 'folder';
    if (draft) {
      backButton = `<button class="titlebar-button titlebar-back" data-knowledge-cancel aria-label="返回资料库" title="返回资料库">${icon('back')}</button>`;
      actions = `${draft.id ? `<button class="titlebar-action danger" data-knowledge-delete="${escapeHtml(draft.id)}">删除资料源</button>` : ''}<button class="titlebar-action" data-knowledge-cancel>取消</button><button class="titlebar-action primary" type="submit" form="knowledge-source-form">${draft.id ? '保存更改' : '保存连接'}</button>`;
    } else {
      actions = `<button class="titlebar-action" data-knowledge-import>${icon('folder')} 添加本地资料</button><button class="titlebar-action primary" data-knowledge-add-online>${icon('plus')} 连接知识库</button>`;
    }
  } else if (state.view === 'more-files') {
    title = '我的文件';
    titleIcon = 'folder';
    actions = `<button class="titlebar-action primary" data-action="add-project">${icon('plus')} 添加工作空间</button>`;
  } else if (state.view === 'more') {
    title = '产品信息';
    titleIcon = 'more';
  }

  if (taskMode && task?.artifacts?.length) {
    actions = `<button class="titlebar-action ${previewUI.open && previewUI.taskId === task.id ? 'active' : ''}" data-preview-latest>${icon('file')} 预览成果 <span>${task.artifacts.length}</span></button>`;
  } else if (assistantMode && task?.artifacts?.length) {
    actions = `<button class="titlebar-action ${previewUI.open && previewUI.taskId === task.id ? 'active' : ''}" data-preview-latest>${icon('file')} 预览成果 <span>${task.artifacts.length}</span></button>`;
  }
  if (task?.artifacts?.length) {
    const previewOpen = previewUI.open && previewUI.taskId === task.id;
    previewToggle = `<button class="titlebar-button titlebar-preview-toggle ${previewOpen ? 'active' : ''}" type="button" data-preview-panel-toggle aria-label="${previewOpen ? '收起预览区' : '展开预览区'}" title="${previewOpen ? '收起预览区' : '展开预览区'}" aria-expanded="${previewOpen}">${icon('sidebar')}</button>`;
  }

  return `
    <header class="window-titlebar ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}" aria-label="MeteoMate 窗口标题栏">
      <div class="window-titlebar-sidebar">
        <button class="titlebar-button titlebar-toggle" id="sidebar-toggle" type="button" data-sidebar-toggle aria-label="${state.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}" title="${state.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}" aria-expanded="${!state.sidebarCollapsed}">${icon('sidebar')}</button>
        <button class="titlebar-button titlebar-search" id="sidebar-search" type="button" aria-label="搜索专家、技能和工具" title="搜索专家、技能和工具">${icon('search')}</button>
      </div>
      <div class="window-titlebar-main">
        ${backButton}
        ${navigation}
        ${title ? `<div class="window-titlebar-page-title">${icon(titleIcon)}<strong>${escapeHtml(title)}</strong></div>` : ''}
        <div class="window-titlebar-actions">${actions}${previewToggle}</div>
      </div>
      ${renderWindowControls()}
    </header>`;
}

function renderAccountGate() {
  if (accountSession.status === 'loading') {
    return `<main class="account-gate loading"><img class="account-loading-icon" src="assets/icons/meteomate.png" alt="" /><p>正在准备 MeteoMate…</p></main>`;
  }
  const cachedUser = accountSession.cachedUser;
  return `
    <main class="account-gate">
      <section class="account-login-panel" aria-labelledby="account-title">
        <div class="account-login-brand"><img class="account-product-icon" src="assets/icons/meteomate.png" alt="" /><strong>MeteoMate</strong></div>
        <div class="account-login-heading"><h1 id="account-title">欢迎回来</h1></div>
        ${accountSession.notice ? `<div class="account-login-notice" role="status">${escapeHtml(accountSession.notice)}</div>` : ''}
        <form id="account-login-form" novalidate>
          <label class="account-field"><span>用户名</span><input id="account-username" name="username" autocomplete="username" value="${escapeHtml(cachedUser?.username || '')}" required /></label>
          <label class="account-field"><span>密码</span><input id="account-password" name="password" type="password" autocomplete="current-password" required /></label>
          <div class="account-login-error" id="account-login-error" role="alert" hidden></div>
          <button class="primary-button account-login-button" type="submit">登录</button>
        </form>
        ${accountSession.offlineAvailable ? `<button class="account-offline-button" id="account-open-offline">离线使用</button>` : ''}
      </section>
    </main>
  `;
}

function renderPasswordChangeGate() {
  const user = accountSession.user || {};
  return `
    <main class="account-gate account-password-gate">
      <section class="account-login-panel" aria-labelledby="account-password-title">
        <div class="account-login-brand"><img class="account-product-icon" src="assets/icons/meteomate.png" alt="" /><strong>MeteoMate</strong></div>
        <div class="account-login-heading"><h1 id="account-password-title">设置新密码</h1><p>${escapeHtml(user.displayName || user.username || '当前账户')} · ${escapeHtml(user.username || '')}</p></div>
        <form id="account-password-form" novalidate>
          <label class="account-field"><span>当前临时密码</span><input id="account-current-password" type="password" autocomplete="current-password" required /></label>
          <label class="account-field"><span>新密码</span><input id="account-new-password" type="password" autocomplete="new-password" minlength="8" required /></label>
          <label class="account-field"><span>再次输入新密码</span><input id="account-confirm-password" type="password" autocomplete="new-password" minlength="8" required /></label>
          <p class="account-password-hint">至少 8 个字符，建议使用仅自己知道的长密码。</p>
          <div class="account-login-error" id="account-password-error" role="alert" hidden></div>
          <button class="primary-button account-login-button" type="submit">更新密码</button>
        </form>
      </section>
    </main>
  `;
}

function updateLiveResponseDurations() {
  document.querySelectorAll('[data-live-duration]').forEach((element) => {
    const startedAt = Number(element.dataset.startedAt);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      element.textContent = formatDuration(Math.max(0, Date.now() - startedAt));
    }
  });
  document.querySelectorAll('.response-awaiting.waiting_model:not(.team-awaiting)').forEach((element) => {
    const startedAt = Number(element.dataset.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return;
    const slow = Date.now() - startedAt >= 8000;
    const label = element.querySelector('[data-response-awaiting-label]');
    const detail = element.querySelector('[data-response-awaiting-detail]');
    if (label) label.textContent = slow ? '模型响应较慢' : '等待模型响应';
    if (detail) {
      detail.textContent = slow
        ? '首段内容尚未返回，任务仍在运行'
        : detail.dataset.modelLabel || '请求已发送';
    }
  });
  document.querySelectorAll('[data-team-synthesis-awaiting]').forEach((element) => {
    const startedAt = Number(element.dataset.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return;
    const label = element.querySelector('[data-team-synthesis-awaiting-label]');
    if (label) {
      label.textContent = Date.now() - startedAt >= 8000
        ? '模型仍在整合，任务继续运行'
        : label.dataset.defaultLabel || '正在读取成员交接结果';
    }
  });
}

function renderSidebar() {
  const taskHistory = state.tasks.filter((task) => task.kind !== 'assistant');
  const recentTasks = taskHistory.slice(0, 7);
  const recentProjects = state.projects.slice(0, 4);
  const collapsedSections = new Set(
    Array.isArray(state.collapsedSidebarSections) ? state.collapsedSidebarSections : []
  );
  const tasksCollapsed = collapsedSections.has('tasks');
  const workspacesCollapsed = collapsedSections.has('workspaces');
  return `
    <aside class="sidebar" aria-label="主导航">
      <div class="brand-row">
        <div class="brand-lockup">
          <strong>${brand.name}</strong>
          <span>${brand.version}</span>
        </div>
      </div>
      <nav class="primary-nav">
        ${navItem('task-new', 'plus', '新建任务', state.view === 'task' && !state.activeTaskId)}
        ${navItem('assistants', 'assistant', '助理', state.view === 'assistants')}
        ${navItem('projects', 'project', '项目', ['projects', 'project-detail'].includes(state.view))}
        ${navItem('more-knowledge', 'folder', '资料库', state.view === 'more-knowledge')}
        ${navItem('catalog', 'expert', '专家 · 技能 · 工具', state.view === 'catalog')}
        ${navItem('automation', 'automation', '自动化', state.view === 'automation')}
      </nav>
      <div class="sidebar-sections">
        <section class="sidebar-section sidebar-task-section ${tasksCollapsed ? 'collapsed' : ''}">
          <button class="sidebar-section-title" type="button" data-sidebar-section-toggle="tasks" aria-expanded="${!tasksCollapsed}"><span>任务 (${taskHistory.length})</span><span class="sidebar-section-chevron">${icon('down')}</span></button>
          <div class="sidebar-list">
            ${
              recentTasks.length
                ? recentTasks.map(renderSidebarTask).join('')
                : '<div class="sidebar-empty">还没有任务</div>'
            }
          </div>
        </section>
        <section class="sidebar-section workspace-section ${workspacesCollapsed ? 'collapsed' : ''}">
          <button class="sidebar-section-title" type="button" data-sidebar-section-toggle="workspaces" aria-expanded="${!workspacesCollapsed}"><span>空间 (${state.projects.length})</span><span class="sidebar-section-chevron">${icon('down')}</span></button>
          <div class="sidebar-list">
            ${
              recentProjects.length
                ? recentProjects.map(renderSidebarProject).join('')
                : `<button class="workspace-row empty-workspace" data-action="add-project">${icon('plus')}<span>添加项目</span></button>`
            }
          </div>
        </section>
      </div>
      ${renderSidebarAccount()}
    </aside>
  `;
}

function accountRoleLabel(role) {
  return { viewer: '使用者', publisher: '技能发布者', admin: '管理员' }[role] || '用户';
}

function renderSidebarAccount() {
  const user = accountSession.user || {};
  const name = user.displayName || user.username || 'MeteoMate 用户';
  return `
    <footer class="sidebar-account">
      <div class="sidebar-account-menu" id="sidebar-account-menu" role="menu" hidden>
        <button id="account-open-settings" role="menuitem">${icon('settings')}<span>设置</span></button>
        <button id="account-logout" role="menuitem">${icon('external')}<span>退出登录</span></button>
      </div>
      <button class="sidebar-account-trigger ${settingsDialog.open ? 'active' : ''}" id="sidebar-account-trigger" aria-haspopup="menu" aria-expanded="false">
        <span class="sidebar-account-avatar">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>
        <span class="sidebar-account-copy"><strong>${escapeHtml(name)}</strong><small>${accountSession.status === 'offline' ? '离线模式' : accountRoleLabel(user.role)}</small></span>
        <span class="sidebar-account-chevron">${icon('down')}</span>
      </button>
    </footer>
  `;
}

function navItem(view, iconName, label, active) {
  return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${view}" aria-label="${label}" title="${label}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderSidebarTask(task, index, tasks) {
  const taskId = escapeHtml(task.id);
  const title = escapeHtml(task.title);
  const time = formatTime(task.updatedAt || task.createdAt);
  const description = `${task.title} · ${task.expertName} · ${time}`;
  const menuOpen = sidebarTaskUI.menuTaskId === task.id;
  const menuAbove = Array.isArray(tasks) && tasks.length >= 5 && index >= tasks.length - 2;
  if (sidebarTaskUI.editingTaskId === task.id) {
    return `
      <form class="sidebar-task sidebar-task-rename" data-sidebar-task-rename-form="${taskId}">
        <span class="task-status ${task.status || 'draft'}"></span>
        <input type="text" value="${title}" maxlength="120" aria-label="重命名任务" autocomplete="off" />
        <button type="submit" aria-label="保存任务名称" title="保存">${icon('check')}</button>
        <button type="button" data-sidebar-task-rename-cancel aria-label="取消重命名" title="取消">${icon('close')}</button>
      </form>
    `;
  }
  return `
    <div class="sidebar-task ${state.activeTaskId === task.id ? 'active' : ''}">
      <button class="sidebar-task-main" type="button" data-task-id="${taskId}" title="${escapeHtml(description)}">
        <span class="task-status ${task.status || 'draft'}"></span>
        <strong>${title}</strong>
        <time>${escapeHtml(time)}</time>
      </button>
      <button class="sidebar-task-more ${menuOpen ? 'active' : ''}" type="button" data-sidebar-task-menu="${taskId}" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-label="打开 ${title} 的任务菜单" title="更多操作">${icon('more')}</button>
      ${menuOpen ? `
        <div class="sidebar-task-menu ${menuAbove ? 'above' : ''}" role="menu" aria-label="${title} 的任务操作">
          <button type="button" role="menuitem" data-sidebar-task-rename="${taskId}">${icon('edit')}<span>重命名</span></button>
          <button class="danger" type="button" role="menuitem" data-sidebar-task-delete="${taskId}">${icon('trash')}<span>删除</span></button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderSidebarProject(project) {
  return `
    <button class="workspace-row ${state.activeProjectId === project.id ? 'active' : ''}" data-project-id="${project.id}">
      <span class="workspace-mark">${escapeHtml(project.name.slice(0, 1))}</span>
      <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></span>
      <span class="row-chevron">›</span>
    </button>
  `;
}

function renderMain() {
  if (state.view === 'task') return renderTaskView();
  if (state.view === 'projects') return renderProjectsView();
  if (state.view === 'project-detail') return renderProjectDetailView();
  if (state.view === 'automation') return renderAutomationView();
  if (state.view === 'assistants') return renderAssistantsView();
  if (state.view === 'more-files') return renderMyFilesView();
  if (state.view === 'more-knowledge') return renderKnowledgeBaseView();
  if (state.view === 'more') return renderMoreView();
  return renderCatalogView();
}

function renderCatalogView() {
  const tab = state.catalogTab;
  if (tab === 'workflows') {
    return window.MeteoMateWorkflowCenter?.render?.() || '<div></div>';
  }
  const allItems =
    tab === 'experts'
      ? state.teamMode
        ? allExperts().filter((item) => item.kind === 'team')
        : allExperts().filter((item) => item.kind !== 'team')
      : tab === 'skills'
        ? userFacingSkillCatalog()
        : userFacingToolCatalog();

  const query = state.search.trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    const categoryMatch = state.category === '全部' || item.category === state.category;
    const haystack = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });
  const categories = ['全部', ...new Set(allItems.map((item) => item.category))];

  return `
    <div class="content-scroll window-content-full catalog-home">
      ${tab === 'experts' ? renderScenes() : ''}
      <section class="catalog-section">
        ${
          tab === 'experts'
            ? `
          <div class="section-heading expert-heading">
            <div class="mode-tabs">
              <button class="mode-tab ${!state.teamMode ? 'active' : ''}" data-team-mode="false">专家</button>
              <button class="mode-tab ${state.teamMode ? 'active' : ''}" data-team-mode="true">专家团</button>
            </div>
            <span class="expert-result-count">${filtered.length} 个${state.teamMode ? '协作团队' : '专业角色'}</span>
          </div>`
            : `
          <div class="section-heading">
            <div>
              <h2>${tab === 'skills' ? '技能中心' : '工具中心'}</h2>
              <p>${tab === 'skills' ? '复用气象知识、工作流程、模板和脚本' : '调用气象数据、算法、知识库与办公系统'}</p>
            </div>
          </div>`
        }
        <div class="category-strip">
          ${categories
            .map(
              (category) =>
                `<button class="category-pill ${state.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
            )
            .join('')}
        </div>
        <div class="catalog-grid ${tab !== 'experts' ? 'compact' : ''}">
          ${
            filtered.length
              ? filtered
                  .map((item) =>
                    tab === 'experts' ? renderExpertCard(item) : renderCapabilityCard(item, tab)
                  )
                  .join('')
              : '<div class="empty-result">没有找到匹配内容</div>'
          }
        </div>
      </section>
      ${tab === 'experts' && catalogUI.detailExpertId ? renderExpertDetail(catalogUI.detailExpertId) : ''}
    </div>
  `;
}

function catalogTabButton(id, label) {
  const iconName = { experts: 'expert', skills: 'skill', connectors: 'tool', workflows: 'workflow' }[id] || 'expert';
  return `<button class="titlebar-catalog-tab ${state.catalogTab === id ? 'active' : ''}" data-catalog-tab="${id}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderScenes() {
  return `
    <section class="scenes-section">
      <div class="section-title-row">
        <div><h2>按业务场景开始</h2><p>选择工作目标，MeteoMate 会带入对应专家、提示和能力建议</p></div>
      </div>
      <div class="scene-grid">
        ${catalog.scenes
          .map(
            (scene) => `
          <button class="scene-card ${scene.gradient}" data-scene-id="${scene.id}">
            <span class="scene-orb">${sceneIcon(scene)}</span>
            <span class="scene-copy"><strong>${escapeHtml(scene.title)}</strong><small>${escapeHtml(scene.subtitle)}</small></span>
            <span class="scene-expert">${escapeHtml(getExpert(scene.expertId).name)}</span>
            <span class="scene-arrow">›</span>
          </button>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function expertSkillEntries(item) {
  const ids = item.recommendedSkills || item.requiredSkills || item.skills || [];
  const skills = userFacingSkillCatalog();
  return ids.map((id) => skills.find((skill) => skill.id === String(id).split('@')[0])).filter(Boolean);
}

function expertConnectorEntries(item) {
  const ids = [...(item.requiredConnectors || []), ...(item.recommendedConnectors || [])];
  const connectors = userFacingToolCatalog();
  return [...new Set(ids)]
    .map((id) => connectors.find((connector) => connector.id === String(id).split('@')[0]))
    .filter(Boolean);
}

function expertWorkflowEntries(item) {
  const references = [...new Set([
    ...(item.requiredWorkflows || []),
    ...(item.recommendedWorkflows || []),
  ])];
  const workflows = [...(state.workflowVersions || []), ...(state.workflows || [])];
  return references.map((reference) => {
    const [id = '', ...versionParts] = String(reference).split('@');
    const version = versionParts.join('@');
    return workflows.find((workflow) =>
      workflow.metadata?.id === id
      && (!version || workflow.metadata?.version === version)
      && workflow.metadata?.status === 'published'
    );
  }).filter(Boolean);
}

function expertMemberEntries(item) {
  return (item.members || []).map((id) => catalog.experts.find((expert) => expert.id === id)).filter(Boolean);
}

function renderExpertCard(item) {
  const favorite = state.favoriteExpertIds.includes(item.id);
  const inputs = item.inputs || [];
  const outputs = item.outputs || [];
  const skillCount = expertSkillEntries(item).length;
  const connectorCount = expertConnectorEntries(item).length;
  const workflowCount = expertWorkflowEntries(item).length;
  const memberCount = expertMemberEntries(item).length;
  return `
    <article class="expert-card">
      <div class="expert-top">
        <span class="avatar avatar-${item.avatar.codePointAt(0) % 6}">${escapeHtml(item.avatar)}</span>
        <div class="expert-title"><span>${escapeHtml(item.category || (item.kind === 'team' ? '专家团' : '气象专家'))}</span><h3>${escapeHtml(item.name)}</h3></div>
        <button class="card-favorite ${favorite ? 'active' : ''}" data-favorite-id="${item.id}" aria-label="${favorite ? '取消收藏' : '收藏'}${escapeHtml(item.name)}" title="${favorite ? '取消收藏' : '收藏专家'}">${icon('star')}</button>
      </div>
      <p class="expert-mission">${escapeHtml(item.mission || item.description)}</p>
      <div class="expert-contract">
        <span><small>需要</small><strong>${escapeHtml(inputs.slice(0, 2).join(' · ') || '明确任务目标与相关资料')}</strong></span>
        <span><small>交付</small><strong>${escapeHtml(outputs.slice(0, 2).join(' · ') || item.description)}</strong></span>
      </div>
      <div class="expert-card-meta">
        <span>${memberCount ? `${memberCount} 位成员` : `${skillCount} 个技能 · ${workflowCount} 个工作流 · ${connectorCount} 个工具`}</span>
        <span>${escapeHtml(item.owner || 'MeteoMate')}</span>
      </div>
      <div class="expert-card-actions">
        <button class="expert-detail-button" data-expert-detail-id="${item.id}">查看详情</button>
        <button class="card-launch" data-expert-id="${item.id}">使用专家 <span>→</span></button>
      </div>
    </article>
  `;
}

function renderExpertDetail(expertId) {
  const item = allExperts().find((expert) => expert.id === expertId);
  if (!item) return '';
  const favorite = state.favoriteExpertIds.includes(item.id);
  const skills = expertSkillEntries(item);
  const connectors = expertConnectorEntries(item);
  const workflows = expertWorkflowEntries(item);
  const members = expertMemberEntries(item);
  const workflow = item.workflow || item.tags || [];
  return `
    <div class="expert-detail-backdrop" data-close-expert-detail>
      <section class="expert-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="expert-detail-title">
        <header class="expert-detail-header">
          <span class="avatar avatar-${item.avatar.codePointAt(0) % 6}">${escapeHtml(item.avatar)}</span>
          <div>
            <span>${escapeHtml(item.category || (item.kind === 'team' ? '专家团' : '气象专家'))}</span>
            <h2 id="expert-detail-title">${escapeHtml(item.name)}</h2>
            <p>${escapeHtml(item.owner || 'MeteoMate')}</p>
          </div>
          <button class="card-favorite ${favorite ? 'active' : ''}" data-favorite-id="${item.id}" aria-label="${favorite ? '取消收藏' : '收藏'}${escapeHtml(item.name)}">${icon('star')}</button>
          <button class="expert-detail-close" data-close-expert-detail aria-label="关闭专家详情">${icon('close')}</button>
        </header>
        <div class="expert-detail-body">
          <section class="expert-detail-intro">
            <span>专家定位</span>
            <strong>${escapeHtml(item.mission || item.description)}</strong>
            <p>${escapeHtml(item.description)}</p>
          </section>
          <div class="expert-detail-contract">
            <section><span>需要你提供</span><ul>${(item.inputs || ['明确任务目标', '相关业务资料']).map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section>
            <section><span>可以交付</span><ul>${(item.outputs || [item.description]).map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section>
          </div>
          <section class="expert-detail-section">
            <div class="expert-detail-section-title"><strong>工作方法</strong><small>按步骤执行，结论保留证据和边界</small></div>
            <ol class="expert-workflow">${workflow.map((entry, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(entry)}</strong></li>`).join('')}</ol>
          </section>
          ${members.length ? `<section class="expert-detail-section"><div class="expert-detail-section-title"><strong>协作成员</strong><small>${members.length} 位专家按职责接力</small></div><div class="expert-member-list">${members.map((member) => `<span><b class="avatar small">${escapeHtml(member.avatar)}</b><strong>${escapeHtml(member.name)}</strong></span>`).join('')}</div></section>` : ''}
          <section class="expert-detail-section">
            <div class="expert-detail-section-title"><strong>已绑定能力</strong><small>新任务会自动继承这些建议</small></div>
            <div class="expert-capability-list">
              ${(skills.length ? skills.map((skill) => `<span>${icon('skill')}<b>${escapeHtml(skill.name)}</b><small>技能</small></span>`).join('') : '')}
              ${(workflows.length ? workflows.map((workflowDefinition) => `<span>${icon('workflow')}<b>${escapeHtml(workflowDefinition.metadata.name)}</b><small>工作流 v${escapeHtml(workflowDefinition.metadata.version)}</small></span>`).join('') : '')}
              ${(connectors.length ? connectors.map((connector) => `<span>${icon('tool')}<b>${escapeHtml(connector.name)}</b><small>工具</small></span>`).join('') : '')}
              ${!skills.length && !workflows.length && !connectors.length ? '<p>暂未绑定专用能力，将使用当前项目能力。</p>' : ''}
            </div>
          </section>
          <section class="expert-detail-section">
            <div class="expert-detail-section-title"><strong>试试这样问</strong><small>选中后可继续修改再发送</small></div>
            <div class="expert-prompt-list">${(item.prompts || []).slice(0, 3).map((prompt, index) => `<button data-expert-prompt-id="${escapeHtml(item.id)}" data-expert-prompt-index="${index}"><span>${escapeHtml(prompt)}</span>${icon('chevron')}</button>`).join('')}</div>
          </section>
        </div>
        <footer class="expert-detail-footer">
          <span>${escapeHtml(item.permissionProfile === 'workspace-approval' ? '需要工作区权限' : item.permissionProfile === 'artifact-approval' ? '成果操作按风险审批' : '只读查询自动允许')}</span>
          ${window.MeteoMateExpertCenter?.detailActions?.(item) || ''}
          <button class="primary-button" data-expert-id="${escapeHtml(item.id)}">使用此${item.kind === 'team' ? '专家团' : '专家'}</button>
        </footer>
      </section>
    </div>
  `;
}

function renderCapabilityCard(item, tab) {
  const isRuntime = item.status === 'runtime';
  const statusText = isRuntime
    ? state.runtime.binaryAvailable
      ? '可用'
      : '未就绪'
    : item.status === 'planned'
      ? '待接入'
      : item.status === 'built-in'
        ? '已内置'
        : item.status === 'demo'
          ? '构造演示'
          : item.status === 'experimental'
            ? '实验性'
        : item.status === 'beta'
          ? 'Beta'
          : item.status === 'production'
            ? '生产级'
            : item.status === 'deprecated'
              ? '已弃用'
          : item.status;
  const maturityText = {
    planned: '规划中',
    demo: '构造演示',
    experimental: '实验性',
    beta: 'Beta',
    production: '生产级',
    deprecated: '已弃用',
  }[item.maturity || item.status] || '未声明';

  return `
    <article class="capability-card">
      <div class="capability-icon">${escapeHtml(item.icon)}</div>
      <div class="capability-copy"><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category)}</span></div>
      <div class="capability-badges"><span class="capability-status ${isRuntime && state.runtime.binaryAvailable ? 'ready' : ''}">${escapeHtml(statusText)}</span><span class="capability-maturity maturity-${escapeHtml(item.maturity || item.status || 'experimental')}">${escapeHtml(maturityText)}</span></div>
      <p>${escapeHtml(item.description)}</p>
      <div class="tag-row small">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <button class="secondary-action" disabled>${tab === 'skills' ? '查看技能' : '配置工具服务'}</button>
    </article>
  `;
}

function teamMemberStatusText(status) {
  return {
    pending: '待分派',
    waiting: '等待',
    running: '执行中',
    in_progress: '执行中',
    completed: '已完成',
    failed: '失败',
    blocked: '上游受阻',
    cancelled: '已停止',
    interrupted: '已中断',
  }[status] || status || '待分派';
}

function renderTeamStatusIndicator(status) {
  const iconName = status === 'completed'
    ? 'check'
    : ['failed', 'cancelled'].includes(status)
      ? 'close'
      : ['blocked', 'interrupted'].includes(status)
        ? 'warning'
        : status === 'running'
          ? 'refresh'
          : 'queue';
  return `<span class="team-status-indicator ${escapeHtml(status || 'pending')}" aria-hidden="true">${icon(iconName)}</span>`;
}

function teamRunForMessage(task, message) {
  const runs = Array.isArray(task?.teamRuns) ? task.teamRuns : [];
  if (message?.teamRunId) {
    const linked = runs.find((run) => run?.id === message.teamRunId);
    if (linked) return linked;
    if (task?.teamRun?.id === message.teamRunId) return task.teamRun;
  }
  if (task?.teamRun?.responseId === message?.id) return task.teamRun;
  return runs.find((run) => run?.responseId === message?.id) || null;
}

function teamRunStatusText(run) {
  if (run?.phase === 'synthesizing') return '负责人汇总中';
  return {
    running: '专家协作中',
    completed: '协作已完成',
    partial: '已交付可用部分',
    failed: '协作未完成',
    cancelled: '协作已停止',
    interrupted: '协作已中断',
  }[run?.status] || '专家协作中';
}

function teamPhaseStepState(run, index) {
  const phaseIndex = {
    dispatching: 0,
    executing: 1,
    members: 1,
    synthesizing: 2,
    completed: 3,
  }[run?.phase] ?? (['partial', 'completed'].includes(run?.status) ? 3 : 1);
  if (phaseIndex > index) return 'completed';
  if (phaseIndex === index && ['running', 'synthesizing'].includes(run?.status)) return 'running';
  if (['failed', 'cancelled', 'interrupted'].includes(run?.status) && phaseIndex === index) return run.status;
  return 'pending';
}

function teamMemberHasEnteredRun(member) {
  if (!member || typeof member !== 'object') return false;
  return Boolean(
    member.activatedAt
    || member.startedAt
    || member.sessionId
    || member.summary
    || member.detail
    || member.activities?.length
    || member.updates?.length
    || ['running', 'completed', 'failed', 'blocked'].includes(member.status)
  );
}

function teamProcessFeedEntries(member) {
  const terminalStatus = ['completed', 'failed', 'blocked', 'cancelled', 'interrupted'].includes(member?.status)
    ? member.status
    : null;
  const activeStatuses = new Set(['streaming', 'running', 'pending', 'in_progress']);
  const normalizedStatus = (entry) => (
    terminalStatus && activeStatuses.has(entry?.status)
      ? { ...entry, status: terminalStatus }
      : entry
  );
  const stored = Array.isArray(member?.updates)
    ? member.updates.filter((entry) => entry && typeof entry === 'object' && String(entry.text || '').trim())
    : [];
  if (stored.length) {
    if (!terminalStatus) return stored.slice(-16).map(normalizedStatus);
    const terminalMessage = terminalStatus === 'completed'
      ? '已完成阶段分析并提交交接结果。'
      : '阶段分析已结束，保留已完成的过程记录。';
    const normalized = [];
    stored.forEach((entry) => {
      if (entry.source !== 'message') {
        normalized.push(normalizedStatus(entry));
        return;
      }
      if (normalized.some((candidate) => candidate.id === 'drafting-handoff')) return;
      normalized.push(normalizedStatus({
        ...entry,
        id: 'drafting-handoff',
        source: 'status',
        text: terminalMessage,
      }));
    });
    return normalized.slice(-16);
  }
  const fallback = [];
  if (member?.detail) {
    fallback.push({
      id: 'legacy-detail',
      source: member.detailSource || 'status',
      text: member.detail,
      status: member.status === 'running' ? 'streaming' : member.status,
      createdAt: member.detailUpdatedAt || member.startedAt || 0,
    });
  }
  (Array.isArray(member?.activities) ? member.activities : []).forEach((activity) => fallback.push({
    id: `legacy-activity:${activity.id || activity.title}`,
    source: 'activity',
    text: activity.title || '工具执行',
    toolName: activity.toolName || null,
    status: activity.status || 'running',
    createdAt: activity.createdAt || activity.updatedAt || 0,
  }));
  return fallback
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
    .slice(-16)
    .map(normalizedStatus);
}

function renderTeamProcessFeedEntry(entry, member) {
  const source = entry.source || 'status';
  if (source === 'activity') {
    return `<div class="team-process-feed-entry activity ${escapeHtml(entry.status || 'running')}">${icon('tool')}<span>${escapeHtml(entry.text || entry.toolName || '工具执行')}</span><small>${escapeHtml(teamMemberStatusText(entry.status))}</small></div>`;
  }
  const text = String(entry.text || '').trim();
  if (!text) return '';
  const streaming = member.status === 'running' && entry.status === 'streaming';
  return `<div class="team-process-feed-entry ${escapeHtml(source)} ${streaming ? 'streaming' : ''}"><span class="team-process-feed-marker" aria-hidden="true"></span>${source === 'message' ? `<div class="team-process-feed-markdown markdown-body">${renderMarkdown(text)}</div>` : `<p>${escapeHtml(text)}</p>`}</div>`;
}

function renderTeamHandoffResult(member, run) {
  const result = String(member?.summary || '').trim();
  if (!result) return '';
  const resultId = `${run.id}:${member.id}`;
  const expanded = teamUI.expandedResultIds.has(resultId);
  const longResult = result.length > 480 || result.split(/\r?\n/).length > 8;
  return `
    <section class="team-handoff-result ${expanded ? 'expanded' : ''}">
      <header>
        <span>${icon('check')}<strong>交接结果</strong></span>
        ${longResult ? `<button type="button" data-team-result-toggle="${escapeHtml(resultId)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}${escapeHtml(member.name)}的完整交接结果"><span>${expanded ? '收起' : '展开'}</span>${icon('down')}</button>` : ''}
      </header>
      <div class="team-handoff-markdown markdown-body ${longResult && !expanded ? 'clamped' : ''}">${renderMarkdown(result)}</div>
    </section>`;
}

function renderTeamSynthesisProgress(run, completedCount) {
  if (run?.phase !== 'synthesizing') return '';
  const synthesis = run.synthesis && typeof run.synthesis === 'object' ? run.synthesis : {};
  const text = String(synthesis.text || '').trim();
  const startedAt = Number(synthesis.startedAt) || Date.now();
  if (text) {
    return `<div class="team-synthesis-stream team-process-feed-markdown markdown-body" data-team-process-feed data-follow-output="true" role="region" aria-label="交付负责人汇总过程">${renderMarkdown(text)}</div>`;
  }
  const defaultLabel = synthesis.status === 'drafting'
    ? '正在生成最终交付稿'
    : completedCount
      ? `正在读取 ${completedCount} 份专家交接结果`
      : '正在读取成员交接结果';
  return `<div class="team-synthesis-awaiting" data-team-synthesis-awaiting data-started-at="${startedAt}"><span data-team-synthesis-awaiting-label data-default-label="${escapeHtml(defaultLabel)}">${escapeHtml(defaultLabel)}</span><span aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

function renderTeamProcessMember(member, run, memberNames) {
  const dependencyNames = (member.dependsOn || []).map((id) => memberNames.get(id) || id);
  const waitingDetail = member.status === 'pending' && dependencyNames.length
    ? `等待 ${dependencyNames.join('、')} 的交接结果`
    : member.status === 'pending'
      ? '等待交付负责人分派'
      : '';
  const statusLabel = member.status === 'pending' && dependencyNames.length
    ? '等待依赖'
    : teamMemberStatusText(member.status);
  const feedEntries = teamProcessFeedEntries(member);
  const update = member.error || (!feedEntries.length ? waitingDetail : '');
  const updateLabel = member.error
    ? '阻塞原因'
    : member.status === 'pending'
          ? '当前状态'
          : '当前进展';
  const selected = teamUI.selectedMemberId === member.id && run.id === getActiveTask()?.teamRun?.id;
  const duration = member.startedAt
    ? formatDuration(Math.max(0, Number(member.completedAt || Date.now()) - Number(member.startedAt)))
    : '';
  return `
    <article
      class="team-process-member ${escapeHtml(member.status || 'pending')} ${selected ? 'selected' : ''}"
      data-team-process-member="${escapeHtml(member.id)}"
      data-team-run-id="${escapeHtml(run.id)}"
      tabindex="-1"
    >
      <span class="avatar avatar-${member.avatar.codePointAt(0) % 6}">${escapeHtml(member.avatar)}</span>
      <div class="team-process-member-copy">
        <header>
          <span><strong>${escapeHtml(member.name)}</strong><small role="status" aria-live="polite">${escapeHtml(statusLabel)}${duration ? ` · ${escapeHtml(duration)}` : ''}</small></span>
          ${renderTeamStatusIndicator(member.status)}
        </header>
        <p class="team-process-objective">${escapeHtml(member.objective || '完成分配的专业分析并向负责人交接。')}</p>
        ${feedEntries.length ? `<div class="team-process-feed" data-team-process-feed data-follow-output="${member.status === 'running'}" role="list" aria-label="${escapeHtml(`${member.name}过程更新`)}">${feedEntries.map((entry) => renderTeamProcessFeedEntry(entry, member)).join('')}</div>` : ''}
        ${renderTeamHandoffResult(member, run)}
        ${update ? `<div class="team-process-update ${member.error ? 'failed' : ''}"><b>${escapeHtml(updateLabel)}</b><span>${escapeHtml(truncate(update, 360))}</span></div>` : ''}
      </div>
    </article>`;
}

function renderTeamRunProcess(message, run) {
  const members = Array.isArray(run?.members) ? run.members : [];
  const visibleMembers = members.filter(teamMemberHasEnteredRun);
  const completed = members.filter((member) => member.status === 'completed').length;
  const issueCount = members.filter((member) => ['failed', 'blocked', 'cancelled', 'interrupted'].includes(member.status)).length;
  const active = ['running', 'synthesizing'].includes(run?.status);
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const duration = Math.max(0, Number(run.completedAt || Date.now()) - Number(run.startedAt || message.startedAt || Date.now()));
  const steps = ['任务分派', '专家执行', '负责人汇总'];
  const leadStatus = run.phase === 'synthesizing'
    ? 'running'
    : ['completed', 'partial'].includes(run.status)
      ? 'completed'
      : ['failed', 'cancelled', 'interrupted'].includes(run.status)
        ? run.status
        : 'pending';
  const synthesis = run.synthesis && typeof run.synthesis === 'object' ? run.synthesis : {};
  const synthesisStartedAt = Number(synthesis.startedAt) || Number(run.startedAt) || Date.now();
  const leadDetail = run.phase === 'synthesizing'
    ? synthesis.status === 'drafting'
      ? '正在生成最终交付稿'
      : `正在核对 ${completed} 份专家交接结果`
    : ['completed', 'partial'].includes(run.status)
      ? issueCount
        ? `已基于 ${completed} 份可用结果完成交付，${issueCount} 位成员异常`
        : `已整合 ${completed} 位专家的交接结果`
      : '将在成员完成后统一校验并交付';
  return `
    <details class="team-run-process ${escapeHtml(run.status || 'running')}" data-team-run-process="${escapeHtml(run.id)}" ${active ? 'open' : ''}>
      <summary role="status" aria-live="polite">
        <span class="team-run-summary-copy"><strong>${escapeHtml(teamRunStatusText(run))}</strong><small>${completed} / ${members.length} 位完成${issueCount ? ` · ${issueCount} 位异常` : ''}</small></span>
        <span class="team-run-summary-meta"><em ${active ? 'data-live-duration' : ''} data-started-at="${run.startedAt || ''}">${formatDuration(duration)}</em>${icon('down')}</span>
      </summary>
      <div class="team-run-process-panel">
        <ol class="team-phase-rail" aria-label="专家团协作阶段">
          ${steps.map((label, index) => `<li class="${teamPhaseStepState(run, index)}"><span>${index + 1}</span><strong>${label}</strong></li>`).join('')}
        </ol>
        ${visibleMembers.length ? `
          <div class="team-process-heading" aria-label="成员进展，展示任务状态、可核验操作和交接结果，不展示模型内部思维链" title="不展示模型内部思维链"><strong>成员进展</strong><small>${active ? `${visibleMembers.length} 位已入场 · 其余成员按需调度` : `${completed} 位完成${issueCount ? ` · ${issueCount} 位异常` : ''}`}</small></div>
          <div class="team-process-members">${visibleMembers.map((member) => renderTeamProcessMember(member, run, memberNames)).join('')}</div>
        ` : ''}
        <article class="team-process-lead ${escapeHtml(leadStatus)}">
          <span class="avatar">责</span>
          <div class="team-process-lead-copy">
            <header><strong>交付负责人</strong><small><span>${escapeHtml(leadDetail)}</span>${run.phase === 'synthesizing' ? `<em data-live-duration data-started-at="${synthesisStartedAt}">${formatDuration(Math.max(0, Date.now() - synthesisStartedAt))}</em>` : ''}</small></header>
            ${renderTeamSynthesisProgress(run, completed)}
          </div>
          ${renderTeamStatusIndicator(leadStatus)}
        </article>
      </div>
    </details>`;
}

function renderTeamCollaborationBar(task, expert) {
  if (expert?.kind !== 'team') return '';
  const definition = task
    ? teamDefinitionForTask(task, expert)
    : teamDefinitionForExpert(expert);
  if (!definition) return '';
  const run = task?.teamRun || window.MeteoMateHarness.ExpertTeam.createRunState(definition);
  const visibleMembers = run.members.filter(teamMemberHasEnteredRun);
  const selectedMemberId = teamUI.selectedMemberId || visibleMembers[0]?.id;
  const terminal = ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(run.status);
  const collapsed = teamUI.collapsed || (terminal && !teamUI.expanded);
  const leadStatus = ['completed', 'partial'].includes(run.status)
    ? 'completed'
    : ['failed', 'cancelled', 'interrupted'].includes(run.status)
      ? run.status
      : run.phase === 'synthesizing'
        ? 'running'
        : task?.status === 'running'
          ? 'running'
          : 'pending';
  const leadDetail = run.phase === 'synthesizing'
    ? '正在汇总交付'
    : run.phase === 'executing'
      ? '正在协调成员'
      : run.status === 'partial'
        ? '已交付可用部分'
        : run.status === 'completed'
          ? '负责人 · 已交付'
          : '负责人 · 统一交付';
  const compactMembers = [
    { id: 'lead', name: '交付负责人', avatar: expert.avatar },
    ...visibleMembers,
  ];

  return `
    <section class="team-collaboration" aria-label="${escapeHtml(definition.name)}协作状态">
      <div class="team-chip-row ${collapsed ? 'collapsed' : ''}">
        ${collapsed ? `
          <div class="team-avatar-stack" role="group" aria-label="${escapeHtml(`${definition.name}，${compactMembers.length} 位成员`)}">
            ${compactMembers.map((member) => `<span class="avatar avatar-${member.avatar.codePointAt(0) % 6}" title="${escapeHtml(member.name)}">${escapeHtml(member.avatar)}</span>`).join('')}
          </div>
        ` : `
          <div class="team-chip team-lead-chip ${leadStatus}">
            <span class="avatar avatar-${expert.avatar.codePointAt(0) % 6}">${escapeHtml(expert.avatar)}</span>
            <span class="team-chip-copy"><strong>交付负责人</strong><small>${escapeHtml(leadDetail)}</small></span>
            ${renderTeamStatusIndicator(leadStatus)}
          </div>
          ${visibleMembers.map((member) => `
            <button
              type="button"
              class="team-chip team-member-chip ${escapeHtml(member.status)} ${selectedMemberId === member.id && teamUI.expanded ? 'selected' : ''}"
              data-team-member-id="${escapeHtml(member.id)}"
              data-team-run-id="${escapeHtml(run.id)}"
              aria-label="定位到${escapeHtml(member.name)}的协作过程"
              aria-pressed="${selectedMemberId === member.id && teamUI.expanded}"
              title="${escapeHtml(member.objective || member.name)}"
            >
              <span class="avatar avatar-${member.avatar.codePointAt(0) % 6}">${escapeHtml(member.avatar)}</span>
              <span class="team-chip-copy"><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(teamMemberStatusText(member.status))}</small></span>
              ${renderTeamStatusIndicator(member.status)}
            </button>
          `).join('')}
        `}
        ${visibleMembers.length ? `<button type="button" class="team-expand-button ${collapsed ? 'collapsed' : ''}" data-team-collapse aria-label="${collapsed ? '展开' : '收起'}专家团成员" aria-expanded="${!collapsed}">
          ${icon('down')}
        </button>` : ''}
      </div>
    </section>
  `;
}

function previewTabsForTask(task) {
  if (!task) return [];
  return previewUI.tabs.filter((tab) => tab.taskId === task.id);
}

function activePreviewTab(task) {
  const tabs = previewTabsForTask(task);
  return tabs.find((tab) => tab.id === previewUI.activeId) || tabs.at(-1) || null;
}

function renderArtifactPreviewPanel(task) {
  const tabs = previewTabsForTask(task);
  const activeTab = activePreviewTab(task);
  if (!activeTab) return '';
  const surfaceState = previewUI.surfaceStates[activeTab.id] || {};
  const address = surfaceState.address || activeTab.surfaceTarget || activeTab.target;
  const loading = Boolean(surfaceState.loading);
  const error = surfaceState.error || '';
  const previewKind = surfaceState.kind || activeTab.kind;
  const documentMode = ['document', 'office'].includes(previewKind);
  const pageCount = surfaceState.pageCount || activeTab.pageCount;
  const documentDetail = loading
    ? activeTab.extension === 'PDF'
      ? '正在加载页面…'
      : `正在将 ${activeTab.extension} 转换为只读预览…`
    : [
        pageCount ? `${pageCount} 页` : '只读预览',
        surfaceState.imageBacked ? '高保真' : '',
        surfaceState.cached ? '已缓存' : '',
      ].filter(Boolean).join(' · ');
  return `
    <aside class="artifact-preview-panel" aria-label="成果物预览区">
      <div
        class="artifact-preview-resizer"
        id="artifact-preview-resizer"
        role="separator"
        tabindex="0"
        aria-label="调整预览区宽度"
        aria-orientation="vertical"
        aria-valuemin="420"
        aria-valuemax="1200"
        aria-valuenow="${Math.round(previewUI.width)}"
      ></div>
      <header class="artifact-preview-tabs">
        <div class="artifact-preview-tab-list" role="tablist" aria-label="已打开的预览">
          ${tabs.map((tab) => `
            <div class="artifact-preview-tab ${tab.id === activeTab.id ? 'active' : ''}">
              <button
                class="artifact-path-target"
                type="button"
                role="tab"
                aria-selected="${tab.id === activeTab.id}"
                data-preview-tab="${escapeHtml(tab.id)}"
                ${artifactPathAttributes(tab.target)}
              >
                <span class="artifact-preview-tab-type">${escapeHtml(tab.extension)}</span>
                <strong>${escapeHtml(tab.title)}</strong>
              </button>
              <button type="button" class="artifact-preview-tab-close" data-preview-close="${escapeHtml(tab.id)}" aria-label="关闭${escapeHtml(tab.title)}">${icon('close')}</button>
            </div>
          `).join('')}
        </div>
      </header>
      <div class="artifact-preview-toolbar ${documentMode ? 'document-mode' : ''}">
        ${documentMode ? `
          <div class="artifact-preview-document-info artifact-path-target" ${artifactPathAttributes(activeTab.target)}>
            <span>${escapeHtml(activeTab.extension)}</span>
            <div><strong>${escapeHtml(activeTab.title)}</strong><small id="artifact-preview-document-detail">${escapeHtml(documentDetail)}</small></div>
          </div>
        ` : `
          <div class="artifact-preview-navigation" role="group" aria-label="预览导航">
            <button type="button" data-preview-navigate="back" aria-label="后退" title="后退" ${surfaceState.canGoBack ? '' : 'disabled'}>${icon('back')}</button>
            <button type="button" data-preview-navigate="forward" aria-label="前进" title="前进" ${surfaceState.canGoForward ? '' : 'disabled'}>${icon('chevron')}</button>
          </div>
          <form class="artifact-preview-address" id="artifact-preview-address-form">
            <span>${escapeHtml(activeTab.kind === 'web' ? 'WEB' : activeTab.extension)}</span>
            <input id="artifact-preview-address-input" value="${escapeHtml(address)}" aria-label="预览地址" autocomplete="off" spellcheck="false" />
          </form>
        `}
        <button type="button" class="${loading ? 'loading' : ''}" data-preview-navigate="${loading ? 'stop' : 'reload'}" aria-label="${loading ? '停止加载' : '刷新'}" title="${loading ? '停止加载' : '刷新'}" ${loading && !surfaceState.id ? 'disabled' : ''}>${loading ? icon('close') : icon('refresh')}</button>
        <button type="button" class="${documentMode ? 'artifact-preview-open-button' : ''}" data-preview-open-external aria-label="使用系统应用打开" title="使用系统应用打开">${icon('external')}${documentMode ? '<span>打开</span>' : ''}</button>
      </div>
      <div class="artifact-preview-surface-shell">
        <div
          class="artifact-preview-surface"
          id="artifact-preview-surface"
          role="tabpanel"
          aria-label="${escapeHtml(activeTab.title)}预览"
          data-preview-id="${escapeHtml(activeTab.id)}"
          data-preview-original-target="${escapeHtml(activeTab.target)}"
          data-preview-target="${escapeHtml(activeTab.surfaceTarget)}"
          data-preview-workspace="${escapeHtml(activeTab.workspace)}"
          data-preview-task-id="${escapeHtml(activeTab.taskId || task.id)}"
          data-preview-artifact-id="${escapeHtml(activeTab.artifactId || '')}"
        ></div>
        <div class="artifact-preview-surface-status ${error ? 'error' : loading ? 'loading' : ''}" id="artifact-preview-surface-status" ${error || loading ? '' : 'hidden'}>
          ${icon(error ? 'warning' : 'file')}
          <strong>${error ? '暂时无法预览' : '正在准备预览'}</strong>
          <p>${escapeHtml(error || documentDetail || 'MeteoMate 正在打开成果物。')}</p>
          ${error ? '<button type="button" data-preview-open-external>使用外部应用打开</button>' : ''}
        </div>
      </div>
    </aside>
  `;
}

function renderTaskView({ assistantMode = false } = {}) {
  const task = getActiveTask();
  const isNewTask = !assistantMode && !task;
  const expert = assistantMode ? primaryAssistant : task ? getTaskExpert(task) : getSelectedExpert();
  const project = assistantMode
    ? getAssistantProject(task)
    : task
      ? getTaskProject(task)
      : getSelectedProject();
  const isRunning = task?.status === 'running';
  const messages = task?.messages || [];
  const pendingPermissions = task?.pendingPermissions || [];
  const defaultPermissionProfileId = preferredPermissionProfileId(expert.permissionProfile);
  const requestedPermissionProfileId =
    task?.permissionProfileId ||
    (task
      ? task.allowFileTools
        ? defaultPermissionProfileId
        : 'analysis-readonly'
      : state.draftPermissionProfileId || defaultPermissionProfileId);
  const permissionProfileId = policyPermissionProfileId(requestedPermissionProfileId, defaultPermissionProfileId);
  const profile =
    catalog.permissionProfiles[permissionProfileId] || catalog.permissionProfiles['analysis-readonly'];
  const permissionToneClass = profile.tone ? `permission-${profile.tone}` : '';
  const permissionOptions = allowedPermissionProfiles()
    .map(
      (entry) => {
        const selected = entry.id === profile.id;
        const optionIcon = entry.icon || 'shield';
        const optionToneClass = entry.tone ? `permission-${entry.tone}` : '';
        return `
          <button
            class="permission-option ${optionToneClass} ${selected ? 'selected' : ''}"
            type="button"
            role="option"
            aria-selected="${selected}"
            data-permission-profile-id="${escapeHtml(entry.id)}"
          >
            <span class="permission-option-icon">${icon(optionIcon)}</span>
            <span class="permission-option-copy">
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.description)}</small>
            </span>
            <span class="permission-option-check">${selected ? icon('check') : ''}</span>
          </button>`;
      }
    )
    .join('');
  const selectedProviderId = task?.providerId || state.draftProviderId || modelSettings.providerId;
  const selectedProvider = modelSettings.providers.find((entry) => entry.id === selectedProviderId) || null;
  const selectedModelId =
    task?.modelId ?? state.draftModelId ?? modelSettings.modelId ?? selectedProvider?.defaultModel ?? '';
  const selectedModelValue = modelSelectionValue(selectedProviderId, selectedModelId);
  const availableModels = modelSettings.providers.flatMap((provider) =>
    (provider.models || []).map((model) => ({ provider, model }))
  );
  const modelOptions = [
    `<option value="" ${selectedModelValue ? '' : 'selected'}>自动选择</option>`,
    ...modelSettings.providers.map((provider) => `<optgroup label="${escapeHtml(provider.name)}">${(provider.models || []).map((model) => {
      const value = modelSelectionValue(provider.id, model.id);
      return `<option value="${escapeHtml(value)}" ${value === selectedModelValue ? 'selected' : ''}>${escapeHtml(provider.name)} · ${escapeHtml(model.name || model.id)}</option>`;
    }).join('')}</optgroup>`),
  ].join('');
  const modelUnavailable =
    modelSettings.status === 'loading' || modelSettings.status === 'idle' || !availableModels.length;
  const modelPlaceholder = modelSettings.status === 'error'
    ? '模型不可用'
    : ['loading', 'idle'].includes(modelSettings.status)
      ? '读取模型中'
      : '尚未配置模型';
  const selectedArtifactText = Boolean(
    (Array.isArray(task?.queuedDraftArtifactSelections)
      ? task.queuedDraftArtifactSelections
      : task?.artifactSelections || []).length
  );
  const promptPlaceholder = selectedArtifactText
    ? '说明希望如何修改或核对这段原文…'
    : task?.sessionId
    ? '继续追问或补充资料，@ 引用文件，/ 调用技能与指令'
    : assistantMode
      ? '今天帮你做些什么？@ 引用对话文件，/ 调用技能与指令'
      : isNewTask
        ? '描述气象任务，@ 引用项目文件，/ 调用技能与指令'
        : '描述任务，@ 引用文件，/ 调用技能与指令';
  const sendShortcut = desktopSettings.preferences.sendOnEnter ? 'Enter' : 'Command / Ctrl + Enter';
  const previewVisible = Boolean(task && previewUI.open && previewUI.taskId === task.id && activePreviewTab(task));
  return `
    <div class="task-workbench ${previewVisible ? 'preview-open' : ''}" style="--preview-panel-width: ${Math.round(previewUI.width)}px">
      <section class="chat-workspace ${assistantMode ? 'assistant-chat-workspace' : ''}">
        <div class="conversation-scroll">
          ${
            messages.length
              ? messages.map((message) => renderMessage(message, task)).join('')
              : isNewTask
                ? renderNewTaskWelcome(expert)
                : renderConversationWelcome(expert)
          }
          ${
            pendingPermissions.length
              ? `<section class="inline-permission-stack">
                  <div class="inline-permission-heading">
                    <span>${icon('shield')} 待确认操作</span>
                    <em>${pendingPermissions.length}</em>
                  </div>
                  ${pendingPermissions.map(renderPermissionCard).join('')}
                </section>`
              : ''
          }
          ${renderQueuedPrompts(task)}
        </div>
        <div class="composer-dock">
          ${assistantMode ? '' : renderTeamCollaborationBar(task, expert)}
          <div class="composer-shell">
            <section class="composer-trigger-palette" id="composer-trigger-palette" aria-label="输入快捷菜单" hidden>
              <header>
                <span id="composer-trigger-title">快捷选择</span>
                <small id="composer-trigger-count"></small>
              </header>
              <div class="composer-trigger-list" id="composer-trigger-list" role="listbox"></div>
              <footer><span>↑↓ 选择</span><span>Enter 或 Tab 添加</span><span>Esc 关闭</span></footer>
            </section>
            ${renderTaskDraftContext(expert, isNewTask)}
            <textarea
              id="task-prompt"
              placeholder="${isRunning ? '回复生成中，可继续输入下一条消息' : promptPlaceholder}"
            >${escapeHtml(isNewTask ? state.draftPrompt || '' : task?.draftPrompt || '')}</textarea>
            <div class="composer-footer">
              <div class="composer-secondary-tools">
                ${renderComposerMoreMenu({ task, project, isRunning, assistantMode })}
                <div class="composer-permission-menu">
                  <button
                    class="composer-permission-trigger composer-tooltip-control ${permissionToneClass}"
                    id="composer-permission"
                    type="button"
                    data-permission-profile-id="${escapeHtml(profile.id)}"
                    data-tooltip="审批策略：${escapeHtml(profile.name)}。${escapeHtml(profile.description)}"
                    aria-label="选择审批策略，当前为${escapeHtml(profile.name)}"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    aria-controls="composer-permission-popover"
                    ${isRunning ? 'disabled' : ''}
                  >
                    ${icon(profile.tone === 'full' ? 'warning' : 'shield')}
                    <span class="composer-permission-label">${escapeHtml(profile.name)}</span>
                  </button>
                  <div class="permission-popover" id="composer-permission-popover" role="listbox" hidden>
                    <div class="permission-popover-heading">
                      <strong>应如何批准 MeteoMate 操作？</strong>
                      <small>仅作用于当前${assistantMode ? '助理会话' : '任务'}</small>
                    </div>
                    <div class="permission-option-list">${permissionOptions}</div>
                  </div>
                </div>
              </div>
              <div class="composer-primary-tools">
                ${desktopSettings.preferences.showContextMeter ? renderComposerContextMeter(task, selectedProviderId, selectedModelId) : ''}
                <label class="composer-select composer-model-control ${modelUnavailable ? 'disabled' : ''}">
                  ${icon('model')}
                  <select id="composer-model" aria-label="选择模型" ${isRunning || modelUnavailable ? 'disabled' : ''}>
                    ${modelUnavailable ? `<option>${modelPlaceholder}</option>` : modelOptions}
                  </select>
                </label>
                ${modelUnavailable ? `<button type="button" class="composer-model-fix" id="composer-open-model-settings" title="打开模型设置">去配置</button>` : ''}
                <button
                  class="primary-button send-icon-button ${isRunning ? 'stop-mode' : ''}"
                  id="${isRunning ? 'cancel-task' : 'send-task'}"
                  aria-label="${isRunning ? '停止生成' : `${task?.sessionId ? '继续任务' : '开始执行'}，按 ${sendShortcut} 发送`}"
                  title="${isRunning ? '停止生成' : `按 ${sendShortcut} 发送`}"
                >${icon(isRunning ? 'stop' : 'arrowUp')}</button>
              </div>
            </div>
          </div>
          <p class="composer-ai-disclaimer">内容由 AI 生成，请仔细甄别</p>
        </div>
      </section>
      ${previewVisible ? renderArtifactPreviewPanel(task) : ''}
    </div>
  `;
}

function renderNewTaskWelcome(expert) {
  const taskModes = [
    { id: 'forecast', label: '预报研判' },
    { id: 'data', label: '数据科研' },
    { id: 'products', label: '产品制作' },
    { id: 'operations', label: '运维保障' },
  ];
  const mode = taskModes.some((entry) => entry.id === state.draftTaskMode)
    ? state.draftTaskMode
    : 'forecast';
  const scenes = catalog.scenes.filter((scene) => (scene.group || 'forecast') === mode);
  const selectedScene = catalog.scenes.find((scene) => scene.id === state.draftSceneId) || null;
  const prompts = selectedScene ? (expert.prompts || []).slice(0, 3) : [];
  return `
    <section class="new-task-launchpad" aria-labelledby="new-task-title">
      <span class="new-task-eyebrow" lang="en">METEOMATE TASK DESK</span>
      <h1 id="new-task-title">今天需要研判什么？</h1>
      <p>选择一个气象场景装配默认专家，也可以直接描述任务。项目资料、技能与工具会在首次发送时一起固化。</p>
      <div class="new-task-mode-tabs" role="tablist" aria-label="任务类型">
        ${taskModes.map((entry) => `<button type="button" role="tab" aria-selected="${entry.id === mode}" class="${entry.id === mode ? 'active' : ''}" data-task-mode="${entry.id}">${entry.label}</button>`).join('')}
      </div>
      <div class="new-task-scene-list">
        ${scenes.map((scene) => `
          <button type="button" class="new-task-scene ${scene.id === selectedScene?.id ? 'active' : ''}" data-task-scene-id="${escapeHtml(scene.id)}">
            <span class="new-task-scene-symbol">${sceneIcon(scene)}</span>
            <span><strong>${escapeHtml(scene.title)}</strong><small>${escapeHtml(scene.subtitle)}</small></span>
            ${scene.id === selectedScene?.id ? icon('check') : icon('chevron')}
          </button>`).join('')}
      </div>
      ${prompts.length ? `<div class="new-task-prompt-row"><span>可以这样开始</span>${prompts.map((prompt) => `<button type="button" data-prompt-example="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}</div>` : ''}
    </section>
  `;
}

function renderTaskDraftContext(expert, isNewTask) {
  const scene = isNewTask ? catalog.scenes.find((entry) => entry.id === state.draftSceneId) : null;
  const expertSelected = isNewTask && state.selectedExpertId;
  const expertLabel = scene ? `场景：${scene.title}` : expertSelected ? `专家：${expert.name}` : '';
  const activeTask = getActiveTask();
  const fileReferences = activeTask
    ? Array.isArray(activeTask.queuedDraftFileReferences)
      ? activeTask.queuedDraftFileReferences
      : activeTask.fileReferences || []
    : state.draftFileReferences || [];
  const artifactSelections = activeTask
    ? Array.isArray(activeTask.queuedDraftArtifactSelections)
      ? activeTask.queuedDraftArtifactSelections
      : activeTask.artifactSelections || []
    : state.draftArtifactSelections || [];
  return `
    <div class="composer-draft-context">
      ${expertLabel ? `<button type="button" class="composer-draft-chip" data-clear-task-expert aria-label="移除${escapeHtml(expertLabel)}"><span>${escapeHtml(expertLabel)}</span><b>×</b></button>` : ''}
      <div id="composer-capability-chips"></div>
      <div class="composer-reference-chips">${fileReferences.map((filePath) => `<button type="button" class="composer-draft-chip reference" data-remove-task-file="${escapeHtml(filePath)}" title="${escapeHtml(filePath)}" aria-label="移除文件${escapeHtml(filePath)}"><span>文件：${escapeHtml(pathBaseName(filePath))}</span><b>×</b></button>`).join('')}</div>
      ${artifactSelections.length ? `<div class="composer-selection-references" aria-label="文档原文引用">${artifactSelections.map(renderComposerArtifactSelection).join('')}</div>` : ''}
    </div>
  `;
}

function artifactSelectionPageLabel(selection) {
  const pages = [...new Set((selection?.pages || []).map(Number).filter((page) => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right);
  if (!pages.length) return '文档选区';
  return pages.length === 1 ? `第 ${pages[0]} 页` : `第 ${pages[0]}–${pages.at(-1)} 页`;
}

function artifactSelectionEditStatus(selection) {
  if (selection?.editability === 'editable' && String(selection?.format || '').toUpperCase() === 'DOCX') {
    return { label: '可精确修改', state: 'editable', title: selection.editReason || '已定位唯一正文段落' };
  }
  return { label: '仅供引用', state: 'reference-only', title: selection?.editReason || '当前选区不会直接写入原文件' };
}

function renderComposerArtifactSelection(selection) {
  const editStatus = artifactSelectionEditStatus(selection);
  return `
    <article class="composer-selection-reference">
      <button type="button" class="composer-selection-jump" data-artifact-selection-jump="${escapeHtml(selection.selectionId)}" title="返回原文位置">
        <b>${escapeHtml(selection.number || 1)}</b>
        <span><strong>${escapeHtml(selection.title || pathBaseName(selection.path || '文档'))}</strong><small>${escapeHtml(artifactSelectionPageLabel(selection))}<em data-state="${editStatus.state}" title="${escapeHtml(editStatus.title)}">${editStatus.label}</em></small></span>
        <q>${escapeHtml(selection.quote || '')}</q>
      </button>
      <button type="button" class="composer-selection-remove" data-remove-artifact-selection="${escapeHtml(selection.selectionId)}" aria-label="移除此原文引用">×</button>
    </article>
  `;
}

function renderMessageArtifactSelections(selections) {
  if (!Array.isArray(selections) || !selections.length) return '';
  return `<div class="message-selection-references" aria-label="本轮引用的文档原文">${selections.map((selection) => {
    const editStatus = artifactSelectionEditStatus(selection);
    return `
    <button type="button" data-artifact-selection-jump="${escapeHtml(selection.selectionId)}" title="返回原文位置">
      <b>${escapeHtml(selection.number || 1)}</b>
      <span><strong>${escapeHtml(selection.title || pathBaseName(selection.path || '文档'))}</strong><small>${escapeHtml(artifactSelectionPageLabel(selection))}<em data-state="${editStatus.state}" title="${escapeHtml(editStatus.title)}">${editStatus.label}</em></small></span>
      <q>${escapeHtml(selection.quote || '')}</q>
    </button>
  `;
  }).join('')}</div>`;
}

function renderComposerMoreMenu({ task, project, isRunning, assistantMode = false }) {
  const expertEditable = !assistantMode && !task?.sessionId && !isRunning;
  const expertOptions = allExperts()
    .filter((entry) => entry.kind !== 'team')
    .slice(0, 8);
  return `
    <div class="composer-more-menu">
      <button type="button" class="composer-icon-action composer-tooltip-control" id="composer-more" data-tooltip="添加专家、技能、工具或资料" aria-label="添加专家、技能、工具或资料" aria-haspopup="menu" aria-expanded="false" ${isRunning ? 'disabled' : ''}>${icon('plus')}</button>
      <div class="composer-more-popover" id="composer-more-popover" role="menu" hidden>
        <details class="composer-expert-disclosure" ${expertEditable ? '' : 'data-disabled'}>
          <summary>${icon('expert')}<span><strong>选择专家</strong><small>${expertEditable ? '指定本次任务的专业角色' : assistantMode ? '助理会话使用固定专家' : '已有会话不能更换专家'}</small></span>${icon('chevron')}</summary>
          ${expertEditable ? `<div class="composer-expert-options">${expertOptions.map((entry) => `<button type="button" data-task-expert-id="${escapeHtml(entry.id)}"><span class="avatar small">${escapeHtml(entry.avatar)}</span><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.category || entry.description)}</small></span>${entry.id === (task?.expertId || state.selectedExpertId) ? icon('check') : ''}</button>`).join('')}</div>` : ''}
        </details>
        <button type="button" id="composer-capabilities" role="menuitem">${icon('tool')}<span><strong>技能与工具</strong><small>选择当前任务可以调用的能力</small></span>${icon('chevron')}</button>
        <button type="button" role="menuitem" data-task-import-knowledge="${escapeHtml(project?.id || '')}" ${project ? '' : 'disabled'}>${icon('file')}<span><strong>添加本地资料</strong><small>${project ? `保存到“${escapeHtml(project.name)}”并用于检索` : '请先选择项目'}</small></span>${icon('chevron')}</button>
      </div>
    </div>
  `;
}

function renderComposerProjectMenu(project, task, isRunning) {
  const locked = isRunning || Boolean(task?.sessionId);
  return `
    <div class="composer-project-menu">
      <button class="composer-context-button" id="choose-workspace" type="button" aria-haspopup="listbox" aria-expanded="false" ${locked ? 'disabled' : ''}>
        ${icon('folder')}
        <span>${project ? escapeHtml(project.name) : '选择项目'}</span>
        ${icon('down')}
      </button>
      <div class="composer-project-popover" id="composer-project-popover" role="listbox" hidden>
        <div class="composer-project-heading"><strong>任务项目</strong><small>继承工作目录、指令和资料</small></div>
        <div class="composer-project-options">
          ${state.projects.length ? state.projects.map((entry) => `<button type="button" role="option" aria-selected="${entry.id === project?.id}" data-task-project-id="${escapeHtml(entry.id)}">${icon('project')}<span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(shortPath(entry.workspace))}</small></span>${entry.id === project?.id ? icon('check') : ''}</button>`).join('') : '<p>还没有项目，可以直接新建一个。</p>'}
        </div>
        <div class="composer-project-actions">
          ${project ? '<button type="button" data-task-clear-project>不使用项目</button>' : ''}
          <button type="button" id="create-project-from-folder">${icon('folder')} 导入已有目录</button>
        </div>
      </div>
    </div>
  `;
}

function renderQueuedPrompts(task) {
  const queued = Array.isArray(task?.queuedPrompts) ? task.queuedPrompts : [];
  if (!queued.length) return '';
  const paused = task.status !== 'running';
  return `
    <section class="queued-prompt-stack" aria-label="排队消息">
      ${queued
        .map(
          (item, index) => `
        <div class="queued-prompt-card">
          ${icon('queue')}
          <div class="queued-prompt-copy">
            <span>${escapeHtml(item.text)}</span>
            <small>${paused ? '排队已暂停：可手动发送或移除' : `排队中 · 第 ${index + 1} 位，当前回复完成后自动发送`}</small>
          </div>
          <div class="queued-prompt-actions">
            ${paused ? `<button type="button" class="queued-send" data-queue-send="${index}">发送</button>` : ''}
            <button type="button" data-queue-cancel="${index}" aria-label="移除排队消息">移除</button>
          </div>
        </div>`
        )
        .join('')}
    </section>`;
}

function renderConversationWelcome(expert) {
  return `
    <div class="conversation-welcome">
      <span class="welcome-mark">${escapeHtml(expert.avatar)}</span>
      <h2>${escapeHtml(expert.name)}</h2>
      <p>${escapeHtml(expert.description)}</p>
      <div class="prompt-examples">
        ${expert.prompts
          .map(
            (prompt) =>
              `<button class="prompt-example" data-prompt-example="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderMessage(message, task) {
  const pending = message.status === 'streaming' && !message.text;
  const responsePhase = message.role === 'assistant' ? resolveResponsePhase(message, task) : null;
  const process = message.role === 'assistant'
    ? desktopSettings.preferences.showExecutionProcess
      ? renderResponseProcess(message, task)
      : renderResponseStatusOnly(message, task, responsePhase)
    : '';
  const showBubble = !pending || responsePhase === 'responding';
  const usage = message.role === 'assistant' && showBubble ? renderResponseUsage(message, task) : '';
  const editing = message.role === 'user'
    && messageUI.editingTaskId === task?.id
    && messageUI.editingMessageId === message.id;
  const actions = showBubble && !pending ? renderMessageActions(message, task) : '';
  return `
    <article class="message-row ${message.role} ${editing ? 'editing' : ''}" data-message-id="${escapeHtml(message.id)}">
      <div class="message-avatar">${message.role === 'user' ? '我' : 'M'}</div>
      <div class="message-content">
        <div class="message-meta"><strong>${message.role === 'user' ? '你' : brand.name}</strong><span>${formatTime(message.createdAt)}</span></div>
        ${process}
        ${
          showBubble
            ? editing
              ? renderMessageEditor(message)
              : `<div class="message-bubble ${pending ? 'typing' : ''}">
                ${
                  pending
                    ? '<i></i><i></i><i></i>'
                    : message.role === 'assistant'
                      ? `<div class="markdown-body">${renderMarkdown(message.text || '')}</div>${renderMessageArtifacts(message, task)}`
                      : `<pre>${escapeHtml(message.text || '')}</pre>${renderMessageArtifactSelections(message.artifactSelections)}`
                }
              </div>`
            : ''
        }
        ${usage}
        ${editing ? '' : actions}
      </div>
    </article>
  `;
}

function renderMessageEditor(message) {
  return `
    <form class="message-editor" data-message-edit-form="${escapeHtml(message.id)}">
      <textarea
        id="message-edit-${escapeHtml(message.id)}"
        aria-label="编辑问题"
        rows="3"
      >${escapeHtml(message.text || '')}</textarea>
      <div class="message-editor-actions">
        <span>重新发送后，将从这条问题创建新的对话分支</span>
        <button type="button" data-message-edit-cancel>取消</button>
        <button type="submit" class="primary">重新发送</button>
      </div>
    </form>
  `;
}

function renderMessageActions(message, task) {
  const copyButton = `
    <button
      type="button"
      class="message-action"
      data-message-copy="${escapeHtml(message.id)}"
      data-tooltip="复制"
      aria-label="复制${message.role === 'user' ? '问题' : '答案'}"
    >${icon('copy')}</button>`;
  if (message.role === 'user') {
    const canEdit = task?.status !== 'running';
    return `
      <div class="message-actions" aria-label="问题操作">
        ${copyButton}
        <button
          type="button"
          class="message-action"
          data-message-edit="${escapeHtml(message.id)}"
          data-tooltip="${canEdit ? '编辑并重新发送' : '回复完成后可编辑'}"
          aria-label="${canEdit ? '编辑问题并重新发送' : '回复完成后可编辑问题'}"
          ${canEdit ? '' : 'disabled'}
        >${icon('edit')}</button>
      </div>`;
  }
  if (message.status === 'streaming') {
    return `<div class="message-actions" aria-label="答案操作">${copyButton}</div>`;
  }
  const feedback = message.feedback || '';
  return `
    <div class="message-actions" aria-label="答案操作">
      ${copyButton}
      <span class="message-action-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="message-action ${feedback === 'up' ? 'active' : ''}"
        data-message-feedback="up"
        data-message-id="${escapeHtml(message.id)}"
        data-tooltip="${feedback === 'up' ? '取消点赞' : '这个回答有帮助'}"
        aria-label="${feedback === 'up' ? '取消点赞' : '点赞'}"
        aria-pressed="${feedback === 'up'}"
      >${icon('thumbUp')}</button>
      <button
        type="button"
        class="message-action ${feedback === 'down' ? 'active negative' : ''}"
        data-message-feedback="down"
        data-message-id="${escapeHtml(message.id)}"
        data-tooltip="${feedback === 'down' ? '取消点踩' : '这个回答需要改进'}"
        aria-label="${feedback === 'down' ? '取消点踩' : '点踩'}"
        aria-pressed="${feedback === 'down'}"
      >${icon('thumbDown')}</button>
    </div>`;
}

function renderMessageArtifacts(message, task) {
  const artifactIds = new Set(message.artifactIds || []);
  const related = (task?.artifacts || []).filter((artifact) =>
    artifactIds.has(artifact.id) || artifact.metadata?.responseId === message.id
  );
  const images = related.filter((artifact) => {
    const mediaType = String(artifact.mediaType || '').toLowerCase();
    const extension = String(artifact.path || artifact.name || '').split('.').pop()?.toLowerCase();
    return (mediaType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension))
      && artifact.metadata?.previewUri;
  });
  const imageIds = new Set(images.map((artifact) => artifact.id));
  const files = related.filter((artifact) => !imageIds.has(artifact.id));
  if (!images.length && !files.length) return '';
  return `<div class="message-artifact-gallery" aria-label="本次回答生成的成果物">
    ${images.map((artifact, index) => `
      <button type="button" class="message-artifact-image artifact-path-target" data-open-artifact="${escapeHtml(artifact.path || '')}" ${artifactPathAttributes(artifact.path || artifact.uri)} aria-label="打开${escapeHtml(artifact.name || `图件 ${index + 1}`)}">
        <img src="${escapeHtml(artifact.metadata.previewUri)}" alt="${escapeHtml(artifact.name || `图件 ${index + 1}`)}" loading="lazy" />
        <span><strong>图 ${index + 1}</strong><small>${escapeHtml(artifact.name || '浏览器截图')}</small></span>
      </button>
    `).join('')}
    ${files.map(renderOfficeArtifactCard).join('')}
  </div>`;
}

function artifactStatusLabel(status) {
  return {
    draft: '草稿',
    validated: '已校验',
    ready: '可交付',
    failed: '校验失败',
    published: '已发布',
  }[status] || '草稿';
}

function artifactSizeLabel(sizeBytes) {
  if (sizeBytes == null || sizeBytes === '') return '';
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderOfficeArtifactCard(artifact) {
  const extension = String(artifact.name || '').split('.').pop()?.toUpperCase() || 'FILE';
  const render = artifact.metadata?.render || {};
  const detail = [
    artifact.metadata?.selectionEdit ? '原文修改' : '',
    render.pageCount ? `${render.pageCount} 页` : '',
    artifactSizeLabel(artifact.sizeBytes),
  ].filter(Boolean).join(' · ');
  return `
    <button type="button" class="message-office-artifact artifact-path-target" data-open-artifact="${escapeHtml(artifact.path || '')}" ${artifactPathAttributes(artifact.path || artifact.uri)} aria-label="预览${escapeHtml(artifact.name || 'Office 成果物')}">
      ${render.thumbnailUri ? `<img src="${escapeHtml(render.thumbnailUri)}" alt="" loading="lazy" />` : `<span class="message-office-artifact-icon">${escapeHtml(extension)}</span>`}
      <span class="message-office-artifact-copy">
        <strong>${escapeHtml(artifact.name || 'Office 成果物')}</strong>
        <small>${escapeHtml(detail || extension)}</small>
      </span>
      <em class="${escapeHtml(artifact.status || 'draft')}">${escapeHtml(artifactStatusLabel(artifact.status))}</em>
    </button>
  `;
}

function renderResponseStatusOnly(message, task, responsePhase) {
  const teamRun = teamRunForMessage(task, message);
  if (teamRun) return renderTeamRunProcess(message, teamRun);
  if (message.status !== 'streaming') return '';
  if (task?.contextState?.phase === 'compacting') return renderResponseAwaiting(message, task, 'compacting');
  return responsePhase === 'responding' ? '' : renderResponseAwaiting(message, task, responsePhase);
}

function resolveResponsePhase(message, task) {
  if (message.status !== 'streaming') return 'completed';
  if (['preparing', 'waiting_model', 'analyzing', 'responding'].includes(message.responsePhase)) {
    return message.responsePhase;
  }
  const hasVisibleActivity = (task?.activities || []).some(
    (activity) => activity.responseId === message.id && activity.type !== 'info'
  );
  return message.text || hasVisibleActivity ? 'responding' : 'waiting_model';
}

function responseAwaitingState(message, task, responsePhase) {
  const progress = message?.runtimeProgress || {};
  const activeTeamRun = teamRunForMessage(task, message) || task?.teamRun;
  if (
    activeTeamRun
    && ['running', 'synthesizing'].includes(activeTeamRun.status)
    && ['dispatching', 'executing', 'members', 'synthesizing'].includes(activeTeamRun.phase)
  ) {
    const completed = activeTeamRun.members.filter((member) => member.status === 'completed').length;
    const running = activeTeamRun.members.filter((member) => member.status === 'running');
    return activeTeamRun.phase === 'synthesizing'
      ? {
          label: '负责人正在汇总',
          detail: `整合 ${completed} 位专家的交接结果`,
          startedAt: activeTeamRun.startedAt,
          modelLabel: '',
          mode: 'team-awaiting',
        }
      : {
          label: '专家协作中',
          detail: running.length
            ? `${running.map((member) => member.name).join('、')}正在执行`
            : '正在按依赖关系分派任务',
          startedAt: activeTeamRun.startedAt,
          modelLabel: '',
          mode: 'team-awaiting',
        };
  }
  const preparingLabels = {
    preparing_context: '整理任务与资料',
    preparing_runtime: '连接运行服务',
    preparing_session: '准备模型会话',
    loading_capabilities: '加载已选工具',
  };
  const modelLabel = truncate(progress.modelId || message?.modelId || task?.modelId || '', 32);
  const startedAt = responsePhase === 'waiting_model'
    ? message?.modelRequestedAt || progress.requestedAt || message?.responsePhaseChangedAt
    : progress.startedAt || message?.startedAt || message?.createdAt;
  if (responsePhase === 'compacting') {
    return { label: '正在压缩上下文', detail: '保留关键资料与结论', startedAt, modelLabel: '' };
  }
  if (responsePhase === 'waiting_model') {
    const slow = Date.now() - Number(startedAt || Date.now()) >= 8000;
    return {
      label: slow ? '模型响应较慢' : '等待模型响应',
      detail: slow ? '首段内容尚未返回，任务仍在运行' : modelLabel || '请求已发送',
      startedAt,
      modelLabel: modelLabel || '请求已发送',
    };
  }
  const toolCount = Number(progress.toolCount || 0);
  const connectorCount = Number(progress.connectorCount || 0);
  const detail = progress.stage === 'loading_capabilities'
    ? toolCount
      ? `${toolCount} 个已选工具`
      : connectorCount
        ? `${connectorCount} 个工具服务`
        : '基础对话能力'
    : modelLabel || '准备运行环境';
  return {
    label: preparingLabels[progress.stage] || '准备任务',
    detail,
    startedAt,
    modelLabel,
  };
}

function renderResponseAwaiting(message, task, responsePhase) {
  const status = responseAwaitingState(message, task, responsePhase);
  return `
    <div class="response-awaiting ${responsePhase} ${status.mode || ''}" role="status" aria-live="polite" data-started-at="${status.startedAt || ''}">
      <span class="response-awaiting-status">
        <strong data-response-awaiting-label>${escapeHtml(status.label)}</strong>
        <small data-response-awaiting-detail data-model-label="${escapeHtml(status.modelLabel)}">${escapeHtml(status.detail)}</small>
      </span>
      <em class="response-awaiting-elapsed" data-live-duration data-started-at="${status.startedAt || ''}">${formatDuration(Math.max(0, Date.now() - Number(status.startedAt || Date.now())))}</em>
      <span class="response-awaiting-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>
  `;
}

function renderResponseProcess(message, task) {
  const teamRun = teamRunForMessage(task, message);
  if (teamRun) return renderTeamRunProcess(message, teamRun);
  const activities = (task?.activities || []).filter(
    (activity) => activity.responseId === message.id && activity.type !== 'info'
  );
  const processPlan = Array.isArray(message.processPlan) ? message.processPlan : [];
  const running = message.status === 'streaming';
  const responsePhase = resolveResponsePhase(message, task);
  if (running && task?.contextState?.phase === 'compacting') {
    return renderResponseAwaiting(message, task, 'compacting');
  }
  if (running && !['analyzing', 'responding'].includes(responsePhase)) {
    return renderResponseAwaiting(message, task, responsePhase);
  }
  const durationMs = running
    ? Math.max(0, Date.now() - (message.startedAt || message.createdAt || Date.now()))
    : message.durationMs ??
      (message.completedAt && message.startedAt
        ? Math.max(0, message.completedAt - message.startedAt)
        : null);
  const statusText = running
    ? responsePhase === 'analyzing'
      ? '分析中'
      : '执行中'
    : message.runStatus === 'failed'
      ? '未完成'
      : message.runStatus === 'cancelled'
        ? '已停止'
        : '已完成';
  const activityMarkup = activities.length
    ? activities.map(renderResponseActivity).join('')
    : '<p class="response-process-empty">本轮未调用外部工具。</p>';
  return `
    <details class="response-process ${running ? 'running' : ''}" ${running ? 'open' : ''}>
      <summary>
        <span>${statusText}<em class="response-elapsed" ${running ? 'data-live-duration' : ''} data-started-at="${message.startedAt || ''}">${formatDuration(durationMs)}</em></span>
        ${icon('down')}
      </summary>
      <div class="response-process-panel">
        <div class="response-process-heading">
          <strong>思考与执行过程</strong>
          <small>展示可核验的推理摘要、计划和工具活动</small>
        </div>
        ${processPlan.length ? `<div class="response-plan">${processPlan.map(renderPlanItem).join('')}</div>` : ''}
        <div class="response-activity-list">${activityMarkup}</div>
      </div>
    </details>
  `;
}

function renderResponseActivity(activity) {
  const rawDetail = String(activity.detail || '').trim();
  const cleanDetail = ['undefined', '"undefined"', 'null', '"null"', '{}', '[]'].includes(rawDetail)
    ? ''
    : rawDetail;
  const detail =
    activity.type === 'thought'
      ? renderThoughtProgress(activity, cleanDetail)
      : truncate(cleanDetail, 360);
  const activityIcon =
    activity.type === 'tool'
      ? icon('tool')
      : activity.type === 'permission'
        ? icon('shield')
        : activity.type === 'error'
          ? '!'
          : '·';
  return `
    <article class="response-activity ${activity.type || ''} ${activity.status || ''}">
      <span class="response-activity-icon">${activityIcon}</span>
      <div>
        <strong>${escapeHtml(activity.type === 'thought' ? '分析任务与上下文' : activity.title || '运行活动')}</strong>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
      </div>
      <small>${escapeHtml(activity.status === 'failed' ? '失败' : activity.status === 'cancelled' || activity.status === 'interrupted' ? '已停止' : activity.status === 'waiting' || activity.status === 'pending' ? '等待' : activity.status === 'running' || activity.status === 'in_progress' ? '进行中' : '完成')}</small>
    </article>
  `;
}

function renderThoughtProgress(activity, detail) {
  const normalized = String(detail || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return activity.status === 'running' ? '模型正在分析任务与上下文。' : '分析已完成。';
  const characters = Array.from(normalized);
  const visibleLimit = 720;
  return characters.length > visibleLimit
    ? `${characters.slice(0, visibleLimit).join('')}\n…`
    : normalized;
}

function renderResponseUsage(message, task) {
  const usage = message.usage || null;
  const modelId = message.modelId || task?.modelId || '';
  const parts = [];
  if (Number.isFinite(usage?.accumulatedOutputTokens)) {
    parts.push(`会话输出 ${formatTokenCount(usage.accumulatedOutputTokens)} tokens`);
  }
  if (Number.isFinite(usage?.accumulatedCost)) {
    parts.push(`累计 $${usage.accumulatedCost.toFixed(4)}`);
  }
  if (modelId) parts.push(modelId);
  if (!parts.length) return '';
  return `<div class="response-usage">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`;
}

function renderPlanItem(item) {
  return `
    <div class="plan-item ${item.status}">
      <span class="plan-check">${item.status === 'completed' ? icon('check') : item.status === 'running' ? '<i></i>' : ''}</span>
      <span>${escapeHtml(item.title)}</span>
    </div>
  `;
}

function renderActivityItem(activity) {
  return `
    <article class="activity-item ${activity.status || ''}">
      <span class="activity-icon">${activity.type === 'tool' ? icon('tool') : activity.type === 'error' ? '!' : '·'}</span>
      <div>
        <strong>${escapeHtml(activity.title || '运行活动')}</strong>
        <p>${escapeHtml(truncate(activity.detail || '', 110))}</p>
        <small>${formatTime(activity.createdAt)}</small>
      </div>
    </article>
  `;
}

function renderPermissionCard(permission) {
  const title = permission.toolCall?.title || permission.toolCall?.name || '高风险工具操作';
  const detail = permission.toolCall?.rawInput
    ? JSON.stringify(permission.toolCall.rawInput, null, 2)
    : permission.toolCall?.kind || '需要用户确认';
  return `
    <article class="permission-card">
      ${permission.teamMemberName ? `<span class="permission-team-member">${icon('users')}${escapeHtml(permission.teamMemberName)}发起</span>` : ''}
      <strong>${escapeHtml(title)}</strong>
      <pre>${escapeHtml(truncate(detail, 240))}</pre>
      <div class="permission-actions">
        <button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="allow_once" class="primary-button compact">允许一次</button>
        ${permission.allowAlways === false ? '' : `<button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="always_allow" class="ghost-button compact">本会话允许</button>`}
        <button data-permission-id="${escapeHtml(permission.id)}" data-permission-action="deny_once" class="danger-text-button">拒绝</button>
      </div>
    </article>
  `;
}

function renderArtifact(artifact) {
  const status = artifactStatusLabel(artifact.status);
  const detail = artifact.metadata?.source === 'office-artifacts'
    ? [artifact.metadata?.selectionEdit ? '原文修改' : artifact.type || '文件', status, artifactSizeLabel(artifact.sizeBytes)].filter(Boolean).join(' · ')
    : artifact.type || '文件';
  return `
    <button class="artifact-item artifact-path-target" ${artifact.path ? `data-open-artifact="${escapeHtml(artifact.path)}" ${artifactPathAttributes(artifact.path || artifact.uri)}` : 'disabled'}>
      <span>${icon('file')}</span>
      <span><strong>${escapeHtml(artifact.name)}</strong><small>${escapeHtml(detail)}</small></span>
    </button>
  `;
}

function renderProjectsView() {
  const projectCount = state.projects.length;
  const taskCount = state.tasks.filter((task) => task.kind !== 'assistant').length;
  const artifactCount = state.tasks.reduce((total, task) => total + (task.artifacts?.length || 0), 0);
  return `
    <div class="content-scroll page-content window-content-full projects-home">
      <section class="projects-intro">
        <div><h2>让每次研判有上下文，让每份成果有来处</h2><p>集中保存工作指令、能力组合、任务资料与成果。</p></div>
        <dl><div><dt>项目</dt><dd>${projectCount}</dd></div><div><dt>任务</dt><dd>${taskCount}</dd></div><div><dt>成果</dt><dd>${artifactCount}</dd></div></dl>
      </section>
      <section class="projects-section">
        <div class="projects-section-heading"><div><h2>我的项目</h2><p>最近使用的本地气象工作空间</p></div>${projectCount ? `<label class="project-search">${icon('search')}<input id="project-search-input" value="${escapeHtml(projectUI.query)}" placeholder="搜索项目" aria-label="搜索项目" /></label>` : ''}</div>
        ${projectCount ? `<div class="project-grid" id="project-grid">${state.projects.map(renderProjectCard).join('')}</div><div class="project-search-empty" id="project-search-empty" hidden>没有匹配的项目</div>` : `<div class="projects-empty-state"><span>${icon('project')}</span><div><h3>创建第一个气象项目</h3><p>定义目标与能力即可创建，工作目录由 MeteoMate 自动管理。</p></div><button class="primary-button" data-action="add-project">新建项目</button></div>`}
      </section>
      <section class="projects-section project-template-section">
        <div class="projects-section-heading"><div><h2>从气象场景创建</h2><p>模板会预填项目指令、专家、技能和工具，你仍可在创建前调整。</p></div></div>
        <div class="project-template-grid">${projectTemplates.map(renderProjectTemplateCard).join('')}</div>
      </section>
    </div>
  `;
}

function renderProjectCard(project) {
  const taskCount = state.tasks.filter((task) => task.projectId === project.id).length;
  const template = projectTemplates.find((entry) => project.spec?.assets?.templates?.includes(entry.id));
  return `
    <article class="project-card ${state.activeProjectId === project.id ? 'active' : ''}" data-project-search-name="${escapeHtml(project.name.toLowerCase())}">
      <button class="project-card-main" data-project-id="${escapeHtml(project.id)}">
        <span class="project-card-icon">${escapeHtml(project.name.slice(0, 1))}</span>
        <span class="project-card-copy"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(template?.name || shortPath(project.workspace))}</small></span>
        <span class="project-card-meta">${taskCount} 个任务 · ${formatDateTime(project.updatedAt)}</span>
        <span class="row-chevron">›</span>
      </button>
      <button class="project-card-more" aria-label="在访达中打开 ${escapeHtml(project.name)}" data-open-project="${escapeHtml(project.workspace)}">${icon('external')}</button>
    </article>
  `;
}

function renderProjectTemplateCard(template) {
  return `<button class="project-template-card" data-project-template="${escapeHtml(template.id)}"><span>${icon('project')}</span><div><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.description)}</small></div><span class="row-chevron">›</span></button>`;
}

function projectCapabilityLabel(type, id) {
  const collection = type === 'experts'
    ? allExperts()
    : type === 'connectors'
      ? userFacingToolCatalog()
      : type === 'skills'
        ? userFacingSkillCatalog()
        : catalog[type] || [];
  return collection.find((item) => item.id === id)?.name || id;
}

function projectInstruction(project) {
  return (project?.spec?.instructions || []).join('\n').trim();
}

function projectCapabilityPickerItems(type) {
  if (type === 'experts') return allExperts().filter((item) => item.id !== primaryAssistant.id);
  if (type === 'skills') {
    const remoteSkills = projectUI.capabilityPicker?.type === 'skills'
      ? projectUI.capabilityPicker.remoteSkills || []
      : [];
    const selectable = window.MeteoMateCapabilityCenter?.projectSelectableSkillCatalog?.(
      remoteSkills,
      projectUI.dialog?.id || null
    );
    return Array.isArray(selectable) ? selectable : enabledSkillCatalog(projectUI.dialog?.id || null);
  }
  return userFacingToolCatalog();
}

function projectCapabilityPickerMeta(type) {
  return {
    experts: {
      title: '选择专家',
      singular: '专家',
      description: '选择负责项目研判、写稿或数据工作的专业角色。',
      icon: 'expert',
      key: 'expertIds',
    },
    skills: {
      title: '添加技能',
      singular: '技能',
      description: '选择项目任务可以主动调用的方法、规范和业务流程。',
      icon: 'skill',
      key: 'skillIds',
    },
    connectors: {
      title: '配置工具',
      singular: '工具',
      description: '先选择工具服务，再细化该项目允许调用的具体工具。',
      icon: 'tool',
      key: 'connectorIds',
    },
  }[type];
}

function projectCapabilitySummary(type, draft) {
  const meta = projectCapabilityPickerMeta(type);
  const items = projectCapabilityPickerItems(type);
  const ids = (draft[meta.key] || []).filter((id) => id !== 'goose-runtime');
  const labels = ids
    .map((id) => items.find((item) => item.id === id)?.name || id)
    .slice(0, 3);
  const toolCount = type === 'connectors'
    ? connectorToolSelectionCount(ids, draft.toolSelections || {}, items)
    : 0;
  const count = type === 'connectors'
    ? `${ids.length} 个服务${toolCount ? ` · ${toolCount} 个工具` : ''}`
    : `${ids.length} 项`;
  const empty = {
    experts: '未选择，任务默认由 MeteoMate 助理处理',
    skills: '未添加，可在任务中继续使用 / 调用',
    connectors: '未配置，项目任务不会调用外部工具',
  }[type];
  return `
    <button type="button" class="project-capability-summary" data-project-capability-open="${escapeHtml(type)}">
      <span class="project-capability-summary-icon">${icon(meta.icon)}</span>
      <span class="project-capability-summary-copy">
        <span><strong>${escapeHtml(meta.singular)}</strong><small>${escapeHtml(count)}</small></span>
        ${labels.length
          ? `<span class="project-capability-summary-tags">${labels.map((label) => `<em>${escapeHtml(label)}</em>`).join('')}${ids.length > labels.length ? `<em>+${ids.length - labels.length}</em>` : ''}</span>`
          : `<span class="project-capability-summary-empty">${escapeHtml(empty)}</span>`}
      </span>
      <span class="project-capability-summary-action">${ids.length ? '调整' : type === 'skills' ? '添加' : '选择'} ${icon('chevron')}</span>
    </button>`;
}

function projectCapabilityDetail(type, item) {
  if (!item) return '<div class="project-capability-picker-empty">选择左侧条目查看介绍</div>';
  if (type === 'experts') {
    return `
      <div class="project-capability-detail-heading"><span>${escapeHtml(item.avatar || item.name.slice(0, 1))}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.category, item.owner].filter(Boolean).join(' · '))}</small></div></div>
      <p>${escapeHtml(item.description || item.mission || '暂无介绍')}</p>
      ${item.mission ? `<section><strong>适合做什么</strong><p>${escapeHtml(item.mission)}</p></section>` : ''}
      ${(item.inputs || []).length ? `<section><strong>需要的资料</strong><div>${item.inputs.map((entry) => `<span>${escapeHtml(entry)}</span>`).join('')}</div></section>` : ''}
      ${(item.outputs || []).length ? `<section><strong>可以产出</strong><div>${item.outputs.map((entry) => `<span>${escapeHtml(entry)}</span>`).join('')}</div></section>` : ''}
      ${(item.tags || []).length ? `<section><strong>能力标签</strong><div>${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></section>` : ''}`;
  }
  const status = {
    'built-in': '内置技能',
    'installed-enabled': '已安装并启用',
    'installed-disabled': '已安装但未启用',
    skillhub: 'SkillHub 可安装',
    bundled: '随应用提供',
    planned: '规划中',
  }[item.status] || item.category || '技能';
  return `
    <div class="project-capability-detail-heading"><span>${escapeHtml(item.icon || item.name.slice(0, 1))}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.category, status].filter(Boolean).join(' · '))}</small></div></div>
    <p>${escapeHtml(item.description || '该技能暂未提供详细介绍')}</p>
    ${(item.tags || []).length ? `<section><strong>适用范围</strong><div>${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></section>` : ''}
    ${item.version ? `<section><strong>版本</strong><p>${escapeHtml(item.version)}</p></section>` : ''}
    ${(item.warnings || []).length ? `<section><strong>使用提示</strong><p>${escapeHtml(item.warnings.join('；'))}</p></section>` : ''}`;
}

function renderProjectCapabilityPicker() {
  const picker = projectUI.capabilityPicker;
  if (!picker) return '';
  const meta = projectCapabilityPickerMeta(picker.type);
  const items = projectCapabilityPickerItems(picker.type);
  const selectedIds = picker[meta.key] || [];
  const activeItem = items.find((item) => item.id === picker.activeId) || items[0];
  const selectedToolCount = picker.type === 'connectors'
    ? connectorToolSelectionCount(picker.connectorIds || [], picker.toolSelections || {}, items)
    : 0;
  const countText = picker.type === 'connectors'
    ? `${selectedIds.length} 个服务 · ${selectedToolCount} 个工具`
    : `已选 ${selectedIds.length} 项`;
  const skillState = picker.type === 'skills'
    ? picker.loading
      ? '<div class="project-capability-picker-notice">正在读取 SkillHub 已发布技能…</div>'
      : picker.error
        ? `<div class="capability-error-block">${escapeHtml(picker.error)}</div>`
        : ''
    : '';
  return `
    <div class="project-capability-picker-backdrop" data-project-capability-close>
      <section class="project-capability-picker ${picker.type === 'connectors' ? 'tools' : ''}" role="dialog" aria-modal="true" aria-labelledby="project-capability-picker-title" data-project-capability-picker-surface>
        <header><div><span>${icon(meta.icon)}</span><div><h3 id="project-capability-picker-title">${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.description)}</p></div></div><button type="button" aria-label="关闭${escapeHtml(meta.title)}" data-project-capability-close>${icon('close')}</button></header>
        <div class="project-capability-picker-toolbar"><label>${icon('search')}<input id="project-capability-picker-search" value="${escapeHtml(picker.query || '')}" placeholder="搜索${escapeHtml(meta.singular)}名称或描述" autocomplete="off" /></label><span id="project-capability-picker-count">${escapeHtml(countText)}</span></div>
        ${skillState}
        ${picker.type === 'connectors'
          ? `<div class="project-capability-tool-picker">${renderConnectorToolSelector({ scope: 'project-picker', connectorIds: picker.connectorIds || [], toolSelections: picker.toolSelections || {}, connectors: items })}</div>`
          : items.length ? `<div class="project-capability-picker-body">
              <div class="project-capability-picker-list" role="listbox" aria-label="${escapeHtml(meta.title)}">
                ${items.map((item) => {
                  const selected = selectedIds.includes(item.id);
                  const searchText = `${item.name} ${item.description || ''} ${item.category || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
                  return `<article class="project-capability-picker-item ${activeItem?.id === item.id ? 'active' : ''} ${selected ? 'selected' : ''}" data-capability-search-text="${escapeHtml(searchText)}">
                    <button type="button" data-project-capability-preview="${escapeHtml(item.id)}" aria-selected="${activeItem?.id === item.id ? 'true' : 'false'}"><span>${escapeHtml(item.avatar || item.icon || item.name.slice(0, 1))}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.category || '')}</small></span></button>
                    <label title="${selected ? '取消选择' : '选择'}${escapeHtml(item.name)}"><input type="checkbox" name="project-picker-items" value="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} /><span>${icon('check')}</span></label>
                  </article>`;
                }).join('')}
                <p class="project-capability-search-empty" hidden>没有匹配的${escapeHtml(meta.singular)}</p>
              </div>
              <aside class="project-capability-picker-detail">${projectCapabilityDetail(picker.type, activeItem)}</aside>
            </div>` : `<div class="project-capability-picker-empty"><strong>${picker.loading ? '正在读取技能' : '还没有可添加的技能'}</strong><p>${picker.loading ? '正在同步 SkillHub 已发布目录。' : 'SkillHub 中暂无可见的已发布技能，本机也没有已启用技能。'}</p></div>`}
        <footer><button type="button" class="secondary-action" data-project-capability-close ${picker.installing ? 'disabled' : ''}>取消</button><button type="button" class="primary-button" id="project-capability-picker-apply" ${picker.loading || picker.installing ? 'disabled' : ''}>${picker.installing ? '安装并添加中…' : '完成'}</button></footer>
      </section>
    </div>`;
}

function renderProjectDetailView() {
  const project = getActiveProject();
  if (!project) return renderProjectsView();
  const tasks = state.tasks
    .filter((task) => task.projectId === project.id && task.kind !== 'assistant')
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const artifacts = tasks.flatMap((task) => task.artifacts || []);
  return `
    <div class="project-detail-layout">
      <main class="project-detail-main">
        <nav class="project-detail-tabs" aria-label="项目内容">
          ${[['overview', '概览'], ['tasks', '任务'], ['assets', '资料']].map(([id, label]) => `<button class="${projectUI.tab === id ? 'active' : ''}" data-project-tab="${id}">${label}</button>`).join('')}
        </nav>
        <div class="project-detail-content">${renderProjectDetailTab(project, tasks, artifacts)}</div>
      </main>
      ${renderProjectConfigPanel(project)}
    </div>
  `;
}

function renderProjectDetailTab(project, tasks, artifacts) {
  if (projectUI.tab === 'tasks') return renderProjectTasks(project, tasks);
  if (projectUI.tab === 'assets') return renderProjectAssets(project, artifacts);
  const running = tasks.filter((task) => task.status === 'running').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  return `
    <section class="project-overview-summary">
      <div><span>项目任务</span><strong>${tasks.length}</strong><small>${running ? `${running} 个执行中` : '当前无执行中任务'}</small></div>
      <div><span>已完成</span><strong>${completed}</strong><small>${tasks.length ? `完成率 ${Math.round((completed / tasks.length) * 100)}%` : '等待第一个任务'}</small></div>
      <div><span>成果物</span><strong>${artifacts.length}</strong><small>保存在项目工作目录</small></div>
    </section>
    <section class="project-activity-section">
      <div class="project-content-heading"><div><h2>最近动态</h2><p>项目任务和成果的最新变化</p></div></div>
      ${tasks.length ? `<div class="project-activity-list">${tasks.slice(0, 8).map((task) => `<button data-task-id="${escapeHtml(task.id)}"><span class="task-status ${task.status || 'draft'}"></span><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.expertName)} · ${taskStatusText(task.status)} · ${formatDateTime(task.updatedAt)}</small></div><span class="row-chevron">›</span></button>`).join('')}</div>` : `<div class="project-tab-empty"><span>${icon('automation')}</span><h3>项目还没有动态</h3><p>从一个明确任务开始，执行记录和成果会自动汇总到这里。</p><button class="primary-button" data-project-new-task="${escapeHtml(project.id)}">新建任务</button></div>`}
    </section>
  `;
}

function renderProjectTasks(project, tasks) {
  return `
    <section>
      <div class="project-content-heading"><div><h2>项目任务</h2><p>这里仅显示属于当前项目的执行记录。</p></div><button class="primary-button small-button" data-project-new-task="${escapeHtml(project.id)}">${icon('plus')} 新建任务</button></div>
      ${tasks.length ? `<div class="project-task-list">${tasks.map((task) => `<button data-task-id="${escapeHtml(task.id)}"><span class="project-task-state ${task.status || 'draft'}">${taskStatusText(task.status)}</span><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.expertName)} · ${formatDateTime(task.updatedAt)}</small></div><span>${task.artifacts?.length || 0} 个成果</span><span class="row-chevron">›</span></button>`).join('')}</div>` : `<div class="project-tab-empty"><span>${icon('assistant')}</span><h3>还没有任务</h3><p>新任务会自动继承项目指令、能力和本地工作目录。</p><button class="primary-button" data-project-new-task="${escapeHtml(project.id)}">新建任务</button></div>`}
    </section>
  `;
}

function knowledgeSourceTypeLabel(source) {
  if (source.type === 'dify') return 'Dify 在线知识库';
  return source.localKind === 'directory' ? '本地资料目录' : '本地文件';
}

function projectKnowledgeSources(project) {
  const sourceIds = new Set(project?.spec?.assets?.knowledgeSources || []);
  return knowledgeCatalog.sources.filter((source) => sourceIds.has(source.id));
}

function knowledgeSourceProjectNames(source) {
  return (source.projectIds || [])
    .map((projectId) => state.projects.find((project) => project.id === projectId)?.name)
    .filter(Boolean);
}

function knowledgeSourceStatus(source) {
  if (source.enabled === false) return { label: '已停用', className: 'disabled' };
  if (source.lastTest?.ok === false) return { label: '连接异常', className: 'failed' };
  if (source.lastTest?.ok) return { label: '可检索', className: 'ready' };
  return { label: source.type === 'local' ? '已接入' : '待测试', className: 'idle' };
}

function renderKnowledgeSourceRow(source, options = {}) {
  const status = knowledgeSourceStatus(source);
  const projects = knowledgeSourceProjectNames(source);
  const detail = source.type === 'dify'
    ? `${source.apiUrl} · Dataset ${source.datasetId}`
    : source.path;
  const localMeta = source.type === 'local'
    ? `${source.fileCount || 0} 个文件，${source.supportedTextFileCount || 0} 个可直接检索`
    : `Top ${source.retrieval?.topK || 5}，阈值 ${source.retrieval?.scoreThreshold ?? 0.25}`;
  return `
    <article class="knowledge-source-row ${source.enabled === false ? 'disabled' : ''}">
      <span class="knowledge-source-mark ${escapeHtml(source.type)}">${source.type === 'dify' ? 'KB' : icon(source.localKind === 'directory' ? 'folder' : 'file')}</span>
      <div class="knowledge-source-main">
        <div><strong>${escapeHtml(source.name)}</strong><span class="knowledge-source-type">${knowledgeSourceTypeLabel(source)}</span></div>
        <small title="${escapeHtml(detail)}">${escapeHtml(detail)}</small>
        <p>${escapeHtml(localMeta)} · ${projects.length ? `用于 ${projects.join('、')}` : '尚未绑定项目'}</p>
      </div>
      <span class="knowledge-source-state ${status.className}"><i></i>${status.label}</span>
      <div class="knowledge-source-actions">
        <button type="button" data-knowledge-test="${escapeHtml(source.id)}">${icon('refresh')} 测试</button>
        <button type="button" data-knowledge-edit="${escapeHtml(source.id)}" data-knowledge-project="${escapeHtml(options.projectId || '')}">管理</button>
        <label class="knowledge-toggle" title="${source.enabled === false ? '启用资料源' : '停用资料源'}"><input type="checkbox" data-knowledge-toggle="${escapeHtml(source.id)}" ${source.enabled === false ? '' : 'checked'} /><span></span></label>
      </div>
    </article>
  `;
}

function renderProjectAssets(project, artifacts) {
  const uniqueArtifacts = [...new Map(artifacts.map((artifact) => [artifact.path || artifact.name, artifact])).values()];
  const sources = projectKnowledgeSources(project);
  const localCount = sources.filter((source) => source.type === 'local').length;
  const onlineCount = sources.filter((source) => source.type === 'dify').length;
  return `
    <section>
      <div class="project-content-heading project-source-heading"><div><h2>项目资料</h2><p>本地文件和在线知识库会在任务开始前自动形成检索上下文。</p></div><div><button class="secondary-action" data-knowledge-import data-knowledge-project="${escapeHtml(project.id)}">${icon('folder')} 添加本地资料</button><button class="primary-button small-button" data-knowledge-add-online data-knowledge-project="${escapeHtml(project.id)}">${icon('plus')} 连接知识库</button></div></div>
      <div class="project-source-summary"><span><strong>${localCount}</strong> 本地资料源</span><span><strong>${onlineCount}</strong> 在线知识库</span><span><strong>${sources.filter((source) => source.enabled !== false).length}</strong> 当前启用</span></div>
      ${knowledgeCatalog.status === 'loading' ? '<div class="knowledge-inline-loading">正在读取资料源…</div>' : ''}
      ${sources.length ? `<div class="project-knowledge-list">${sources.map((source) => renderKnowledgeSourceRow(source, { projectId: project.id })).join('')}</div>` : `<div class="project-tab-empty project-source-empty"><span>${icon('folder')}</span><h3>给项目添加第一份资料</h3><p>可以直接绑定本机文件或目录，也可以连接 Dify Knowledge API。任务会优先检索当前项目启用的资料源。</p><div><button class="secondary-action" data-knowledge-import data-knowledge-project="${escapeHtml(project.id)}">添加本地资料</button><button class="primary-button" data-knowledge-add-online data-knowledge-project="${escapeHtml(project.id)}">连接在线知识库</button></div></div>`}
      <div class="project-content-heading project-workspace-heading"><div><h3>项目工作目录</h3><p>任务文件工具默认从这个目录开始工作</p></div><button class="secondary-action" data-open-project="${escapeHtml(project.workspace)}">${icon('external')} 在访达中打开</button></div>
      <button class="project-workspace-card" data-open-project="${escapeHtml(project.workspace)}"><span>${icon('folder')}</span><div><strong>${escapeHtml(pathBaseName(project.workspace) || project.name)}</strong><small>${escapeHtml(project.workspace)}</small></div><span class="row-chevron">›</span></button>
      <div class="project-content-heading project-artifact-heading"><div><h3>任务成果</h3><p>由项目任务生成并登记的文件</p></div><span>${uniqueArtifacts.length} 项</span></div>
      ${uniqueArtifacts.length ? `<div class="project-artifact-grid">${uniqueArtifacts.map(renderArtifact).join('')}</div>` : `<div class="project-tab-empty compact"><span>${icon('file')}</span><h3>还没有登记的成果</h3><p>任务生成文件后会出现在这里，本地目录中的其他文件仍可通过访达查看。</p></div>`}
    </section>
  `;
}

function renderProjectConfigPanel(project) {
  const capabilities = project.spec?.capabilities || {};
  const activeSkillIds = enabledSkillIds(capabilities.skills || [], project.id);
  const selectedToolCount = connectorToolSelectionCount(
    (capabilities.connectors || []).filter((id) => id !== 'goose-runtime'),
    capabilities.toolSelections || {}
  );
  const groups = [
    ['experts', '专家', capabilities.experts || []],
    ['skills', '技能', activeSkillIds],
    ['connectors', '工具', (capabilities.connectors || []).filter((id) => id !== 'goose-runtime')],
  ];
  return `
    <aside class="project-config-panel">
      <div class="project-config-heading"><div><span class="project-config-mark">${escapeHtml(project.name.slice(0, 1))}</span><div><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></div></div><button aria-label="编辑项目" data-edit-project="${escapeHtml(project.id)}">${icon('more')}</button></div>
      <section class="project-config-section"><div><strong>项目指令</strong><button data-edit-project="${escapeHtml(project.id)}">编辑</button></div><p>${escapeHtml(projectInstruction(project) || '未设置项目指令。任务将仅使用专家自身指令。')}</p></section>
      ${groups.map(([type, label, ids]) => `<section class="project-config-section"><div><strong>${label}</strong><span>${type === 'connectors' && selectedToolCount ? `${ids.length} 个服务 · ${selectedToolCount} 个工具` : ids.length}</span></div>${ids.length ? `<div class="project-config-chips">${ids.slice(0, 5).map((id) => `<span>${escapeHtml(projectCapabilityLabel(type, id))}</span>`).join('')}</div>` : `<p>未配置${label}</p>`}</section>`).join('')}
      <section class="project-config-section"><div><strong>资料源</strong><button data-project-tab="assets">管理</button></div>${projectKnowledgeSources(project).length ? `<div class="project-config-chips">${projectKnowledgeSources(project).slice(0, 4).map((source) => `<span>${escapeHtml(source.name)}</span>`).join('')}</div>` : '<p>未接入本地资料或在线知识库</p>'}</section>
      <section class="project-config-section project-workspace-config"><div><strong>本地工作目录</strong><button data-open-project="${escapeHtml(project.workspace)}">打开</button></div><code>${escapeHtml(project.workspace)}</code></section>
      <button class="project-config-edit" data-edit-project="${escapeHtml(project.id)}">编辑项目配置</button>
    </aside>
  `;
}

function renderProjectDialog() {
  const draft = projectUI.dialog;
  const editing = Boolean(draft.id);
  const workspaceMode = editing ? 'existing' : draft.workspaceMode || 'managed';
  const managedRoot = projectUI.managedWorkspaceRoot || '文稿/MeteoMate/Projects';
  return `
    <div class="project-dialog-backdrop" data-project-dialog-close>
      <form class="project-dialog" id="project-dialog-form" novalidate data-project-dialog-surface>
        <header><div><h2>${editing ? '编辑项目' : '新建项目'}</h2><p>${editing ? '更新项目指令和默认能力，不会移动本地目录。' : '定义项目上下文，MeteoMate 会自动准备本地工作目录。'}</p></div><button type="button" aria-label="关闭" data-project-dialog-close>×</button></header>
        <div class="project-dialog-body">
          ${projectUI.error ? `<div class="project-dialog-error" role="alert">${escapeHtml(projectUI.error)}</div>` : ''}
          <label class="project-dialog-field"><span>项目名称</span><input id="project-name-input" value="${escapeHtml(draft.name || '')}" placeholder="例如：7·18 强降水过程复盘" required maxlength="80" /></label>
          <div class="project-dialog-field"><span>项目模板 <em>可选</em></span><div class="project-dialog-templates"><button type="button" class="${draft.templateId ? '' : 'active'}" data-dialog-template="">空白项目</button>${projectTemplates.map((template) => `<button type="button" class="${draft.templateId === template.id ? 'active' : ''}" data-dialog-template="${escapeHtml(template.id)}">${escapeHtml(template.name)}</button>`).join('')}</div></div>
          <label class="project-dialog-field"><span>项目指令</span><textarea id="project-instruction-input" rows="5" placeholder="说明项目目标、资料约束、输出要求和复核规则">${escapeHtml(draft.instruction || '')}</textarea><small>项目中的每个新任务都会带上这段上下文。</small></label>
          <div class="project-dialog-field project-capability-field">
            <span>项目能力</span>
            <div class="project-capability-summary-list">
              ${projectCapabilitySummary('experts', draft)}
              ${projectCapabilitySummary('skills', draft)}
              ${projectCapabilitySummary('connectors', draft)}
            </div>
            <small>项目任务默认继承这些能力，也可以在单个任务中继续调整。</small>
          </div>
          ${editing ? `<div class="project-dialog-workspace"><span>${icon('folder')}</span><div><strong>本地工作目录</strong><small>${escapeHtml(draft.workspace)}</small></div></div>` : `
            <div class="project-dialog-field project-location-field">
              <span>存储位置</span>
              <div class="project-location-options" role="radiogroup" aria-label="项目存储位置">
                <label class="project-location-option ${workspaceMode === 'managed' ? 'active' : ''}">
                  <input type="radio" name="project-workspace-mode" value="managed" ${workspaceMode === 'managed' ? 'checked' : ''} />
                  <span class="project-location-icon">${icon('project')}</span>
                  <span><strong>MeteoMate 项目目录 <em>推荐</em></strong><small>自动创建文件夹，不再弹出系统目录选择器</small></span>
                  ${workspaceMode === 'managed' ? icon('check') : ''}
                </label>
                <label class="project-location-option ${workspaceMode === 'existing' ? 'active' : ''}">
                  <input type="radio" name="project-workspace-mode" value="existing" ${workspaceMode === 'existing' ? 'checked' : ''} />
                  <span class="project-location-icon">${icon('folder')}</span>
                  <span><strong>使用已有目录</strong><small>保留目录里的现有文件，适合已有气象资料或代码</small></span>
                  ${workspaceMode === 'existing' ? icon('check') : ''}
                </label>
              </div>
              <div class="project-managed-location" id="project-managed-location" ${workspaceMode === 'managed' ? '' : 'hidden'}><span>${icon('folder')}</span><div><strong>基础目录</strong><small>${escapeHtml(managedRoot)}</small></div></div>
              <div class="project-existing-location" id="project-existing-location" ${workspaceMode === 'existing' ? '' : 'hidden'}><span>${icon('folder')}</span><div><strong>${draft.workspace ? escapeHtml(pathBaseName(draft.workspace)) : '尚未选择目录'}</strong><small>${draft.workspace ? escapeHtml(draft.workspace) : '只在使用已有目录时需要选择一次'}</small></div><button type="button" class="secondary-action" id="project-choose-existing">${draft.workspace ? '重新选择' : '选择目录'}</button></div>
            </div>`}
        </div>
        <footer><span id="project-dialog-location-note">${editing ? '任务将在下次运行时使用新配置。' : workspaceMode === 'managed' ? '项目文件夹将自动创建在 MeteoMate 项目目录。' : '使用已有目录，不会移动或复制其中的文件。'}</span><div><button class="secondary-action" type="button" data-project-dialog-close>取消</button><button class="primary-button" type="submit">${editing ? '保存项目' : '创建项目'}</button></div></footer>
      </form>
      ${renderProjectCapabilityPicker()}
    </div>
  `;
}

function renderAutomationView() {
  if (automationUI.editor) return renderAutomationEditor();
  const automations = (state.automations || []).slice().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const runs = (state.automationRuns || []).slice().sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0));
  return `
    <div class="content-scroll window-content-full automation-home">
      <nav class="automation-tabs" aria-label="自动化内容">
        <button class="${automationUI.tab === 'schedules' ? 'active' : ''}" data-automation-tab="schedules">定时任务 <span>${automations.length}</span></button>
        <button class="${automationUI.tab === 'runs' ? 'active' : ''}" data-automation-tab="runs">运行记录 <span>${runs.length}</span></button>
      </nav>
      ${automationUI.tab === 'runs' ? renderAutomationRuns(runs) : renderAutomationSchedules(automations)}
    </div>
  `;
}

function renderAutomationSchedules(automations) {
  const enabled = automations.filter((automation) => automation.enabled).length;
  return `
    <div class="automation-content">
      ${automations.length
        ? `<section class="automation-schedule-section">
            <div class="automation-section-heading"><div><h2>定时任务</h2><p>${enabled} 个已启用，任务仅在 MeteoMate 打开时由本机调度。</p></div></div>
            <div class="automation-schedule-list">${automations.map(renderAutomationScheduleRow).join('')}</div>
          </section>`
        : `<section class="automation-empty-state"><span>${icon('automation')}</span><h2>开启第一个气象自动化</h2><p>选择一个项目和任务模板，MeteoMate 会在本机按计划创建任务并保留运行记录。</p><button class="primary-button" data-automation-create>${icon('plus')} 添加自动化</button></section>`}
      <section class="automation-template-section">
        <div class="automation-section-heading"><div><h2>气象自动化模板</h2><p>模板会预填提示词、专家、能力与执行频率，保存前仍可调整。</p></div></div>
        <div class="automation-template-grid">${automationTemplates.map(renderAutomationTemplate).join('')}</div>
      </section>
    </div>
  `;
}

function renderAutomationScheduleRow(automation) {
  const project = state.projects.find((item) => item.id === automation.projectId);
  const workflow = automation.workflowRef
    ? (state.workflowVersions || []).find((item) =>
        item.metadata?.id === automation.workflowRef.id
        && item.metadata?.version === automation.workflowRef.version
      )
    : null;
  const nextRun = automation.enabled && automation.nextRunAt
    ? `下次 ${formatDateTime(automation.nextRunAt)}`
    : automation.enabled
      ? '等待有效执行时间'
      : '已暂停';
  const running = (state.automationRuns || []).some((run) => run.automationId === automation.id && run.status === 'running');
  return `
    <article class="automation-schedule-row ${automation.enabled ? '' : 'paused'}">
      <label class="automation-toggle" title="${automation.enabled ? '暂停自动化' : '启用自动化'}"><input type="checkbox" data-automation-toggle="${escapeHtml(automation.id)}" ${automation.enabled ? 'checked' : ''} /><span></span></label>
      <span class="automation-row-mark">${escapeHtml(automation.name.slice(0, 1))}</span>
      <button class="automation-row-main" data-automation-edit="${escapeHtml(automation.id)}">
        <strong>${escapeHtml(automation.name)}</strong>
        <small>${escapeHtml(window.MeteoMateHarness.Automation.scheduleLabel(automation))} · ${escapeHtml(project?.name || '项目已移除')}${workflow ? ` · ${escapeHtml(workflow.metadata.name)}` : ''}</small>
      </button>
      <div class="automation-row-time"><strong>${running ? '执行中' : nextRun}</strong><small>${automation.lastRunAt ? `上次 ${formatDateTime(automation.lastRunAt)}` : '尚未运行'}</small></div>
      <button class="automation-run-button" data-automation-run="${escapeHtml(automation.id)}" ${running ? 'disabled' : ''}>${icon('play')} ${running ? '执行中' : '立即运行'}</button>
      <button class="automation-edit-button" aria-label="编辑 ${escapeHtml(automation.name)}" data-automation-edit="${escapeHtml(automation.id)}">${icon('more')}</button>
    </article>
  `;
}

function renderAutomationTemplate(template) {
  return `
    <button class="automation-template-card" data-automation-template="${escapeHtml(template.id)}">
      <span>${escapeHtml(template.mark)}</span>
      <div><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.description)}</small></div>
      <span class="row-chevron">›</span>
    </button>
  `;
}

function automationRunStatusText(status) {
  return { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已停止' }[status] || '等待执行';
}

function renderAutomationRuns(runs) {
  return `
    <div class="automation-content">
      <section class="automation-run-section">
        <div class="automation-section-heading"><div><h2>运行记录</h2><p>每次自动执行都会创建普通任务，可进入任务查看完整过程和成果物。</p></div></div>
        ${runs.length
          ? `<div class="automation-run-list">${runs.map((run) => {
              const automation = (state.automations || []).find((item) => item.id === run.automationId);
              const task = state.tasks.find((item) => item.id === run.taskId);
              const project = state.projects.find((item) => item.id === run.projectId);
              return `<button data-task-id="${escapeHtml(run.taskId || '')}" ${task ? '' : 'disabled'}><span class="automation-run-status ${escapeHtml(run.status)}"></span><div><strong>${escapeHtml(automation?.name || run.automationName || '已删除的自动化')}</strong><small>${escapeHtml(project?.name || '项目已移除')} · ${run.source === 'manual' ? '手动运行' : '按计划运行'} · ${formatDateTime(run.startedAt)}</small></div><span class="automation-run-badge ${escapeHtml(run.status)}">${automationRunStatusText(run.status)}</span><span class="row-chevron">›</span></button>`;
            }).join('')}</div>`
          : `<div class="automation-runs-empty"><span>${icon('automation')}</span><h3>暂无运行记录</h3><p>立即运行自动化，或等待下一个计划时间。</p><button class="secondary-action" data-automation-tab="schedules">查看定时任务</button></div>`}
      </section>
    </div>
  `;
}

function automationModelOptions(draft) {
  const options = ['<option value="">使用全局默认模型</option>'];
  for (const provider of modelSettings.providers || []) {
    for (const model of provider.models || []) {
      const value = `${provider.id}::${model.id}`;
      const selected = draft.providerId === provider.id && draft.modelId === model.id;
      options.push(`<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(provider.name)} · ${escapeHtml(model.name || model.id)}</option>`);
    }
  }
  return options.join('');
}

function publishedAutomationWorkflowOptions() {
  const options = new Map();
  for (const workflow of [...(state.workflowVersions || []), ...(state.workflows || [])]) {
    if (workflow?.metadata?.status !== 'published') continue;
    if ((workflow.spec?.nodes || []).some((node) =>
      node?.type === 'expert' || node?.capability?.kind === 'Expert'
    )) continue;
    const reference = `${workflow.metadata.id}@${workflow.metadata.version}`;
    if (!options.has(reference)) options.set(reference, workflow);
  }
  return [...options.entries()].sort((left, right) =>
    String(left[1].metadata.name).localeCompare(String(right[1].metadata.name), 'zh-CN')
  );
}

function dateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderAutomationEditor() {
  const draft = automationUI.editor;
  const editing = Boolean(draft.id);
  const selected = (type, id) => (draft[type] || []).includes(id);
  const availableSkills = enabledSkillCatalog(draft.projectId || null);
  const weekdays = [['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['0', '周日']];
  const project = state.projects.find((item) => item.id === draft.projectId);
  const inheritProjectTools = draft.capabilityMode !== 'pinned';
  const projectCapabilities = project?.spec?.capabilities || {};
  const publishedWorkflows = publishedAutomationWorkflowOptions();
  const connectorIds = inheritProjectTools
    ? [...(projectCapabilities.connectors || [])]
    : [...(draft.connectorIds || [])];
  const toolSelections = inheritProjectTools
    ? normalizeToolSelections(projectCapabilities.toolSelections, connectorIds)
    : normalizeToolSelections(draft.toolSelections, connectorIds);
  return `
    <div class="content-scroll window-content-full automation-editor-scroll">
      <form class="automation-editor-form" id="automation-editor-form" novalidate>
        <section class="automation-editor-intro"><span>${icon('automation')}</span><div><h1>${editing ? '编辑自动化' : '添加自动化任务'}</h1><p>任务会继承所选项目的目录、指令和能力。高风险操作仍需在对应任务中审批。</p></div></section>
        ${automationUI.error ? `<div class="automation-editor-error" role="alert">${escapeHtml(automationUI.error)}</div>` : ''}
        ${state.projects.length ? '' : `<div class="automation-project-required"><strong>请先创建项目</strong><p>自动化必须绑定一个项目，才能确定本地目录和业务上下文。</p><button type="button" class="secondary-action" data-nav="projects">前往项目</button></div>`}
        <label class="automation-field"><span>名称</span><input id="automation-name" value="${escapeHtml(draft.name || '')}" maxlength="80" placeholder="例如：每日 07:30 天气形势摘要" required /></label>
        <label class="automation-field"><span>项目</span><select id="automation-project" required><option value="">选择项目</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${draft.projectId === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}</select><small>自动化创建的任务和成果物会归入这个项目。</small></label>
        <label class="automation-field automation-prompt-field"><span>任务提示词</span><textarea id="automation-prompt" rows="7" placeholder="说明每次运行需要读取什么、判断什么、输出什么" required>${escapeHtml(draft.prompt || '')}</textarea><small>建议明确资料时次、区域、输出格式和无法获取资料时的处理方式。</small></label>
        <section class="automation-runtime-config">
          <label><span>默认专家</span><select id="automation-expert">${allExperts().filter((item) => item.id !== primaryAssistant.id).map((expert) => `<option value="${escapeHtml(expert.id)}" ${draft.expertId === expert.id ? 'selected' : ''}>${escapeHtml(expert.name)}</option>`).join('')}</select></label>
          <label><span>模型</span><select id="automation-model">${automationModelOptions(draft)}</select></label>
          <label><span>权限策略</span><select id="automation-permission">${allowedPermissionProfiles().map((profile) => `<option value="${escapeHtml(profile.id)}" ${draft.permissionProfileId === profile.id ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}</select></label>
        </section>
        <section class="automation-capabilities">
          <details class="automation-workflow-capability" ${draft.workflowRef ? 'open' : ''}><summary><span>工作流</span><small>${draft.workflowRef ? '已固定发布版本' : '可选'}</small></summary><div><label><span>绑定工作流</span><select id="automation-workflow"><option value="">不绑定，继续执行普通专家任务</option>${publishedWorkflows.map(([reference, workflow]) => `<option value="${escapeHtml(reference)}" ${draft.workflowRef === reference ? 'selected' : ''}>${escapeHtml(workflow.metadata.name)} · v${escapeHtml(workflow.metadata.version)}</option>`).join('')}</select><small>绑定后，定时任务会把该版本作为执行契约加载；审批和权限策略仍然生效。</small></label>${publishedWorkflows.length ? '' : '<p class="capability-muted">还没有已发布工作流，请先在工作流中心完成发布。</p>'}</div></details>
          <details><summary><span>技能</span><small>已选 ${(draft.skillIds || []).length}</small></summary><div>${availableSkills.length ? availableSkills.map((item) => `<label><input type="checkbox" name="automation-skills" value="${escapeHtml(item.id)}" ${selected('skillIds', item.id) ? 'checked' : ''} /><span>${escapeHtml(item.name)}</span></label>`).join('') : '<p class="capability-muted">没有已安装并启用的技能。</p>'}</div></details>
          <details class="automation-tool-capabilities"><summary><span>工具</span><small>${inheritProjectTools ? '继承项目' : '固定授权'} · ${connectorIds.filter((id) => id !== 'goose-runtime').length} 个服务 · ${connectorToolSelectionCount(connectorIds, toolSelections)} 个工具</small></summary><div><label class="automation-capability-mode"><span><strong>工具策略</strong><small>继承项目会自动跟随项目授权；固定授权保留当前选择。</small></span><select id="automation-capability-mode"><option value="inherit" ${inheritProjectTools ? 'selected' : ''}>继承项目</option><option value="pinned" ${inheritProjectTools ? '' : 'selected'}>固定授权</option></select></label><fieldset ${inheritProjectTools ? 'disabled' : ''}>${renderConnectorToolSelector({ scope: 'automation', connectorIds, toolSelections })}</fieldset></div></details>
        </section>
        <fieldset class="automation-schedule-config">
          <legend>执行频率</legend>
          <div class="automation-schedule-modes">${[['recurring', '周期'], ['interval', '按间隔'], ['once', '单次']].map(([mode, label]) => `<button type="button" class="${draft.mode === mode ? 'active' : ''}" data-automation-mode="${mode}">${label}</button>`).join('')}</div>
          ${draft.mode === 'interval'
            ? `<div class="automation-interval-fields"><span>每</span><input id="automation-interval-value" type="number" min="1" max="999" value="${escapeHtml(draft.intervalValue || 3)}" /><select id="automation-interval-unit"><option value="minutes" ${draft.intervalUnit === 'minutes' ? 'selected' : ''}>分钟</option><option value="hours" ${draft.intervalUnit === 'hours' ? 'selected' : ''}>小时</option><option value="days" ${draft.intervalUnit === 'days' ? 'selected' : ''}>天</option></select></div>`
            : draft.mode === 'once'
              ? `<label class="automation-once-field"><span>执行时间</span><input id="automation-run-at" type="datetime-local" value="${escapeHtml(dateTimeLocalValue(draft.runAt))}" /></label>`
              : `<div class="automation-recurring-fields"><label><span>周期</span><select id="automation-cadence"><option value="daily" ${draft.cadence === 'daily' ? 'selected' : ''}>每天</option><option value="workdays" ${draft.cadence === 'workdays' ? 'selected' : ''}>工作日</option><option value="weekly" ${draft.cadence === 'weekly' ? 'selected' : ''}>每周</option></select></label><label><span>时间</span><input id="automation-time" type="time" value="${escapeHtml(draft.time || '08:00')}" /></label></div>
                ${draft.cadence === 'weekly' ? `<div class="automation-weekdays">${weekdays.map(([day, label]) => `<label><input type="checkbox" name="automation-weekdays" value="${day}" ${(draft.weekdays || []).map(String).includes(day) ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div>` : ''}`}
        </fieldset>
        <label class="automation-enable-row"><span><strong>保存后启用</strong><small>启用后，MeteoMate 在本机打开期间检查执行时间。</small></span><input id="automation-enabled" type="checkbox" ${draft.enabled !== false ? 'checked' : ''} /></label>
        <section class="automation-local-note"><span>${icon('shield')}</span><div><strong>本机执行边界</strong><p>执行时间使用本机系统时区。自动化不会绕过审批策略，也不会在 MeteoMate 完全退出后后台运行。需要无人值守服务时，应接入后续 Remote Worker。</p></div></section>
      </form>
    </div>
  `;
}

function renderAssistantsView() {
  return renderTaskView({ assistantMode: true });
}

function renderAccountSettingsPage() {
  const section = settingsSections[settingsDialog.section] || settingsSections.general;
  const panels = {
    general: renderGeneralSettings(),
    personalization: renderPersonalizationSettings(),
    context: renderContextSettings(),
    permissions: renderPermissionSettings(),
    models: renderModelSettings(),
    account: renderAccountServiceSettings(),
  };
  const navButton = (id) => {
    const item = settingsSections[id];
    const active = settingsDialog.section === id;
    return `<button class="${active ? 'active' : ''}" data-settings-section="${id}" aria-current="${active ? 'page' : 'false'}">${icon(item.icon)}<span>${item.title}</span></button>`;
  };
  return `
    <div class="settings-page-shell">
      <aside class="settings-page-nav" aria-label="设置导航">
        <button class="settings-return-button" type="button" data-settings-close aria-label="返回应用" title="返回应用">${icon('back')}<span>返回应用</span></button>
        <div class="settings-page-brand">
          <img src="assets/icons/meteomate.png" alt="" />
          <div><strong>设置</strong><small>MeteoMate</small></div>
        </div>
        <span class="settings-nav-group">工作方式</span>
        <nav aria-label="工作方式设置">
          ${navButton('general')}
          ${navButton('personalization')}
          ${navButton('context')}
          ${navButton('permissions')}
        </nav>
        <span class="settings-nav-group settings-nav-group-spaced">服务</span>
        <nav aria-label="服务设置">
          ${navButton('models')}
          ${navButton('account')}
        </nav>
      </aside>
      <main class="settings-page-workspace" aria-labelledby="settings-page-title">
        <header class="settings-page-header">
          <h1 id="settings-page-title" data-settings-page-title>${section.title}</h1>
          <p data-settings-page-description>${section.description}</p>
        </header>
        <div class="settings-page-body">
          ${Object.entries(panels).map(([id, panel]) => `<div data-settings-panel="${id}" ${settingsDialog.section === id ? '' : 'hidden'}>${panel}</div>`).join('')}
        </div>
      </main>
    </div>
  `;
}

function renderDesktopSettingsFeedback() {
  if (desktopSettings.error) return `<div class="settings-inline-feedback error">${escapeHtml(desktopSettings.error)}</div>`;
  if (desktopSettings.message) return `<div class="settings-inline-feedback success">${escapeHtml(desktopSettings.message)}</div>`;
  return '';
}

function renderSettingsToggle(key, title, description, checked) {
  return `
    <label class="settings-preference-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <span class="settings-switch"><input type="checkbox" data-desktop-setting="${escapeHtml(key)}" ${checked ? 'checked' : ''} /><i></i></span>
    </label>`;
}

function renderGeneralSettings() {
  const preferences = desktopSettings.preferences;
  return `
    <div class="general-settings-stack settings-preference-stack">
      ${renderDesktopSettingsFeedback()}
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>对话交互</h2><p>只调整界面反馈和发送方式，不改变任务内容。</p></div></div>
        <div class="settings-preference-list">
          ${renderSettingsToggle('sendOnEnter', 'Enter 发送消息', '关闭后使用 Command 或 Ctrl + Enter 发送，Enter 用于换行。', preferences.sendOnEnter)}
          ${renderSettingsToggle('showExecutionProcess', '显示思考与执行过程', '展示可核验的分析摘要、计划和工具调用活动。', preferences.showExecutionProcess)}
          ${renderSettingsToggle('showContextMeter', '显示上下文状态', '在输入框中显示当前上下文占用和自动压缩状态。', preferences.showContextMeter)}
        </div>
      </section>
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>本地工作目录</h2><p>MeteoMate 将助理资料和新建项目分别保存在这些位置。</p></div></div>
        <div class="settings-path-list">
          <div><span>${icon('assistant')}<span><strong>助理工作区</strong><small title="${escapeHtml(desktopSettings.assistantWorkspace)}">${escapeHtml(shortPath(desktopSettings.assistantWorkspace) || '读取中')}</small></span></span><button type="button" data-open-settings-workspace="assistant" ${desktopSettings.assistantWorkspace ? '' : 'disabled'}>打开</button></div>
          <div><span>${icon('project')}<span><strong>项目基础目录</strong><small title="${escapeHtml(desktopSettings.projectWorkspace)}">${escapeHtml(shortPath(desktopSettings.projectWorkspace) || '读取中')}</small></span></span><button type="button" data-open-settings-workspace="project" ${desktopSettings.projectWorkspace ? '' : 'disabled'}>打开</button></div>
        </div>
      </section>
    </div>
  `;
}

function memoryGloballyEnabled() {
  return desktopSettings.preferences.memoryEnabled === true;
}

function renderPersonalizationSettings() {
  const enabled = memoryGloballyEnabled();
  return `
    <div class="general-settings-stack settings-preference-stack">
      ${renderDesktopSettingsFeedback()}
      <section class="settings-personalization-intro">
        <h2>记忆</h2>
        <p>MeteoMate 第一版只使用你明确保存的偏好、决定和工作背景，不会自动学习完整对话。</p>
      </section>
      <section class="settings-section-block settings-memory-preference-block">
        <div class="settings-preference-list settings-memory-preference-list">
          ${renderSettingsToggle('memoryEnabled', '启用记忆', '在新对话中参考已保存的个人与项目记忆，并允许从消息手动保存。', enabled)}
        </div>
        <div class="settings-memory-manage-row">
          <span><strong>管理记忆</strong><small>查看、编辑或删除已保存的记忆。关闭记忆不会删除已有内容。</small></span>
          <button class="settings-text-action" type="button" data-settings-manage-memory>管理</button>
        </div>
      </section>
    </div>`;
}

function renderContextSettings() {
  const policy = effectiveOrganizationPolicy();
  const managed = Number(policy.autoCompactThreshold || 0);
  const threshold = managed || desktopSettings.preferences.autoCompactThreshold;
  const localSources = knowledgeCatalog.sources.filter((source) => source.type === 'local');
  const onlineSources = knowledgeCatalog.sources.filter((source) => source.type !== 'local');
  const enabledSources = knowledgeCatalog.sources.filter((source) => source.enabled !== false);
  return `
    <div class="general-settings-stack settings-preference-stack">
      ${renderDesktopSettingsFeedback()}
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>上下文窗口</h2><p>接近模型上限时自动压缩较早内容，保留任务目标、关键结论和最近消息。</p></div><span class="settings-value-badge" data-threshold-value>${Math.round(threshold * 100)}%</span></div>
        <label class="settings-range-row ${managed ? 'managed' : ''}">
          <input type="range" min="50" max="95" step="1" value="${Math.round(threshold * 100)}" data-desktop-setting="autoCompactThreshold" ${managed ? 'disabled' : ''} />
          <span><small>更早压缩</small><small>保留更多上下文</small></span>
        </label>
        <p class="settings-managed-note">${managed ? `当前阈值由组织策略锁定为 ${Math.round(managed * 100)}%。` : '推荐保持 70% 至 80%，给工具返回和模型输出留出余量。'}</p>
      </section>
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>气象资料接入</h2><p>本地文件保留在原位置，在线知识库只保存连接和检索配置。</p></div><button class="settings-text-action" type="button" data-settings-navigate="knowledge">管理资料库</button></div>
        <div class="settings-stat-grid">
          <div><strong>${localSources.length}</strong><span>本地资料源</span></div>
          <div><strong>${onlineSources.length}</strong><span>在线知识库</span></div>
          <div><strong>${enabledSources.length}</strong><span>当前已启用</span></div>
        </div>
        <div class="settings-boundary-note">${icon('shield')}<span><strong>检索边界</strong><small>任务只检索已启用并绑定到当前项目的资料源。</small></span></div>
      </section>
    </div>`;
}

function renderPermissionSettings() {
  const policy = effectiveOrganizationPolicy();
  const managedDefault = policy.defaultPermissionProfileId || '';
  const selected = managedDefault || desktopSettings.preferences.defaultPermissionProfileId || '';
  return `
    <div class="general-settings-stack settings-preference-stack">
      ${renderDesktopSettingsFeedback()}
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>默认审批策略</h2><p>用于新建任务。任务输入框内仍可为当前会话单独调整。</p></div>${managedDefault ? '<span class="capability-status ready">组织管理</span>' : ''}</div>
        <label class="settings-select-row">
          <span><strong>新任务默认值</strong><small>${managedDefault ? '当前由组织策略统一设置' : '推荐跟随专家和任务场景，由场景选择合适的安全边界。'}</small></span>
          <select data-desktop-setting="defaultPermissionProfileId" ${managedDefault ? 'disabled' : ''}>
            <option value="" ${selected ? '' : 'selected'}>跟随专家与任务</option>
            ${allowedPermissionProfiles().map((profile) => `<option value="${escapeHtml(profile.id)}" ${selected === profile.id ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}
          </select>
        </label>
        <div class="settings-permission-summary">
          ${allowedPermissionProfiles().map((profile) => `<div class="${selected === profile.id ? 'selected' : ''}"><span>${icon(profile.icon || 'shield')}</span><span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.status)}</small></span></div>`).join('')}
        </div>
      </section>
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>审批记忆与远程工具</h2><p>降低重复确认，同时保留高风险操作的明确边界。</p></div></div>
        <div class="settings-fact-list">
          <div>${icon('check')}<span><strong>本会话允许</strong><small>同一任务、同一工具和相同操作范围不再重复询问。</small></span></div>
          <div>${icon('tool')}<span><strong>可信 HTTP 工具</strong><small>已明确选择的只读远程工具可自动允许，写入和敏感操作仍按风险判断。</small></span></div>
          <div>${icon('warning')}<span><strong>完全访问</strong><small>可访问互联网、本机文件并自动执行已允许的桌面操作，仅建议在边界明确的任务中使用。</small></span></div>
        </div>
      </section>
    </div>`;
}

function renderAccountServiceSettings() {
  const user = accountSession.user || {};
  const policy = effectiveOrganizationPolicy();
  const displayName = user.displayName || user.username || 'MeteoMate 用户';
  const skillHub = window.MeteoMateCapabilityCenter?.skillHub?.state;
  const connected = skillHub?.status === 'ready';
  const runtimeReady = state.runtime?.state === 'ready';
  const organizationCatalog = accountSession.policyContext?.modelCatalog || { revision: 0, providers: [] };
  const organizationModelCount = organizationCatalog.providers.reduce((total, provider) => total + (provider.models?.length || 0), 0);
  return `
    <div class="general-settings-stack settings-preference-stack">
      <section class="settings-section-block account-settings-profile">
        <span class="sidebar-account-avatar">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</span>
        <div><h2>${escapeHtml(displayName)}</h2><p>${escapeHtml(user.username || '本机账户')} · ${accountSession.status === 'offline' ? '离线模式' : accountRoleLabel(user.role)}</p></div>
        <span class="capability-status ${accountSession.status === 'offline' ? 'idle' : 'ready'}">${accountSession.status === 'offline' ? '离线' : '已登录'}</span>
      </section>
      <section class="settings-section-block">
        <div class="settings-block-heading"><div><h2>组织与能力服务</h2><p>账户策略、SkillHub 和能力目录共同决定当前可用范围。</p></div></div>
        <dl class="general-settings-list">
          <div><dt>本地执行服务</dt><dd class="settings-service-state ${runtimeReady ? 'ready' : ''}"><i></i>${runtimeReady ? '可用' : state.runtime?.state === 'starting' ? '启动中' : '受限模式'}</dd></div>
          <div><dt>SkillHub</dt><dd class="settings-service-state ${connected ? 'ready' : ''}"><i></i>${connected ? '已连接' : accountSession.status === 'offline' ? '离线不可用' : '未连接'}</dd></div>
          <div><dt>策略版本</dt><dd>r${Number(policy.revision || 0)}</dd></div>
          <div><dt>模型目录</dt><dd>r${Number(organizationCatalog.revision || 0)} · ${organizationModelCount} 个模型</dd></div>
          <div><dt>可用模型</dt><dd>${policy.allowedModels?.length ? `${policy.allowedModels.length} 个` : '不限制'}</dd></div>
          <div><dt>可用审批策略</dt><dd>${policy.allowedPermissionProfileIds?.length ? `${policy.allowedPermissionProfileIds.length} 种` : '不限制'}</dd></div>
        </dl>
      </section>
      <section class="settings-section-block product-settings-row">
        <img src="assets/icons/meteomate.png" alt="" />
        <div><h2>${brand.chineseName} ${brand.name}</h2><p>${brand.tagline}</p><small>${escapeHtml(brand.version)} · 本地优先的气象智能工作空间</small></div>
      </section>
    </div>`;
}

function selectedSettingsProvider() {
  const selectedId = settingsDialog.selectedProviderId || modelSettings.providerId;
  return modelSettings.providers.find((provider) => provider.id === selectedId) || modelSettings.providers[0] || null;
}

function renderModelSettings() {
  if (settingsDialog.providerDraft) return renderProviderForm();
  if (settingsDialog.modelDraft) return renderModelForm();
  const provider = selectedSettingsProvider();
  const loading = ['loading', 'saving'].includes(modelSettings.status);
  return `
    <div class="model-settings-shell ${loading ? 'busy' : ''}">
      ${modelSettings.error ? `<div class="settings-feedback error" role="alert">${escapeHtml(modelSettings.error)}</div>` : ''}
      ${modelSettings.message ? `<div class="settings-feedback success" role="status">${escapeHtml(modelSettings.message)}</div>` : ''}
      <div class="model-settings-grid">
        <aside class="provider-rail">
          <div class="provider-rail-heading"><span>提供商</span><button type="button" aria-label="添加提供商" data-add-provider>${icon('plus')}</button></div>
          <div class="provider-list">
            ${modelSettings.providers.map((entry) => `<button class="provider-list-item ${entry.id === provider?.id ? 'active' : ''}" type="button" data-provider-id="${escapeHtml(entry.id)}"><span>${escapeHtml(entry.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(entry.name)}</strong><small>${entry.models.length} 个模型</small></div></button>`).join('')}
          </div>
          <button class="provider-add-button" type="button" data-add-provider>${icon('plus')}<span>添加提供商</span></button>
        </aside>
        <main class="provider-workspace">
          ${modelSettings.status === 'loading' && !modelSettings.providers.length
            ? '<div class="settings-loading">正在读取模型配置…</div>'
            : modelSettings.providers.length
              ? modelSettings.providers.map((entry) => `<div data-provider-panel="${escapeHtml(entry.id)}" ${entry.id === provider?.id ? '' : 'hidden'}>${renderProviderOverview(entry)}</div>`).join('')
              : renderProviderEmptyState()}
        </main>
      </div>
    </div>
  `;
}

function renderProviderEmptyState() {
  return `
    <div class="provider-empty-state">
      <span>${icon('model')}</span>
      <h2>先添加模型提供商</h2>
      <p>MeteoMate 不预置任何提供商。添加一个 OpenAI 兼容地址后，再配置实际使用的模型 ID。</p>
      <button class="primary-button" type="button" data-add-provider>${icon('plus')} 添加提供商</button>
    </div>
  `;
}

function formatModelLimit(value) {
  const limit = Number(value || 0);
  if (!limit) return '使用提供商默认值';
  return formatTokenCount(limit).toUpperCase();
}

function renderModelCapabilities(model) {
  const capabilities = [
    model.toolCall ? '工具调用' : '',
    model.imageInput ? '图片输入' : '',
    model.reasoning ? '推理' : '',
  ].filter(Boolean);
  return capabilities.length ? capabilities.map((label) => `<span>${label}</span>`).join('') : '<span>基础对话</span>';
}

function providerPresetLabel(value) {
  return value === 'volcengine-ark' ? '火山方舟' : 'OpenAI 兼容';
}

function providerProtocolLabel(value) {
  return value === 'responses' ? 'Responses' : 'Chat Completions';
}

function providerStreamingLabel(provider) {
  if (provider.streamingMode === 'on') return '开启 · 手动';
  if (provider.streamingMode === 'off') return '关闭 · 手动';
  return provider.supportsStreaming === false ? '关闭 · 自动' : '开启 · 自动';
}

function renderProviderVerification(verification, { emptyText = '尚未验证' } = {}) {
  if (!verification || !['verified', 'failed'].includes(verification.status)) {
    return `<div class="provider-verification-state untested"><span></span><div><strong>${emptyText}</strong><small>测试会检查文本响应、流式输出及已声明的模型能力。</small></div></div>`;
  }
  const verified = verification.status === 'verified';
  const tests = (verification.tests || []).map((test) => `
    <span class="provider-test-pill ${escapeHtml(test.status)}" title="${escapeHtml(test.message || '')}">
      ${escapeHtml(test.label)} · ${test.status === 'passed' ? '通过' : test.status === 'failed' ? '失败' : '跳过'}
    </span>`).join('');
  return `
    <div class="provider-verification-state ${verified ? 'verified' : 'failed'}">
      <span></span>
      <div><strong>${verified ? '连接验证通过' : '连接验证失败'}</strong><small>${escapeHtml(verification.message || '')}${verification.verifiedAt ? ` · ${formatDateTime(verification.verifiedAt)}` : ''}</small></div>
    </div>
    ${tests ? `<div class="provider-test-pills">${tests}</div>` : ''}`;
}

function renderConnectionChoice(name, value, choices, help, disabled = false) {
  return `
    <fieldset class="connection-choice-field ${disabled ? 'managed' : ''}" ${disabled ? 'disabled' : ''}>
      <legend>${escapeHtml(name)}</legend>
      <div class="connection-choice-options">${choices.map((choice) => `
        <label><input type="radio" name="${escapeHtml(choice.group)}" value="${escapeHtml(choice.value)}" ${choice.value === value ? 'checked' : ''} /><span>${escapeHtml(choice.label)}</span></label>`).join('')}</div>
      <small>${escapeHtml(help)}</small>
    </fieldset>`;
}

function renderProviderOverview(provider) {
  const currentProvider = modelSettings.providerId === provider.id;
  const protocolLabel = providerProtocolLabel(provider.protocol);
  const providerLabel = providerPresetLabel(provider.providerPreset);
  const managed = Boolean(provider.organizationManaged);
  const credentialLabel = !provider.requiresAuth
    ? '无需密钥'
    : provider.credentialMode === 'secret_ref'
      ? provider.credentialConfigured ? '单位引用已登记 · 本机仍需密钥' : '单位引用缺失 · 本机仍需密钥'
      : provider.apiKeySet ? '本机密钥已保存' : '需要本机密钥';
  return `
    <div class="provider-overview">
      <header class="provider-overview-header">
        <div class="provider-title-mark">${escapeHtml(provider.name.slice(0, 1).toUpperCase())}</div>
        <div><div class="provider-title-row"><h2>${escapeHtml(provider.name)}</h2>${managed ? '<span class="organization-provider-badge">组织管理</span>' : ''}<span>${escapeHtml(providerLabel)} · ${escapeHtml(protocolLabel)}</span></div><p>${escapeHtml(provider.apiUrl || '尚未配置服务地址')}</p></div>
        <button class="secondary-action" type="button" data-edit-provider="${escapeHtml(provider.id)}">${managed ? '本机凭据' : '编辑连接'}</button>
      </header>
      ${managed ? '<div class="organization-provider-note"><strong>连接参数由组织目录下发</strong><span>本机只保留 API Key；协议、地址、模型能力和验证状态会随目录修订同步。</span></div>' : ''}
      <dl class="provider-connection-summary">
        <div><dt>凭据</dt><dd>${escapeHtml(credentialLabel)}</dd></div>
        <div><dt>API 协议</dt><dd>${escapeHtml(protocolLabel)}${provider.protocolMode === 'auto' ? ' · 自动' : ''}</dd></div>
        <div class="provider-endpoint-summary"><dt>实际请求地址</dt><dd title="${escapeHtml(provider.endpointUrl || '')}">${escapeHtml(provider.endpointUrl || `/${provider.basePath || 'v1/chat/completions'}`)}</dd></div>
        <div><dt>流式输出</dt><dd>${escapeHtml(providerStreamingLabel(provider))}</dd></div>
      </dl>
      <section class="provider-verification-card">${renderProviderVerification(provider.verification)}</section>
      <section class="provider-models-section">
        <div class="settings-block-heading"><div><h3>模型</h3><p>${managed ? '模型及能力由组织目录统一维护。' : '能力先按服务商文档声明；连接测试会验证协议与已声明能力。'}</p></div>${managed ? '' : `<button class="primary-button small-button" type="button" data-add-model="${escapeHtml(provider.id)}">${icon('plus')} 添加模型</button>`}</div>
        ${provider.models.length ? `<div class="configured-model-list">${provider.models.map((model) => `
          <article class="configured-model-row ${currentProvider && modelSettings.modelId === model.id ? 'default' : ''}">
            <div class="configured-model-main"><div><strong>${escapeHtml(model.name || model.id)}</strong>${model.name && model.name !== model.id ? `<code>${escapeHtml(model.id)}</code>` : ''}</div><div class="model-capability-pills">${renderModelCapabilities(model)}</div></div>
            <div class="configured-model-limits"><span>输入 ${formatModelLimit(model.contextLimit)}</span><span>输出 ${formatModelLimit(model.maxOutputTokens)}</span></div>
            <div class="configured-model-actions">
              ${provider.localProviderAvailable === false
                ? '<span class="managed-model-label">先配置凭据</span>'
                : currentProvider && modelSettings.modelId === model.id
                  ? '<span class="default-model-label">默认</span>'
                  : `<button type="button" data-default-model="${escapeHtml(model.id)}" data-provider-id="${escapeHtml(provider.id)}">设为默认</button>`}
              ${managed ? '<span class="managed-model-label">目录托管</span>' : `<button type="button" data-edit-model="${escapeHtml(model.id)}" data-provider-id="${escapeHtml(provider.id)}">编辑</button>
              <button
                class="configured-model-delete"
                type="button"
                data-delete-model="${escapeHtml(model.id)}"
                data-provider-id="${escapeHtml(provider.id)}"
                aria-label="删除模型 ${escapeHtml(model.name || model.id)}"
                title="${provider.models.length === 1 ? '提供商至少需要保留一个模型' : '删除模型'}"
                ${provider.models.length === 1 ? 'disabled' : ''}
              >删除</button>`}
            </div>
          </article>`).join('')}</div>` : `<div class="models-empty-inline"><p>还没有模型。添加服务端实际接受的模型 ID 后，才能在任务中使用。</p><button type="button" data-add-model="${escapeHtml(provider.id)}">添加第一个模型</button></div>`}
      </section>
      ${managed ? '' : `<footer class="provider-danger-row"><span>删除后，此提供商及其模型将不再可用。</span><button type="button" data-delete-provider="${escapeHtml(provider.id)}">删除提供商</button></footer>`}
    </div>
  `;
}

function renderProviderForm() {
  const draft = settingsDialog.providerDraft;
  const editing = Boolean(draft.id);
  const managed = Boolean(draft.organizationManaged);
  const verification = settingsDialog.providerTest.result || draft.verification;
  return `
    <form class="settings-editor-form" id="provider-editor-form" novalidate>
      <div class="settings-editor-heading"><button type="button" data-settings-editor-back>${icon('back')}</button><div><h2>${managed ? '配置本机凭据' : editing ? '编辑提供商' : '添加提供商'}</h2><p>${managed ? draft.localProviderAvailable === false ? '首次保存会在当前用户的 Goose 目录创建受管连接，并只在本机保存 API Key。' : '组织目录锁定连接和模型信息；此处只管理当前电脑使用的 API Key。' : '连接信息与 API 协议分别配置，自动模式会优先采用服务商官方路径。'}</p></div></div>
      ${modelSettings.error ? `<div class="settings-feedback error" role="alert">${escapeHtml(modelSettings.error)}</div>` : ''}
      <div class="settings-editor-fields">
        ${managed ? '<div class="organization-provider-note"><strong>组织目录已接管</strong><span>修改目录请前往 MeteoMate 管理后台；桌面不会读取或保存服务端 secretRef。</span></div>' : ''}
        <label class="settings-field"><span>提供商名称</span><input id="provider-display-name" value="${escapeHtml(draft.displayName || '')}" placeholder="例如：单位模型网关" required maxlength="60" ${managed ? 'disabled' : ''} /></label>
        ${renderConnectionChoice('提供商类型', draft.presetMode || 'auto', [
          { group: 'provider-preset-mode', value: 'auto', label: '自动识别' },
          { group: 'provider-preset-mode', value: 'volcengine-ark', label: '火山方舟' },
          { group: 'provider-preset-mode', value: 'openai-compatible', label: '通用兼容' },
        ], '预设只决定默认协议与兼容策略，不改变你的服务地址。', managed)}
        <label class="settings-field"><span>Base URL</span><input id="provider-api-url" value="${escapeHtml(draft.apiUrl || '')}" placeholder="https://api.example.com/v1" required inputmode="url" ${managed ? 'disabled' : ''} /><small>填写服务根地址及版本路径，例如 /v1 或 /api/v3；最终地址会在下方完整展示。</small></label>
        ${renderConnectionChoice('API 协议', draft.protocolMode || 'auto', [
          { group: 'provider-protocol-mode', value: 'auto', label: '自动' },
          { group: 'provider-protocol-mode', value: 'chat_completions', label: 'Chat Completions' },
          { group: 'provider-protocol-mode', value: 'responses', label: 'Responses' },
        ], 'Agent、工具调用和豆包 Seed 2.x 建议使用 Responses；旧网关可继续使用 Chat Completions。', managed)}
        ${renderConnectionChoice('流式输出', draft.streamingMode || 'auto', [
          { group: 'provider-streaming-mode', value: 'auto', label: '自动' },
          { group: 'provider-streaming-mode', value: 'on', label: '开启' },
          { group: 'provider-streaming-mode', value: 'off', label: '关闭' },
        ], '自动模式会按提供商兼容性选择；手动设置始终优先。', managed)}
        <div class="provider-route-preview" aria-live="polite">
          <span>${icon('model')}</span>
          <div><small id="provider-resolved-transport">${escapeHtml(providerPresetLabel(draft.providerPreset))} · ${escapeHtml(providerProtocolLabel(draft.protocol))}</small><strong id="provider-effective-endpoint">${escapeHtml(draft.endpointUrl || '输入 Base URL 后显示实际请求地址')}</strong></div>
          <em id="provider-resolved-streaming">${draft.supportsStreaming === false ? '非流式' : '流式'}</em>
        </div>
        <label class="settings-field"><span>API Key <em>可选</em></span><input id="provider-api-key" type="password" placeholder="${editing && draft.apiKeySet ? '已保存，留空表示不修改' : 'sk-…'}" autocomplete="new-password" /><small>密钥由 Goose 的安全配置存储管理，不写入页面状态。</small></label>
        <label class="settings-checkbox-row"><input id="provider-no-auth" type="checkbox" ${draft.requiresAuth === false ? 'checked' : ''} ${managed ? 'disabled' : ''} /><span><strong>此地址无需 API Key</strong><small>适用于本机 vLLM、LocalAI 等可信服务。</small></span></label>
        <details class="provider-advanced-settings" ${draft.endpointPathOverride ? 'open' : ''}>
          <summary>高级设置</summary>
          <label class="settings-field"><span>自定义请求路径 <em>可选</em></span><input id="provider-endpoint-path" value="${escapeHtml(draft.endpointPathOverride || '')}" placeholder="例如：gateway/v1/responses" ${managed ? 'disabled' : ''} /><small>仅在网关路径无法自动推导时填写；不要包含域名和查询参数。</small></label>
        </details>
        <section class="provider-test-card">
          <div><strong>连接与能力验证</strong><small>${editing ? '使用当前提供商的第一个模型验证；已保存的密钥不会被页面读取。' : '填写首个模型 ID 后即可验证文本、流式与模型能力。'}</small></div>
          ${editing ? '<button class="secondary-action" type="button" data-test-provider="provider">测试连接</button>' : '<span class="provider-test-pending">下一步验证</span>'}
          <div id="provider-test-result">${renderProviderVerification(verification, { emptyText: editing ? '尚未验证当前连接' : '等待填写模型' })}</div>
        </section>
      </div>
      <div class="settings-editor-actions"><button class="secondary-action" type="button" data-settings-editor-back>取消</button><button class="primary-button" type="submit">${modelSettings.status === 'saving' ? '正在保存…' : managed ? '保存本机凭据' : editing ? '保存连接' : '添加提供商'}</button></div>
    </form>
  `;
}

function renderModelForm() {
  const draft = settingsDialog.modelDraft;
  const editing = Boolean(draft.originalId);
  const firstModel = Boolean(settingsDialog.pendingProvider);
  return `
    <form class="settings-editor-form" id="model-editor-form" novalidate>
      <div class="settings-editor-heading"><button type="button" data-settings-editor-back>${icon('back')}</button><div><h2>${editing ? '编辑模型' : firstModel ? '添加第一个模型' : '添加模型'}</h2><p>${firstModel ? `完成后将创建“${escapeHtml(settingsDialog.pendingProvider.displayName)}”提供商。` : '模型能力由服务商文档决定，请按实际能力填写。'}</p></div></div>
      ${modelSettings.error ? `<div class="settings-feedback error" role="alert">${escapeHtml(modelSettings.error)}</div>` : ''}
      <div class="settings-editor-fields">
        <label class="settings-field"><span>模型 ID</span><input id="custom-model-id" value="${escapeHtml(draft.id || '')}" placeholder="例如：gpt-4o 或 qwen-plus" required maxlength="160" /></label>
        <label class="settings-field"><span>显示名称 <em>可选</em></span><input id="custom-model-name" value="${escapeHtml(draft.name || '')}" placeholder="未填写时直接显示模型 ID" maxlength="80" /></label>
        <fieldset class="model-capabilities-field"><legend>模型能力</legend><div>
          <label><input id="model-tool-call" type="checkbox" ${draft.toolCall ? 'checked' : ''} /><span>工具调用</span></label>
          <label><input id="model-image-input" type="checkbox" ${draft.imageInput ? 'checked' : ''} /><span>图片输入</span></label>
          <label><input id="model-reasoning" type="checkbox" ${draft.reasoning ? 'checked' : ''} /><span>推理模式</span></label>
        </div></fieldset>
        ${firstModel ? `<section class="provider-test-card provider-model-test-card">
          <div><strong>创建前验证</strong><small>直接请求 ${escapeHtml(settingsDialog.pendingProvider.apiUrl)}，不会保存 API Key 或测试内容。</small></div>
          <button class="secondary-action" type="button" data-test-provider="model">测试连接</button>
          <div id="provider-test-result">${renderProviderVerification(settingsDialog.providerTest.result, { emptyText: '尚未验证这个模型' })}</div>
        </section>` : ''}
        <div class="model-limit-grid">
          <label class="settings-field"><span>最大输入 Token <em>可选</em></span><input id="model-context-limit" type="number" min="1" step="1" value="${draft.contextLimit || ''}" placeholder="使用提供商默认值" /><div class="model-limit-presets">${[32000, 64000, 128000, 256000].map((value) => `<button type="button" data-model-limit="${value}" data-limit-target="model-context-limit">${formatModelLimit(value)}</button>`).join('')}</div></label>
          <label class="settings-field"><span>最大输出 Token <em>可选</em></span><input id="model-output-limit" type="number" min="1" step="1" value="${draft.maxOutputTokens || ''}" placeholder="使用提供商默认值" /><div class="model-limit-presets">${[8000, 16000, 32000, 64000].map((value) => `<button type="button" data-model-limit="${value}" data-limit-target="model-output-limit">${formatModelLimit(value)}</button>`).join('')}</div></label>
        </div>
      </div>
      <div class="settings-editor-actions">${editing ? `<button class="danger-text-button" type="button" data-delete-model="${escapeHtml(draft.originalId)}" data-provider-id="${escapeHtml(draft.providerId)}">删除模型</button>` : '<span></span>'}<div><button class="secondary-action" type="button" data-settings-editor-back>${firstModel ? '返回' : '取消'}</button><button class="primary-button" type="submit">${modelSettings.status === 'saving' ? '正在保存…' : editing ? '保存模型' : firstModel ? '创建并添加模型' : '添加模型'}</button></div></div>
    </form>
  `;
}

function renderMoreView() {
  return `
    <div class="content-scroll settings-page window-content-full">
      <div class="settings-layout more-settings-layout">
        <section class="settings-panel product-about-panel">
          <img src="assets/icons/meteomate.png" alt="" />
          <div><h2>${brand.chineseName} ${brand.name}</h2><p>${brand.tagline}</p><small>${escapeHtml(brand.version)} · Goose powered</small></div>
        </section>
      </div>
    </div>
  `;
}

function renderMyFilesView() {
  return `
    <div class="content-scroll page-content window-content-full">
      ${
        state.projects.length
          ? `<div class="folder-grid">${state.projects.map((project) => `<button class="folder-card" data-project-id="${project.id}">${icon('folder')}<strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></button>`).join('')}</div>`
          : `<div class="large-empty">${icon('folder')}<h2>还没有文件</h2><p>添加本地工作空间后，可以从这里快速访问。</p><button class="primary-button" data-action="add-project">添加工作空间</button></div>`
      }
    </div>
  `;
}

function renderKnowledgeBaseView() {
  if (knowledgeUI.editor) return renderKnowledgeSourceEditor();
  const sources = knowledgeCatalog.sources.filter((source) => knowledgeUI.filter === 'all' || source.type === knowledgeUI.filter);
  const localCount = knowledgeCatalog.sources.filter((source) => source.type === 'local').length;
  const onlineCount = knowledgeCatalog.sources.filter((source) => source.type === 'dify').length;
  const boundProjects = new Set(knowledgeCatalog.sources.flatMap((source) => source.projectIds || [])).size;
  return `
    <div class="content-scroll page-content window-content-full knowledge-home">
      <section class="knowledge-overview">
        <div><span>资料源</span><strong>${knowledgeCatalog.sources.length}</strong><small>统一管理</small></div>
        <div><span>本地资料</span><strong>${localCount}</strong><small>文件与目录</small></div>
        <div><span>在线知识库</span><strong>${onlineCount}</strong><small>Dify Knowledge API</small></div>
        <div><span>已绑定项目</span><strong>${boundProjects}</strong><small>任务自动检索</small></div>
      </section>
      <section class="knowledge-library-section">
        <div class="knowledge-library-heading"><div><h2>资料源</h2><p>只在绑定项目的任务中检索，停用后立即停止注入上下文。</p></div><div class="knowledge-filter-tabs">${[['all', '全部'], ['local', '本地资料'], ['dify', '在线知识库']].map(([id, label]) => `<button class="${knowledgeUI.filter === id ? 'active' : ''}" data-knowledge-filter="${id}">${label}</button>`).join('')}</div></div>
        ${knowledgeCatalog.error ? `<div class="knowledge-feedback failed" role="alert">${escapeHtml(knowledgeCatalog.error)}</div>` : ''}
        ${knowledgeCatalog.status === 'loading' ? '<div class="knowledge-loading">正在读取资料源…</div>' : ''}
        ${knowledgeCatalog.status !== 'loading' && sources.length ? `<div class="knowledge-source-list">${sources.map((source) => renderKnowledgeSourceRow(source)).join('')}</div>` : ''}
        ${knowledgeCatalog.status !== 'loading' && !sources.length ? `<div class="knowledge-empty-state"><span>${icon('folder')}</span><h2>${knowledgeCatalog.sources.length ? '当前分类没有资料源' : '接入第一份气象资料'}</h2><p>${knowledgeCatalog.sources.length ? '切换分类查看其他资料源。' : '本地资料保留在原位置，在线知识库只保存连接信息。绑定项目后，任务会自动检索相关内容。'}</p>${knowledgeCatalog.sources.length ? '' : '<div><button class="secondary-action" data-knowledge-import>添加本地资料</button><button class="primary-button" data-knowledge-add-online>连接在线知识库</button></div>'}</div>` : ''}
      </section>
    </div>
  `;
}

function renderKnowledgeProjectBindings(selectedProjectIds) {
  const selected = new Set(selectedProjectIds || []);
  if (!state.projects.length) return '<p class="knowledge-no-project">还没有项目。资料源可以先保存，创建项目后再绑定。</p>';
  return `<div class="knowledge-project-bindings">${state.projects.map((project) => `<label><input type="checkbox" name="knowledge-projects" value="${escapeHtml(project.id)}" ${selected.has(project.id) ? 'checked' : ''} /><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(shortPath(project.workspace))}</small></span></label>`).join('')}</div>`;
}

function renderKnowledgeSourceEditor() {
  const draft = knowledgeUI.editor;
  const editing = Boolean(draft.id);
  const isLocal = draft.type === 'local';
  return `
    <div class="content-scroll window-content-full knowledge-editor-scroll">
      <form class="knowledge-editor-form" id="knowledge-source-form" novalidate>
        <section class="knowledge-editor-intro"><span class="${isLocal ? 'local' : 'dify'}">${isLocal ? icon(draft.localKind === 'directory' ? 'folder' : 'file') : 'KB'}</span><div><h2>${isLocal ? '本地资料' : 'Dify 在线知识库'}</h2><p>${isLocal ? 'MeteoMate 会读取支持的文本文件，其余格式仍可通过项目文件工具访问。' : '支持浏览检索结果，并把命中的知识片段作为当前任务上下文。'}</p></div></section>
        ${knowledgeUI.error ? `<div class="knowledge-feedback failed" role="alert">${escapeHtml(knowledgeUI.error)}</div>` : ''}
        ${knowledgeUI.testResult ? `<div class="knowledge-feedback ${knowledgeUI.testResult.ok ? 'ready' : 'failed'}" role="status">${knowledgeUI.testResult.ok ? `连接成功，${knowledgeUI.testResult.matches ?? 0} 条匹配，耗时 ${knowledgeUI.testResult.durationMs || 0} ms` : `连接失败：${escapeHtml(knowledgeUI.testResult.error || '未知错误')}`}</div>` : ''}
        <section class="knowledge-editor-section">
          <div class="knowledge-editor-section-heading"><h3>基本信息</h3><p>资料源名称会显示在任务引用和运行记录中。</p></div>
          <label class="knowledge-field"><span>资料源名称</span><input id="knowledge-name" value="${escapeHtml(draft.name || '')}" placeholder="例如：华南强降水业务规范" required maxlength="80" /></label>
          ${isLocal ? `<div class="knowledge-field"><span>本地路径</span><div class="knowledge-readonly-path">${icon(draft.localKind === 'directory' ? 'folder' : 'file')}<code>${escapeHtml(draft.path || '')}</code></div><small>文件保持在原位置，删除资料源不会删除本地文件。</small></div>` : `
            <div class="knowledge-protocol-row"><span>KB</span><div><strong>Dify Knowledge API</strong><small>启用后，任务问题会发送到这个 Dify 地址用于检索，命中片段会进入模型上下文。</small></div><em>当前协议</em></div>
            <label class="knowledge-field"><span>Base URL</span><input id="knowledge-api-url" value="${escapeHtml(draft.apiUrl || '')}" placeholder="https://dify.example.com/v1" inputmode="url" required /><small>可以填写到服务根地址或 /v1，MeteoMate 会补全 Dataset Retrieval 路径。</small></label>
            <label class="knowledge-field"><span>Dataset ID</span><input id="knowledge-dataset-id" value="${escapeHtml(draft.datasetId || '')}" placeholder="知识库 Dataset ID" required maxlength="160" /></label>
            <label class="knowledge-field"><span>API Key</span><input id="knowledge-api-key" type="password" placeholder="${editing && draft.credentialSet ? '已保存，留空表示不修改' : 'dataset-…'}" autocomplete="new-password" ${editing && draft.credentialSet ? '' : 'required'} /><small>密钥保存在当前用户的本机配置中，不会写入页面状态或同步到服务端。</small></label>
          `}
        </section>
        ${isLocal ? '' : `<section class="knowledge-editor-section"><div class="knowledge-editor-section-heading"><h3>检索设置</h3><p>设置每轮任务注入的知识片段数量和最低相关度。</p></div><div class="knowledge-retrieval-grid"><label class="knowledge-field"><span>返回片段数</span><input id="knowledge-top-k" type="number" min="1" max="20" step="1" value="${draft.topK || 5}" /></label><label class="knowledge-field"><span>相关度阈值</span><input id="knowledge-score-threshold" type="number" min="0" max="1" step="0.05" value="${draft.scoreThreshold ?? 0.25}" /></label></div><div class="knowledge-test-row"><label class="knowledge-field"><span>测试问题</span><input id="knowledge-test-query" value="${escapeHtml(draft.testQuery || '未来 24 小时强降水风险')}" /></label><button class="secondary-action" type="button" data-knowledge-test-draft>${icon('refresh')} 测试检索</button></div></section>`}
        <section class="knowledge-editor-section"><div class="knowledge-editor-section-heading"><h3>绑定项目</h3><p>只在选中项目的任务和自动化中使用这个资料源。</p></div>${renderKnowledgeProjectBindings(draft.projectIds)}</section>
        <section class="knowledge-editor-section knowledge-enabled-section"><label><input id="knowledge-enabled" type="checkbox" ${draft.enabled === false ? '' : 'checked'} /><span><strong>启用资料源</strong><small>停用后保留配置，但不再检索或注入任务上下文。</small></span></label></section>
        <footer class="knowledge-editor-footer"><span>保存后，下一轮项目任务立即使用新的资料配置。</span><div><button class="secondary-action" type="button" data-knowledge-cancel>取消</button><button class="primary-button" type="submit">${editing ? '保存更改' : '保存连接'}</button></div></footer>
      </form>
    </div>
  `;
}
