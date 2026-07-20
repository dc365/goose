'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createCapabilityService } = require('../capabilities/service.cjs');
const ConnectorClient = require('../capabilities/connector-client.cjs');
const BrowserConnector = require('../capabilities/browser-connector.js');
const { parseZipBuffer } = require('../capabilities/safe-zip.cjs');

const connectorsSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'connectors.js'), 'utf8');
const capabilityRenderSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'render.js'), 'utf8');
const capabilityCoreSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'core.js'), 'utf8');
const capabilitiesManifestSource = fs.readFileSync(path.resolve(__dirname, '..', 'manifests', 'capabilities.js'), 'utf8');
const skillHubRenderSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'skillhub-render.js'), 'utf8');
const skillHubCoreSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'skillhub-core.js'), 'utf8');
const skillCreatorSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'skill-creator.js'), 'utf8');
const capabilityIntegrationSource = fs.readFileSync(path.resolve(__dirname, '..', 'capability-center', 'integration.js'), 'utf8');
const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'renderer-core.js'), 'utf8');
const rendererActionsSource = fs.readFileSync(path.resolve(__dirname, '..', 'renderer-actions.js'), 'utf8');
const taskStylesSource = fs.readFileSync(path.resolve(__dirname, '..', 'styles', 'app-4.css'), 'utf8');
assert.ok(connectorsSource.includes('未使用钥匙串加密'));
assert.ok(!connectorsSource.includes('值将加密保存'));
assert.ok(rendererSource.includes('专家 · 技能 · 工具'));
assert.ok(rendererSource.includes("catalogTabButton('connectors', '工具')"));
assert.ok(!capabilityRenderSource.includes('class="top-tabs"'));
assert.ok(!skillHubRenderSource.includes('class="top-tabs"'));
assert.ok(!capabilityRenderSource.includes('class="topbar capability-toolbar"'));
assert.ok(!skillHubRenderSource.includes('class="topbar capability-toolbar"'));
assert.ok(capabilityRenderSource.includes('renderCapabilityTitlebarActions'));
assert.ok(capabilityRenderSource.includes('data-add-skill="upload"'));
assert.ok(capabilityRenderSource.includes('data-add-skill="create"'));
assert.ok(!capabilityRenderSource.includes('data-add-skill="find"'));
assert.ok(!capabilityRenderSource.includes('data-add-skill="zip"'));
assert.ok(!capabilityRenderSource.includes('data-add-skill="directory"'));
assert.ok(skillHubRenderSource.includes('renderSkillHubTitlebarActions'));
assert.ok(skillHubRenderSource.includes('data-skillhub-category'));
assert.ok(skillHubCoreSource.includes("category: '全部'"));
assert.ok(skillCreatorSource.includes('renderSkillCreatorTitlebarActions'));
assert.ok(capabilityRenderSource.includes('content-scroll window-content-full'));
assert.ok(skillHubRenderSource.includes('content-scroll window-content-full'));
assert.ok(capabilityRenderSource.includes('工具中心'));
assert.ok(capabilityRenderSource.includes("item.id !== 'goose-runtime'"));
assert.ok(capabilitiesManifestSource.includes("id: 'artifact-docx'"));
assert.ok(capabilitiesManifestSource.includes("id: 'playwright-browser'"));
assert.equal(BrowserConnector.MCP_VERSION, '0.0.78');
assert.equal(BrowserConnector.SAFE_TOOLS.length, 18);
assert.ok(BrowserConnector.SAFE_TOOLS.includes('browser_click'));
assert.ok(!BrowserConnector.SAFE_TOOLS.includes('browser_run_code_unsafe'));
assert.ok(capabilitiesManifestSource.includes("category: '办公'"));
assert.ok(!capabilitiesManifestSource.includes("id: 'goose-runtime'"));
assert.ok(connectorsSource.includes('添加工具服务'));
assert.ok(connectorsSource.includes('可用工具'));
assert.ok(connectorsSource.includes('data-tool-search-input'));
assert.ok(connectorsSource.includes('该工具服务未提供描述'));
assert.ok(capabilityRenderSource.includes('item.toolCount'));
assert.ok(capabilityRenderSource.includes('tool.description'));
assert.ok(![rendererSource, capabilityRenderSource, connectorsSource].some((source) => source.includes('连接器')));
assert.ok(rendererSource.includes('new-task-launchpad'));
assert.ok(rendererSource.includes('composer-more-popover'));
assert.ok(rendererSource.includes('composer-project-popover'));
assert.ok(rendererSource.includes('state.draftPrompt'));
assert.ok(rendererActionsSource.includes('function persistComposerDraft(textarea)'));
assert.ok(rendererActionsSource.includes('importLocalKnowledgeSources(projectId, { stayInTask: true })'));
assert.ok(capabilityIntegrationSource.includes("getElementById('composer-capabilities')?.addEventListener('click'"));
assert.ok(capabilityIntegrationSource.includes('[data-remove-task-skill]'));
assert.ok(capabilityIntegrationSource.includes('[data-remove-task-tool]'));
assert.ok(capabilityIntegrationSource.includes('readConnectorToolSelection'));
assert.ok(capabilityIntegrationSource.includes('request.toolSelections'));
assert.ok(capabilityRenderSource.includes('const enabledSkills = api.enabledSkillCatalog(project?.id || null)'));
assert.ok(rendererSource.includes('data-tool-selection-count'));
assert.ok(rendererSource.includes('选择本范围可调用的工具'));
assert.ok(taskStylesSource.includes('.new-task-scene-list'));
assert.ok(taskStylesSource.includes('--secondary-popover-label-size'));
assert.ok(taskStylesSource.includes('.skillhub-section .skillhub-category-strip'));
assert.ok(taskStylesSource.includes('.skillhub-section .skillhub-card-footer'));

