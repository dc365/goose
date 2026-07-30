'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ValidationEngine = require('../harness/validation-engine');
const { createPublicationAttestor } = require('./publication-attestor.cjs');
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

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function fileContentHash(filePath) {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('成果物不是普通文件');
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function canonicalWorkspace(workspace) {
  const value = String(workspace || '').trim();
  if (!value) throw new Error('发布请求缺少项目工作区');
  let root;
  try {
    root = fs.realpathSync(path.resolve(value));
  } catch {
    throw new Error('发布请求的项目工作区不存在');
  }
  if (!fs.statSync(root).isDirectory()) throw new Error('发布请求的项目工作区不是目录');
  return root;
}

function canonicalArtifact(artifact, workspace) {
  const id = String(artifact?.id || artifact?.name || '未命名成果物');
  const inputPath = String(artifact?.path || '').trim();
  if (!inputPath) throw new Error(`成果物 ${id} 缺少本地路径`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) {
    throw new Error(`成果物 ${id} 必须使用本地文件路径`);
  }

  const candidate = path.resolve(workspace, inputPath);
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    throw new Error(`成果物 ${id} 文件不存在`);
  }
  if (!inside(workspace, resolved)) throw new Error(`成果物 ${id} 通过符号链接逃逸项目工作区`);

  let actualHash;
  try {
    actualHash = fileContentHash(resolved);
  } catch (error) {
    if (String(error?.message || '').includes('不是普通文件')) {
      throw new Error(`成果物 ${id} 不是普通文件`);
    }
    throw new Error(`成果物 ${id} 无法读取`);
  }

  const reportedHash = String(artifact?.contentHash || '').trim().replace(/^sha256:/i, '').toLowerCase();
  if (!reportedHash) throw new Error(`成果物 ${id} 缺少内容摘要`);
  if (!/^[a-f0-9]{64}$/.test(reportedHash)) throw new Error(`成果物 ${id} 内容摘要格式无效`);
  if (reportedHash !== actualHash) throw new Error(`成果物 ${id} 内容摘要不匹配`);

  const uri = String(artifact?.uri || '').trim();
  let normalizedURI = null;
  if (uri) {
    let parsed;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error(`成果物 ${id} URI 无效`);
    }
    if (parsed.protocol !== 'file:') throw new Error(`成果物 ${id} 包含远程 URI`);
    let uriPath;
    try {
      uriPath = fs.realpathSync(fileURLToPath(parsed));
    } catch {
      throw new Error(`成果物 ${id} URI 指向的文件不存在`);
    }
    if (uriPath !== resolved) throw new Error(`成果物 ${id} URI 与本地路径不一致`);
    normalizedURI = pathToFileURL(resolved).href;
  }

  return {
    ...clone(artifact),
    path: resolved,
    uri: normalizedURI,
    contentHash: actualHash,
  };
}

