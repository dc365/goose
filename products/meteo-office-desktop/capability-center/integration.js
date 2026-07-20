(function capabilityCenterIntegration(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;

  state.draftSkillIds = Array.isArray(state.draftSkillIds) ? state.draftSkillIds : [];
  state.draftConnectorIds = Array.isArray(state.draftConnectorIds) ? state.draftConnectorIds : [];
  state.draftToolSelections = normalizeToolSelections(state.draftToolSelections, state.draftConnectorIds);
  state.draftCapabilityMode = state.draftCapabilityMode === 'custom' ? 'custom' : 'inherit';
  for (const task of state.tasks) {
    task.skillIds = Array.isArray(task.skillIds) ? task.skillIds : [];
    task.connectorIds = Array.isArray(task.connectorIds) ? task.connectorIds : [];
    task.toolSelections = normalizeToolSelections(task.toolSelections, task.connectorIds);
    task.capabilityMode = root.MeteoMateHarness.CapabilityResolver.capabilityMode(task);
  }

  const originalCreateTask = createTask;
  createTask = function createTaskWithCapabilities(...args) {
    const task = originalCreateTask(...args);
    const enabledSkills = new Set(api.enabledSkillCatalog(task.projectId || null).map((item) => item.id));
    task.skillIds = state.draftSkillIds.filter((id) => enabledSkills.has(id));
    task.capabilityMode = state.draftCapabilityMode;
    task.connectorIds = task.capabilityMode === 'custom' ? [...state.draftConnectorIds] : [];
    task.toolSelections = task.capabilityMode === 'custom'
      ? normalizeToolSelections(state.draftToolSelections, task.connectorIds)
      : {};
    return task;
  };

  function patchHarness() {
    const compiler = root.MeteoMateHarness?.ContextCompiler;
    if (!compiler || compiler.__capabilityCenterPatched) return;
    const original = compiler.compileTaskContext.bind(compiler);
    compiler.compileTaskContext = (input = {}) => original({
      ...input,
      catalog: api.mergedCatalog(input.catalog || catalog, input.project?.id || null),
    });
    compiler.__capabilityCenterPatched = true;
  }

  function patchRuntime() {
    if (runtimeRouter.__capabilityCenterPatched) return;
    const original = runtimeRouter.send.bind(runtimeRouter);
    runtimeRouter.send = (task, request) => {
      const enabledSkills = new Set(api.enabledSkillCatalog(task.projectId || null).map((item) => item.id));
      const skillIds = (task.skillIds || []).filter((id) => enabledSkills.has(id));
      const connectorIds = task.connectorIds || [];
      request.skillIds = [...skillIds];
      request.connectorIds = [...connectorIds];
      request.toolSelections = normalizeToolSelections(task.toolSelections, connectorIds);
      request.projectId = task.projectId || null;
      const skillNames = skillIds.map((id) => api.skillCatalog(task.projectId || null).find((item) => item.id === id)?.name || id);
      if (skillNames.length) request.expertInstruction = `${request.expertInstruction}\n本次任务已显式选择以下 Skill：${skillNames.join('、')}。优先遵循这些 Skill 的说明与验证要求。`;
      return original(task, request);
    };
    runtimeRouter.__capabilityCenterPatched = true;
  }

  function picker() {
    const task = getActiveTask();
    const project = task ? getConversationProject(task) : getActiveProject();
    const skills = api.enabledSkillCatalog(project?.id || null);
    const enabledSkillIds = new Set(skills.map((item) => item.id));
    const selectedSkills = new Set((task?.skillIds || state.draftSkillIds || []).filter((id) => enabledSkillIds.has(id)));
    const effective = api.effectiveConnectorSelection(task, project);
    const selectedConnectors = new Set(effective.connectorIds);
    const selectedTools = effective.toolSelections;
    const connectors = api.connectorCatalog().filter((item) => item.binding?.enabled && !item.binding.policyBlocked);
    api.ui.modal(`<header class="capability-modal-header"><div><h2>为当前任务添加能力</h2><p>默认继承项目工具；切换为自定义后可进一步收窄本任务的 MCP 工具</p></div><button data-modal-close>×</button></header><div class="capability-modal-body capability-picker-grid"><section><h3>已启用技能</h3>${skills.length ? skills.map((item) => `<label class="capability-picker-item"><input type="checkbox" name="taskSkillIds" value="${escapeHtml(item.id)}" ${selectedSkills.has(item.id) ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></label>`).join('') : '<p class="capability-muted">还没有已启用 Skill，请先到技能中心安装。</p>'}</section><section class="task-tool-picker"><div class="task-tool-picker-heading"><h3>已连接工具</h3><label class="capability-inherit-toggle"><input id="task-inherit-project-tools" type="checkbox" ${effective.mode === 'inherit' ? 'checked' : ''}/><span>继承项目工具</span></label></div><fieldset class="task-tool-selector-fieldset" ${effective.mode === 'inherit' ? 'disabled' : ''}>${renderConnectorToolSelector({ scope: 'task', connectorIds: [...selectedConnectors], toolSelections: selectedTools, connectors })}</fieldset></section></div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="save-task-capabilities">应用到任务</button></footer>`, {
      wide: true,
      onReady(element) {
        bindConnectorToolSelectors(element);
        const inherit = element.querySelector('#task-inherit-project-tools');
        const selector = element.querySelector('.task-tool-selector-fieldset');
        inherit?.addEventListener('change', () => { selector.disabled = inherit.checked; });
        element.querySelector('#save-task-capabilities').addEventListener('click', () => {
          const skillIds = [...element.querySelectorAll('input[name="taskSkillIds"]:checked')].map((input) => input.value);
          const tools = readConnectorToolSelection('task', element);
          const capabilityMode = inherit?.checked ? 'inherit' : 'custom';
          const connectorIds = capabilityMode === 'custom' ? tools.connectorIds : [];
          const toolSelections = capabilityMode === 'custom' ? tools.toolSelections : {};
          if (task) api.clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds, toolSelections, capabilityMode);
          else {
            state.draftSkillIds = skillIds;
            state.draftCapabilityMode = capabilityMode;
            state.draftConnectorIds = connectorIds;
            state.draftToolSelections = toolSelections;
          }
          saveState();
          element.remove();
          render();
        });
      },
    });
  }

  const originalBind = bindEvents;
  bindEvents = function bindEventsWithCapabilityCenter() {
    originalBind();
    document.getElementById('composer-capabilities')?.addEventListener('click', () => {
      const popover = document.getElementById('composer-more-popover');
      if (popover) popover.hidden = true;
      document.getElementById('composer-more')?.setAttribute('aria-expanded', 'false');
      picker();
    });
    document.querySelectorAll('[data-remove-task-skill]').forEach((button) => button.addEventListener('click', () => {
      const task = getActiveTask();
      const skillIds = (task?.skillIds || state.draftSkillIds || []).filter((id) => id !== button.dataset.removeTaskSkill);
      const connectorIds = task?.connectorIds || state.draftConnectorIds || [];
      const toolSelections = task?.toolSelections || state.draftToolSelections || {};
      if (task) api.clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds, toolSelections);
      else state.draftSkillIds = skillIds;
      saveState();
      render();
    }));
    document.querySelectorAll('[data-remove-task-tool]').forEach((button) => button.addEventListener('click', () => {
      const task = getActiveTask();
      const skillIds = task?.skillIds || state.draftSkillIds || [];
      const project = task ? getConversationProject(task) : getActiveProject();
      const effective = api.effectiveConnectorSelection(task, project);
      const connectorIds = effective.connectorIds.filter((id) => id !== button.dataset.removeTaskTool);
      const toolSelections = normalizeToolSelections(effective.toolSelections, connectorIds);
      if (task) api.clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds, toolSelections, 'custom');
      else {
        state.draftCapabilityMode = 'custom';
        state.draftConnectorIds = connectorIds;
        state.draftToolSelections = toolSelections;
      }
      saveState();
      render();
    }));
    document.querySelectorAll('[data-capability-action="open"]').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.capabilityType;
      const id = button.dataset.capabilityId;
      const item = type === 'skill' ? api.skillCatalog().find((candidate) => candidate.id === id) : api.connectorCatalog().find((candidate) => candidate.id === id);
      if (!item) return;
      if (type === 'skill') api.skills.manage(item);
      else api.connectors.manage(item);
    }));
    document.querySelectorAll('[data-capability-view]').forEach((button) => button.addEventListener('click', () => {
      const installed = button.dataset.capabilityView === 'installed';
      if (state.catalogTab === 'skills') api.center.installedOnly = installed;
      else api.center.connectedOnly = installed;
      state.category = '全部';
      render();
    }));
    document.getElementById('toggle-installed-capabilities')?.addEventListener('click', () => {
      if (state.catalogTab === 'skills') api.center.installedOnly = !api.center.installedOnly;
      else api.center.connectedOnly = !api.center.connectedOnly;
      state.category = '全部';
      render();
    });
    const add = document.getElementById('add-capability');
    const popover = document.getElementById('capability-add-popover');
    if (add && popover) {
      add.addEventListener('click', (event) => { event.stopPropagation(); popover.hidden = !popover.hidden; });
      document.addEventListener('click', (event) => { if (!add.parentElement?.contains(event.target)) popover.hidden = true; }, { once: true });
    }
    document.querySelector('[data-add-skill="upload"]')?.addEventListener('click', () => {
      if (popover) popover.hidden = true;
      api.skills.uploadSkill();
    });
    document.querySelector('[data-add-skill="create"]')?.addEventListener('click', () => {
      if (popover) popover.hidden = true;
      void api.skills.launchCreator();
    });
    document.querySelector('[data-add-connector="stdio"]')?.addEventListener('click', () => api.connectors.editor(null, 'stdio'));
    document.querySelector('[data-add-connector="streamable-http"]')?.addEventListener('click', () => api.connectors.editor(null, 'streamable-http'));
  };

  patchHarness();
  patchRuntime();
  void root.MeteoMateAccountReady.then((session) => {
    const profileReady = session.status === 'offline'
      || (session.status === 'authenticated' && !session.user?.mustChangePassword);
    if (profileReady) return api.refresh({ rerender: false }).then(() => render());
    return null;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