const capabilityContext = {
  catalog: {
    skills: [{ id: 'docx-template', name: 'Word 模板填充', status: 'planned' }],
    connectors: [],
  },
  state: { projects: [] },
  getActiveProject: () => ({ id: 'project-a' }),
  saveState: () => {},
  normalizeToolSelections: (value) => value || {},
  runtimeRouter: {},
};
capabilityContext.globalThis = capabilityContext;
vm.runInContext(capabilityCoreSource, vm.createContext(capabilityContext));
const capabilityApi = capabilityContext.MeteoMateCapabilityCenter;
capabilityApi.center.registry = {
  bundledSkills: [],
  connectors: [],
  skills: [
    { id: 'user:user-skill', skillId: 'user-skill', scope: 'user', enabled: true, name: '用户技能' },
    { id: 'project:a-skill', skillId: 'project-a-skill', scope: 'project', projectId: 'project-a', enabled: true, name: '项目 A 技能' },
    { id: 'project:b-skill', skillId: 'project-b-skill', scope: 'project', projectId: 'project-b', enabled: true, name: '项目 B 技能' },
    { id: 'user:disabled', skillId: 'disabled-skill', scope: 'user', enabled: false, name: '已停用技能' },
  ],
};
assert.deepEqual(
  Array.from(capabilityApi.enabledSkillCatalog('project-a'), (item) => item.id).sort(),
  ['project-a-skill', 'user-skill']
);
assert.deepEqual(
  Array.from(capabilityApi.enabledSkillCatalog(null), (item) => item.id),
  ['user-skill']
);
assert.ok(!capabilityApi.enabledSkillCatalog('project-a').some((item) => item.id === 'docx-template'));
assert.deepEqual(
  Array.from(capabilityApi.mergedCatalog(capabilityContext.catalog, 'project-a').skills, (item) => item.id).sort(),
  ['project-a-skill', 'user-skill']
);
const projectSelectableSkills = capabilityApi.projectSelectableSkillCatalog([
  { id: 'skill-creator', name: '技能创建助手', summary: '创建技能', latestVersion: '1.1.0', categories: ['效率工具'] },
  { id: 'synoptic-analysis', name: '天气形势综合分析', summary: '分析天气形势', latestVersion: '1.0.0', categories: ['天气分析'] },
  { id: 'heavy-rain-score', name: '强降水风险评分', summary: '评估强降水风险', latestVersion: '1.0.0', categories: ['灾害天气'] },
  { id: 'forecast-writing', name: '气象预报稿件生成', summary: '生成预报稿件', latestVersion: '1.0.0', categories: ['内容创作'] },
], 'project-a');
assert.deepEqual(
  Array.from(projectSelectableSkills, (item) => item.id).sort(),
  ['forecast-writing', 'heavy-rain-score', 'project-a-skill', 'skill-creator', 'synoptic-analysis', 'user-skill']
);
assert.equal(projectSelectableSkills.find((item) => item.id === 'synoptic-analysis').status, 'skillhub');
assert.equal(projectSelectableSkills.find((item) => item.id === 'synoptic-analysis').remoteSkill.latestVersion, '1.0.0');
assert.ok(!projectSelectableSkills.some((item) => item.id === 'docx-template'));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content || '', 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const localBuffer = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function createSkill(root, name = 'sample-skill') {
  const directory = path.join(root, name);
  fs.mkdirSync(path.join(directory, 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A focused test skill used when validating local capability installation.\nmetadata:\n  version: "1.0.0"\n---\n\n# Test\n\n1. Read input.\n2. Return output.\n3. Verify the result.\n`
  );
  fs.writeFileSync(path.join(directory, 'references', 'guide.md'), '# Guide\n');
  fs.writeFileSync(
    path.join(directory, 'meteomate.json'),
    JSON.stringify({ requires: { connectors: ['weather-data-local'] }, permissions: { shell: false } }, null, 2)
  );
  return directory;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-capability-test-'));
const userData = path.join(temp, 'user-data');
const homeDir = path.join(temp, 'home');
const productRoot = path.join(temp, 'product');
fs.mkdirSync(path.join(productRoot, 'bundled-skills'), { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
const ipcHandlers = new Map();
const service = createCapabilityService({
  app: { getPath: (name) => (name === 'userData' ? userData : path.join(temp, name)) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').slice(4),
  },
  shell: { openPath: async () => '' },
  productRoot,
  homeDir,
});
service.registerIpc();
assert.ok(ipcHandlers.has('capability:install-skill'));
assert.ok(ipcHandlers.has('capability:save-connector'));

const sourceRoot = path.join(temp, 'source');
fs.mkdirSync(sourceRoot, { recursive: true });
const skillDirectory = createSkill(sourceRoot);
const inspection = service.inspectSkill(skillDirectory);
assert.equal(inspection.report.skill.id, 'sample-skill');
assert.equal(inspection.report.risk.level, 'low');
assert.equal(inspection.report.autoInstallEligible, true);
const installed = service.installSkill({ token: inspection.token, reportHash: inspection.report.reportHash, scope: 'user' });
assert.equal(installed.installation.enabled, true);
assert.deepEqual(installed.installation.sidecar.requires.connectors, ['weather-data-local']);
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'sample-skill', 'SKILL.md')));

const disabled = service.setSkillEnabled(installed.installation.id, false);
assert.equal(disabled.installation.enabled, false);
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'disabled-skills', 'sample-skill', 'SKILL.md')));
const enabled = service.setSkillEnabled(installed.installation.id, true);
assert.equal(enabled.installation.enabled, true);

