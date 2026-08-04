'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // Keep application startup available; the memory service will report the missing backend on first use.
}

const STORE_VERSION = 1;
const MEMORY_TYPES = Object.freeze([
  'preference',
  'decision',
  'correction',
  'note',
  'task-summary',
  'case-summary',
  'procedure-candidate',
]);
const SCOPE_TYPES = Object.freeze(['user', 'project']);
const STATUSES = Object.freeze(['active', 'archived', 'superseded', 'rejected']);
const AUTHORITIES = Object.freeze([
  'user-confirmed',
  'signed-publication',
  'verified-tool',
  'model-extracted',
]);
const TEMPORAL_CLASSES = Object.freeze(['stable', 'operational', 'event']);
const SOURCE_KINDS = Object.freeze([
  'task',
  'run',
  'message',
  'evidence',
  'artifact',
  'signoff',
  'project',
  'manual',
]);

function assertEnum(value, values, label) {
  if (!values.includes(value)) throw new Error(`${label} 不受支持：${value}`);
  return value;
}

function text(value, maximum, label, { required = false } = {}) {
  const normalized = String(value ?? '').replace(/\u0000/g, '').trim();
  if (required && !normalized) throw new Error(`${label}不能为空`);
  if (normalized.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符`);
  return normalized;
}

function number(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function timestamp(value, label) {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}不是有效时间`);
  return Math.round(parsed);
}

function uniqueStrings(values, maximumItems = 32, maximumLength = 120) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value ?? '').trim();
    if (!item || seen.has(item)) continue;
    if (item.length > maximumLength) throw new Error(`标签或标识不能超过 ${maximumLength} 个字符`);
    seen.add(item);
    result.push(item);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseJSON(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSourceRefs(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const input = safeObject(value);
    const kind = SOURCE_KINDS.includes(input.kind) ? input.kind : 'manual';
    const id = text(input.id, 240, '来源 ID', { required: true });
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      kind,
      id,
      hash: text(input.hash, 160, '来源摘要') || null,
      excerpt: text(input.excerpt, 1200, '来源摘录') || null,
      title: text(input.title, 240, '来源标题') || null,
    });
    if (result.length >= 32) break;
  }
  return result;
}

function normalizeStructuredData(value) {
  const input = safeObject(value);
  const encoded = stableJson(input);
  if (Buffer.byteLength(encoded, 'utf8') > 128 * 1024) throw new Error('结构化记忆内容不能超过 128 KB');
  return input;
}

function normalizeInput(input = {}, existing = null, actor = {}) {
  const current = existing || {};
  const scope = safeObject(input.scope || current.scope);
  const scopeType = assertEnum(String(scope.type || current.scopeType || ''), SCOPE_TYPES, '记忆范围');
  const scopeId = text(scope.id || current.scopeId, 200, '记忆范围 ID', { required: true });
  const memoryType = assertEnum(
    String(input.memoryType || current.memoryType || 'note'),
    MEMORY_TYPES,
    '记忆类型'
  );
  const status = assertEnum(String(input.status || current.status || 'active'), STATUSES, '记忆状态');
  const authority = assertEnum(
    String(input.authority || current.authority || 'model-extracted'),
    AUTHORITIES,
    '记忆权威级别'
  );
  const temporal = safeObject(input.temporal || current.temporal);
  const temporalClass = assertEnum(
    String(temporal.class || current.temporalClass || 'stable'),
    TEMPORAL_CLASSES,
    '记忆时效类型'
  );
  const title = text(input.title ?? current.title, 240, '记忆标题', { required: true });
  const summary = text(input.summary ?? current.summary, 8000, '记忆内容', { required: true });
  const tags = uniqueStrings(input.tags ?? current.tags, 32, 80);
  const sourceRefs = normalizeSourceRefs(input.sourceRefs ?? current.sourceRefs);
  const structuredData = normalizeStructuredData(input.structuredData ?? current.structuredData);
  const supersedes = uniqueStrings(input.supersedes ?? current.supersedes, 32, 200);
  const createdByInput = safeObject(input.createdBy || current.createdBy);
  const createdBy = {
    type: ['user', 'system', 'model'].includes(createdByInput.type)
      ? createdByInput.type
      : actor.type || 'user',
    id: text(createdByInput.id || actor.id || '', 200, '创建者 ID') || null,
  };
  return {
    scopeType,
    scopeId,
    memoryType,
    title,
    summary,
    structuredData,
    sourceRefs,
    authority,
    confidence: number(input.confidence ?? current.confidence, 0, 1, authority === 'user-confirmed' ? 1 : 0.7),
    temporalClass,
    validFrom: timestamp(temporal.validFrom ?? current.validFrom, '生效时间'),
    validTo: timestamp(temporal.validTo ?? current.validTo, '失效时间'),
    expiresAt: timestamp(temporal.expiresAt ?? current.expiresAt, '过期时间'),
    status,
    supersedes,
    tags,
    pinned: Boolean(input.pinned ?? current.pinned),
    createdBy,
    extractorVersion: text(input.extractorVersion || current.extractorVersion || 'manual/v1', 120, '提取器版本'),
  };
}

