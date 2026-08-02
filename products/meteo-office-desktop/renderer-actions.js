let permissionMenuCleanup = null;
let taskComposerMenuCleanup = null;
let accountMenuCleanup = null;
let settingsDialogCleanup = null;
let projectDialogCleanup = null;
let composerTriggerCleanup = null;
let catalogDetailCleanup = null;
let sidebarTaskMenuCleanup = null;
let unsubscribeArtifactPreviewEvents = null;
let unsubscribeArtifactPreviewSelectionEvents = null;
let artifactPreviewResizeCleanup = null;
let artifactPreviewSyncRequest = 0;
let suppressNextUnloadStateSave = false;
const RUNTIME_STREAM_COMMIT_INTERVAL_MS = 80;
const RUNTIME_PROGRESS_COMMIT_INTERVAL_MS = 350;
const runtimeStreamCommitTimers = new Map();
const runtimeProgressCommitTimers = new Map();
const pendingStreamCommitTaskIds = new Set();
const pendingQueuedPromptTaskIds = new Set();
// 中文输入法组合态标记：组合期间不做全量重绘，避免打断输入
let composerImeComposing = false;

document.addEventListener(
  'compositionstart',
  (event) => {
    if (event.target?.id === 'task-prompt') composerImeComposing = true;
  },
  true
);
document.addEventListener(
  'compositionend',
  (event) => {
    if (event.target?.id !== 'task-prompt') return;
    composerImeComposing = false;
    flushPendingStreamCommits();
    flushPendingQueuedTaskPrompts();
  },
  true
);

function flushPendingStreamCommits() {
  if (!pendingStreamCommitTaskIds.size) return;
  pendingStreamCommitTaskIds.clear();
  saveState();
  render();
}

function commitRuntimeStreamNow(task) {
  if (composerImeComposing) {
    pendingStreamCommitTaskIds.add(task.id);
    return;
  }
  saveState();
  if (state.activeTaskId === task.id || state.view === 'automation') render();
}

function flushPendingQueuedTaskPrompts() {
  const taskIds = [...pendingQueuedPromptTaskIds];
  pendingQueuedPromptTaskIds.clear();
  taskIds.forEach((taskId) => flushQueuedTaskPrompts(taskId));
}
const composerWorkspaceFileCache = new Map();
const composerTriggerUI = {
  mode: null,
  query: '',
  start: -1,
  end: -1,
  activeIndex: 0,
  items: [],
  loading: false,
  workspace: '',
  requestId: 0,
};

function composerTriggerAtCursor(textarea) {
  const cursor = textarea.selectionStart ?? textarea.value.length;
  const beforeCursor = textarea.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)([/@])([^\s]*)$/);
  if (!match) return null;
  const symbol = match[2];
  const query = match[3] || '';
  return {
    mode: symbol === '/' ? 'skill' : 'file',
    query,
    start: cursor - query.length - 1,
    end: cursor,
  };
}

function composerSkillItems(query) {
  const capabilityApi = window.MeteoMateCapabilityCenter;
  const projectId = getActiveTask()?.projectId || getActiveProject()?.id || null;
  const skills = capabilityApi?.enabledSkillCatalog?.(projectId) || [];
  const normalizedQuery = String(query || '').toLowerCase();
  return skills
    .filter((item) => !normalizedQuery || `${item.name} ${item.id} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(normalizedQuery))
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      description: item.description || '将此技能绑定到当前任务',
      icon: item.icon || (item.name || item.id).slice(0, 1),
      meta: item.category || '技能',
      type: 'skill',
    }));
}

function composerFileItems(files, query) {
  const normalizedQuery = String(query || '').toLowerCase();
  const kindLabels = { text: '文本', document: '文档', data: '气象数据', image: '图片', file: '文件' };
  return (files || [])
    .filter((item) => !normalizedQuery || item.path.toLowerCase().includes(normalizedQuery))
    .slice(0, 80)
    .map((item) => ({
      id: item.path,
      name: item.name,
      description: item.path,
      icon: item.kind === 'document' ? '文' : item.kind === 'data' ? '数' : item.kind === 'image' ? '图' : '档',
      meta: kindLabels[item.kind] || '文件',
      type: 'file',
    }));
}

function closeComposerTriggerPalette() {
  composerTriggerUI.mode = null;
  composerTriggerUI.items = [];
  const palette = document.getElementById('composer-trigger-palette');
  if (palette) palette.hidden = true;
}

function renderComposerTriggerPalette() {
  const palette = document.getElementById('composer-trigger-palette');
  const list = document.getElementById('composer-trigger-list');
  const title = document.getElementById('composer-trigger-title');
  const count = document.getElementById('composer-trigger-count');
  if (!palette || !list || !title || !count || !composerTriggerUI.mode) return;

  const fileMode = composerTriggerUI.mode === 'file';
  title.textContent = fileMode ? '项目文件' : '技能';
  count.textContent = composerTriggerUI.loading ? '读取中' : `${composerTriggerUI.items.length} 项`;
  palette.hidden = false;

  if (composerTriggerUI.loading) {
    list.innerHTML = '<div class="composer-trigger-empty"><strong>正在读取项目文件</strong><small>文件始终限制在当前工作区内</small></div>';
    return;
  }
  if (!composerTriggerUI.items.length) {
    const noWorkspace = fileMode && !composerTriggerUI.workspace;
    list.innerHTML = `<div class="composer-trigger-empty"><strong>${noWorkspace ? '请先选择项目' : fileMode ? '没有匹配的项目文件' : '没有可调用的技能'}</strong><small>${noWorkspace ? '选择项目后可通过 @ 引用其工作区文件' : fileMode ? '换一个文件名试试' : '请先在技能中心启用技能'}</small></div>`;
    return;
  }

  composerTriggerUI.activeIndex = Math.min(composerTriggerUI.activeIndex, composerTriggerUI.items.length - 1);
  list.innerHTML = composerTriggerUI.items.slice(0, 12).map((item, index) => `
    <button type="button" class="composer-trigger-option ${index === composerTriggerUI.activeIndex ? 'active' : ''}" role="option" aria-selected="${index === composerTriggerUI.activeIndex}" data-composer-trigger-index="${index}">
      <span class="composer-trigger-icon">${escapeHtml(item.icon)}</span>
      <span class="composer-trigger-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span>
      <em>${escapeHtml(item.meta)}</em>
    </button>`).join('');
  list.querySelectorAll('[data-composer-trigger-index]').forEach((button) => {
    button.addEventListener('mouseenter', () => {
      composerTriggerUI.activeIndex = Number(button.dataset.composerTriggerIndex);
      list.querySelectorAll('[data-composer-trigger-index]').forEach((entry, index) => {
        entry.classList.toggle('active', index === composerTriggerUI.activeIndex);
        entry.setAttribute('aria-selected', String(index === composerTriggerUI.activeIndex));
      });
    });
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => selectComposerTriggerItem(Number(button.dataset.composerTriggerIndex)));
  });
}

async function updateComposerTriggerPalette(textarea) {
  const trigger = composerTriggerAtCursor(textarea);
  if (!trigger) {
    closeComposerTriggerPalette();
    return;
  }
  Object.assign(composerTriggerUI, trigger, { activeIndex: 0 });
  if (trigger.mode === 'skill') {
    composerTriggerUI.loading = false;
    composerTriggerUI.items = composerSkillItems(trigger.query);
    renderComposerTriggerPalette();
    return;
  }

  const workspace = getConversationProject(getActiveTask())?.workspace || '';
  composerTriggerUI.workspace = workspace;
  if (!workspace) {
    composerTriggerUI.loading = false;
    composerTriggerUI.items = [];
    renderComposerTriggerPalette();
    return;
  }
  const cached = composerWorkspaceFileCache.get(workspace);
  if (cached && Date.now() - cached.loadedAt < 5_000) {
    composerTriggerUI.loading = false;
    composerTriggerUI.items = composerFileItems(cached.files, trigger.query);
    renderComposerTriggerPalette();
    return;
  }

  const requestId = ++composerTriggerUI.requestId;
  composerTriggerUI.loading = true;
  composerTriggerUI.items = [];
  renderComposerTriggerPalette();
  try {
    const result = await window.meteoDesktop.listWorkspaceFiles({ workspace });
    composerWorkspaceFileCache.set(workspace, { files: result.files || [], loadedAt: Date.now() });
    if (requestId !== composerTriggerUI.requestId || composerTriggerUI.mode !== 'file') return;
    const currentTrigger = composerTriggerAtCursor(textarea);
    if (!currentTrigger || currentTrigger.mode !== 'file') return;
    Object.assign(composerTriggerUI, currentTrigger, {
      loading: false,
      items: composerFileItems(result.files, currentTrigger.query),
    });
  } catch {
    if (requestId !== composerTriggerUI.requestId) return;
    composerTriggerUI.loading = false;
    composerTriggerUI.items = [];
  }
  renderComposerTriggerPalette();
}

function persistComposerDraft(textarea) {
  const task = getActiveTask();
  if (task) task.draftPrompt = textarea.value;
  else if (state.view === 'task') state.draftPrompt = textarea.value;
}

function composerFileReferences() {
  const task = getActiveTask();
  if (!task) return state.draftFileReferences || [];
  if (Array.isArray(task.queuedDraftFileReferences)) return task.queuedDraftFileReferences;
  return task.fileReferences || [];
}

function setTaskFileReferences(fileReferences) {
  const task = getActiveTask();
  if (task) {
    if (task.status === 'running' || Array.isArray(task.queuedDraftFileReferences)) {
      task.queuedDraftFileReferences = [...fileReferences];
      task.updatedAt = Date.now();
      return;
    }
    const changed = JSON.stringify(task.fileReferences || []) !== JSON.stringify(fileReferences);
    task.fileReferences = [...fileReferences];
    if (changed && task.sessionId) {
      task.sessionId = null;
      task.runtimeMode = null;
      task.usage = null;
      task.contextState = { phase: 'idle', message: '' };
    }
    task.updatedAt = Date.now();
  } else {
    state.draftFileReferences = [...fileReferences];
  }
}

function composerArtifactSelections() {
  const task = getActiveTask();
  if (!task) return state.draftArtifactSelections || [];
  if (Array.isArray(task.queuedDraftArtifactSelections)) return task.queuedDraftArtifactSelections;
  return task.artifactSelections || [];
}

function setTaskArtifactSelections(selections) {
  const task = getActiveTask();
  if (task) {
    if (task.status === 'running' || Array.isArray(task.queuedDraftArtifactSelections)) {
      task.queuedDraftArtifactSelections = [...selections];
    } else {
      task.artifactSelections = [...selections];
    }
    task.updatedAt = Date.now();
  } else {
    state.draftArtifactSelections = [...selections];
  }
}

function artifactSelectionIdentity(selection) {
  return JSON.stringify([
    selection?.sourceHash || '',
    selection?.pages || [],
    String(selection?.quote || '').replace(/\s+/g, ' ').trim(),
  ]);
}

function handleArtifactPreviewSelection(selection) {
  const task = getActiveTask();
  if (!task || task.id !== selection?.taskId) return;
  const current = composerArtifactSelections();
  const existing = current.find((entry) => artifactSelectionIdentity(entry) === artifactSelectionIdentity(selection));
  const next = existing
    ? current
    : [...current, {
        ...selection,
        number: current.reduce((maximum, entry) => Math.max(maximum, Number(entry.number) || 0), 0) + 1,
      }].slice(-8);
  setTaskArtifactSelections(next);
  saveState();
  render();
  const accepted = existing || next.at(-1);
  window.requestAnimationFrame(() => {
    const textarea = document.getElementById('task-prompt');
    if (textarea && !textarea.disabled) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    void window.meteoDesktop.highlightArtifactSelection({
      previewId: accepted.previewId,
      selection: accepted,
    });
  });
}

function taskArtifactSelections(task) {
  const selections = [
    ...(task?.artifactSelections || []),
    ...(task?.queuedDraftArtifactSelections || []),
    ...(task?.messages || []).flatMap((message) => message.artifactSelections || []),
  ];
  return [...new Map(selections.filter((selection) => selection?.selectionId)
    .map((selection) => [selection.selectionId, selection])).values()];
}

function findArtifactSelection(task, selectionId) {
  return taskArtifactSelections(task).find((selection) => selection.selectionId === selectionId) || null;
}

function focusComposerAfterRender(cursor) {
  window.requestAnimationFrame(() => {
    const textarea = document.getElementById('task-prompt');
    if (!textarea || textarea.disabled) return;
    textarea.focus();
    const position = Math.min(cursor, textarea.value.length);
    textarea.setSelectionRange(position, position);
  });
}

function selectComposerTriggerItem(index) {
  const item = composerTriggerUI.items[index];
  const textarea = document.getElementById('task-prompt');
  if (!item || !textarea) return;
  const replacement = item.type === 'file' ? `@${item.id} ` : '';
  textarea.value = `${textarea.value.slice(0, composerTriggerUI.start)}${replacement}${textarea.value.slice(composerTriggerUI.end)}`;
  const cursor = composerTriggerUI.start + replacement.length;
  persistComposerDraft(textarea);

  if (item.type === 'skill') {
    const task = getActiveTask();
    const skillIds = [...new Set([...(task?.skillIds || state.draftSkillIds || []), item.id])];
    const connectorIds = task?.connectorIds || state.draftConnectorIds || [];
    if (task && window.MeteoMateCapabilityCenter) {
      window.MeteoMateCapabilityCenter.clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds);
    } else {
      state.draftSkillIds = skillIds;
    }
  } else {
    const current = composerFileReferences();
    setTaskFileReferences([...new Set([...current, item.id])]);
  }

  closeComposerTriggerPalette();
  saveState();
  render();
  focusComposerAfterRender(cursor);
}

function bindComposerTriggers(textarea) {
  const documentClickHandler = (event) => {
    if (!event.target.closest('.composer-shell')) closeComposerTriggerPalette();
  };
  document.addEventListener('click', documentClickHandler);
  composerTriggerCleanup = () => document.removeEventListener('click', documentClickHandler);

  textarea.addEventListener('input', () => {
    persistComposerDraft(textarea);
    void updateComposerTriggerPalette(textarea);
  });
  textarea.addEventListener('click', () => void updateComposerTriggerPalette(textarea));
  textarea.addEventListener('keydown', (event) => {
    if (!composerTriggerUI.mode || document.getElementById('composer-trigger-palette')?.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const count = Math.min(composerTriggerUI.items.length, 12);
      if (count) composerTriggerUI.activeIndex = (composerTriggerUI.activeIndex + direction + count) % count;
      renderComposerTriggerPalette();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && composerTriggerUI.items.length) {
      event.preventDefault();
      selectComposerTriggerItem(composerTriggerUI.activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeComposerTriggerPalette();
    }
  });
}

async function finishAccountActivation(session) {
  accountSession = session;
  if (session?.status === 'authenticated' && session.user?.mustChangePassword) {
    await window.meteoDesktop.setWindowMode('account');
    render();
    document.getElementById('account-current-password')?.focus();
    return;
  }
  const legacyAvailable = Boolean(session?.legacyDataAvailable || hasLegacyRendererState());
  if (legacyAvailable) {
    const shouldClaim = confirm('检测到当前版本升级前的本机任务、技能或工具配置。是否将这些数据归属到刚登录的账户？');
    if (shouldClaim) {
      if (session.legacyDataAvailable) await window.meteoDesktop.claimLegacyProfileData();
      claimLegacyRendererState(session.profileKey);
    }
  }
  await window.meteoDesktop.setWindowMode('workspace');
  suppressNextUnloadStateSave = true;
  window.location.reload();
}

async function changeAccountPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const errorBox = document.getElementById('account-password-error');
  const currentPassword = document.getElementById('account-current-password').value;
  const newPassword = document.getElementById('account-new-password').value;
  const confirmation = document.getElementById('account-confirm-password').value;
  errorBox.hidden = true;
  if (newPassword !== confirmation) {
    errorBox.textContent = '两次输入的新密码不一致';
    errorBox.hidden = false;
    return;
  }
  if ([...newPassword].length < 8) {
    errorBox.textContent = '新密码至少需要 8 个字符';
    errorBox.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = '正在更新…';
  try {
    accountSession = await window.meteoDesktop.changeAccountPassword({ currentPassword, newPassword });
    accountSession.notice = '密码已更新，请使用新密码重新登录。';
    await window.meteoDesktop.setWindowMode('account');
    render();
    document.getElementById('account-password')?.focus();
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = '更新密码';
  }
}

async function loginAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const errorBox = document.getElementById('account-login-error');
  button.disabled = true;
  button.textContent = '正在验证…';
  errorBox.hidden = true;
  try {
    const session = await window.meteoDesktop.loginAccount({
      username: document.getElementById('account-username').value,
      password: document.getElementById('account-password').value,
      baseUrl: accountSession.baseUrl || 'http://127.0.0.1:8088',
    });
    await finishAccountActivation(session);
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = '登录';
    document.getElementById('account-password')?.focus();
  }
}

async function openOfflineAccount() {
  try {
    const session = await window.meteoDesktop.openOfflineAccount();
    await finishAccountActivation(session);
  } catch (error) {
    const errorBox = document.getElementById('account-login-error');
    if (errorBox) {
      errorBox.textContent = error?.message || String(error);
      errorBox.hidden = false;
    }
  }
}

async function logoutAccount() {
  if (!confirm('确定退出当前 MeteoMate 账户吗？本机资料不会删除。')) return;
  accountSession = await window.meteoDesktop.logoutAccount();
  await window.meteoDesktop.setWindowMode('account');
  state = structuredClone(initialState);
  render();
}

function bindEvents() {
  composerTriggerCleanup?.();
  composerTriggerCleanup = null;
  permissionMenuCleanup?.();
  permissionMenuCleanup = null;
  taskComposerMenuCleanup?.();
  taskComposerMenuCleanup = null;
  accountMenuCleanup?.();
  accountMenuCleanup = null;
  sidebarTaskMenuCleanup?.();
  sidebarTaskMenuCleanup = null;
  settingsDialogCleanup?.();
  settingsDialogCleanup = null;
  projectDialogCleanup?.();
  projectDialogCleanup = null;
  catalogDetailCleanup?.();
  catalogDetailCleanup = null;
  artifactPreviewResizeCleanup?.();
  artifactPreviewResizeCleanup = null;
  document.getElementById('account-login-form')?.addEventListener('submit', loginAccount);
  document.getElementById('account-password-form')?.addEventListener('submit', changeAccountPassword);
  document.getElementById('account-open-offline')?.addEventListener('click', openOfflineAccount);
  document.getElementById('account-logout')?.addEventListener('click', logoutAccount);
  document.getElementById('account-open-settings')?.addEventListener('click', () => openSettingsDialog());
  document.querySelectorAll('[data-sidebar-toggle]').forEach((element) => {
    element.addEventListener('click', toggleSidebar);
  });
  document.querySelectorAll('[data-sidebar-section-toggle]').forEach((element) => {
    element.addEventListener('click', () => toggleSidebarSection(element.dataset.sidebarSectionToggle));
  });
  document.getElementById('sidebar-search')?.addEventListener('click', () => {
    navigate('catalog');
    requestAnimationFrame(() => document.querySelector('.search-box input')?.focus());
  });
  const accountMenuTrigger = document.getElementById('sidebar-account-trigger');
  const accountMenu = document.getElementById('sidebar-account-menu');
  if (accountMenuTrigger && accountMenu) {
    const closeAccountMenu = () => {
      accountMenu.hidden = true;
      accountMenuTrigger.setAttribute('aria-expanded', 'false');
    };
    const accountDocumentClickHandler = (event) => {
      if (!accountMenuTrigger.parentElement?.contains(event.target)) closeAccountMenu();
    };
    const accountDocumentKeyHandler = (event) => {
      if (event.key === 'Escape' && !accountMenu.hidden) {
        closeAccountMenu();
        accountMenuTrigger.focus();
      }
    };
    accountMenuTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = accountMenu.hidden;
      accountMenu.hidden = !willOpen;
      accountMenuTrigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) accountMenu.querySelector('[role="menuitem"]')?.focus();
    });
    document.addEventListener('click', accountDocumentClickHandler);
    document.addEventListener('keydown', accountDocumentKeyHandler);
    accountMenuCleanup = () => {
      document.removeEventListener('click', accountDocumentClickHandler);
      document.removeEventListener('keydown', accountDocumentKeyHandler);
    };
  }
  document.querySelectorAll('[data-nav]').forEach((element) => {
    element.addEventListener('click', () => navigate(element.dataset.nav));
  });
  window.MeteoMateWorkflowCenter?.bindEvents?.();

  document.querySelectorAll('[data-catalog-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      catalogUI.detailExpertId = null;
      state.catalogTab = element.dataset.catalogTab;
      state.category = '全部';
      window.MeteoMateWorkflowCenter?.onNavigate?.('catalog');
      render();
    });
  });

  document.querySelectorAll('[data-team-mode]').forEach((element) => {
    element.addEventListener('click', () => {
      catalogUI.detailExpertId = null;
      state.teamMode = element.dataset.teamMode === 'true';
      state.category = '全部';
      render();
    });
  });

  document.querySelectorAll('[data-category]').forEach((element) => {
    element.addEventListener('click', () => {
      catalogUI.detailExpertId = null;
      state.category = element.dataset.category;
      render();
    });
  });

  document.querySelectorAll('[data-expert-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      openExpert(element.dataset.expertId);
    });
  });

  document.querySelectorAll('[data-expert-detail-id]').forEach((element) => {
    element.addEventListener('click', () => {
      catalogUI.detailExpertId = element.dataset.expertDetailId;
      render();
    });
  });

  document.querySelectorAll('[data-close-expert-detail]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (element.classList.contains('expert-detail-backdrop') && event.target !== element) return;
      catalogUI.detailExpertId = null;
      render();
    });
  });

  document.querySelectorAll('[data-expert-prompt-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const expert = allExperts().find((item) => item.id === element.dataset.expertPromptId);
      const prompt = expert?.prompts?.[Number(element.dataset.expertPromptIndex)] || '';
      openExpert(expert?.id, prompt);
    });
  });

  if (catalogUI.detailExpertId) {
    const keyHandler = (event) => {
      if (event.key !== 'Escape') return;
      catalogUI.detailExpertId = null;
      render();
    };
    document.addEventListener('keydown', keyHandler);
    catalogDetailCleanup = () => document.removeEventListener('keydown', keyHandler);
  }

  document.querySelectorAll('[data-favorite-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(element.dataset.favoriteId);
    });
  });

  document.querySelectorAll('[data-task-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const task = state.tasks.find((candidate) => candidate.id === element.dataset.taskId);
      teamUI.collapsed = false;
      teamUI.expanded = false;
      teamUI.selectedMemberId = null;
      state.activeTaskId = task?.id || null;
      state.view = task?.kind === 'assistant' ? 'assistants' : 'task';
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-sidebar-task-rename]').forEach((button) => {
    button.addEventListener('click', () => startSidebarTaskRename(button.dataset.sidebarTaskRename));
  });
  document.querySelectorAll('[data-sidebar-task-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSidebarTaskMenu(button.dataset.sidebarTaskMenu);
    });
  });
  document.querySelectorAll('[data-sidebar-task-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteSidebarTask(button.dataset.sidebarTaskDelete));
  });
  document.querySelectorAll('[data-sidebar-task-rename-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = form.querySelector('input');
      if (!commitSidebarTaskRename(form.dataset.sidebarTaskRenameForm, input?.value)) {
        input?.setCustomValidity('任务名称不能为空');
        input?.reportValidity();
      }
    });
    form.querySelector('input')?.addEventListener('input', (event) => event.target.setCustomValidity(''));
    form.querySelector('input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancelSidebarTaskRename();
    });
  });
  document.querySelector('[data-sidebar-task-rename-cancel]')?.addEventListener('click', cancelSidebarTaskRename);
  const openSidebarTaskMenu = document.querySelector('.sidebar-task-menu');
  if (openSidebarTaskMenu) {
    const menuTask = openSidebarTaskMenu.closest('.sidebar-task');
    const taskId = sidebarTaskUI.menuTaskId;
    const closeOnOutsideClick = (event) => {
      if (menuTask?.contains(event.target)) return;
      sidebarTaskUI.menuTaskId = null;
      render();
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      sidebarTaskUI.menuTaskId = null;
      render();
      requestAnimationFrame(() => {
        document.querySelector(`[data-sidebar-task-menu="${taskId}"]`)?.focus();
      });
    };
    document.addEventListener('click', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    sidebarTaskMenuCleanup = () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }

  document.querySelectorAll('[data-scene-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const scene = catalog.scenes.find((item) => item.id === element.dataset.sceneId);
      if (scene?.expertId) openExpert(scene.expertId);
    });
  });

  document.querySelectorAll('[data-task-mode]').forEach((element) => {
    element.addEventListener('click', () => {
      state.draftTaskMode = element.dataset.taskMode;
      const selectedScene = catalog.scenes.find((scene) => scene.id === state.draftSceneId);
      if (selectedScene && (selectedScene.group || 'forecast') !== state.draftTaskMode) {
        state.draftSceneId = null;
        state.selectedExpertId = null;
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-task-scene-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const scene = catalog.scenes.find((entry) => entry.id === element.dataset.taskSceneId);
      if (!scene) return;
      state.draftSceneId = scene.id;
      state.draftTaskMode = scene.group || 'forecast';
      state.selectedExpertId = scene.expertId || null;
      state.draftPermissionProfileId = null;
      saveState();
      render();
      document.getElementById('task-prompt')?.focus();
    });
  });

  document.querySelector('[data-clear-task-expert]')?.addEventListener('click', () => {
    state.draftSceneId = null;
    state.selectedExpertId = null;
    state.draftPermissionProfileId = null;
    saveState();
    render();
  });

  document.querySelectorAll('[data-prompt-example]').forEach((element) => {
    element.addEventListener('click', () => {
      const textarea = document.getElementById('task-prompt');
      if (textarea && !textarea.disabled) {
        textarea.value = element.dataset.promptExample;
        persistComposerDraft(textarea);
        textarea.focus();
      }
    });
  });

  document.querySelectorAll('[data-action="add-project"]').forEach((element) => {
    element.addEventListener('click', () => openProjectDialog());
  });

  document.querySelectorAll('[data-project-id]').forEach((element) => {
    element.addEventListener('click', () => openProjectDetail(element.dataset.projectId));
  });

  document.querySelectorAll('[data-project-template]').forEach((element) => {
    element.addEventListener('click', () => openProjectDialog(element.dataset.projectTemplate));
  });

  document.querySelectorAll('[data-project-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      projectUI.tab = element.dataset.projectTab;
      render();
    });
  });

  document.querySelectorAll('[data-project-new-task]').forEach((element) => {
    element.addEventListener('click', () => openProjectTask(element.dataset.projectNewTask));
  });

  document.querySelectorAll('[data-project-knowledge]').forEach((element) => {
    element.addEventListener('click', () => {
      state.activeProjectId = element.dataset.projectKnowledge;
      state.activeTaskId = null;
      state.view = 'project-detail';
      projectUI.tab = 'assets';
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-edit-project]').forEach((element) => {
    element.addEventListener('click', () => openProjectDialog('', element.dataset.editProject));
  });

  document.querySelectorAll('[data-knowledge-filter]').forEach((element) => {
    element.addEventListener('click', () => {
      knowledgeUI.filter = element.dataset.knowledgeFilter;
      render();
    });
  });

  document.querySelectorAll('[data-knowledge-import]').forEach((element) => {
    element.addEventListener('click', () => void importLocalKnowledgeSources(element.dataset.knowledgeProject || ''));
  });

  document.querySelectorAll('[data-knowledge-add-online]').forEach((element) => {
    element.addEventListener('click', () => openKnowledgeSourceEditor('', element.dataset.knowledgeProject || ''));
  });

  document.querySelectorAll('[data-knowledge-edit]').forEach((element) => {
    element.addEventListener('click', () => openKnowledgeSourceEditor(element.dataset.knowledgeEdit, element.dataset.knowledgeProject || ''));
  });

  document.querySelectorAll('[data-knowledge-test]').forEach((element) => {
    element.addEventListener('click', () => void testSavedKnowledgeSource(element.dataset.knowledgeTest));
  });

  document.querySelectorAll('[data-knowledge-toggle]').forEach((element) => {
    element.addEventListener('change', () => void toggleKnowledgeSource(element.dataset.knowledgeToggle, element.checked));
  });

  document.querySelectorAll('[data-knowledge-cancel]').forEach((element) => {
    element.addEventListener('click', closeKnowledgeSourceEditor);
  });

  document.querySelectorAll('[data-knowledge-delete]').forEach((element) => {
    element.addEventListener('click', () => void deleteKnowledgeSource(element.dataset.knowledgeDelete));
  });

  document.querySelectorAll('[data-knowledge-test-draft]').forEach((element) => {
    element.addEventListener('click', () => void testKnowledgeSourceDraft());
  });
  document.getElementById('knowledge-source-form')?.addEventListener('submit', saveKnowledgeSourceEditor);

  document.querySelectorAll('[data-automation-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      automationUI.tab = element.dataset.automationTab;
      render();
    });
  });

  document.querySelectorAll('[data-automation-create]').forEach((element) => {
    element.addEventListener('click', () => openAutomationEditor());
  });

  document.querySelectorAll('[data-automation-template]').forEach((element) => {
    element.addEventListener('click', () => openAutomationEditor(element.dataset.automationTemplate));
  });

  document.querySelectorAll('[data-automation-edit]').forEach((element) => {
    element.addEventListener('click', () => openAutomationEditor('', element.dataset.automationEdit));
  });

  document.querySelectorAll('[data-automation-toggle]').forEach((element) => {
    element.addEventListener('change', () => toggleAutomation(element.dataset.automationToggle, element.checked));
  });

  document.querySelectorAll('[data-automation-run]').forEach((element) => {
    element.addEventListener('click', () => void executeAutomationById(element.dataset.automationRun, 'manual'));
  });

  document.querySelectorAll('[data-automation-cancel]').forEach((element) => {
    element.addEventListener('click', closeAutomationEditor);
  });

  document.querySelectorAll('[data-automation-mode]').forEach((element) => {
    element.addEventListener('click', () => changeAutomationScheduleMode(element.dataset.automationMode));
  });

  document.getElementById('automation-cadence')?.addEventListener('change', (event) => {
    automationUI.editor = { ...readAutomationEditorDraft(), cadence: event.target.value };
    render();
  });
  document.getElementById('automation-capability-mode')?.addEventListener('change', (event) => {
    automationUI.editor = {
      ...readAutomationEditorDraft(),
      capabilityMode: event.target.value === 'pinned' ? 'pinned' : 'inherit',
    };
    render();
  });
  document.getElementById('automation-project')?.addEventListener('change', (event) => {
    automationUI.editor = { ...readAutomationEditorDraft(), projectId: event.target.value };
    render();
  });
  document.getElementById('automation-editor-form')?.addEventListener('submit', saveAutomationEditor);
  document.querySelectorAll('[data-automation-delete]').forEach((element) => {
    element.addEventListener('click', () => deleteAutomation(element.dataset.automationDelete));
  });

  document.querySelectorAll('[data-open-project]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      window.meteoDesktop.openWorkspace(element.dataset.openProject);
    });
  });

  document.querySelectorAll('[data-open-artifact]').forEach((element) => {
    element.addEventListener('click', () => {
      const target = element.dataset.openArtifact;
      const task = state.view === 'assistants' ? getAssistantTask() : getActiveTask();
      const artifact = task?.artifacts?.find((item) =>
        [item.id, item.path, item.uri, item.name].filter(Boolean).includes(target)
      );
      if (artifact) openArtifactPreview(artifact, task);
      else if (/^https?:\/\//i.test(target)) window.meteoDesktop.openExternalUrl(target);
      else window.meteoDesktop.openWorkspace(target);
    });
  });

  document.querySelectorAll('[data-artifact-path]').forEach((element) => {
    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = element.dataset.artifactPath;
      const currentTask = state.view === 'assistants' ? getAssistantTask() : getActiveTask();
      const task = currentTask || state.tasks.find((candidate) =>
        candidate.artifacts?.some((artifact) =>
          [artifact.id, artifact.path, artifact.uri, artifact.name].filter(Boolean).includes(target)
        )
      );
      void window.meteoDesktop.showArtifactContextMenu({
        target,
        workspace: previewWorkspace(task),
      }).catch(() => {});
    });
  });

  document.querySelectorAll('[data-external-url]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      window.meteoDesktop.openExternalUrl(element.dataset.externalUrl);
    });
  });

  document.querySelectorAll('[data-permission-id]').forEach((element) => {
    element.addEventListener('click', () =>
      resolvePermission(element.dataset.permissionId, element.dataset.permissionAction)
    );
  });

  const search = document.getElementById('catalog-search');
  if (search) {
    search.addEventListener('input', (event) => {
      state.search = event.target.value;
      window.clearTimeout(search._renderTimer);
      search._renderTimer = window.setTimeout(render, 120);
    });
  }

  const projectSearch = document.getElementById('project-search-input');
  if (projectSearch) {
    const applyProjectSearch = () => {
      const query = projectSearch.value.trim().toLowerCase();
      projectUI.query = projectSearch.value;
      let visible = 0;
      document.querySelectorAll('[data-project-search-name]').forEach((card) => {
        const matches = !query || card.dataset.projectSearchName.includes(query);
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      const empty = document.getElementById('project-search-empty');
      if (empty) empty.hidden = visible > 0;
    };
    projectSearch.addEventListener('input', applyProjectSearch);
    applyProjectSearch();
  }

  const favorites = document.getElementById('toggle-favorites');
  if (favorites) {
    favorites.addEventListener('click', () => {
      state.favoritesOnly = !state.favoritesOnly;
      render();
    });
  }

  bindTaskComposerMenus();
  bindArtifactPreviewEvents();

  const sendButton = document.getElementById('send-task');
  if (sendButton) sendButton.addEventListener('click', () => sendTaskMessage());

  document.getElementById('window-minimize')?.addEventListener('click', () => window.meteoDesktop.windowMinimize?.());
  document.getElementById('window-maximize')?.addEventListener('click', () => window.meteoDesktop.windowToggleMaximize?.());
  document.getElementById('window-close')?.addEventListener('click', () => window.meteoDesktop.windowClose?.());

  document.getElementById('composer-open-model-settings')?.addEventListener('click', () => openSettingsDialog('models'));

  document.querySelectorAll('[data-queue-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = getActiveTask();
      if (!task) return;
      const index = Number(button.dataset.queueCancel);
      task.queuedPrompts = (Array.isArray(task.queuedPrompts) ? task.queuedPrompts : []).filter(
        (_item, itemIndex) => itemIndex !== index
      );
      task.updatedAt = Date.now();
      saveState();
      render();
    });
  });

  document.querySelectorAll('[data-queue-send]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = getActiveTask();
      if (!task || task.status === 'running') return;
      const index = Number(button.dataset.queueSend);
      const queued = Array.isArray(task.queuedPrompts) ? task.queuedPrompts : [];
      const item = queued[index];
      if (!item) return;
      task.queuedPrompts = queued.filter((_entry, entryIndex) => entryIndex !== index);
      task.fileReferences = [...(item.fileReferences || [])];
      task.artifactSelections = [...(item.artifactSelections || [])];
      delete task.queuedDraftFileReferences;
      delete task.queuedDraftArtifactSelections;
      saveState();
      void sendTaskMessage({ prompt: item.text, dequeue: true });
    });
  });

  const cancelButton = document.getElementById('cancel-task');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      cancelButton.disabled = true;
      cancelButton.classList.add('stopping');
      cancelButton.setAttribute('aria-label', '正在停止');
      cancelButton.title = '正在停止…';
      void cancelTask();
    });
  }

  document.querySelectorAll('[data-message-copy]').forEach((button) => {
    button.addEventListener('click', () => void copyMessageText(button));
  });

  document.querySelectorAll('[data-message-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = getActiveTask();
      if (!task || task.status === 'running') return;
      const message = task.messages.find((entry) => entry.id === button.dataset.messageEdit);
      if (!message || message.role !== 'user') return;
      messageUI.editingTaskId = task.id;
      messageUI.editingMessageId = message.id;
      render();
      window.requestAnimationFrame(() => {
        const editor = document.getElementById(`message-edit-${message.id}`);
        editor?.focus();
        editor?.setSelectionRange(editor.value.length, editor.value.length);
      });
    });
  });

  document.querySelectorAll('[data-message-edit-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      messageUI.editingTaskId = null;
      messageUI.editingMessageId = null;
      render();
    });
  });

  document.querySelectorAll('[data-message-edit-form]').forEach((form) => {
    const editor = form.querySelector('textarea');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void resendEditedMessage(form.dataset.messageEditForm, editor?.value || '');
    });
    editor?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        messageUI.editingTaskId = null;
        messageUI.editingMessageId = null;
        render();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  });

  document.querySelectorAll('[data-message-feedback]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = getActiveTask();
      const message = task?.messages.find((entry) => entry.id === button.dataset.messageId);
      if (!task || !message || message.role !== 'assistant' || message.status === 'streaming') return;
      const feedback = button.dataset.messageFeedback;
      message.feedback = message.feedback === feedback ? null : feedback;
      message.feedbackUpdatedAt = Date.now();
      task.updatedAt = Date.now();
      saveState();
      render();
    });
  });

  const prompt = document.getElementById('task-prompt');
  if (prompt) {
    prompt.addEventListener('input', () => {
      prompt.classList.remove('field-error');
    });
    prompt.addEventListener('keydown', (event) => {
      if (!document.getElementById('composer-trigger-palette')?.hidden && event.key === 'Enter') return;
      const shouldSend = desktopSettings.preferences.sendOnEnter
        ? !event.shiftKey
        : event.metaKey || event.ctrlKey;
      if (event.key === 'Enter' && shouldSend && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!prompt.disabled) sendTaskMessage();
      }
    });
    bindComposerTriggers(prompt);
  }

  document.querySelectorAll('[data-remove-task-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const filePath = button.dataset.removeTaskFile;
      const current = composerFileReferences();
      setTaskFileReferences(current.filter((entry) => entry !== filePath));
      const textarea = document.getElementById('task-prompt');
      const cursor = textarea?.selectionStart || 0;
      if (textarea) {
        textarea.value = textarea.value.replaceAll(`@${filePath}`, '').replace(/ {2,}/g, ' ');
        persistComposerDraft(textarea);
      }
      saveState();
      render();
      focusComposerAfterRender(cursor);
    });
  });

  document.querySelectorAll('[data-remove-artifact-selection]').forEach((button) => {
    button.addEventListener('click', () => {
      const removed = composerArtifactSelections().find((selection) =>
        selection.selectionId === button.dataset.removeArtifactSelection
      );
      setTaskArtifactSelections(
        composerArtifactSelections().filter((selection) =>
          selection.selectionId !== button.dataset.removeArtifactSelection
        )
      );
      if (removed) {
        void window.meteoDesktop.removeArtifactSelection({
          previewId: removed.previewId,
          selectionId: removed.selectionId,
        });
      }
      saveState();
      render();
      focusComposerAfterRender(document.getElementById('task-prompt')?.value.length || 0);
    });
  });

  document.querySelectorAll('[data-artifact-selection-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      void jumpToArtifactSelection(button.dataset.artifactSelectionJump);
    });
  });

  const permissionTrigger = document.getElementById('composer-permission');
  const permissionPopover = document.getElementById('composer-permission-popover');
  if (permissionTrigger && permissionPopover) {
    const closePermissionMenu = () => {
      permissionPopover.hidden = true;
      permissionTrigger.setAttribute('aria-expanded', 'false');
    };
    const documentClickHandler = (event) => {
      if (!permissionTrigger.parentElement?.contains(event.target)) closePermissionMenu();
    };
    const documentKeyHandler = (event) => {
      if (event.key === 'Escape' && !permissionPopover.hidden) {
        closePermissionMenu();
        permissionTrigger.focus();
      }
    };

    permissionTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = permissionPopover.hidden;
      permissionPopover.hidden = !willOpen;
      permissionTrigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) permissionPopover.querySelector('[aria-selected="true"]')?.focus();
    });

    permissionPopover.querySelectorAll('[data-permission-profile-id]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        const permissionProfileId = element.dataset.permissionProfileId;
        const profile = catalog.permissionProfiles[permissionProfileId];
        const task = getActiveTask();
        if (task) {
          if (task.permissionProfileId !== permissionProfileId && task.sessionId) {
            task.sessionId = null;
            task.runtimeMode = null;
            task.usage = null;
            task.contextState = { phase: 'idle', message: '' };
          }
          task.permissionProfileId = permissionProfileId;
          task.allowFileTools = Boolean(profile?.fileTools);
          task.workMode = 'execute';
          task.updatedAt = Date.now();
        } else {
          state.draftPermissionProfileId = permissionProfileId;
        }
        permissionTrigger.dataset.permissionProfileId = permissionProfileId;
        permissionTrigger.dataset.tooltip = `审批策略：${profile?.name || '未知策略'}。${profile?.description || ''}`;
        permissionTrigger.setAttribute(
          'aria-label',
          `选择审批策略，当前为${profile?.name || '未知策略'}`
        );
        const permissionLabel = permissionTrigger.querySelector('.composer-permission-label');
        if (permissionLabel) permissionLabel.textContent = profile?.name || '未知策略';
        const permissionIcon = permissionTrigger.querySelector('.icon');
        if (permissionIcon) permissionIcon.outerHTML = icon(profile?.tone === 'full' ? 'warning' : 'shield');
        ['request', 'smart', 'full'].forEach((tone) => {
          permissionTrigger.classList.toggle(`permission-${tone}`, profile?.tone === tone);
        });
        permissionPopover.querySelectorAll('[data-permission-profile-id]').forEach((option) => {
          const selected = option.dataset.permissionProfileId === permissionProfileId;
          option.classList.toggle('selected', selected);
          option.setAttribute('aria-selected', String(selected));
          const check = option.querySelector('.permission-option-check');
          if (check) check.innerHTML = selected ? icon('check') : '';
        });
        saveState();
        closePermissionMenu();
        permissionTrigger.focus();
      });
    });

    document.addEventListener('click', documentClickHandler);
    document.addEventListener('keydown', documentKeyHandler);
    permissionMenuCleanup = () => {
      document.removeEventListener('click', documentClickHandler);
      document.removeEventListener('keydown', documentKeyHandler);
    };
  }

  const composerModel = document.getElementById('composer-model');
  if (composerModel) {
    composerModel.addEventListener('change', (event) => {
      const task = getActiveTask();
      const selection = parseModelSelectionValue(event.target.value) || {
        providerId: modelSettings.providerId,
        modelId: modelSettings.modelId || '',
      };
      if (task) {
        const modelChanged = task.providerId !== selection.providerId || task.modelId !== selection.modelId;
        if (task.sessionId && task.providerId !== selection.providerId) {
          task.sessionId = null;
          task.runtimeMode = null;
          task.usage = null;
          task.contextState = { phase: 'idle', message: '' };
        } else if (modelChanged && task.usage) {
          task.usage = { ...task.usage, contextLimit: null, size: null };
          task.contextState = { ...(task.contextState || {}), phase: 'idle', message: '' };
        }
        task.providerId = selection.providerId;
        task.modelId = selection.modelId;
        task.updatedAt = Date.now();
      } else {
        state.draftProviderId = selection.providerId;
        state.draftModelId = selection.modelId;
      }
      saveState();
    });
  }

  bindConnectorToolSelectors();
  bindSettingsDialogEvents();
  bindProjectDialogEvents();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  saveState();
  render();
  requestAnimationFrame(() => {
    document.getElementById('sidebar-toggle')?.focus();
  });
}

function toggleSidebarSection(section) {
  if (!['tasks', 'workspaces'].includes(section)) return;
  const collapsedSections = new Set(
    Array.isArray(state.collapsedSidebarSections) ? state.collapsedSidebarSections : []
  );
  if (collapsedSections.has(section)) collapsedSections.delete(section);
  else collapsedSections.add(section);
  state.collapsedSidebarSections = [...collapsedSections];
  saveState();
  render();
  requestAnimationFrame(() => {
    document.querySelector(`[data-sidebar-section-toggle="${section}"]`)?.focus();
  });
}

function startSidebarTaskRename(taskId) {
  if (!state.tasks.some((task) => task.id === taskId)) return;
  sidebarTaskUI.menuTaskId = null;
  sidebarTaskUI.editingTaskId = taskId;
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-sidebar-task-rename-form="${taskId}"] input`);
    input?.focus();
    input?.select();
  });
}

