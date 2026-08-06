'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const productRoot = path.resolve(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(productRoot, 'renderer-core.js'), 'utf8');
const actionsSource = fs.readFileSync(path.join(productRoot, 'renderer-actions.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(productRoot, 'main.cjs'), 'utf8');

const helperStart = rendererSource.indexOf('function modelSelectionValue');
const helperEnd = rendererSource.indexOf('function escapeHtml', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'model selection helpers should be present');
const context = {};
vm.runInNewContext(`${rendererSource.slice(helperStart, helperEnd)}\nthis.modelSelectionValue = modelSelectionValue; this.parseModelSelectionValue = parseModelSelectionValue;`, context);

const encoded = context.modelSelectionValue('doubao/provider', 'doubao::seed-1.6');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseModelSelectionValue(encoded))),
  { providerId: 'doubao/provider', modelId: 'doubao::seed-1.6' }
);

const composerSelectionStart = rendererSource.indexOf('function composerModelSelection');
const composerSelectionEnd = rendererSource.indexOf('\nfunction ', composerSelectionStart + 1);
assert.ok(
  composerSelectionStart >= 0 && composerSelectionEnd > composerSelectionStart,
  'composer model selection helper should be present'
);
const composerSelectionContext = {
  state: { draftProviderId: 'deepseek', draftModelId: 'deepseek-chat' },
  modelSettings: { providerId: 'doubao', modelId: 'doubao-lite' },
};
vm.runInNewContext(
  `${rendererSource.slice(composerSelectionStart, composerSelectionEnd)}\nthis.composerModelSelection = composerModelSelection;`,
  composerSelectionContext
);
assert.deepEqual(
  JSON.parse(JSON.stringify(composerSelectionContext.composerModelSelection({
    providerId: 'doubao',
    modelId: 'doubao-lite',
  }))),
  { providerId: 'deepseek', modelId: 'deepseek-chat' },
  'the last manual composer choice should survive switching tasks'
);
composerSelectionContext.state.draftProviderId = null;
composerSelectionContext.state.draftModelId = null;
assert.deepEqual(
  JSON.parse(JSON.stringify(composerSelectionContext.composerModelSelection({
    providerId: 'openai',
    modelId: 'gpt-5.6',
  }))),
  { providerId: 'openai', modelId: 'gpt-5.6' },
  'before a manual choice, an existing task should keep its own model'
);

assert.ok(rendererSource.includes('modelSettings.providers.map((provider) => `<optgroup'));
assert.ok(rendererSource.includes('data-provider-panel='));
assert.ok(rendererSource.includes('general: renderGeneralSettings()'));
assert.ok(rendererSource.includes('models: renderModelSettings()'));
assert.ok(rendererSource.includes('data-settings-panel="${id}"'));

const settingsSwitchStart = actionsSource.indexOf("document.querySelectorAll('[data-settings-section]')");
const settingsSwitchEnd = actionsSource.indexOf("document.querySelectorAll('[data-desktop-setting]')", settingsSwitchStart);
const settingsSwitchBlock = actionsSource.slice(settingsSwitchStart, settingsSwitchEnd);
assert.ok(settingsSwitchBlock.includes("document.querySelectorAll('[data-settings-panel]')"));
assert.ok(!settingsSwitchBlock.includes('render();'), 'settings category switching must not recreate the dialog');

const providerSwitchStart = actionsSource.indexOf("document.querySelectorAll('[data-provider-id].provider-list-item')");
const providerSwitchEnd = actionsSource.indexOf("document.querySelectorAll('[data-edit-provider]')", providerSwitchStart);
const providerSwitchBlock = actionsSource.slice(providerSwitchStart, providerSwitchEnd);
assert.ok(providerSwitchBlock.includes("document.querySelectorAll('[data-provider-panel]')"));
assert.ok(!providerSwitchBlock.includes('render();'), 'provider switching must not recreate the settings dialog');
assert.ok(actionsSource.includes('task.sessionId && task.providerId !== selection.providerId'));
assert.ok(actionsSource.includes('state.draftProviderId = selection.providerId'));
assert.ok(actionsSource.includes('state.draftModelId = selection.modelId'));