function rowToMemory(row) {
  if (!row) return null;
  return {
    apiVersion: 'meteomate.ai/v1',
    kind: 'Memory',
    id: row.id,
    scope: { type: row.scope_type, id: row.scope_id },
    memoryType: row.memory_type,
    title: row.title,
    summary: row.summary,
    structuredData: parseJSON(row.structured_json, {}),
    sourceRefs: parseJSON(row.source_refs_json, []),
    authority: row.authority,
    confidence: Number(row.confidence),
    temporal: {
      class: row.temporal_class,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      expiresAt: row.expires_at,
    },
    status: row.status,
    supersedes: parseJSON(row.supersedes_json, []),
    tags: parseJSON(row.tags_json, []),
    pinned: Boolean(row.pinned),
    createdBy: {
      type: row.created_by_type,
      id: row.created_by_id || null,
    },
    extractorVersion: row.extractor_version,
    revision: Number(row.revision),
    recordHash: row.record_hash,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    useCount: Number(row.use_count || 0),
  };
}

function recordHash(record) {
  return sha256(stableJson({
    scope: { type: record.scopeType, id: record.scopeId },
    memoryType: record.memoryType,
    title: record.title,
    summary: record.summary,
    structuredData: record.structuredData,
    sourceRefs: record.sourceRefs,
    authority: record.authority,
    confidence: record.confidence,
    temporal: {
      class: record.temporalClass,
      validFrom: record.validFrom,
      validTo: record.validTo,
      expiresAt: record.expiresAt,
    },
    status: record.status,
    supersedes: record.supersedes,
    tags: record.tags,
    pinned: record.pinned,
  }));
}

function searchableText(memory) {
  return [memory.title, memory.summary, ...(memory.tags || [])].join(' ').toLocaleLowerCase('zh-CN');
}

function queryTokens(value) {
  const normalized = String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const tokens = new Set(normalized.match(/[a-z0-9_\-.]{2,}|[\p{Script=Han}]{1,}/gu) || []);
  for (const token of [...tokens]) {
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) tokens.add(token.slice(index, index + 2));
    }
  }
  return [...tokens].slice(0, 48);
}

function queryRelevant(memory, query, projectId) {
  const normalizedQuery = String(query || '').toLocaleLowerCase('zh-CN').trim();
  if (!normalizedQuery) return true;
  if (memory.pinned || ['preference', 'correction'].includes(memory.memoryType)) return true;
  if (memory.memoryType === 'decision' && memory.scope.type === 'project' && memory.scope.id === projectId) {
    return true;
  }
  const haystack = searchableText(memory);
  if (haystack.includes(normalizedQuery)) return true;
  return queryTokens(normalizedQuery).some((token) => haystack.includes(token));
}

