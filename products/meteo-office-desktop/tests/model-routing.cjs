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
const runtimeContext = { URL };
vm.runInNewContext(`${mainSource.slice(runtimeHelperStart, runtimeHelperEnd)}\nthis.requiresNewRuntimeSession = requiresNewRuntimeSession; this.newSessionMeta = newSessionMeta; this.runtimeToolIdentity = runtimeToolIdentity; this.sessionPermissionGrantKey = sessionPermissionGrantKey; this.openAiChatCompletionsPath = openAiChatCompletionsPath; this.shouldUpdateProviderBasePath = shouldUpdateProviderBasePath;`, runtimeContext);
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
assert.deepEqual(
  JSON.parse(JSON.stringify(runtimeContext.newSessionMeta({ providerId: 'doubao-provider' }, ['tool']))),
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
assert.equal(
  runtimeContext.shouldUpdateProviderBasePath({
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    basePath: 'v1/chat/completions',
  }),
  true
);
assert.equal(
  runtimeContext.shouldUpdateProviderBasePath({
    apiUrl: 'http://192.168.28.105:11434/v1',
    basePath: 'v1/chat/completions',
  }),
  false
);
assert.ok(mainSource.includes('this.client.listSessions('));
assert.ok(!mainSource.includes('this.client.goose.sessionInfo_unstable'));
assert.ok(!mainSource.includes("extMethod('_goose/unstable/session/info'"));
assert.ok(mainSource.includes("basePath: openAiChatCompletionsPath(String(request.apiUrl || '').trim())"));

console.log('MeteoMate model routing regression checks passed.');