function toggleSidebarTaskMenu(taskId) {
  if (!state.tasks.some((task) => task.id === taskId && task.kind !== 'assistant')) return;
  sidebarTaskUI.menuTaskId = sidebarTaskUI.menuTaskId === taskId ? null : taskId;
  render();
  requestAnimationFrame(() => {
    if (sidebarTaskUI.menuTaskId === taskId) {
      document.querySelector('.sidebar-task-menu [role="menuitem"]')?.focus();
    } else {
      document.querySelector(`[data-sidebar-task-menu="${taskId}"]`)?.focus();
    }
  });
}

function cancelSidebarTaskRename() {
  if (!sidebarTaskUI.editingTaskId) return;
  sidebarTaskUI.editingTaskId = null;
  render();
}

function commitSidebarTaskRename(taskId, value) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const title = String(value || '').trim();
  if (!task || !title) return false;
  task.title = title;
  task.titleMode = 'manual';
  sidebarTaskUI.editingTaskId = null;
  sidebarTaskUI.menuTaskId = null;
  saveState();
  render();
  return true;
}

function deleteSidebarTask(taskId) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.kind === 'assistant') return false;
  if (task.status === 'running') {
    alert('任务正在运行，请先停止任务后再删除。');
    return false;
  }
  if (!confirm(`确定删除任务“${task.title}”吗？\n\n任务记录会从本机移除，已生成的成果文件不会删除。`)) {
    return false;
  }

  for (const timers of [runtimeStreamCommitTimers, runtimeProgressCommitTimers]) {
    const timer = timers.get(taskId);
    if (timer) window.clearTimeout(timer);
    timers.delete(taskId);
  }
  pendingStreamCommitTaskIds.delete(taskId);
  pendingQueuedPromptTaskIds.delete(taskId);
  sidebarTaskUI.editingTaskId = null;
  sidebarTaskUI.menuTaskId = null;
  state.tasks = state.tasks.filter((candidate) => candidate.id !== taskId);

  const removedTabs = previewUI.tabs.filter((tab) => tab.taskId === taskId);
  removedTabs.forEach((tab) => delete previewUI.surfaceStates[tab.id]);
  previewUI.tabs = previewUI.tabs.filter((tab) => tab.taskId !== taskId);
  if (previewUI.taskId === taskId) {
    previewUI.open = false;
    previewUI.taskId = null;
    previewUI.activeId = null;
  }
  if (state.activeTaskId === taskId) {
    state.activeTaskId = null;
    state.view = 'catalog';
  }
  saveState();
  render();
  return true;
}

function currentPreviewTask() {
  return state.view === 'assistants' ? getAssistantTask() : getActiveTask();
}

function previewWorkspace(task) {
  return task?.workspace || getConversationProject(task)?.workspace || '';
}