function recencyScore(updatedAt, now) {
  const ageDays = Math.max(0, now - Number(updatedAt || 0)) / 86_400_000;
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.75;
  if (ageDays <= 30) return 0.45;
  if (ageDays <= 180) return 0.2;
  return 0;
}

function relevanceScore(memory, query, now, projectId) {
  const haystack = searchableText(memory);
  const normalizedQuery = String(query || '').toLocaleLowerCase('zh-CN').trim();
  const tokens = queryTokens(query);
  const matches = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
  const exact = normalizedQuery && haystack.includes(normalizedQuery) ? 1 : 0;
  const authority = {
    'user-confirmed': 3,
    'signed-publication': 2.8,
    'verified-tool': 2.2,
    'model-extracted': 0.8,
  }[memory.authority] || 0;
  const type = {
    correction: 1.5,
    decision: 1.25,
    preference: 1.2,
    'task-summary': 0.9,
    'case-summary': 0.8,
    note: 0.6,
    'procedure-candidate': 0.5,
  }[memory.memoryType] || 0;
  const scope = memory.scope.type === 'project' && memory.scope.id === projectId ? 2.5 : 1.25;
  const used = Math.min(1.5, Math.log2(1 + Number(memory.useCount || 0)) * 0.35);
  return scope + authority + type + (memory.pinned ? 3 : 0) + exact * 4
    + Math.min(6, matches * 0.9) + recencyScore(memory.updatedAt, now) + used;
}