const zipPath = path.join(temp, 'zip-skill.zip');
fs.writeFileSync(zipPath, createStoredZip([
  { name: 'zip-skill/SKILL.md', content: '---\nname: zip-skill\ndescription: Test ZIP skill used when importing a package.\n---\n\n# Steps\n\n1. Run.\n2. Verify.\n' },
  { name: 'zip-skill/assets/readme.txt', content: 'asset' },
]));
const zipInspection = service.inspectSkill(zipPath);
assert.equal(zipInspection.report.skill.id, 'zip-skill');
assert.equal(zipInspection.report.files.length, 2);
const zipInstall = service.installSkill({ token: zipInspection.token, reportHash: zipInspection.report.reportHash, scope: 'user' });
assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'zip-skill', 'SKILL.md')));

assert.throws(
  () => parseZipBuffer(createStoredZip([{ name: '../escape.txt', content: 'no' }])),
  /escapes the package root/
);

const connectorResult = service.saveConnector({
  id: 'weather-data-local',
  name: 'Weather Data Local',
  description: 'Test connector',
  transport: 'stdio',
  command: process.execPath,
  args: ['--version'],
  env: 'API_TOKEN=secret-value',
  projectIds: ['project-1'],
  enabled: true,
  lastTest: {
    ok: true,
    checkedAt: Date.now(),
    durationMs: 1,
    result: {
      ok: true,
      transport: 'stdio',
      tools: [
        { name: 'get_forecast', description: '读取预报' },
        { name: 'get_observation', description: '读取实况' },
      ],
    },
  },
});
assert.deepEqual(connectorResult.connector.secretKeys.env, ['API_TOKEN']);
assert.equal(Object.prototype.hasOwnProperty.call(connectorResult.connector, 'secrets'), false);
assert.equal(connectorResult.connector.secretStorage, 'local-obfuscated');
const registryPath = path.join(userData, 'capabilities', 'registry.json');
const storedRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
assert.equal(storedRegistry.connectors[0].secrets.scheme, 'local-obfuscated');
assert.equal(fs.statSync(registryPath).mode & 0o777, 0o600);
const connectorUpdate = service.saveConnector({
  id: 'weather-data-local',
  name: 'Weather Data Local Updated',
  description: 'Updated without re-entering secrets',
  transport: 'stdio',
  command: process.execPath,
  args: ['--version'],
  projectIds: ['project-1'],
  enabled: true,
});
assert.deepEqual(connectorUpdate.connector.secretKeys.env, ['API_TOKEN']);
assert.equal(connectorUpdate.connector.lastTest.ok, true);
const connectorChangedWithoutRetest = service.saveConnector({
  id: 'weather-data-local',
  name: 'Weather Data Local Updated',
  description: 'Connection changed without retest',
  transport: 'stdio',
  command: process.execPath,
  args: ['--help'],
  projectIds: ['project-1'],
  enabled: true,
  lastTest: null,
});
assert.equal(connectorChangedWithoutRetest.connector.lastTest, null);
const extensions = service.extensionsForRequest({ connectorIds: ['weather-data-local'], projectId: 'project-1' });
assert.equal(extensions.length, 1);
assert.equal(extensions[0].type, 'mcp');
assert.equal(extensions[0].server.command, process.execPath);
assert.deepEqual(extensions[0].server.env, [{ name: 'API_TOKEN', value: 'secret-value' }]);
assert.equal(Object.prototype.hasOwnProperty.call(extensions[0], 'available_tools'), false);
const filteredExtensions = service.extensionsForRequest({
  connectorIds: ['weather-data-local'],
  projectId: 'project-1',
  toolSelections: { 'weather-data-local': ['get_forecast'] },
});
assert.deepEqual(filteredExtensions[0].available_tools, ['get_forecast']);
assert.equal(filteredExtensions[0].server.name, 'weather-data-local');
const sessionExtensions = service.sessionExtensionsForRequest({
  connectorIds: ['weather-data-local'],
  projectId: 'project-1',
  toolSelections: { 'weather-data-local': ['get_forecast'] },
});
assert.equal(sessionExtensions[0].type, 'stdio');
assert.equal(sessionExtensions[0].name, 'weather-data-local');
assert.deepEqual(sessionExtensions[0].available_tools, ['get_forecast']);
assert.equal(service.extensionsForRequest({
  connectorIds: ['weather-data-local'],
  projectId: 'project-1',
  toolSelections: { 'weather-data-local': [] },
}).length, 0);
assert.equal(service.extensionsForRequest({ connectorIds: [], projectId: 'project-1' }).length, 0);

