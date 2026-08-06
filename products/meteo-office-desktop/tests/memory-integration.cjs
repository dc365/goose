'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKnowledgeService } = require('../capabilities/knowledge-service.cjs');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const index = read('index.html');
assert.match(index, /styles-memory\.css/);
assert.match(index, /harness\/memory-context\.js/);
assert.match(index, /memory-center\.js/);

const preload = read('preload.cjs');
for (const method of [
  'listMemories', 'createMemory', 'updateMemory', 'deleteMemory',
  'retrieveMemories', 'markMemoriesUsed', 'getMemoryHistory', 'setMemoryEnabled',
]) assert.ok(preload.includes(method), `preload missing ${method}`);

const mainWrapper = read('capabilities/main-wrapper.cjs');
assert.match(mainWrapper, /createMemoryService/);
assert.match(mainWrapper, /memoryService\.registerIpc\(\)/);
assert.match(mainWrapper, /memoryService\.shutdown\(\)/);

const contextCompiler = read('harness/context-compiler.js');
assert.match(contextCompiler, /MeteoMateHarness\.MemoryContext/);
assert.match(contextCompiler, /memoryContext:/);
assert.match(contextCompiler, /MemoryContext\.runtimeEnvelope/);

const stateRestore = read('harness/state-restore.js');
assert.match(stateRestore, /prepareMemoryContext/);
assert.match(stateRestore, /retrieveMemories/);
assert.match(stateRestore, /markMemoriesUsed/);
assert.match(stateRestore, /memory_used/);
assert.match(stateRestore, /MemoryContext\.runtimeInstruction/);
assert.match(stateRestore, /memoryGloballyEnabled/);
assert.doesNotMatch(stateRestore, /task\.memoryPolicy = policy/);
assert.ok(
  stateRestore.indexOf('await recordMemoryUse(task, attempt, snapshot);')
    > stateRestore.indexOf('const result = await originalSend(task, request);'),
  'memory use must be recorded only after the runtime accepts the request'
);

const eventNormalizer = read('harness/event-normalizer.js');
assert.match(eventNormalizer, /memory_used: 'memory\.used'/);

const taskStateMachine = read('harness/task-state-machine.js');
assert.match(taskStateMachine, /memoryPolicy: Shared\.cleanObject/);
assert.match(taskStateMachine, /memoryUsedIds: Shared\.uniqueStrings/);

const memoryCenter = read('memory-center.js');
assert.match(memoryCenter, /message\?\.status === 'streaming'/);
assert.match(memoryCenter, /status: 'active'/);
assert.match(memoryCenter, /onAccountStateChange/);
assert.match(memoryCenter, /resetForAccount/);
assert.match(memoryCenter, /MemoryContext\?\.normalizePolicy/);
assert.match(memoryCenter, /globallyEnabled/);
assert.doesNotMatch(memoryCenter, /decorateSidebar|memory-nav-item|data-memory-nav-count|data-memory-center-open/);
assert.doesNotMatch(memoryCenter, /decorateComposer|composer-memory-chip|data-memory-composer-chip/);

const memoryStyles = read('styles-memory.css');
assert.doesNotMatch(memoryStyles, /memory-nav-item/);
assert.doesNotMatch(memoryStyles, /composer-memory-chip/);

const rendererCore = read('renderer-core.js');
assert.match(rendererCore, /personalization: \{ title: '个性化'/);
assert.match(rendererCore, /renderPersonalizationSettings/);
assert.match(rendererCore, /data-settings-manage-memory/);
assert.match(rendererCore, /memoryEnabled/);

const rendererActions = read('renderer-actions.js');
assert.match(rendererActions, /setMemoryEnabled\(value\)/);

const projectSchema = JSON.parse(read('schemas/project.schema.json'));
assert.equal(projectSchema.properties.spec.properties.policies.properties.memory.type, 'object');

async function verifyKnowledgeAndMemoryPromptMerge() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-memory-knowledge-'));
  const sourcePath = path.join(profileRoot, 'forecast-guidance.md');
  fs.writeFileSync(sourcePath, '暴雨产品应包含风险区和不确定性说明。\n');
  fs.writeFileSync(path.join(profileRoot, 'knowledge-sources.json'), JSON.stringify({
    apiVersion: 'meteomate.ai/v1',
    kind: 'KnowledgeSourceRegistry',
    version: 1,
    sources: [{
      id: 'knowledge-memory-test',
      name: '预报业务规范',
      type: 'local',
      path: sourcePath,
      localKind: 'file',
      projectIds: ['project-memory-test'],
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      lastTest: null,
    }],
    updatedAt: null,
  }));
  const service = createKnowledgeService({
    dialog: {},
    ipcMain: { handle() {} },
    profileContext: { currentPaths: () => ({ root: profileRoot }) },
    secretStore: null,
  });
  const memoryPrompt = '<memory-context>默认生成 DOCX 和 PDF。</memory-context>';
  const enriched = await service.enrichRuntimeRequest({
    prompt: '生成暴雨预报产品',
    knowledgeSourceIds: ['knowledge-memory-test'],
    knowledgeContext: { prompt: memoryPrompt },
  });
  assert.match(enriched.knowledgeContext.prompt, /项目资料上下文/);
  assert.match(enriched.knowledgeContext.prompt, /暴雨产品应包含风险区/);
  assert.match(enriched.knowledgeContext.prompt, /<memory-context>默认生成 DOCX 和 PDF。<\/memory-context>/);
}

verifyKnowledgeAndMemoryPromptMerge()
  .then(() => console.log('memory integration contract tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