function createMemoryStore({
  databasePath,
  clock = () => Date.now(),
  idFactory = () => `memory-${crypto.randomUUID()}`,
} = {}) {
  if (!databasePath || !path.isAbsolute(databasePath)) throw new Error('Memory store requires an absolute database path');
  if (!DatabaseSync) throw new Error('当前 Electron/Node 运行时不支持 node:sqlite，无法启用 MeteoMate 记忆');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      structured_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      authority TEXT NOT NULL,
      confidence REAL NOT NULL,
      temporal_class TEXT NOT NULL,
      valid_from INTEGER,
      valid_to INTEGER,
      expires_at INTEGER,
      status TEXT NOT NULL,
      supersedes_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      extractor_version TEXT NOT NULL,
      revision INTEGER NOT NULL,
      record_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS memories_scope_status_idx
      ON memories(scope_type, scope_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS memories_type_idx
      ON memories(memory_type, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS memories_expiry_idx
      ON memories(expires_at);
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT,
      action TEXT NOT NULL,
      actor_id TEXT,
      task_id TEXT,
      run_id TEXT,
      detail_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_events_memory_idx
      ON memory_events(memory_id, created_at DESC);
  `);
  db.prepare(`INSERT INTO memory_meta(key, value) VALUES('version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(STORE_VERSION));

  let ftsAvailable = true;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED, title, summary, tags, tokenize='unicode61 remove_diacritics 2'
    );`);
  } catch {
    ftsAvailable = false;
  }

  const selectById = db.prepare('SELECT * FROM memories WHERE id = ?');
  const deleteFts = ftsAvailable ? db.prepare('DELETE FROM memory_fts WHERE id = ?') : null;
  const insertFts = ftsAvailable
    ? db.prepare('INSERT INTO memory_fts(id, title, summary, tags) VALUES(?, ?, ?, ?)')
    : null;

  function syncFts(memory) {
    if (!ftsAvailable) return;
    deleteFts.run(memory.id);
    insertFts.run(memory.id, memory.title, memory.summary, (memory.tags || []).join(' '));
  }

  function event(action, memoryId, context = {}, detail = {}) {
    db.prepare(`INSERT INTO memory_events(memory_id, action, actor_id, task_id, run_id, detail_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)`).run(
      memoryId || null,
      action,
      context.actorId || null,
      context.taskId || null,
      context.runId || null,
      stableJson(detail || {}),
      Math.round(clock())
    );
  }

  function get(id) {
    return rowToMemory(selectById.get(String(id || '')));
  }

  function create(input = {}, context = {}) {
    const now = Math.round(clock());
    const normalized = normalizeInput(input, null, { type: 'user', id: context.actorId });
    const id = text(input.id || idFactory(), 200, '记忆 ID', { required: true });
    if (get(id)) throw new Error(`记忆已存在：${id}`);
    const hash = recordHash(normalized);
    const duplicate = rowToMemory(db.prepare(`SELECT * FROM memories
      WHERE scope_type = ? AND scope_id = ? AND record_hash = ?
      ORDER BY updated_at DESC LIMIT 1`).get(normalized.scopeType, normalized.scopeId, hash));
    if (duplicate) return duplicate;
    const transaction = () => {
      db.prepare(`INSERT INTO memories(
        id, scope_type, scope_id, memory_type, title, summary, structured_json, source_refs_json,
        authority, confidence, temporal_class, valid_from, valid_to, expires_at, status,
        supersedes_json, tags_json, pinned, created_by_type, created_by_id, extractor_version,
        revision, record_hash, created_at, updated_at, last_used_at, use_count
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, 0)`)
        .run(
          id,
          normalized.scopeType,
          normalized.scopeId,
          normalized.memoryType,
          normalized.title,
          normalized.summary,
          stableJson(normalized.structuredData),
          stableJson(normalized.sourceRefs),
          normalized.authority,
          normalized.confidence,
          normalized.temporalClass,
          normalized.validFrom,
          normalized.validTo,
          normalized.expiresAt,
          normalized.status,
          stableJson(normalized.supersedes),
          stableJson(normalized.tags),
          normalized.pinned ? 1 : 0,
          normalized.createdBy.type,
          normalized.createdBy.id,
          normalized.extractorVersion,
          hash,
          now,
          now
        );
      const memory = get(id);
      syncFts(memory);
      event('created', id, context, { revision: 1, recordHash: hash });
      return memory;
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = transaction();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function update(id, patch = {}, context = {}) {
    const existing = get(id);
    if (!existing) throw new Error('记忆不存在');
    const expectedRevision = Number(context.baseRevision ?? patch.baseRevision ?? existing.revision);
    if (expectedRevision !== existing.revision) {
      const error = new Error(`记忆已被其他操作修改，当前版本为 ${existing.revision}`);
      error.code = 'MEMORY_REVISION_CONFLICT';
      error.current = existing;
      throw error;
    }
    const normalized = normalizeInput(patch, {
      scopeType: existing.scope.type,
      scopeId: existing.scope.id,
      memoryType: existing.memoryType,
      title: existing.title,
      summary: existing.summary,
      structuredData: existing.structuredData,
      sourceRefs: existing.sourceRefs,
      authority: existing.authority,
      confidence: existing.confidence,
      temporalClass: existing.temporal.class,
      validFrom: existing.temporal.validFrom,
      validTo: existing.temporal.validTo,
      expiresAt: existing.temporal.expiresAt,
      status: existing.status,
      supersedes: existing.supersedes,
      tags: existing.tags,
      pinned: existing.pinned,
      createdBy: existing.createdBy,
      extractorVersion: existing.extractorVersion,
    }, { type: existing.createdBy.type, id: existing.createdBy.id });
    const revision = existing.revision + 1;
    const now = Math.round(clock());
    const hash = recordHash(normalized);
    if (hash === existing.recordHash) return existing;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare(`UPDATE memories SET
        scope_type = ?, scope_id = ?, memory_type = ?, title = ?, summary = ?,
        structured_json = ?, source_refs_json = ?, authority = ?, confidence = ?,
        temporal_class = ?, valid_from = ?, valid_to = ?, expires_at = ?, status = ?,
        supersedes_json = ?, tags_json = ?, pinned = ?, extractor_version = ?,
        revision = ?, record_hash = ?, updated_at = ?
        WHERE id = ? AND revision = ?`).run(
          normalized.scopeType,
          normalized.scopeId,
          normalized.memoryType,
          normalized.title,
          normalized.summary,
          stableJson(normalized.structuredData),
          stableJson(normalized.sourceRefs),
          normalized.authority,
          normalized.confidence,
          normalized.temporalClass,
          normalized.validFrom,
          normalized.validTo,
          normalized.expiresAt,
          normalized.status,
          stableJson(normalized.supersedes),
          stableJson(normalized.tags),
          normalized.pinned ? 1 : 0,
          normalized.extractorVersion,
          revision,
          hash,
          now,
          existing.id,
          existing.revision
        );
      if (Number(result.changes) !== 1) {
        const error = new Error('记忆更新发生并发冲突');
        error.code = 'MEMORY_REVISION_CONFLICT';
        throw error;
      }
      const memory = get(existing.id);
      syncFts(memory);
      event('updated', existing.id, context, {
        previousRevision: existing.revision,
        revision,
        recordHash: hash,
      });
      db.exec('COMMIT');
      return memory;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function setStatus(id, status, context = {}) {
    return update(id, { status }, context);
  }

  function remove(id, context = {}) {
    const existing = get(id);
    if (!existing) return false;
    if (context.baseRevision != null && Number(context.baseRevision) !== existing.revision) {
      const error = new Error(`记忆已被其他操作修改，当前版本为 ${existing.revision}`);
      error.code = 'MEMORY_REVISION_CONFLICT';
      error.current = existing;
      throw error;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM memories WHERE id = ?').run(existing.id);
      if (ftsAvailable) deleteFts.run(existing.id);
      event('deleted', existing.id, context, { revision: existing.revision, recordHash: existing.recordHash });
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function list(query = {}) {
    const clauses = [];
    const values = [];
    if (query.scopeType) {
      clauses.push('scope_type = ?');
      values.push(assertEnum(String(query.scopeType), SCOPE_TYPES, '记忆范围'));
    }
    if (query.scopeId) {
      clauses.push('scope_id = ?');
      values.push(String(query.scopeId));
    }
    if (query.projectId || query.userId) {
      const scopes = [];
      if (query.projectId) {
        scopes.push('(scope_type = ? AND scope_id = ?)');
        values.push('project', String(query.projectId));
      }
      if (query.userId) {
        scopes.push('(scope_type = ? AND scope_id = ?)');
        values.push('user', String(query.userId));
      }
      clauses.push(`(${scopes.join(' OR ')})`);
    }
    if (query.status && query.status !== 'all') {
      clauses.push('status = ?');
      values.push(assertEnum(String(query.status), STATUSES, '记忆状态'));
    }
    if (query.memoryType && query.memoryType !== 'all') {
      clauses.push('memory_type = ?');
      values.push(assertEnum(String(query.memoryType), MEMORY_TYPES, '记忆类型'));
    }
    if (query.search) {
      const pattern = `%${String(query.search).trim()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_')}%`;
      clauses.push(`(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')`);
      values.push(pattern, pattern, pattern);
    }
    const limit = Math.min(500, Math.max(1, Number(query.limit || 100)));
    const offset = Math.max(0, Number(query.offset || 0));
    const order = query.order === 'oldest'
      ? 'created_at ASC'
      : query.order === 'used'
        ? 'COALESCE(last_used_at, 0) DESC, updated_at DESC'
        : 'pinned DESC, updated_at DESC';
    const sql = `SELECT * FROM memories${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY ${order} LIMIT ? OFFSET ?`;
    values.push(limit, offset);
    return db.prepare(sql).all(...values).map(rowToMemory);
  }

  function retrieve(query = {}) {
    const now = Math.round(clock());
    const projectId = String(query.projectId || '');
    const userId = String(query.userId || '');
    const includeProject = query.includeProject !== false && Boolean(projectId);
    const includeUser = query.includeUser !== false && Boolean(userId);
    if (!includeProject && !includeUser) return [];
    const scopes = [];
    const values = ['active', now, now, now];
    if (includeProject) {
      scopes.push('(scope_type = ? AND scope_id = ?)');
      values.push('project', projectId);
    }
    if (includeUser) {
      scopes.push('(scope_type = ? AND scope_id = ?)');
      values.push('user', userId);
    }
    const rows = db.prepare(`SELECT * FROM memories
      WHERE status = ?
        AND (expires_at IS NULL OR expires_at > ?)
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_to IS NULL OR valid_to > ?)
        AND (${scopes.join(' OR ')})
      ORDER BY pinned DESC, updated_at DESC
      LIMIT 500`).all(...values).map(rowToMemory);
    const ranked = rows
      .filter((memory) => queryRelevant(memory, query.query || '', projectId))
      .map((memory) => ({ memory, score: relevanceScore(memory, query.query || '', now, projectId) }))
      .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt);
    const limit = Math.min(20, Math.max(1, Number(query.limit || 8)));
    const charBudget = Math.min(24_000, Math.max(1000, Number(query.charBudget || 6000)));
    const items = [];
    let usedChars = 0;
    for (const entry of ranked) {
      const size = entry.memory.title.length + entry.memory.summary.length + 120;
      if (items.length && usedChars + size > charBudget) continue;
      items.push({ ...entry.memory, retrievalScore: Number(entry.score.toFixed(4)) });
      usedChars += size;
      if (items.length >= limit || usedChars >= charBudget) break;
    }
    return items;
  }

  function markUsed(ids, context = {}) {
    const unique = uniqueStrings(ids, 100, 200);
    if (!unique.length) return [];
    const now = Math.round(clock());
    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = [];
      const statement = db.prepare(`UPDATE memories SET
        use_count = use_count + 1,
        last_used_at = ?,
        updated_at = updated_at
        WHERE id = ?`);
      for (const id of unique) {
        const result = statement.run(now, id);
        if (Number(result.changes) !== 1) continue;
        event('used', id, context, { projectId: context.projectId || null });
        const memory = get(id);
        if (memory) updated.push(memory);
      }
      db.exec('COMMIT');
      return updated;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function history(id, limit = 100) {
    return db.prepare(`SELECT * FROM memory_events WHERE memory_id = ?
      ORDER BY created_at DESC LIMIT ?`).all(String(id || ''), Math.min(500, Math.max(1, Number(limit || 100))))
      .map((row) => ({
        id: row.id,
        memoryId: row.memory_id,
        action: row.action,
        actorId: row.actor_id,
        taskId: row.task_id,
        runId: row.run_id,
        detail: parseJSON(row.detail_json, {}),
        createdAt: Number(row.created_at),
      }));
  }

  function stats(query = {}) {
    const items = list({ ...query, limit: 500, offset: 0, status: query.status || 'all' });
    const byType = {};
    const byStatus = {};
    const byScope = {};
    for (const memory of items) {
      byType[memory.memoryType] = (byType[memory.memoryType] || 0) + 1;
      byStatus[memory.status] = (byStatus[memory.status] || 0) + 1;
      byScope[memory.scope.type] = (byScope[memory.scope.type] || 0) + 1;
    }
    return { total: items.length, byType, byStatus, byScope };
  }

  function close() {
    db.close();
  }

  return {
    version: STORE_VERSION,
    path: () => databasePath,
    ftsAvailable: () => ftsAvailable,
    create,
    get,
    update,
    setStatus,
    remove,
    list,
    retrieve,
    markUsed,
    history,
    stats,
    close,
  };
}

module.exports = {
  STORE_VERSION,
  MEMORY_TYPES,
  SCOPE_TYPES,
  STATUSES,
  AUTHORITIES,
  TEMPORAL_CLASSES,
  createMemoryStore,
  normalizeInput,
  normalizeSourceRefs,
};