function createPublicationService({
  ipcMain,
  profileContext,
  publicationAttestor: requestedPublicationAttestor,
  allowSyntheticForTesting = false,
  securityMode = process.env.METEOMATE_SECURITY_MODE,
  now = () => Date.now(),
} = {}) {
  if (!ipcMain || !profileContext) throw new Error('Publication service requires ipcMain and profileContext');
  const mode = SecurityMode.normalizeSecurityMode(securityMode);
  const publicationAttestor = requestedPublicationAttestor || createPublicationAttestor({ profileContext, now });
  if (typeof publicationAttestor.verifyRecord !== 'function') {
    throw new Error('Publication service requires a publication attestor');
  }

  function currentTime() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

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

  function verifiedRecord(kind, record, id) {
    let verified = false;
    try {
      verified = publicationAttestor.verifyRecord(kind, record, { taskId: id });
    } catch {
      verified = false;
    }
    if (!verified) {
      const label = kind === 'Evidence' ? '证据' : '成果物';
      throw new Error(`${label} ${record?.id || record?.name || '未命名记录'} 未通过主进程签名验证`);
    }
    return clone(record);
  }

  function canonicalEvidence(record, id) {
    const verified = verifiedRecord('Evidence', record, id);
    const label = String(verified?.id || '未命名证据');
    const metadata = verified?.metadata || {};
    const classification = String(metadata.classification || '').trim().toLowerCase();
    if (!['demo', 'experimental', 'beta', 'production'].includes(classification)) {
      throw new Error(`证据 ${label} 缺少可信成熟度分类`);
    }
    if (!String(metadata.sourceId || '').trim()) {
      throw new Error(`证据 ${label} 缺少资料源标识`);
    }
    const datasetHash = String(metadata.datasetHash || '')
      .trim()
      .replace(/^sha256:/i, '')
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(datasetHash)) {
      throw new Error(`证据 ${label} 缺少有效资料摘要`);
    }
    return verified;
  }

  function validatedSnapshot(input = {}, id = taskId(input)) {
    const workspace = canonicalWorkspace(input.workspace);
    const evidence = (Array.isArray(input.evidence) ? input.evidence : [])
      .map((record) => canonicalEvidence(record, id));
    const artifacts = (Array.isArray(input.artifacts) ? input.artifacts : [])
      .map((record) => canonicalArtifact(
        verifiedRecord('Artifact', record, id),
        workspace,
      ));
    return {
      taskId: id,
      workspace,
      analysis: clone(input.analysis || {}),
      artifacts,
      evidence,
    };
  }

  function snapshotDigests(snapshot) {
    return {
      analysisDigest: stableDigest(snapshot.analysis),
      evidenceDigest: stableDigest(snapshot.evidence),
      artifactDigest: stableDigest(snapshot.artifacts),
    };
  }

  function gate(snapshot, signoff = currentSignoff(snapshot.taskId)) {
    const result = ValidationEngine.runPublicationGate({
      analysis: snapshot.analysis,
      artifacts: snapshot.artifacts,
      evidence: snapshot.evidence,
      humanSignoff: signoff,
      allowSynthetic: allowSyntheticForTesting === true,
      at: currentTime(),
    });
    if (signoff?.approved) {
      const digests = snapshotDigests(snapshot);
      if (
        signoff.analysisDigest !== digests.analysisDigest
        || signoff.evidenceDigest !== digests.evidenceDigest
        || signoff.artifactDigest !== digests.artifactDigest
      ) {
        result.ready = false;
        result.status = 'draft';
        result.blockers = [...new Set([...(result.blockers || []), '签发后的分析、证据或成果物已经变化，需要重新审核签发'])];
      }
    }
    return result;
  }

  function rejectedGate(error, signoff) {
    return {
      ready: false,
      status: 'draft',
      blockers: [`发布输入校验失败：${error?.message || String(error)}`],
      warnings: [],
      checkedAt: currentTime(),
      signoff: signoff || null,
      policy: {
        allowSynthetic: allowSyntheticForTesting === true,
        humanSignoffRequired: true,
      },
    };
  }

  function check(input = {}) {
    const id = taskId(input);
    const signoff = currentSignoff(id);
    try {
      return { taskId: id, signoff, gate: gate(validatedSnapshot(input, id), signoff) };
    } catch (error) {
      return { taskId: id, signoff, gate: rejectedGate(error, signoff) };
    }
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
    let snapshot;
    try {
      snapshot = validatedSnapshot(input, id);
    } catch (error) {
      throw new Error(`发布门禁未通过：${error?.message || String(error)}`);
    }
    const digests = snapshotDigests(snapshot);
    const signoff = {
      approved: true,
      taskId: id,
      ...actor,
      note: String(input.note || '').trim().slice(0, 2000),
      ...digests,
      securityMode: mode,
      approvedAt: new Date(currentTime()).toISOString(),
    };
    const result = gate(snapshot, signoff);
    if (!result.ready) {
      const reasons = result.blockers.filter((item) => !String(item).includes('缺少预报员或业务人员签发'));
      if (reasons.length) throw new Error(`发布门禁未通过：${reasons.join('；')}`);
    }
    const registry = load();
    registry.signoffs[id] = signoff;
    save(registry);
    return { taskId: id, signoff, gate: result };
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

  return { registerIpc, check, sign, revoke, publicationAttestor };
}

module.exports = { createPublicationService, stableDigest };
