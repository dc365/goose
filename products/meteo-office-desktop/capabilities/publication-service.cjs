'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ValidationEngine = require('../harness/validation-engine');
const SecurityMode = require('./security-mode.cjs');

function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value ?? null))).digest('hex');
}

function fileContentHash(filePath) {
  try {
    if (!filePath || !fs.statSync(filePath).isFile()) return null;
    const descriptor = fs.openSync(filePath, 'r');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
      let bytesRead;
      do {
        bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead);
      return hash.digest('hex');
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return null;
  }
}

function artifactDigest(artifacts) {
  return stableDigest((Array.isArray(artifacts) ? artifacts : []).map((artifact) => ({
    ...artifact,
    actualFileHash: fileContentHash(artifact?.path),
  })));
}

function createPublicationService({
  ipcMain,
  profileContext,
  allowSyntheticForTesting = false,
  securityMode = process.env.METEOMATE_SECURITY_MODE,
} = {}) {
  if (!ipcMain || !profileContext) throw new Error('Publication service requires ipcMain and profileContext');
  const mode = SecurityMode.normalizeSecurityMode(securityMode);

  function storePath() {
    return path.join(profileContext.currentPaths().root, 'publication-signoffs.json');
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
      return {
        apiVersion: 'meteomate.ai/v1',
        kind: 'PublicationSignoffRegistry',
        version: 1,
        signoffs: parsed?.signoffs && typeof parsed.signoffs === 'object' ? parsed.signoffs : {},
        updatedAt: parsed?.updatedAt || null,
      };
    } catch {
      return {
        apiVersion: 'meteomate.ai/v1',
        kind: 'PublicationSignoffRegistry',
        version: 1,
        signoffs: {},
        updatedAt: null,
      };
    }
  }

  function save(registry) {
    registry.updatedAt = new Date().toISOString();
    atomicWrite(storePath(), registry);
  }

  function taskId(input = {}) {
    const id = String(input.taskId || input.id || '').trim();
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(id)) throw new Error('任务标识无效');
    return id;
  }

  function currentSignoff(id) {
    return load().signoffs[id] || null;
  }

  function gate(input = {}, signoff = currentSignoff(taskId(input))) {
    const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    const result = ValidationEngine.runPublicationGate({
      analysis: input.analysis || {},
      artifacts,
      evidence,
      humanSignoff: signoff,
      allowSynthetic: allowSyntheticForTesting === true,
      at: input.at || Date.now(),
    });
    if (signoff?.approved) {
      const analysisDigest = stableDigest(input.analysis || {});
      const evidenceDigest = stableDigest(evidence);
      const currentArtifactDigest = artifactDigest(artifacts);
      if (
        signoff.analysisDigest !== analysisDigest
        || signoff.evidenceDigest !== evidenceDigest
        || signoff.artifactDigest !== currentArtifactDigest
      ) {
        result.ready = false;
        result.status = 'draft';
        result.blockers = [...new Set([...(result.blockers || []), '签发后的分析、证据或成果物已经变化，需要重新审核签发'])];
      }
    }
    return result;
  }

  function check(input = {}) {
    const id = taskId(input);
    const signoff = currentSignoff(id);
    return { taskId: id, signoff, gate: gate(input, signoff) };
  }

  function reviewer(input = {}) {
    const state = profileContext.publicState?.() || {};
    const user = state.user || state.cachedUser || {};
    if (mode === SecurityMode.MODES.STRICT && !profileContext.isAuthenticated?.()) {
      throw new Error('严格安全模式下正式签发需要在线登录');
    }
    if (
      mode === SecurityMode.MODES.STRICT
      && !['publisher', 'admin'].includes(String(user.role || '').trim().toLowerCase())
    ) {
      throw new Error('严格安全模式下正式签发需要发布权限');
    }
    const localUsername = (() => {
      try {
        return os.userInfo().username;
      } catch {
        return process.env.USER || process.env.USERNAME || 'local-user';
      }
    })();
    const reviewerId = String(
      user.id
      || input.reviewerId
      || `local:${localUsername}@${os.hostname()}`
    ).trim();
    const reviewerName = String(
      user.displayName
      || user.username
      || input.reviewerName
      || localUsername
    ).trim();
    return {
      reviewerId,
      reviewerName,
      reviewerRole: String(user.role || input.reviewerRole || 'local-reviewer').trim(),
      verification: user.id ? 'account-profile' : 'local-profile',
    };
  }

  function sign(input = {}) {
    const id = taskId(input);
    const actor = reviewer(input);
    const signoff = {
      approved: true,
      taskId: id,
      ...actor,
      note: String(input.note || '').trim().slice(0, 2000),
      analysisDigest: stableDigest(input.analysis || {}),
      evidenceDigest: stableDigest(input.evidence),
      artifactDigest: artifactDigest(input.artifacts),
      securityMode: mode,
      approvedAt: new Date().toISOString(),
    };
    const result = gate(input, signoff);
    if (!result.ready) {
      const reasons = result.blockers.filter((item) => !String(item).includes('缺少预报员或业务人员签发'));
      if (reasons.length) throw new Error(`发布门禁未通过：${reasons.join('；')}`);
    }
    const registry = load();
    registry.signoffs[id] = signoff;
    save(registry);
    return { taskId: id, signoff, gate: gate(input, signoff) };
  }

  function revoke(input = {}) {
    if (mode === SecurityMode.MODES.STRICT) reviewer(input);
    const id = taskId(input);
    const registry = load();
    const previous = registry.signoffs[id] || null;
    if (previous) {
      delete registry.signoffs[id];
      save(registry);
    }
    return { taskId: id, revoked: Boolean(previous), previous };
  }

  function registerIpc() {
    ipcMain.handle('publication:check', async (_event, input) => check(input || {}));
    ipcMain.handle('publication:sign', async (_event, input) => sign(input || {}));
    ipcMain.handle('publication:revoke', async (_event, input) => revoke(input || {}));
  }

  return { registerIpc, check, sign, revoke };
}

module.exports = { createPublicationService, stableDigest };
