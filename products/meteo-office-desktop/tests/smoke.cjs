const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

for (const file of [
  'capabilities/browser-connector.js',
  'capabilities/computer-connector.js',
  'capabilities/office-connector.js',
  'manifests/brand.js',
  'manifests/experts.js',
  'manifests/capabilities.js',
  'manifests/scenes.js',
  'node_modules/marked/lib/marked.umd.js',
  'node_modules/dompurify/dist/purify.min.js',
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

const harnessAssets = [
  'harness/shared.js',
  'harness/context-window.js',
  'harness/project.js',
  'harness/task-state-machine.js',
  'harness/capability-resolver.js',
  'harness/policy-engine.js',
  'harness/context-compiler.js',
  'harness/event-normalizer.js',
  'harness/artifact-registry.js',
  'harness/evidence-ledger.js',
  'harness/validation-engine.js',
  'harness/state-store.js',
  'harness/state-bootstrap.js',
  'harness/state-restore.js',
];

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of [
  'styles-base.css',
  'styles-app.css',
  'styles-account.css',
  'styles-connectors.css',
  'capabilities/browser-connector.js',
  'capabilities/computer-connector.js',
  'capabilities/office-connector.js',
  'manifests/brand.js',
  'manifests/experts.js',
  'manifests/capabilities.js',
  'manifests/scenes.js',
  ...harnessAssets,
  'runtime.js',
  'renderer-core.js',
  'renderer-actions.js',
]) {
  assert.ok(fs.existsSync(path.join(root, asset)), `missing asset: ${asset}`);
  assert.ok(html.includes(asset), `index.html does not reference: ${asset}`);
}

assert.ok(html.indexOf('harness/state-bootstrap.js') < html.indexOf('renderer-core.js'));
assert.ok(html.indexOf('renderer-core.js') < html.indexOf('harness/state-restore.js'));
assert.ok(html.indexOf('harness/state-restore.js') < html.indexOf('renderer-actions.js'));

assert.equal(context.window.METEOMATE_BRAND.name, 'MeteoMate');
assert.equal(context.window.METEOMATE_BRAND.chineseName, '气象智伴');
assert.ok(context.window.METEOMATE_EXPERTS.length >= 8);
assert.ok(context.window.METEOMATE_TEAMS.length >= 3);
assert.equal(context.window.METEOMATE_SKILLS.length, 0);
assert.ok(context.window.METEOMATE_SKILL_ROADMAP.length >= 3);
assert.ok(context.window.METEOMATE_EXPERTS.some((item) => item.id === 'operations-expert'));
assert.ok(context.window.METEOMATE_TEAMS.some((item) => item.id === 'operations-team'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'operations-incident-response'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'nmc-upper-air-chart-analysis'));
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'operations-observability'));
assert.ok(context.window.METEOMATE_SCENES.some((item) => item.id === 'operations' && item.group === 'operations'));
assert.ok(!context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'goose-runtime'));
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'playwright-browser'));
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'cua-desktop'));
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'office-artifacts'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'docx-template'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'pdf-research'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'spreadsheet-analysis'));
assert.ok(!context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'presentation-generation'));
assert.ok(context.window.METEOMATE_SKILL_ROADMAP.some((item) => item.id === 'office-template-center'));
const synopticExpert = context.window.METEOMATE_EXPERTS.find((item) => item.id === 'synoptic-expert');
assert.ok(synopticExpert.recommendedSkills.includes('nmc-upper-air-chart-analysis'));
assert.ok(synopticExpert.recommendedConnectors.includes('playwright-browser'));
assert.ok(context.window.METEOMATE_SCENES.every((scene) =>
  context.window.METEOMATE_EXPERTS.some((expert) => expert.id === scene.expertId)
));

for (const expert of context.window.METEOMATE_EXPERTS) {
  assert.ok(expert.id);
  assert.ok(expert.name);
  assert.ok(expert.instruction);
  assert.ok(expert.mission);
  assert.ok(Array.isArray(expert.inputs) && expert.inputs.length >= 2);
  assert.ok(Array.isArray(expert.outputs) && expert.outputs.length >= 2);
  assert.ok(Array.isArray(expert.workflow) && expert.workflow.length === 3);
  assert.ok(context.window.METEOMATE_PERMISSION_PROFILES[expert.permissionProfile]);
}

