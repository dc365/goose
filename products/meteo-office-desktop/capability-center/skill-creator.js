(function skillCreatorWorkbench(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const creator = {
    status: 'idle',
    drafts: [],
    activeDraft: null,
    activeFile: null,
    error: '',
  };

  const statusLabel = (status) => ({
    drafting: '编辑中',
    ready: '可安装',
    installed: '已安装',
  })[status] || status || '编辑中';

  const statusClass = (status) => ({ ready: 'ready', installed: 'installed' })[status] || 'drafting';

  function findDraft(id) {
    return creator.drafts.find((item) => item.id === id) || null;
  }

  async function refreshDrafts({ rerender = false } = {}) {
    creator.status = 'loading';
    creator.error = '';
    try {
      creator.drafts = await root.meteoDesktop.listSkillDrafts();
      creator.status = 'ready';
    } catch (error) {
      creator.status = 'error';
      creator.error = error?.message || String(error);
    }
    if (rerender) render();
    return creator.drafts;
  }

  async function ensureCreatorInstalled() {
    let installation = api.skillInstallation('skill-creator');
    if (installation?.enabled) return installation;
    if (installation && !installation.enabled) {
      const result = await root.meteoDesktop.setSkillEnabled({ id: installation.id, enabled: true });
      api.center.registry = result.registry;
      return result.installation;
    }
    const inspection = await root.meteoDesktop.inspectBundledSkill('skill-creator');
    const result = await root.meteoDesktop.installSkill({
      token: inspection.token,
      reportHash: inspection.report.reportHash,
      scope: 'user',
      replace: false,
    });
    api.center.registry = result.registry;
    return result.installation;
  }

  function ensureCreatorExpert() {
    const expertId = 'skill-creator-expert';
    let expert = state.customExperts.find((item) => item.id === expertId);
    if (expert) return expert;
    expert = {
      id: expertId,
      kind: 'expert',
      name: 'Skill Creator',
      owner: 'MeteoMate',
      category: '效率工具',
      avatar: '技',
      description: '通过对话创建、检查和完善符合 Agent Skills 标准的 Skill 包。',
      tags: ['Skill', '创建', '契约', '测试'],
      instruction: [
        '使用已安装的 skill-creator Skill，并把当前 Skill 草稿视为唯一工作区。',
        '先阅读 BRIEF.md，发现关键歧义时先询问用户；需求明确后，只修改 skill/ 目录。',
        '必须维护 SKILL.md、meteomate.json 和 tests/*.json，并明确触发场景、限制、输入输出、权限、连接器依赖和验证标准。',
        '不要直接安装、发布、移动草稿或访问草稿工作区之外的文件。',
        '完成后汇报文件树、风险、测试结果和需要人工确认的事项。',
      ].join('\n'),
      prompts: ['请根据 BRIEF.md 继续完善当前 Skill 草稿'],
      permissionProfile: 'workspace-approval',
      recommendedSkills: ['skill-creator'],
    };
    state.customExperts.push(expert);
    return expert;
  }

  function draftProject(task) {
    if (!task?.skillDraftId || !task.skillDraftRoot) return null;
    return {
      id: `skill-draft:${task.skillDraftId}`,
      name: 'Skill 草稿工作区',
      workspace: task.skillDraftRoot,
    };
  }

  const originalConversationProject = getConversationProject;
  getConversationProject = function getSkillCreatorConversationProject(task) {
    return draftProject(task) || originalConversationProject(task);
  };

  function existingTaskForDraft(id) {
    return state.tasks.find((task) => task.kind === 'skill-creator' && task.skillDraftId === id) || null;
  }

  function continuationPrompt(draft) {
    return [
      `请继续完善 Skill 草稿“${draft.displayName || draft.skillId}”。`,
      `草稿工作区：${draft.root}`,
      '先阅读 BRIEF.md 和 skill/ 中的现有文件。',
      '如需求仍有歧义先提问；否则修复校验或测试问题，并只修改 skill/ 目录。',
      '不要直接安装或发布，完成后总结本轮改动。',
    ].join('\n');
  }

  async function openConversation(draftResult, { autoSend = false } = {}) {
    const draft = draftResult.draft || draftResult;
    const existing = existingTaskForDraft(draft.id);
    if (existing) {
      existing.workspace = draft.root || existing.workspace;
      existing.skillDraftRoot = draft.root || existing.skillDraftRoot;
      existing.skillIds = ['skill-creator'];
      existing.updatedAt = Date.now();
      state.activeTaskId = existing.id;
      state.view = 'task';
      state.selectedExpertId = existing.expertId;
      saveState();
      render();
      return existing;
    }

    await ensureCreatorInstalled();
    const expert = ensureCreatorExpert();
    const prompt = draftResult.conversationPrompt || continuationPrompt(draft);
    const previousDraftSkillIds = [...(state.draftSkillIds || [])];
    const previousDraftConnectorIds = [...(state.draftConnectorIds || [])];
    state.draftSkillIds = ['skill-creator'];
    state.draftConnectorIds = [];
    const task = createTask(
      expert,
      prompt,
      'workspace-approval',
      modelSettings.providerId || '',
      modelSettings.modelId || ''
    );
    state.draftSkillIds = previousDraftSkillIds;
    state.draftConnectorIds = previousDraftConnectorIds;
    task.kind = 'skill-creator';
    task.title = `创建技能：${draft.displayName || draft.skillId}`;
    task.projectId = null;
    task.workspace = draft.root;
    task.skillDraftId = draft.id;
    task.skillDraftRoot = draft.root;
    task.skillIds = ['skill-creator'];
    task.connectorIds = [];
    task.expectedOutputs = ['SKILL.md', 'meteomate.json', 'tests/basic.json', 'Skill ZIP'];
    task.skillCreator = {
      draftId: draft.id,
      skillId: draft.skillId,
      displayName: draft.displayName,
    };
    state.activeTaskId = task.id;
    state.selectedExpertId = expert.id;
    state.view = 'task';
    saveState();
    render();
    window.setTimeout(() => {
      const textarea = document.getElementById('task-prompt');
      if (!textarea) return;
      textarea.value = prompt;
      textarea.focus();
      if (autoSend) void sendTaskMessage();
    }, 0);
    return task;
  }

  function wizard() {
    const connectorOptions = api.connectorCatalog()
      .filter((item) => item.id !== 'goose-runtime')
      .map((item) => `<label class="skill-creator-checkbox"><input type="checkbox" name="creatorConnectorIds" value="${escapeHtml(item.id)}"/><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></label>`)
      .join('');
    const projectOptions = state.projects
      .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`)
      .join('');
    api.ui.modal(`<header class="capability-modal-header"><div><h2>AI 创建技能</h2><p>先形成可审查的 Brief，再进入 Skill Creator 对话和草稿工作台</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body skill-creator-wizard">
        <section class="skill-creator-form-grid">
          <label><span>显示名称 *</span><input id="creator-display-name" placeholder="例如：气象过程复盘"/></label>
          <label><span>Skill ID</span><input id="creator-skill-id" placeholder="留空自动生成，例如 weather-review"/></label>
          <label><span>分类</span><input id="creator-category" value="气象业务"/></label>
          <label><span>关联项目</span><select id="creator-project"><option value="">不绑定项目</option>${projectOptions}</select></label>
          <label class="wide"><span>要解决的问题 *</span><textarea id="creator-goal" placeholder="描述需要反复完成的专业任务，以及希望 Skill 带来的结果"></textarea></label>
          <label class="wide"><span>什么时候触发</span><textarea id="creator-triggers" placeholder="例如：用户要求复盘一次暴雨过程、比较预报与实况时"></textarea></label>
          <label class="wide"><span>不应触发的场景</span><textarea id="creator-non-goals" placeholder="例如：缺少实况资料、只询问普通天气时"></textarea></label>
          <label><span>输入</span><textarea id="creator-inputs" placeholder="数据、文件、参数、上下文"></textarea></label>
          <label><span>输出</span><textarea id="creator-outputs" placeholder="报告、JSON、Word、图表等"></textarea></label>
          <label class="wide"><span>验收标准</span><textarea id="creator-success" placeholder="如何判断 Skill 已正确完成任务"></textarea></label>
          <label class="wide"><span>示例请求</span><input id="creator-example" placeholder="例如：复盘 7 月 15 日华南暴雨过程并生成报告"/></label>
        </section>
        <section class="skill-creator-requirements"><div><h3>依赖连接器</h3><p>这里声明最终 Skill 的依赖，不会把密钥写入草稿。</p><div class="skill-creator-connector-grid">${connectorOptions || '<p class="capability-muted">当前没有可选择的连接器。</p>'}</div></div>
          <div><h3>权限边界</h3><label><input type="checkbox" id="creator-read" checked/> 读取项目文件</label><label><input type="checkbox" id="creator-write"/> 写入成果物</label><label><input type="checkbox" id="creator-network"/> 访问网络</label><label><input type="checkbox" id="creator-shell"/> 执行 Shell 或脚本</label><label id="creator-network-domains-field" hidden><span>允许域名（每行一个）</span><textarea id="creator-network-domains" placeholder="weather-api.internal"></textarea></label></div>
        </section>
        <div class="capability-error-block" id="creator-wizard-error" hidden></div>
      </div>
      <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="create-skill-draft">创建草稿并开始对话</button></footer>`, {
      wide: true,
      onReady(element) {
        const network = element.querySelector('#creator-network');
        const domains = element.querySelector('#creator-network-domains-field');
        network.addEventListener('change', () => { domains.hidden = !network.checked; });
        element.querySelector('#create-skill-draft').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const errorBox = element.querySelector('#creator-wizard-error');
          button.disabled = true;
          button.textContent = '创建中…';
          errorBox.hidden = true;
          try {
            const projectId = element.querySelector('#creator-project').value || null;
            const project = state.projects.find((item) => item.id === projectId) || null;
            const result = await root.meteoDesktop.createSkillDraft({
              displayName: element.querySelector('#creator-display-name').value,
              skillId: element.querySelector('#creator-skill-id').value,
              category: element.querySelector('#creator-category').value,
              projectId,
              projectName: project?.name || '',
              goal: element.querySelector('#creator-goal').value,
              triggers: element.querySelector('#creator-triggers').value,
              nonGoals: element.querySelector('#creator-non-goals').value,
              inputs: element.querySelector('#creator-inputs').value,
              outputs: element.querySelector('#creator-outputs').value,
              successCriteria: element.querySelector('#creator-success').value,
              examplePrompt: element.querySelector('#creator-example').value,
              connectorIds: [...element.querySelectorAll('input[name="creatorConnectorIds"]:checked')].map((input) => input.value),
              permissions: {
                filesystemRead: element.querySelector('#creator-read').checked,
                filesystemWrite: element.querySelector('#creator-write').checked,
                network: network.checked,
                networkDomains: element.querySelector('#creator-network-domains').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                shell: element.querySelector('#creator-shell').checked,
              },
            });
            await refreshDrafts();
            element.remove();
            await openConversation(result, { autoSend: true });
          } catch (error) {
            button.disabled = false;
            button.textContent = '创建草稿并开始对话';
            errorBox.hidden = false;
            errorBox.textContent = error?.message || String(error);
          }
        });
      },
    });
  }

  async function dashboard() {
    await refreshDrafts();
    const content = creator.drafts.length
      ? creator.drafts.map((draft) => `<article class="skill-draft-card"><div><span class="skill-draft-status ${statusClass(draft.status)}">${escapeHtml(statusLabel(draft.status))}</span><h3>${escapeHtml(draft.displayName || draft.skillId)}</h3><p><code>${escapeHtml(draft.skillId || '')}</code> · ${escapeHtml(draft.version || '0.1.0')}</p><small>${formatDateTime(draft.updatedAt)}</small></div><div class="skill-draft-card-actions"><button class="ghost-button compact" data-open-skill-draft="${escapeHtml(draft.id)}">查看草稿</button><button class="primary-button compact" data-continue-skill-draft="${escapeHtml(draft.id)}">继续对话</button></div></article>`).join('')
      : '<div class="large-empty"><span>技</span><h2>还没有 Skill 草稿</h2><p>通过对话生成、检查、测试并安装自己的 Skill。</p></div>';
    api.ui.modal(`<header class="capability-modal-header"><div><h2>我的 Skill 草稿</h2><p>草稿保存在 MeteoMate 本地隔离工作区，不会自动安装或发布</p></div><button data-modal-close>×</button></header><div class="capability-modal-body skill-draft-dashboard">${content}</div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>关闭</button><button class="primary-button" id="new-skill-draft">新建 Skill</button></footer>`, {
      wide: true,
      onReady(element) {
        element.querySelector('#new-skill-draft').addEventListener('click', () => { element.remove(); wizard(); });
        element.querySelectorAll('[data-open-skill-draft]').forEach((button) => button.addEventListener('click', () => { element.remove(); void manager(button.dataset.openSkillDraft); }));
        element.querySelectorAll('[data-continue-skill-draft]').forEach((button) => button.addEventListener('click', async () => {
          const id = button.dataset.continueSkillDraft;
          element.remove();
          const detail = await root.meteoDesktop.getSkillDraft(id);
          await openConversation(detail);
        }));
      },
    });
  }

  function validationMarkup(detail) {
    if (detail.validationError) return `<div class="skill-validation-summary failed"><strong>基础校验失败</strong><p>${escapeHtml(detail.validationError)}</p></div>`;
    const inspection = detail.inspection;
    const tests = detail.tests;
    return `<div class="skill-validation-summary ${detail.ready ? 'ready' : 'warning'}"><strong>${detail.ready ? '草稿已达到可安装条件' : '草稿仍需完善'}</strong><p>风险：${escapeHtml(api.ui.riskLabel(inspection?.risk?.level || 'low'))} · 测试 ${tests?.summary?.passed || 0}/${tests?.summary?.total || 0} · 质量检查 ${tests?.summary?.qualityPassed || 0}/${tests?.summary?.qualityTotal || 0}</p></div>
      ${(inspection?.warnings || []).length ? `<div class="skill-validation-list"><h4>建议</h4><ul>${inspection.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
      ${(tests?.quality || []).length ? `<div class="skill-validation-list"><h4>质量检查</h4>${tests.quality.map((item) => `<div class="skill-test-row ${item.passed ? 'passed' : 'failed'}"><span>${item.passed ? '✓' : '!'}</span><strong>${escapeHtml(item.label)}</strong></div>`).join('')}</div>` : ''}
      ${(tests?.cases || []).length ? `<div class="skill-validation-list"><h4>测试用例</h4>${tests.cases.map((item) => `<details class="skill-test-case ${item.passed ? 'passed' : 'failed'}"><summary>${item.passed ? '✓' : '!'} ${escapeHtml(item.name)}</summary>${item.failures.length ? `<ul>${item.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>` : '<p>通过静态契约检查。</p>'}</details>`).join('')}</div>` : ''}`;
  }

  async function loadEditorFile(element, draftId, filePath) {
    const editor = element.querySelector('#skill-draft-editor');
    const save = element.querySelector('#save-skill-draft-file');
    editor.value = '读取中…';
    editor.disabled = true;
    save.disabled = true;
    try {
      const file = await root.meteoDesktop.readSkillDraftFile({ id: draftId, path: filePath });
      creator.activeFile = filePath;
      editor.value = file.content;
      editor.disabled = false;
      save.disabled = false;
      element.querySelector('#skill-draft-file-name').textContent = filePath;
      element.querySelectorAll('[data-draft-file]').forEach((button) => button.classList.toggle('active', button.dataset.draftFile === filePath));
    } catch (error) {
      editor.value = `无法读取文件：${error?.message || error}`;
    }
  }

  function renderManager(detail) {
    creator.activeDraft = detail;
    const draft = detail.draft;
    const files = detail.files || [];
    const firstFile = files.find((file) => file.path === 'skill/SKILL.md') || files.find((file) => file.editable) || null;
    const element = api.ui.modal(`<header class="capability-modal-header"><div><h2>${escapeHtml(draft.displayName || draft.skillId)}</h2><p><code>${escapeHtml(draft.skillId || '')}</code> · ${escapeHtml(draft.version || '0.1.0')} · ${escapeHtml(statusLabel(draft.status))}</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body skill-draft-manager"><aside><div class="skill-draft-manager-heading"><strong>草稿文件</strong><small>${files.length} 个</small></div>${files.map((file) => `<button class="skill-draft-file ${file.editable ? '' : 'readonly'}" data-draft-file="${escapeHtml(file.path)}" ${file.editable ? '' : 'disabled'}><span>${escapeHtml(file.path)}</span><small>${file.size} B</small></button>`).join('')}</aside><main><div class="skill-draft-editor-heading"><strong id="skill-draft-file-name">${escapeHtml(firstFile?.path || '选择文件')}</strong><button class="primary-button compact" id="save-skill-draft-file" ${firstFile ? '' : 'disabled'}>保存文件</button></div><textarea id="skill-draft-editor" spellcheck="false" ${firstFile ? '' : 'disabled'}></textarea></main><section class="skill-draft-validation">${validationMarkup(detail)}</section></div>
      <footer class="capability-modal-footer skill-draft-actions"><button class="ghost-button" id="open-skill-draft-folder">打开目录</button><button class="ghost-button" id="continue-skill-draft">继续 AI 对话</button><button class="ghost-button" id="validate-skill-draft">重新校验</button><button class="ghost-button" id="export-skill-draft">导出 ZIP</button><button class="danger-text-button" id="delete-skill-draft">删除草稿</button><span class="capability-modal-spacer"></span><button class="primary-button" id="install-skill-draft">安装 Skill</button></footer>`, {
      wide: true,
      onReady(modalElement) {
        modalElement.querySelectorAll('[data-draft-file]').forEach((button) => button.addEventListener('click', () => void loadEditorFile(modalElement, draft.id, button.dataset.draftFile)));
        if (firstFile) void loadEditorFile(modalElement, draft.id, firstFile.path);
        modalElement.querySelector('#save-skill-draft-file').addEventListener('click', async (event) => {
          if (!creator.activeFile) return;
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = '保存中…';
          try {
            const updated = await root.meteoDesktop.writeSkillDraftFile({ id: draft.id, path: creator.activeFile, content: modalElement.querySelector('#skill-draft-editor').value });
            modalElement.remove();
            renderManager(updated);
          } catch (error) {
            button.disabled = false;
            button.textContent = '保存文件';
            api.ui.error('保存失败', error?.message || String(error));
          }
        });
        modalElement.querySelector('#open-skill-draft-folder').addEventListener('click', () => root.meteoDesktop.openSkillDraft(draft.id));
        modalElement.querySelector('#continue-skill-draft').addEventListener('click', async () => { modalElement.remove(); await openConversation(detail); });
        modalElement.querySelector('#validate-skill-draft').addEventListener('click', async (event) => {
          event.currentTarget.disabled = true;
          const refreshed = await root.meteoDesktop.validateSkillDraft(draft.id);
          modalElement.remove();
          renderManager(refreshed);
        });
        modalElement.querySelector('#export-skill-draft').addEventListener('click', async (event) => {
          event.currentTarget.disabled = true;
          try {
            const result = await root.meteoDesktop.exportSkillDraft({ id: draft.id });
            event.currentTarget.disabled = false;
            if (!result.canceled) api.ui.modal(`<header class="capability-modal-header"><div><h2>Skill 已导出</h2><p>ZIP 可用于备份、分享或重新导入</p></div><button data-modal-close>×</button></header><div class="capability-modal-body"><code>${escapeHtml(result.path)}</code></div><footer class="capability-modal-footer"><button class="primary-button" data-modal-close>完成</button></footer>`);
          } catch (error) {
            event.currentTarget.disabled = false;
            api.ui.error('导出失败', error?.message || String(error));
          }
        });
        modalElement.querySelector('#install-skill-draft').addEventListener('click', () => installDialog(detail, modalElement));
        modalElement.querySelector('#delete-skill-draft').addEventListener('click', async () => {
          if (!confirm(`确定删除 Skill 草稿“${draft.displayName || draft.skillId}”吗？`)) return;
          await root.meteoDesktop.deleteSkillDraft(draft.id);
          state.tasks = state.tasks.filter((task) => task.skillDraftId !== draft.id);
          if (state.activeTaskId && !state.tasks.some((task) => task.id === state.activeTaskId)) state.activeTaskId = null;
          saveState();
          modalElement.remove();
          await dashboard();
        });
      },
    });
    return element;
  }

  async function manager(id) {
    api.ui.modal('<div class="capability-modal-loading">正在读取 Skill 草稿…</div>');
    try {
      const detail = await root.meteoDesktop.getSkillDraft(id);
      renderManager(detail);
    } catch (error) {
      api.ui.error('无法读取 Skill 草稿', error?.message || String(error));
    }
  }

  function installDialog(detail, previousElement) {
    const draft = detail.draft;
    const projectOptions = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
    previousElement.remove();
    api.ui.modal(`<header class="capability-modal-header"><div><h2>安装 ${escapeHtml(draft.displayName || draft.skillId)}</h2><p>${detail.ready ? '草稿已通过当前校验' : '草稿仍有未通过的检查'}</p></div><button data-modal-close>×</button></header><div class="capability-modal-body"><dl class="capability-summary-list"><div><dt>Skill ID</dt><dd>${escapeHtml(draft.skillId)}</dd></div><div><dt>版本</dt><dd>${escapeHtml(draft.version || '0.1.0')}</dd></div><div><dt>状态</dt><dd>${detail.ready ? '可安装' : '需确认'}</dd></div></dl><label>安装范围<select id="creator-install-scope"><option value="user">当前用户</option>${state.projects.length ? '<option value="project">指定项目</option>' : ''}</select></label><label id="creator-install-project-field" hidden>项目<select id="creator-install-project">${projectOptions}</select></label><label><input type="checkbox" id="creator-install-replace"/> 替换已有版本</label>${detail.ready ? '' : '<label class="skill-creator-override"><input type="checkbox" id="creator-install-override"/> 我已审查问题，忽略非严重校验失败</label>'}<div class="capability-error-block" id="creator-install-error" hidden></div></div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="confirm-creator-install">确认安装</button></footer>`, {
      onReady(element) {
        const scope = element.querySelector('#creator-install-scope');
        const projectField = element.querySelector('#creator-install-project-field');
        scope.addEventListener('change', () => { projectField.hidden = scope.value !== 'project'; });
        element.querySelector('#confirm-creator-install').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const projectId = element.querySelector('#creator-install-project')?.value || null;
          const project = state.projects.find((item) => item.id === projectId) || null;
          button.disabled = true;
          button.textContent = '安装中…';
          try {
            const result = await root.meteoDesktop.installSkillDraft({
              id: draft.id,
              scope: scope.value,
              projectId: scope.value === 'project' ? projectId : null,
              workspace: scope.value === 'project' ? project?.workspace || null : null,
              replace: element.querySelector('#creator-install-replace').checked,
              overrideValidation: Boolean(element.querySelector('#creator-install-override')?.checked),
            });
            api.center.registry = result.registry;
            api.syncProjectCapability('skills', result.installation.skillId, result.installation.projectIds || []);
            await refreshDrafts();
            element.remove();
            render();
          } catch (error) {
            button.disabled = false;
            button.textContent = '确认安装';
            const errorBox = element.querySelector('#creator-install-error');
            errorBox.hidden = false;
            errorBox.textContent = error?.message || String(error);
          }
        });
      },
    });
  }

  function creatorPanel(task) {
    const draft = findDraft(task.skillDraftId) || {
      id: task.skillDraftId,
      displayName: task.skillCreator?.displayName || task.title,
      skillId: task.skillCreator?.skillId || '',
      status: 'drafting',
    };
    return `<section class="skill-creator-task-panel"><div class="skill-creator-task-copy"><span class="skill-draft-status ${statusClass(draft.status)}">${escapeHtml(statusLabel(draft.status))}</span><div><strong>${escapeHtml(draft.displayName || draft.skillId)}</strong><small><code>${escapeHtml(draft.skillId || '')}</code> · AI 对话只修改草稿工作区</small></div></div><div class="skill-creator-task-actions"><button class="ghost-button compact" data-skill-draft-action="refresh" data-skill-draft-id="${escapeHtml(draft.id)}">刷新校验</button><button class="ghost-button compact" data-skill-draft-action="open-folder" data-skill-draft-id="${escapeHtml(draft.id)}">打开目录</button><button class="primary-button compact" data-skill-draft-action="manage" data-skill-draft-id="${escapeHtml(draft.id)}">草稿工作台</button></div></section>`;
  }

  const originalTaskView = renderTaskView;
  renderTaskView = function renderSkillCreatorTask(options) {
    const html = originalTaskView(options);
    const task = getActiveTask();
    if (task?.kind !== 'skill-creator' || !task.skillDraftId) return html;
    return html.replace('<div class="conversation-scroll">', `<div class="conversation-scroll">${creatorPanel(task)}`);
  };

  const originalCatalogView = renderCatalogView;
  renderCatalogView = function renderSkillCreatorCatalog() {
    let html = originalCatalogView();
    if (state.catalogTab !== 'skills') return html;
    const draftButton = `<button class="my-experts" id="skill-creator-drafts">草稿 ${creator.drafts.length}</button>`;
    html = html.replace('<div class="capability-add-menu">', `${draftButton}<div class="capability-add-menu">`);
    return html;
  };

  const originalBindEvents = bindEvents;
  bindEvents = function bindSkillCreatorEvents() {
    originalBindEvents();
    document.getElementById('skill-creator-drafts')?.addEventListener('click', () => void dashboard());
    document.querySelectorAll('[data-skill-draft-action]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.skillDraftId;
      const action = button.dataset.skillDraftAction;
      if (action === 'manage') return void manager(id);
      if (action === 'open-folder') return void root.meteoDesktop.openSkillDraft(id);
      if (action === 'refresh') {
        button.disabled = true;
        try {
          await root.meteoDesktop.validateSkillDraft(id);
          await refreshDrafts({ rerender: true });
        } catch (error) {
          api.ui.error('校验失败', error?.message || String(error));
        }
      }
    }));
  };

  api.skills.launchCreator = wizard;
  api.skillCreator = {
    state: creator,
    wizard,
    dashboard,
    manager,
    refreshDrafts,
    openConversation,
  };

  void refreshDrafts({ rerender: false }).then(() => {
    if (state.catalogTab === 'skills' || getActiveTask()?.kind === 'skill-creator') render();
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