const httpExtension = ConnectorClient.gooseExtensionConfig({
  id: 'weather-http',
  name: 'Weather HTTP',
  description: 'Remote weather MCP',
  transport: 'streamable-http',
  url: 'http://127.0.0.1:3000/messages',
  timeout: 30,
}, { headers: { Authorization: 'Bearer test' } }, ['get_weather']);
assert.equal(httpExtension.type, 'mcp');
assert.deepEqual(httpExtension.server, {
  type: 'http',
  name: 'weather-http',
  url: 'http://127.0.0.1:3000/messages',
  headers: [{ name: 'Authorization', value: 'Bearer test' }],
});
assert.deepEqual(httpExtension.available_tools, ['get_weather']);

service.saveConnector({
  id: 'weather-http',
  name: 'Weather HTTP',
  description: 'Remote weather MCP',
  transport: 'streamable-http',
  url: 'http://127.0.0.1:3000/messages',
  riskClassification: 'medium',
  enabled: true,
  lastTest: {
    ok: true,
    result: {
      transport: 'streamable-http',
      tools: [
        { name: 'get_weather', description: '查询天气' },
        { name: 'make_product', description: '生成产品' },
      ],
    },
  },
});
assert.deepEqual(service.permissionContextForRequest({
  connectorIds: ['weather-http'],
  toolSelections: { 'weather-http': ['get_weather'] },
}), {
  connectors: [{
    id: 'weather-http',
    transport: 'streamable-http',
    riskClassification: 'medium',
    verified: true,
    explicitToolSelection: true,
    selectedTools: ['get_weather'],
    tools: [
      { name: 'get_weather', description: '查询天气' },
      { name: 'make_product', description: '生成产品' },
    ],
  }],
});