function openArtifactPreview(artifact, task = currentPreviewTask()) {
  if (!artifact || !task) return;
  const previewApi = window.MeteoMateHarness.ArtifactPreview;
  let tab;
  try {
    tab = previewApi.createPreviewTab(artifact, {
      taskId: task.id,
      workspace: previewWorkspace(task),
    });
  } catch {
    const target = artifact.path || artifact.uri;
    if (/^https?:\/\//i.test(target)) window.meteoDesktop.openExternalUrl(target);
    else if (target) window.meteoDesktop.openWorkspace(target);
    return;
  }

  const staleTabs = previewUI.tabs.filter((item) => item.taskId !== task.id);
  staleTabs.forEach((item) => {
    void window.meteoDesktop.closeArtifactPreview(item.id);
    delete previewUI.surfaceStates[item.id];
  });
  previewUI.tabs = previewUI.tabs.filter((item) => item.taskId === task.id);
  const existingIndex = previewUI.tabs.findIndex((item) => item.id === tab.id);
  if (existingIndex >= 0) previewUI.tabs[existingIndex] = { ...previewUI.tabs[existingIndex], ...tab };
  else previewUI.tabs.push(tab);
  if (previewUI.tabs.length > 8) {
    const [removed] = previewUI.tabs.splice(0, 1);
    if (removed.id !== tab.id) {
      void window.meteoDesktop.closeArtifactPreview(removed.id);
      delete previewUI.surfaceStates[removed.id];
    }
  }
  previewUI.taskId = task.id;
  previewUI.activeId = tab.id;
  previewUI.open = true;
  previewUI.surfaceStates[tab.id] = {
    ...(previewUI.surfaceStates[tab.id] || {}),
    address: tab.surfaceTarget,
    loading: true,
    error: '',
  };
  const workbenchWidth = document.querySelector('.task-workbench')?.clientWidth
    || document.querySelector('.main-shell')?.clientWidth
    || window.innerWidth;
  previewUI.width = previewApi.normalizePanelWidth(previewUI.width, workbenchWidth);
  render();
}

function activePreviewEntry() {
  const task = currentPreviewTask();
  return activePreviewTab(task);
}

async function jumpToArtifactSelection(selectionId) {
  const task = currentPreviewTask();
  const selection = findArtifactSelection(task, selectionId);
  if (!task || !selection) return;
  const artifact = task.artifacts?.find((entry) =>
    entry.id === selection.artifactId
    || [entry.path, entry.uri].filter(Boolean).includes(selection.sourcePath)
    || [entry.path, entry.uri].filter(Boolean).includes(selection.path)
  ) || {
    id: selection.artifactId || `selection-artifact-${String(selection.sourceHash || selection.selectionId).slice(0, 12)}`,
    name: selection.title,
    path: selection.sourcePath,
    uri: selection.sourcePath,
  };
  openArtifactPreview(artifact, task);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await syncArtifactPreviewSurface();
  const activeTab = activePreviewEntry();
  if (!activeTab) return;
  const located = { ...selection, previewId: activeTab.id };
  await window.meteoDesktop.jumpToArtifactSelection({
    previewId: activeTab.id,
    selection: located,
  });
}

function applyArtifactPreviewState(payload = {}) {
  if (!payload.id) return;
  const nextPayload = payload.error
    ? {
        ...payload,
        error: window.MeteoMateHarness.ArtifactPreview.previewErrorDetail(payload.error),
      }
    : payload;
  previewUI.surfaceStates[nextPayload.id] = {
    ...(previewUI.surfaceStates[nextPayload.id] || {}),
    ...nextPayload,
  };
  if (nextPayload.id !== previewUI.activeId) return;

  const addressInput = document.getElementById('artifact-preview-address-input');
  if (addressInput && nextPayload.address && document.activeElement !== addressInput) {
    addressInput.value = nextPayload.address;
  }
  const back = document.querySelector('[data-preview-navigate="back"]');
  const forward = document.querySelector('[data-preview-navigate="forward"]');
  if (back) back.disabled = !nextPayload.canGoBack;
  if (forward) forward.disabled = !nextPayload.canGoForward;

  const loadingButton = document.querySelector(
    '[data-preview-navigate="reload"], [data-preview-navigate="stop"]'
  );
  if (loadingButton && typeof nextPayload.loading === 'boolean') {
    loadingButton.dataset.previewNavigate = nextPayload.loading ? 'stop' : 'reload';
    loadingButton.classList.toggle('loading', nextPayload.loading);
    loadingButton.disabled = false;
    loadingButton.innerHTML = icon(nextPayload.loading ? 'close' : 'refresh');
    loadingButton.setAttribute('aria-label', nextPayload.loading ? '停止加载' : '刷新');
    loadingButton.title = nextPayload.loading ? '停止加载' : '刷新';
  }

  const documentDetail = document.getElementById('artifact-preview-document-detail');
  if (documentDetail) {
    const detail = [
      nextPayload.pageCount ? `${nextPayload.pageCount} 页` : '只读预览',
      nextPayload.imageBacked ? '高保真' : '',
      nextPayload.cached ? '已缓存' : '',
    ].filter(Boolean).join(' · ');
    documentDetail.textContent = nextPayload.loading ? '正在加载页面…' : detail;
  }

  const status = document.getElementById('artifact-preview-surface-status');
  if (!status) return;
  const error = String(nextPayload.error || '');
  const loading = Boolean(nextPayload.loading);
  status.hidden = !error && !loading;
  status.classList.toggle('error', Boolean(error));
  status.classList.toggle('loading', !error && loading);
  const title = status.querySelector('strong');
  const detail = status.querySelector('p');
  if (title) title.textContent = error ? '暂时无法预览' : '正在准备预览';
  if (detail) {
    const tab = previewUI.tabs.find((item) => item.id === nextPayload.id);
    detail.textContent = error || (tab?.extension === 'PDF'
      ? '正在加载页面…'
      : `正在将 ${tab?.extension || 'Office 文件'} 转换为只读预览…`);
  }
}

async function syncArtifactPreviewSurface() {
  const requestId = ++artifactPreviewSyncRequest;
  const surface = document.getElementById('artifact-preview-surface');
  if (!surface || !previewUI.open) {
    await window.meteoDesktop.hideArtifactPreview();
    return;
  }
  const rect = surface.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) {
    await window.meteoDesktop.hideArtifactPreview();
    return;
  }
  try {
    const snapshot = await window.meteoDesktop.showArtifactPreview({
      id: surface.dataset.previewId,
      originalTarget: surface.dataset.previewOriginalTarget,
      target: surface.dataset.previewTarget,
      workspace: surface.dataset.previewWorkspace,
      taskId: surface.dataset.previewTaskId,
      artifactId: surface.dataset.previewArtifactId,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
    if (requestId === artifactPreviewSyncRequest) {
      applyArtifactPreviewState(snapshot);
      const task = currentPreviewTask();
      taskArtifactSelections(task)
        .filter((selection) => selection.previewId === surface.dataset.previewId)
        .slice(-24)
        .forEach((selection) => {
          void window.meteoDesktop.highlightArtifactSelection({
            previewId: surface.dataset.previewId,
            selection,
          });
        });
    }
  } catch (error) {
    if (requestId !== artifactPreviewSyncRequest) return;
    applyArtifactPreviewState({
      id: surface.dataset.previewId,
      address: surface.dataset.previewTarget,
      error: error?.message || '预览加载失败',
      loading: false,
    });
  }
}

function updateArtifactPreviewBounds() {
  const surface = document.getElementById('artifact-preview-surface');
  if (!surface || !previewUI.open) return;
  const workbench = document.querySelector('.task-workbench');
  if (workbench) {
    const previewApi = window.MeteoMateHarness.ArtifactPreview;
    previewUI.width = previewApi.normalizePanelWidth(previewUI.width, workbench.clientWidth);
    workbench.style.setProperty('--preview-panel-width', `${previewUI.width}px`);
    const resizer = document.getElementById('artifact-preview-resizer');
    resizer?.setAttribute('aria-valuenow', String(previewUI.width));
    resizer?.setAttribute(
      'aria-valuemax',
      String(previewApi.normalizePanelWidth(100000, workbench.clientWidth))
    );
  }
  const rect = surface.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return;
  void window.meteoDesktop.updateArtifactPreviewBounds({
    id: surface.dataset.previewId,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  });
}

async function navigateActivePreview(action, value = '') {
  const tab = activePreviewEntry();
  if (!tab) return;
  try {
    const snapshot = await window.meteoDesktop.navigateArtifactPreview({
      id: tab.id,
      action,
      url: value,
      workspace: tab.workspace,
    });
    applyArtifactPreviewState(snapshot);
  } catch (error) {
    applyArtifactPreviewState({
      id: tab.id,
      error: error?.message || '预览导航失败',
      loading: false,
    });
  }
}

function closePreviewTab(previewId) {
  const closingIndex = previewUI.tabs.findIndex((item) => item.id === previewId);
  if (closingIndex < 0) return;
  const wasActive = previewUI.activeId === previewId;
  previewUI.tabs.splice(closingIndex, 1);
  delete previewUI.surfaceStates[previewId];
  void window.meteoDesktop.closeArtifactPreview(previewId);
  const taskTabs = previewUI.tabs.filter((item) => item.taskId === previewUI.taskId);
  if (!taskTabs.length) {
    previewUI.open = false;
    previewUI.activeId = null;
    void window.meteoDesktop.hideArtifactPreview();
  } else if (wasActive) {
    previewUI.activeId = taskTabs[Math.min(closingIndex, taskTabs.length - 1)].id;
  }
  render();
}

function openActivePreviewExternally() {
  const tab = activePreviewEntry();
  if (!tab) return;
  const target = tab.target || tab.surfaceTarget;
  if (/^https?:\/\//i.test(target)) window.meteoDesktop.openExternalUrl(target);
  else if (/^file:/i.test(target)) {
    try {
      window.meteoDesktop.openWorkspace(decodeURIComponent(new URL(target).pathname));
    } catch {
      return;
    }
  } else window.meteoDesktop.openWorkspace(target);
}

function bindArtifactPreviewResizer() {
  const resizer = document.getElementById('artifact-preview-resizer');
  const workbench = document.querySelector('.task-workbench');
  if (!resizer || !workbench) return;
  const previewApi = window.MeteoMateHarness.ArtifactPreview;
  const applyWidth = (width) => {
    previewUI.width = previewApi.normalizePanelWidth(width, workbench.clientWidth);
    workbench.style.setProperty('--preview-panel-width', `${previewUI.width}px`);
    resizer.setAttribute('aria-valuenow', String(previewUI.width));
    resizer.setAttribute(
      'aria-valuemax',
      String(previewApi.normalizePanelWidth(100000, workbench.clientWidth))
    );
    window.requestAnimationFrame(updateArtifactPreviewBounds);
  };
  resizer.setAttribute(
    'aria-valuemax',
    String(previewApi.normalizePanelWidth(100000, workbench.clientWidth))
  );
  resizer.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    applyWidth(previewUI.width + (event.key === 'ArrowLeft' ? 24 : -24));
    localStorage.setItem('meteomate-preview-width-v1', String(previewUI.width));
  });
  resizer.addEventListener('click', () => resizer.focus());
  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizer.focus();
    const startX = event.clientX;
    const startWidth = previewUI.width;
    document.body.classList.add('resizing-artifact-preview');
    const move = (moveEvent) => applyWidth(startWidth + startX - moveEvent.clientX);
    const finish = () => {
      document.body.classList.remove('resizing-artifact-preview');
      localStorage.setItem('meteomate-preview-width-v1', String(previewUI.width));
      artifactPreviewResizeCleanup?.();
      artifactPreviewResizeCleanup = null;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish, { once: true });
    artifactPreviewResizeCleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.body.classList.remove('resizing-artifact-preview');
    };
  });
}

function bindArtifactPreviewEvents() {
  document.querySelector('[data-preview-latest]')?.addEventListener('click', () => {
    const task = currentPreviewTask();
    const artifact = task?.artifacts?.at(-1);
    if (artifact) openArtifactPreview(artifact, task);
  });
  document.querySelectorAll('[data-preview-tab]').forEach((element) => {
    element.addEventListener('click', () => {
      previewUI.activeId = element.dataset.previewTab;
      previewUI.open = true;
      render();
    });
  });
  document.querySelectorAll('[data-preview-close]').forEach((element) => {
    element.addEventListener('click', () => closePreviewTab(element.dataset.previewClose));
  });
  document.querySelector('[data-preview-panel-toggle]')?.addEventListener('click', () => {
    const task = currentPreviewTask();
    if (!task) return;
    const previewOpen = previewUI.open && previewUI.taskId === task.id;
    if (previewOpen) {
      previewUI.open = false;
      void window.meteoDesktop.hideArtifactPreview();
      render();
      return;
    }
    const taskTabs = previewUI.tabs.filter((tab) => tab.taskId === task.id);
    if (taskTabs.length) {
      previewUI.taskId = task.id;
      previewUI.activeId = taskTabs.some((tab) => tab.id === previewUI.activeId)
        ? previewUI.activeId
        : taskTabs.at(-1).id;
      previewUI.open = true;
      render();
      return;
    }
    const artifact = task.artifacts?.at(-1);
    if (artifact) openArtifactPreview(artifact, task);
  });
  document.querySelectorAll('[data-preview-navigate]').forEach((element) => {
    element.addEventListener('click', () => navigateActivePreview(element.dataset.previewNavigate));
  });
  document.getElementById('artifact-preview-address-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = document.getElementById('artifact-preview-address-input')?.value.trim();
    if (value) void navigateActivePreview('url', value);
  });
  document.querySelectorAll('[data-preview-open-external]').forEach((element) => {
    element.addEventListener('click', openActivePreviewExternally);
  });
  bindArtifactPreviewResizer();
}

window.MeteoMatePreview = {
  openArtifact: openArtifactPreview,
  sync: syncArtifactPreviewSurface,
};

window.addEventListener('resize', () => {
  window.requestAnimationFrame(updateArtifactPreviewBounds);
});

function captureSettingsReturnContext() {
  const scrollSelectors = [
    '.conversation-scroll',
    '.content-scroll',
    '.page-content',
    '.project-detail-content',
    '.automation-content',
    '.workflow-library',
    '.workflow-design-surface',
    '.workflow-run-console',
  ];
  const scrollSelector = scrollSelectors.find((selector) => document.querySelector(selector)) || null;
  return {
    view: state.view,
    activeTaskId: state.activeTaskId,
    activeProjectId: state.activeProjectId,
    catalogTab: state.catalogTab,
    projectTab: projectUI.tab,
    scrollSelector,
    scrollTop: scrollSelector ? document.querySelector(scrollSelector).scrollTop : 0,
  };
}

function openSettingsDialog(section = 'general') {
  if (!settingsDialog.open) settingsDialog.returnContext = captureSettingsReturnContext();
  settingsDialog.open = true;
  settingsDialog.section = section;
  settingsDialog.providerDraft = null;
  settingsDialog.modelDraft = null;
  settingsDialog.pendingProvider = null;
  settingsDialog.providerTest = { status: 'idle', result: null };
  modelSettings.message = '';
  modelSettings.error = '';
  render();
  if (section === 'models') void loadModelSettings();
  if (desktopSettings.status === 'idle') void loadDesktopSettings();
}

function closeSettingsDialog() {
  const returnContext = settingsDialog.returnContext;
  settingsDialog.open = false;
  settingsDialog.returnContext = null;
  settingsDialog.providerDraft = null;
  settingsDialog.modelDraft = null;
  settingsDialog.pendingProvider = null;
  settingsDialog.providerTest = { status: 'idle', result: null };
  if (returnContext) {
    state.view = returnContext.view;
    state.activeTaskId = returnContext.activeTaskId;
    state.activeProjectId = returnContext.activeProjectId;
    state.catalogTab = returnContext.catalogTab;
    projectUI.tab = returnContext.projectTab;
  }
  render();
  requestAnimationFrame(() => {
    const scrollElement = returnContext?.scrollSelector
      ? document.querySelector(returnContext.scrollSelector)
      : null;
    if (scrollElement) scrollElement.scrollTop = returnContext.scrollTop;
    document.getElementById('sidebar-account-trigger')?.focus();
  });
}

function closeSettingsEditor() {
  if (settingsDialog.modelDraft && settingsDialog.pendingProvider) {
    settingsDialog.providerDraft = { ...settingsDialog.pendingProvider };
    settingsDialog.modelDraft = null;
    settingsDialog.pendingProvider = null;
    settingsDialog.providerTest = { status: 'idle', result: null };
    modelSettings.message = '';
    modelSettings.error = '';
    render();
    return;
  }
  settingsDialog.providerDraft = null;
  settingsDialog.modelDraft = null;
  settingsDialog.pendingProvider = null;
  settingsDialog.providerTest = { status: 'idle', result: null };
  modelSettings.message = '';
  modelSettings.error = '';
  render();
}

function showSettingsError(message) {
  modelSettings.status = 'error';
  modelSettings.message = '';
  modelSettings.error = message;
  render();
}

function bindSettingsDialogEvents() {
  if (!settingsDialog.open) return;

  document.querySelectorAll('[data-settings-close]').forEach((element) => {
    element.addEventListener('click', closeSettingsDialog);
  });
  document.querySelectorAll('[data-settings-section]').forEach((element) => {
    element.addEventListener('click', () => {
      const section = element.dataset.settingsSection;
      if (!settingsSections[section] || settingsDialog.section === section) return;
      settingsDialog.section = section;
      document.querySelectorAll('[data-settings-section]').forEach((entry) => {
        const active = entry.dataset.settingsSection === section;
        entry.classList.toggle('active', active);
        entry.setAttribute('aria-current', active ? 'page' : 'false');
      });
      document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.settingsPanel !== section;
      });
      const title = document.querySelector('[data-settings-page-title]');
      const description = document.querySelector('[data-settings-page-description]');
      if (title) title.textContent = settingsSections[section].title;
      if (description) description.textContent = settingsSections[section].description;
      const body = document.querySelector('.settings-page-body');
      if (body) body.scrollTop = 0;
      if (settingsDialog.section === 'models' && modelSettings.status === 'idle') void loadModelSettings();
    });
  });

  document.querySelectorAll('[data-desktop-setting]').forEach((element) => {
    if (element.type === 'range') {
      element.addEventListener('input', () => {
        const badge = document.querySelector('[data-threshold-value]');
        if (badge) badge.textContent = `${element.value}%`;
      });
    }
    element.addEventListener('change', () => {
      const key = element.dataset.desktopSetting;
      const value = element.type === 'checkbox'
        ? element.checked
        : element.type === 'range'
          ? Number(element.value) / 100
          : element.value;
      void persistDesktopSetting(key, value);
    });
  });

  document.querySelectorAll('[data-open-settings-workspace]').forEach((element) => {
    element.addEventListener('click', () => {
      const target = element.dataset.openSettingsWorkspace === 'project'
        ? desktopSettings.projectWorkspace
        : desktopSettings.assistantWorkspace;
      if (target) void window.meteoDesktop.openWorkspace(target);
    });
  });

  document.querySelectorAll('[data-settings-navigate]').forEach((element) => {
    element.addEventListener('click', () => {
      const destination = element.dataset.settingsNavigate;
      settingsDialog.open = false;
      settingsDialog.returnContext = null;
      if (destination === 'knowledge') state.view = 'more-knowledge';
      render();
    });
  });

  document.querySelectorAll('[data-add-provider]').forEach((element) => {
    element.addEventListener('click', () => {
      settingsDialog.providerDraft = {
        displayName: '',
        apiUrl: '',
        apiKeySet: false,
        requiresAuth: true,
        presetMode: 'auto',
        protocolMode: 'auto',
        streamingMode: 'auto',
        endpointPathOverride: '',
      };
      settingsDialog.providerTest = { status: 'idle', result: null };
      modelSettings.error = '';
      modelSettings.message = '';
      render();
      document.getElementById('provider-display-name')?.focus();
    });
  });
  document.querySelectorAll('[data-provider-id].provider-list-item').forEach((element) => {
    element.addEventListener('click', () => {
      settingsDialog.selectedProviderId = element.dataset.providerId;
      document.querySelectorAll('[data-provider-id].provider-list-item').forEach((entry) => {
        entry.classList.toggle('active', entry.dataset.providerId === settingsDialog.selectedProviderId);
      });
      document.querySelectorAll('[data-provider-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.providerPanel !== settingsDialog.selectedProviderId;
      });
      const workspace = document.querySelector('.provider-workspace');
      if (workspace) workspace.scrollTop = 0;
    });
  });
  document.querySelectorAll('[data-edit-provider]').forEach((element) => {
    element.addEventListener('click', () => {
      const provider = modelSettings.providers.find((entry) => entry.id === element.dataset.editProvider);
      if (!provider) return;
      settingsDialog.providerDraft = {
        id: provider.id,
        displayName: provider.name,
        apiUrl: provider.apiUrl,
        apiKeySet: provider.apiKeySet,
        requiresAuth: provider.requiresAuth,
        presetMode: provider.presetMode || 'auto',
        providerPreset: provider.providerPreset,
        protocolMode: provider.protocolMode || 'auto',
        protocol: provider.protocol,
        streamingMode: provider.streamingMode || 'auto',
        supportsStreaming: provider.supportsStreaming,
        endpointPathOverride: provider.endpointPathOverride || '',
        endpointUrl: provider.endpointUrl,
        verification: provider.verification,
        organizationManaged: Boolean(provider.organizationManaged),
        organizationProviderId: provider.organizationProviderId || provider.id,
        localProviderAvailable: provider.localProviderAvailable !== false,
        credentialMode: provider.credentialMode || 'local',
        credentialConfigured: Boolean(provider.credentialConfigured),
        modelId: provider.models?.[0]?.id || '',
        toolCall: Boolean(provider.models?.[0]?.toolCall),
        imageInput: Boolean(provider.models?.[0]?.imageInput),
      };
      settingsDialog.providerTest = { status: 'idle', result: provider.verification || null };
      modelSettings.error = '';
      modelSettings.message = '';
      render();
      document.getElementById('provider-display-name')?.focus();
    });
  });
  document.querySelectorAll('[data-add-model]').forEach((element) => {
    element.addEventListener('click', () => {
      settingsDialog.modelDraft = {
        providerId: element.dataset.addModel,
        id: '',
        name: '',
        toolCall: true,
        imageInput: false,
        reasoning: false,
        contextLimit: null,
        maxOutputTokens: null,
      };
      modelSettings.error = '';
      modelSettings.message = '';
      render();
      document.getElementById('custom-model-id')?.focus();
    });
  });
  document.querySelectorAll('[data-edit-model]').forEach((element) => {
    element.addEventListener('click', () => {
      const provider = modelSettings.providers.find((entry) => entry.id === element.dataset.providerId);
      const model = provider?.models.find((entry) => entry.id === element.dataset.editModel);
      if (!model) return;
      settingsDialog.modelDraft = {
        providerId: provider.id,
        originalId: model.id,
        id: model.id,
        name: model.name === model.id ? '' : model.name,
        toolCall: Boolean(model.toolCall),
        imageInput: Boolean(model.imageInput),
        reasoning: Boolean(model.reasoning),
        contextLimit: model.contextLimit || null,
        maxOutputTokens: model.maxOutputTokens || null,
      };
      modelSettings.error = '';
      modelSettings.message = '';
      render();
      document.getElementById('custom-model-id')?.focus();
    });
  });
  document.querySelectorAll('[data-settings-editor-back]').forEach((element) => {
    element.addEventListener('click', closeSettingsEditor);
  });
  document.querySelectorAll('[data-model-limit]').forEach((element) => {
    element.addEventListener('click', () => {
      const input = document.getElementById(element.dataset.limitTarget);
      if (input) input.value = element.dataset.modelLimit;
    });
  });
  document.querySelectorAll('[data-default-model]').forEach((element) => {
    element.addEventListener('click', async () => {
      modelSettings.providerId = element.dataset.providerId;
      modelSettings.modelId = element.dataset.defaultModel;
      await persistModelSettings();
    });
  });
  document.querySelectorAll('[data-delete-provider]').forEach((element) => {
    element.addEventListener('click', () => deleteCustomProvider(element.dataset.deleteProvider));
  });
  document.querySelectorAll('[data-delete-model]').forEach((element) => {
    element.addEventListener('click', () => deleteCustomModel(element.dataset.providerId, element.dataset.deleteModel));
  });
  document.querySelectorAll('[data-test-provider]').forEach((element) => {
    element.addEventListener('click', () => testCustomProviderConnection(element.dataset.testProvider));
  });
  document.querySelectorAll('#provider-api-url, #provider-endpoint-path, #provider-api-key, #provider-no-auth, input[name="provider-preset-mode"], input[name="provider-protocol-mode"], input[name="provider-streaming-mode"]').forEach((element) => {
    const eventName = element.matches('input[type="radio"]') ? 'change' : 'input';
    element.addEventListener(eventName, () => {
      invalidateProviderTest();
      void refreshProviderRoutePreview();
    });
  });
  if (settingsDialog.pendingProvider) {
    document.querySelectorAll('#custom-model-id, #model-tool-call, #model-image-input').forEach((element) => {
      element.addEventListener(element.type === 'checkbox' ? 'change' : 'input', invalidateProviderTest);
    });
  }
  document.getElementById('provider-editor-form')?.addEventListener('submit', saveCustomProvider);
  document.getElementById('model-editor-form')?.addEventListener('submit', saveCustomModel);
  if (settingsDialog.providerDraft) void refreshProviderRoutePreview();

  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (settingsDialog.providerDraft || settingsDialog.modelDraft) closeSettingsEditor();
      else closeSettingsDialog();
      return;
    }
  };
  document.addEventListener('keydown', keyHandler);
  settingsDialogCleanup = () => document.removeEventListener('keydown', keyHandler);
}

function selectedProviderOption(name, fallback = 'auto') {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function readProviderConnectionForm() {
  const noAuth = Boolean(document.getElementById('provider-no-auth')?.checked);
  return {
    displayName: document.getElementById('provider-display-name')?.value.trim() || '',
    apiUrl: document.getElementById('provider-api-url')?.value.trim() || '',
    apiKey: noAuth ? '' : document.getElementById('provider-api-key')?.value || '',
    requiresAuth: !noAuth,
    presetMode: selectedProviderOption('provider-preset-mode'),
    protocolMode: selectedProviderOption('provider-protocol-mode'),
    streamingMode: selectedProviderOption('provider-streaming-mode'),
    endpointPathOverride: document.getElementById('provider-endpoint-path')?.value.trim() || '',
  };
}

function invalidateProviderTest() {
  settingsDialog.providerTest = { status: 'idle', result: null };
  if (settingsDialog.providerDraft) settingsDialog.providerDraft.verification = null;
  const container = document.getElementById('provider-test-result');
  if (container) container.innerHTML = renderProviderVerification(null, { emptyText: '配置已变化，请重新验证' });
}

async function refreshProviderRoutePreview() {
  const endpoint = document.getElementById('provider-effective-endpoint');
  if (!endpoint) return;
  const request = readProviderConnectionForm();
  if (!request.apiUrl) {
    endpoint.textContent = '输入 Base URL 后显示实际请求地址';
    return;
  }
  try {
    const route = await window.meteoDesktop.previewModelProviderRoute(request);
    endpoint.textContent = route.endpointUrl || '无法推导请求地址';
    endpoint.title = route.endpointUrl || '';
    const transport = document.getElementById('provider-resolved-transport');
    const streaming = document.getElementById('provider-resolved-streaming');
    if (transport) transport.textContent = `${providerPresetLabel(route.providerPreset)} · ${providerProtocolLabel(route.protocol)}`;
    if (streaming) streaming.textContent = route.supportsStreaming ? '流式' : '非流式';
  } catch {
    endpoint.textContent = 'Base URL 无效';
  }
}

async function testCustomProviderConnection(context) {
  if (settingsDialog.providerTest.status === 'testing') return;
  const providerForm = context === 'provider';
  const request = providerForm
    ? {
        ...readProviderConnectionForm(),
        modelId: settingsDialog.providerDraft.modelId,
        toolCall: settingsDialog.providerDraft.toolCall,
        imageInput: settingsDialog.providerDraft.imageInput,
      }
    : {
        ...settingsDialog.pendingProvider,
        modelId: document.getElementById('custom-model-id')?.value.trim() || '',
        toolCall: Boolean(document.getElementById('model-tool-call')?.checked),
        imageInput: Boolean(document.getElementById('model-image-input')?.checked),
      };
  const button = document.querySelector(`[data-test-provider="${context}"]`);
  const container = document.getElementById('provider-test-result');
  settingsDialog.providerTest = { status: 'testing', result: null };
  if (button) {
    button.disabled = true;
    button.textContent = '验证中…';
  }
  if (container) container.innerHTML = '<div class="provider-verification-state testing"><span></span><div><strong>正在连接模型服务</strong><small>验证文本响应和已声明能力…</small></div></div>';
  try {
    const result = await window.meteoDesktop.testModelProvider(request);
    settingsDialog.providerTest = { status: result.status, result };
    if (container) container.innerHTML = renderProviderVerification(result);
  } catch (error) {
    const result = {
      status: 'failed',
      verifiedAt: new Date().toISOString(),
      tests: [],
      message: error?.message || '连接验证失败',
    };
    settingsDialog.providerTest = { status: 'failed', result };
    if (container) container.innerHTML = renderProviderVerification(result);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '重新测试';
    }
  }
}

