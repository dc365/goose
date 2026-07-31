'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const EvidenceLedger = require('../harness/evidence-ledger');
const QcPolicy = require('../harness/qc-policy');
const ValidationEngine = require('../harness/validation-engine');
const PublicationContracts = require('./publication-contracts.cjs');
const { createPublicationAttestor } = require('./publication-attestor.cjs');
const SecurityMode = require('./security-mode.cjs');
const { TRUSTED_WEATHER_TOOLS } = require('./weather-result-collector.cjs');

const RECORD_ATTESTATION_VERSION = 'meteomate-publication/v2';
const INVALIDATION_LOG_FILE = 'publication-audit-invalidations.jsonl';
const INVALIDATION_ANCHOR_FILE = 'publication-audit-anchor.json';
const INVALIDATION_LOG_VERSION = 'meteomate-publication-invalidation/v1';
const EMPTY_INVALIDATION_HEAD = '0'.repeat(64);
const MAX_INVALIDATION_LOG_BYTES = 16 * 1024 * 1024;
const REGISTRY_VERSION = 3;

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
  const metadata = artifact?.metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error(`成果物 ${id} 缺少可信元数据`);
  if (
    typeof metadata.classification !== 'string'
    || !['demo', 'experimental', 'beta', 'production'].includes(metadata.classification)
  ) {
    throw new Error(`成果物 ${id} 成熟度分类无效`);
  }
  if (typeof metadata.synthetic !== 'boolean') throw new Error(`成果物 ${id} 构造数据标记必须为布尔值`);
  if (metadata.official != null && typeof metadata.official !== 'boolean') {
    throw new Error(`成果物 ${id} 官方来源标记必须为布尔值`);
  }

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
  dialog = null,
  publicationAttestor: requestedPublicationAttestor,
  safeStorage = null,
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
  if (
    typeof publicationAttestor.attestAuditRecord !== 'function'
    || typeof publicationAttestor.verifyAuditRecord !== 'function'
  ) {
    throw new Error('Publication service requires audit record attestation');
  }

  function currentTime() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

  function storePath() {
    return path.join(profileContext.currentPaths().root, 'publication-signoffs.json');
  }

  function invalidationPath() {
    return path.join(profileContext.currentPaths().root, INVALIDATION_LOG_FILE);
  }

  function invalidationAnchorPath() {
    return path.join(profileContext.currentPaths().root, INVALIDATION_ANCHOR_FILE);
  }

  function validateInvalidation(record) {
    const kind = record?.kind;
    if (
      !['PublicationSignoff', 'EvidenceQcWaiver'].includes(kind)
      || !record?.id
      || !record?.revokedAt
      || !publicationAttestor.verifyAuditRecord(kind, record, { taskId: record.taskId })
    ) {
      throw new Error('发布撤销日志未通过主进程签名验证');
    }
    return record;
  }

  function normalizedAnchor(value) {
    if (value == null) return null;
    const generation = Number(value.generation);
    const head = String(value.head || '');
    if (
      !Number.isSafeInteger(generation)
      || generation < 0
      || !/^[a-f0-9]{64}$/.test(head)
    ) {
      throw new Error('发布撤销日志锚点格式无效');
    }
    return { generation, head };
  }

  function secureAnchorAvailable() {
    if (mode !== SecurityMode.MODES.STRICT) return false;
    try {
      return safeStorage?.isEncryptionAvailable?.() === true
        && String(safeStorage?.getSelectedStorageBackend?.() || '') !== 'basic_text';
    } catch {
      return false;
    }
  }

  function readInvalidationAnchor() {
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(invalidationAnchorPath(), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new Error(`发布撤销日志锚点无法读取：${error?.message || String(error)}`);
    }
    if (envelope?.scheme === 'electron-safe-storage') {
      if (mode !== SecurityMode.MODES.STRICT) {
        throw new Error('发布撤销日志锚点由严格安全存储保护，当前模式无法验证');
      }
      if (!secureAnchorAvailable()) throw new Error('发布撤销日志安全锚点当前不可解密');
      try {
        return normalizedAnchor(JSON.parse(
          safeStorage.decryptString(Buffer.from(String(envelope.data || ''), 'base64')),
        ));
      } catch {
        throw new Error('发布撤销日志安全锚点解密失败');
      }
    }
    if (envelope?.scheme === 'profile-fallback') {
      if (mode === SecurityMode.MODES.STRICT) {
        return { migrateToSecureStorage: true, value: normalizedAnchor(envelope.value) };
      }
      return normalizedAnchor(envelope.value);
    }
    if (envelope?.generation != null && envelope?.head) {
      if (mode === SecurityMode.MODES.STRICT) {
        throw new Error('严格安全模式不接受旧版发布撤销锚点');
      }
      return normalizedAnchor(envelope);
    }
    throw new Error('发布撤销日志锚点格式无效');
  }

  function writeInvalidationAnchor(anchor) {
    const normalized = normalizedAnchor(anchor);
    let envelope;
    if (secureAnchorAvailable()) {
      envelope = {
        version: 1,
        scheme: 'electron-safe-storage',
        data: safeStorage.encryptString(JSON.stringify(normalized)).toString('base64'),
      };
    } else {
      if (mode === SecurityMode.MODES.STRICT) {
        throw new Error('严格安全模式下系统安全存储不可用，无法提交发布撤销记录');
      }
      envelope = {
        version: 1,
        scheme: 'profile-fallback',
        value: normalized,
      };
    }
    atomicWrite(invalidationAnchorPath(), envelope);
    const stored = readInvalidationAnchor();
    if (stored.generation !== normalized.generation || stored.head !== normalized.head) {
      throw new Error('发布撤销日志锚点写入后校验失败');
    }
  }

  function anchorProtection() {
    return secureAnchorAvailable() ? 'secret-store' : 'profile-fallback';
  }

  function invalidationHead(previousHead, generation, record) {
    return stableDigest({
      domain: INVALIDATION_LOG_VERSION,
      previousHead,
      generation,
      record,
    });
  }

  function loadInvalidationState({ allowAnchorInitialization = false } = {}) {
    const target = invalidationPath();
    let descriptor;
    let contents = '';
    try {
      descriptor = fs.openSync(
        target,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('发布撤销日志无法读取');
    }
    if (descriptor != null) {
      try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size > MAX_INVALIDATION_LOG_BYTES) {
          throw new Error('发布撤销日志格式无效');
        }
        contents = fs.readFileSync(descriptor, 'utf8');
      } finally {
        fs.closeSync(descriptor);
      }
    }

    const entries = [];
    let generation = 0;
    let head = EMPTY_INVALIDATION_HEAD;
    let uncommittedTailBytes = null;
    const lines = contents.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        const trailingPartial = index === lines.length - 1 && !contents.endsWith('\n');
        if (!trailingPartial) throw new Error('发布撤销日志包含无效 JSON');
        uncommittedTailBytes = Buffer.byteLength(line);
        break;
      }
      const legacyRecord = parsed?.kind ? parsed : null;
      const record = validateInvalidation(legacyRecord || parsed?.record);
      const nextGeneration = generation + 1;
      const nextHead = invalidationHead(head, nextGeneration, record);
      if (!legacyRecord && (
        parsed.version !== INVALIDATION_LOG_VERSION
        || parsed.generation !== nextGeneration
        || parsed.previousHead !== head
        || parsed.head !== nextHead
      )) {
        throw new Error('发布撤销日志链校验失败');
      }
      generation = nextGeneration;
      head = nextHead;
      entries.push({ generation, head, record });
    }

    const storedAnchor = readInvalidationAnchor();
    const migrateToSecureStorage = storedAnchor?.migrateToSecureStorage === true;
    let anchor = migrateToSecureStorage ? storedAnchor.value : storedAnchor;
    if (uncommittedTailBytes != null) {
      const prefixMatchesAnchor = anchor
        ? anchor.generation === generation && anchor.head === head
        : generation === 0;
      if (!prefixMatchesAnchor) throw new Error('发布撤销日志包含未提交且无法恢复的尾部记录');
      let descriptor;
      try {
        descriptor = fs.openSync(
          target,
          fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0),
        );
        const committedBytes = Buffer.byteLength(contents) - uncommittedTailBytes;
        fs.ftruncateSync(descriptor, committedBytes);
        fs.fsyncSync(descriptor);
      } finally {
        if (descriptor != null) fs.closeSync(descriptor);
      }
    }
    if (!anchor && generation > 0 && allowAnchorInitialization) {
      anchor = { generation, head };
      writeInvalidationAnchor(anchor);
    }
    if (anchor && anchor.generation < generation) {
      const anchoredHead = anchor.generation === 0
        ? EMPTY_INVALIDATION_HEAD
        : entries[anchor.generation - 1]?.head;
      if (anchor.head !== anchoredHead) {
        throw new Error('发布撤销日志与受保护锚点不一致');
      }
      anchor = { generation, head };
      writeInvalidationAnchor(anchor);
    }
    if (
      (anchor && (anchor.generation !== generation || anchor.head !== head))
      || (!anchor && generation > 0)
    ) {
      throw new Error('发布撤销日志与受保护锚点不一致');
    }
    if (anchor && generation === 0 && anchor.generation > 0) {
      throw new Error('发布撤销日志已被删除或回滚');
    }
    if (anchor && migrateToSecureStorage) writeInvalidationAnchor(anchor);
    return { entries, generation, head };
  }

  function appendInvalidation(record) {
    validateInvalidation(record);
    const state = loadInvalidationState();
    const generation = state.generation + 1;
    const head = invalidationHead(state.head, generation, record);
    const entry = {
      version: INVALIDATION_LOG_VERSION,
      generation,
      previousHead: state.head,
      head,
      record,
    };
    const encodedEntry = Buffer.from(`${JSON.stringify(entry)}\n`, 'utf8');
    const target = invalidationPath();
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    let originalSize = 0;
    try {
      originalSize = fs.statSync(target).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (originalSize + encodedEntry.length > MAX_INVALIDATION_LOG_BYTES) {
      throw new Error('发布撤销日志已达到容量上限，需要归档后继续');
    }
    let descriptor;
    try {
      descriptor = fs.openSync(
        target,
        fs.constants.O_WRONLY
          | fs.constants.O_APPEND
          | fs.constants.O_CREAT
          | (fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
      if (!fs.fstatSync(descriptor).isFile()) throw new Error('发布撤销日志不是普通文件');
      let offset = 0;
      while (offset < encodedEntry.length) {
        const written = fs.writeSync(
          descriptor,
          encodedEntry,
          offset,
          encodedEntry.length - offset,
        );
        if (written <= 0) throw new Error('发布撤销日志写入不完整');
        offset += written;
      }
      fs.fsyncSync(descriptor);
    } finally {
      if (descriptor != null) fs.closeSync(descriptor);
    }
    writeInvalidationAnchor({ generation, head });
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
  }

  function invalidatedIds(kind, state = loadInvalidationState()) {
    return new Set(
      state.entries
        .map((entry) => entry.record)
        .filter((record) => record.kind === kind)
        .map((record) => String(record.id || ''))
        .filter(Boolean),
    );
  }

  function emptyRegistry() {
    return {
      apiVersion: 'meteomate.ai/v1',
      kind: 'PublicationSignoffRegistry',
      version: REGISTRY_VERSION,
      signoffs: {},
      signoffHistory: {},
      legacySignoffs: {},
      qcWaivers: {},
      legacyQcWaivers: {},
      invalidationGeneration: 0,
      invalidationHead: EMPTY_INVALIDATION_HEAD,
      anchorProtection: anchorProtection(),
      updatedAt: null,
    };
  }

  function registryObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`发布审计存储 ${label} 格式无效`);
    }
    return value;
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
      registryObject(parsed, 'root');
      const sourceVersion = Number(parsed?.version || 1);
      if (
        !Number.isSafeInteger(sourceVersion)
        || sourceVersion < 1
        || sourceVersion > REGISTRY_VERSION
      ) {
        throw new Error('发布审计存储版本无效');
      }
      const legacyRegistry = sourceVersion < REGISTRY_VERSION;
      const signoffs = parsed.signoffs == null ? {} : registryObject(parsed.signoffs, 'signoffs');
      const signoffHistory = parsed.signoffHistory == null
        ? {}
        : registryObject(parsed.signoffHistory, 'signoffHistory');
      const legacySignoffs = parsed.legacySignoffs == null
        ? {}
        : registryObject(parsed.legacySignoffs, 'legacySignoffs');
      const qcWaivers = parsed.qcWaivers == null ? {} : registryObject(parsed.qcWaivers, 'qcWaivers');
      const legacyQcWaivers = parsed.legacyQcWaivers == null
        ? {}
        : registryObject(parsed.legacyQcWaivers, 'legacyQcWaivers');
      for (const [id, record] of Object.entries(signoffs)) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error(`发布审计存储任务 ${id} 的签发记录格式无效`);
        }
      }
      for (const [id, history] of Object.entries(signoffHistory)) {
        if (!Array.isArray(history)) {
          throw new Error(`发布审计存储任务 ${id} 的签发历史格式无效`);
        }
      }
      for (const [id, waivers] of Object.entries(qcWaivers)) {
        if (!Array.isArray(waivers)) {
          throw new Error(`发布审计存储任务 ${id} 的 QC 豁免格式无效`);
        }
      }
      const storedAnchorProtection = String(parsed.anchorProtection || 'profile-fallback');
      if (!['profile-fallback', 'secret-store'].includes(storedAnchorProtection)) {
        throw new Error('发布审计存储锚点保护模式无效');
      }
      const claimedGeneration = Number(parsed.invalidationGeneration || 0);
      const claimedHead = String(parsed.invalidationHead || EMPTY_INVALIDATION_HEAD);
      const invalidationState = loadInvalidationState({
        allowAnchorInitialization: legacyRegistry
          || (claimedGeneration === 0 && claimedHead === EMPTY_INVALIDATION_HEAD),
      });
      if (!legacyRegistry) {
        const registryGeneration = Number(parsed.invalidationGeneration);
        const registryHead = String(parsed.invalidationHead || '');
        if (
          !Number.isSafeInteger(registryGeneration)
          || registryGeneration < 0
          || registryGeneration > invalidationState.generation
        ) {
          throw new Error('发布审计存储撤销代次无效');
        }
        const expectedHead = registryGeneration === 0
          ? EMPTY_INVALIDATION_HEAD
          : invalidationState.entries[registryGeneration - 1]?.head;
        if (registryHead !== expectedHead) {
          throw new Error('发布审计存储撤销锚点不匹配');
        }
      }
      const recoveredSignoffHistory = clone(signoffHistory);
      const recoveredQcWaivers = clone(legacyRegistry ? {} : qcWaivers);
      for (const { record } of invalidationState.entries) {
        if (record.kind === 'PublicationSignoff') {
          const history = recoveredSignoffHistory[record.taskId];
          if (history != null && !Array.isArray(history)) {
            throw new Error(`发布审计存储任务 ${record.taskId} 的签发历史格式无效`);
          }
          recoveredSignoffHistory[record.taskId] = history || [];
          if (!recoveredSignoffHistory[record.taskId].some((item) =>
            item?.id === record.id && item?.revokedAt === record.revokedAt
          )) {
            recoveredSignoffHistory[record.taskId].push(clone(record));
          }
        } else {
          const waivers = recoveredQcWaivers[record.taskId];
          if (waivers != null && !Array.isArray(waivers)) {
            throw new Error(`发布审计存储任务 ${record.taskId} 的 QC 豁免历史格式无效`);
          }
          recoveredQcWaivers[record.taskId] = waivers || [];
          const index = recoveredQcWaivers[record.taskId]
            .findIndex((item) => item?.id === record.id);
          if (index >= 0) recoveredQcWaivers[record.taskId][index] = clone(record);
          else recoveredQcWaivers[record.taskId].push(clone(record));
        }
      }
      return {
        apiVersion: 'meteomate.ai/v1',
        kind: 'PublicationSignoffRegistry',
        version: REGISTRY_VERSION,
        signoffs: legacyRegistry ? {} : signoffs,
        signoffHistory: recoveredSignoffHistory,
        legacySignoffs: {
          ...legacySignoffs,
          ...(legacyRegistry ? signoffs : {}),
        },
        qcWaivers: recoveredQcWaivers,
        legacyQcWaivers: {
          ...legacyQcWaivers,
          ...(legacyRegistry ? qcWaivers : {}),
        },
        invalidationGeneration: invalidationState.generation,
        invalidationHead: invalidationState.head,
        anchorProtection: anchorProtection(),
        updatedAt: parsed?.updatedAt || null,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRegistry();
      throw new Error(`发布审计存储无法读取：${error?.message || String(error)}`);
    }
  }

  function save(registry) {
    const invalidationState = loadInvalidationState();
    registry.version = REGISTRY_VERSION;
    registry.invalidationGeneration = invalidationState.generation;
    registry.invalidationHead = invalidationState.head;
    registry.anchorProtection = anchorProtection();
    registry.updatedAt = new Date().toISOString();
    atomicWrite(storePath(), registry);
  }

  function taskId(input = {}) {
    const id = String(input.taskId || input.id || '').trim();
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(id)) throw new Error('任务标识无效');
    return id;
  }

  function verifiedStoredSignoff(id, registry = load()) {
    const signoff = registry.signoffs[id] || null;
    if (!signoff) return null;
    if (!publicationAttestor.verifyAuditRecord('PublicationSignoff', signoff, { taskId: id })) {
      throw new Error('签发审计记录未通过主进程签名验证');
    }
    return clone(signoff);
  }

  function currentSignoff(id, registry = load()) {
    const signoff = verifiedStoredSignoff(id, registry);
    if (
      !signoff
      || signoff.revokedAt
      || signoff.securityMode !== mode
      || !PublicationContracts.validate(
        PublicationContracts.CONTRACT_KINDS.SIGNOFF,
        signoff,
      ).valid
      || invalidatedIds('PublicationSignoff').has(signoff.id)
    ) {
      return null;
    }
    return signoff;
  }

  function verifiedStoredQcWaivers(id, registry = load()) {
    const waivers = Array.isArray(registry.qcWaivers[id]) ? registry.qcWaivers[id] : [];
    for (const waiver of waivers) {
      if (!publicationAttestor.verifyAuditRecord('EvidenceQcWaiver', waiver, { taskId: id })) {
        throw new Error(`QC 豁免 ${waiver?.id || '未知'} 未通过主进程签名验证`);
      }
    }
    return clone(waivers);
  }

  function currentQcWaivers(id, registry = load()) {
    const invalidated = invalidatedIds('EvidenceQcWaiver');
    return verifiedStoredQcWaivers(id, registry).filter((waiver) =>
      !waiver.revokedAt
      && waiver.securityMode === mode
      && PublicationContracts.validate(
        PublicationContracts.CONTRACT_KINDS.QC_WAIVER,
        waiver,
      ).valid
      && !invalidated.has(waiver.id)
    );
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
    if (record?.metadata?.publicationAttestation?.version !== RECORD_ATTESTATION_VERSION) {
      const label = kind === 'Evidence' ? '证据' : '成果物';
      throw new Error(`${label} ${record?.id || record?.name || '未命名记录'} 使用旧版证明，需要重新运行后再发布`);
    }
    return clone(record);
  }

  function canonicalEvidence(record, id) {
    const verified = verifiedRecord('Evidence', record, id);
    const label = String(verified?.id || '未命名证据');
    const metadata = verified?.metadata || {};
    if (
      typeof metadata.classification !== 'string'
      || metadata.classification !== metadata.classification.trim()
      || !['demo', 'experimental', 'beta', 'production'].includes(metadata.classification)
    ) {
      throw new Error(`证据 ${label} 缺少可信成熟度分类`);
    }
    if (typeof metadata.synthetic !== 'boolean') {
      throw new Error(`证据 ${label} 构造数据标记必须为布尔值`);
    }
    if (typeof metadata.official !== 'boolean') {
      throw new Error(`证据 ${label} 官方来源标记必须为布尔值`);
    }
    const toolContract = TRUSTED_WEATHER_TOOLS[String(metadata.toolName || '')];
    if (
      !toolContract?.evidence
      || toolContract.extensionName !== String(metadata.extensionName || '')
    ) {
      throw new Error(`证据 ${label} 缺少可信 Connector/Tool 来源`);
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
    const evidenceIds = new Set(evidence.map((record) => String(record?.id || '')).filter(Boolean));
    for (const artifact of artifacts) {
      const linkedEvidenceIds = Array.isArray(artifact?.lineage?.evidenceIds)
        ? artifact.lineage.evidenceIds.map(String).filter(Boolean)
        : [];
      if (!linkedEvidenceIds.length) {
        throw new Error(`成果物 ${artifact?.id || artifact?.name || '未命名'} 缺少 Evidence 血缘`);
      }
      for (const evidenceId of linkedEvidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          throw new Error(`成果物 ${artifact?.id || artifact?.name || '未命名'} 引用了请求中不存在的证据 ${evidenceId}`);
        }
      }
    }
    const conclusions = input?.analysis?.conclusions
      || input?.analysis?.forecastConclusions
      || input?.analysis?.forecast_conclusions
      || [];
    for (const conclusion of Array.isArray(conclusions) ? conclusions : []) {
      for (const evidenceId of conclusion?.evidenceIds || conclusion?.evidence_ids || []) {
        if (!evidenceIds.has(String(evidenceId))) {
          throw new Error(`预报结论引用了请求中不存在的证据 ${evidenceId}`);
        }
      }
    }
    return {
      taskId: id,
      workspace,
      analysis: clone(input.analysis || {}),
      artifacts,
      evidence,
    };
  }

  function snapshotDigests(snapshot, qcWaivers = []) {
    const workspaceDigest = stableDigest(snapshot.workspace);
    return {
      workspaceDigest,
      analysisDigest: stableDigest(snapshot.analysis),
      evidenceDigest: stableDigest(snapshot.evidence),
      artifactDigest: stableDigest(snapshot.artifacts),
      qcWaiverDigest: stableDigest(qcWaivers),
      qcPolicyVersion: QcPolicy.POLICY_VERSION,
      qcPolicyDigest: QcPolicy.POLICY_DIGEST,
    };
  }

  function evidenceDigest(record) {
    return stableDigest(EvidenceLedger.semanticRecord(record));
  }

  function strictAuthorizationError() {
    if (mode !== SecurityMode.MODES.STRICT) return null;
    if (profileContext.isAuthenticated?.() !== true) {
      return '严格安全模式下发布需要在线登录';
    }
    const state = profileContext.publicState?.() || {};
    if (
      state.expiresAt
      && (
        QcPolicy.rfc3339Timestamp(state.expiresAt) == null
        || QcPolicy.rfc3339Timestamp(state.expiresAt) <= currentTime()
      )
    ) {
      return '严格安全模式下登录会话已经过期';
    }
    const user = state.user || state.cachedUser || {};
    if (!['publisher', 'admin'].includes(String(user.role || '').trim().toLowerCase())) {
      return '严格安全模式下发布需要发布权限';
    }
    return null;
  }

  function gate(
    snapshot,
    signoff = currentSignoff(snapshot.taskId),
    qcWaivers = currentQcWaivers(snapshot.taskId),
  ) {
    const result = ValidationEngine.runPublicationGate({
      taskId: snapshot.taskId,
      analysis: snapshot.analysis,
      artifacts: snapshot.artifacts,
      evidence: snapshot.evidence,
      qcWaivers,
      humanSignoff: signoff,
      allowSynthetic: allowSyntheticForTesting === true,
      workspaceDigest: stableDigest(snapshot.workspace),
      evidenceDigest,
      securityMode: mode,
      at: currentTime(),
    });
    const authorizationError = strictAuthorizationError();
    if (authorizationError) {
      result.ready = false;
      result.status = 'draft';
      result.blockers = [...new Set([...(result.blockers || []), authorizationError])];
    }
    if (signoff?.approved) {
      const digests = snapshotDigests(snapshot, qcWaivers);
      if (
        signoff.analysisDigest !== digests.analysisDigest
        || signoff.evidenceDigest !== digests.evidenceDigest
        || signoff.artifactDigest !== digests.artifactDigest
        || signoff.qcWaiverDigest !== digests.qcWaiverDigest
        || signoff.workspaceDigest !== digests.workspaceDigest
        || signoff.qcPolicyVersion !== digests.qcPolicyVersion
        || signoff.qcPolicyDigest !== digests.qcPolicyDigest
        || signoff.snapshotDigest !== stableDigest({ taskId: snapshot.taskId, ...digests })
      ) {
        result.ready = false;
        result.status = 'draft';
        result.blockers = [...new Set([...(result.blockers || []), '签发后的工作区、分析、证据、成果物、QC 政策或豁免已经变化，需要重新审核签发'])];
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
        qcPolicyVersion: QcPolicy.POLICY_VERSION,
        qcPolicyDigest: QcPolicy.POLICY_DIGEST,
        waivableQcStatuses: ['suspect'],
      },
      qc: QcPolicy.summarize(),
    };
  }

  function check(input = {}) {
    const id = taskId(input);
    let signoff;
    let qcWaivers;
    let storedQcWaivers;
    try {
      const registry = load();
      signoff = currentSignoff(id, registry);
      storedQcWaivers = verifiedStoredQcWaivers(id, registry);
      qcWaivers = currentQcWaivers(id, registry);
    } catch (error) {
      return {
        taskId: id,
        signoff: null,
        qcWaivers: [],
        gate: rejectedGate(error, null),
      };
    }
    try {
      return {
        taskId: id,
        signoff,
        qcWaivers: storedQcWaivers,
        gate: gate(validatedSnapshot(input, id), signoff, qcWaivers),
      };
    } catch (error) {
      return {
        taskId: id,
        signoff,
        qcWaivers: storedQcWaivers,
        gate: rejectedGate(error, signoff),
      };
    }
  }

  function reviewer() {
    const state = profileContext.publicState?.() || {};
    const authenticated = profileContext.isAuthenticated?.() === true;
    const user = authenticated ? state.user || state.cachedUser || {} : {};
    const authorizationError = strictAuthorizationError();
    if (authorizationError) throw new Error(authorizationError.replace('发布需要', '正式签发需要'));
    const localUsername = (() => {
      try {
        return os.userInfo().username;
      } catch {
        return process.env.USER || process.env.USERNAME || 'local-user';
      }
    })();
    const reviewerId = String(
      user.id
      || `local:${localUsername}@${os.hostname()}`
    ).trim();
    const reviewerName = String(
      user.displayName
      || user.username
      || localUsername
    ).trim();
    return {
      reviewerId,
      reviewerName,
      reviewerRole: String(user.role || 'local-reviewer').trim(),
      verification: user.id ? 'account-profile' : 'local-profile',
    };
  }

  function requiredRevocationReason(input = {}) {
    const reason = String(input.reason || '').trim();
    if (reason.length < 8 || reason.length > 1000) {
      throw new Error('撤销理由必须包含 8-1000 个字符');
    }
    return reason;
  }

  function assertMutationAuthority(record) {
    if (record?.securityMode === SecurityMode.MODES.STRICT && mode !== SecurityMode.MODES.STRICT) {
      throw new Error('严格安全模式创建的审计记录只能由已认证发布人员在严格模式下变更');
    }
  }

  async function trustedConfirmation(action, input = {}) {
    if (typeof dialog?.showMessageBox !== 'function') {
      throw new Error('当前运行环境无法提供主进程人工确认');
    }
    const labels = {
      sign: '确认签发当前预报产品',
      'waive-qc': '确认创建 QC 人工豁免',
      revoke: '确认撤销当前签发',
      'revoke-qc': '确认撤销 QC 人工豁免',
    };
    const details = [
      `任务：${taskId(input)}`,
      input.evidenceId ? `Evidence：${String(input.evidenceId)}` : '',
      input.waiverId ? `豁免：${String(input.waiverId)}` : '',
      input.reason ? `理由：${String(input.reason).trim().slice(0, 1000)}` : '',
    ].filter(Boolean);
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'MeteoMate 发布审核',
      message: labels[action] || '确认发布审核操作',
      detail: details.join('\n'),
      buttons: ['取消', '确认'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) throw new Error('用户已取消发布审核操作');
    return {
      method: 'electron-main-dialog',
      action,
      challengeId: crypto.randomUUID(),
      confirmedAt: new Date(currentTime()).toISOString(),
    };
  }

  function revokedAuditRecord(kind, previous, actor, reason, confirmation = null) {
    const revoked = publicationAttestor.attestAuditRecord(
      kind,
      {
        ...previous,
        revokedAt: new Date(currentTime()).toISOString(),
        revokedBy: actor.reviewerId,
        revokedByName: actor.reviewerName,
        revocationReason: String(reason || '').trim().slice(0, 1000),
        ...(confirmation ? { revocationConfirmation: confirmation } : {}),
      },
      { taskId: previous.taskId },
    );
    return revoked;
  }

  function sign(input = {}, context = {}) {
    const id = taskId(input);
    const actor = reviewer();
    let snapshot;
    try {
      snapshot = validatedSnapshot(input, id);
    } catch (error) {
      throw new Error(`发布门禁未通过：${error?.message || String(error)}`);
    }
    const registry = load();
    const qcWaivers = currentQcWaivers(id, registry);
    const previous = verifiedStoredSignoff(id, registry);
    assertMutationAuthority(previous);
    const digests = snapshotDigests(snapshot, qcWaivers);
    const candidate = {
      apiVersion: 'meteomate/v1',
      kind: 'PublicationSignoff',
      id: `publication-signoff-${crypto.randomUUID()}`,
      approved: true,
      taskId: id,
      ...actor,
      note: String(input.note || '').trim().slice(0, 2000),
      ...digests,
      snapshotDigest: stableDigest({ taskId: id, ...digests }),
      securityMode: mode,
      signedAt: new Date(currentTime()).toISOString(),
      ...(context.confirmation ? { confirmation: context.confirmation } : {}),
    };
    const result = gate(snapshot, candidate, qcWaivers);
    if (!result.ready) {
      const reasons = result.blockers.filter((item) => !String(item).includes('缺少预报员或业务人员签发'));
      if (reasons.length) throw new Error(`发布门禁未通过：${reasons.join('；')}`);
    }
    const signoff = publicationAttestor.attestAuditRecord(
      'PublicationSignoff',
      candidate,
      { taskId: id },
    );
    PublicationContracts.validateOrThrow(
      PublicationContracts.CONTRACT_KINDS.SIGNOFF,
      signoff,
    );
    if (
      previous
      && !previous.revokedAt
      && !invalidatedIds('PublicationSignoff').has(previous.id)
    ) {
      const superseded = revokedAuditRecord(
        'PublicationSignoff',
        previous,
        actor,
        `由签发 ${signoff.id} 取代`,
      );
      appendInvalidation(superseded);
      registry.signoffHistory[id] = Array.isArray(registry.signoffHistory[id])
        ? registry.signoffHistory[id]
        : [];
      registry.signoffHistory[id].push(superseded);
    }
    registry.signoffs[id] = signoff;
    save(registry);
    return {
      taskId: id,
      signoff,
      qcWaivers,
      gate: gate(snapshot, signoff, qcWaivers),
    };
  }

  function revoke(input = {}, context = {}) {
    const actor = reviewer();
    const id = taskId(input);
    const reason = requiredRevocationReason(input);
    const registry = load();
    const previous = verifiedStoredSignoff(id, registry);
    assertMutationAuthority(previous);
    const alreadyInvalidated = previous
      ? invalidatedIds('PublicationSignoff').has(previous.id)
      : false;
    if (previous && !previous.revokedAt && !alreadyInvalidated) {
      const revoked = revokedAuditRecord(
        'PublicationSignoff',
        previous,
        actor,
        reason,
        context.confirmation,
      );
      appendInvalidation(revoked);
      registry.signoffHistory[id] = Array.isArray(registry.signoffHistory[id])
        ? registry.signoffHistory[id]
        : [];
      registry.signoffHistory[id].push(revoked);
      delete registry.signoffs[id];
      save(registry);
    }
    return {
      taskId: id,
      revoked: Boolean(previous && !previous.revokedAt && !alreadyInvalidated),
      previous,
    };
  }

  function waiveQc(input = {}, context = {}) {
    const id = taskId(input);
    const actor = reviewer();
    let snapshot;
    try {
      snapshot = validatedSnapshot(input, id);
    } catch (error) {
      throw new Error(`QC 豁免未通过：${error?.message || String(error)}`);
    }
    const evidenceId = String(input.evidenceId || '').trim();
    const evidence = snapshot.evidence.find((record) => String(record?.id || '') === evidenceId);
    if (!evidence) throw new Error('QC 豁免未通过：目标 Evidence 不在本次权威输入中');
    const qc = QcPolicy.normalizeEvidenceQc(evidence);
    if (qc.qcVersion !== QcPolicy.POLICY_VERSION || qc.qcStatus !== 'suspect') {
      throw new Error('QC 豁免未通过：仅当前政策版本的 suspect Evidence 可以人工豁免');
    }
    const registry = load();
    const storedQcWaivers = verifiedStoredQcWaivers(id, registry);
    const qcWaivers = currentQcWaivers(id, registry);
    const workspaceDigest = stableDigest(snapshot.workspace);
    const digest = evidenceDigest(evidence);
    const existing = qcWaivers.find((waiver) => QcPolicy.waiverMatches(evidence, waiver, {
      taskId: id,
      workspaceDigest,
      evidenceDigest: digest,
      at: currentTime(),
    }));
    if (existing) {
      const signoff = currentSignoff(id, registry);
      return {
        taskId: id,
        signoff,
        qcWaivers,
        gate: gate(snapshot, signoff, qcWaivers),
      };
    }
    const approvedAt = currentTime();
    const candidate = {
      apiVersion: 'meteomate/v1',
      kind: 'EvidenceQcWaiver',
      id: `qc-waiver-${crypto.randomUUID()}`,
      policyVersion: QcPolicy.POLICY_VERSION,
      policyDigest: QcPolicy.POLICY_DIGEST,
      taskId: id,
      workspaceDigest,
      evidenceId,
      evidenceDigest: digest,
      qcStatus: 'suspect',
      reason: String(input.reason || '').trim(),
      ...actor,
      securityMode: mode,
      approvedAt: new Date(approvedAt).toISOString(),
      expiresAt: new Date(approvedAt + QcPolicy.MAX_WAIVER_DURATION_MS).toISOString(),
      ...(context.confirmation ? { confirmation: context.confirmation } : {}),
    };
    const validation = QcPolicy.validateWaiver(candidate);
    if (!validation.valid) {
      throw new Error(`QC 豁免未通过：${validation.errors.join('；')}`);
    }
    const waiver = publicationAttestor.attestAuditRecord(
      'EvidenceQcWaiver',
      candidate,
      { taskId: id },
    );
    PublicationContracts.validateOrThrow(
      PublicationContracts.CONTRACT_KINDS.QC_WAIVER,
      waiver,
    );
    registry.qcWaivers[id] = [...storedQcWaivers, waiver];
    save(registry);
    const signoff = currentSignoff(id, registry);
    const updatedWaivers = currentQcWaivers(id, registry);
    return {
      taskId: id,
      signoff,
      qcWaivers: updatedWaivers,
      gate: gate(snapshot, signoff, updatedWaivers),
    };
  }

  function revokeQcWaiver(input = {}, context = {}) {
    const id = taskId(input);
    const actor = reviewer();
    const reason = requiredRevocationReason(input);
    const waiverId = String(input.waiverId || '').trim();
    if (!waiverId) throw new Error('撤销 QC 豁免需要豁免标识');
    const registry = load();
    const waivers = verifiedStoredQcWaivers(id, registry);
    const index = waivers.findIndex((waiver) => waiver.id === waiverId);
    if (index < 0) throw new Error('要撤销的 QC 豁免不存在');
    assertMutationAuthority(waivers[index]);
    const alreadyInvalidated = invalidatedIds('EvidenceQcWaiver').has(waiverId);
    if (!waivers[index].revokedAt && !alreadyInvalidated) {
      waivers[index] = revokedAuditRecord(
        'EvidenceQcWaiver',
        waivers[index],
        actor,
        reason,
        context.confirmation,
      );
      appendInvalidation(waivers[index]);
      registry.qcWaivers[id] = waivers;
      save(registry);
    }
    const result = check(input);
    return { ...result, revoked: true };
  }

  function registerIpc() {
    ipcMain.handle('publication:check', async (_event, input) => check(input || {}));
    ipcMain.handle('publication:sign', async (_event, input = {}) =>
      sign(input, { confirmation: await trustedConfirmation('sign', input) })
    );
    ipcMain.handle('publication:revoke', async (_event, input = {}) => {
      requiredRevocationReason(input);
      return revoke(input, { confirmation: await trustedConfirmation('revoke', input) });
    });
    ipcMain.handle('publication:waive-qc', async (_event, input = {}) =>
      waiveQc(input, { confirmation: await trustedConfirmation('waive-qc', input) })
    );
    ipcMain.handle('publication:revoke-qc-waiver', async (_event, input = {}) => {
      requiredRevocationReason(input);
      return revokeQcWaiver(input, {
        confirmation: await trustedConfirmation('revoke-qc', input),
      });
    });
  }

  return {
    registerIpc,
    check,
    sign,
    revoke,
    waiveQc,
    revokeQcWaiver,
    publicationAttestor,
  };
}

module.exports = { createPublicationService, stableDigest };
