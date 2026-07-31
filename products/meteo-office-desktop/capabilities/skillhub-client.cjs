'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ZipWriter = require('./zip-writer.cjs');
const { compareSkillVersions } = require('./skill-version.cjs');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8088';
const JSON_LIMIT = 4 * 1024 * 1024;
const PACKAGE_LIMIT = 64 * 1024 * 1024;

function normalizeBaseURL(value) {
  const text = String(value || DEFAULT_BASE_URL).trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('SkillHub URL 无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('SkillHub 只支持 HTTP 或 HTTPS');
  if (parsed.username || parsed.password) throw new Error('SkillHub URL 不能包含用户名或密码');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function createSkillHubClient({ app, ipcMain, capabilityService, skillCreatorService, profileContext }) {
  let settingsCache = null;
  let policySync = Promise.resolve({ installed: [], skipped: [], errors: [] });
  let expertSync = Promise.resolve(null);

  function currentProfileKey() {
    return profileContext?.publicState?.().profileKey || null;
  }

  function assertActiveProfile(expectedProfileKey) {
    if (expectedProfileKey && currentProfileKey() !== expectedProfileKey) {
      throw new Error('用户已切换，已取消组织默认 Skill 同步');
    }
  }

  function settingsPath() {
    const root = profileContext?.currentPaths().capabilities || path.join(app.getPath('userData'), 'capabilities');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return path.join(root, 'skillhub.json');
  }

  function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      settingsCache = {
        requireSignature: parsed.requireSignature !== false,
      };
    } catch {
      settingsCache = {
        requireSignature: true,
      };
    }
    return settingsCache;
  }

  function publicSettings() {
    const settings = loadSettings();
    return {
      baseUrl: profileContext?.baseUrl() || normalizeBaseURL(process.env.METEOMATE_SKILLHUB_URL || DEFAULT_BASE_URL),
      tokenConfigured: Boolean(profileContext?.isAuthenticated()),
      tokenStorage: profileContext?.isAuthenticated() ? 'memory' : 'none',
      encryptionAvailable: false,
      requireSignature: settings.requireSignature,
    };
  }

  function saveSettings(input = {}) {
    const next = {
      requireSignature: input.requireSignature !== false,
    };
    const target = settingsPath();
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
    settingsCache = next;
    return publicSettings();
  }

  function authHeaders(extra = {}) {
    return profileContext?.authHeaders(extra) || extra;
  }

  async function request(relative, options = {}) {
    const baseUrl = profileContext?.baseUrl() || DEFAULT_BASE_URL;
    const target = `${baseUrl}${relative.startsWith('/') ? relative : `/${relative}`}`;
    const { timeoutMs = 20_000, authenticated = true, ...requestOptions } = options;
    const init = { ...requestOptions, signal: AbortSignal.timeout(timeoutMs) };
    const response = authenticated && typeof profileContext?.fetchAuthenticated === 'function'
      ? await profileContext.fetchAuthenticated(target, init)
      : await fetch(target, { ...init, headers: authHeaders(requestOptions.headers || {}) });
    return { response, target };
  }

  async function jsonRequest(relative, options = {}) {
    const { response, target } = await request(relative, options);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > JSON_LIMIT) throw new Error('SkillHub 响应超过大小限制');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > JSON_LIMIT) throw new Error('SkillHub 响应超过大小限制');
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`SkillHub 返回了无效 JSON（${response.status}）`);
      }
    }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `SkillHub 请求失败：${response.status} ${target}`);
      error.status = response.status;
      error.code = payload?.error?.code || '';
      error.target = target;
      throw error;
    }
    return payload;
  }

  async function testConnection() {
    const startedAt = Date.now();
    const health = await jsonRequest('/healthz', { timeoutMs: 8_000, authenticated: false });
    let identity = null;
    try {
      const me = await jsonRequest('/v1/me', { timeoutMs: 8_000 });
      identity = me?.user || me?.actor || null;
    } catch {
      // Public browsing remains usable without an authenticated token.
    }
    return { ok: health?.status === 'ok', durationMs: Date.now() - startedAt, health, identity, settings: publicSettings() };
  }

  async function listSkills(input = {}) {
    const query = new URLSearchParams();
    if (input.q) query.set('q', input.q);
    if (input.category) query.set('category', input.category);
    if (input.includeDrafts) query.set('includeDrafts', 'true');
    query.set('limit', String(Math.min(200, Math.max(1, Number(input.limit || 60)))));
    query.set('offset', String(Math.max(0, Number(input.offset || 0))));
    return jsonRequest(`/v1/skills?${query}`);
  }

  async function listManagedSkills(input = {}) {
    return listSkills({ ...input, includeDrafts: true });
  }

  async function listExperts(input = {}) {
    const query = new URLSearchParams();
    if (input.q) query.set('q', input.q);
    if (input.includeInactive && profileContext?.isAuthenticated()) query.set('includeInactive', 'true');
    query.set('limit', String(Math.min(300, Math.max(1, Number(input.limit || 100)))));
    query.set('offset', String(Math.max(0, Number(input.offset || 0))));
    return jsonRequest(`/v1/experts?${query}`);
  }

  function remoteExpertPayload(record, baseRevision = 0) {
    const payload = {
      ...record,
      baseRevision,
      visibility: record.visibility || 'private',
    };
    delete payload.remote;
    delete payload.syncStatus;
    delete payload.syncError;
    delete payload.remoteShadow;
    delete payload.userManaged;
    delete payload.capabilityType;
    return payload;
  }

  async function saveRemoteExpert(record) {
    const remoteID = String(record?.remote?.id || '').trim();
    const baseRevision = Number(record?.remote?.revision || 0);
    if (remoteID) {
      return jsonRequest(`/v1/experts/${encodeURIComponent(remoteID)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remoteExpertPayload(record, baseRevision)),
      });
    }
    return jsonRequest('/v1/experts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(remoteExpertPayload(record)),
    });
  }

  async function performExpertSync() {
    if (!profileContext?.isAuthenticated()) {
      return {
        skipped: true,
        reason: 'offline',
        registry: capabilityService.registrySnapshot(),
        uploaded: [],
        conflicts: [],
        errors: [],
      };
    }
    const expectedProfileKey = currentProfileKey();
    const profile = profileContext.publicState();
    const currentUserId = String(profile?.user?.id || '');
    const baseUrl = profileContext.baseUrl() || DEFAULT_BASE_URL;
    const uploaded = [];
    const conflicts = [];
    const errors = [];
    const pending = capabilityService.registrySnapshot().experts.filter(
      (item) => item.source?.type === 'user'
        && ['local_only', 'pending_upload', 'sync_error'].includes(item.syncStatus || 'local_only')
    );
    for (const record of pending) {
      assertActiveProfile(expectedProfileKey);
      try {
        const remote = await saveRemoteExpert(record);
        assertActiveProfile(expectedProfileKey);
        capabilityService.acceptRemoteExpert(remote, { currentUserId, baseUrl });
        uploaded.push(remote);
      } catch (error) {
        const conflict = error?.status === 409;
        capabilityService.markExpertSyncError(record.id, error?.message || String(error), conflict);
        const issue = { id: record.id, message: error?.message || String(error), conflict };
        if (conflict) conflicts.push(issue);
        else errors.push(issue);
      }
    }
    assertActiveProfile(expectedProfileKey);
    let pulled = [];
    try {
      const response = await listExperts({ includeInactive: true, limit: 300 });
      assertActiveProfile(expectedProfileKey);
      pulled = response?.items || [];
      const applied = capabilityService.syncRemoteExperts(pulled, { currentUserId, baseUrl });
      for (const item of applied.conflicts || []) {
        if (!conflicts.some((conflict) => conflict.id === item.id)) {
          conflicts.push({ id: item.id, message: item.syncError || '专家版本冲突', conflict: true });
        }
      }
    } catch (error) {
      errors.push({ id: '', message: error?.message || String(error), conflict: false });
    }
    return {
      skipped: false,
      uploaded,
      pulled: pulled.length,
      conflicts,
      errors,
      registry: capabilityService.registrySnapshot(),
    };
  }

  function syncExperts() {
    const run = expertSync.catch(() => null).then(() => performExpertSync());
    expertSync = run;
    return run;
  }

  async function listPublishers() {
    const response = await jsonRequest('/v1/admin/users');
    return {
      ...response,
      items: (response?.items || []).filter(
        (user) => user.status === 'active' && ['publisher', 'admin'].includes(user.role)
      ),
    };
  }

  async function updateSkill(input = {}) {
    const skillId = String(input.skillId || '').trim();
    if (!skillId) throw new Error('更新 Skill 需要 skillId');
    const body = { ...input };
    delete body.skillId;
    return jsonRequest(`/v1/skills/${encodeURIComponent(skillId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function publishVersion(input = {}) {
    const skillId = String(input.skillId || '').trim();
    const version = String(input.version || '').trim();
    if (!skillId || !version) throw new Error('发布版本需要 skillId 和 version');
    return jsonRequest(
      `/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/publish`,
      { method: 'POST' }
    );
  }

  async function deprecateVersion(input = {}) {
    const skillId = String(input.skillId || '').trim();
    const version = String(input.version || '').trim();
    if (!skillId || !version) throw new Error('弃用版本需要 skillId 和 version');
    return jsonRequest(
      `/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/deprecate`,
      { method: 'POST' }
    );
  }

  async function listCollections() {
    return jsonRequest('/v1/collections');
  }

  async function recommendations(input = {}) {
    const query = new URLSearchParams();
    if (input.q) query.set('q', input.q);
    if (input.categories?.length) query.set('categories', input.categories.join(','));
    if (input.installedSkillIds?.length) query.set('installedSkillIds', input.installedSkillIds.join(','));
    if (input.connectorIds?.length) query.set('connectorIds', input.connectorIds.join(','));
    query.set('limit', String(Math.min(50, Math.max(1, Number(input.limit || 18)))));
    return jsonRequest(`/v1/recommendations?${query}`);
  }

  async function skillDetail(skillId) {
    return jsonRequest(`/v1/skills/${encodeURIComponent(skillId)}`);
  }

  function rawEd25519Key(base64) {
    const raw = Buffer.from(base64, 'base64');
    if (raw.length !== 32) throw new Error('SkillHub 公钥长度无效');
    return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  }

  async function verifyPackage({ skillId, version, bytes, digest, signature, keyId }) {
    const calculated = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!digest || calculated !== digest) throw new Error('SkillHub 包摘要校验失败');
    if (!signature || !keyId) {
      if (loadSettings().requireSignature) throw new Error('SkillHub 包缺少签名');
      return { digest: calculated, signatureVerified: false, keyId: null };
    }
    const keys = await jsonRequest('/v1/trust/keys');
    const record = (keys?.keys || []).find((item) => item.keyId === keyId && item.algorithm === 'ed25519');
    if (!record) throw new Error(`未找到 SkillHub 签名公钥：${keyId}`);
    const message = `${skillId}\n${version}\n${digest}`;
    const valid = crypto.verify(null, Buffer.from(message), rawEd25519Key(record.publicKey), Buffer.from(signature, 'base64'));
    if (!valid) throw new Error('SkillHub 包签名无效');
    return { digest: calculated, signatureVerified: true, keyId };
  }

  async function downloadAndInspect(input = {}) {
    const skillId = String(input.skillId || '');
    const version = String(input.version || '');
    if (!skillId || !version) throw new Error('下载 Skill 需要 skillId 和 version');
    const expectedProfileKey = input.expectedProfileKey || currentProfileKey();
    assertActiveProfile(expectedProfileKey);
    const { response } = await request(`/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/download`, { timeoutMs: 45_000 });
    assertActiveProfile(expectedProfileKey);
    if (!response.ok) {
      let message = `下载失败：${response.status}`;
      try { message = (await response.json())?.error?.message || message; } catch {}
      throw new Error(message);
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > PACKAGE_LIMIT) throw new Error('SkillHub 包超过 64 MB 限制');
    const bytes = Buffer.from(await response.arrayBuffer());
    assertActiveProfile(expectedProfileKey);
    if (bytes.length > PACKAGE_LIMIT) throw new Error('SkillHub 包超过 64 MB 限制');
    const verification = await verifyPackage({
      skillId,
      version,
      bytes,
      digest: response.headers.get('x-meteomate-digest'),
      signature: response.headers.get('x-meteomate-signature'),
      keyId: response.headers.get('x-meteomate-key-id'),
    });
    assertActiveProfile(expectedProfileKey);
    const temporary = path.join(capabilityService.paths().temp, `skillhub-${skillId}-${version}-${crypto.randomUUID()}.zip`);
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    try {
      const inspection = capabilityService.inspectSkill(temporary);
      fs.rmSync(temporary, { force: true });
      return { ...inspection, remote: { skillId, version, baseUrl: profileContext?.baseUrl() || DEFAULT_BASE_URL, ...verification } };
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  async function reportInstallation(input = {}) {
    if (!profileContext?.isAuthenticated()) return { skipped: true, reason: 'anonymous' };
    const body = {
      id: input.remoteInstallationId || undefined,
      clientId: input.clientId || `meteomate-desktop-${process.platform}`,
      skillId: input.skillId,
      version: input.version,
      scope: input.scope || 'user',
      projectId: input.projectId || '',
    };
    const result = await jsonRequest('/v1/installations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (input.localInstallationId && result?.id && capabilityService.updateSkillHubState) {
      capabilityService.updateSkillHubState(input.localInstallationId, {
        skillHubInstallationId: result.id,
        skillId: input.skillId,
        version: input.version,
        baseUrl: profileContext?.baseUrl() || DEFAULT_BASE_URL,
      });
    }
    return result;
  }

  async function reportUninstallation(input = {}) {
    const id = String(input.remoteInstallationId || '').trim();
    if (!id || !profileContext?.isAuthenticated()) return { skipped: true, reason: id ? 'anonymous' : 'not-reported' };
    return jsonRequest(`/v1/installations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function applyManagedPolicy(snapshot = null) {
    const policyContext = snapshot?.policyContext || profileContext?.policyContext();
    const policy = policyContext?.policy;
    if (!policy || !profileContext?.hasActiveProfile()) return { installed: [], skipped: [], errors: [] };
    const expectedProfileKey = snapshot?.profileKey || currentProfileKey();
    assertActiveProfile(expectedProfileKey);
    const revision = Number(policy.revision || 0);
    const defaultSkillIds = [...new Set((policy.defaultSkillIds || []).map(String).filter(Boolean))];
    capabilityService.syncManagedSkills(defaultSkillIds, revision);
    const result = { installed: [], skipped: [], errors: [] };
    for (const skillId of defaultSkillIds) {
      assertActiveProfile(expectedProfileKey);
      let current = capabilityService.registrySnapshot().skills.find(
        (item) => item.scope === 'user' && item.skillId === skillId && item.enabled
      );
      let remoteError = null;
      try {
        if (!profileContext.isAuthenticated()) throw new Error('offline');
        const detail = await skillDetail(skillId);
        assertActiveProfile(expectedProfileKey);
        const version = detail?.skill?.latestVersion;
        const published = (detail?.versions || []).some((item) => item.version === version && item.status === 'published');
        if (!version || !published) throw new Error('组织默认 Skill 没有可安装的已发布版本');
        if (current && compareSkillVersions(current.version, version) >= 0) {
          if (!current.remote?.skillHubInstallationId) {
            await reportInstallation({
              localInstallationId: current.id,
              skillId,
              version: current.version,
              scope: 'user',
            });
          }
          result.skipped.push({ skillId, reason: 'up-to-date', version: current.version });
          continue;
        }
        const inspection = await downloadAndInspect({ skillId, version, expectedProfileKey });
        if (!inspection.report.autoInstallEligible) throw new Error('组织默认 Skill 风险较高，需要管理员改为低风险包后再下发');
        assertActiveProfile(expectedProfileKey);
        const installed = capabilityService.installSkill({
          token: inspection.token,
          reportHash: inspection.report.reportHash,
          scope: 'user',
          replace: Boolean(current),
          managedByPolicy: true,
          managedPolicyRevision: revision,
        });
        assertActiveProfile(expectedProfileKey);
        await reportInstallation({
          localInstallationId: installed.installation.id,
          remoteInstallationId: current?.remote?.skillHubInstallationId,
          skillId,
          version,
          scope: 'user',
        });
        result.installed.push({
          skillId,
          source: 'skillhub',
          version: installed.installation.version,
          upgraded: Boolean(current),
        });
        continue;
      } catch (error) {
        remoteError = error;
      }
      try {
        assertActiveProfile(expectedProfileKey);
        const bundled = capabilityService.installBundledDefault(skillId, revision);
        if (bundled) {
          current = bundled.installation;
          if (bundled.installed) {
            result.installed.push({ skillId, source: 'bundled', version: current.version, upgraded: Boolean(bundled.upgraded) });
          } else {
            result.skipped.push({ skillId, reason: 'bundled-up-to-date', version: current.version });
          }
          continue;
        }
        if (current) {
          result.skipped.push({ skillId, reason: 'installed-offline', version: current.version });
          continue;
        }
        if (!profileContext.isAuthenticated()) {
          result.skipped.push({ skillId, reason: 'offline' });
          continue;
        }
        throw remoteError;
      } catch (error) {
        result.errors.push({ skillId, message: error?.message || String(error) });
      }
    }
    return result;
  }

  async function publishDraft(input = {}) {
    if (!skillCreatorService) throw new Error('Skill Creator 服务不可用');
    const detail = skillCreatorService.getDraft(input.draftId);
    if (!detail?.inspection) throw new Error(detail?.validationError || 'Skill 草稿未通过基础校验');
    if (detail.inspection.risk?.level === 'critical') throw new Error('严重风险 Skill 不能发布到 SkillHub');
    if (!detail.ready && !input.overrideValidation) throw new Error('Skill 尚未通过全部测试，请修复或明确忽略非严重问题');
    const skillId = detail.inspection.skill.id;
    const version = detail.inspection.skill.version;
    const bytes = ZipWriter.createZipBuffer(detail.draft.skillRoot, { prefix: skillId });
    const form = new FormData();
    form.append('package', new Blob([bytes], { type: 'application/zip' }), `${skillId}-${version}.zip`);
    form.append('metadata', JSON.stringify({
      name: input.name || detail.draft.displayName || skillId,
      summary: input.summary || detail.inspection.skill.description,
      description: input.description || detail.inspection.skill.description,
      categories: input.categories || [detail.draft.brief?.category || '自定义技能'],
      tags: input.tags || [],
      visibility: input.visibility || 'private',
      changelog: input.changelog || 'Published from MeteoMate Skill Creator',
    }));
    const upload = await jsonRequest(`/v1/skills/${encodeURIComponent(skillId)}/versions`, { method: 'POST', body: form, timeoutMs: 45_000 });
    let published = null;
    if (input.publish !== false) {
      published = await jsonRequest(`/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/publish`, { method: 'POST' });
    }
    return { upload, published, skillId, version };
  }

  function registerIpc() {
    ipcMain.handle('skillhub:get-settings', async () => publicSettings());
    ipcMain.handle('skillhub:save-settings', async (_event, request) => saveSettings(request || {}));
    ipcMain.handle('skillhub:test', async () => testConnection());
    ipcMain.handle('skillhub:list-skills', async (_event, request) => listSkills(request || {}));
    ipcMain.handle('skillhub:list-managed-skills', async (_event, request) => listManagedSkills(request || {}));
    ipcMain.handle('skillhub:list-experts', async (_event, request) => listExperts(request || {}));
    ipcMain.handle('skillhub:sync-experts', async () => syncExperts());
    ipcMain.handle('skillhub:list-publishers', async () => listPublishers());
    ipcMain.handle('skillhub:update-skill', async (_event, request) => updateSkill(request || {}));
    ipcMain.handle('skillhub:publish-version', async (_event, request) => publishVersion(request || {}));
    ipcMain.handle('skillhub:deprecate-version', async (_event, request) => deprecateVersion(request || {}));
    ipcMain.handle('skillhub:list-collections', async () => listCollections());
    ipcMain.handle('skillhub:recommendations', async (_event, request) => recommendations(request || {}));
    ipcMain.handle('skillhub:get-skill', async (_event, id) => skillDetail(id));
    ipcMain.handle('skillhub:download-inspect', async (_event, request) => downloadAndInspect(request || {}));
    ipcMain.handle('skillhub:report-installation', async (_event, request) => reportInstallation(request || {}));
    ipcMain.handle('skillhub:report-uninstallation', async (_event, request) => reportUninstallation(request || {}));
    ipcMain.handle('skillhub:publish-draft', async (_event, request) => publishDraft(request || {}));
  }

  profileContext?.onChange((snapshot) => {
    settingsCache = null;
    policySync = policySync.then(() => applyManagedPolicy(snapshot)).catch(() => ({ installed: [], skipped: [], errors: [] }));
    void syncExperts().catch(() => null);
  });

  return {
    registerIpc,
    publicSettings,
    saveSettings,
    testConnection,
    listSkills,
    listManagedSkills,
    listExperts,
    syncExperts,
    listPublishers,
    updateSkill,
    publishVersion,
    deprecateVersion,
    listCollections,
    recommendations,
    skillDetail,
    downloadAndInspect,
    reportInstallation,
    reportUninstallation,
    applyManagedPolicy,
    publishDraft,
  };
}

module.exports = { createSkillHubClient, normalizeBaseURL };