for (const team of context.window.METEOMATE_TEAMS) {
  assert.ok(team.mission);
  assert.ok(Array.isArray(team.inputs) && team.inputs.length >= 2);
  assert.ok(Array.isArray(team.outputs) && team.outputs.length >= 2);
  assert.ok(Array.isArray(team.workflow) && team.workflow.length === 3);
}

const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer-core.js'), 'utf8');
const rendererActionsSource = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');
const responseStylesSource = fs.readFileSync(path.join(root, 'styles/app-4.css'), 'utf8');

const acpImageContext = vm.createContext({});
vm.runInContext(
  `${extractNamedFunction(mainSource, 'collectAcpImages')}; this.collectAcpImages = collectAcpImages;`,
  acpImageContext
);
assert.deepEqual(
  JSON.parse(JSON.stringify(acpImageContext.collectAcpImages([
    { type: 'content', content: { type: 'text', text: 'done' } },
    { type: 'content', content: { type: 'image', data: 'cG5n', mimeType: 'image/png' } },
  ]))),
  [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }]
);
assert.ok(mainSource.includes("type: 'artifact_created'"));
assert.ok(mainSource.includes('sanitizeAcpPayload(update.content)'));
assert.ok(rendererActionsSource.includes("case 'artifact_created'"));
assert.ok(rendererActionsSource.includes('assistant.artifactIds ='));
assert.ok(rendererSource.includes('function renderMessageArtifacts(message, task)'));
assert.ok(rendererSource.includes('class="message-artifact-gallery"'));
assert.ok(responseStylesSource.includes('.message-artifact-image img'));
const capabilityRenderSource = fs.readFileSync(path.join(root, 'capability-center/render.js'), 'utf8');
const stateStoreSource = fs.readFileSync(path.join(root, 'harness/state-store.js'), 'utf8');
const stateRestoreSource = fs.readFileSync(path.join(root, 'harness/state-restore.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const documentsManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'bundled-skills/documents/meteomate.json'), 'utf8')
);
const documentsSkill = fs.readFileSync(
  path.join(root, 'bundled-skills/documents/SKILL.md'),
  'utf8'
);
assert.ok(documentsSkill.includes(`version: "${documentsManifest.version}"`));

assert.ok(rendererActionsSource.includes('function latestAssistantMessage(task)'));
assert.ok(rendererActionsSource.includes('const assistant = currentStreamingAssistant(task);\n  if (!assistant) return null;'));
assert.ok(rendererActionsSource.includes("task.status === 'running' ? ensureStreamingAssistant(task) : null"));
assert.ok(rendererActionsSource.includes('currentStreamingAssistant(task) || latestAssistantMessage(task)'));
assert.ok(rendererActionsSource.includes("task.status === 'completed'\n          && ['running', 'pending', 'in_progress'].includes(eventStatus)"));
assert.ok(rendererSource.includes('function renderAccountSettingsPage()'));
assert.ok(rendererSource.includes('class="settings-return-button"'));
assert.ok(rendererSource.includes("title: '上下文与资料'"));
assert.ok(rendererSource.includes("title: '权限与安全'"));
assert.ok(rendererSource.includes("title: '账户与服务'"));
assert.ok(rendererSource.includes('<span>设置</span>'));
assert.ok(!rendererSource.includes('settings-dialog-backdrop'));
assert.ok(rendererActionsSource.includes('settingsDialog.returnContext = captureSettingsReturnContext()'));
assert.ok(rendererActionsSource.includes('state.view = returnContext.view'));

assert.ok(!mainSource.includes("'serve', '--platform'"));
assert.ok(mainSource.includes('app.asar.unpacked'));
assert.ok(mainSource.includes('function permissionKey()'));
assert.ok(mainSource.includes('return crypto.randomUUID();'));
assert.ok(!mainSource.includes('\\u0000'));
assert.ok(mainSource.includes('defaultsRead_unstable'));
assert.ok(mainSource.includes('defaultsSave_unstable'));
assert.ok(mainSource.includes('unstable_setSessionModel'));
assert.ok(mainSource.includes("args.push('--provider', request.providerId)"));
assert.ok(mainSource.includes("args.push('--model', request.modelId)"));
assert.ok(preloadSource.includes('getModelSettings'));
assert.ok(preloadSource.includes('saveModelSettings'));
assert.ok(preloadSource.includes('getDesktopPreferences'));
assert.ok(preloadSource.includes('saveDesktopPreferences'));
assert.ok(preloadSource.includes('refreshRuntimePreferences'));
assert.ok(preloadSource.includes('getDefaultAssistantWorkspace'));
assert.ok(preloadSource.includes('getDefaultProjectWorkspace'));
assert.ok(preloadSource.includes('createProjectWorkspace'));
assert.ok(preloadSource.includes('getAccountState'));
assert.ok(preloadSource.includes('loginAccount'));
assert.ok(preloadSource.includes('setWindowMode'));
assert.ok(preloadSource.includes('openExternalUrl'));
assert.ok(mainSource.includes("ipcMain.handle('window:mode'"));
assert.ok(mainSource.includes("ipcMain.handle('runtime:preferences-refresh'"));
assert.ok(mainSource.includes('WINDOW_MODES'));
const titleBarContext = vm.createContext({});
vm.runInContext(
  `${extractNamedFunction(mainSource, 'desktopTitleBarStyle')}; this.desktopTitleBarStyle = desktopTitleBarStyle;`,
  titleBarContext
);
assert.equal(titleBarContext.desktopTitleBarStyle('darwin'), 'hiddenInset');
assert.equal(titleBarContext.desktopTitleBarStyle('win32'), 'hidden');
assert.equal(titleBarContext.desktopTitleBarStyle('linux'), 'hidden');
assert.ok(mainSource.includes('titleBarStyle: desktopTitleBarStyle()'));
assert.ok(mainSource.includes("ipcMain.handle('workspace:assistant-default'"));
assert.ok(mainSource.includes("ipcMain.handle('workspace:project-default'"));
assert.ok(mainSource.includes("ipcMain.handle('workspace:project-create'"));
assert.ok(mainSource.includes("ipcMain.handle('external:open'"));
assert.ok(mainSource.includes('## MeteoMate 演示模式'));
assert.ok(mainSource.includes("path.join(app.getPath('documents'), 'MeteoMate', 'Claw')"));
assert.ok(rendererSource.includes('id="provider-api-url"'));
assert.ok(rendererSource.includes('id="account-open-settings"'));
assert.ok(rendererSource.includes('settingsDialog.open'));
assert.ok(rendererSource.includes('专家 · 技能 · 工具'));
assert.ok(rendererSource.includes("catalogTabButton('connectors', '工具')"));
assert.ok(rendererSource.includes('工具中心'));
assert.ok(rendererSource.includes('function userFacingToolCatalog()'));
assert.ok(rendererSource.includes('window.MeteoMateCapabilityCenter?.connectorCatalog?.()'));
assert.ok(rendererSource.includes("renderConnectorToolSelector({ scope: 'automation'"));
assert.ok(rendererSource.includes('data-tool-service-checkbox'));
assert.ok(!rendererSource.includes('catalog.connectors.map((item)'));
assert.ok(rendererSource.includes("navItem('more-knowledge', 'folder', '资料库'"));
assert.ok(rendererSource.includes("state.view === 'more-files'"));
assert.ok(rendererSource.includes("state.view === 'more-knowledge'"));
assert.ok(rendererSource.includes('id="custom-model-id"'));
assert.ok(rendererSource.includes('class="chat-workspace ${assistantMode'));
assert.ok(rendererSource.includes("sidebarCollapsed: false"));
assert.ok(rendererSource.includes('id="sidebar-toggle"'));
assert.ok(rendererSource.includes("'sidebar-collapsed'"));
assert.ok(rendererSource.includes('class="window-titlebar'));
assert.ok(rendererSource.includes("title = '项目'"));
assert.ok(rendererSource.includes(": '资料库';"));
assert.ok(rendererSource.includes("navigation = `<nav class=\"titlebar-catalog-tabs\""));
assert.ok(rendererSource.includes('class="titlebar-catalog-tabs"'));
assert.ok(rendererSource.includes('class="content-scroll window-content-full catalog-home"'));
assert.ok(!rendererSource.includes('<header class="topbar">'));
assert.ok(rendererSource.includes("title = draft ? (draft.id ? draft.name || '编辑自动化'"));
assert.ok(rendererSource.includes('class="content-scroll window-content-full'));
assert.ok(rendererSource.includes('class="composer-secondary-tools"'));
assert.ok(rendererSource.includes('class="composer-permission-label"'));
assert.ok(!rendererSource.includes('id="composer-voice"'));
assert.ok(rendererSource.includes('id="composer-open-model-settings"'));
assert.ok(rendererSource.includes('renderWindowControls()'));
assert.ok(rendererSource.includes('id="window-minimize"'));
assert.ok(rendererSource.includes('id="window-maximize"'));
assert.ok(rendererSource.includes('id="window-close"'));
assert.ok(rendererSource.includes('renderQueuedPrompts(task)'));
assert.ok(rendererSource.includes('queue-mode'));
assert.ok(rendererSource.includes('captureInteractionSnapshot()'));
assert.ok(rendererActionsSource.includes('composerImeComposing'));
assert.ok(rendererActionsSource.includes('flushQueuedTaskPrompts(task.id)'));
assert.ok(rendererActionsSource.includes('queuedPrompts'));
assert.ok(rendererActionsSource.includes('data-queue-cancel'));
assert.ok(rendererActionsSource.includes('data-queue-send'));
assert.ok(mainSource.includes("ipcMain.handle('window:minimize'"));
assert.ok(mainSource.includes("ipcMain.handle('window:toggle-maximize'"));
assert.ok(mainSource.includes("ipcMain.handle('window:close'"));
assert.ok(rendererSource.includes('@ 引用对话文件，/ 调用技能与指令'));
assert.ok(rendererSource.includes('class="composer-context-meter'));
assert.ok(rendererSource.includes('内容由 AI 生成，请仔细甄别'));
assert.ok(!rendererSource.includes('Command + Enter 发送'));
assert.ok(rendererActionsSource.includes('const shouldSend = desktopSettings.preferences.sendOnEnter'));
assert.ok(rendererActionsSource.includes("&& !event.shiftKey && composerTriggerUI.items.length"));
assert.ok(rendererSource.includes('达到 ${status.thresholdPercent}% 后会自动压缩'));
assert.ok(!capabilityRenderSource.includes('id="composer-capabilities"'));
assert.ok(rendererSource.includes('class="inline-permission-stack"'));
assert.ok(rendererSource.includes('id="composer-permission"'));
assert.ok(rendererSource.includes('id="composer-permission-popover"'));
assert.ok(rendererSource.includes('data-permission-profile-id'));
assert.ok(rendererSource.includes('应如何批准 MeteoMate 操作？'));
assert.ok(mainSource.includes('对于问候、寒暄、能力介绍、一般知识问答'));
assert.ok(mainSource.includes('GOOSE_AUTO_COMPACT_THRESHOLD'));
assert.ok(mainSource.includes('configuredAutoCompactThreshold'));
assert.ok(mainSource.includes("type: 'context_compaction'"));
assert.ok(rendererSource.includes('id="composer-model"'));
assert.ok(rendererSource.includes('class="primary-button send-icon-button ${isRunning ? \'queue-mode\' : \'\'}"'));
assert.ok(rendererSource.includes("const sendShortcut = desktopSettings.preferences.sendOnEnter"));
assert.ok(rendererSource.includes("id: 'meteomate-assistant'"));
assert.ok(rendererSource.includes("name: 'MeteoMate 助理'"));
assert.ok(rendererSource.includes("name: 'MeteoMate 工作区'"));
assert.ok(rendererSource.includes('id="account-login-form"'));
assert.ok(rendererSource.includes('PROFILE_STORAGE_PREFIX'));
assert.ok(rendererSource.includes('StateStore.normalizeStoredState(stored'));
assert.ok(!rendererSource.includes('function normalizeStoredTask(task)'));
assert.ok(rendererActionsSource.includes('finishAccountActivation'));
assert.ok(!rendererSource.includes('默认工作区 ·'));
assert.ok(!rendererSource.includes('尚未选择助理工作区'));
assert.ok(rendererSource.includes('class="response-process'));
assert.ok(rendererSource.includes('function renderExpertDetail(expertId)'));
assert.ok(rendererSource.includes('需要你提供'));
assert.ok(rendererSource.includes('可以交付'));
assert.ok(rendererSource.includes('已绑定能力'));
assert.ok(rendererSource.includes('试试这样问'));
assert.ok(rendererActionsSource.includes("document.querySelectorAll('[data-expert-detail-id]')"));
assert.ok(rendererActionsSource.includes("document.querySelectorAll('[data-expert-prompt-id]')"));
assert.ok(responseStylesSource.includes('.expert-detail-dialog'));
assert.ok(responseStylesSource.includes('.expert-contract'));
assert.ok(rendererSource.includes('MeteoMate 项目目录'));
assert.ok(rendererSource.includes('使用已有目录'));
assert.ok(rendererSource.includes('让每次研判有上下文，让每份成果有来处'));
assert.ok(!rendererSource.includes('METEOMATE PROJECTS'));
assert.ok(rendererSource.includes('id="project-choose-existing"'));
assert.ok(!rendererSource.includes('选择目录并创建'));
assert.ok(rendererActionsSource.includes('createProjectWorkspace'));
assert.ok(rendererSource.includes('function renderProjectCapabilityPicker()'));
assert.ok(rendererSource.includes('projectSelectableSkillCatalog?.('));
assert.ok(rendererSource.includes('还没有可添加的技能'));
assert.ok(rendererSource.includes('const availableSkills = enabledSkillCatalog(draft.projectId || null)'));
assert.ok(!rendererSource.includes('catalog.skills.map((item)'));
assert.ok(rendererSource.includes('data-project-capability-open="${escapeHtml(type)}"'));
assert.ok(rendererSource.includes('项目任务默认继承这些能力'));
assert.ok(rendererSource.indexOf('project-capability-field') < rendererSource.indexOf('project-location-field'));
assert.ok(rendererSource.includes('选择左侧条目查看介绍'));
assert.ok(rendererSource.includes("scope === 'project-picker'"));
assert.ok(rendererActionsSource.includes('function openProjectCapabilityPicker(type)'));
assert.ok(rendererActionsSource.includes('function applyProjectCapabilityPicker()'));
assert.ok(rendererActionsSource.includes("listSkillHubSkills({ q: '', limit: 200 })"));
assert.ok(rendererActionsSource.includes('ensureProjectPickerSkillAvailable(item)'));
assert.ok(rendererActionsSource.includes('downloadSkillHubSkill({ skillId: item.id, version })'));
assert.ok(rendererActionsSource.includes("readConnectorToolSelection('project-picker')"));
assert.ok(rendererActionsSource.includes('capabilityApi?.enabledSkillCatalog?.(projectId) || []'));
assert.ok(rendererSource.includes('思考与执行过程'));
assert.ok(rendererSource.includes('展示可核验的推理摘要、计划和工具活动'));
const thoughtRendererContext = vm.createContext({});
vm.runInContext(
  `${extractNamedFunction(rendererSource, 'renderThoughtProgress')}; this.renderThoughtProgress = renderThoughtProgress;`,
  thoughtRendererContext
);
assert.equal(
  thoughtRendererContext.renderThoughtProgress(
    { status: 'running' },
    '正在判断用户目标。\n\n接下来选择天气查询工具。'
  ),
  '正在判断用户目标。\n\n接下来选择天气查询工具。'
);
assert.ok(!rendererSource.includes('模型正在持续分析，已接收'));
assert.ok(!rendererSource.includes('分析已完成，共接收'));
assert.ok(rendererSource.includes('function renderResponseAwaiting(message, task, responsePhase)'));
assert.ok(rendererSource.includes("preparing_context: '整理任务与资料'"));
assert.ok(rendererSource.includes("loading_capabilities: '加载已选工具'"));
assert.ok(rendererSource.includes("slow ? '模型响应较慢' : '等待模型响应'"));
assert.ok(rendererSource.includes('首段内容尚未返回，任务仍在运行'));
assert.ok(rendererSource.includes("document.querySelector('[data-live-duration]')"));
assert.ok(rendererSource.includes("!['analyzing', 'responding'].includes(responsePhase)"));
assert.ok(rendererSource.includes('formatDuration(durationMs)'));
assert.ok(rendererSource.includes('function renderMarkdown(value)'));
assert.ok(rendererSource.includes('window.marked.parse'));
assert.ok(rendererSource.includes('window.DOMPurify.sanitize'));
assert.ok(rendererSource.includes('class="markdown-body"'));
assert.ok(rendererActionsSource.includes("querySelectorAll('[data-external-url]')"));
assert.ok(rendererActionsSource.includes("case 'thought_delta'"));
assert.ok(rendererActionsSource.includes("advanceAssistantResponsePhase(task, 'waiting_model')"));
assert.ok(rendererActionsSource.includes("advanceAssistantResponsePhase(task, 'analyzing')"));
assert.ok(rendererActionsSource.includes("advanceAssistantResponsePhase(task, 'responding')"));
assert.ok(rendererActionsSource.includes('RUNTIME_STREAM_COMMIT_INTERVAL_MS = 80'));
assert.ok(rendererActionsSource.includes('RUNTIME_PROGRESS_COMMIT_INTERVAL_MS = 350'));
assert.ok(rendererActionsSource.includes('scheduleRuntimeStreamCommit(task)'));
assert.ok(rendererActionsSource.includes("case 'runtime_progress'"));
assert.ok(rendererActionsSource.includes('scheduleRuntimeProgressCommit(task)'));
assert.ok(rendererActionsSource.includes('submittedAt: response.startedAt'));
assert.ok(rendererActionsSource.includes('completeRunningThought(task)'));
assert.ok(rendererActionsSource.includes('runtimeStreamCommitTimers.clear()'));
assert.ok(rendererActionsSource.includes('runtimeProgressCommitTimers.clear()'));
assert.ok(rendererSource.includes('const visibleLimit = 720'));
assert.ok(mainSource.includes("type: 'runtime_progress'"));
assert.ok(mainSource.includes("sendRuntimeProgress(constrainedRequest.taskId, 'preparing_context'"));
assert.ok(mainSource.includes("sendRuntimeProgress(request.taskId, 'model_requested'"));
assert.ok(mainSource.includes("sendRuntimeProgress(taskId, 'model_first_event'"));
assert.ok(mainSource.includes('const [knowledgeEnrichedRequest, fileContext] = await Promise.all'));
assert.ok(mainSource.includes('const canReuseLoadedSession = Boolean('));
assert.ok(mainSource.includes('this.sessionModelMap.get(sessionId) !== request.modelId'));
assert.ok(responseStylesSource.includes('height:34px'));
assert.ok(responseStylesSource.includes('.response-awaiting-status small'));
assert.ok(rendererActionsSource.includes('await waitForPendingResponsePaint()'));
assert.ok(rendererActionsSource.includes('finalizeAssistantResponse'));
assert.ok(rendererActionsSource.includes('responseId: activity.responseId'));
assert.ok(rendererSource.includes('return renderTaskView({ assistantMode: true });'));
assert.ok(rendererSource.includes("task.kind !== 'assistant'"));
assert.ok(!rendererSource.includes('<div class="assistant-grid">'));
assert.ok(!rendererSource.includes('浏览专家'));
assert.ok(rendererActionsSource.includes("task?.kind === 'assistant' ? 'assistants' : 'task'"));
assert.ok(rendererActionsSource.includes("kind: assistantTask ? 'assistant' : 'task'"));
assert.ok(!rendererSource.includes('class="task-context-panel"'));
assert.ok(!rendererSource.includes('class="inspector-panel"'));
assert.ok(!rendererSource.includes('Goose ACP 已连接'));
assert.ok(!rendererSource.includes('Headless 降级模式'));
assert.ok(rendererActionsSource.includes("if (!resolved) throw new Error('审批请求已失效，请重新发起任务')"));
const packageMacScript = packageJson.scripts['package:mac'];
assert.ok(packageMacScript.includes('**/node_modules/@aaif/goose-binary-*/bin/goose*'));
assert.ok(packageMacScript.includes('**/node_modules/@trycua/**/*'));
assert.ok(packageMacScript.includes('**/node_modules/@ubjs/**/*'));
assert.ok(packageMacScript.includes("--asar.unpackDir='runtime'"));

assert.ok(stateStoreSource.includes('function normalizeStoredTask'));
assert.ok(stateStoreSource.includes('const storedPlan = Array.isArray(message.processPlan)'));
assert.ok(stateStoreSource.includes('function migrateLegacyState'));
assert.ok(stateRestoreSource.includes('ContextCompiler.compileTaskContext'));
assert.ok(stateRestoreSource.includes('TaskStateMachine.beginRunAttempt'));
assert.ok(stateRestoreSource.includes('TaskStateMachine.finishRunAttempt'));
assert.ok(stateRestoreSource.includes("event.type === 'artifact_created'"));
assert.ok(stateRestoreSource.includes("event.type === 'evidence_created'"));
assert.equal(packageJson.version, '0.2.0-beta.1');
assert.ok(packageJson.scripts.check.includes('tests/harness.cjs'));
assert.ok(packageJson.scripts.check.includes('tests/schema-contracts.cjs'));

const schemaDir = path.join(root, 'schemas');
assert.ok(fs.readdirSync(schemaDir).filter((name) => name.endsWith('.schema.json')).length >= 9);

console.log('MeteoMate manifest and Harness smoke test passed.');
