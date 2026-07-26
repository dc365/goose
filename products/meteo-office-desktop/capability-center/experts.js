(function expertCenter(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const ui = {
    mode: 'browse',
    editingId: null,
    draft: null,
    error: '',
    syncing: false,
    syncMessage: '',
  };

  const list = (value) => (Array.isArray(value) ? value : []);
  const lines = (value) => String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const lineText = (value) => list(value).join('\n');
  const commaText = (value) => list(value).join('，');
  const commaList = (value) => String(value || '').split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);

  function managedExperts() {
    return api.expertCatalog({ includeInactive: true }).filter((item) => item.source?.type === 'user');
  }

  const syncLabel = {
    local_only: '仅本地',
    pending_upload: '待同步',
    synced: '已同步',
    conflict: '版本冲突',
    sync_error: '同步失败',
  };

  function emptyDraft() {
    return {
      name: '',
      version: '0.1.0',
      status: 'draft',
      category: '气象业务',
      avatar: '专',
      description: '',
      mission: '',
      tags: [],
      instruction: '',
      methodology: [],
      limitations: [],
      inputs: [],
      outputs: [],
      prompts: [],
      requiredSkills: [],
      recommendedSkills: [],
      requiredWorkflows: [],
      recommendedWorkflows: [],
      requiredConnectors: [],
      recommendedConnectors: [],
      toolSelections: {},
      permissionProfile: 'artifact-approval',
      defaultWorkMode: 'execute',
      modelPolicy: 'inherit',
    };
  }

  function openEditor(expert = null, { duplicate = false } = {}) {
    const source = expert ? structuredClone(expert) : emptyDraft();
    ui.draft = {
      ...emptyDraft(),
      ...source,
      id: duplicate ? undefined : source.id,
      name: duplicate ? `${source.name} 副本` : source.name,
      status: duplicate ? 'draft' : source.status || 'draft',
      source: duplicate ? undefined : source.source,
      requiredSkills: [...list(source.requiredSkills)],
      recommendedSkills: [...list(source.recommendedSkills)],
      requiredWorkflows: [...list(source.requiredWorkflows)],
      recommendedWorkflows: [...list(source.recommendedWorkflows)],
      requiredConnectors: [...list(source.requiredConnectors)],
      recommendedConnectors: [...list(source.recommendedConnectors)],
      toolSelections: structuredClone(source.toolSelections || {}),
    };
    ui.editingId = duplicate ? null : expert?.id || null;
    ui.error = '';
    ui.mode = 'editor';
    catalogUI.detailExpertId = null;
    state.search = '';
    render();
  }

  function syncDraftFromForm() {
    const form = document.getElementById('expert-editor-form');
    if (!form || !ui.draft) return ui.draft;
    ui.draft = {
      ...ui.draft,
      name: form.elements.name.value.trim(),
      version: form.elements.version.value.trim(),
      avatar: form.elements.avatar.value.trim(),
      category: form.elements.category.value.trim(),
      description: form.elements.description.value.trim(),
      mission: form.elements.mission.value.trim(),
      tags: commaList(form.elements.tags.value),
      instruction: form.elements.instruction.value.trim(),
      methodology: lines(form.elements.methodology.value),
      limitations: lines(form.elements.limitations.value),
      inputs: lines(form.elements.inputs.value),
      outputs: lines(form.elements.outputs.value),
      prompts: lines(form.elements.prompts.value),
      permissionProfile: form.elements.permissionProfile.value,
      defaultWorkMode: form.elements.defaultWorkMode.value,
      modelPolicy: form.elements.modelPolicy.value,
      requiredSkills: selectedByMode(form, 'skill', 'required'),
      recommendedSkills: selectedByMode(form, 'skill', 'recommended'),
      requiredWorkflows: selectedByMode(form, 'workflow', 'required'),
      recommendedWorkflows: selectedByMode(form, 'workflow', 'recommended'),
      requiredConnectors: selectedByMode(form, 'connector', 'required'),
      recommendedConnectors: selectedByMode(form, 'connector', 'recommended'),
    };
    return ui.draft;
  }

  function selectedByMode(form, type, mode) {
    return [...form.querySelectorAll(`[data-expert-capability-type="${type}"]`)]
      .filter((element) => element.value === mode)
      .map((element) => element.dataset.expertCapabilityId);
  }

  function capabilityRows(type) {
    const keys = {
      skill: ['requiredSkills', 'recommendedSkills'],
      workflow: ['requiredWorkflows', 'recommendedWorkflows'],
      connector: ['requiredConnectors', 'recommendedConnectors'],
    };
    const [requiredKey, recommendedKey] = keys[type];
    const ids = [...new Set([...list(ui.draft?.[requiredKey]), ...list(ui.draft?.[recommendedKey])])];
    const items = type === 'skill'
      ? api.skillCatalog()
      : type === 'workflow'
        ? publishedWorkflowOptions()
        : api.connectorCatalog();
    if (!ids.length) {
      const label = { skill: '技能', workflow: '工作流', connector: '工具' }[type];
      return `<p class="expert-editor-empty">尚未选择${label}，任务仍可继承项目能力。</p>`;
    }
    return ids.map((id) => {
      const item = items.find((candidate) => candidate.id === id);
      const required = list(ui.draft?.[requiredKey]).includes(id);
      const count = type === 'connector' ? list(ui.draft?.toolSelections?.[id]).length : 0;
      return `<div class="expert-capability-row">
        <span class="expert-capability-mark">${escapeHtml(item?.icon || item?.name?.slice(0, 1) || id.slice(0, 1))}</span>
        <span><strong>${escapeHtml(item?.name || id)}</strong><small>${escapeHtml(item?.description || id)}${count ? ` · 已选 ${count} 个工具` : ''}</small></span>
        <select data-expert-capability-type="${type}" data-expert-capability-id="${escapeHtml(id)}" aria-label="${escapeHtml(item?.name || id)}的使用方式">
          <option value="recommended" ${required ? '' : 'selected'}>建议</option>
          <option value="required" ${required ? 'selected' : ''}>必需</option>
        </select>
        <button type="button" data-expert-remove-capability="${type}" data-expert-capability-id="${escapeHtml(id)}" aria-label="移除">×</button>
      </div>`;
    }).join('');
  }

  function publishedWorkflowOptions() {
    const latest = new Map();
    for (const workflow of [...list(state.workflowVersions), ...list(state.workflows)]) {
      if (workflow?.metadata?.status !== 'published') continue;
      const reference = `${workflow.metadata.id}@${workflow.metadata.version}`;
      if (latest.has(reference)) continue;
      latest.set(reference, {
        id: reference,
        name: workflow.metadata.name,
        description: `v${workflow.metadata.version} · ${workflow.metadata.description || '已发布工作流'}`,
        icon: '流',
      });
    }
    return [...latest.values()];
  }

  function localPreflight() {
    const skillIndex = new Map(api.enabledSkillCatalog().map((item) => [item.id, item]));
    const connectorIndex = new Map(
      api.connectorCatalog()
        .filter((item) => item.binding?.enabled && !item.binding?.policyBlocked)
        .map((item) => [item.id, item])
    );
    const workflowIndex = new Set(publishedWorkflowOptions().map((item) => item.id));
    const issues = [
      ...list(ui.draft?.requiredSkills)
        .filter((id) => !skillIndex.has(id))
        .map((id) => `必需技能未启用：${id}`),
      ...list(ui.draft?.requiredConnectors)
        .filter((id) => !connectorIndex.has(id))
        .map((id) => `必需工具未连接：${id}`),
      ...list(ui.draft?.requiredWorkflows)
        .filter((id) => !workflowIndex.has(id))
        .map((id) => `必需工作流未发布：${id}`),
    ];
    return {
      ready: issues.length === 0,
      issues,
    };
  }

  function renderEditor() {
    const draft = ui.draft || emptyDraft();
    const preflight = localPreflight();
    const permissionOptions = Object.values(catalog.permissionProfiles)
      .map((item) => `<option value="${escapeHtml(item.id)}" ${draft.permissionProfile === item.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.status)}</option>`)
      .join('');
    return `<div class="content-scroll window-content-full expert-studio-page">
      <form id="expert-editor-form" class="expert-editor">
        ${ui.error ? `<div class="expert-editor-error">${escapeHtml(ui.error)}</div>` : ''}
        <section class="expert-editor-hero">
          <div><span>EXPERT PROFILE</span><h1>${draft.id ? '编辑专家' : '创建专家'}</h1><p>定义稳定的专业角色与能力边界；项目负责提供实际资料，任务运行时会冻结当前专家版本。</p></div>
          <div class="expert-editor-version"><span>${draft.source?.type === 'organization' ? '组织' : draft.source?.type === 'system' ? '系统' : '个人'}</span><strong>v${escapeHtml(draft.version || '0.1.0')} · r${Number(draft.revision || 0)}</strong></div>
        </section>

        <section class="expert-editor-section">
          <header><span>01</span><div><h2>基本信息</h2><p>帮助用户在专家中心快速判断是否适用。</p></div></header>
          <div class="expert-editor-grid basic">
            <label><span>专家名称</span><input name="name" value="${escapeHtml(draft.name)}" placeholder="例如：短临预报分析专家" required /></label>
            <label class="compact"><span>头像简称</span><input name="avatar" value="${escapeHtml(draft.avatar)}" maxlength="2" /></label>
            <label><span>业务分类</span><input name="category" value="${escapeHtml(draft.category)}" placeholder="气象业务" /></label>
            <label class="compact"><span>版本</span><input name="version" value="${escapeHtml(draft.version)}" placeholder="0.1.0" /></label>
            <label class="wide"><span>一句话说明</span><input name="description" value="${escapeHtml(draft.description)}" placeholder="说明专家擅长解决什么问题" /></label>
            <label class="wide"><span>专家定位</span><textarea name="mission" rows="2" placeholder="明确职责、适用范围和主要交付">${escapeHtml(draft.mission)}</textarea></label>
            <label class="wide"><span>标签</span><input name="tags" value="${escapeHtml(commaText(draft.tags))}" placeholder="短临预报，雷达，风险研判" /></label>
          </div>
        </section>

        <section class="expert-editor-section">
          <header><span>02</span><div><h2>工作方法</h2><p>这是专家真正执行任务时遵循的指令与业务契约。</p></div></header>
          <div class="expert-editor-grid">
            <label class="wide"><span>专家工作指令</span><textarea name="instruction" rows="7" placeholder="描述角色、判断原则、工作顺序、证据要求和交付标准" required>${escapeHtml(draft.instruction)}</textarea></label>
            <label><span>工作步骤</span><textarea name="methodology" rows="6" placeholder="每行一个步骤">${escapeHtml(lineText(draft.methodology || draft.workflow))}</textarea></label>
            <label><span>限制与边界</span><textarea name="limitations" rows="6" placeholder="每行一条限制">${escapeHtml(lineText(draft.limitations))}</textarea></label>
            <label><span>需要的输入</span><textarea name="inputs" rows="4" placeholder="每行一种输入">${escapeHtml(lineText(draft.inputs))}</textarea></label>
            <label><span>预期交付</span><textarea name="outputs" rows="4" placeholder="每行一种交付">${escapeHtml(lineText(draft.outputs))}</textarea></label>
            <label class="wide"><span>示例任务</span><textarea name="prompts" rows="3" placeholder="每行一个示例问题">${escapeHtml(lineText(draft.prompts))}</textarea></label>
          </div>
        </section>

        <section class="expert-editor-section">
          <header><span>03</span><div><h2>能力组合</h2><p>声明专家需要或建议的技能、MCP 服务及具体工具；项目仍可进一步收窄授权。</p></div></header>
          <div class="expert-capability-columns">
            <div class="expert-capability-panel"><div class="expert-panel-heading"><div><h3>技能</h3><p>业务方法、规范和可复用流程</p></div><button type="button" data-expert-pick="skill">${icon('plus')} 添加技能</button></div>${capabilityRows('skill')}</div>
            <div class="expert-capability-panel"><div class="expert-panel-heading"><div><h3>工具</h3><p>MCP 服务与精确工具范围</p></div><button type="button" data-expert-pick="connector">${icon('plus')} 添加工具</button></div>${capabilityRows('connector')}</div>
            <div class="expert-capability-panel workflow"><div class="expert-panel-heading"><div><h3>工作流</h3><p>固定到已发布版本，运行时作为可复用执行契约加载</p></div><button type="button" data-expert-pick="workflow">${icon('plus')} 添加工作流</button></div>${capabilityRows('workflow')}</div>
          </div>
        </section>

        <section class="expert-editor-section">
          <header><span>04</span><div><h2>运行策略</h2><p>设置默认行为；任务和组织策略仍可覆盖。</p></div></header>
          <div class="expert-editor-grid three">
            <label><span>默认工作模式</span><select name="defaultWorkMode"><option value="ask" ${draft.defaultWorkMode === 'ask' ? 'selected' : ''}>问答</option><option value="plan" ${draft.defaultWorkMode === 'plan' ? 'selected' : ''}>先规划</option><option value="execute" ${draft.defaultWorkMode === 'execute' ? 'selected' : ''}>直接执行</option></select></label>
            <label><span>模型策略</span><select name="modelPolicy"><option value="inherit" ${draft.modelPolicy === 'inherit' ? 'selected' : ''}>继承当前任务</option><option value="default" ${draft.modelPolicy === 'default' ? 'selected' : ''}>使用全局默认模型</option></select></label>
            <label><span>权限策略</span><select name="permissionProfile">${permissionOptions}</select></label>
          </div>
        </section>

        <section class="expert-editor-section expert-preflight ${preflight.ready ? 'ready' : 'blocked'}">
          <header><span>05</span><div><h2>启用检查</h2><p>${preflight.ready ? '必需能力已经就绪，可以启用专家。' : '草稿可以保存；启用前需处理以下依赖。'}</p></div><strong>${preflight.ready ? '可以启用' : `${preflight.issues.length} 项待处理`}</strong></header>
          ${preflight.issues.length ? `<ul>${preflight.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : '<p class="expert-preflight-success">运行时会按专家、项目、任务三层合并能力，并在新任务中固定本次专家版本。</p>'}
        </section>
      </form>
    </div>`;
  }

  function renderMine() {
    const query = state.search.trim().toLowerCase();
    const items = managedExperts().filter((item) => !query || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query));
    const statusLabel = { draft: '草稿', enabled: '已启用', disabled: '已停用', archived: '已归档' };
    return `<div class="content-scroll window-content-full expert-studio-page">
      <section class="expert-manager">
        <header><div><span>MY EXPERTS</span><h1>我的专家</h1><p>管理个人专家的版本、能力组合和启用状态。内置专家可复制后再定制。</p></div><div class="expert-manager-summary"><strong>${items.filter((item) => item.status === 'enabled').length}</strong><span>已启用</span><strong>${items.length}</strong><span>全部</span></div></header>
        ${ui.syncMessage ? `<div class="expert-sync-notice">${escapeHtml(ui.syncMessage)}</div>` : ''}
        ${api.center.status === 'loading' ? '<div class="empty-result">正在读取专家注册表…</div>' : items.length ? `<div class="expert-manager-list">${items.map((item) => `
          <article class="expert-manager-row status-${escapeHtml(item.status)}">
            <span class="avatar">${escapeHtml(item.avatar || item.name.slice(0, 1))}</span>
            <div class="expert-manager-copy"><div><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category || '自定义专家')}</span><span class="expert-state">${escapeHtml(statusLabel[item.status] || item.status)}</span><span class="expert-sync-state ${escapeHtml(item.syncStatus || 'local_only')}">${escapeHtml(syncLabel[item.syncStatus] || '仅本地')}</span></div><p>${escapeHtml(item.description || item.mission || '尚未补充专家说明')}</p><small>v${escapeHtml(item.version)} · 修订 ${Number(item.revision || 1)} · ${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '')}${item.syncError ? ` · ${escapeHtml(item.syncError)}` : ''}</small></div>
            <div class="expert-manager-actions">
              ${item.syncStatus === 'conflict' && item.remoteShadow ? `<button data-expert-conflict="local" data-expert-conflict-id="${escapeHtml(item.id)}">保留本地</button><button data-expert-conflict="remote" data-expert-conflict-id="${escapeHtml(item.id)}">采用远程</button>` : ''}
              <button data-expert-manage="edit" data-expert-manage-id="${escapeHtml(item.id)}">编辑</button>
              <button data-expert-manage="duplicate" data-expert-manage-id="${escapeHtml(item.id)}">复制</button>
              ${item.status === 'enabled' ? `<button data-expert-manage="disabled" data-expert-manage-id="${escapeHtml(item.id)}">停用</button>` : item.status === 'archived' ? `<button data-expert-manage="disabled" data-expert-manage-id="${escapeHtml(item.id)}">恢复</button>` : `<button class="primary" data-expert-manage="enabled" data-expert-manage-id="${escapeHtml(item.id)}">启用</button>`}
              ${item.status !== 'archived' ? `<button class="danger" data-expert-manage="archived" data-expert-manage-id="${escapeHtml(item.id)}">归档</button>` : ''}
            </div>
          </article>`).join('')}</div>` : '<div class="expert-manager-empty"><span>专</span><h2>还没有个人专家</h2><p>可以从空白开始，也可以复制一个内置专家后调整。</p><button class="primary-button" data-expert-create>创建第一个专家</button></div>'}
      </section>
    </div>`;
  }

  function picker(type) {
    syncDraftFromForm();
    const skillPicker = type === 'skill';
    const workflowPicker = type === 'workflow';
    const items = skillPicker
      ? api.skillCatalog().filter((item) => item.installation?.enabled)
      : workflowPicker
        ? publishedWorkflowOptions()
      : api.connectorCatalog().filter((item) => item.id !== 'goose-runtime');
    if (workflowPicker) {
      const selected = new Set([...list(ui.draft.requiredWorkflows), ...list(ui.draft.recommendedWorkflows)]);
      api.ui.modal(`<header class="capability-modal-header"><div><h2>添加工作流</h2><p>只显示已发布版本。专家引用会固定版本，后续发布不会静默改变当前能力。</p></div><button data-modal-close>×</button></header><div class="capability-modal-body expert-picker-list">${items.length ? items.map((item) => `<label class="capability-picker-item"><input type="checkbox" name="expertWorkflowIds" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></label>`).join('') : '<p class="capability-muted">还没有已发布工作流，请先在工作流中心完成发布。</p>'}</div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" data-expert-picker-apply="workflow">应用</button></footer>`, {
        wide: true,
        onReady(element) {
          element.querySelector('[data-expert-picker-apply="workflow"]')?.addEventListener('click', () => {
            const ids = [...element.querySelectorAll('input[name="expertWorkflowIds"]:checked')].map((input) => input.value);
            const previousRequired = new Set(ui.draft.requiredWorkflows);
            ui.draft.requiredWorkflows = ids.filter((id) => previousRequired.has(id));
            ui.draft.recommendedWorkflows = ids.filter((id) => !previousRequired.has(id));
            element.remove();
            render();
          });
        },
      });
      return;
    }
    if (skillPicker) {
      const selected = new Set([...list(ui.draft.requiredSkills), ...list(ui.draft.recommendedSkills)]);
      api.ui.modal(`<header class="capability-modal-header"><div><h2>添加技能</h2><p>只显示已安装并启用的技能；选中后可在编辑页设为必需或建议。</p></div><button data-modal-close>×</button></header><div class="capability-modal-body expert-picker-list">${items.length ? items.map((item) => `<label class="capability-picker-item"><input type="checkbox" name="expertSkillIds" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.id)}</small></span></label>`).join('') : '<p class="capability-muted">还没有已启用技能，请先到技能中心安装。</p>'}</div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" data-expert-picker-apply="skill">应用</button></footer>`, {
        wide: true,
        onReady(element) {
          element.querySelector('[data-expert-picker-apply="skill"]')?.addEventListener('click', () => {
            const ids = [...element.querySelectorAll('input[name="expertSkillIds"]:checked')].map((input) => input.value);
            const previousRequired = new Set(ui.draft.requiredSkills);
            ui.draft.requiredSkills = ids.filter((id) => previousRequired.has(id));
            ui.draft.recommendedSkills = ids.filter((id) => !previousRequired.has(id));
            element.remove();
            render();
          });
        },
      });
      return;
    }
    const connectorIds = [...new Set([...list(ui.draft.requiredConnectors), ...list(ui.draft.recommendedConnectors)])];
    api.ui.modal(`<header class="capability-modal-header"><div><h2>添加工具</h2><p>可精确到 MCP 服务内的具体工具；未完成连接测试的服务暂时无法细分。</p></div><button data-modal-close>×</button></header><div class="capability-modal-body expert-tool-picker">${renderConnectorToolSelector({ scope: 'expert-editor', connectorIds, toolSelections: ui.draft.toolSelections, connectors: items })}</div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" data-expert-picker-apply="connector">应用</button></footer>`, {
      wide: true,
      onReady(element) {
        bindConnectorToolSelectors(element);
        element.querySelector('[data-expert-picker-apply="connector"]')?.addEventListener('click', () => {
          const selected = readConnectorToolSelection('expert-editor', element);
          const previousRequired = new Set(ui.draft.requiredConnectors);
          ui.draft.requiredConnectors = selected.connectorIds.filter((id) => previousRequired.has(id));
          ui.draft.recommendedConnectors = selected.connectorIds.filter((id) => !previousRequired.has(id));
          ui.draft.toolSelections = selected.toolSelections;
          element.remove();
          render();
        });
      },
    });
  }

  async function saveExpert(status) {
    const draft = syncDraftFromForm();
    if (!draft) return;
    ui.error = '';
    try {
      const effectiveStatus = status === 'current' ? draft.status || 'draft' : status;
      const preflight = localPreflight();
      if (effectiveStatus === 'enabled' && !preflight.ready) {
        ui.error = preflight.issues.join('；');
        render();
        return;
      }
      const result = await root.meteoDesktop.saveExpert({ ...draft, status: effectiveStatus });
      api.center.registry = result.registry;
      ui.mode = 'mine';
      ui.editingId = null;
      ui.draft = null;
      render();
      void syncExperts({ quiet: true });
    } catch (error) {
      ui.error = error?.message || String(error);
      render();
    }
  }

  async function changeStatus(id, status) {
    try {
      const result = await root.meteoDesktop.setExpertStatus({ id, status });
      api.center.registry = result.registry;
      render();
      void syncExperts({ quiet: true });
    } catch (error) {
      api.ui.error('无法更新专家状态', error?.message || String(error));
    }
  }

  async function syncExperts({ quiet = false } = {}) {
    if (ui.syncing) return;
    ui.syncing = true;
    if (!quiet) {
      ui.syncMessage = '正在同步专家…';
      render();
    }
    try {
      const result = await root.meteoDesktop.syncSkillHubExperts();
      api.center.registry = result.registry || api.center.registry;
      if (result.skipped) {
        ui.syncMessage = '当前为离线模式，个人专家已保存在本机。';
      } else if (result.conflicts?.length) {
        ui.syncMessage = `${result.conflicts.length} 个专家存在版本冲突，请选择保留本地或采用远程版本。`;
      } else if (result.errors?.length) {
        ui.syncMessage = `${result.errors.length} 个专家同步失败，本地内容不会丢失。`;
      } else {
        ui.syncMessage = `同步完成，共读取 ${Number(result.pulled || 0)} 个远程专家。`;
      }
    } catch (error) {
      ui.syncMessage = `同步失败：${error?.message || String(error)}`;
    } finally {
      ui.syncing = false;
      render();
    }
  }

  async function resolveConflict(id, resolution) {
    try {
      const result = await root.meteoDesktop.resolveExpertConflict({ id, resolution });
      api.center.registry = result.registry;
      ui.syncMessage = resolution === 'local' ? '已保留本地版本，正在重新上传。' : '已采用远程版本。';
      render();
      if (resolution === 'local') void syncExperts({ quiet: true });
    } catch (error) {
      api.ui.error('无法处理专家版本冲突', error?.message || String(error));
    }
  }

  function titlebarActions() {
    if (ui.mode === 'editor') {
      return `<div class="top-actions expert-top-actions"><button class="my-experts" data-expert-editor-cancel>取消</button>${ui.editingId ? `<button class="my-experts" data-expert-save="current">保存更改</button>` : '<button class="my-experts" data-expert-save="draft">保存草稿</button>'}<button class="my-experts primary" data-expert-save="enabled">保存并启用</button></div>`;
    }
    return `<div class="top-actions expert-top-actions">
      <label class="search-box"><span>${icon('search')}</span><input id="catalog-search" value="${escapeHtml(state.search)}" placeholder="${ui.mode === 'mine' ? '搜索我的专家' : '搜索专家名称或描述'}" /></label>
      <button class="my-experts" data-expert-sync ${ui.syncing ? 'disabled' : ''}>${icon('refresh')} ${ui.syncing ? '同步中' : '同步'}</button>
      <button class="my-experts ${ui.mode === 'mine' ? 'active' : ''}" data-expert-mine>${icon('star')} 我的专家</button>
      <button class="my-experts primary" data-expert-create>${icon('plus')} 创建专家</button>
    </div>`;
  }

  function detailActions(item) {
    if (item.kind === 'team') return '';
    return item.userManaged || item.source?.type === 'user'
      ? `<button class="expert-detail-manage" data-expert-edit="${escapeHtml(item.id)}">编辑</button>`
      : `<button class="expert-detail-manage" data-expert-duplicate="${escapeHtml(item.id)}">复制后编辑</button>`;
  }

  const originalTitlebarActions = renderCatalogTitlebarActions;
  renderCatalogTitlebarActions = function renderExpertTitlebarActions() {
    if (state.view !== 'catalog' || state.catalogTab !== 'experts') return originalTitlebarActions();
    return titlebarActions();
  };

  const originalCatalog = renderCatalogView;
  renderCatalogView = function renderExpertCatalog() {
    if (state.catalogTab !== 'experts') return originalCatalog();
    if (ui.mode === 'editor') return renderEditor();
    if (ui.mode === 'mine') return renderMine();
    return originalCatalog();
  };

  const originalBind = bindEvents;
  bindEvents = function bindExpertCenterEvents() {
    originalBind();
    document.querySelector('[data-expert-mine]')?.addEventListener('click', () => {
      ui.mode = ui.mode === 'mine' ? 'browse' : 'mine';
      state.search = '';
      render();
    });
    document.querySelectorAll('[data-expert-create]').forEach((button) => button.addEventListener('click', () => openEditor()));
    document.querySelector('[data-expert-sync]')?.addEventListener('click', () => void syncExperts());
    document.querySelector('[data-expert-editor-cancel]')?.addEventListener('click', () => {
      ui.mode = ui.editingId ? 'mine' : 'browse';
      ui.editingId = null;
      ui.draft = null;
      ui.error = '';
      render();
    });
    document.querySelectorAll('[data-expert-save]').forEach((button) => button.addEventListener('click', () => void saveExpert(button.dataset.expertSave)));
    document.querySelectorAll('[data-expert-pick]').forEach((button) => button.addEventListener('click', () => picker(button.dataset.expertPick)));
    document.querySelectorAll('[data-expert-remove-capability]').forEach((button) => button.addEventListener('click', () => {
      syncDraftFromForm();
      const type = button.dataset.expertRemoveCapability;
      const id = button.dataset.expertCapabilityId;
      if (type === 'skill') {
        ui.draft.requiredSkills = ui.draft.requiredSkills.filter((item) => item !== id);
        ui.draft.recommendedSkills = ui.draft.recommendedSkills.filter((item) => item !== id);
      } else if (type === 'workflow') {
        ui.draft.requiredWorkflows = ui.draft.requiredWorkflows.filter((item) => item !== id);
        ui.draft.recommendedWorkflows = ui.draft.recommendedWorkflows.filter((item) => item !== id);
      } else {
        ui.draft.requiredConnectors = ui.draft.requiredConnectors.filter((item) => item !== id);
        ui.draft.recommendedConnectors = ui.draft.recommendedConnectors.filter((item) => item !== id);
        delete ui.draft.toolSelections[id];
      }
      render();
    }));
    document.querySelectorAll('[data-expert-manage]').forEach((button) => button.addEventListener('click', () => {
      const item = managedExperts().find((expert) => expert.id === button.dataset.expertManageId);
      const action = button.dataset.expertManage;
      if (!item) return;
      if (action === 'edit') openEditor(item);
      else if (action === 'duplicate') openEditor(item, { duplicate: true });
      else void changeStatus(item.id, action);
    }));
    document.querySelectorAll('[data-expert-conflict]').forEach((button) => button.addEventListener('click', () => {
      void resolveConflict(button.dataset.expertConflictId, button.dataset.expertConflict);
    }));
    document.querySelectorAll('[data-expert-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = managedExperts().find((expert) => expert.id === button.dataset.expertEdit);
      if (item) openEditor(item);
    }));
    document.querySelectorAll('[data-expert-duplicate]').forEach((button) => button.addEventListener('click', () => {
      const item = allExperts().find((expert) => expert.id === button.dataset.expertDuplicate);
      if (item) openEditor(item, { duplicate: true });
    }));
  };

  root.MeteoMateExpertCenter = {
    ui,
    openEditor,
    detailActions,
  };

  void root.MeteoMateAccountReady.then(async (session) => {
    const ready = session.status === 'offline'
      || (session.status === 'authenticated' && !session.user?.mustChangePassword);
    if (!ready) return;
    await api.refresh({ rerender: false });
    if (state.customExperts?.length) {
      const result = await root.meteoDesktop.migrateExperts(state.customExperts);
      api.center.registry = result.registry;
      state.customExperts = [];
      saveState();
    }
    await syncExperts({ quiet: true });
    render();
  }).catch((error) => {
    console.error('无法初始化专家工作室', error);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
