'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {
  createProfileContext,
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCustomProviderMetadata,
  normalizeDesktopPreferences,
} = require('../capabilities/profile-context.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-profile-context-'));
const userData = path.join(temp, 'user-data');
const documents = path.join(temp, 'documents');
const ipcHandlers = new Map();
let requirePasswordChange = false;
let sessionExpiresAt = '2027-01-01T00:00:00Z';

const server = http.createServer((request, response) => {
  const send = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  if (request.url === '/v1/auth/login' && request.method === 'POST') {
    return send(200, {
      sessionToken: 'session-secret-that-must-not-reach-disk',
      expiresAt: sessionExpiresAt,
      user: {
        id: 'usr-forecaster', username: 'forecaster', displayName: '值班预报员', role: 'publisher',
        status: 'active', mustChangePassword: requirePasswordChange, defaultSpaceId: 'personal:usr-forecaster',
      },
    });
  }
  if (request.url === '/v1/me/password' && request.method === 'POST') {
    assert.equal(request.headers.authorization, 'Bearer session-secret-that-must-not-reach-disk');
    return send(200, { changed: true, loginRequired: true });
  }
  if (request.url === '/v1/me/policy' && request.method === 'GET') {
    assert.equal(request.headers.authorization, 'Bearer session-secret-that-must-not-reach-disk');
    return send(200, {
      userId: 'usr-forecaster',
      role: 'publisher',
      orgId: 'org-meteomate',
      defaultSpaceId: 'personal:usr-forecaster',
      profileBindingId: 'user:usr-forecaster',
      policy: {
        defaultModel: 'openai/gpt-5.5',
        allowedModels: ['openai/gpt-5.5'],
        allowedProviderIds: ['openai'],
        requireVerifiedModels: true,
        defaultSkillIds: ['weather-review'],
        allowedConnectorIds: ['weather-data-local'],
        defaultPermissionProfileId: 'artifact-approval',
        allowedPermissionProfileIds: ['analysis-readonly', 'artifact-approval'],
        autoCompactThreshold: 0.84,
        sources: { defaultModel: 'organization' },
        revision: 7,
        updatedAt: '2026-07-17T00:00:00Z',
      },
    });
  }
  if (request.url === '/v1/me/model-catalog' && request.method === 'GET') {
    assert.equal(request.headers.authorization, 'Bearer session-secret-that-must-not-reach-disk');
    return send(200, {
      apiVersion: 'meteomate.ai/v1',
      kind: 'OrganizationModelCatalog',
      revision: 4,
      updatedAt: '2026-08-01T01:00:00Z',
      providers: [{
        id: 'openai', name: '单位模型网关', enabled: true, presetMode: 'openai-compatible',
        protocol: 'responses', streamingMode: 'off', baseUrl: 'https://llm.example.test/v1',
        endpointPath: 'v1/responses', requiresAuth: true, credentialMode: 'local', credentialConfigured: false,
        verification: { status: 'verified', checkedAt: '2026-08-01T00:00:00Z', checks: [{ id: 'text', status: 'passed' }] },
        models: [{
          id: 'gpt-5.5', name: '业务分析模型', enabled: true, toolCall: true, imageInput: true,
          reasoning: true, contextLimit: 128000, maxOutputTokens: 32000,
          verification: { status: 'verified', checkedAt: '2026-08-01T00:00:00Z', checks: [{ id: 'tool_call', status: 'passed' }] },
        }],
      }],
    });
  }
  if (request.url === '/v1/auth/logout') return send(200, { loggedOut: true });
  return send(404, { error: { message: 'not found' } });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const address = server.address();
    const context = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : userData },
      ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
    });
    context.registerIpc();
    for (const name of ['auth:state', 'auth:login', 'auth:offline', 'auth:logout', 'auth:change-password', 'auth:claim-legacy', 'auth:preferences', 'auth:preferences-save']) {
      assert.ok(ipcHandlers.has(name), `missing IPC handler ${name}`);
    }
    assert.equal(normalizeDesktopPreferences({ autoCompactThreshold: 2 }).autoCompactThreshold, 0.75);
    assert.deepEqual(normalizeCustomProviderMetadata({ protocolMode: 'invalid' }), {
      managedProviderId: '',
      presetMode: 'auto',
      protocolMode: 'auto',
      streamingMode: 'auto',
      endpointPathOverride: '',
      verification: null,
    });

    const legacyRoot = path.join(userData, 'capabilities');
    const oldSkill = path.join(temp, 'old-global-skill');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, 'SKILL.md'), '---\nname: weather-review\ndescription: test\n---\n');
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'registry.json'), JSON.stringify({
      skills: [{ id: 'user:user:weather-review', skillId: 'weather-review', scope: 'user', enabled: true, installPath: oldSkill }],
      connectors: [],
    }));

    const session = await context.login({
      baseUrl: `http://127.0.0.1:${address.port}`,
      username: 'forecaster',
      password: 'weather-2026',
    });
    assert.equal(session.status, 'authenticated');
    assert.equal(session.user.id, 'usr-forecaster');
    assert.ok(session.profileKey.startsWith('p-'));
    assert.ok(context.currentPaths().assistantWorkspace.startsWith(path.join(documents, 'MeteoMate', 'Claw')));
    assert.equal(session.legacyDataAvailable, true);
    assert.equal(session.policyContext.policy.revision, 7);
    assert.equal(session.policyContext.policy.autoCompactThreshold, 0.84);
    assert.equal(session.policyContext.policy.requireVerifiedModels, true);
    assert.deepEqual(session.policyContext.policy.allowedProviderIds, ['openai']);
    assert.equal(session.policyContext.modelCatalog.revision, 4);
    assert.equal(session.policyContext.profileBindingId, 'user:usr-forecaster');
    assert.deepEqual(context.defaultSkillIds(), ['weather-review']);
    assert.equal(context.connectorAllowed('weather-data-local'), true);
    assert.equal(context.connectorAllowed('external-search'), false);
    assert.deepEqual(context.desktopPreferences(), {
      sendOnEnter: true,
      showExecutionProcess: true,
      showContextMeter: true,
      memoryEnabled: false,
      autoCompactThreshold: 0.75,
      defaultPermissionProfileId: '',
      companion: DEFAULT_COMPANION_PREFERENCES,
    });
    const savedDesktopPreferences = await ipcHandlers.get('auth:preferences-save')(null, {
      sendOnEnter: false,
      showExecutionProcess: false,
      memoryEnabled: true,
      autoCompactThreshold: 0.72,
      defaultPermissionProfileId: 'artifact-approval',
    });
    assert.equal(savedDesktopPreferences.sendOnEnter, false);
    assert.equal(savedDesktopPreferences.showExecutionProcess, false);
    assert.equal(savedDesktopPreferences.showContextMeter, true);
    assert.equal(savedDesktopPreferences.memoryEnabled, false, 'general preferences IPC cannot enable memory');
    assert.equal(savedDesktopPreferences.autoCompactThreshold, 0.72);
    assert.deepEqual(savedDesktopPreferences.companion, DEFAULT_COMPANION_PREFERENCES);
    assert.equal(context.desktopPreferences().defaultPermissionProfileId, 'artifact-approval');

    const rawModels = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      providers: [
        { id: 'openai', configured: true, models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'gpt-5-mini', name: 'GPT-5 mini' }] },
        { id: 'anthropic', configured: true, models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] },
      ],
    };
    const filteredModels = context.filterModelSettings(rawModels);
    assert.equal(filteredModels.providerId, 'openai');
    assert.equal(filteredModels.modelId, 'gpt-5.5');
    assert.equal(filteredModels.organizationPolicy.autoCompactThreshold, 0.84);
    assert.equal(filteredModels.organizationPolicy.catalogRevision, 4);
    assert.equal(filteredModels.organizationPolicy.requireVerifiedModels, true);
    assert.equal(filteredModels.providers.length, 1);
    assert.deepEqual(filteredModels.providers[0].models.map((model) => model.id), ['gpt-5.5']);
    assert.equal(filteredModels.providers[0].name, '单位模型网关');
    assert.equal(filteredModels.providers[0].organizationManaged, true);
    assert.equal(filteredModels.providers[0].models[0].toolCall, true);
    const managedProvider = context.managedProviderMetadata('openai');
    assert.equal(managedProvider.organizationManaged, true);
    assert.equal(managedProvider.organizationProviderId, 'openai');
    assert.equal(managedProvider.displayName, '单位模型网关');
    assert.equal(managedProvider.description, '');
    assert.equal(managedProvider.apiUrl, 'https://llm.example.test/v1');
    assert.equal(managedProvider.protocolMode, 'responses');
    assert.equal(managedProvider.verification.status, 'verified');
    assert.deepEqual(managedProvider.models.map((model) => model.id), ['gpt-5.5']);
    context.saveCustomProviderMetadata('openai', {
      presetMode: 'openai-compatible',
      protocolMode: 'responses',
      streamingMode: 'off',
      endpointPathOverride: '/gateway/v1/responses',
      verification: {
        status: 'verified',
        verifiedAt: '2026-08-01T08:00:00.000Z',
        protocol: 'responses',
        tests: [{ id: 'text', label: '文本响应', status: 'passed' }],
      },
    });
    assert.equal(context.customProviderMetadata('openai').protocolMode, 'responses');
    const providerConfiguredModels = context.filterModelSettings(rawModels);
    assert.equal(providerConfiguredModels.providers[0].streamingMode, 'off');
    assert.equal(providerConfiguredModels.providers[0].endpointPathOverride, 'gateway/v1/responses');
    assert.equal(providerConfiguredModels.providers[0].verification.status, 'verified');
    context.saveCustomProviderMetadata('custom_unit', {
      managedProviderId: 'openai',
      protocolMode: 'responses',
      streamingMode: 'off',
    });
    const boundModels = context.filterModelSettings({
      providerId: 'custom_unit',
      modelId: 'gpt-5.5',
      providers: [{ id: 'custom_unit', configured: true, models: [{ id: 'gpt-5.5' }] }],
    });
    assert.equal(boundModels.providers[0].organizationProviderId, 'openai');
    assert.equal(boundModels.providerId, 'custom_unit');
    assert.equal(boundModels.modelId, 'gpt-5.5');
    assert.equal(context.managedProviderMetadata('custom_unit').organizationProviderId, 'openai');
    assert.doesNotThrow(() => context.enforceRuntimePolicy({ providerId: 'custom_unit', modelId: 'gpt-5.5' }));
    assert.throws(() => context.saveModelPreference({ providerId: 'anthropic', modelId: 'claude-sonnet' }), /允许范围/);
    context.saveModelPreference({ providerId: 'openai', modelId: 'gpt-5.5' });
    assert.equal(context.desktopPreferences().autoCompactThreshold, 0.72);
    assert.equal(context.enforceRuntimePolicy({ permissionProfileId: 'artifact-approval', allowFileTools: true }).allowFileTools, true);
    assert.throws(() => context.enforceRuntimePolicy({ permissionProfileId: 'workspace-approval' }), /权限不在管理员允许范围/);
    assert.throws(() => context.enforceRuntimePolicy({ connectorIds: ['external-search'] }), /限制以下工具/);

    const migrated = context.claimLegacyData();
    assert.equal(migrated.migrated, true);
    const registry = JSON.parse(fs.readFileSync(path.join(context.currentPaths().capabilities, 'registry.json'), 'utf8'));
    assert.equal(registry.skills[0].installPath, path.join(context.currentPaths().assistantWorkspace, '.agents', 'skills', 'weather-review'));
    assert.ok(fs.existsSync(path.join(registry.skills[0].installPath, 'SKILL.md')));

    const diskText = fs.readFileSync(path.join(userData, 'auth', 'profile-context.json'), 'utf8')
      + fs.readFileSync(context.currentPaths().metadata, 'utf8');
    assert.ok(!diskText.includes('session-secret'));
    assert.ok(!diskText.includes('weather-2026'));

    await context.logout();
    requirePasswordChange = true;
    const temporarySession = await context.login({
      baseUrl: `http://127.0.0.1:${address.port}`,
      username: 'forecaster',
      password: 'temporary-password',
    });
    assert.equal(temporarySession.user.mustChangePassword, true);
    assert.equal(temporarySession.offlineAvailable, false);

    await context.changePassword({ currentPassword: 'temporary-password', newPassword: 'weather-new-2026' });
    assert.equal(context.publicState().status, 'signed_out');
    assert.equal(context.publicState().offlineAvailable, false);
    requirePasswordChange = false;
    await context.login({
      baseUrl: `http://127.0.0.1:${address.port}`,
      username: 'forecaster',
      password: 'weather-new-2026',
    });
    assert.equal(context.isAuthenticated(), true);
    await context.logout();
    sessionExpiresAt = '2000-01-01T00:00:00Z';
    await context.login({
      baseUrl: `http://127.0.0.1:${address.port}`,
      username: 'forecaster',
      password: 'expired-session',
    });
    assert.equal(context.publicState().status, 'authenticated');
    assert.equal(context.isAuthenticated(), false);
    await context.logout();
    assert.equal(context.publicState().status, 'signed_out');
    assert.equal(context.publicState().offlineAvailable, false);
    assert.throws(() => context.openOffline(), /离线登录未启用/);

    const offlineContext = createProfileContext({
      app: { getPath: (name) => name === 'documents' ? documents : userData },
      ipcMain: { handle: () => {} },
      allowOffline: true,
    });
    assert.equal(offlineContext.publicState().offlineAvailable, true);
    const offline = offlineContext.openOffline();
    assert.equal(offline.status, 'offline');
    assert.equal(offline.policyContext.policy.revision, 7);
    assert.equal(offline.policyContext.policy.autoCompactThreshold, 0.84);
    assert.equal(offline.policyContext.modelCatalog.revision, 4);
    console.log('MeteoMate profile context checks passed.');
  } finally {
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