async function saveCustomProvider(event) {
  event.preventDefault();
  if (modelSettings.status === 'saving') return;
  const request = readProviderConnectionForm();
  const { displayName, apiUrl, apiKey } = request;
  if (!displayName) return showSettingsError('请输入提供商名称。');
  try {
    const parsed = new URL(apiUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return showSettingsError('请输入有效的 HTTP 或 HTTPS Base URL。');
  }
  if (request.requiresAuth && !apiKey && !settingsDialog.providerDraft.apiKeySet) {
    return showSettingsError('请输入 API Key，或勾选“此地址无需 API Key”。');
  }
  const editing = Boolean(settingsDialog.providerDraft.id);
  if (!editing) {
    settingsDialog.pendingProvider = {
      ...request,
      verification: settingsDialog.providerTest.result,
    };
    settingsDialog.providerDraft = null;
    settingsDialog.modelDraft = {
      providerId: '',
      id: '',
      name: '',
      toolCall: true,
      imageInput: false,
      reasoning: false,
      contextLimit: null,
      maxOutputTokens: null,
    };
    modelSettings.status = 'ready';
    modelSettings.error = '';
    render();
    document.getElementById('custom-model-id')?.focus();
    return;
  }
  modelSettings.status = 'saving';
  modelSettings.error = '';
  render();
  try {
    const updateRequest = {
      ...request,
      providerId: settingsDialog.providerDraft.id || null,
      organizationManaged: Boolean(settingsDialog.providerDraft.organizationManaged),
      organizationProviderId: settingsDialog.providerDraft.organizationProviderId || '',
      localProviderAvailable: settingsDialog.providerDraft.localProviderAvailable !== false,
      apiKey: request.requiresAuth ? apiKey || null : '',
      verification: settingsDialog.providerTest.result,
    };
    const settings = await window.meteoDesktop.updateModelProvider(updateRequest);
    settingsDialog.providerDraft = null;
    applyModelSettings(settings, '提供商已更新。');
    settingsDialog.selectedProviderId = settings.lastChangedProviderId || settings.providerId;
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = error?.message || '提供商保存失败。';
  }
  render();
}

async function deleteCustomProvider(providerId) {
  const provider = modelSettings.providers.find((entry) => entry.id === providerId);
  if (!provider || !confirm(`确定删除提供商“${provider.name}”吗？其模型也会一并移除。`)) return;
  modelSettings.status = 'saving';
  modelSettings.error = '';
  render();
  try {
    const settings = await window.meteoDesktop.deleteModelProvider({ providerId });
    settingsDialog.selectedProviderId = settings.providers?.[0]?.id || '';
    applyModelSettings(settings, '提供商已删除。');
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = error?.message || '提供商删除失败。';
  }
  render();
}

async function saveCustomModel(event) {
  event.preventDefault();
  if (modelSettings.status === 'saving') return;
  const id = document.getElementById('custom-model-id')?.value.trim() || '';
  const name = document.getElementById('custom-model-name')?.value.trim() || '';
  if (!id) return showSettingsError('请输入模型 ID。');
  const toLimit = (elementId) => {
    const value = Number(document.getElementById(elementId)?.value || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  };
  const model = {
    id,
    name,
    toolCall: Boolean(document.getElementById('model-tool-call')?.checked),
    imageInput: Boolean(document.getElementById('model-image-input')?.checked),
    reasoning: Boolean(document.getElementById('model-reasoning')?.checked),
    contextLimit: toLimit('model-context-limit'),
    maxOutputTokens: toLimit('model-output-limit'),
  };
  modelSettings.status = 'saving';
  modelSettings.error = '';
  render();
  try {
    const settings = settingsDialog.pendingProvider
      ? await window.meteoDesktop.createModelProvider({
          ...settingsDialog.pendingProvider,
          model,
          verification: settingsDialog.providerTest.result,
        })
      : await window.meteoDesktop.saveCustomModel({
          providerId: settingsDialog.modelDraft.providerId,
          originalModelId: settingsDialog.modelDraft.originalId || null,
          model,
        });
    const wasEditing = Boolean(settingsDialog.modelDraft.originalId);
    settingsDialog.modelDraft = null;
    settingsDialog.pendingProvider = null;
    settingsDialog.selectedProviderId = settings.lastChangedProviderId || settings.providerId;
    applyModelSettings(settings, wasEditing ? '模型已更新。' : '模型已添加。');
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = error?.message || '模型保存失败。';
  }
  render();
}

async function deleteCustomModel(providerId, modelId) {
  const provider = modelSettings.providers.find((entry) => entry.id === providerId);
  const model = provider?.models.find((entry) => entry.id === modelId);
  const modelLabel = model?.name || modelId;
  const isDefault = modelSettings.providerId === providerId && modelSettings.modelId === modelId;
  const defaultNotice = isDefault ? '\n\n这是当前默认模型，删除后需要重新选择默认模型。' : '';
  if (!confirm(`确定删除模型“${modelLabel}”吗？${defaultNotice}`)) return;
  modelSettings.status = 'saving';
  modelSettings.error = '';
  render();
  try {
    const settings = await window.meteoDesktop.deleteCustomModel({ providerId, modelId });
    settingsDialog.modelDraft = null;
    settingsDialog.selectedProviderId = providerId;
    applyModelSettings(settings, '模型已删除。');
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = error?.message || '模型删除失败。';
  }
  render();
}

function navigate(view) {
  catalogUI.detailExpertId = null;
  if (view === 'workflows') {
    state.catalogTab = 'workflows';
    view = 'catalog';
  }
  window.MeteoMateWorkflowCenter?.onNavigate?.(view);
  if (view !== 'automation') {
    automationUI.editor = null;
    automationUI.error = '';
  }
  if (view !== 'more-knowledge') {
    knowledgeUI.editor = null;
    knowledgeUI.error = '';
    knowledgeUI.testResult = null;
  }
  if (view === 'task-new') {
    teamUI.collapsed = false;
    teamUI.expanded = false;
    teamUI.selectedMemberId = null;
    teamUI.expandedResultIds.clear();
    state.selectedExpertId = null;
    state.activeProjectId = null;
    state.activeTaskId = null;
    state.draftTaskMode = 'forecast';
    state.draftSceneId = null;
    state.draftPrompt = '';
    state.draftSkillIds = [];
    state.draftConnectorIds = [];
    state.draftToolSelections = {};
    state.draftFileReferences = [];
    state.draftArtifactSelections = [];
    state.draftPermissionProfileId = null;
    state.draftProviderId = null;
    state.draftModelId = null;
    state.view = 'task';
  } else if (view === 'assistants') {
    const assistantTask = getAssistantTask();
    state.view = 'assistants';
    state.activeTaskId = assistantTask?.id || null;
    if (assistantTask) state.assistantTaskId = assistantTask.id;
  } else {
    state.view = view;
    if (view !== 'task') state.activeTaskId = null;
  }
  saveState();
  render();
}

function applyModelSettings(settings, message = '') {
  modelSettings.status = 'ready';
  modelSettings.providerId = settings.providerId || settings.providers?.[0]?.id || '';
  modelSettings.modelId = settings.modelId || '';
  modelSettings.providers = Array.isArray(settings.providers) ? settings.providers : [];
  modelSettings.organizationPolicy = settings.organizationPolicy || null;
  modelSettings.message = message;
  modelSettings.error = '';
}

async function loadDesktopSettings({ rerender = true } = {}) {
  desktopSettings.status = 'loading';
  desktopSettings.error = '';
  if (rerender) render();
  try {
    const [preferences, assistantWorkspace, projectWorkspace] = await Promise.all([
      window.meteoDesktop.getDesktopPreferences(),
      window.meteoDesktop.getDefaultAssistantWorkspace(),
      window.meteoDesktop.getDefaultProjectWorkspace(),
    ]);
    desktopSettings.preferences = { ...desktopSettings.preferences, ...(preferences || {}) };
    desktopSettings.assistantWorkspace = assistantWorkspace || '';
    desktopSettings.projectWorkspace = projectWorkspace || '';
    desktopSettings.status = 'ready';
  } catch (error) {
    desktopSettings.status = 'error';
    desktopSettings.error = error?.message || '设置暂时无法读取，请稍后重试。';
  }
  if (rerender) render();
}

async function persistDesktopSetting(key, value) {
  if (!Object.hasOwn(desktopSettings.preferences, key)) return;
  const previous = desktopSettings.preferences[key];
  desktopSettings.preferences[key] = value;
  desktopSettings.status = 'saving';
  desktopSettings.message = '';
  desktopSettings.error = '';
  try {
    const preferences = await window.meteoDesktop.saveDesktopPreferences(desktopSettings.preferences);
    desktopSettings.preferences = { ...desktopSettings.preferences, ...(preferences || {}) };
    desktopSettings.status = 'ready';
    desktopSettings.message = '已保存';
    if (key === 'autoCompactThreshold') {
      state.runtime = await window.meteoDesktop.refreshRuntimePreferences();
      runtimeRouter.updateStatus(state.runtime);
    }
  } catch (error) {
    desktopSettings.preferences[key] = previous;
    desktopSettings.status = 'error';
    desktopSettings.error = error?.message || '设置保存失败，请稍后重试。';
  }
  render();
}

async function loadModelSettings() {
  modelSettings.status = 'loading';
  modelSettings.message = '';
  modelSettings.error = '';
  render();
  try {
    applyModelSettings(await window.meteoDesktop.getModelSettings());
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = '模型配置暂时无法读取，请稍后重试。';
  }
  render();
}

async function persistModelSettings() {
  if (!modelSettings.providerId || modelSettings.status === 'saving') return;
  modelSettings.status = 'saving';
  modelSettings.message = '';
  modelSettings.error = '';
  render();
  try {
    const settings = await window.meteoDesktop.saveModelSettings({
      providerId: modelSettings.providerId,
      modelId: modelSettings.modelId || null,
    });
    applyModelSettings(settings, '已保存，新建任务将使用这组配置。');
  } catch (error) {
    modelSettings.status = 'error';
    modelSettings.error = error?.message || '模型设置保存失败，请稍后重试。';
  }
  render();
}

function openExpert(expertId, prompt = '') {
  if (!expertId) return;
  catalogUI.detailExpertId = null;
  teamUI.collapsed = false;
  teamUI.expanded = false;
  teamUI.selectedMemberId = null;
  teamUI.expandedResultIds.clear();
  state.selectedExpertId = expertId;
  state.draftSceneId = catalog.scenes.find((scene) => scene.expertId === expertId)?.id || null;
  state.draftTaskMode = catalog.scenes.find((scene) => scene.id === state.draftSceneId)?.group || 'forecast';
  state.activeTaskId = null;
  state.draftPermissionProfileId = null;
  state.draftProviderId = null;
  state.draftModelId = null;
  state.draftPrompt = prompt;
  state.view = 'task';
  saveState();
  render();
}

function toggleFavorite(expertId) {
  const index = state.favoriteExpertIds.indexOf(expertId);
  if (index >= 0) state.favoriteExpertIds.splice(index, 1);
  else state.favoriteExpertIds.push(expertId);
  saveState();
  render();
}

async function addProject() {
  const workspace = await window.meteoDesktop.chooseWorkspace();
  if (!workspace) return null;
  const existing = state.projects.find((project) => project.workspace === workspace);
  if (existing) {
    state.activeProjectId = existing.id;
    existing.updatedAt = Date.now();
    saveState();
    render();
    return existing;
  }

  const project = window.MeteoMateHarness.Project.normalizeProject({
    id: cryptoRandomId(),
    name: pathBaseName(workspace) || `气象项目 ${state.projects.length + 1}`,
    workspace,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    connectorIds: ['local-workspace'],
  });
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  saveState();
  render();
  return project;
}

function openProjectDetail(projectId) {
  if (!state.projects.some((project) => project.id === projectId)) return;
  state.activeProjectId = projectId;
  state.view = 'project-detail';
  state.activeTaskId = null;
  projectUI.tab = 'overview';
  saveState();
  render();
}

function projectDialogDraft(templateId = '', project = null) {
  const template = projectTemplates.find((entry) => entry.id === templateId);
  const capabilities = project?.spec?.capabilities || {};
  const projectTemplateId = project?.spec?.assets?.templates?.[0] || '';
  return {
    id: project?.id || '',
    name: project?.name || '',
    workspace: project?.workspace || '',
    workspaceMode: project ? 'existing' : 'managed',
    templateId: project ? projectTemplateId : template?.id || '',
    instruction: project ? projectInstruction(project) : template?.instruction || '',
    expertIds: project ? [...(capabilities.experts || [])] : [...(template?.expertIds || [])],
    skillIds: enabledSkillIds(project ? capabilities.skills || [] : template?.skillIds || [], project?.id || null),
    connectorIds: project
      ? [...(capabilities.connectors || [])].filter((id) => id !== 'goose-runtime')
      : [...(template?.connectorIds || ['local-workspace'])].filter((id) => id !== 'goose-runtime'),
    toolSelections: project ? normalizeToolSelections(capabilities.toolSelections, capabilities.connectors || []) : {},
  };
}

async function openProjectDialog(templateId = '', projectId = '') {
  const project = projectId ? state.projects.find((entry) => entry.id === projectId) : null;
  if (projectId && !project) return;
  if (!project && !projectUI.managedWorkspaceRoot) {
    try {
      projectUI.managedWorkspaceRoot = await window.meteoDesktop.getDefaultProjectWorkspace();
    } catch {
      projectUI.managedWorkspaceRoot = '';
    }
  }
  projectUI.dialog = projectDialogDraft(templateId, project);
  projectUI.capabilityPicker = null;
  projectUI.error = '';
  render();
  document.getElementById('project-name-input')?.focus();
}

function closeProjectDialog() {
  projectUI.dialog = null;
  projectUI.capabilityPicker = null;
  projectUI.error = '';
  render();
}

function selectedProjectDialogValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function readConnectorToolSelection(scope, root = document) {
  const connectorIds = [];
  const toolSelections = {};
  root.querySelectorAll(`[data-tool-selector="${scope}"] [data-tool-service]`).forEach((service) => {
    const connectorId = service.dataset.toolService;
    const serviceCheckbox = service.querySelector('[data-tool-service-checkbox]');
    const toolInputs = [...service.querySelectorAll('[data-tool-name]')];
    const toolNames = toolInputs.filter((input) => input.checked).map((input) => input.dataset.toolName);
    if (!serviceCheckbox?.checked || (toolInputs.length && !toolNames.length)) return;
    connectorIds.push(connectorId);
    if (toolInputs.length) toolSelections[connectorId] = [...new Set(toolNames)];
  });
  return { connectorIds, toolSelections };
}

function bindConnectorToolSelectors(root = document) {
  root.querySelectorAll('[data-tool-selector] [data-tool-service]').forEach((service) => {
    const serviceCheckbox = service.querySelector('[data-tool-service-checkbox]');
    const toolInputs = [...service.querySelectorAll('[data-tool-name]')];
    const toolList = service.querySelector('[data-tool-list]');
    const disclosure = service.querySelector('[data-tool-disclosure]');
    const count = service.querySelector('[data-tool-selection-count]');
    const refresh = () => {
      const selectedCount = toolInputs.filter((input) => input.checked).length;
      if (toolInputs.length) {
        serviceCheckbox.checked = selectedCount > 0;
        serviceCheckbox.indeterminate = selectedCount > 0 && selectedCount < toolInputs.length;
        if (count) count.textContent = `${selectedCount}/${toolInputs.length} 个工具`;
      }
      service.classList.toggle('selected', Boolean(serviceCheckbox.checked));
    };
    serviceCheckbox?.addEventListener('change', () => {
      if (toolInputs.length) toolInputs.forEach((input) => { input.checked = serviceCheckbox.checked; });
      if (serviceCheckbox.checked && toolList) {
        toolList.hidden = false;
        service.classList.add('expanded');
        disclosure?.setAttribute('aria-expanded', 'true');
      }
      refresh();
    });
    toolInputs.forEach((input) => input.addEventListener('change', refresh));
    disclosure?.addEventListener('click', () => {
      const expanded = disclosure.getAttribute('aria-expanded') !== 'true';
      disclosure.setAttribute('aria-expanded', String(expanded));
      service.classList.toggle('expanded', expanded);
      if (toolList) toolList.hidden = !expanded;
    });
    service.querySelector('[data-tool-select-all]')?.addEventListener('click', () => {
      toolInputs.forEach((input) => { input.checked = true; });
      refresh();
    });
    service.querySelector('[data-tool-clear]')?.addEventListener('click', () => {
      toolInputs.forEach((input) => { input.checked = false; });
      refresh();
    });
    refresh();
  });
}

function readProjectDialogDraft() {
  return {
    ...projectUI.dialog,
    name: document.getElementById('project-name-input')?.value.trim() || '',
    instruction: document.getElementById('project-instruction-input')?.value.trim() || '',
    workspaceMode: document.querySelector('input[name="project-workspace-mode"]:checked')?.value
      || projectUI.dialog?.workspaceMode
      || 'managed',
    expertIds: [...(projectUI.dialog?.expertIds || [])],
    skillIds: enabledSkillIds(projectUI.dialog?.skillIds || [], projectUI.dialog?.id || null),
    connectorIds: [...(projectUI.dialog?.connectorIds || [])],
    toolSelections: structuredClone(projectUI.dialog?.toolSelections || {}),
  };
}

function projectCapabilityPickerSelectionText(picker) {
  if (picker.type !== 'connectors') {
    const key = projectCapabilityPickerMeta(picker.type).key;
    return `已选 ${(picker[key] || []).length} 项`;
  }
  const selection = readConnectorToolSelection('project-picker');
  return `${selection.connectorIds.length} 个服务 · ${connectorToolSelectionCount(selection.connectorIds, selection.toolSelections)} 个工具`;
}

async function openProjectCapabilityPicker(type) {
  const meta = projectCapabilityPickerMeta(type);
  if (!meta) return;
  const draft = readProjectDialogDraft();
  const items = projectCapabilityPickerItems(type);
  const selectedIds = draft[meta.key] || [];
  projectUI.dialog = draft;
  projectUI.capabilityPicker = {
    type,
    query: '',
    activeId: selectedIds[0] || items[0]?.id || '',
    expertIds: [...(draft.expertIds || [])],
    skillIds: [...(draft.skillIds || [])],
    connectorIds: [...(draft.connectorIds || [])],
    toolSelections: structuredClone(draft.toolSelections || {}),
    remoteSkills: [],
    loading: type === 'skills',
    installing: false,
    error: '',
  };
  render();
  document.getElementById('project-capability-picker-search')?.focus();
  if (type !== 'skills') return;
  const picker = projectUI.capabilityPicker;
  try {
    const response = await window.meteoDesktop.listSkillHubSkills({ q: '', limit: 200 });
    if (projectUI.capabilityPicker !== picker) return;
    picker.remoteSkills = Array.isArray(response?.items) ? response.items : [];
    picker.loading = false;
    const available = projectCapabilityPickerItems('skills');
    if (!available.some((item) => item.id === picker.activeId)) {
      picker.activeId = picker.skillIds[0] || available[0]?.id || '';
    }
  } catch (error) {
    if (projectUI.capabilityPicker !== picker) return;
    picker.loading = false;
    picker.error = `无法读取 SkillHub：${error?.message || String(error)}`;
  }
  render();
  document.getElementById('project-capability-picker-search')?.focus();
}

function closeProjectCapabilityPicker() {
  const type = projectUI.capabilityPicker?.type;
  projectUI.capabilityPicker = null;
  render();
  document.querySelector(`[data-project-capability-open="${type}"]`)?.focus();
}

async function ensureProjectPickerSkillAvailable(item) {
  const capabilityApi = window.MeteoMateCapabilityCenter;
  const projectId = projectUI.dialog?.id || null;
  const installation = capabilityApi?.skillInstallation?.(item.id, projectId);
  if (installation?.enabled) return;
  if (installation) {
    const enabled = await window.meteoDesktop.setSkillEnabled({ id: installation.id, enabled: true });
    capabilityApi.center.registry = enabled.registry;
    return;
  }
  if (item.bundled) {
    const inspection = await window.meteoDesktop.inspectBundledSkill(item.id);
    const installed = await window.meteoDesktop.installSkill({
      token: inspection.token,
      reportHash: inspection.report.reportHash,
      scope: 'user',
      replace: false,
    });
    capabilityApi.center.registry = installed.registry;
    return;
  }
  const remote = item.remoteSkill;
  const version = remote?.latestVersion || item.latestVersion || item.version;
  if (!remote || !version) throw new Error(`“${item.name}”没有可安装的 SkillHub 版本`);
  const inspection = await window.meteoDesktop.downloadSkillHubSkill({ skillId: item.id, version });
  if (!inspection?.report?.autoInstallEligible) {
    throw new Error(`“${item.name}”需要先在技能中心完成安全检查后安装`);
  }
  const installed = await window.meteoDesktop.installSkill({
    token: inspection.token,
    reportHash: inspection.report.reportHash,
    scope: 'user',
    replace: false,
  });
  capabilityApi.center.registry = installed.registry;
  void window.meteoDesktop.reportSkillHubInstallation({
    localInstallationId: installed.installation.id,
    remoteInstallationId: installed.installation.remote?.skillHubInstallationId,
    skillId: item.id,
    version,
    scope: 'user',
    projectId: null,
  }).catch(() => {});
}

async function applyProjectCapabilityPicker() {
  const picker = projectUI.capabilityPicker;
  if (!picker) return;
  if (picker.type === 'connectors') {
    const selection = readConnectorToolSelection('project-picker');
    projectUI.dialog = {
      ...projectUI.dialog,
      connectorIds: selection.connectorIds,
      toolSelections: selection.toolSelections,
    };
  } else if (picker.type === 'skills') {
    const items = projectCapabilityPickerItems('skills');
    const selected = (picker.skillIds || []).map((id) => items.find((item) => item.id === id)).filter(Boolean);
    picker.installing = true;
    picker.error = '';
    render();
    try {
      for (const item of selected) await ensureProjectPickerSkillAvailable(item);
      projectUI.dialog = { ...projectUI.dialog, skillIds: selected.map((item) => item.id) };
    } catch (error) {
      if (projectUI.capabilityPicker === picker) {
        picker.installing = false;
        picker.error = error?.message || String(error);
        render();
      }
      return;
    }
  } else {
    const key = projectCapabilityPickerMeta(picker.type).key;
    projectUI.dialog = { ...projectUI.dialog, [key]: [...(picker[key] || [])] };
  }
  closeProjectCapabilityPicker();
}

function applyProjectDialogTemplate(templateId) {
  const current = readProjectDialogDraft();
  const template = projectTemplates.find((entry) => entry.id === templateId);
  projectUI.dialog = {
    ...current,
    templateId: template?.id || '',
    instruction: template?.instruction || '',
    expertIds: [...(template?.expertIds || [])],
    skillIds: enabledSkillIds(template?.skillIds || [], current.id || null),
    connectorIds: [...(template?.connectorIds || ['local-workspace'])],
    toolSelections: {},
  };
  projectUI.error = '';
  render();
  document.getElementById('project-name-input')?.focus();
}

async function saveProjectDialog(event) {
  event.preventDefault();
  const draft = readProjectDialogDraft();
  projectUI.dialog = draft;
  if (!draft.name) {
    projectUI.error = '请输入项目名称。';
    render();
    document.getElementById('project-name-input')?.focus();
    return;
  }

  if (draft.id) {
    const index = state.projects.findIndex((project) => project.id === draft.id);
    if (index < 0) return;
    const project = state.projects[index];
    const previousCapabilities = JSON.stringify(project.spec?.capabilities || {});
    state.projects[index] = window.MeteoMateHarness.Project.normalizeProject({
      ...project,
      name: draft.name,
      updatedAt: Date.now(),
      spec: {
        ...project.spec,
        instructions: draft.instruction ? [draft.instruction] : [],
        capabilities: {
          experts: draft.expertIds,
          skills: draft.skillIds,
          connectors: draft.connectorIds,
          toolSelections: draft.toolSelections,
        },
        assets: {
          ...project.spec?.assets,
          templates: draft.templateId ? [draft.templateId] : [],
        },
      },
    });
    const capabilitiesChanged = previousCapabilities !== JSON.stringify(state.projects[index].spec?.capabilities || {});
    if (capabilitiesChanged) {
      state.tasks
        .filter((task) => task.projectId === draft.id
          && window.MeteoMateHarness.CapabilityResolver.capabilityMode(task) === 'inherit')
        .forEach((task) => {
          task.sessionId = null;
          task.sessionCapabilityHash = null;
          task.capabilityLoad = null;
          task.runtimeMode = null;
        });
    }
    projectUI.dialog = null;
    projectUI.error = '';
    saveState();
    render();
    return;
  }

  let workspace = draft.workspace;
  if (draft.workspaceMode === 'managed') {
    try {
      workspace = await window.meteoDesktop.createProjectWorkspace({
        root: projectUI.managedWorkspaceRoot || undefined,
        name: draft.name,
      });
    } catch (error) {
      projectUI.error = error?.message || '无法创建项目工作目录。';
      render();
      return;
    }
  } else if (!workspace) {
    projectUI.error = '请选择要使用的已有目录。';
    render();
    document.getElementById('project-choose-existing')?.focus();
    return;
  }
  const existing = state.projects.find((project) => project.workspace === workspace);
  if (existing) {
    projectUI.error = `这个目录已属于项目“${existing.name}”，请选择其他目录。`;
    render();
    return;
  }

  const now = Date.now();
  const project = window.MeteoMateHarness.Project.normalizeProject({
    id: cryptoRandomId(),
    name: draft.name,
    workspace,
    createdAt: now,
    updatedAt: now,
    instructions: draft.instruction ? [draft.instruction] : [],
    expertIds: draft.expertIds,
    skillIds: draft.skillIds,
    connectorIds: draft.connectorIds,
    toolSelections: draft.toolSelections,
    templateIds: draft.templateId ? [draft.templateId] : [],
  });
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  state.activeTaskId = null;
  state.view = 'project-detail';
  projectUI.tab = 'overview';
  projectUI.dialog = null;
  projectUI.error = '';
  saveState();
  render();
}

function openProjectTask(projectId) {
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!project) return;
  state.activeProjectId = project.id;
  state.selectedExpertId = project.spec?.capabilities?.experts?.[0] || catalog.experts[0].id;
  state.draftSceneId = catalog.scenes.find((scene) => scene.expertId === state.selectedExpertId)?.id || null;
  state.draftTaskMode = catalog.scenes.find((scene) => scene.id === state.draftSceneId)?.group || 'forecast';
  state.draftSkillIds = enabledSkillIds(project.spec?.capabilities?.skills || [], project.id);
  state.draftCapabilityMode = 'inherit';
  state.draftConnectorIds = [...(project.spec?.capabilities?.connectors || [])];
  state.draftToolSelections = normalizeToolSelections(
    project.spec?.capabilities?.toolSelections,
    state.draftConnectorIds
  );
  state.activeTaskId = null;
  state.draftPermissionProfileId = null;
  state.draftProviderId = null;
  state.draftModelId = null;
  state.view = 'task';
  saveState();
  render();
}

function bindProjectDialogEvents() {
  if (!projectUI.dialog) return;
  document.querySelectorAll('[data-project-dialog-close]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (element.classList.contains('project-dialog-backdrop') && event.target !== element) return;
      closeProjectDialog();
    });
  });
  document.querySelectorAll('[data-dialog-template]').forEach((element) => {
    element.addEventListener('click', () => applyProjectDialogTemplate(element.dataset.dialogTemplate));
  });
  document.querySelectorAll('[data-project-capability-open]').forEach((element) => {
    element.addEventListener('click', () => void openProjectCapabilityPicker(element.dataset.projectCapabilityOpen));
  });
  document.querySelectorAll('[data-project-capability-close]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (element.classList.contains('project-capability-picker-backdrop') && event.target !== element) return;
      closeProjectCapabilityPicker();
    });
  });
  document.getElementById('project-capability-picker-apply')?.addEventListener('click', () => void applyProjectCapabilityPicker());
  document.querySelectorAll('[data-project-capability-preview]').forEach((element) => {
    element.addEventListener('click', () => {
      projectUI.capabilityPicker.activeId = element.dataset.projectCapabilityPreview;
      render();
      document.querySelector(`[data-project-capability-preview="${element.dataset.projectCapabilityPreview}"]`)?.focus();
    });
  });
  document.querySelectorAll('input[name="project-picker-items"]').forEach((element) => {
    element.addEventListener('change', () => {
      const picker = projectUI.capabilityPicker;
      if (!picker) return;
      const key = projectCapabilityPickerMeta(picker.type).key;
      picker[key] = selectedProjectDialogValues('project-picker-items');
      element.closest('.project-capability-picker-item')?.classList.toggle('selected', element.checked);
      const count = document.getElementById('project-capability-picker-count');
      if (count) count.textContent = projectCapabilityPickerSelectionText(picker);
    });
  });
  document.querySelectorAll('[data-tool-selector="project-picker"] input').forEach((element) => {
    element.addEventListener('change', () => {
      const count = document.getElementById('project-capability-picker-count');
      if (count && projectUI.capabilityPicker) count.textContent = projectCapabilityPickerSelectionText(projectUI.capabilityPicker);
    });
  });
  document.getElementById('project-capability-picker-search')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    projectUI.capabilityPicker.query = event.target.value;
    const rows = [...document.querySelectorAll('[data-project-capability-picker-surface] [data-capability-search-text]')];
    let visible = 0;
    rows.forEach((row) => {
      const matches = !query || row.dataset.capabilitySearchText.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = document.querySelector('.project-capability-search-empty');
    if (empty) empty.hidden = visible > 0;
  });
  document.querySelectorAll('input[name="project-workspace-mode"]').forEach((element) => {
    element.addEventListener('change', () => {
      projectUI.dialog = readProjectDialogDraft();
      projectUI.error = '';
      render();
      if (element.value === 'existing') document.getElementById('project-choose-existing')?.focus();
    });
  });
  document.getElementById('project-choose-existing')?.addEventListener('click', async () => {
    const draft = readProjectDialogDraft();
    const workspace = await window.meteoDesktop.chooseWorkspace({
      title: '选择已有项目目录',
      defaultPath: draft.workspace || projectUI.managedWorkspaceRoot || undefined,
    });
    if (!workspace) return;
    projectUI.dialog = { ...draft, workspace, workspaceMode: 'existing' };
    projectUI.error = '';
    render();
    document.querySelector('#project-dialog-form button[type="submit"]')?.focus();
  });
  document.getElementById('project-dialog-form')?.addEventListener('submit', saveProjectDialog);

  const dialog = document.querySelector('.project-dialog');
  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (projectUI.capabilityPicker) closeProjectCapabilityPicker();
      else closeProjectDialog();
      return;
    }
    const focusScope = document.querySelector('.project-capability-picker') || dialog;
    if (event.key !== 'Tab' || !focusScope) return;
    const focusable = [...focusScope.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
      .filter((element) => !element.closest('[hidden]') && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  projectDialogCleanup = () => document.removeEventListener('keydown', keyHandler);
}

function syncProjectKnowledgeSources() {
  let changed = false;
  for (let index = 0; index < state.projects.length; index += 1) {
    const project = state.projects[index];
    const sourceIds = knowledgeCatalog.sources
      .filter((source) => (source.projectIds || []).includes(project.id))
      .map((source) => source.id);
    const currentIds = project.spec?.assets?.knowledgeSources || [];
    if (JSON.stringify(currentIds) === JSON.stringify(sourceIds)) continue;
    state.projects[index] = window.MeteoMateHarness.Project.normalizeProject({
      ...project,
      spec: {
        ...project.spec,
        assets: {
          ...project.spec?.assets,
          knowledgeSources: sourceIds,
        },
      },
    });
    changed = true;
  }
  if (changed) saveState();
}

function applyKnowledgeSnapshot(snapshot) {
  knowledgeCatalog.status = 'ready';
  knowledgeCatalog.sources = Array.isArray(snapshot?.sources)
    ? snapshot.sources.slice().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    : [];
  knowledgeCatalog.encryptionAvailable = Boolean(snapshot?.encryptionAvailable);
  knowledgeCatalog.error = '';
  syncProjectKnowledgeSources();
}

async function loadKnowledgeSources(options = {}) {
  if (!window.meteoDesktop.listKnowledgeSources) {
    knowledgeCatalog.status = 'ready';
    return;
  }
  knowledgeCatalog.status = 'loading';
  knowledgeCatalog.error = '';
  if (options.render !== false) render();
  try {
    applyKnowledgeSnapshot(await window.meteoDesktop.listKnowledgeSources());
  } catch (error) {
    knowledgeCatalog.status = 'error';
    knowledgeCatalog.error = error?.message || '无法读取资料源。';
  }
  if (options.render !== false) render();
}

async function importLocalKnowledgeSources(projectId = '', options = {}) {
  knowledgeCatalog.status = 'loading';
  knowledgeCatalog.error = '';
  render();
  try {
    const result = await window.meteoDesktop.importLocalKnowledgeSources({
      projectIds: projectId ? [projectId] : [],
    });
    applyKnowledgeSnapshot(result);
    if (projectId && !options.stayInTask) {
      state.activeProjectId = projectId;
      state.view = 'project-detail';
      projectUI.tab = 'assets';
    }
  } catch (error) {
    knowledgeCatalog.status = 'error';
    knowledgeCatalog.error = error?.message || '添加本地资料失败。';
  }
  render();
}

function knowledgeSourceEditorDraft(source = null, projectId = '') {
  const selectedProjects = new Set(source?.projectIds || []);
  if (projectId) selectedProjects.add(projectId);
  return {
    id: source?.id || '',
    type: source?.type || 'dify',
    name: source?.name || '',
    path: source?.path || '',
    localKind: source?.localKind || 'file',
    apiUrl: source?.apiUrl || '',
    datasetId: source?.datasetId || '',
    credentialSet: Boolean(source?.credentialSet),
    topK: source?.retrieval?.topK || 5,
    scoreThreshold: source?.retrieval?.scoreThreshold ?? 0.25,
    enabled: source?.enabled !== false,
    projectIds: [...selectedProjects],
    testQuery: '未来 24 小时强降水风险',
  };
}

function openKnowledgeSourceEditor(sourceId = '', projectId = '') {
  const source = sourceId ? knowledgeCatalog.sources.find((candidate) => candidate.id === sourceId) : null;
  if (sourceId && !source) return;
  knowledgeUI.returnView = state.view;
  knowledgeUI.returnProjectId = projectId || (state.view === 'project-detail' ? state.activeProjectId : null);
  knowledgeUI.editor = knowledgeSourceEditorDraft(source, projectId);
  knowledgeUI.error = '';
  knowledgeUI.testResult = null;
  state.view = 'more-knowledge';
  saveState();
  render();
  document.getElementById('knowledge-name')?.focus();
}

function closeKnowledgeSourceEditor() {
  const projectId = knowledgeUI.returnProjectId;
  const returnView = knowledgeUI.returnView;
  knowledgeUI.editor = null;
  knowledgeUI.error = '';
  knowledgeUI.testResult = null;
  knowledgeUI.returnProjectId = null;
  knowledgeUI.returnView = 'more-knowledge';
  if (projectId && state.projects.some((project) => project.id === projectId)) {
    state.activeProjectId = projectId;
    state.view = 'project-detail';
    projectUI.tab = 'assets';
  } else {
    state.view = returnView === 'project-detail' ? 'projects' : returnView;
  }
  saveState();
  render();
}

function readKnowledgeSourceDraft() {
  const current = knowledgeUI.editor || knowledgeSourceEditorDraft();
  return {
    ...current,
    name: document.getElementById('knowledge-name')?.value.trim() ?? current.name,
    apiUrl: document.getElementById('knowledge-api-url')?.value.trim() ?? current.apiUrl,
    datasetId: document.getElementById('knowledge-dataset-id')?.value.trim() ?? current.datasetId,
    apiKey: document.getElementById('knowledge-api-key')?.value.trim() || '',
    topK: Number(document.getElementById('knowledge-top-k')?.value || current.topK || 5),
    scoreThreshold: Number(document.getElementById('knowledge-score-threshold')?.value ?? current.scoreThreshold ?? 0.25),
    enabled: document.getElementById('knowledge-enabled')?.checked ?? current.enabled,
    projectIds: selectedProjectDialogValues('knowledge-projects'),
    testQuery: document.getElementById('knowledge-test-query')?.value.trim() || current.testQuery,
  };
}

function validateKnowledgeSourceDraft(draft) {
  if (!draft.name) return '请输入资料源名称。';
  if (draft.type === 'dify' && !draft.apiUrl) return '请输入 Dify Base URL。';
  if (draft.type === 'dify' && !draft.datasetId) return '请输入 Dataset ID。';
  if (draft.type === 'dify' && !draft.apiKey && !draft.credentialSet) return '请输入知识库 API Key。';
  if (draft.topK < 1 || draft.topK > 20) return '返回片段数需要在 1 到 20 之间。';
  if (draft.scoreThreshold < 0 || draft.scoreThreshold > 1) return '相关度阈值需要在 0 到 1 之间。';
  return '';
}

async function saveKnowledgeSourceEditor(event) {
  event.preventDefault();
  const draft = readKnowledgeSourceDraft();
  knowledgeUI.editor = draft;
  knowledgeUI.error = validateKnowledgeSourceDraft(draft);
  if (knowledgeUI.error) {
    render();
    return;
  }
  try {
    const result = await window.meteoDesktop.saveKnowledgeSource(draft);
    applyKnowledgeSnapshot(result);
    closeKnowledgeSourceEditor();
  } catch (error) {
    knowledgeUI.error = error?.message || '资料源保存失败。';
    render();
  }
}

async function testKnowledgeSourceDraft() {
  const draft = readKnowledgeSourceDraft();
  knowledgeUI.editor = draft;
  knowledgeUI.error = validateKnowledgeSourceDraft(draft);
  knowledgeUI.testResult = null;
  if (knowledgeUI.error) {
    render();
    return;
  }
  render();
  try {
    knowledgeUI.testResult = await window.meteoDesktop.testKnowledgeSource({
      ...draft,
      query: draft.testQuery,
    });
  } catch (error) {
    knowledgeUI.testResult = { ok: false, error: error?.message || String(error) };
  }
  render();
}

async function testSavedKnowledgeSource(sourceId) {
  const source = knowledgeCatalog.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return;
  const action = document.querySelector(`[data-knowledge-test="${CSS.escape(sourceId)}"]`);
  if (action) {
    action.disabled = true;
    action.textContent = '测试中…';
  }
  try {
    const result = await window.meteoDesktop.testKnowledgeSource({ id: sourceId });
    source.lastTest = result;
    source.updatedAt = Date.now();
    knowledgeCatalog.error = result.ok ? '' : `${source.name}：${result.error || '连接测试失败'}`;
  } catch (error) {
    knowledgeCatalog.error = error?.message || '连接测试失败。';
  }
  render();
}

async function toggleKnowledgeSource(sourceId, enabled) {
  try {
    applyKnowledgeSnapshot(await window.meteoDesktop.setKnowledgeSourceEnabled({ id: sourceId, enabled }));
  } catch (error) {
    knowledgeCatalog.error = error?.message || '无法更新资料源状态。';
  }
  render();
}

async function deleteKnowledgeSource(sourceId) {
  const source = knowledgeCatalog.sources.find((candidate) => candidate.id === sourceId);
  if (!source || !confirm(`确定移除资料源“${source.name}”吗？本地文件不会被删除。`)) return;
  try {
    applyKnowledgeSnapshot(await window.meteoDesktop.deleteKnowledgeSource(sourceId));
    closeKnowledgeSourceEditor();
  } catch (error) {
    knowledgeUI.error = error?.message || '资料源删除失败。';
    render();
  }
}

function automationEditorDraft(templateId = '', automation = null) {
  const template = automationTemplates.find((item) => item.id === templateId);
  const trigger = automation?.trigger || template?.trigger || {};
  const taskTemplate = automation?.taskTemplate || template || {};
  const project = getActiveProject();
  return {
    id: automation?.id || '',
    templateId: template?.id || '',
    name: automation?.name || template?.name || '',
    projectId: automation?.projectId || project?.id || '',
    prompt: taskTemplate.prompt || '',
    workflowRef: window.MeteoMateHarness.Automation.workflowCapabilityReference(automation),
    expertId: taskTemplate.expertId || project?.spec?.capabilities?.experts?.[0] || catalog.experts[0].id,
    skillIds: enabledSkillIds(taskTemplate.skillIds || [], automation?.projectId || project?.id || null),
    capabilityMode: taskTemplate.capabilityMode === 'pinned' ? 'pinned' : 'inherit',
    connectorIds: [...(taskTemplate.connectorIds || [])].filter((id) => id !== 'goose-runtime'),
    toolSelections: normalizeToolSelections(taskTemplate.toolSelections, taskTemplate.connectorIds || []),
    permissionProfileId:
      taskTemplate.permissionProfileId
      || desktopSettings.preferences.defaultPermissionProfileId
      || 'analysis-readonly',
    providerId: taskTemplate.providerId || '',
    modelId: taskTemplate.modelId || '',
    enabled: automation?.enabled !== false,
    mode: trigger.mode || 'recurring',
    cadence: trigger.cadence || 'daily',
    time: trigger.time || '08:00',
    weekdays: [...(trigger.weekdays || [5])],
    intervalValue: trigger.intervalValue || 3,
    intervalUnit: trigger.intervalUnit || 'hours',
    runAt: trigger.runAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function openAutomationEditor(templateId = '', automationId = '') {
  const automation = automationId ? (state.automations || []).find((item) => item.id === automationId) : null;
  if (automationId && !automation) return;
  automationUI.editor = automationEditorDraft(templateId, automation);
  automationUI.error = '';
  state.view = 'automation';
  render();
  document.getElementById('automation-name')?.focus();
}

function closeAutomationEditor() {
  automationUI.editor = null;
  automationUI.error = '';
  render();
}

function readAutomationEditorDraft() {
  const current = automationUI.editor || automationEditorDraft();
  const tools = readConnectorToolSelection('automation');
  const projectId = document.getElementById('automation-project')?.value ?? current.projectId;
  const capabilityMode = document.getElementById('automation-capability-mode')?.value === 'pinned'
    ? 'pinned'
    : 'inherit';
  const modelValue = document.getElementById('automation-model')?.value || '';
  const [providerId = '', modelId = ''] = modelValue ? modelValue.split('::') : ['', ''];
  return {
    ...current,
    name: document.getElementById('automation-name')?.value.trim() ?? current.name,
    projectId,
    prompt: document.getElementById('automation-prompt')?.value.trim() ?? current.prompt,
    workflowRef: document.getElementById('automation-workflow')?.value ?? current.workflowRef,
    expertId: document.getElementById('automation-expert')?.value ?? current.expertId,
    permissionProfileId: document.getElementById('automation-permission')?.value ?? current.permissionProfileId,
    providerId,
    modelId,
    skillIds: enabledSkillIds(selectedProjectDialogValues('automation-skills'), projectId || null),
    capabilityMode,
    connectorIds: capabilityMode === 'pinned' ? tools.connectorIds : [],
    toolSelections: capabilityMode === 'pinned' ? tools.toolSelections : {},
    cadence: document.getElementById('automation-cadence')?.value ?? current.cadence,
    time: document.getElementById('automation-time')?.value ?? current.time,
    weekdays: document.querySelectorAll('input[name="automation-weekdays"]').length
      ? selectedProjectDialogValues('automation-weekdays').map(Number)
      : current.weekdays,
    intervalValue: Number(document.getElementById('automation-interval-value')?.value || current.intervalValue || 3),
    intervalUnit: document.getElementById('automation-interval-unit')?.value ?? current.intervalUnit,
    runAt: document.getElementById('automation-run-at')?.value ?? current.runAt,
    enabled: document.getElementById('automation-enabled')?.checked ?? current.enabled,
  };
}

function changeAutomationScheduleMode(mode) {
  automationUI.editor = { ...readAutomationEditorDraft(), mode };
  automationUI.error = '';
  render();
}

function showAutomationEditorError(message, fieldId = '') {
  automationUI.error = message;
  automationUI.editor = readAutomationEditorDraft();
  render();
  document.getElementById(fieldId)?.focus();
}

function saveAutomationEditor(event) {
  event.preventDefault();
  const draft = readAutomationEditorDraft();
  automationUI.editor = draft;
  if (!draft.name) return showAutomationEditorError('请输入自动化名称。', 'automation-name');
  if (!draft.projectId || !state.projects.some((project) => project.id === draft.projectId)) {
    return showAutomationEditorError('请选择一个有效项目。', 'automation-project');
  }
  if (!draft.prompt) return showAutomationEditorError('请输入每次运行要执行的任务提示词。', 'automation-prompt');
  if (draft.mode === 'recurring' && draft.cadence === 'weekly' && !draft.weekdays.length) {
    return showAutomationEditorError('每周任务至少选择一个执行日。');
  }
  if (draft.mode === 'once') {
    const runAt = Date.parse(draft.runAt || '');
    if (!Number.isFinite(runAt) || runAt <= Date.now()) {
      return showAutomationEditorError('单次执行时间必须晚于当前时间。', 'automation-run-at');
    }
  }

  const existing = draft.id ? (state.automations || []).find((item) => item.id === draft.id) : null;
  const now = Date.now();
  const [workflowId = '', ...workflowVersionParts] = String(draft.workflowRef || '').split('@');
  const automation = window.MeteoMateHarness.Automation.normalizeAutomation({
    ...existing,
    id: existing?.id || cryptoRandomId(),
    name: draft.name,
    projectId: draft.projectId,
    enabled: draft.enabled,
    workflowRef: workflowId
      ? { id: workflowId, version: workflowVersionParts.join('@') }
      : null,
    inputMapping: existing?.inputMapping || {},
    taskTemplate: {
      prompt: draft.prompt,
      expertId: draft.expertId,
      skillIds: draft.skillIds,
      capabilityMode: draft.capabilityMode,
      connectorIds: draft.connectorIds,
      toolSelections: draft.toolSelections,
      permissionProfileId: draft.permissionProfileId,
      providerId: draft.providerId,
      modelId: draft.modelId,
    },
    trigger: {
      type: 'cron',
      mode: draft.mode,
      cadence: draft.cadence,
      time: draft.time,
      weekdays: draft.weekdays,
      intervalValue: draft.intervalValue,
      intervalUnit: draft.intervalUnit,
      runAt: draft.runAt,
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    nextRunAt: null,
  }, { now, after: now });
  state.automations = state.automations || [];
  const index = state.automations.findIndex((item) => item.id === automation.id);
  if (index >= 0) state.automations[index] = automation;
  else state.automations.unshift(automation);
  automationUI.editor = null;
  automationUI.error = '';
  automationUI.tab = 'schedules';
  saveState();
  render();
}

function toggleAutomation(automationId, enabled) {
  const automation = (state.automations || []).find((item) => item.id === automationId);
  if (!automation) return;
  automation.enabled = enabled;
  automation.updatedAt = Date.now();
  automation.nextRunAt = enabled
    ? window.MeteoMateHarness.Automation.computeNextRunAt(automation, Date.now())
    : null;
  saveState();
  render();
}

function deleteAutomation(automationId) {
  const automation = (state.automations || []).find((item) => item.id === automationId);
  if (!automation || !confirm(`确定删除自动化“${automation.name}”吗？已有运行记录和任务不会删除。`)) return;
  state.automations = state.automations.filter((item) => item.id !== automationId);
  automationUI.editor = null;
  automationUI.error = '';
  saveState();
  render();
}

function automationRunForTask(task) {
  return (state.automationRuns || []).find((run) => run.id === task?.automationRunId)
    || (state.automationRuns || []).find((run) => run.taskId === task?.id && run.status === 'running');
}

function finishAutomationRun(task) {
  const run = automationRunForTask(task);
  if (!run || !['completed', 'failed', 'cancelled'].includes(task.status)) return;
  run.status = task.status;
  run.finishedAt = Date.now();
  run.artifactCount = task.artifacts?.length || 0;
  const automation = (state.automations || []).find((item) => item.id === run.automationId);
  if (automation) {
    automation.lastStatus = task.status;
    automation.updatedAt = Date.now();
  }
}

async function executeAutomationById(automationId, source = 'manual') {
  const automation = (state.automations || []).find((item) => item.id === automationId);
  if (!automation) return false;
  if ((state.automationRuns || []).some((run) => run.automationId === automationId && run.status === 'running')) return false;
  const project = state.projects.find((item) => item.id === automation.projectId);
  if (!project) {
    automation.enabled = false;
    automation.nextRunAt = null;
    automation.lastStatus = 'failed';
    saveState();
    if (state.view === 'automation') render();
    return false;
  }

  const template = automation.taskTemplate || {};
  const expert = getExpert(template.expertId || project.spec?.capabilities?.experts?.[0] || catalog.experts[0].id);
  const permissionProfileId = policyPermissionProfileId(template.permissionProfileId, expert.permissionProfile);
  const permissionProfile = catalog.permissionProfiles[permissionProfileId] || catalog.permissionProfiles['analysis-readonly'];
  const providerId = template.providerId || modelSettings.providerId || '';
  const modelId = template.modelId || modelSettings.modelId || '';
  const prompt = template.prompt;
  const previousProjectId = state.activeProjectId;
  const previousTaskId = state.activeTaskId;
  state.activeProjectId = project.id;
  const task = createTask(expert, prompt, permissionProfile.id, providerId, modelId);
  task.title = automation.name;
  task.titleMode = 'fixed';
  task.projectId = project.id;
  task.workspace = project.workspace;
  task.skillIds = enabledSkillIds(template.skillIds || [], project.id);
  const workflowReference = window.MeteoMateHarness.Automation.workflowCapabilityReference(automation);
  task.workflowIds = workflowReference ? [workflowReference] : [];
  task.workflowId = automation.workflowRef?.id || null;
  task.workflowVersion = automation.workflowRef?.version || null;
  task.capabilityMode = template.capabilityMode === 'pinned' ? 'custom' : 'inherit';
  task.connectorIds = task.capabilityMode === 'custom' ? [...(template.connectorIds || [])] : [];
  task.toolSelections = task.capabilityMode === 'custom'
    ? normalizeToolSelections(template.toolSelections, task.connectorIds)
    : {};
  task.automationId = automation.id;
  task.triggerSource = source;
  task.status = 'running';
  task.pendingPermissions = [];
  task.plan = createDefaultPlan();
  task.contextState = {
    ...(task.contextState || {}),
    phase: 'idle',
    message: '',
  };
  const run = {
    id: cryptoRandomId(),
    automationId: automation.id,
    automationName: automation.name,
    taskId: task.id,
    projectId: project.id,
    source,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    artifactCount: 0,
  };
  task.automationRunId = run.id;
  state.automationRuns = state.automationRuns || [];
  state.automationRuns.unshift(run);
  if (state.automationRuns.length > 120) state.automationRuns.splice(120);
  appendMessage(task, 'user', prompt);
  const response = ensureStreamingAssistant(task);
  response.modelId = modelId;
  markPlan(task, 'prepare', 'running');
  addActivity(task, {
    type: 'info',
    title: source === 'manual' ? '手动启动自动化' : '按计划启动自动化',
    detail: `${automation.name} · ${expert.name}`,
    status: 'running',
  });

  automation.lastRunAt = run.startedAt;
  automation.lastStatus = 'running';
  automation.updatedAt = run.startedAt;
  if (source === 'schedule') {
    if (automation.trigger.mode === 'once') {
      automation.enabled = false;
      automation.nextRunAt = null;
    } else {
      automation.nextRunAt = window.MeteoMateHarness.Automation.computeNextRunAt(automation, run.startedAt);
    }
  }
  state.activeProjectId = previousProjectId || project.id;
  state.activeTaskId = state.view === 'automation' ? previousTaskId : task.id;
  saveState();
  if (state.view === 'automation') render();

  try {
    const result = await runtimeRouter.send(task, {
      taskId: task.id,
      sessionId: null,
      expertName: expert.name,
      expertInstruction: expert.instruction,
      prompt,
      workspace: task.workspace,
      allowFileTools: Boolean(permissionProfile.fileTools),
      permissionProfileId: permissionProfile.id,
      permissionProfileName: permissionProfile.name,
      permissionProfileDescription: permissionProfile.description,
      providerId,
      modelId,
      submittedAt: response.startedAt,
      transcript: [],
      team: teamDefinitionForTask(task, getTaskExpert(task)),
    });
    task.runtimeMode = result.runtime;
    if (result.sessionId) task.sessionId = result.sessionId;
    task.sessionCapabilityHash = result.capabilityHash || task.capabilityResolution?.id || null;
    task.capabilityLoad = result.capabilityLoad || task.capabilityLoad || null;
    task.updatedAt = Date.now();
    saveState();
    return true;
  } catch (error) {
    task.status = 'failed';
    const assistant = ensureStreamingAssistant(task);
    assistant.text += `\n启动失败：${error?.message || error}`;
    addActivity(task, {
      type: 'error',
      title: '自动化启动失败',
      detail: error?.message || String(error),
      status: 'failed',
    });
    finalizeAssistantResponse(task, 'failed');
    finishAutomationRun(task);
    task.updatedAt = Date.now();
    saveState();
    if (state.view === 'automation') render();
    return false;
  }
}

function normalizeAutomationState() {
  state.automations = (state.automations || []).map((automation) =>
    window.MeteoMateHarness.Automation.normalizeAutomation(automation)
  );
  state.automationRuns = (state.automationRuns || []).slice(0, 120).map((run) => {
    if (run.status !== 'running') return run;
    const task = state.tasks.find((item) => item.id === run.taskId);
    return task?.status === 'running' ? run : { ...run, status: 'failed', finishedAt: run.finishedAt || Date.now() };
  });
}

async function tickAutomationScheduler() {
  if (!['authenticated', 'offline'].includes(accountSession.status)) return;
  const now = Date.now();
  const due = (state.automations || [])
    .filter((automation) => window.MeteoMateHarness.Automation.isDue(automation, now))
    .slice(0, 3);
  for (const automation of due) await executeAutomationById(automation.id, 'schedule');
}

function startAutomationScheduler() {
  window.clearInterval(automationSchedulerTimer);
  automationSchedulerTimer = window.setInterval(() => void tickAutomationScheduler(), 30 * 1000);
  void tickAutomationScheduler();
}

async function chooseWorkspaceForTask() {
  const project = await addProject();
  if (!project) return;
  selectTaskProject(project.id);
}

function selectTaskProject(projectId) {
  const project = state.projects.find((entry) => entry.id === projectId) || null;
  const task = getActiveTask();
  if (task?.sessionId || task?.status === 'running') return;
  state.activeProjectId = project?.id || null;
  if (task?.kind !== 'assistant' && task) {
    task.projectId = project?.id || null;
    task.workspace = project?.workspace || '';
    task.capabilityMode = 'inherit';
    task.connectorIds = [];
    task.toolSelections = {};
    task.sessionCapabilityHash = null;
    task.capabilityLoad = null;
    task.fileReferences = [];
    task.updatedAt = Date.now();
  } else if (!task && project) {
    const capabilities = project.spec?.capabilities || {};
    const projectExpertId = capabilities.experts?.[0];
    if (projectExpertId) {
      state.selectedExpertId = projectExpertId;
      const scene = catalog.scenes.find((entry) => entry.expertId === projectExpertId);
      state.draftSceneId = scene?.id || null;
      state.draftTaskMode = scene?.group || state.draftTaskMode || 'forecast';
    }
    state.draftSkillIds = enabledSkillIds(capabilities.skills || [], project.id);
    state.draftCapabilityMode = 'inherit';
    state.draftConnectorIds = [...(capabilities.connectors || [])];
    state.draftToolSelections = normalizeToolSelections(capabilities.toolSelections, state.draftConnectorIds);
    state.draftFileReferences = [];
    state.draftArtifactSelections = [];
  } else if (!task) {
    state.draftCapabilityMode = 'inherit';
    state.draftConnectorIds = [];
    state.draftToolSelections = {};
    state.draftFileReferences = [];
    state.draftArtifactSelections = [];
  }
  saveState();
  render();
}

function revealTeamProcessMember(runId, memberId) {
  const target = [...document.querySelectorAll('[data-team-process-member]')].find(
    (element) => element.dataset.teamRunId === runId && element.dataset.teamProcessMember === memberId
  );
  if (!target) return;
  const process = target.closest('[data-team-run-process]');
  if (process) process.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    block: 'nearest',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

function bindTaskComposerMenus() {
  document.querySelectorAll('[data-team-result-toggle]').forEach((element) => {
    element.addEventListener('click', () => {
      const resultId = element.dataset.teamResultToggle;
      if (teamUI.expandedResultIds.has(resultId)) teamUI.expandedResultIds.delete(resultId);
      else teamUI.expandedResultIds.add(resultId);
      render();
    });
  });
  document.querySelectorAll('[data-team-collapse]').forEach((element) => {
    element.addEventListener('click', () => {
      const expanding = element.getAttribute('aria-expanded') === 'false';
      teamUI.collapsed = !expanding;
      teamUI.expanded = expanding;
      if (!expanding) {
        teamUI.selectedMemberId = null;
      }
      render();
    });
  });
  document.querySelectorAll('[data-team-member-id]').forEach((element) => {
    element.addEventListener('click', () => {
      teamUI.collapsed = false;
      teamUI.selectedMemberId = element.dataset.teamMemberId;
      teamUI.expanded = true;
      const runId = element.dataset.teamRunId;
      const memberId = element.dataset.teamMemberId;
      render();
      window.requestAnimationFrame(() => revealTeamProcessMember(runId, memberId));
    });
  });
  const moreTrigger = document.getElementById('composer-more');
  const morePopover = document.getElementById('composer-more-popover');
  const projectTrigger = document.getElementById('choose-workspace');
  const projectPopover = document.getElementById('composer-project-popover');
  const closeMenus = () => {
    if (morePopover) morePopover.hidden = true;
    if (projectPopover) projectPopover.hidden = true;
    moreTrigger?.setAttribute('aria-expanded', 'false');
    projectTrigger?.setAttribute('aria-expanded', 'false');
  };
  const toggleMenu = (trigger, popover, event) => {
    if (!trigger || !popover) return;
    event.stopPropagation();
    const opening = popover.hidden;
    closeMenus();
    popover.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  };
  moreTrigger?.addEventListener('click', (event) => toggleMenu(moreTrigger, morePopover, event));
  projectTrigger?.addEventListener('click', (event) => toggleMenu(projectTrigger, projectPopover, event));
  document.querySelectorAll('[data-task-expert-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const expert = getExpert(element.dataset.taskExpertId);
      state.selectedExpertId = expert.id;
      const scene = catalog.scenes.find((entry) => entry.expertId === expert.id);
      state.draftSceneId = scene?.id || null;
      state.draftTaskMode = scene?.group || state.draftTaskMode || 'forecast';
      state.draftPermissionProfileId = null;
      saveState();
      render();
      document.getElementById('task-prompt')?.focus();
    });
  });
  document.querySelectorAll('[data-task-project-id]').forEach((element) => {
    element.addEventListener('click', () => selectTaskProject(element.dataset.taskProjectId));
  });
  document.querySelector('[data-task-clear-project]')?.addEventListener('click', () => selectTaskProject(''));
  document.getElementById('create-project-from-folder')?.addEventListener('click', () => void chooseWorkspaceForTask());
  document.querySelector('[data-task-import-knowledge]')?.addEventListener('click', (event) => {
    const projectId = event.currentTarget.dataset.taskImportKnowledge;
    if (projectId) void importLocalKnowledgeSources(projectId, { stayInTask: true });
  });
  const documentClickHandler = (event) => {
    if (!event.target.closest('.composer-more-menu, .composer-project-menu')) closeMenus();
  };
  const documentKeyHandler = (event) => {
    if (event.key === 'Escape') closeMenus();
  };
  document.addEventListener('click', documentClickHandler);
  document.addEventListener('keydown', documentKeyHandler);
  taskComposerMenuCleanup = () => {
    document.removeEventListener('click', documentClickHandler);
    document.removeEventListener('keydown', documentKeyHandler);
  };
}

function compactTaskTitle(value, limit = 34) {
  const normalized = String(value || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^["'“‘《]+|["'”’》]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(normalized);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : normalized;
}

function automaticTaskTitle(prompt) {
  const title = compactTaskTitle(prompt);
  const chineseCharacterCount = (title.match(/[\u3400-\u9fff]/g) || []).length;
  return chineseCharacterCount >= 2 ? title : '新任务';
}

function normalizeAutomaticSessionTitle(value) {
  const title = compactTaskTitle(value);
  const chineseCharacterCount = (title.match(/[\u3400-\u9fff]/g) || []).length;
  return chineseCharacterCount >= 2 ? title : '';
}

function applyAutomaticSessionTitle(task, value) {
  if (!task || task.titleMode === 'manual' || task.titleMode === 'fixed' || task.messages.length > 2) {
    return false;
  }
  const title = normalizeAutomaticSessionTitle(value);
  if (!title) return false;
  task.title = title;
  task.titleMode = 'automatic';
  return true;
}

function createTask(expert, prompt, permissionProfileId, providerId, modelId) {
  const assistantTask = expert.id === primaryAssistant.id;
  const project = assistantTask ? getAssistantProject() : getActiveProject();
  const now = Date.now();
  const frozenExpert = expertSnapshot(expert);
  const permissionProfile =
    catalog.permissionProfiles[permissionProfileId] || catalog.permissionProfiles['analysis-readonly'];
  const task = {
    id: cryptoRandomId(),
    kind: assistantTask ? 'assistant' : 'task',
    title: assistantTask ? primaryAssistant.name : automaticTaskTitle(prompt),
    titleMode: assistantTask ? 'fixed' : 'automatic',
    expertId: expert.id,
    expertName: expert.name,
    expertSnapshot: frozenExpert,
    teamDefinition: frozenExpert.kind === 'team' ? teamDefinitionForExpert(frozenExpert) : null,
    teamRun: null,
    teamRuns: [],
    sceneId: assistantTask ? null : state.draftSceneId || null,
    projectId: project?.id || null,
    workspace: project?.workspace || state.assistantWorkspace || '',
    runtimePreference: 'auto',
    runtimeMode: null,
    sessionId: null,
    permissionProfileId: permissionProfile.id,
    allowFileTools: Boolean(permissionProfile.fileTools),
    workMode: 'execute',
    providerId,
    modelId,
    status: 'draft',
    messages: [],
    plan: createDefaultPlan(),
    activities: [],
    artifacts: [],
    pendingPermissions: [],
    fileReferences: [...(state.draftFileReferences || [])],
    artifactSelections: [...(state.draftArtifactSelections || [])],
    draftPrompt: '',
    usage: null,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.unshift(task);
  state.activeTaskId = task.id;
  if (assistantTask) {
    state.assistantTaskId = task.id;
  }
  return task;
}

function appendMessage(task, role, text, status = 'completed') {
  const now = Date.now();
  const message = {
    id: cryptoRandomId(),
    role,
    text,
    status,
    createdAt: now,
    ...(role === 'assistant'
      ? {
          startedAt: now,
          completedAt: null,
          durationMs: null,
          runStatus: 'running',
          responsePhase: 'preparing',
          responsePhaseChangedAt: now,
          modelRequestedAt: null,
          firstModelResponseAt: null,
          processPlan: createDefaultPlan(),
          usage: null,
          modelId: task.modelId || '',
        }
      : {}),
  };
  task.messages.push(message);
  return message;
}

function currentStreamingAssistant(task) {
  for (let index = task.messages.length - 1; index >= 0; index -= 1) {
    const message = task.messages[index];
    if (message.role === 'assistant' && message.status === 'streaming') return message;
    if (message.role === 'user') break;
  }
  return null;
}

function latestAssistantMessage(task) {
  for (let index = task.messages.length - 1; index >= 0; index -= 1) {
    if (task.messages[index].role === 'assistant') return task.messages[index];
  }
  return null;
}

function ensureStreamingAssistant(task) {
  const assistant = currentStreamingAssistant(task) || appendMessage(task, 'assistant', '', 'streaming');
  if (!assistant.startedAt) assistant.startedAt = assistant.createdAt || Date.now();
  if (!assistant.responsePhase) assistant.responsePhase = assistant.text ? 'responding' : 'preparing';
  if (!assistant.responsePhaseChangedAt) assistant.responsePhaseChangedAt = assistant.startedAt;
  if (!Array.isArray(assistant.processPlan)) assistant.processPlan = createDefaultPlan();
  return assistant;
}

function advanceAssistantResponsePhase(task, responsePhase) {
  const assistant = currentStreamingAssistant(task);
  if (!assistant) return null;
  const phaseOrder = { preparing: 0, waiting_model: 1, analyzing: 2, responding: 2 };
  const currentOrder = phaseOrder[assistant.responsePhase] ?? 0;
  const nextOrder = phaseOrder[responsePhase] ?? currentOrder;
  if (nextOrder < currentOrder) return assistant;
  if (assistant.responsePhase !== responsePhase) {
    assistant.responsePhase = responsePhase;
    assistant.responsePhaseChangedAt = Date.now();
  }
  if (responsePhase === 'waiting_model' && !assistant.modelRequestedAt) {
    assistant.modelRequestedAt = assistant.responsePhaseChangedAt;
  }
  if (['analyzing', 'responding'].includes(responsePhase) && !assistant.firstModelResponseAt) {
    assistant.firstModelResponseAt = assistant.responsePhaseChangedAt;
  }
  return assistant;
}

function clearRuntimeStreamCommit(taskId) {
  const timer = runtimeStreamCommitTimers.get(taskId);
  if (!timer) return;
  window.clearTimeout(timer);
  runtimeStreamCommitTimers.delete(taskId);
}

function scheduleRuntimeStreamCommit(task) {
  if (runtimeStreamCommitTimers.has(task.id)) return;
  const timer = window.setTimeout(() => {
    runtimeStreamCommitTimers.delete(task.id);
    commitRuntimeStreamNow(task);
  }, RUNTIME_STREAM_COMMIT_INTERVAL_MS);
  runtimeStreamCommitTimers.set(task.id, timer);
}

function clearRuntimeProgressCommit(taskId) {
  const timer = runtimeProgressCommitTimers.get(taskId);
  if (!timer) return;
  window.clearTimeout(timer);
  runtimeProgressCommitTimers.delete(taskId);
}

function scheduleRuntimeProgressCommit(task) {
  if (runtimeProgressCommitTimers.has(task.id)) return;
  const timer = window.setTimeout(() => {
    runtimeProgressCommitTimers.delete(task.id);
    commitRuntimeStreamNow(task);
  }, RUNTIME_PROGRESS_COMMIT_INTERVAL_MS);
  runtimeProgressCommitTimers.set(task.id, timer);
}

function runtimeEventCommitMode(eventType) {
  if (['assistant_message_delta', 'thought_delta', 'team_member_progress'].includes(eventType)) return 'stream';
  if (['runtime_progress', 'artifact_created', 'evidence_created'].includes(eventType)) return 'progress';
  return 'immediate';
}

function completeRunningThought(task) {
  const activity = task.activities.at(-1);
  if (activity?.type === 'thought' && activity.status === 'running') {
    activity.status = 'completed';
    activity.updatedAt = Date.now();
  }
}

function finalizeAssistantResponse(task, runStatus = 'completed') {
  const assistant = currentStreamingAssistant(task);
  if (!assistant) return null;
  const completedAt = Date.now();
  assistant.status = 'completed';
  assistant.runStatus = runStatus;
  assistant.responsePhase = 'completed';
  assistant.responsePhaseChangedAt = completedAt;
  assistant.completedAt = completedAt;
  assistant.durationMs = Math.max(0, completedAt - (assistant.startedAt || assistant.createdAt || completedAt));
  return assistant;
}

function markPlan(task, id, status) {
  const item = task.plan.find((candidate) => candidate.id === id);
  if (item) item.status = status;
  const assistant = currentStreamingAssistant(task);
  const responseItem = assistant?.processPlan?.find((candidate) => candidate.id === id);
  if (responseItem) responseItem.status = status;
}

function addActivity(task, activity) {
  const assistant = currentStreamingAssistant(task);
  task.activities.push({
    id: activity.id || cryptoRandomId(),
    type: activity.type || 'info',
    title: activity.title || '运行活动',
    detail: activity.detail || '',
    status: activity.status || 'running',
    connectorId: activity.connectorId || null,
    toolName: activity.toolName || null,
    rawInput: activity.rawInput ?? null,
    rawOutput: activity.rawOutput ?? null,
    responseId: activity.responseId || assistant?.id || null,
    createdAt: activity.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  if (task.activities.length > 80) task.activities.splice(0, task.activities.length - 80);
}

function updateActivity(task, id, patch) {
  const activity = task.activities.find((candidate) => candidate.id === id);
  if (activity) Object.assign(activity, patch, { updatedAt: Date.now() });
  else addActivity(task, { id, ...patch });
}

function permissionActionSucceeded(action) {
  return action === 'allow_once' || action === 'always_allow';
}

function transcriptForRuntime(task) {
  return task.messages
    .filter((message) => message.text && message.status !== 'streaming')
    .slice(-12)
    .map((message) => ({ role: message.role, text: message.text }));
}

function waitForPendingResponsePaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

function scrollConversationToBottom() {
  window.requestAnimationFrame(() => {
    const scroll = document.querySelector('.conversation-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
}

function flushQueuedTaskPrompts(taskId) {
  // 仅在任务仍处于当前视图时自动续发，避免后台任务抢占用户正在进行的其他任务
  const activeTask = getActiveTask();
  if (!activeTask || activeTask.id !== taskId || activeTask.status !== 'completed') return;
  if (composerImeComposing) {
    pendingQueuedPromptTaskIds.add(taskId);
    return;
  }
  const queued = Array.isArray(activeTask.queuedPrompts) ? activeTask.queuedPrompts : [];
  const next = queued[0];
  if (!next) return;
  activeTask.queuedPrompts = queued.slice(1);
  activeTask.fileReferences = [...(next.fileReferences || [])];
  activeTask.artifactSelections = [...(next.artifactSelections || [])];
  delete activeTask.queuedDraftFileReferences;
  delete activeTask.queuedDraftArtifactSelections;
  saveState();
  void sendTaskMessage({ prompt: next.text, dequeue: true });
}

async function sendTaskMessage(options = {}) {
  const textarea = document.getElementById('task-prompt');
  const prompt = String(options.prompt ?? textarea?.value ?? '').trim();
  if (!prompt) {
    textarea?.focus();
    textarea?.classList.add('field-error');
    return;
  }

  const existing = getActiveTask();

  // 任务运行中：消息进入排队，当前回复完成后自动发送；
  // dequeue 途中的消息若撞上新一轮运行（竞态），回到队首等待
  if (existing && existing.status === 'running') {
    const item = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: prompt,
      fileReferences: [...(existing.queuedDraftFileReferences || [])],
      artifactSelections: [...(existing.queuedDraftArtifactSelections || [])],
      createdAt: Date.now(),
    };
    const queued = Array.isArray(existing.queuedPrompts) ? existing.queuedPrompts : [];
    existing.queuedPrompts = options.dequeue ? [item, ...queued] : [...queued, item];
    if (!options.dequeue) {
      existing.queuedDraftFileReferences = [];
      existing.queuedDraftArtifactSelections = [];
      state.draftFileReferences = [];
      state.draftArtifactSelections = [];
      if (textarea) textarea.value = '';
      existing.draftPrompt = '';
      state.draftPrompt = '';
    }
    existing.updatedAt = Date.now();
    saveState();
    render();
    return;
  }

  const expert = existing ? getTaskExpert(existing) : getSelectedExpert();
  const requestedPermissionProfileId =
    document.getElementById('composer-permission')?.dataset.permissionProfileId ||
    existing?.permissionProfileId ||
    expert.permissionProfile ||
    'analysis-readonly';
  const permissionProfileId = policyPermissionProfileId(requestedPermissionProfileId, expert.permissionProfile);
  const permissionProfile =
    catalog.permissionProfiles[permissionProfileId] || catalog.permissionProfiles['analysis-readonly'];
  const allowFileTools = Boolean(permissionProfile.fileTools);
  const composerModel = document.getElementById('composer-model');
  const modelSelection = parseModelSelectionValue(composerModel?.value);
  const providerId = modelSelection?.providerId || existing?.providerId || modelSettings.providerId || '';
  const modelId = modelSelection?.modelId ?? existing?.modelId ?? modelSettings.modelId ?? '';
  const task =
    existing || createTask(expert, prompt, permissionProfileId, providerId, modelId);
  const teamDefinition = teamDefinitionForTask(task, getTaskExpert(task));
  const previousTranscript = transcriptForRuntime(task);
  if (Array.isArray(task.queuedDraftFileReferences)) {
    task.fileReferences = [...task.queuedDraftFileReferences];
  }
  if (Array.isArray(task.queuedDraftArtifactSelections)) {
    task.artifactSelections = [...task.queuedDraftArtifactSelections];
  }
  const submittedFileReferences = [...(task.fileReferences || [])];
  const submittedArtifactSelections = [...(task.artifactSelections || [])];
  task.queuedDraftFileReferences = [];
  task.queuedDraftArtifactSelections = [];

  task.permissionProfileId = permissionProfile.id;
  task.allowFileTools = allowFileTools;
  task.workMode = 'execute';
  task.providerId = providerId;
  task.modelId = modelId;
  task.workspace = getConversationProject(task)?.workspace || task.workspace || state.assistantWorkspace || '';
  task.status = 'running';
  task.updatedAt = Date.now();
  task.pendingPermissions = [];
  task.plan = createDefaultPlan();

  const userMessage = appendMessage(task, 'user', prompt);
  userMessage.artifactSelections = submittedArtifactSelections;
  const response = ensureStreamingAssistant(task);
  response.modelId = modelId || '';
  response.responsePhase = 'preparing';
  response.responsePhaseChangedAt = Date.now();
  response.modelRequestedAt = null;
  response.firstModelResponseAt = null;
  markPlan(task, 'prepare', 'running');
  if (task.sessionId) {
    markPlan(task, 'prepare', 'completed');
    markPlan(task, 'analyze', 'running');
  }
  addActivity(task, {
    type: 'info',
    title: task.sessionId ? '继续现有会话' : '准备新任务',
    detail: task.sessionId ? `恢复 Goose Session ${task.sessionId}` : `专家：${expert.name}`,
    status: 'running',
  });

  if (textarea) textarea.value = '';
  task.draftPrompt = '';
  task.artifactSelections = [];
  state.draftPrompt = '';
  state.draftFileReferences = [];
  state.draftArtifactSelections = [];
  render();
  scrollConversationToBottom();
  await waitForPendingResponsePaint();
  saveState();

  try {
    const result = await runtimeRouter.send(task, {
      taskId: task.id,
      sessionId: task.sessionId,
      expertName: expert.name,
      expertInstruction: expert.instruction,
      prompt,
      workspace: task.workspace,
      allowFileTools,
      permissionProfileId: permissionProfile.id,
      permissionProfileName: permissionProfile.name,
      permissionProfileDescription: permissionProfile.description,
      providerId,
      modelId,
      submittedAt: response.startedAt,
      fileReferences: submittedFileReferences,
      artifactSelections: submittedArtifactSelections,
      transcript: previousTranscript,
      team: teamDefinition,
    });
    if (typeof result.workspace === 'string' && result.workspace.trim()) {
      task.workspace = result.workspace.trim();
    }
    task.runtimeMode = result.runtime;
    if (result.sessionId) task.sessionId = result.sessionId;
    task.sessionCapabilityHash = result.capabilityHash || task.capabilityResolution?.id || null;
    task.capabilityLoad = result.capabilityLoad || task.capabilityLoad || null;
    task.updatedAt = Date.now();
    commitRuntimeStreamNow(task);
  } catch (error) {
    task.status = 'failed';
    const assistant = ensureStreamingAssistant(task);
    assistant.text += `\n启动失败：${error?.message || error}`;
    addActivity(task, {
      type: 'error',
      title: '任务启动失败',
      detail: error?.message || String(error),
      status: 'failed',
    });
    task.updatedAt = Date.now();
    finalizeAssistantResponse(task, 'failed');
    commitRuntimeStreamNow(task);
  }
}

async function cancelTask() {
  const task = state.view === 'assistants' ? getAssistantTask() : getActiveTask();
  if (!task) return;
  await runtimeRouter.cancel(task);
}

async function copyMessageText(button) {
  const task = getActiveTask();
  const message = task?.messages.find((entry) => entry.id === button.dataset.messageCopy);
  if (!message?.text) return;
  try {
    if (window.meteoDesktop?.writeClipboardText) {
      await window.meteoDesktop.writeClipboardText(message.text);
    } else {
      await navigator.clipboard.writeText(message.text);
    }
    button.classList.add('copied');
    button.dataset.tooltip = '已复制';
    button.setAttribute('aria-label', '已复制');
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove('copied');
      button.dataset.tooltip = '复制';
      button.setAttribute('aria-label', `复制${message.role === 'user' ? '问题' : '答案'}`);
    }, 1400);
  } catch {
    button.dataset.tooltip = '复制失败';
    button.setAttribute('aria-label', '复制失败');
  }
}

async function resendEditedMessage(messageId, text) {
  const task = getActiveTask();
  const prompt = String(text || '').trim();
  const messageIndex = task?.messages.findIndex((message) => message.id === messageId) ?? -1;
  const editor = document.getElementById(`message-edit-${messageId}`);
  if (!task || task.status === 'running' || messageIndex < 0) return;
  if (!prompt) {
    editor?.focus();
    editor?.classList.add('field-error');
    return;
  }

  const removedMessages = task.messages.slice(messageIndex);
  const removedAssistantIds = new Set(
    removedMessages.filter((message) => message.role === 'assistant').map((message) => message.id)
  );
  const removedArtifactIds = new Set(
    removedMessages.flatMap((message) => Array.isArray(message.artifactIds) ? message.artifactIds : [])
  );
  const removedEvidenceIds = new Set(
    removedMessages.flatMap((message) => Array.isArray(message.evidenceIds) ? message.evidenceIds : [])
  );
  const remainingArtifactIds = new Set(
    task.messages.slice(0, messageIndex)
      .flatMap((message) => Array.isArray(message.artifactIds) ? message.artifactIds : [])
  );
  const remainingEvidenceIds = new Set(
    task.messages.slice(0, messageIndex)
      .flatMap((message) => Array.isArray(message.evidenceIds) ? message.evidenceIds : [])
  );
  task.messages = task.messages.slice(0, messageIndex);
  task.activities = (task.activities || []).filter(
    (activity) => !activity.responseId || !removedAssistantIds.has(activity.responseId)
  );
  task.artifacts = (task.artifacts || []).filter(
    (artifact) => !(
      (removedArtifactIds.has(artifact.id) && !remainingArtifactIds.has(artifact.id))
      || (
        removedAssistantIds.has(artifact.metadata?.responseId)
        && !remainingArtifactIds.has(artifact.id)
      )
    )
  );
  if (Array.isArray(task.evidence)) {
    task.evidence = task.evidence.filter(
      (entry) => !(
        (removedEvidenceIds.has(entry.id) && !remainingEvidenceIds.has(entry.id))
        || (
          removedAssistantIds.has(entry.metadata?.responseId)
          && !remainingEvidenceIds.has(entry.id)
        )
      )
    );
  }
  task.artifactIds = [...new Set(task.artifacts.map((artifact) => artifact.id).filter(Boolean))];
  task.evidenceIds = [...new Set((task.evidence || []).map((entry) => entry.id).filter(Boolean))];
  task.pendingPermissions = [];
  task.teamRuns = (Array.isArray(task.teamRuns) ? task.teamRuns : []).filter(
    (run) => !run?.responseId || !removedAssistantIds.has(run.responseId)
  );
  task.teamRun = task.teamRuns.at(-1) || null;
  task.sessionId = null;
  task.runtimeMode = null;
  task.sessionCapabilityHash = null;
  task.capabilityLoad = null;
  task.contextSnapshot = null;
  task.contextState = { phase: 'idle', message: '' };
  task.usage = null;
  task.status = 'completed';
  task.updatedAt = Date.now();
  if (!task.messages.some((message) => message.role === 'user')) {
    task.title = task.kind === 'assistant' ? primaryAssistant.name : automaticTaskTitle(prompt);
    task.titleMode = task.kind === 'assistant' ? 'fixed' : 'automatic';
  }
  messageUI.editingTaskId = null;
  messageUI.editingMessageId = null;
  await sendTaskMessage({ prompt });
}

async function resolvePermission(permissionId, action) {
  const task = getActiveTask();
  if (!task) return;
  try {
    const resolved = await runtimeRouter.resolvePermission(task, permissionId, action);
    if (!resolved) throw new Error('审批请求已失效，请重新发起任务');
  } catch (error) {
    addActivity(task, {
      id: `permission-error-${permissionId}`,
      type: 'error',
      title: '审批操作失败',
      detail: error?.message || String(error),
      status: 'failed',
    });
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

function normalizedArtifactTarget(value) {
  return String(value || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '');
}

function trustedArtifactRecord(artifact) {
  const source = String(artifact?.metadata?.source || '');
  const contentHash = String(artifact?.contentHash || '').replace(/^sha256:/i, '');
  return Boolean(
    (artifact?.path || artifact?.uri)
    && /^[a-f0-9]{64}$/i.test(contentHash)
    && !['legacy-assistant-text', 'legacy-artifact-reconciliation'].includes(source)
  );
}

function deliverableArtifactRecord(artifact) {
  return trustedArtifactRecord(artifact)
    && ['validated', 'ready', 'published'].includes(artifact.status);
}

function completionArtifactMatches(record, declared) {
  const target = normalizedArtifactTarget(declared?.uri);
  if (!target) return false;
  return [record.path, record.uri, record.metadata?.relativePath]
    .map(normalizedArtifactTarget)
    .filter(Boolean)
    .includes(target);
}

function verifiedCompletionArtifacts(task, declaredArtifacts, assistant) {
  const responseArtifactIds = new Set(assistant?.artifactIds || []);
  return (Array.isArray(declaredArtifacts) ? declaredArtifacts : []).map((declared) =>
    (task.artifacts || []).find((record) =>
      responseArtifactIds.has(record.id)
      && deliverableArtifactRecord(record)
      && completionArtifactMatches(record, declared)
    ) || null
  );
}

function pruneUnverifiedArtifactRecords(task) {
  const rejectedIds = new Set(
    (task.artifacts || []).filter((artifact) => !trustedArtifactRecord(artifact)).map((artifact) => artifact.id)
  );
  if (!rejectedIds.size) return false;
  task.artifacts = (task.artifacts || []).filter((artifact) => !rejectedIds.has(artifact.id));
  task.artifactIds = (task.artifactIds || []).filter((id) => !rejectedIds.has(id));
  for (const message of task.messages || []) {
    message.artifactIds = (message.artifactIds || []).filter((id) => !rejectedIds.has(id));
  }
  return true;
}

function linkRuntimeRecordToResponse(task, event, kind) {
  const payload = event[kind] || event.record || event.payload;
  if (!payload) return null;
  const records = kind === 'artifact' ? task.artifacts || [] : task.evidence || [];
  const record = records.find((item) =>
    item.id === payload.id
    || (kind === 'artifact' && payload.path && item.path === payload.path)
    || (payload.recordHash && item.recordHash === payload.recordHash)
  );
  if (!record) return null;
  const responseId = event.responseId || null;
  const assistant = (task.messages || []).find((message) => message.id === responseId)
    || currentStreamingAssistant(task)
    || latestAssistantMessage(task);
  if (assistant) {
    const key = kind === 'artifact' ? 'artifactIds' : 'evidenceIds';
    assistant[key] = [...new Set([...(assistant[key] || []), record.id])];
  }
  return record;
}

function completionText(envelope) {
  const sections = [String(envelope?.answer || envelope?.summary || '').trim()];
  if (envelope?.status !== 'completed' && envelope?.blockers?.length) {
    sections.push(`未完成原因：${envelope.blockers.join('；')}`);
  }
  if (envelope?.status !== 'completed' && envelope?.nextActions?.length) {
    sections.push(`建议下一步：${envelope.nextActions.join('；')}`);
  }
  return sections.filter(Boolean).join('\n\n');
}

function runtimeCompletion(task, event, assistant) {
  const contract = task.contextSnapshot?.completionContract;
  if (event.runtime !== 'acp' || !contract?.required) {
    return { required: false, valid: true, status: 'completed', envelope: null };
  }
  const completion = window.MeteoMateHarness.ContextCompiler.evaluateCompletion(contract, assistant.text);
  if (!completion.valid || completion.status !== 'completed' || !contract.requiresArtifact) {
    return completion;
  }
  const declared = completion.envelope?.artifacts || [];
  const verified = verifiedCompletionArtifacts(task, declared, assistant);
  if (declared.length && verified.length === declared.length && verified.every(Boolean)) {
    return { ...completion, verifiedArtifactIds: verified.map((artifact) => artifact.id) };
  }
  return {
    ...completion,
    valid: false,
    status: 'partial',
    reason: '完成结果声明了文件，但本轮没有与之匹配的已校验成果物事件和内容摘要',
    artifactVerificationFailed: true,
  };
}

function settleResponseActivities(task, assistant, completed) {
  task.activities.forEach((activity) => {
    if (
      activity.responseId !== assistant.id
      || !['running', 'waiting', 'pending', 'in_progress'].includes(activity.status)
    ) return;
    if (completed || (activity.type === 'tool' && activity.rawOutput !== null)) {
      activity.status = 'completed';
    } else {
      activity.status = 'interrupted';
    }
    activity.updatedAt = Date.now();
  });
}

function retryIncompleteCompletion(task, assistant, completion) {
  if (completion.valid || Number(assistant.completionRetryCount || 0) >= 1 || !task.sessionId) return false;
  const expert = getTaskExpert(task) || primaryAssistant;
  const permissionProfile = catalog.permissionProfiles[task.permissionProfileId]
    || catalog.permissionProfiles['analysis-readonly'];
  assistant.completionRetryCount = Number(assistant.completionRetryCount || 0) + 1;
  task.status = 'running';
  addActivity(task, {
    type: 'info',
    title: '继续完成任务',
    detail: `${completion.reason || '尚未形成结构化完成结果'}；MeteoMate 正在沿用当前会话补全证据和最终答复。`,
    status: 'running',
  });
  const prompt = [
    '继续执行当前用户任务。不要重复已经成功的工具调用。',
    '先检查本轮已有工具结果；如果证据不足，只补做缺少的步骤。',
    '完成后必须按 MeteoMate 结构化完成协议输出最终结果；若确实无法完成，明确给出 blocker 和下一步。',
  ].join('\n');
  void runtimeRouter.send(task, {
    taskId: task.id,
    sessionId: task.sessionId,
    expertName: expert.name,
    expertInstruction: expert.instruction,
    prompt,
    workspace: task.workspace,
    allowFileTools: Boolean(permissionProfile.fileTools),
    permissionProfileId: permissionProfile.id,
    permissionProfileName: permissionProfile.name,
    permissionProfileDescription: permissionProfile.description,
    providerId: task.providerId || '',
    modelId: task.modelId || '',
    submittedAt: Date.now(),
    fileReferences: [...(task.fileReferences || [])],
    transcript: transcriptForRuntime(task),
  }).then((result) => {
    task.runtimeMode = result.runtime;
    if (result.sessionId) task.sessionId = result.sessionId;
    task.sessionCapabilityHash = result.capabilityHash || task.capabilityResolution?.id || null;
    task.capabilityLoad = result.capabilityLoad || task.capabilityLoad || null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }).catch((error) => {
    handleRuntimeEvent({
      type: 'turn_failed',
      taskId: task.id,
      sessionId: task.sessionId,
      runtime: task.runtimeMode || 'acp',
      message: error?.message || String(error),
    });
  });
  return true;
}

function rememberTeamRun(task, run) {
  if (!run) return null;
  const history = Array.isArray(task.teamRuns) ? task.teamRuns : [];
  const existingIndex = history.findIndex((candidate) => candidate?.id === run.id);
  if (existingIndex >= 0) history[existingIndex] = run;
  else history.push(run);
  const limit = window.MeteoMateHarness.ExpertTeam.RUN_HISTORY_LIMIT || 20;
  task.teamRuns = history.slice(-limit);
  return run;
}

function teamRunForEvent(task, event = {}) {
  const runId = event.runId || event.teamRun?.id || null;
  const history = Array.isArray(task.teamRuns) ? task.teamRuns : [];
  if (runId) {
    const historicalRun = history.find((run) => run?.id === runId);
    if (historicalRun) return historicalRun;
    if (task.teamRun?.id === runId) return task.teamRun;
    return null;
  }
  return task.teamRun || history.at(-1) || null;
}

function recordTeamRunTimeline(run, entry) {
  if (!run) return null;
  return window.MeteoMateHarness.ExpertTeam.appendTimelineEntry(run, entry);
}

function safeTeamActivity(activity = {}) {
  const now = Date.now();
  return {
    id: activity.id || cryptoRandomId(),
    title: String(activity.title || activity.toolName || '工具执行'),
    toolName: activity.toolName || null,
    extensionName: activity.extensionName || null,
    status: activity.status || 'running',
    createdAt: Number(activity.createdAt || activity.at) || now,
    updatedAt: Number(activity.updatedAt || activity.at) || now,
  };
}

function appendTeamMemberUpdate(member, entry, limit = 16) {
  if (!member || typeof member !== 'object') return null;
  entry = entry || {};
  const source = String(entry.source || 'status');
  const text = String(entry.text || entry.detail || entry.title || '').trim();
  if (!text) return null;
  const at = Number(entry.at || entry.updatedAt || entry.createdAt) || Date.now();
  const updates = Array.isArray(member.updates)
    ? member.updates.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }))
    : [];
  const id = String(entry.id || `${source}:${at}:${updates.length + 1}`);
  const normalized = {
    id,
    source,
    text,
    toolName: entry.toolName || null,
    status: entry.status || (source === 'message' ? 'streaming' : 'running'),
    createdAt: Number(entry.createdAt) || at,
    updatedAt: at,
  };
  const existingIndex = updates.findIndex((item) => item.id === id);
  if (existingIndex >= 0) {
    updates[existingIndex] = {
      ...updates[existingIndex],
      ...normalized,
      createdAt: updates[existingIndex].createdAt || normalized.createdAt,
    };
  } else {
    const last = updates.at(-1);
    if (source === 'status' && last?.source === 'status' && last.text === text) {
      updates[updates.length - 1] = {
        ...last,
        status: normalized.status,
        updatedAt: at,
      };
    } else {
      if (last?.source === 'message' && last.status === 'streaming') {
        last.status = 'completed';
        last.updatedAt = at;
      }
      updates.push(normalized);
    }
  }
  member.updates = updates.slice(-Math.max(1, Number(limit) || 16));
  return member.updates.find((item) => item.id === id) || member.updates.at(-1) || null;
}

function teamMemberProgressDisplay(event) {
  event = event || {};
  return {
    id: event.progressId || null,
    source: event.source || 'status',
    text: String(event.detail || '').trim(),
  };
}

function finalizeTeamMemberUpdates(member, status = 'completed', at = Date.now()) {
  if (!member) return [];
  const updatedAt = Number(at) || Date.now();
  const terminalStatus = ['completed', 'failed', 'blocked', 'cancelled', 'interrupted'].includes(status)
    ? status
    : 'interrupted';
  const activeStatuses = new Set(['streaming', 'running', 'pending', 'in_progress']);
  member.updates = (Array.isArray(member.updates) ? member.updates : []).map((entry) => (
    entry && activeStatuses.has(entry.status)
      ? { ...entry, status: terminalStatus, updatedAt }
      : entry
  ));
  member.activities = (Array.isArray(member.activities) ? member.activities : []).map((activity) => (
    activity && activeStatuses.has(activity.status)
      ? { ...activity, status: terminalStatus, updatedAt }
      : activity
  ));
  return member.updates;
}

function collapseTerminalTeamUI(task) {
  if (!task || task.id !== state.activeTaskId) return;
  teamUI.collapsed = true;
  teamUI.expanded = false;
  teamUI.selectedMemberId = null;
}

function ensureTeamRunMember(task, event) {
  let run = teamRunForEvent(task, event);
  if (!run && event.runId && task.teamRun && task.teamRun.id !== event.runId) return null;
  if (!run) {
    const team = teamDefinitionForTask(task, getTaskExpert(task));
    if (team) {
      const assistant = ensureStreamingAssistant(task);
      run = window.MeteoMateHarness.ExpertTeam.createRunState(team, {
        id: event.runId,
        responseId: assistant.id,
      });
      task.teamRun = run;
      assistant.teamRunId = run.id;
      rememberTeamRun(task, run);
    }
  }
  if (!run) return null;
  const memberId = event.teamMemberId || event.member?.id;
  let member = run.members.find((candidate) => candidate.id === memberId);
  if (!member && event.member) {
    member = {
      ...structuredClone(event.member),
      status: 'pending',
      sessionId: null,
      activatedAt: null,
      startedAt: null,
      completedAt: null,
      summary: '',
      detail: '',
      detailSource: '',
      detailUpdatedAt: null,
      error: '',
      activities: [],
      updates: [],
    };
    run.members.push(member);
  }
  rememberTeamRun(task, run);
  return member || null;
}

function updateTeamRunMember(task, event, patch) {
  const member = ensureTeamRunMember(task, event);
  if (!member) return null;
  Object.assign(member, patch, {
    sessionId: event.memberSessionId || event.sessionId || patch.sessionId || member.sessionId || null,
  });
  return member;
}

function teamMemberAcceptsLiveUpdate(member) {
  return !member || ['pending', 'running'].includes(member.status);
}

function settleTeamRunMembers(run, completedAt = Date.now()) {
  if (!run || !Array.isArray(run.members)) return [];
  const settled = [];
  run.members.forEach((member) => {
    if (member.status !== 'running') return;
    if (member.summary) {
      member.status = 'completed';
      member.detail = '';
      member.detailSource = 'completed';
    } else if (member.error) {
      member.status = 'failed';
      member.detail = '';
      member.detailSource = 'error';
    } else {
      member.status = 'interrupted';
      member.error = '负责人已结束本轮协作，但成员会话未返回终态。';
      member.detail = '';
      member.detailSource = 'error';
    }
    member.detailUpdatedAt = completedAt;
    member.completedAt = member.completedAt || completedAt;
    finalizeTeamMemberUpdates(member, member.status, completedAt);
    settled.push(member);
  });
  return settled;
}

function runtimeOutputFailureMessage(task, failure) {
  const run = task?.teamRun;
  const completed = run?.members?.filter((member) => member.status === 'completed').length || 0;
  if (run) {
    return `负责人汇总时遇到工具调用格式错误。已保留 ${completed} 位专家的完成结果，请重试本轮汇总。`;
  }
  return failure?.message || '模型生成的工具调用格式无法解析，请重试。';
}

function interruptActiveTeamMembers(task, status, detail = '', event = {}) {
  const run = teamRunForEvent(task, event);
  if (!run) return;
  run.members.forEach((member) => {
    if (['pending', 'running'].includes(member.status)) {
      member.status = status;
      member.completedAt = Date.now();
      if (detail) member.error = detail;
      finalizeTeamMemberUpdates(member, status, member.completedAt);
    }
  });
  rememberTeamRun(task, run);
}

function handleRuntimeEvent(event) {
  if (event.type === 'runtime_status') {
    state.runtime = { ...state.runtime, ...event.status };
    runtimeRouter.updateStatus(state.runtime);
    render();
    return;
  }

  const task = state.tasks.find((candidate) => candidate.id === event.taskId);
  if (!task) return;

  if (event.sessionId && !event.teamMemberId) task.sessionId = event.sessionId;
  if (event.runtime) task.runtimeMode = event.runtime;

  switch (event.type) {
    case 'team_started':
      {
        const assistant = ensureStreamingAssistant(task);
        const run = structuredClone(event.teamRun);
        run.responseId = assistant.id;
        run.status = 'running';
        run.phase = 'dispatching';
        run.timeline = Array.isArray(run.timeline) ? run.timeline : [];
        run.members = (run.members || []).map((member) => ({
          ...member,
          activatedAt: member.activatedAt || member.startedAt || null,
          activities: Array.isArray(member.activities) ? member.activities : [],
          updates: Array.isArray(member.updates) ? member.updates : [],
        }));
        task.teamRun = run;
        assistant.teamRunId = run.id;
        advanceAssistantResponsePhase(task, 'analyzing');
        rememberTeamRun(task, run);
        recordTeamRunTimeline(run, {
          key: `run:${run.id}:dispatch`,
          type: 'dispatch',
          actor: '交付负责人',
          title: '专家团已就位',
          detail: `已按依赖关系分派 ${run.members.length} 位专家，完成后由负责人统一交付。`,
          status: 'completed',
          at: run.startedAt,
        });
        teamUI.selectedMemberId = null;
      }
      addActivity(task, {
        id: `team-run-${task.teamRun?.id}`,
        type: 'info',
        title: '专家团已就位',
        detail: `${task.teamRun.members.length} 位专家将按依赖关系协作，最后由负责人统一交付。`,
        status: 'running',
      });
      break;

    case 'team_member_started':
      {
        const existingMember = ensureTeamRunMember(task, event);
        if (!teamMemberAcceptsLiveUpdate(existingMember)) break;
        const startedAt = existingMember?.startedAt || event.startedAt || Date.now();
        const member = updateTeamRunMember(task, event, {
          status: 'running',
          activatedAt: existingMember?.activatedAt || startedAt,
          startedAt,
        });
        const run = teamRunForEvent(task, event);
        if (run) {
          run.phase = 'executing';
          recordTeamRunTimeline(run, {
            key: `member:${member?.id}:started`,
            type: 'member',
            memberId: member?.id,
            actor: member?.name || event.teamMemberName || '专家成员',
            title: '开始执行专业任务',
            detail: member?.objective || '',
            status: 'running',
            at: event.startedAt,
          });
          rememberTeamRun(task, run);
        }
        if (!teamUI.selectedMemberId && member) teamUI.selectedMemberId = member.id;
        advanceAssistantResponsePhase(task, 'analyzing');
      }
      break;

    case 'team_member_progress':
      {
        const updatedAt = event.at || Date.now();
        const existingMember = ensureTeamRunMember(task, event);
        if (!teamMemberAcceptsLiveUpdate(existingMember)) break;
        const display = teamMemberProgressDisplay(event);
        const member = updateTeamRunMember(task, event, {
          status: 'running',
          detail: display.text,
          detailSource: display.source,
          detailUpdatedAt: updatedAt,
        });
        appendTeamMemberUpdate(member, {
          id: display.id,
          source: display.source,
          text: display.text,
          status: 'streaming',
          at: updatedAt,
        });
        const run = teamRunForEvent(task, event);
        recordTeamRunTimeline(run, {
          key: `member:${member?.id}:progress`,
          type: 'progress',
          memberId: member?.id,
          actor: member?.name || event.teamMemberName || '专家成员',
          title: display.source === 'status' ? '正在分析任务' : '形成阶段结果',
          detail: display.text,
          status: 'running',
          at: updatedAt,
        });
      }
      break;

    case 'team_member_activity': {
      const updatedAt = Date.now();
      const existingMember = ensureTeamRunMember(task, event);
      if (!teamMemberAcceptsLiveUpdate(existingMember)) break;
      const member = updateTeamRunMember(task, event, {
        status: 'running',
        detail: event.activity?.title || '',
        detailSource: 'activity',
        detailUpdatedAt: updatedAt,
      });
      if (member && event.activity) {
        const activities = Array.isArray(member.activities) ? member.activities : [];
        const activity = safeTeamActivity(event.activity);
        const index = activities.findIndex((candidate) => candidate.id === activity.id);
        if (index >= 0) activities[index] = { ...activities[index], ...activity };
        else activities.push(activity);
        member.activities = activities.slice(-6);
        appendTeamMemberUpdate(member, {
          id: `activity:${activity.id}`,
          source: 'activity',
          text: activity.title,
          toolName: activity.toolName,
          status: activity.status,
          createdAt: activity.createdAt,
          at: activity.updatedAt,
        });
        const run = teamRunForEvent(task, event);
        recordTeamRunTimeline(run, {
          key: `member:${member.id}:activity:${activity.id}`,
          type: 'activity',
          memberId: member.id,
          actor: member.name || event.teamMemberName || '专家成员',
          title: activity.title,
          detail: activity.toolName ? `调用 ${activity.toolName}` : '执行已授权的工具操作',
          status: activity.status,
        });
      }
      break;
    }

    case 'team_member_usage':
      updateTeamRunMember(task, event, { usage: event.usage || null });
      break;

    case 'team_member_completed':
      {
        const member = updateTeamRunMember(task, event, {
          status: 'completed',
          summary: event.summary || '',
          detail: '',
          detailSource: 'completed',
          detailUpdatedAt: event.completedAt || Date.now(),
          completedAt: event.completedAt || Date.now(),
        });
        finalizeTeamMemberUpdates(member, 'completed', event.completedAt || Date.now());
        recordTeamRunTimeline(teamRunForEvent(task, event), {
          key: `member:${member?.id}:result`,
          type: 'handoff',
          memberId: member?.id,
          actor: member?.name || event.teamMemberName || '专家成员',
          title: '已提交交接结果',
          detail: event.summary || '',
          status: 'completed',
          at: event.completedAt,
        });
      }
      break;

    case 'team_member_failed':
    case 'team_member_cancelled':
    case 'team_member_blocked': {
      const status = event.type.replace('team_member_', '');
      const member = updateTeamRunMember(task, event, {
        status,
        error: event.message || '',
        detail: '',
        detailSource: 'error',
        detailUpdatedAt: event.completedAt || Date.now(),
        completedAt: event.completedAt || Date.now(),
      });
      finalizeTeamMemberUpdates(member, status, event.completedAt || Date.now());
      recordTeamRunTimeline(teamRunForEvent(task, event), {
        key: `member:${member?.id}:result`,
        type: 'error',
        memberId: member?.id,
        actor: member?.name || event.teamMemberName || '专家成员',
        title: status === 'blocked' ? '任务受上游阻塞' : status === 'cancelled' ? '任务已停止' : '执行失败',
        detail: event.message || '',
        status,
        at: event.completedAt,
      });
      break;
    }

    case 'team_synthesis_started':
      {
        const run = teamRunForEvent(task, event);
        if (run) {
          const startedAt = event.startedAt || Date.now();
          run.status = 'running';
          run.phase = 'synthesizing';
          run.synthesis = {
            status: 'analyzing',
            text: '',
            startedAt,
            updatedAt: startedAt,
            completedAt: null,
          };
          recordTeamRunTimeline(run, {
            key: `run:${run.id}:synthesis`,
            type: 'synthesis',
            actor: '交付负责人',
            title: '开始汇总成员交接结果',
            detail: `正在整合 ${run.members.filter((member) => member.status === 'completed').length} 位专家的可用结论。`,
            status: 'running',
            at: event.startedAt,
          });
          rememberTeamRun(task, run);
        }
        advanceAssistantResponsePhase(task, 'analyzing');
      }
      break;

    case 'team_completed':
      {
        const run = teamRunForEvent(task, event);
        if (run) {
          const reconciled = settleTeamRunMembers(run, event.completedAt || Date.now());
          const actualCompletedCount = run.members.filter((member) => member.status === 'completed').length;
          const actualFailedCount = run.members.filter((member) =>
            ['failed', 'blocked', 'cancelled', 'interrupted'].includes(member.status)
          ).length;
          const reconciliationFailed = reconciled.some((member) => member.status !== 'completed')
            || actualFailedCount > 0;
          const reportedStatus = event.status || 'completed';
          run.status = reconciliationFailed && reportedStatus === 'completed'
            ? 'partial'
            : reportedStatus;
          run.phase = 'completed';
          run.completedAt = event.completedAt || Date.now();
          run.completedCount = actualCompletedCount;
          run.failedCount = actualFailedCount;
          window.MeteoMateHarness.ExpertTeam.settleSynthesis(run, 'completed', run.completedAt);
          recordTeamRunTimeline(run, {
            key: `run:${run.id}:completed`,
            type: 'completion',
            actor: '交付负责人',
            title: actualFailedCount ? '已汇总可用结果' : '专家团协作完成',
            detail: actualFailedCount
              ? `${actualCompletedCount} 位成员完成，${actualFailedCount} 位失败或受阻。`
              : `${actualCompletedCount || run.members.length} 位成员已完成交接。`,
            status: run.status,
            at: event.completedAt,
          });
          rememberTeamRun(task, run);
        }
      }
      {
        const completedCount = task.teamRun?.completedCount ?? event.completedCount ?? 0;
        const failedCount = task.teamRun?.failedCount ?? event.failedCount ?? 0;
        updateActivity(task, `team-run-${event.runId || task.teamRun?.id}`, {
          status: task.teamRun?.status === 'partial' ? 'interrupted' : 'completed',
          detail: failedCount
            ? `${completedCount} 位成员完成，${failedCount} 位失败或受阻；负责人已交付可用部分。`
            : `${completedCount || task.teamRun?.members.length || 0} 位成员已完成，负责人已汇总交付。`,
        });
      }
      collapseTerminalTeamUI(task);
      break;

    case 'team_failed':
      {
        const run = teamRunForEvent(task, event);
        if (run) {
          run.status = 'failed';
          run.phase = 'failed';
          run.error = event.message || '';
          run.completedAt = event.completedAt || Date.now();
          window.MeteoMateHarness.ExpertTeam.settleSynthesis(run, 'failed', run.completedAt);
          recordTeamRunTimeline(run, {
            key: `run:${run.id}:failed`,
            type: 'error',
            actor: '交付负责人',
            title: '专家团执行失败',
            detail: event.message || '',
            status: 'failed',
            at: event.completedAt,
          });
          rememberTeamRun(task, run);
        }
      }
      interruptActiveTeamMembers(task, 'interrupted', event.message || '', event);
      updateActivity(task, `team-run-${event.runId || task.teamRun?.id}`, {
        status: 'failed',
        detail: event.message || '专家团执行失败。',
      });
      collapseTerminalTeamUI(task);
      break;

    case 'team_cancelled':
      {
        const run = teamRunForEvent(task, event);
        if (run) {
          run.status = 'cancelled';
          run.phase = 'cancelled';
          run.completedAt = event.completedAt || Date.now();
          window.MeteoMateHarness.ExpertTeam.settleSynthesis(run, 'cancelled', run.completedAt);
          recordTeamRunTimeline(run, {
            key: `run:${run.id}:cancelled`,
            type: 'completion',
            actor: '交付负责人',
            title: '专家团任务已停止',
            detail: '保留停止前已经完成的成员结果。',
            status: 'cancelled',
            at: event.completedAt,
          });
          rememberTeamRun(task, run);
        }
      }
      interruptActiveTeamMembers(task, 'cancelled', '', event);
      updateActivity(task, `team-run-${event.runId || task.teamRun?.id}`, {
        status: 'failed',
        detail: '专家团任务已停止。',
      });
      collapseTerminalTeamUI(task);
      break;

    case 'runtime_progress': {
      const assistant = ensureStreamingAssistant(task);
      assistant.runtimeProgress = {
        ...(assistant.runtimeProgress || {}),
        stage: event.stage || assistant.runtimeProgress?.stage || 'preparing_context',
        at: event.at || Date.now(),
        startedAt: event.startedAt || assistant.runtimeProgress?.startedAt || assistant.startedAt,
        requestedAt: event.requestedAt || assistant.runtimeProgress?.requestedAt || null,
        firstEventAt: event.firstEventAt || assistant.runtimeProgress?.firstEventAt || null,
        preparationMs: event.preparationMs ?? assistant.runtimeProgress?.preparationMs ?? null,
        modelTtftMs: event.modelTtftMs ?? assistant.runtimeProgress?.modelTtftMs ?? null,
        connectorCount: event.connectorCount ?? assistant.runtimeProgress?.connectorCount ?? 0,
        toolCount: event.toolCount ?? assistant.runtimeProgress?.toolCount ?? 0,
        modelId: event.modelId || assistant.runtimeProgress?.modelId || assistant.modelId || '',
      };
      if (event.stage === 'model_requested') {
        advanceAssistantResponsePhase(task, 'waiting_model');
        assistant.modelRequestedAt = event.requestedAt || event.at || Date.now();
      }
      break;
    }

    case 'session_started':
      addActivity(task, {
        type: 'info',
        title: '会话已建立',
        detail: `Session ${event.sessionId}`,
        status: 'completed',
      });
      break;

    case 'session_capabilities': {
      if (event.teamMemberId) {
        updateTeamRunMember(task, event, { capabilityLoad: event.capabilityLoad || null });
        break;
      }
      task.capabilityLoad = event.capabilityLoad || null;
      const loaded = event.capabilityLoad?.status === 'loaded';
      if (loaded && event.capabilityLoad.capabilityHash) {
        task.sessionCapabilityHash = event.capabilityLoad.capabilityHash;
      }
      const connectorSummary = (event.capabilityLoad?.connectors || [])
        .filter((item) => item.type === 'mcp')
        .map((item) => `${item.id}${item.availableTools ? `（${item.availableTools.length} 个工具）` : ''}`)
        .join('、');
      updateActivity(task, `capability-load-${event.sessionId}`, {
        type: loaded ? 'info' : 'error',
        title: loaded ? '工具能力已加载' : '工具能力加载失败',
        detail: loaded
          ? connectorSummary || '本轮未配置外部 MCP 工具'
          : event.capabilityLoad?.error || '工具会话校验失败',
        status: loaded ? 'completed' : 'failed',
      });
      break;
    }

    case 'turn_started': {
      task.status = 'running';
      const assistant = ensureStreamingAssistant(task);
      assistant.modelRequestedAt = event.requestedAt || assistant.modelRequestedAt || Date.now();
      assistant.runtimeProgress = {
        ...(assistant.runtimeProgress || {}),
        stage: 'model_requested',
        at: event.requestedAt || Date.now(),
        requestedAt: event.requestedAt || Date.now(),
        preparationMs: event.preparationMs ?? assistant.runtimeProgress?.preparationMs ?? null,
        connectorCount: event.connectorCount ?? assistant.runtimeProgress?.connectorCount ?? 0,
        toolCount: event.toolCount ?? assistant.runtimeProgress?.toolCount ?? 0,
        modelId: event.modelId || assistant.runtimeProgress?.modelId || assistant.modelId || '',
      };
      advanceAssistantResponsePhase(task, 'waiting_model');
      markPlan(task, 'prepare', 'completed');
      markPlan(task, 'analyze', 'running');
      updateActivity(task, task.activities.at(-1)?.id, { status: 'completed' });
      break;
    }

    case 'assistant_message_delta': {
      const streamingAssistant = currentStreamingAssistant(task)
        || (task.status === 'running' ? ensureStreamingAssistant(task) : null);
      const assistant = streamingAssistant || latestAssistantMessage(task);
      if (!assistant) break;
      if (streamingAssistant && event.text) {
        completeRunningThought(task);
        advanceAssistantResponsePhase(task, 'responding');
        const activeTeamRun = task.teamRun?.responseId === streamingAssistant.id
          && task.teamRun?.phase === 'synthesizing'
          ? task.teamRun
          : null;
        if (activeTeamRun) {
          activeTeamRun.synthesis = {
            ...(activeTeamRun.synthesis || {}),
            status: 'drafting',
            updatedAt: Date.now(),
          };
          rememberTeamRun(task, activeTeamRun);
        }
      }
      if (assistant.runtimeOutputFailure) break;
      assistant.text += event.text || '';
      const runtimeFailure = window.MeteoMateHarness.ExpertTeam.runtimeOutputFailure(assistant.text);
      if (runtimeFailure) {
        assistant.runtimeOutputFailure = runtimeFailure;
        assistant.text = runtimeOutputFailureMessage(task, runtimeFailure);
      }
      if (streamingAssistant) assistant.status = 'streaming';
      break;
    }

    case 'user_message_delta':
      break;

    case 'thought_delta': {
      const teamAssistant = currentStreamingAssistant(task);
      const activeTeamRun = task.teamRun?.responseId === teamAssistant?.id ? task.teamRun : null;
      if (activeTeamRun) {
        advanceAssistantResponsePhase(task, 'analyzing');
        if (activeTeamRun.phase === 'synthesizing') {
          window.MeteoMateHarness.ExpertTeam.appendSynthesisProgress(
            activeTeamRun,
            event.text || '',
            {
              at: Date.now(),
            }
          );
          recordTeamRunTimeline(activeTeamRun, {
            key: `run:${activeTeamRun.id}:synthesis-progress`,
            type: 'synthesis',
            actor: '交付负责人',
            title: '正在校验成员结论',
            detail: '正在对齐证据、分歧和待确认项。',
            status: 'running',
          });
          rememberTeamRun(task, activeTeamRun);
        }
        break;
      }
      if (event.text) advanceAssistantResponsePhase(task, 'analyzing');
      const last = task.activities.at(-1);
      if (last?.type === 'thought' && last.status === 'running') {
        last.detail += event.text || '';
        last.updatedAt = Date.now();
      } else {
        addActivity(task, {
          type: 'thought',
          title: '分析进展',
          detail: event.text || '',
          status: 'running',
        });
      }
      break;
    }

    case 'tool_call_started':
      if (!advanceAssistantResponsePhase(task, 'responding')) break;
      completeRunningThought(task);
      markPlan(task, 'analyze', 'running');
      addActivity(task, {
        id: event.toolCallId || cryptoRandomId(),
        type: 'tool',
        title: event.toolName || event.title || '调用工具',
        detail: [event.extensionName, event.rawInput ? JSON.stringify(event.rawInput) : event.kind || '']
          .filter(Boolean)
          .join(' · '),
        connectorId: event.extensionName || null,
        toolName: event.toolName || event.title || null,
        rawInput: event.rawInput ?? null,
        status: event.status || 'running',
      });
      break;

    case 'tool_call_updated':
      advanceAssistantResponsePhase(task, 'responding');
      {
        const eventStatus = event.status || 'running';
        const existingActivity = task.activities.find((activity) => activity.id === event.toolCallId);
        const status = task.status === 'completed'
          && ['running', 'pending', 'in_progress'].includes(eventStatus)
          ? 'completed'
          : eventStatus;
        updateActivity(task, event.toolCallId || cryptoRandomId(), {
          type: 'tool',
          title: event.toolName || event.title || existingActivity?.title || '工具执行',
          detail: event.rawOutput
            ? JSON.stringify(event.rawOutput)
            : event.content
              ? JSON.stringify(event.content)
              : '',
          connectorId: event.extensionName || existingActivity?.connectorId || null,
          toolName: event.toolName || existingActivity?.toolName || null,
          rawOutput: event.rawOutput ?? event.content ?? null,
          status,
        });
      }
      break;

    case 'artifact_created':
      linkRuntimeRecordToResponse(task, event, 'artifact');
      break;

    case 'evidence_created':
      linkRuntimeRecordToResponse(task, event, 'evidence');
      break;

    case 'permission_requested':
      if (!event.teamMemberId && !advanceAssistantResponsePhase(task, 'responding')) break;
      task.pendingPermissions.push({
        id: event.permissionId,
        toolCall: event.toolCall,
        options: event.options,
        allowAlways: event.allowAlways !== false,
        teamMemberId: event.teamMemberId || null,
        teamMemberName: event.teamMemberName || null,
        createdAt: Date.now(),
      });
      addActivity(task, {
        id: `permission-${event.permissionId}`,
        type: 'permission',
        title: event.teamMemberName ? `${event.teamMemberName}等待审批` : '等待用户审批',
        detail: event.toolCall?.title || event.toolCall?.name || '高风险工具操作',
        status: 'waiting',
      });
      break;

    case 'permission_resolved':
      task.pendingPermissions = task.pendingPermissions.filter(
        (permission) => permission.id !== event.permissionId
      );
      updateActivity(task, `permission-${event.permissionId}`, {
        status: permissionActionSucceeded(event.action) ? 'completed' : 'failed',
        detail: `审批结果：${event.action}`,
      });
      break;

    case 'security_notice':
      addActivity(task, {
        type: 'warning',
        title: '已启用安全模式',
        detail: '为保护本地文件，当前任务已关闭文件工具。',
        status: 'completed',
      });
      break;

    case 'runtime_log':
      addActivity(task, {
        type: event.level === 'error' ? 'error' : 'info',
        title: event.level === 'error' ? 'Runtime 日志' : '运行日志',
        detail: event.text || '',
        status: event.level === 'error' ? 'failed' : 'completed',
      });
      break;

    case 'session_info':
      applyAutomaticSessionTitle(task, event.title);
      break;

    case 'usage_update':
      task.usage = window.MeteoMateHarness.ContextWindow.mergeUsage(task.usage, event.usage);
      {
        const assistant = currentStreamingAssistant(task) || latestAssistantMessage(task);
        if (assistant) assistant.usage = task.usage;
      }
      break;

    case 'context_compaction': {
      const now = Date.now();
      const previous = task.contextState || {};
      task.contextState = {
        ...previous,
        phase: event.phase || 'compacting',
        message: event.message || '',
        startedAt: event.phase === 'compacting' ? previous.startedAt || now : previous.startedAt || null,
        lastCompactedAt: event.phase === 'compacted' ? now : previous.lastCompactedAt || null,
        compactionCount:
          event.phase === 'compacted' && previous.phase !== 'compacted'
            ? Number(previous.compactionCount || 0) + 1
            : Number(previous.compactionCount || 0),
      };
      break;
    }

    case 'turn_completed': {
      const assistant = currentStreamingAssistant(task);
      if (!assistant) break;
      const completedAt = Date.now();
      const reconciled = settleTeamRunMembers(task.teamRun, completedAt);
      if (reconciled.some((member) => member.status !== 'completed') && task.teamRun?.status === 'completed') {
        task.teamRun.status = 'partial';
      }
      const runtimeFailure = assistant.runtimeOutputFailure
        || window.MeteoMateHarness.ExpertTeam.runtimeOutputFailure(assistant.text);
      if (runtimeFailure) {
        task.status = 'failed';
        assistant.runtimeOutputFailure = runtimeFailure;
        assistant.text = runtimeOutputFailureMessage(task, runtimeFailure);
        if (task.teamRun) {
          task.teamRun.status = 'failed';
          task.teamRun.phase = 'failed';
          task.teamRun.error = runtimeFailure.message;
          task.teamRun.completedAt = completedAt;
          window.MeteoMateHarness.ExpertTeam.settleSynthesis(task.teamRun, 'failed', completedAt);
          recordTeamRunTimeline(task.teamRun, {
            key: `run:${task.teamRun.id}:runtime-output-failure`,
            type: 'error',
            actor: '交付负责人',
            title: '汇总输出格式错误',
            detail: runtimeFailure.message,
            status: 'failed',
            at: completedAt,
          });
          rememberTeamRun(task, task.teamRun);
        }
        addActivity(task, {
          type: 'error',
          title: '汇总输出格式错误',
          detail: runtimeFailure.message,
          status: 'failed',
        });
        settleResponseActivities(task, assistant, false);
        markPlan(task, 'analyze', 'completed');
        markPlan(task, 'deliver', 'failed');
        finalizeAssistantResponse(task, 'failed');
        break;
      }
      const completion = runtimeCompletion(task, event, assistant);
      const completed = !completion.required || (completion.valid && completion.status === 'completed');
      const failed = completion.required && completion.valid && completion.status === 'failed';
      if (!completed && !failed && retryIncompleteCompletion(task, assistant, completion)) break;
      task.status = completed ? 'completed' : failed ? 'failed' : 'interrupted';
      if (completion.envelope) {
        assistant.completion = completion.envelope;
        assistant.text = completion.artifactVerificationFailed && !completed
          ? `请求的文件未生成成功。${completion.reason}。MeteoMate 未登记可打开成果物，也不会猜测或补全文件路径。`
          : completionText(completion.envelope)
            || completion.envelope.summary
            || '任务尚未形成可显示的最终结果。';
      } else if (!assistant.text.trim()) {
        assistant.text = completed
          ? '任务已完成，但没有返回可显示的文本。'
          : '任务尚未形成可验证的最终结果，可以继续执行。';
      }
      if (completion.required && (!completion.valid || !completed)) {
        addActivity(task, {
          type: failed ? 'error' : 'warning',
          title: failed ? '任务执行失败' : '任务尚未完整交付',
          detail: completion.reason || completion.envelope?.summary || '运行已停止，但完成条件尚未满足。',
          status: failed ? 'failed' : 'interrupted',
        });
      }
      settleResponseActivities(task, assistant, completed);
      markPlan(task, 'analyze', 'completed');
      markPlan(task, 'deliver', completed ? 'completed' : failed ? 'failed' : 'interrupted');
      finalizeAssistantResponse(task, completed ? 'completed' : failed ? 'failed' : 'interrupted');
      break;
    }

    case 'turn_cancelled': {
      task.status = 'cancelled';
      if (task.teamRun && !['completed', 'failed', 'cancelled'].includes(task.teamRun.status)) {
        task.teamRun.status = 'cancelled';
        task.teamRun.phase = 'cancelled';
        task.teamRun.completedAt = Date.now();
        window.MeteoMateHarness.ExpertTeam.settleSynthesis(
          task.teamRun,
          'cancelled',
          task.teamRun.completedAt
        );
        recordTeamRunTimeline(task.teamRun, {
          key: `run:${task.teamRun.id}:cancelled`,
          type: 'completion',
          actor: '交付负责人',
          title: '专家团任务已停止',
          detail: '保留停止前已经完成的成员结果。',
          status: 'cancelled',
        });
        rememberTeamRun(task, task.teamRun);
        interruptActiveTeamMembers(task, 'cancelled', '', { runId: task.teamRun.id });
      }
      const assistant = currentStreamingAssistant(task);
      if (assistant) {
        if (!assistant.text.trim()) assistant.text = '任务已由用户停止。';
        assistant.processPlan?.forEach((item) => {
          if (item.status === 'running') item.status = 'failed';
        });
      }
      task.pendingPermissions = [];
      task.activities.forEach((activity) => {
        if (
          activity.responseId === assistant?.id &&
          ['running', 'waiting', 'pending', 'in_progress'].includes(activity.status)
        ) {
          activity.status = 'failed';
        }
      });
      finalizeAssistantResponse(task, 'cancelled');
      break;
    }

    case 'turn_failed': {
      const assistant = currentStreamingAssistant(task);
      if (!assistant) break;
      task.status = 'failed';
      if (task.teamRun && !['completed', 'failed', 'cancelled'].includes(task.teamRun.status)) {
        task.teamRun.status = 'failed';
        task.teamRun.phase = 'failed';
        task.teamRun.error = event.message || '';
        task.teamRun.completedAt = Date.now();
        window.MeteoMateHarness.ExpertTeam.settleSynthesis(
          task.teamRun,
          'failed',
          task.teamRun.completedAt
        );
        recordTeamRunTimeline(task.teamRun, {
          key: `run:${task.teamRun.id}:failed`,
          type: 'error',
          actor: '交付负责人',
          title: '专家团执行失败',
          detail: event.message || '',
          status: 'failed',
        });
        rememberTeamRun(task, task.teamRun);
        interruptActiveTeamMembers(task, 'interrupted', event.message || '', { runId: task.teamRun.id });
      }
      const technicalFailure = /ACP|Headless|runtime/i.test(event.message || '');
      const failureMessage = technicalFailure
        ? '服务暂时不可用，请稍后重试。'
        : event.message || '未知错误';
      assistant.text += `${assistant.text ? '\n\n' : ''}运行失败：${failureMessage}`;
      addActivity(task, {
        type: 'error',
        title: '任务执行失败',
        detail: failureMessage,
        status: 'failed',
      });
      task.activities.forEach((activity) => {
        if (
          activity.responseId === assistant.id &&
          ['running', 'waiting', 'pending', 'in_progress'].includes(activity.status)
        ) {
          activity.status = 'failed';
        }
      });
      task.pendingPermissions = [];
      task.plan.forEach((item) => {
        if (item.status === 'running') item.status = 'failed';
      });
      assistant.processPlan?.forEach((item) => {
        if (item.status === 'running') item.status = 'failed';
      });
      finalizeAssistantResponse(task, 'failed');
      break;
    }

    default:
      break;
  }

  if (['turn_completed', 'turn_cancelled', 'turn_failed'].includes(event.type)) finishAutomationRun(task);
  if (
    ['turn_completed', 'turn_cancelled', 'turn_failed'].includes(event.type)
    && !task.draftPrompt
    && !task.queuedDraftFileReferences?.length
  ) {
    delete task.queuedDraftFileReferences;
  }
  task.updatedAt = Date.now();
  const project = getConversationProject(task);
  if (project) project.updatedAt = task.updatedAt;
  const commitMode = runtimeEventCommitMode(event.type);
  if (commitMode === 'progress') {
    scheduleRuntimeProgressCommit(task);
    return;
  }
  if (commitMode === 'stream') {
    clearRuntimeProgressCommit(task.id);
    scheduleRuntimeStreamCommit(task);
    return;
  }
  clearRuntimeProgressCommit(task.id);
  clearRuntimeStreamCommit(task.id);
  commitRuntimeStreamNow(task);
  if (event.type === 'turn_completed') {
    window.setTimeout(() => flushQueuedTaskPrompts(task.id), 300);
  }
}

async function initialize(accountStatePromise) {
  accountSession = await accountStatePromise;
  unsubscribeAccountState = window.meteoDesktop.onAccountStateChange?.((session) => {
    accountSession = session;
    void window.meteoDesktop.setWindowMode('account');
    render();
  }) || null;
  const workspaceReady = ['authenticated', 'offline'].includes(accountSession.status) && !accountSession.user?.mustChangePassword;
  await window.meteoDesktop.setWindowMode(workspaceReady ? 'workspace' : 'account');
  if (!['authenticated', 'offline'].includes(accountSession.status)) {
    render();
    return;
  }
  state = loadState(accountSession.profileKey);
  state.tasks.forEach(pruneUnverifiedArtifactRecords);
  window.MeteoMateWorkflowCenter?.normalizeState?.();
  const savedPreviewWidth = Number(localStorage.getItem('meteomate-preview-width-v1'));
  if (Number.isFinite(savedPreviewWidth)) previewUI.width = savedPreviewWidth;
  await loadDesktopSettings({ rerender: false });
  normalizeAutomationState();
  await loadKnowledgeSources({ render: false });
  if (state.view === 'assistants') {
    state.activeTaskId =
      state.tasks.find((task) => task.id === state.assistantTaskId && task.kind === 'assistant')?.id ||
      state.tasks.find((task) => task.kind === 'assistant')?.id ||
      null;
  }
  unsubscribeRuntimeEvents = runtimeRouter.subscribe(handleRuntimeEvent);
  unsubscribeArtifactPreviewEvents = window.meteoDesktop.onArtifactPreviewStateChange?.(
    applyArtifactPreviewState
  );
  unsubscribeArtifactPreviewSelectionEvents = window.meteoDesktop.onArtifactPreviewSelection?.(
    handleArtifactPreviewSelection
  );
  try {
    state.windowMaximized = Boolean(await window.meteoDesktop.windowIsMaximized?.());
  } catch {
    state.windowMaximized = false;
  }
  window.meteoDesktop.onWindowStateChange?.((payload) => {
    const maximized = Boolean(payload?.maximized);
    if (state.windowMaximized === maximized) return;
    state.windowMaximized = maximized;
    const button = document.getElementById('window-maximize');
    if (button) {
      button.innerHTML = icon(maximized ? 'windowRestore' : 'windowMaximize');
      button.setAttribute('aria-label', maximized ? '还原' : '最大化');
      button.title = maximized ? '还原' : '最大化';
    }
  });
  try {
    const workspace = await window.meteoDesktop.getDefaultAssistantWorkspace();
    if (workspace) {
      state.assistantWorkspace = workspace;
      const assistantTask = getAssistantTask();
      if (assistantTask && assistantTask.workspace !== workspace) {
        assistantTask.projectId = 'meteomate-assistant-workspace';
        assistantTask.workspace = workspace;
        assistantTask.sessionId = null;
        assistantTask.runtimeMode = null;
        assistantTask.usage = null;
        assistantTask.contextState = { phase: 'idle', message: '' };
        assistantTask.updatedAt = Date.now();
      }
      saveState();
    }
  } catch (error) {
    console.error('无法初始化助理默认工作区', error);
  }
  runtimeRouter.updateStatus(state.runtime);
  render();
  try {
    state.runtime = await window.meteoDesktop.getRuntimeStatus();
    runtimeRouter.updateStatus(state.runtime);
  } catch (error) {
    state.runtime = {
      ...state.runtime,
      state: 'degraded',
      active: 'mock',
      error: error?.message || String(error),
    };
    runtimeRouter.updateStatus(state.runtime);
  }
  render();
  await loadModelSettings();
  startAutomationScheduler();
}

window.addEventListener('beforeunload', () => {
  window.clearInterval(responseElapsedTimer);
  window.clearInterval(automationSchedulerTimer);
  runtimeStreamCommitTimers.forEach((timer) => window.clearTimeout(timer));
  runtimeStreamCommitTimers.clear();
  runtimeProgressCommitTimers.forEach((timer) => window.clearTimeout(timer));
  runtimeProgressCommitTimers.clear();
  if (!suppressNextUnloadStateSave) saveState();
  permissionMenuCleanup?.();
  taskComposerMenuCleanup?.();
  accountMenuCleanup?.();
  settingsDialogCleanup?.();
  composerTriggerCleanup?.();
  unsubscribeRuntimeEvents?.();
  unsubscribeArtifactPreviewEvents?.();
  unsubscribeArtifactPreviewSelectionEvents?.();
  void window.meteoDesktop.hideArtifactPreview();
});

window.MeteoMateAccountReady = window.meteoDesktop.getAccountState();
initialize(window.MeteoMateAccountReady).catch((error) => {
  console.error(error);
  render();
});