assert.throws(() => service.saveConnector({
  id: BrowserConnector.ID,
  name: '浏览器操作',
  transport: 'stdio',
  command: 'unsafe-command',
  args: ['--unsafe'],
  enabled: true,
}), /先完成连接测试/);
const browserTools = [...BrowserConnector.SAFE_TOOLS, ...BrowserConnector.BLOCKED_TOOLS]
  .map((name) => ({ name, description: name }));
const browserResult = service.saveConnector({
  id: BrowserConnector.ID,
  name: '浏览器操作',
  description: 'Playwright browser operations',
  transport: 'stdio',
  command: 'unsafe-command',
  args: ['--unsafe'],
  projectIds: ['project-1'],
  enabled: true,
  lastTest: {
    ok: true,
    result: { transport: 'stdio', tools: browserTools },
  },
});
assert.equal(browserResult.connector.connectorType, 'browser');
assert.equal(browserResult.connector.managedPreset, BrowserConnector.ID);
assert.notEqual(browserResult.connector.command, 'unsafe-command');
assert.ok(browserResult.connector.args.includes(BrowserConnector.MCP_PACKAGE));
assert.ok(browserResult.connector.args.includes('--isolated'));
assert.ok(browserResult.connector.args.includes('--output-dir'));
assert.deepEqual(browserResult.connector.toolAllowlist, BrowserConnector.SAFE_TOOLS);
const browserExtensions = service.extensionsForRequest({
  connectorIds: [BrowserConnector.ID],
  projectId: 'project-1',
});
assert.deepEqual(browserExtensions[0].available_tools, BrowserConnector.SAFE_TOOLS);
const narrowedBrowserExtensions = service.extensionsForRequest({
  connectorIds: [BrowserConnector.ID],
  projectId: 'project-1',
  toolSelections: {
    [BrowserConnector.ID]: ['browser_snapshot', 'browser_click', 'browser_run_code_unsafe'],
  },
});
assert.deepEqual(narrowedBrowserExtensions[0].available_tools, ['browser_snapshot', 'browser_click']);
assert.equal(narrowedBrowserExtensions[0].server.name, BrowserConnector.ID);
assert.deepEqual(
  service.permissionContextForRequest({ connectorIds: [BrowserConnector.ID] }).connectors[0].selectedTools,
  BrowserConnector.SAFE_TOOLS
);

const managed = service.syncManagedSkills(['sample-skill'], 9);
assert.equal(managed.skills.find((item) => item.id === installed.installation.id).managedByPolicy, true);
assert.throws(() => service.setSkillEnabled(installed.installation.id, false), /组织默认能力/);
assert.throws(() => service.uninstallSkill(installed.installation.id), /组织默认能力/);
service.syncManagedSkills([], 10);
const removed = service.uninstallSkill(installed.installation.id);
assert.equal(removed.removed, true);
assert.equal(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'sample-skill')), false);
service.uninstallSkill(zipInstall.installation.id);

fs.rmSync(temp, { recursive: true, force: true });
console.log('MeteoMate Capability Center tests passed.');
