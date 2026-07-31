let permissionMenuCleanup = null;
let taskComposerMenuCleanup = null;
let accountMenuCleanup = null;
let settingsDialogCleanup = null;
let projectDialogCleanup = null;
let composerTriggerCleanup = null;
let catalogDetailCleanup = null;
let unsubscribeArtifactPreviewEvents = null;
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
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    saveState();
    render();
    requestAnimationFrame(() => document.getElementById('sidebar-toggle')?.focus());
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
      state.activeTaskId = task?.id || null;
      state.view = task?.kind === 'assistant' ? 'assistants' : 'task';
      saveState();
      render();
    });
  });

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
  bindPublicationEvents();

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
      delete task.queuedDraftFileReferences;
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
    loadingButton.innerHTML = icon(nextPayload.loading ? 'close' : 'refresh');
    loadingButton.setAttribute('aria-label', nextPayload.loading ? '停止加载' : '刷新');
    loadingButton.title = nextPayload.loading ? '停止加载' : '刷新';
  }

  const status = document.getElementById('artifact-preview-surface-status');
  if (!status) return;
  const error = String(nextPayload.error || '');
  status.hidden = !error;
  status.classList.toggle('error', Boolean(error));
  const title = status.querySelector('strong');
  const detail = status.querySelector('p');
  if (title) title.textContent = error ? '暂时无法预览' : '正在准备预览';
  if (detail) detail.textContent = error || 'MeteoMate 正在打开成果物。';
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
      target: surface.dataset.previewTarget,
      workspace: surface.dataset.previewWorkspace,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
    if (requestId === artifactPreviewSyncRequest) applyArtifactPreviewState(snapshot);
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
  document.querySelector('[data-preview-panel-close]')?.addEventListener('click', () => {
    previewUI.open = false;
    void window.meteoDesktop.hideArtifactPreview();
    render();
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

function publicationAnalysisFromForm(task) {
  const current = window.MeteoMateHarness.PublicationState.analysisForTask(task);
  return {
    ...current,
    region: document.querySelector('[data-publication-region]')?.value.trim() || null,
    issueTime: document.querySelector('[data-publication-issue-time]')?.value.trim() || null,
    validPeriod: document.querySelector('[data-publication-valid-period]')?.value.trim() || null,
  };
}

function savePublicationContext(task, { rerender = true } = {}) {
  if (!task) return null;
  const analysis = window.MeteoMateHarness.PublicationState.updateAnalysis(
    task,
    publicationAnalysisFromForm(task)
  );
  task.updatedAt = Date.now();
  publicationUI.error = '';
  saveState();
  if (rerender) render();
  return analysis;
}

function ensurePublicationFormCurrent(task) {
  const api = window.MeteoMateHarness.PublicationState;
  const formAnalysis = publicationAnalysisFromForm(task);
  if (api.analysisMatchesTask(task, formAnalysis)) return true;
  api.updateAnalysis(task, formAnalysis);
  task.updatedAt = Date.now();
  publicationUI.error = '发布上下文已修改，请重新运行发布检查后再签发。';
  saveState();
  render();
  return false;
}

function applyPublicationResult(task, request, result) {
  const api = window.MeteoMateHarness.PublicationState;
  api.applyServiceResult(task, request, result);
  if (api.requestMatchesTask(task, request)) return true;
  const message = '审核期间分析、Evidence 或 Artifact 已发生变化，请重新运行发布检查。';
  task.publication = {
    ...task.publication,
    dirty: true,
    error: message,
  };
  publicationUI.error = message;
  return false;
}

function addPublicationConclusion(task) {
  if (!task) return;
  const editor = document.querySelector('[data-publication-new-conclusion]');
  const text = editor?.value.trim() || '';
  const evidenceIds = [...document.querySelectorAll('[data-publication-new-evidence]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
  if (!text || !evidenceIds.length) {
    if (editor) {
      editor.setCustomValidity(text ? '请至少选择一条 Evidence' : '请输入预报结论');
      editor.reportValidity();
      editor.addEventListener('input', () => editor.setCustomValidity(''), { once: true });
    }
    return;
  }
  const analysis = publicationAnalysisFromForm(task);
  analysis.conclusions = [
    ...(analysis.conclusions || []),
    { text, evidenceIds: [...new Set(evidenceIds)] },
  ];
  window.MeteoMateHarness.PublicationState.updateAnalysis(task, analysis);
  task.updatedAt = Date.now();
  publicationUI.error = '';
  saveState();
  render();
}

function removePublicationConclusion(task, index) {
  if (!task || !Number.isInteger(index)) return;
  const analysis = publicationAnalysisFromForm(task);
  if (!analysis.conclusions[index]) return;
  analysis.conclusions = analysis.conclusions.filter((_conclusion, itemIndex) => itemIndex !== index);
  window.MeteoMateHarness.PublicationState.updateAnalysis(task, analysis);
  task.updatedAt = Date.now();
  publicationUI.error = '';
  saveState();
  render();
}

async function checkTaskPublication(task, { saveForm = true } = {}) {
  if (!task || publicationUI.busy) return;
  if (saveForm) savePublicationContext(task, { rerender: false });
  publicationUI.busy = 'check';
  publicationUI.busyTargetId = null;
  publicationUI.error = '';
  render();
  try {
    const request = window.MeteoMateHarness.PublicationState.requestForTask(task);
    const result = await window.meteoDesktop.checkPublicationGate(request);
    applyPublicationResult(task, request, result);
  } catch (error) {
    publicationUI.error = error?.message || String(error);
    window.MeteoMateHarness.PublicationState.applyError(task, error);
  } finally {
    publicationUI.busy = '';
    publicationUI.busyTargetId = null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

function publicationQcWaiverReasonInput(evidenceId) {
  return [...document.querySelectorAll('[data-publication-qc-waiver-reason]')]
    .find((input) => input.dataset.publicationQcWaiverReason === String(evidenceId || '')) || null;
}

function publicationQcActionReady(task) {
  const api = window.MeteoMateHarness.PublicationState;
  if (
    task?.publication?.gate
    && !task.publication.dirty
    && api.cachedRequestMatchesTask(task)
  ) {
    return true;
  }
  publicationUI.error = '请先运行发布检查，确认当前 Evidence、QC 状态和成果物未发生变化。';
  render();
  return false;
}

async function createPublicationQcWaiver(task, evidenceId) {
  if (!task || !evidenceId || publicationUI.busy) return;
  const reasonInput = publicationQcWaiverReasonInput(evidenceId);
  const reason = reasonInput?.value.trim() || '';
  publicationUI.qcWaiverReasons[publicationQcReasonKey(task.id, evidenceId)] = reason;
  if (reason.length < 8 || reason.length > 1000) {
    if (reasonInput) {
      reasonInput.setCustomValidity(
        reason.length < 8 ? '请填写至少 8 个字符的人工豁免理由' : '人工豁免理由不能超过 1000 个字符'
      );
      reasonInput.reportValidity();
      reasonInput.addEventListener('input', () => reasonInput.setCustomValidity(''), { once: true });
    }
    return;
  }
  if (!ensurePublicationFormCurrent(task) || !publicationQcActionReady(task)) return;
  publicationUI.busy = 'waive-qc';
  publicationUI.busyTargetId = evidenceId;
  publicationUI.error = '';
  render();
  try {
    const request = window.MeteoMateHarness.PublicationState.requestForTask(task, {
      evidenceId,
      reason,
    });
    const result = await window.meteoDesktop.waivePublicationQc(request);
    if (applyPublicationResult(task, request, result)) {
      delete publicationUI.qcWaiverReasons[publicationQcReasonKey(task.id, evidenceId)];
    }
  } catch (error) {
    publicationUI.error = error?.message || String(error);
    window.MeteoMateHarness.PublicationState.applyError(task, error);
  } finally {
    publicationUI.busy = '';
    publicationUI.busyTargetId = null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

function publicationRevocationReason(subject) {
  const value = window.prompt(
    `请输入撤销${subject}的理由（8-1000 个字符）。该理由会写入不可静默修改的审计记录：`,
    ''
  );
  if (value == null) return null;
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 1000) {
    publicationUI.error = reason.length < 8
      ? '撤销理由至少需要 8 个字符。'
      : '撤销理由不能超过 1000 个字符。';
    render();
    return null;
  }
  return reason;
}

async function revokePublicationQcWaiver(task, waiverId) {
  if (!task || !waiverId || publicationUI.busy) return;
  if (!publicationQcActionReady(task)) return;
  const reason = publicationRevocationReason('这条 QC 人工豁免');
  if (!reason) return;
  publicationUI.busy = 'revoke-qc-waiver';
  publicationUI.busyTargetId = waiverId;
  publicationUI.error = '';
  render();
  try {
    const request = window.MeteoMateHarness.PublicationState.requestForTask(task, {
      waiverId,
      reason,
    });
    const result = await window.meteoDesktop.revokePublicationQcWaiver(request);
    applyPublicationResult(task, request, result);
  } catch (error) {
    publicationUI.error = error?.message || String(error);
    window.MeteoMateHarness.PublicationState.applyError(task, error);
  } finally {
    publicationUI.busy = '';
    publicationUI.busyTargetId = null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

async function signTaskPublication(task) {
  if (!task || publicationUI.busy) return;
  if (!ensurePublicationFormCurrent(task)) return;
  if (!confirm('确认以当前账户签发这份预报结论、证据和成果物吗？签发后任何内容变化都需要重新审核。')) return;
  publicationUI.busy = 'sign';
  publicationUI.busyTargetId = null;
  publicationUI.error = '';
  render();
  try {
    const request = window.MeteoMateHarness.PublicationState.requestForTask(task);
    const result = await window.meteoDesktop.signPublication(request);
    applyPublicationResult(task, request, result);
  } catch (error) {
    publicationUI.error = error?.message || String(error);
    window.MeteoMateHarness.PublicationState.applyError(task, error);
  } finally {
    publicationUI.busy = '';
    publicationUI.busyTargetId = null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

async function revokeTaskPublication(task) {
  if (!task || publicationUI.busy) return;
  const reason = publicationRevocationReason('当前签发');
  if (!reason) return;
  publicationUI.busy = 'revoke';
  publicationUI.busyTargetId = null;
  publicationUI.error = '';
  render();
  try {
    await window.meteoDesktop.revokePublicationSignoff({ taskId: task.id, reason });
    task.publication = {
      signoff: null,
      gate: null,
      checkedAt: Date.now(),
      error: null,
      dirty: true,
    };
    saveState();
    const request = window.MeteoMateHarness.PublicationState.requestForTask(task);
    const result = await window.meteoDesktop.checkPublicationGate(request);
    applyPublicationResult(task, request, result);
  } catch (error) {
    publicationUI.error = error?.message || String(error);
    window.MeteoMateHarness.PublicationState.applyError(task, error);
  } finally {
    publicationUI.busy = '';
    publicationUI.busyTargetId = null;
    task.updatedAt = Date.now();
    saveState();
    render();
  }
}

function bindPublicationEvents() {
  document.querySelector('[data-publication-toggle]')?.addEventListener('click', () => {
    const task = getActiveTask();
    if (!task) return;
    const isCurrent = publicationUI.open && publicationUI.taskId === task.id;
    publicationUI.open = !isCurrent;
    publicationUI.taskId = publicationUI.open ? task.id : null;
    publicationUI.error = '';
    render();
    if (publicationUI.open) {
      requestAnimationFrame(() => {
        document.getElementById('publication-review-panel')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
        if (task.publication?.gate || task.publication?.signoff) {
          void checkTaskPublication(task, { saveForm: false });
        }
      });
    }
  });
  const task = getActiveTask();
  document.querySelector('[data-publication-save-context]')?.addEventListener('click', () => {
    savePublicationContext(task);
  });
  document.querySelector('[data-publication-add-conclusion]')?.addEventListener('click', () => {
    addPublicationConclusion(task);
  });
  document.querySelectorAll('[data-publication-remove-conclusion]').forEach((button) => {
    button.addEventListener('click', () => {
      removePublicationConclusion(task, Number(button.dataset.publicationRemoveConclusion));
    });
  });
  document.querySelectorAll('[data-publication-qc-waiver-reason]').forEach((input) => {
    input.addEventListener('input', () => {
      publicationUI.qcWaiverReasons[
        publicationQcReasonKey(task?.id, input.dataset.publicationQcWaiverReason)
      ] = input.value;
      input.setCustomValidity('');
    });
  });
  document.querySelectorAll('[data-publication-waive-qc]').forEach((button) => {
    button.addEventListener('click', () => {
      void createPublicationQcWaiver(task, button.dataset.publicationWaiveQc);
    });
  });
  document.querySelectorAll('[data-publication-revoke-qc-waiver]').forEach((button) => {
    button.addEventListener('click', () => {
      void revokePublicationQcWaiver(task, button.dataset.publicationRevokeQcWaiver);
    });
  });
  document.querySelector('[data-publication-check]')?.addEventListener('click', () => {
    void checkTaskPublication(task);
  });
  document.querySelector('[data-publication-sign]')?.addEventListener('click', () => {
    void signTaskPublication(task);
  });
  document.querySelector('[data-publication-revoke]')?.addEventListener('click', () => {
    void revokeTaskPublication(task);
  });
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
    modelSettings.message = '';
    modelSettings.error = '';
    render();
    return;
  }
  settingsDialog.providerDraft = null;
  settingsDialog.modelDraft = null;
  settingsDialog.pendingProvider = null;
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
      };
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
      };
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
  document.getElementById('provider-editor-form')?.addEventListener('submit', saveCustomProvider);
  document.getElementById('model-editor-form')?.addEventListener('submit', saveCustomModel);

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

async function saveCustomProvider(event) {
  event.preventDefault();
  if (modelSettings.status === 'saving') return;
  const displayName = document.getElementById('provider-display-name')?.value.trim() || '';
  const apiUrl = document.getElementById('provider-api-url')?.value.trim() || '';
  const apiKey = document.getElementById('provider-api-key')?.value || '';
  const noAuth = Boolean(document.getElementById('provider-no-auth')?.checked);
  if (!displayName) return showSettingsError('请输入提供商名称。');
  try {
    const parsed = new URL(apiUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return showSettingsError('请输入有效的 HTTP 或 HTTPS Base URL。');
  }
  if (!noAuth && !apiKey && !settingsDialog.providerDraft.apiKeySet) {
    return showSettingsError('请输入 API Key，或勾选“此地址无需 API Key”。');
  }
  const editing = Boolean(settingsDialog.providerDraft.id);
  if (!editing) {
    settingsDialog.pendingProvider = {
      displayName,
      apiUrl,
      apiKey: noAuth ? '' : apiKey,
      requiresAuth: !noAuth,
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
    const request = {
      providerId: settingsDialog.providerDraft.id || null,
      displayName,
      apiUrl,
      apiKey: noAuth ? '' : apiKey || null,
      requiresAuth: !noAuth,
    };
    const settings = await window.meteoDesktop.updateModelProvider(request);
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
      ? await window.meteoDesktop.createModelProvider({ ...settingsDialog.pendingProvider, model })
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
  if (!confirm(`确定删除模型“${modelId}”吗？`)) return;
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
    teamUI.expanded = false;
    teamUI.selectedMemberId = null;
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
  teamUI.expanded = false;
  teamUI.selectedMemberId = null;
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
  } else if (!task) {
    state.draftCapabilityMode = 'inherit';
    state.draftConnectorIds = [];
    state.draftToolSelections = {};
    state.draftFileReferences = [];
  }
  saveState();
  render();
}

function bindTaskComposerMenus() {
  document.querySelectorAll('[data-team-toggle]').forEach((element) => {
    element.addEventListener('click', () => {
      teamUI.expanded = !teamUI.expanded;
      render();
    });
  });
  document.querySelectorAll('[data-team-member-id]').forEach((element) => {
    element.addEventListener('click', () => {
      teamUI.selectedMemberId = element.dataset.teamMemberId;
      teamUI.expanded = true;
      render();
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
    title: assistantTask ? primaryAssistant.name : truncate(prompt, 34),
    expertId: expert.id,
    expertName: expert.name,
    expertSnapshot: frozenExpert,
    teamDefinition: frozenExpert.kind === 'team' ? teamDefinitionForExpert(frozenExpert) : null,
    teamRun: null,
    sceneId: assistantTask ? null : state.draftSceneId || null,
    projectId: project?.id || null,
    workspace: project?.workspace || '',
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
  if (['assistant_message_delta', 'thought_delta'].includes(eventType)) return 'stream';
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
  delete activeTask.queuedDraftFileReferences;
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
      createdAt: Date.now(),
    };
    const queued = Array.isArray(existing.queuedPrompts) ? existing.queuedPrompts : [];
    existing.queuedPrompts = options.dequeue ? [item, ...queued] : [...queued, item];
    if (!options.dequeue) {
      existing.queuedDraftFileReferences = [];
      state.draftFileReferences = [];
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
  const submittedFileReferences = [...(task.fileReferences || [])];
  task.queuedDraftFileReferences = [];

  task.permissionProfileId = permissionProfile.id;
  task.allowFileTools = allowFileTools;
  task.workMode = 'execute';
  task.providerId = providerId;
  task.modelId = modelId;
  task.workspace = getConversationProject(task)?.workspace || task.workspace || '';
  task.status = 'running';
  task.updatedAt = Date.now();
  task.pendingPermissions = [];
  task.plan = createDefaultPlan();

  appendMessage(task, 'user', prompt);
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
  state.draftPrompt = '';
  state.draftFileReferences = [];
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
  if (removedArtifactIds.size || removedEvidenceIds.size || removedAssistantIds.size) {
    task.publication = {
      ...(task.publication || {}),
      dirty: true,
      error: null,
    };
  }
  task.pendingPermissions = [];
  task.teamRun = null;
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
    task.title = task.kind === 'assistant' ? primaryAssistant.name : truncate(prompt, 34);
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

function extractArtifactCandidates(value) {
  let text = '';
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return [];
  }
  const pattern = /(?:https?:\/\/|file:\/\/\/|[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'`()<>()[\]{},;|]+\.(?:docx|xlsx|pptx|pdf|html|md|png|jpg|jpeg|webp|csv|geojson|tif|tiff)\b/gi;
  return [...new Set(text.match(pattern) || [])]
    .filter((candidate) => !/^(?:https?:|file:)/i.test(candidate))
    .slice(0, 8);
}

function artifactCandidatePath(task, candidate) {
  const value = String(candidate || '').trim().replaceAll('\\', '/');
  const workspace = String(task?.workspace || '').trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (!value || !workspace || /^(?:https?:|file:|\/\/)/i.test(value)) return '';

  const absolute = value.startsWith('/') || /^[A-Za-z]:\//.test(value);
  if (absolute) {
    const comparableValue = /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
    const comparableWorkspace = /^[A-Za-z]:\//.test(workspace) ? workspace.toLowerCase() : workspace;
    if (
      comparableValue !== comparableWorkspace
      && !comparableValue.startsWith(`${comparableWorkspace}/`)
    ) {
      return '';
    }
    return value;
  }
  if (value === '..' || value.startsWith('../')) return '';
  return `${workspace}/${value.replace(/^(?:\.\/)+/, '')}`;
}

function registerArtifacts(task, source) {
  for (const candidate of extractArtifactCandidates(source)) {
    const pathValue = artifactCandidatePath(task, candidate);
    if (!pathValue) continue;
    const name = pathBaseName(pathValue);
    if (task.artifacts.some((artifact) => artifact.path === pathValue || artifact.name === name)) continue;
    const record = window.MeteoMateHarness.ArtifactRegistry.registerArtifact(task, {
      id: cryptoRandomId(),
      name,
      path: pathValue,
      type: name.split('.').pop()?.toUpperCase() || 'FILE',
      metadata: { source: 'legacy-assistant-text' },
      createdAt: Date.now(),
    });
    const assistant = currentStreamingAssistant(task) || latestAssistantMessage(task);
    if (assistant) {
      assistant.artifactIds = [...new Set([...(assistant.artifactIds || []), record.id])];
    }
    if (task.publication) {
      task.publication = {
        ...task.publication,
        dirty: true,
        error: null,
      };
    }
  }
}

function completionArtifactUri(task, value) {
  const uri = String(value || '').trim();
  if (!uri) return '';
  if (/^(?:https?:|file:|[A-Za-z]:[\\/]|\/)/i.test(uri)) return uri;
  return task?.workspace ? uri : '';
}

function registerCompletionArtifacts(task, artifacts) {
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const uri = completionArtifactUri(task, artifact?.uri);
    if (!uri) continue;
    const name = String(artifact.name || pathBaseName(uri) || '成果');
    if (task.artifacts.some((item) => item.path === uri || item.uri === uri || item.name === name)) continue;
    const record = window.MeteoMateHarness.ArtifactRegistry.registerArtifact(task, {
      id: cryptoRandomId(),
      name,
      path: uri,
      uri,
      type: artifact.mediaType || name.split('.').pop()?.toUpperCase() || 'FILE',
      description: artifact.description || '',
      createdAt: Date.now(),
    });
    const assistant = currentStreamingAssistant(task) || latestAssistantMessage(task);
    if (assistant) {
      assistant.artifactIds = [...new Set([...(assistant.artifactIds || []), record.id])];
    }
    if (task.publication) {
      task.publication = {
        ...task.publication,
        dirty: true,
        error: null,
      };
    }
  }
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
  return window.MeteoMateHarness.ContextCompiler.evaluateCompletion(contract, assistant.text);
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

function ensureTeamRunMember(task, event) {
  if (!task.teamRun) {
    const team = teamDefinitionForTask(task, getTaskExpert(task));
    if (team) task.teamRun = window.MeteoMateHarness.ExpertTeam.createRunState(team);
  }
  if (!task.teamRun) return null;
  const memberId = event.teamMemberId || event.member?.id;
  let member = task.teamRun.members.find((candidate) => candidate.id === memberId);
  if (!member && event.member) {
    member = {
      ...structuredClone(event.member),
      status: 'pending',
      sessionId: null,
      startedAt: null,
      completedAt: null,
      summary: '',
      detail: '',
      error: '',
      activities: [],
    };
    task.teamRun.members.push(member);
  }
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

function interruptActiveTeamMembers(task, status, detail = '') {
  if (!task.teamRun) return;
  task.teamRun.members.forEach((member) => {
    if (['pending', 'running'].includes(member.status)) {
      member.status = status;
      member.completedAt = Date.now();
      if (detail) member.error = detail;
    }
  });
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
      task.teamRun = structuredClone(event.teamRun);
      task.teamRun.status = 'running';
      task.teamRun.phase = 'dispatching';
      teamUI.selectedMemberId = task.teamRun.members[0]?.id || null;
      addActivity(task, {
        id: `team-run-${task.teamRun.id}`,
        type: 'info',
        title: '专家团已就位',
        detail: `${task.teamRun.members.length} 位专家将按依赖关系协作，最后由负责人统一交付。`,
        status: 'running',
      });
      break;

    case 'team_member_started':
      updateTeamRunMember(task, event, {
        status: 'running',
        startedAt: event.startedAt || Date.now(),
      });
      if (task.teamRun) task.teamRun.phase = 'executing';
      break;

    case 'team_member_progress':
      updateTeamRunMember(task, event, {
        status: 'running',
        detail: event.detail || '',
      });
      break;

    case 'team_member_activity': {
      const member = updateTeamRunMember(task, event, {
        status: 'running',
        detail: event.activity?.title || '',
      });
      if (member && event.activity) {
        const activities = Array.isArray(member.activities) ? member.activities : [];
        const index = activities.findIndex((activity) => activity.id === event.activity.id);
        if (index >= 0) activities[index] = { ...activities[index], ...event.activity };
        else activities.push(structuredClone(event.activity));
        member.activities = activities.slice(-6);
      }
      break;
    }

    case 'team_member_usage':
      updateTeamRunMember(task, event, { usage: event.usage || null });
      break;

    case 'team_member_completed':
      updateTeamRunMember(task, event, {
        status: 'completed',
        summary: event.summary || '',
        detail: '',
        completedAt: event.completedAt || Date.now(),
      });
      break;

    case 'team_member_failed':
    case 'team_member_cancelled':
    case 'team_member_blocked': {
      const status = event.type.replace('team_member_', '');
      updateTeamRunMember(task, event, {
        status,
        error: event.message || '',
        detail: '',
        completedAt: event.completedAt || Date.now(),
      });
      break;
    }

    case 'team_synthesis_started':
      if (task.teamRun) {
        task.teamRun.status = 'running';
        task.teamRun.phase = 'synthesizing';
      }
      break;

    case 'team_completed':
      if (task.teamRun) {
        task.teamRun.status = event.status || 'completed';
        task.teamRun.phase = 'completed';
        task.teamRun.completedAt = event.completedAt || Date.now();
        task.teamRun.completedCount = event.completedCount;
        task.teamRun.failedCount = event.failedCount;
      }
      updateActivity(task, `team-run-${task.teamRun?.id}`, {
        status: event.status === 'partial' ? 'interrupted' : 'completed',
        detail: event.failedCount
          ? `${event.completedCount || 0} 位成员完成，${event.failedCount} 位失败或受阻；负责人已交付可用部分。`
          : `${event.completedCount || task.teamRun?.members.length || 0} 位成员已完成，负责人已汇总交付。`,
      });
      break;

    case 'team_failed':
      if (task.teamRun) {
        task.teamRun.status = 'failed';
        task.teamRun.phase = 'failed';
        task.teamRun.error = event.message || '';
        task.teamRun.completedAt = event.completedAt || Date.now();
      }
      interruptActiveTeamMembers(task, 'interrupted', event.message || '');
      updateActivity(task, `team-run-${task.teamRun?.id}`, {
        status: 'failed',
        detail: event.message || '专家团执行失败。',
      });
      break;

    case 'team_cancelled':
      if (task.teamRun) {
        task.teamRun.status = 'cancelled';
        task.teamRun.phase = 'cancelled';
        task.teamRun.completedAt = event.completedAt || Date.now();
      }
      interruptActiveTeamMembers(task, 'cancelled');
      updateActivity(task, `team-run-${task.teamRun?.id}`, {
        status: 'failed',
        detail: '专家团任务已停止。',
      });
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
      }
      assistant.text += event.text || '';
      if (streamingAssistant) assistant.status = 'streaming';
      registerArtifacts(task, event.text || '');
      break;
    }

    case 'user_message_delta':
      break;

    case 'thought_delta': {
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
      if (event.title && task.messages.length <= 2) task.title = event.title;
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
      const completion = runtimeCompletion(task, event, assistant);
      const completed = !completion.required || (completion.valid && completion.status === 'completed');
      const failed = completion.required && completion.valid && completion.status === 'failed';
      if (!completed && !failed && retryIncompleteCompletion(task, assistant, completion)) break;
      task.status = completed ? 'completed' : failed ? 'failed' : 'interrupted';
      if (completion.envelope) {
        assistant.completion = completion.envelope;
        assistant.text = completionText(completion.envelope)
          || completion.envelope.summary
          || '任务尚未形成可显示的最终结果。';
        registerCompletionArtifacts(task, completion.envelope.artifacts);
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
        interruptActiveTeamMembers(task, 'cancelled');
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
        interruptActiveTeamMembers(task, 'interrupted', event.message || '');
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
  const workspaceReady = ['authenticated', 'offline'].includes(accountSession.status) && !accountSession.user?.mustChangePassword;
  await window.meteoDesktop.setWindowMode(workspaceReady ? 'workspace' : 'account');
  if (!['authenticated', 'offline'].includes(accountSession.status)) {
    render();
    return;
  }
  state = loadState(accountSession.profileKey);
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
  void window.meteoDesktop.hideArtifactPreview();
});

window.MeteoMateAccountReady = window.meteoDesktop.getAccountState();
initialize(window.MeteoMateAccountReady).catch((error) => {
  console.error(error);
  render();
});
