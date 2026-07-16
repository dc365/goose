(function capabilityCenterIntegration(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;

  state.draftSkillIds = Array.isArray(state.draftSkillIds) ? state.draftSkillIds : [];
  state.draftConnectorIds = Array.isArray(state.draftConnectorIds) ? state.draftConnectorIds : [];
  for (const task of state.tasks) {
    task.skillIds = Array.isArray(task.skillIds) ? task.skillIds : [];
    task.connectorIds = Array.isArray(task.connectorIds) ? task.connectorIds : [];
  }

  const originalCreateTask = createTask;
  createTask = function createTaskWithCapabilities(...args) {
    const task = originalCreateTask(...args);
    task.skillIds = [...state.draftSkillIds];
    task.connectorIds = [...state.draftConnectorIds];
    return task;
  };

  function patchHarness() {
    const compiler = root.MeteoMateHarness?.ContextCompiler;
    if (!compiler || compiler.__capabilityCenterPatched) return;
    const original = compiler.compileTaskContext.bind(compiler);
    compiler.compileTaskContext = (input = {}) => original({ ...input, catalog: api.mergedCatalog(input.catalog || catalog) });
    compiler.__capabilityCenterPatched = true;
  }

  function patchRuntime() {
    if (runtimeRouter.__capabilityCenterPatched) return;
    const original = runtimeRouter.send.bind(runtimeRouter);
    runtimeRouter.send = (task, request) => {
      const skillIds = task.skillIds || [];
      const connectorIds = task.connectorIds || [];
      request.skillIds = [...skillIds];
      request.connectorIds = [...connectorIds];
      request.projectId = task.projectId || null;
      const skillNames = skillIds.map((id) => api.skillCatalog().find((item) => item.id === id)?.name || id);
      if (skillNames.length) request.expertInstruction = `${request.expertInstruction}\n本次任务已显式选择以下 Skill：${skillNames.join('、')}。优先遵循这些 Skill 的说明与验证要求。`;
      return original(task, request);
    };
    runtimeRouter.__capabilityCenterPatched = true;
  }

  function picker() {
    const task = getActiveTask();
    const selectedSkills = new Set(task?.skillIds || state.draftSkillIds || []);
    const selectedConnectors = new Set(task?.connectorIds || state.draftConnectorIds || []);
    const skills = api.skillCatalog().filter((item) => item.installation?.enabled);
    const connectors = api.connectorCatalog().filter((item) => item.binding?.enabled);
    api.ui.modal(`<header class="capability-modal-header"><div><h2>为当前任务添加能力</h2><p>所选能力会写入 Harness Snapshot；变更后将创建新的 Goose Session</p></div><button data-modal-close>×</button></header><div class="capability-modal-body capability-picker-grid"><section><h3>已启用技能</h3>${skills.length ? skills.map((item) => `<label class="capability-picker-item"><input type="checkbox" name="taskSkillIds" value="${escapeHtml(item.id)}" ${selectedSkills.has(item.id) ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></label>`).join('') : '<p class="capability-muted">还没有已启用 Skill，请先到技能中心安装。</p>'}</section><section><h3>已连接连接器</h3>${connectors.length ? connectors.map((item) => `<label class="capability-picker-item"><input type="checkbox" name="taskConnectorIds" value="${escapeHtml(item.id)}" ${selectedConnectors.has(item.id) ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></label>`).join('') : '<p class="capability-muted">还没有可用连接器，请先完成配置和测试。</p>'}</section></div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="save-task-capabilities">应用到任务</button></footer>`, {
      wide: true,
      onReady(element) {
        element.querySelector('#save-task-capabilities').addEventListener('click', () => {
          const skillIds = [...element.querySelectorAll('input[name="taskSkillIds"]:checked')].map((input) => input.value);
          const connectorIds = [...element.querySelectorAll('input[name="taskConnectorIds"]:checked')].map((input) => input.value);
          if (task) api.clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds);
          else {
            state.draftSkillIds = skillIds;
            state.draftConnectorIds = connectorIds;
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
    document.querySelector('[data-add-skill="find"]')?.addEventListener('click', () => document.getElementById('catalog-search')?.focus());
    document.querySelector('[data-add-skill="zip"]')?.addEventListener('click', () => void api.skills.importSkill('zip'));
    document.querySelector('[data-add-skill="directory"]')?.addEventListener('click', () => void api.skills.importSkill('directory'));
    document.querySelector('[data-add-skill="create"]')?.addEventListener('click', () => void api.skills.launchCreator());
    document.querySelector('[data-add-connector="stdio"]')?.addEventListener('click', () => api.connectors.editor(null, 'stdio'));
    document.querySelector('[data-add-connector="streamable-http"]')?.addEventListener('click', () => api.connectors.editor(null, 'streamable-http'));
    document.getElementById('composer-capabilities')?.addEventListener('click', picker);
  };

  patchHarness();
  patchRuntime();
  void api.refresh({ rerender: false }).then(() => render());
})(typeof globalThis !== 'undefined' ? globalThis : window);
