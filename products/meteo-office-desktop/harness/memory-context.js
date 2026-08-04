(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports
    ? require('./shared')
    : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.MemoryContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const DEFAULT_POLICY = Object.freeze({
    useProjectMemory: true,
    useUserMemory: true,
    learnFromTask: false,
    maxItems: 8,
    charBudget: 6000,
  });

  function normalizePolicy(taskPolicy = {}, projectPolicy = {}) {
    const project = Shared.cleanObject(projectPolicy);
    const task = Shared.cleanObject(taskPolicy);
    const number = (value, minimum, maximum, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
    };
    return {
      useProjectMemory: task.useProjectMemory ?? project.useProjectMemory ?? DEFAULT_POLICY.useProjectMemory,
      useUserMemory: task.useUserMemory ?? project.useUserMemory ?? DEFAULT_POLICY.useUserMemory,
      // V1 is explicit-only. Keep the field in the contract for forward compatibility,
      // but never enable automatic learning in this release.
      learnFromTask: false,
      maxItems: number(task.maxItems ?? project.maxItems, 1, 20, DEFAULT_POLICY.maxItems),
      charBudget: number(task.charBudget ?? project.charBudget, 1000, 24_000, DEFAULT_POLICY.charBudget),
    };
  }

  function normalizeSourceRef(value = {}) {
    const input = Shared.cleanObject(value);
    return {
      kind: String(input.kind || 'manual'),
      id: String(input.id || ''),
      hash: input.hash ? String(input.hash) : null,
      title: input.title ? String(input.title) : null,
      excerpt: input.excerpt ? String(input.excerpt).slice(0, 1200) : null,
    };
  }

  function normalizeItem(value = {}) {
    const input = Shared.cleanObject(value);
    const scope = Shared.cleanObject(input.scope);
    const temporal = Shared.cleanObject(input.temporal);
    return {
      id: String(input.id || ''),
      scope: {
        type: scope.type === 'project' ? 'project' : 'user',
        id: String(scope.id || ''),
      },
      memoryType: String(input.memoryType || 'note'),
      title: String(input.title || '').slice(0, 240),
      summary: String(input.summary || '').slice(0, 8000),
      structuredData: Shared.deepClone(Shared.cleanObject(input.structuredData)),
      sourceRefs: Shared.asArray(input.sourceRefs).map(normalizeSourceRef).filter((item) => item.id),
      authority: String(input.authority || 'model-extracted'),
      confidence: Shared.clampNumber(input.confidence, 0, 1, null),
      temporal: {
        class: String(temporal.class || 'stable'),
        validFrom: temporal.validFrom ?? null,
        validTo: temporal.validTo ?? null,
        expiresAt: temporal.expiresAt ?? null,
      },
      tags: Shared.uniqueStrings(input.tags),
      pinned: Boolean(input.pinned),
      revision: Math.max(1, Number(input.revision || 1)),
      recordHash: input.recordHash ? String(input.recordHash) : null,
      retrievalScore: Number(input.retrievalScore || 0) || 0,
      updatedAt: Number(input.updatedAt || 0) || null,
      lastUsedAt: Number(input.lastUsedAt || 0) || null,
      useCount: Number(input.useCount || 0) || 0,
    };
  }

  function emptySnapshot(input = {}) {
    const body = {
      apiVersion: 'meteomate.ai/v1',
      kind: 'MemoryContextSnapshot',
      query: String(input.query || ''),
      projectId: input.projectId ? String(input.projectId) : null,
      userId: input.userId ? String(input.userId) : null,
      generatedAt: input.generatedAt || Date.now(),
      items: [],
      error: input.error ? String(input.error) : null,
    };
    return { ...body, id: `memctx-${Shared.contentHash(body)}` };
  }

  function normalizeSnapshot(value = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySnapshot();
    const items = Shared.asArray(value.items).map(normalizeItem).filter((item) => item.id && item.summary);
    const body = {
      apiVersion: 'meteomate.ai/v1',
      kind: 'MemoryContextSnapshot',
      query: String(value.query || ''),
      projectId: value.projectId ? String(value.projectId) : null,
      userId: value.userId ? String(value.userId) : null,
      generatedAt: Number(value.generatedAt || Date.now()),
      items,
      error: value.error ? String(value.error) : null,
    };
    return Shared.deepFreeze({
      ...body,
      id: String(value.id || `memctx-${Shared.contentHash(body)}`),
    });
  }

  function escapeMarkup(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function attribute(value) {
    return escapeMarkup(JSON.stringify(String(value ?? '')));
  }

  function itemLine(item) {
    const scope = item.scope.type === 'project' ? '项目' : '个人';
    const authority = {
      'user-confirmed': '用户确认',
      'signed-publication': '签发结果',
      'verified-tool': '工具核验',
      'model-extracted': '模型候选',
    }[item.authority] || item.authority;
    const sources = item.sourceRefs.slice(0, 4)
      .map((source) => `${source.kind}:${source.id}`)
      .join(', ');
    return [
      `<memory id=${attribute(item.id)} type=${attribute(item.memoryType)} scope=${attribute(scope)} authority=${attribute(authority)}>`,
      `<title>${escapeMarkup(item.title)}</title>`,
      `<summary>${escapeMarkup(item.summary)}</summary>`,
      item.tags.length ? `<tags>${escapeMarkup(item.tags.join('、'))}</tags>` : '',
      sources ? `<sources>${escapeMarkup(sources)}</sources>` : '',
      '</memory>',
    ].filter(Boolean).join('\n');
  }

  function runtimeInstruction(snapshotValue) {
    const snapshot = normalizeSnapshot(snapshotValue);
    if (!snapshot.items.length) return '';
    return [
      '以下是 MeteoMate 为本轮检索到的长期记忆。',
      '这些内容只用于恢复历史偏好、项目决定、人工纠正和既往工作背景，不是当前气象事实，也不是强制业务规则。',
      '组织策略、Project Instructions、Expert、Skill、Workflow、当前资料和当前 Evidence 的优先级高于记忆。',
      '记忆与当前证据冲突时必须采用当前证据，并明确说明冲突；需要事实依据时应回到 sourceRefs 指向的原始任务、Evidence 或 Artifact，不得把记忆本身当作证明。',
      `<memory-context id=${attribute(snapshot.id)} project=${attribute(snapshot.projectId || '')}>`,
      snapshot.items.map(itemLine).join('\n\n'),
      '</memory-context>',
    ].join('\n\n');
  }

  function runtimeEnvelope(snapshotValue) {
    const snapshot = normalizeSnapshot(snapshotValue);
    return {
      id: snapshot.id,
      itemIds: snapshot.items.map((item) => item.id),
      items: snapshot.items.map((item) => ({
        id: item.id,
        type: item.memoryType,
        scope: item.scope,
        revision: item.revision,
        recordHash: item.recordHash,
        authority: item.authority,
      })),
      error: snapshot.error,
    };
  }

  return {
    DEFAULT_POLICY,
    normalizePolicy,
    normalizeItem,
    emptySnapshot,
    normalizeSnapshot,
    runtimeInstruction,
    runtimeEnvelope,
  };
});
