'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ZipWriter = require('./zip-writer.cjs');

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

function createSkillHubClient({ app, ipcMain, safeStorage, capabilityService, skillCreatorService }) {
  let settingsCache = null;

  function settingsPath() {
    const root = path.join(app.getPath('userData'), 'capabilities');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return path.join(root, 'skillhub.json');
  }

  function encryptToken(token) {
    const text = String(token || '');
    if (!text) return null;
    if (safeStorage?.isEncryptionAvailable?.()) {
      return { scheme: 'electron-safe-storage', data: safeStorage.encryptString(text).toString('base64') };
    }
    return { scheme: 'base64-plain', data: Buffer.from(text, 'utf8').toString('base64') };
  }

  function decryptToken(record) {
    if (!record?.data) return '';
    try {
      const data = Buffer.from(record.data, 'base64');
      return record.scheme === 'electron-safe-storage' && safeStorage?.isEncryptionAvailable?.()
        ? safeStorage.decryptString(data)
        : data.toString('utf8');
    } catch {
      return '';
    }
  }

  function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      settingsCache = {
        baseUrl: normalizeBaseURL(parsed.baseUrl || process.env.METEOMATE_SKILLHUB_URL || DEFAULT_BASE_URL),
        token: parsed.token || null,
        requireSignature: parsed.requireSignature !== false,
      };
    } catch {
      settingsCache = {
        baseUrl: normalizeBaseURL(process.env.METEOMATE_SKILLHUB_URL || DEFAULT_BASE_URL),
        token: encryptToken(process.env.METEOMATE_SKILLHUB_TOKEN || ''),
        requireSignature: true,
      };
    }
    return settingsCache;
  }

  function publicSettings() {
    const settings = loadSettings();
    return {
      baseUrl: settings.baseUrl,
      tokenConfigured: Boolean(decryptToken(settings.token)),
      tokenStorage: settings.token?.scheme || 'none',
      encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()),
      requireSignature: settings.requireSignature,
    };
  }

  function saveSettings(input = {}) {
    const current = loadSettings();
    const next = {
      baseUrl: normalizeBaseURL(input.baseUrl || current.baseUrl),
      token: input.clearToken ? null : typeof input.token === 'string' && input.token ? encryptToken(input.token) : current.token,
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
    const token = decryptToken(loadSettings().token);
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function request(relative, options = {}) {
    const settings = loadSettings();
    const target = `${settings.baseUrl}${relative.startsWith('/') ? relative : `/${relative}`}`;
    const response = await fetch(target, {
      ...options,
      headers: authHeaders(options.headers || {}),
      signal: AbortSignal.timeout(options.timeoutMs || 20_000),
    });
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
    if (!response.ok) throw new Error(payload?.error?.message || `SkillHub 请求失败：${response.status} ${target}`);
    return payload;
  }

  async function testConnection() {
    const startedAt = Date.now();
    const health = await jsonRequest('/healthz', { timeoutMs: 8_000 });
    let identity = null;
    try {
      identity = await jsonRequest('/v1/me', { timeoutMs: 8_000 });
    } catch {
      // Public browsing remains usable without an authenticated token.
    }
    return { ok: health?.status === 'ok', durationMs: Date.now() - startedAt, health, identity, settings: publicSettings() };
  }

  async function listSkills(input = {}) {
    const query = new URLSearchParams();
    if (input.q) query.set('q', input.q);
    if (input.category) query.set('category', input.category);
    query.set('limit', String(Math.min(200, Math.max(1, Number(input.limit || 60)))));
    query.set('offset', String(Math.max(0, Number(input.offset || 0))));
    return jsonRequest(`/v1/skills?${query}`);
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
    const { response } = await request(`/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/download`, { timeoutMs: 45_000 });
    if (!response.ok) {
      let message = `下载失败：${response.status}`;
      try { message = (await response.json())?.error?.message || message; } catch {}
      throw new Error(message);
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > PACKAGE_LIMIT) throw new Error('SkillHub 包超过 64 MB 限制');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > PACKAGE_LIMIT) throw new Error('SkillHub 包超过 64 MB 限制');
    const verification = await verifyPackage({
      skillId,
      version,
      bytes,
      digest: response.headers.get('x-meteomate-digest'),
      signature: response.headers.get('x-meteomate-signature'),
      keyId: response.headers.get('x-meteomate-key-id'),
    });
    const temporary = path.join(capabilityService.paths().temp, `skillhub-${skillId}-${version}-${crypto.randomUUID()}.zip`);
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    try {
      const inspection = capabilityService.inspectSkill(temporary);
      fs.rmSync(temporary, { force: true });
      return { ...inspection, remote: { skillId, version, baseUrl: loadSettings().baseUrl, ...verification } };
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  async function reportInstallation(input = {}) {
    if (!decryptToken(loadSettings().token)) return { skipped: true, reason: 'anonymous' };
    return jsonRequest('/v1/installations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId || `meteomate-desktop-${process.platform}`,
        skillId: input.skillId,
        version: input.version,
        scope: input.scope || 'user',
        projectId: input.projectId || '',
      }),
    });
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
    ipcMain.handle('skillhub:list-collections', async () => listCollections());
    ipcMain.handle('skillhub:recommendations', async (_event, request) => recommendations(request || {}));
    ipcMain.handle('skillhub:get-skill', async (_event, id) => skillDetail(id));
    ipcMain.handle('skillhub:download-inspect', async (_event, request) => downloadAndInspect(request || {}));
    ipcMain.handle('skillhub:report-installation', async (_event, request) => reportInstallation(request || {}));
    ipcMain.handle('skillhub:publish-draft', async (_event, request) => publishDraft(request || {}));
  }

  return {
    registerIpc,
    publicSettings,
    saveSettings,
    testConnection,
    listSkills,
    listCollections,
    recommendations,
    skillDetail,
    downloadAndInspect,
    reportInstallation,
    publishDraft,
  };
}

module.exports = { createSkillHubClient, normalizeBaseURL };
