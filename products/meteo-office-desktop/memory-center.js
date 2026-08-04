(function initializeMeteoMateMemoryCenter(root) {
  'use strict';

  const api = root.meteoDesktop;
  if (!api?.listMemories) return;

  const TYPE_LABELS = Object.freeze({
    preference: '偏好',
    decision: '项目决定',
    correction: '人工纠正',
    note: '工作备注',
    'task-summary': '任务摘要',
    'case-summary': '历史过程',
    'procedure-candidate': '流程候选',
  });
  const STATUS_LABELS = Object.freeze({
    active: '已启用',
    archived: '已归档',
    superseded: '已替代',
    rejected: '已忽略',
  });
  const ui = {
    open: false,
    loading: false,
    saving: false,
    query: '',
    status: 'active',
    memoryType: 'all',
    items: [],
    stats: { total: 0 },
    selectedId: null,
    draft: null,
    error: '',
  };
  let observer = null;
  let searchTimer = null;
  let statsRequestKey = '';
  let statsRequestedAt = 0;
  let statsPending = false;
  let unsubscribeAccount = null;
  let accountKey = '';
  let lastTrigger = null;

  function html(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(value ?? ''));
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function memoryIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h8.5A2.5 2.5 0 0 1 18 7v12H8a3 3 0 0 1-3-3V6.5a2 2 0 0 1 2-2Z"/><path d="M8 4.5V17a2 2 0 0 0 2 2M10 8h5M10 12h5"/></svg>';
  }

  function currentTask() {
    try {
      return (typeof getActiveTask === 'function' && getActiveTask())
        || (typeof getAssistantTask === 'function' && getAssistantTask())
        || null;
    } catch {
      return null;
    }
  }

  function currentProject() {
    const task = currentTask();
    try {
      return (task && typeof getConversationProject === 'function' && getConversationProject(task))
        || (typeof getActiveProject === 'function' && getActiveProject())
        || null;
    } catch {
      return null;
    }
  }

  function currentAccount() {
    try {
      return typeof accountSession !== 'undefined' ? accountSession : null;
    } catch {
      return null;
    }
  }

  function accountIdentity(snapshot = currentAccount()) {
    return `${snapshot?.profileKey || ''}:${snapshot?.user?.id || ''}`;
  }

  function resetForAccount(snapshot) {
    const nextKey = accountIdentity(snapshot);
    if (nextKey === accountKey) return;
    accountKey = nextKey;
    ui.open = false;
    ui.loading = false;
    ui.saving = false;
    ui.items = [];
    ui.stats = { total: 0 };
    ui.selectedId = null;
    ui.draft = null;
    ui.error = '';
    statsRequestKey = '';
    statsRequestedAt = 0;
    ensureModal().hidden = true;
    updateCounts();
  }

  function globallyEnabled() {
    try {
      return typeof memoryGloballyEnabled !== 'function' || memoryGloballyEnabled();
    } catch {
      return true;
    }
  }

  function memoryPolicy() {
    const task = currentTask();
    const project = currentProject();
    const policy = root.MeteoMateHarness?.MemoryContext?.normalizePolicy(
      task?.memoryPolicy,
      project?.spec?.policies?.memory
    ) || {
      useProjectMemory: task?.memoryPolicy?.useProjectMemory !== false,
      useUserMemory: task?.memoryPolicy?.useUserMemory !== false,
      learnFromTask: false,
      maxItems: Number(task?.memoryPolicy?.maxItems || 8),
      charBudget: Number(task?.memoryPolicy?.charBudget || 6000),
    };
    return globallyEnabled()
      ? policy
      : { ...policy, useProjectMemory: false, useUserMemory: false };
  }

  function setMemoryPolicy(patch) {
    const task = currentTask();
    if (!task) return;
    task.memoryPolicy = { ...(task.memoryPolicy || {}), ...patch, learnFromTask: false };
    task.updatedAt = Date.now();
    if (typeof saveState === 'function') saveState();
    decorateApplication();
    if (ui.open) renderModal();
  }

  function ensureModal() {
    let backdrop = document.getElementById('memory-center-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'memory-center-backdrop';
    backdrop.className = 'memory-center-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = '<section class="memory-center-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-center-title"></section>';
    document.body.append(backdrop);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) closeCenter();
    });
    return backdrop;
  }

  function scopeLabel(memory) {
    return memory.scope?.type === 'project' ? '项目' : '个人';
  }

  function timeLabel(value) {
    if (!value) return '从未使用';
    try {
      return new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function cardMarkup(memory) {
    return `
      <button type="button" class="memory-card ${memory.id === ui.selectedId ? 'selected' : ''}" data-memory-select="${html(memory.id)}">
        <div>
          <header>
            <strong>${html(memory.title)}</strong>
            <em>${html(TYPE_LABELS[memory.memoryType] || memory.memoryType)}</em>
            <span>${html(scopeLabel(memory))}</span>
          </header>
          <p>${html(memory.summary)}</p>
          <footer>
            <span>v${html(memory.revision)}</span>
            <span>使用 ${html(memory.useCount || 0)} 次</span>
            <span>${html(timeLabel(memory.updatedAt))}</span>
            ${(memory.tags || []).slice(0, 3).map((tag) => `<span>#${html(tag)}</span>`).join('')}
          </footer>
        </div>
        <span class="memory-card-pin" aria-label="${memory.pinned ? '已固定' : ''}">${memory.pinned ? '★' : ''}</span>
      </button>`;
  }

  function sourceMarkup(memory) {
    const refs = Array.isArray(memory?.sourceRefs) ? memory.sourceRefs : [];
    if (!refs.length) return '<div class="memory-empty"><strong>没有来源引用</strong><span>这条记忆由用户直接录入。</span></div>';
    return `<div class="memory-source-list">${refs.map((source, index) => `
      <div class="memory-source-item">
        <b>${html(source.kind)}</b>
        <span title="${html(source.excerpt || source.title || source.id)}">${html(source.title || source.excerpt || source.id)}</span>
        <button type="button" data-memory-locate-source="${index}">定位</button>
      </div>`).join('')}</div>`;
  }

  function emptyDraft() {
    const project = currentProject();
    return {
      id: null,
      revision: null,
      title: '',
      summary: '',
      memoryType: 'note',
      scopeType: project ? 'project' : 'user',
      projectId: project?.id || '',
      tags: [],
      pinned: false,
      temporalClass: 'stable',
      expiresAt: '',
      sourceRefs: [],
      structuredData: {},
    };
  }

  function selectedMemory() {
    return ui.items.find((memory) => memory.id === ui.selectedId) || null;
  }

  function draftFromMemory(memory) {
    return {
      id: memory.id,
      revision: memory.revision,
      title: memory.title,
      summary: memory.summary,
      memoryType: memory.memoryType,
      scopeType: memory.scope.type,
      projectId: memory.scope.type === 'project' ? memory.scope.id : '',
      tags: memory.tags || [],
      pinned: Boolean(memory.pinned),
      temporalClass: memory.temporal?.class || 'stable',
      expiresAt: memory.temporal?.expiresAt
        ? new Date(memory.temporal.expiresAt).toISOString().slice(0, 16)
        : '',
      sourceRefs: memory.sourceRefs || [],
      structuredData: memory.structuredData || {},
    };
  }

  function editorMarkup() {
    const memory = selectedMemory();
    const draft = ui.draft;
    const enabled = globallyEnabled();
    if (!draft) {
      return `
        <div class="memory-editor">
          <h3>${memory ? html(memory.title) : 'MeteoMate 记忆'}</h3>
          <p>${memory ? `${html(TYPE_LABELS[memory.memoryType] || memory.memoryType)} · ${html(scopeLabel(memory))}记忆 · ${html(STATUS_LABELS[memory.status] || memory.status)}` : '保存跨任务可复用的偏好、决定、纠正和工作背景。'}</p>
          ${memory ? `
            <div class="memory-detail-section"><h4>记忆内容</h4><div class="memory-source-item"><span>${html(memory.summary)}</span></div></div>
            <div class="memory-detail-section"><h4>来源</h4>${sourceMarkup(memory)}</div>
            <div class="memory-detail-section"><h4>管理</h4><div class="memory-editor-actions">
              <button type="button" class="memory-memory-button" data-memory-edit>编辑</button>
              <button type="button" class="memory-memory-button" data-memory-toggle-status>${memory.status === 'active' ? '归档' : '重新启用'}</button>
              <button type="button" class="memory-memory-button danger" data-memory-delete>删除</button>
            </div></div>
            <p class="memory-status-note">来源可追溯，但记忆本身不替代当前资料、Evidence 或正式业务规则。</p>
          ` : `
            <div class="memory-empty"><strong>选择一条记忆查看详情</strong><span>${enabled ? '也可以新建记忆，或在对话消息旁点击“记住”。' : '记忆已关闭，你仍可以查看、编辑或删除已有内容。'}</span></div>
          `}
        </div>`;
    }
    const project = currentProject();
    return `
      <form class="memory-editor" id="memory-editor-form">
        <h3>${draft.id ? '编辑记忆' : '新建记忆'}</h3>
        <p>${draft.id ? `当前版本 v${html(draft.revision)}` : '第一版只保存用户明确确认的记忆，不自动学习完整对话。'}</p>
        ${ui.error ? `<div class="memory-error" role="alert">${html(ui.error)}</div>` : ''}
        <div class="memory-form-grid">
          <label class="full"><span>标题</span><input name="title" maxlength="240" value="${html(draft.title)}" required /></label>
          <label><span>类型</span><select name="memoryType">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${draft.memoryType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>范围</span><select name="scopeType">
            <option value="project" ${draft.scopeType === 'project' ? 'selected' : ''} ${project ? '' : 'disabled'}>${project ? `当前项目：${html(project.name)}` : '当前没有项目'}</option>
            <option value="user" ${draft.scopeType === 'user' ? 'selected' : ''}>个人记忆</option>
          </select></label>
          <label class="full"><span>内容</span><textarea name="summary" maxlength="8000" required>${html(draft.summary)}</textarea></label>
          <label class="full"><span>标签（逗号分隔）</span><input name="tags" value="${html((draft.tags || []).join(', '))}" /></label>
          <label><span>时效类型</span><select name="temporalClass">
            <option value="stable" ${draft.temporalClass === 'stable' ? 'selected' : ''}>长期稳定</option>
            <option value="operational" ${draft.temporalClass === 'operational' ? 'selected' : ''}>业务阶段</option>
            <option value="event" ${draft.temporalClass === 'event' ? 'selected' : ''}>单次事件</option>
          </select></label>
          <label><span>过期时间（可选）</span><input type="datetime-local" name="expiresAt" value="${html(draft.expiresAt || '')}" /></label>
          <label class="full"><span><input type="checkbox" name="pinned" ${draft.pinned ? 'checked' : ''} /> 固定为高优先级记忆</span></label>
        </div>
        ${draft.sourceRefs?.length ? `<div class="memory-detail-section"><h4>来源</h4>${sourceMarkup(draft)}</div>` : ''}
        <div class="memory-editor-actions">
          <button type="button" class="memory-memory-button" data-memory-editor-cancel>取消</button>
          <button type="submit" class="memory-memory-button primary" ${ui.saving ? 'disabled' : ''}>${ui.saving ? '保存中…' : '保存记忆'}</button>
        </div>
      </form>`;
  }

  function renderModal() {
    const backdrop = ensureModal();
    backdrop.hidden = !ui.open;
    if (!ui.open) return;
    const dialog = backdrop.querySelector('.memory-center-dialog');
    const project = currentProject();
    const task = currentTask();
    const policy = memoryPolicy();
    const enabled = globallyEnabled();
    dialog.innerHTML = `
      <header class="memory-center-titlebar">
        <div><h2 id="memory-center-title">记忆</h2><p>${project ? `当前项目：${html(project.name)}` : '当前未绑定项目，仅显示个人记忆'}</p></div>
        <button type="button" class="memory-memory-button primary" data-memory-new ${enabled ? '' : 'disabled'}>新建记忆</button>
        <button type="button" class="memory-center-close" data-memory-close aria-label="关闭记忆中心">×</button>
      </header>
      <div class="memory-center-toolbar">
        <label class="memory-center-search"><input type="search" data-memory-search value="${html(ui.query)}" placeholder="搜索标题、内容或标签" /></label>
        <select data-memory-type-filter aria-label="记忆类型"><option value="all">全部类型</option>${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${ui.memoryType === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <select data-memory-status-filter aria-label="记忆状态">${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${ui.status === value ? 'selected' : ''}>${label}</option>`).join('')}<option value="all" ${ui.status === 'all' ? 'selected' : ''}>全部状态</option></select>
        ${task ? `<label class="memory-policy-toggle"><input type="checkbox" data-memory-policy="project" ${policy.useProjectMemory ? 'checked' : ''} ${project && enabled ? '' : 'disabled'} /> 使用项目记忆</label><label class="memory-policy-toggle"><input type="checkbox" data-memory-policy="user" ${policy.useUserMemory ? 'checked' : ''} ${enabled ? '' : 'disabled'} /> 使用个人记忆</label>` : ''}
        ${enabled ? '' : '<span class="memory-global-state">已在个性化设置中关闭</span>'}
      </div>
      <div class="memory-center-body">
        <section class="memory-list-pane">
          <div class="memory-list-summary"><span>${ui.loading ? '正在读取…' : `共 ${html(ui.items.length)} 条`}</span><span>${html(ui.stats.total || 0)} 条相关记忆</span></div>
          ${ui.error && !ui.draft ? `<div class="memory-error">${html(ui.error)}</div>` : ''}
          <div class="memory-list">${ui.loading
            ? '<div class="memory-empty"><strong>正在读取记忆</strong><span>本地 SQLite 正在查询。</span></div>'
            : ui.items.length
              ? ui.items.map(cardMarkup).join('')
              : enabled
                ? '<div class="memory-empty"><strong>还没有匹配的记忆</strong><span>在对话消息旁点击“记住”，或创建一条项目记忆。</span></div>'
                : '<div class="memory-empty"><strong>记忆已关闭</strong><span>已有记忆不会被删除，重新开启后可以继续使用。</span></div>'}</div>
        </section>
        <aside class="memory-editor-pane">${editorMarkup()}</aside>
      </div>`;
    const search = dialog.querySelector('[data-memory-search]');
    if (search && document.activeElement?.matches?.('[data-memory-search]')) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  async function loadMemories() {
    if (!ui.open) return;
    ui.loading = true;
    ui.error = '';
    renderModal();
    const project = currentProject();
    try {
      const result = await api.listMemories({
        projectId: project?.id || '',
        includeUser: true,
        search: ui.query,
        memoryType: ui.memoryType,
        status: ui.status,
        limit: 300,
      });
      ui.items = result.items || [];
      ui.stats = result.stats || { total: ui.items.length };
      if (ui.selectedId && !ui.items.some((item) => item.id === ui.selectedId)) ui.selectedId = null;
    } catch (error) {
      ui.error = error?.message || String(error);
      ui.items = [];
    } finally {
      ui.loading = false;
      renderModal();
      decorateApplication();
    }
  }

  function openCenter(options = {}) {
    if (document.activeElement instanceof HTMLElement) lastTrigger = document.activeElement;
    ui.open = true;
    ui.error = '';
    if (options.newDraft) ui.draft = options.newDraft;
    renderModal();
    void loadMemories();
  }

  function closeCenter() {
    ui.open = false;
    ui.draft = null;
    ui.error = '';
    renderModal();
    const target = lastTrigger?.isConnected ? lastTrigger : document.querySelector('[data-memory-center-open]');
    target?.focus?.();
    lastTrigger = null;
  }

  function inferMemoryType(message) {
    const value = String(message?.text || '');
    if (/(?:记住|以后|今后|默认|习惯|偏好|不要每次)/.test(value)) return 'preference';
    if (/(?:纠正|不是.{0,12}而是|应改为|应该叫|刚才.*不对)/.test(value)) return 'correction';
    return message?.role === 'assistant' ? 'decision' : 'note';
  }

  function memoryTitle(message, type) {
    const prefix = {
      preference: '偏好',
      correction: '纠正',
      decision: '结论',
      note: '备注',
    }[type] || '记忆';
    const content = String(message?.text || '').replace(/\s+/g, ' ').trim();
    return `${prefix}：${content.slice(0, 46)}${content.length > 46 ? '…' : ''}`;
  }

  function sourceHash(value) {
    try {
      return root.MeteoMateHarness?.Shared?.contentHash?.(value) || null;
    } catch {
      return null;
    }
  }

  function latestRun(task) {
    return [...(task?.runAttempts || [])].reverse().find((run) => run?.id) || null;
  }

  function openMessageMemory(messageId) {
    if (!globallyEnabled()) return;
    const task = currentTask();
    const message = task?.messages?.find((item) => item.id === messageId);
    if (!task || !message?.text) return;
    const project = currentProject();
    const type = inferMemoryType(message);
    const refs = [
      {
        kind: 'message',
        id: message.id,
        hash: sourceHash({ role: message.role, text: message.text, createdAt: message.createdAt }),
        title: message.role === 'user' ? '用户消息' : 'MeteoMate 回复',
        excerpt: String(message.text).slice(0, 1200),
      },
      {
        kind: 'task',
        id: task.id,
        hash: task.contextSnapshot?.hash || sourceHash({ title: task.title, projectId: task.projectId }),
        title: task.title || '任务',
      },
    ];
    const run = latestRun(task);
    if (run) {
      refs.push({
        kind: 'run',
        id: run.id,
        hash: sourceHash({
          id: run.id,
          modelId: run.modelId,
          providerId: run.providerId,
          contextSnapshotId: run.contextSnapshotId,
          status: run.status,
        }),
        title: '运行尝试',
      });
      if (message.role === 'assistant') {
        (task.evidence || [])
          .filter((record) => record.lineage?.runId === run.id)
          .slice(-6)
          .forEach((record) => refs.push({
            kind: 'evidence',
            id: record.id,
            hash: record.recordHash || null,
            title: record.variable || record.evidenceType || 'Evidence',
          }));
        (task.artifacts || [])
          .filter((record) => record.lineage?.runId === run.id)
          .slice(-6)
          .forEach((record) => refs.push({
            kind: 'artifact',
            id: record.id,
            hash: record.recordHash || record.contentHash || null,
            title: record.name || 'Artifact',
          }));
      }
    }
    openCenter({
      newDraft: {
        ...emptyDraft(),
        title: memoryTitle(message, type),
        summary: String(message.text).trim().slice(0, 8000),
        memoryType: type,
        scopeType: project ? 'project' : 'user',
        projectId: project?.id || '',
        tags: [message.role === 'user' ? '用户输入' : '任务结论'],
        sourceRefs: refs,
      },
    });
  }

  async function saveDraft(form) {
    if (!ui.draft || ui.saving) return;
    if (!globallyEnabled() && !ui.draft.id) {
      ui.error = '请先在设置的“个性化”中开启记忆';
      renderModal();
      return;
    }
    const data = new FormData(form);
    const project = currentProject();
    const scopeType = data.get('scopeType') === 'user' ? 'user' : 'project';
    if (scopeType === 'project' && !project?.id) {
      ui.error = '当前没有可绑定的项目';
      renderModal();
      return;
    }
    const payload = {
      title: String(data.get('title') || '').trim(),
      summary: String(data.get('summary') || '').trim(),
      memoryType: String(data.get('memoryType') || 'note'),
      scope: { type: scopeType, id: scopeType === 'project' ? project.id : '' },
      projectId: project?.id || '',
      tags: String(data.get('tags') || '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
      pinned: data.get('pinned') === 'on',
      temporal: {
        class: String(data.get('temporalClass') || 'stable'),
        expiresAt: data.get('expiresAt') ? Date.parse(String(data.get('expiresAt'))) : null,
      },
      sourceRefs: ui.draft.sourceRefs || [],
      structuredData: ui.draft.structuredData || {},
    };
    ui.saving = true;
    ui.error = '';
    renderModal();
    try {
      if (ui.draft.id) {
        await api.updateMemory({
          id: ui.draft.id,
          baseRevision: ui.draft.revision,
          projectId: project?.id || '',
          patch: payload,
        });
      } else {
        await api.createMemory(payload);
      }
      ui.draft = null;
      await loadMemories();
    } catch (error) {
      ui.error = error?.message || String(error);
    } finally {
      ui.saving = false;
      renderModal();
    }
  }

  async function toggleStatus() {
    const memory = selectedMemory();
    if (!memory) return;
    try {
      await api.setMemoryStatus({
        id: memory.id,
        status: memory.status === 'active' ? 'archived' : 'active',
        baseRevision: memory.revision,
        projectId: currentProject()?.id || '',
      });
      ui.selectedId = null;
      await loadMemories();
    } catch (error) {
      ui.error = error?.message || String(error);
      renderModal();
    }
  }

  async function deleteSelected() {
    const memory = selectedMemory();
    if (!memory) return;
    try {
      await api.deleteMemory({
        id: memory.id,
        baseRevision: memory.revision,
        projectId: currentProject()?.id || '',
      });
      ui.selectedId = null;
      ui.draft = null;
      await loadMemories();
    } catch (error) {
      ui.error = error?.message || String(error);
      renderModal();
    }
  }

  function locateSource(index) {
    const memory = ui.draft || selectedMemory();
    const source = memory?.sourceRefs?.[index];
    if (!source) return;
    let task = null;
    let messageId = null;
    if (source.kind === 'message') {
      messageId = source.id;
      task = (typeof state !== 'undefined' ? state.tasks : []).find((candidate) =>
        candidate.messages?.some((message) => message.id === source.id)
      );
    } else if (source.kind === 'task') {
      task = (typeof state !== 'undefined' ? state.tasks : []).find((candidate) => candidate.id === source.id);
    } else {
      const taskRef = memory.sourceRefs.find((ref) => ref.kind === 'task');
      task = taskRef
        ? (typeof state !== 'undefined' ? state.tasks : []).find((candidate) => candidate.id === taskRef.id)
        : null;
    }
    if (!task) return;
    closeCenter();
    state.activeTaskId = task.kind === 'assistant' ? null : task.id;
    if (task.kind === 'assistant') state.assistantTaskId = task.id;
    state.view = task.kind === 'assistant' ? 'assistants' : 'task';
    if (typeof saveState === 'function') saveState();
    if (typeof render === 'function') render();
    window.setTimeout(() => {
      const target = messageId ? document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) : null;
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.classList.add('memory-highlight-source');
      window.setTimeout(() => target?.classList.remove('memory-highlight-source'), 1900);
    }, 80);
  }

  function decorateSidebar() {
    const nav = document.querySelector('.primary-nav');
    if (!nav || nav.querySelector('[data-memory-center-open]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'memory-nav-item';
    button.dataset.memoryCenterOpen = '';
    button.innerHTML = `${memoryIcon()}<span>记忆</span><em data-memory-nav-count>0</em>`;
    nav.append(button);
  }

  function decorateMessages() {
    const task = currentTask();
    if (!globallyEnabled()) {
      document.querySelectorAll('[data-memory-from-message]').forEach((button) => button.remove());
      return;
    }
    document.querySelectorAll('.message-row[data-message-id]').forEach((row) => {
      const message = task?.messages?.find((item) => item.id === row.dataset.messageId);
      const actions = row.querySelector('.message-actions');
      if (!actions || message?.status === 'streaming' || actions.querySelector('[data-memory-from-message]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-action memory-message-action';
      button.dataset.memoryFromMessage = row.dataset.messageId;
      button.dataset.tooltip = '记住这条';
      button.setAttribute('aria-label', '把这条消息保存为记忆');
      button.innerHTML = memoryIcon();
      actions.append(button);
    });
  }

  function decorateComposer() {
    const container = document.querySelector('.composer-draft-context');
    if (!container) return;
    const task = currentTask();
    if (!task) return;
    const project = currentProject();
    const policy = memoryPolicy();
    const active = (project && policy.useProjectMemory) || policy.useUserMemory;
    const existing = container.querySelector('[data-memory-composer-chip]');
    if (existing) {
      existing.classList.toggle('active', Boolean(active));
      const status = active ? '已启用' : '已关闭';
      const statusElement = existing.querySelector('small');
      if (statusElement?.textContent !== status) statusElement.textContent = status;
      existing.title = globallyEnabled() ? '管理本任务使用的长期记忆' : '记忆已在个性化设置中关闭';
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `composer-memory-chip ${active ? 'active' : ''}`;
    button.dataset.memoryComposerChip = '';
    button.innerHTML = `${memoryIcon()}<span>记忆</span><small>${active ? '已启用' : '已关闭'}</small>`;
    button.title = globallyEnabled() ? '管理本任务使用的长期记忆' : '记忆已在个性化设置中关闭';
    container.append(button);
  }

  function updateCounts() {
    const count = ui.stats?.total || 0;
    document.querySelectorAll('[data-memory-nav-count]').forEach((element) => {
      const label = String(count);
      if (element.textContent !== label) element.textContent = label;
      element.hidden = count === 0;
    });
  }

  function refreshNavStats() {
    const project = currentProject();
    const account = currentAccount();
    const userId = account?.user?.id || '';
    if (!userId) return;
    const key = `${userId}:${project?.id || ''}`;
    const now = Date.now();
    if (statsPending || (key === statsRequestKey && now - statsRequestedAt < 5000)) return;
    statsRequestKey = key;
    statsRequestedAt = now;
    statsPending = true;
    api.getMemoryStats({ projectId: project?.id || '', includeUser: true, status: 'active' })
      .then((result) => {
        ui.stats = result || ui.stats;
        updateCounts();
      })
      .catch(() => {})
      .finally(() => { statsPending = false; });
  }

  function decorateApplication() {
    decorateSidebar();
    decorateMessages();
    decorateComposer();
    updateCounts();
    refreshNavStats();
  }

  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-memory-center-open], [data-memory-composer-chip]');
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      openCenter();
      return;
    }
    const fromMessage = event.target.closest('[data-memory-from-message]');
    if (fromMessage) {
      event.preventDefault();
      event.stopPropagation();
      openMessageMemory(fromMessage.dataset.memoryFromMessage);
      return;
    }
    if (!ui.open) return;
    if (event.target.closest('[data-memory-close]')) closeCenter();
    else if (event.target.closest('[data-memory-new]')) {
      ui.draft = emptyDraft();
      ui.selectedId = null;
      renderModal();
    } else if (event.target.closest('[data-memory-select]')) {
      ui.selectedId = event.target.closest('[data-memory-select]').dataset.memorySelect;
      ui.draft = null;
      renderModal();
    } else if (event.target.closest('[data-memory-edit]')) {
      ui.draft = draftFromMemory(selectedMemory());
      renderModal();
    } else if (event.target.closest('[data-memory-editor-cancel]')) {
      ui.draft = null;
      ui.error = '';
      renderModal();
    } else if (event.target.closest('[data-memory-toggle-status]')) {
      void toggleStatus();
    } else if (event.target.closest('[data-memory-delete]')) {
      void deleteSelected();
    } else if (event.target.closest('[data-memory-locate-source]')) {
      locateSource(Number(event.target.closest('[data-memory-locate-source]').dataset.memoryLocateSource));
    }
  }, true);

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'memory-editor-form') return;
    event.preventDefault();
    void saveDraft(event.target);
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('[data-memory-search]')) return;
    ui.query = event.target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void loadMemories(), 220);
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target.matches?.('[data-memory-type-filter]')) {
      ui.memoryType = event.target.value;
      void loadMemories();
    } else if (event.target.matches?.('[data-memory-status-filter]')) {
      ui.status = event.target.value;
      void loadMemories();
    } else if (event.target.matches?.('[data-memory-policy="project"]')) {
      setMemoryPolicy({ useProjectMemory: event.target.checked });
    } else if (event.target.matches?.('[data-memory-policy="user"]')) {
      setMemoryPolicy({ useUserMemory: event.target.checked });
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.open) closeCenter();
  });

  observer = new MutationObserver(() => decorateApplication());
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  ensureModal();
  accountKey = accountIdentity();
  unsubscribeAccount = api.onAccountStateChange?.((snapshot) => {
    resetForAccount(snapshot);
    window.setTimeout(() => decorateApplication(), 0);
  }) || null;
  decorateApplication();

  root.MeteoMateMemoryCenter = Object.freeze({
    open: openCenter,
    close: closeCenter,
    rememberMessage: openMessageMemory,
    refresh: loadMemories,
    refreshPreferences() {
      decorateApplication();
      if (ui.open) renderModal();
    },
    destroy() {
      observer?.disconnect();
      observer = null;
      unsubscribeAccount?.();
      unsubscribeAccount = null;
      document.getElementById('memory-center-backdrop')?.remove();
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
