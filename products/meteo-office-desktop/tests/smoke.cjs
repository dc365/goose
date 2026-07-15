const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });

for (const file of [
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
assert.ok(context.window.METEOMATE_SKILLS.length >= 8);
assert.ok(context.window.METEOMATE_CONNECTORS.some((item) => item.id === 'goose-runtime'));
assert.ok(context.window.METEOMATE_SCENES.every((scene) =>
  context.window.METEOMATE_EXPERTS.some((expert) => expert.id === scene.expertId)
));

for (const expert of context.window.METEOMATE_EXPERTS) {
  assert.ok(expert.id);
  assert.ok(expert.name);
  assert.ok(expert.instruction);
  assert.ok(context.window.METEOMATE_PERMISSION_PROFILES[expert.permissionProfile]);
}

const mainSource = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer-core.js'), 'utf8');
const rendererActionsSource = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');
const stateStoreSource = fs.readFileSync(path.join(root, 'harness/state-store.js'), 'utf8');
const stateRestoreSource = fs.readFileSync(path.join(root, 'harness/state-restore.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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
assert.ok(preloadSource.includes('getDefaultAssistantWorkspace'));
assert.ok(preloadSource.includes('openExternalUrl'));
assert.ok(mainSource.includes("ipcMain.handle('workspace:assistant-default'"));
assert.ok(mainSource.includes("ipcMain.handle('external:open'"));
assert.ok(mainSource.includes('## MeteoMate 演示模式'));
assert.ok(mainSource.includes("path.join(app.getPath('documents'), 'MeteoMate', 'Claw')"));
assert.ok(rendererSource.includes('id="model-provider"'));
assert.ok(rendererSource.includes('id="model-id"'));
assert.ok(rendererSource.includes('class="chat-workspace ${assistantMode'));
assert.ok(rendererSource.includes('class="composer-context-row"'));
assert.ok(rendererSource.includes('class="inline-permission-stack"'));
assert.ok(rendererSource.includes('id="composer-permission"'));
assert.ok(rendererSource.includes('id="composer-permission-popover"'));
assert.ok(rendererSource.includes('data-permission-profile-id'));
assert.ok(rendererSource.includes('应如何处理本地操作？'));
assert.ok(rendererSource.includes('id="composer-model"'));
assert.ok(rendererSource.includes('class="primary-button send-icon-button"'));
assert.ok(rendererSource.includes('aria-label="${task?.sessionId ? \'继续任务\' : \'开始执行\'}"'));
assert.ok(rendererSource.includes("id: 'meteomate-assistant'"));
assert.ok(rendererSource.includes("name: 'MeteoMate 助理'"));
assert.ok(rendererSource.includes("name: 'MeteoMate 工作区'"));
assert.ok(rendererSource.includes('默认工作区 ·'));
assert.ok(!rendererSource.includes('尚未选择助理工作区'));
assert.ok(rendererSource.includes('class="response-process'));
assert.ok(rendererSource.includes('思考与执行过程'));
assert.ok(rendererSource.includes('展示可核验的推理摘要、计划和工具活动'));
assert.ok(rendererSource.includes('formatDuration(durationMs)'));
assert.ok(rendererSource.includes('function renderMarkdown(value)'));
assert.ok(rendererSource.includes('window.marked.parse'));
assert.ok(rendererSource.includes('window.DOMPurify.sanitize'));
assert.ok(rendererSource.includes('class="markdown-body"'));
assert.ok(rendererActionsSource.includes("querySelectorAll('[data-external-url]')"));
assert.ok(rendererActionsSource.includes("case 'thought_delta'"));
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
const runtimeConnector = context.window.METEOMATE_CONNECTORS.find((item) => item.id === 'goose-runtime');
assert.ok(runtimeConnector);
assert.ok(!runtimeConnector.description.includes('ACP'));
assert.ok(!runtimeConnector.description.includes('Headless'));
assert.ok(!runtimeConnector.tags.includes('ACP'));
assert.ok(rendererActionsSource.includes("if (!resolved) throw new Error('审批请求已失效，请重新发起任务')"));
assert.ok(packageJson.scripts['package:mac'].includes("--asar.unpack='**/node_modules/@aaif/goose-binary-*/bin/goose*'"));

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