const applyTaskModelStart = actionsSource.indexOf('function applyTaskModelSelection');
const applyTaskModelEnd = actionsSource.indexOf('\nfunction ', applyTaskModelStart + 1);
assert.ok(
  applyTaskModelStart >= 0 && applyTaskModelEnd > applyTaskModelStart,
  'task model selection helper should be present'
);
const applyTaskModelContext = {};
vm.runInNewContext(
  `${actionsSource.slice(applyTaskModelStart, applyTaskModelEnd)}\nthis.applyTaskModelSelection = applyTaskModelSelection;`,
  applyTaskModelContext
);
const providerChangedTask = {
  providerId: 'doubao',
  modelId: 'doubao-lite',
  sessionId: 'session-1',
  runtimeMode: 'acp',
  usage: { contextLimit: 4096, size: 1024 },
  contextState: { phase: 'ready', message: 'ready' },
};
assert.equal(
  applyTaskModelContext.applyTaskModelSelection(providerChangedTask, {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
  }),
  true
);
assert.equal(providerChangedTask.providerId, 'deepseek');
assert.equal(providerChangedTask.modelId, 'deepseek-chat');
assert.equal(providerChangedTask.sessionId, null, 'changing providers must start a fresh runtime session');
assert.equal(providerChangedTask.runtimeMode, null);
assert.equal(providerChangedTask.usage, null);

const sameProviderTask = {
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  sessionId: 'session-2',
  runtimeMode: 'acp',
  usage: { contextLimit: 8192, size: 2048, inputTokens: 128 },
  contextState: { phase: 'ready', message: 'ready' },
};
assert.equal(
  applyTaskModelContext.applyTaskModelSelection(sameProviderTask, {
    providerId: 'deepseek',
    modelId: 'deepseek-reasoner',
  }),
  true
);
assert.equal(sameProviderTask.sessionId, 'session-2', 'switching models within one provider should retain the session');
assert.equal(sameProviderTask.usage.contextLimit, null);
assert.equal(sameProviderTask.usage.size, null);
assert.equal(sameProviderTask.usage.inputTokens, 128);

const permissionActionHelperStart = actionsSource.indexOf('function permissionActionSucceeded');
const permissionActionHelperEnd = actionsSource.indexOf('\nfunction ', permissionActionHelperStart + 1);
assert.ok(
  permissionActionHelperStart >= 0 && permissionActionHelperEnd > permissionActionHelperStart,
  'permission action status helper should be present'
);
const permissionActionContext = {};
vm.runInNewContext(
  `${actionsSource.slice(permissionActionHelperStart, permissionActionHelperEnd)}\nthis.permissionActionSucceeded = permissionActionSucceeded;`,
  permissionActionContext
);
assert.equal(permissionActionContext.permissionActionSucceeded('allow_once'), true);
assert.equal(permissionActionContext.permissionActionSucceeded('always_allow'), true);
assert.equal(permissionActionContext.permissionActionSucceeded('deny_once'), false);

const runtimeHelperStart = mainSource.indexOf('function sessionProviderId');
const runtimeHelperEnd = mainSource.indexOf('class GooseAcpRuntime', runtimeHelperStart);
assert.ok(runtimeHelperStart >= 0 && runtimeHelperEnd > runtimeHelperStart, 'runtime provider helpers should be present');
const runtimeContext = { Buffer, URL };
vm.runInNewContext(`${mainSource.slice(runtimeHelperStart, runtimeHelperEnd)}\nthis.completionRecipeForRequest = completionRecipeForRequest; this.sessionHasNativeRecipe = sessionHasNativeRecipe; this.requiresNewRuntimeSession = requiresNewRuntimeSession; this.newSessionMeta = newSessionMeta; this.runtimeToolIdentity = runtimeToolIdentity; this.sessionPermissionGrantKey = sessionPermissionGrantKey; this.openAiChatCompletionsPath = openAiChatCompletionsPath; this.openAiResponsesPath = openAiResponsesPath; this.openAiProviderRoute = openAiProviderRoute; this.shouldUpdateProviderTransport = shouldUpdateProviderTransport;`, runtimeContext);
const completionRecipe = { version: '1.0.0', response: { json_schema: { type: 'object' } } };
const completionRequest = {
  completionContract: { required: true },
  completionRecipe,
};
assert.equal(
  runtimeContext.completionRecipeForRequest({ ...completionRequest, providerId: 'deepseek-provider' }),
  null,
  'custom OpenAI-compatible providers must use the MeteoMate prompt completion protocol'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.completionRecipeForRequest(completionRequest))),
  completionRecipe,
  'the native Goose path should retain its structured completion recipe'
);
assert.equal(runtimeContext.sessionHasNativeRecipe({ session: { _meta: { hasRecipe: true } } }), true);
assert.equal(runtimeContext.sessionHasNativeRecipe({ session: { _meta: {} } }), false);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { providerId: 'doubao-provider' },
    { session: { _meta: { providerId: 'codex' } } }
  ),
  true
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { providerId: 'doubao-provider' },
    { session: { _meta: { providerId: 'doubao-provider' } } }
  ),
  false
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { providerId: 'doubao-provider', capabilityHash: 'capset-new', sessionCapabilityHash: 'capset-old' },
    { session: { _meta: { providerId: 'doubao-provider' } } }
  ),
  true
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { providerId: 'doubao-provider', capabilityHash: 'capset-current', sessionCapabilityHash: 'capset-current' },
    { session: { _meta: { providerId: 'doubao-provider' } } }
  ),
  false
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { ...completionRequest, providerId: 'doubao-provider' },
    { session: { _meta: { providerId: 'doubao-provider', hasRecipe: true } } }
  ),
  true,
  'an existing custom-provider session with a native recipe must be recreated'
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    { ...completionRequest, providerId: 'doubao-provider' },
    { session: { _meta: { providerId: 'doubao-provider', hasRecipe: false } } }
  ),
  false
);
assert.equal(
  runtimeContext.requiresNewRuntimeSession(
    completionRequest,
    { session: { _meta: { hasRecipe: false } } }
  ),
  true,
  'the native Goose path must recreate a session that is missing its recipe'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.newSessionMeta({
    ...completionRequest,
    providerId: 'doubao-provider',
  }, ['tool']))),
  { client: 'meteomate-desktop', provider: 'doubao-provider', enabledExtensions: ['tool'] }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.runtimeToolIdentity({ title: 'fz-weather-mcp__get_system_time' }))),
  { extensionName: 'fz-weather-mcp', toolName: 'get_system_time' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.runtimeToolIdentity({
    _meta: { goose: { toolCall: { toolName: 'fz-weather-mcp__get_system_time' } } },
  }))),
  { extensionName: 'fz-weather-mcp', toolName: 'get_system_time' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.sessionPermissionGrantKey({
    sessionId: 'session-1',
    toolCall: { title: 'fz-weather-mcp__get_system_time', toolCallId: 'call-1' },
  }))),
  { sessionId: 'session-1', toolName: 'fz-weather-mcp__get_system_time' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.sessionPermissionGrantKey({
    sessionId: 'session-1',
    toolCall: { title: 'fz-weather-mcp__get_system_time', toolCallId: 'call-2' },
  }))),
  { sessionId: 'session-1', toolName: 'fz-weather-mcp__get_system_time' },
  'the same tool in one session must reuse the same permission grant'
);
assert.notEqual(
  runtimeContext.sessionPermissionGrantKey({
    sessionId: 'session-2',
    toolCall: { title: 'fz-weather-mcp__get_system_time' },
  }).sessionId,
  'session-1',
  'session grants must not leak to another session'
);
assert.ok(mainSource.includes('_meta: newSessionMeta(request, enabledExtensions)'));
assert.ok(mainSource.includes("extMethod('_goose/unstable/config/upsert'"));
assert.ok(mainSource.includes("setSessionConfigOption({"));
assert.ok(mainSource.includes("configId: 'model'"));
assert.ok(!mainSource.includes('unstable_setSessionModel({'));
assert.ok(mainSource.includes('sessionExtensionsList_unstable({ sessionId })'));
assert.ok(mainSource.includes("type: 'session_capabilities'"));
assert.ok(mainSource.includes('request.sessionCapabilityHash !== request.capabilityHash'));
assert.ok(mainSource.includes('this.sessionPermissionGrants.get(grantKey.sessionId)?.has(grantKey.toolName)'));
assert.ok(mainSource.includes('grants.add(grantKey.toolName)'));
assert.ok(mainSource.includes("const effectiveAction = action === 'always_allow' && pending.allowAlways !== true"));
assert.ok(mainSource.includes("effectiveAction === 'always_allow'\n      ? automaticPermissionResponse(pending.request)"));
assert.ok(mainSource.includes('PermissionPolicy.permissionGrantReusable(assessment)'));
assert.ok(mainSource.includes('allowAlways: reusableGrant'));
assert.ok(mainSource.indexOf('PermissionPolicy.permissionHandling(') < mainSource.indexOf('this.sessionPermissionGrants.get(grantKey.sessionId)'));
assert.equal(
  runtimeContext.openAiChatCompletionsPath('https://ark.cn-beijing.volces.com/api/v3'),
  'api/v3/chat/completions'
);
assert.equal(
  runtimeContext.openAiChatCompletionsPath('http://192.168.28.105:11434/v1'),
  'v1/chat/completions'
);
assert.equal(runtimeContext.openAiResponsesPath('https://gateway.example/openai/v1'), 'openai/v1/responses');
const arkAutoRoute = runtimeContext.openAiProviderRoute('https://ark.cn-beijing.volces.com/api/v3');
assert.equal(arkAutoRoute.providerPreset, 'volcengine-ark');
assert.equal(arkAutoRoute.protocol, 'responses');
assert.equal(arkAutoRoute.basePath, 'api/v3/responses');
assert.equal(arkAutoRoute.endpointUrl, 'https://ark.cn-beijing.volces.com/api/v3/responses');
assert.equal(arkAutoRoute.supportsStreaming, false);
const migratedArkChatRoute = runtimeContext.openAiProviderRoute(
  'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
);
assert.equal(migratedArkChatRoute.protocol, 'responses');
assert.equal(migratedArkChatRoute.basePath, 'api/v3/responses');
const arkExplicitChatRoute = runtimeContext.openAiProviderRoute(
  'https://ark.cn-beijing.volces.com/api/v3',
  { protocolMode: 'chat_completions', streamingMode: 'on' }
);
assert.equal(arkExplicitChatRoute.protocol, 'chat_completions');
assert.equal(arkExplicitChatRoute.basePath, 'api/v3/chat/completions');
assert.equal(arkExplicitChatRoute.supportsStreaming, true);
const arkExplicitResponsesStreamingRoute = runtimeContext.openAiProviderRoute(
  'https://ark.cn-beijing.volces.com/api/v3',
  { protocolMode: 'responses', streamingMode: 'on' }
);
assert.equal(arkExplicitResponsesStreamingRoute.supportsStreaming, false);
assert.equal(arkExplicitResponsesStreamingRoute.streamingCompatibilityLocked, true);
const intranetRoute = runtimeContext.openAiProviderRoute('http://192.168.28.105:11434/v1');
assert.equal(intranetRoute.protocol, 'chat_completions');
assert.equal(intranetRoute.basePath, 'v1/chat/completions');
assert.equal(intranetRoute.supportsStreaming, true);
const explicitResponsesRoute = runtimeContext.openAiProviderRoute(
  'https://gateway.example/openai/v1',
  { protocolMode: 'responses', streamingMode: 'off' }
);
assert.equal(explicitResponsesRoute.basePath, 'openai/v1/responses');
assert.equal(explicitResponsesRoute.supportsStreaming, false);
const deepSeekRoute = runtimeContext.openAiProviderRoute('https://api.deepseek.com');
assert.equal(deepSeekRoute.protocol, 'chat_completions');
assert.equal(deepSeekRoute.preservesThinking, true);
const overrideRoute = runtimeContext.openAiProviderRoute(
  'https://gateway.example/openai/v1',
  { endpointPathOverride: '/proxy/responses' }
);
assert.equal(overrideRoute.protocol, 'responses');
assert.equal(overrideRoute.endpointUrl, 'https://gateway.example/proxy/responses');
assert.equal(
  runtimeContext.shouldUpdateProviderTransport({
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    basePath: 'api/v3/chat/completions',
    supportsStreaming: true,
  }, { protocolMode: 'chat_completions', streamingMode: 'on' }),
  false
);
assert.equal(
  runtimeContext.shouldUpdateProviderTransport({
    apiUrl: 'https://api.deepseek.com',
    basePath: 'v1/chat/completions',
    supportsStreaming: true,
    preservesThinking: false,
  }),
  true
);
assert.equal(
  runtimeContext.shouldUpdateProviderTransport({
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    basePath: 'api/v3/chat/completions',
    supportsStreaming: true,
  }),
  true
);
assert.equal(
  runtimeContext.shouldUpdateProviderTransport({
    apiUrl: 'http://192.168.28.105:11434/v1',
    basePath: 'v1/chat/completions',
    supportsStreaming: true,
  }),
  false
);
assert.ok(mainSource.includes('this.client.listSessions('));
assert.ok(!mainSource.includes('this.client.goose.sessionInfo_unstable'));
assert.ok(!mainSource.includes("extMethod('_goose/unstable/session/info'"));
assert.ok(mainSource.includes('const route = openAiProviderRoute(apiUrl, request)'));
assert.ok(mainSource.includes('supportsStreaming: route.supportsStreaming'));
assert.ok(mainSource.includes('basePath: route.basePath'));
assert.ok(mainSource.includes('this.getModelSettings({ [created.providerId]: request })'));
assert.ok(mainSource.includes('this.getModelSettings({ [providerId]: request })'));
assert.ok(mainSource.includes('managedProviderEntries?.()'));
assert.ok(mainSource.includes('request.localProviderAvailable === false'));
assert.ok(actionsSource.includes('organizationProviderId: settingsDialog.providerDraft.organizationProviderId'));
assert.ok(rendererSource.includes('先配置凭据'));

console.log('MeteoMate model routing regression checks passed.');
