(function capabilityCenterSkills(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;
  const { modal, error, projectOptions, riskLabel } = api.ui;

  const selectedProjects = (element) => [...element.querySelectorAll('input[name="projectIds"]:checked')].map((input) => input.value);
  const riskBadge = (report) => `<span class="capability-risk-badge risk-${escapeHtml(report.risk?.level || 'low')}">${escapeHtml(riskLabel(report.risk?.level || 'low'))}</span>`;

  async function importSkill(kind) {
    const source = kind === 'directory' ? await root.meteoDesktop.chooseSkillDirectory() : await root.meteoDesktop.chooseSkillFile();
    if (!source) return;
    modal('<div class="capability-modal-loading">正在隔离检查 Skill…</div>');
    try {
      inspect(await root.meteoDesktop.inspectSkill(source));
    } catch (cause) {
      error('Skill 检查失败', cause?.message || String(cause));
    }
  }

  function uploadSkill() {
    modal(`<header class="capability-modal-header"><div><h2>上传技能</h2><p>选择技能包或本地技能目录，安装前会先进行隔离检查</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body skill-upload-options">
        <button type="button" data-skill-upload-kind="file">${icon('file')}<span><strong>选择技能包</strong><small>支持 ZIP 或单个 SKILL.md</small></span>${icon('chevron')}</button>
        <button type="button" data-skill-upload-kind="directory">${icon('folder')}<span><strong>选择技能目录</strong><small>选择包含 SKILL.md 的完整目录</small></span>${icon('chevron')}</button>
      </div>
      <footer class="capability-modal-footer"><span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button></footer>`, {
      onReady(element) {
        element.querySelectorAll('[data-skill-upload-kind]').forEach((button) => {
          button.addEventListener('click', () => {
            const kind = button.dataset.skillUploadKind;
            element.remove();
            void importSkill(kind);
          });
        });
      },
    });
  }

  async function inspectBundled(id) {
    modal('<div class="capability-modal-loading">正在检查随产品提供的 Skill…</div>');
    try {
      inspect(await root.meteoDesktop.inspectBundledSkill(id));
    } catch (cause) {
      error('无法读取 Skill', cause?.message || String(cause));
    }
  }

  function inspect(inspection) {
    const report = inspection.report;
    const findings = report.risk?.findings || [];
    const signedSource = inspection.remote?.signatureVerified
      ? `<span class="skillhub-signature-ok">✓ SkillHub 签名已验证 · ${escapeHtml(inspection.remote.keyId || '')}</span>`
      : '';
    modal(`<header class="capability-modal-header"><div><h2>检查 Skill</h2><p>${escapeHtml(report.skill.displayName)} · ${escapeHtml(report.skill.version)}</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body capability-inspection-grid"><section><div class="capability-title-row"><h3>${escapeHtml(report.skill.displayName)}</h3>${riskBadge(report)}</div><p>${escapeHtml(report.skill.description)}</p>${signedSource}
        <dl class="capability-summary-list"><div><dt>标准名称</dt><dd>${escapeHtml(report.skill.id)}</dd></div><div><dt>文件</dt><dd>${report.files.length} 个 · ${Math.ceil(report.totalBytes / 1024)} KB</dd></div><div><dt>完整性</dt><dd><code>${escapeHtml(report.integrity.slice(0, 18))}…</code></dd></div><div><dt>自动安装</dt><dd>${report.autoInstallEligible ? '符合低风险条件' : '需要人工确认'}</dd></div></dl>
        <h4>权限推断</h4><div class="capability-permission-tags"><span>读取文件</span>${report.risk.permissions.filesystemWrite ? '<span class="warning">写入文件</span>' : ''}${report.risk.permissions.shell ? '<span class="warning">执行脚本</span>' : ''}${report.risk.permissions.network ? '<span class="warning">访问网络</span>' : ''}${report.risk.permissions.hooks ? '<span class="danger">Hook</span>' : ''}</div>
        ${(report.warnings || []).length ? `<h4>建议</h4><ul>${report.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${findings.length ? `<h4>扫描发现</h4><ul>${findings.slice(0, 15).map((item) => `<li><strong>${escapeHtml(item.file)}</strong>：${escapeHtml(item.message)}</li>`).join('')}</ul>` : ''}</section>
        <section class="capability-file-list"><h4>文件清单</h4>${report.files.slice(0, 100).map((file) => `<div><span>${escapeHtml(file.path)}</span><small>${file.size} B</small></div>`).join('')}</section></div>
      <footer class="capability-modal-footer capability-install-footer"><label>安装范围<select id="skill-install-scope"><option value="user">当前用户</option>${state.projects.length ? '<option value="project">指定项目</option>' : ''}</select></label><label id="skill-project-field" hidden>项目<select id="skill-install-project">${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}</select></label><label><input type="checkbox" id="skill-install-replace"/> 替换已有版本</label><span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="confirm-skill-install">确认安装</button></footer>`, {
      wide: true,
      onReady(element) {
        const scope = element.querySelector('#skill-install-scope');
        const projectField = element.querySelector('#skill-project-field');
        scope.addEventListener('change', () => { projectField.hidden = scope.value !== 'project'; });
        element.querySelector('#confirm-skill-install').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = '安装中…';
          try {
            const projectId = element.querySelector('#skill-install-project')?.value || null;
            const project = state.projects.find((item) => item.id === projectId) || null;
            const result = await root.meteoDesktop.installSkill({ token: inspection.token, reportHash: report.reportHash, scope: scope.value, projectId, workspace: project?.workspace || null, replace: element.querySelector('#skill-install-replace').checked });
            api.center.registry = result.registry;
            api.syncProjectCapability('skills', result.installation.skillId, result.installation.projectIds || []);
            if (inspection.remote) {
              void root.meteoDesktop.reportSkillHubInstallation({
                skillId: inspection.remote.skillId,
                version: inspection.remote.version,
                scope: scope.value,
                projectId: scope.value === 'project' ? projectId : null,
              }).catch(() => {});
            }
            element.remove();
            render();
          } catch (cause) {
            button.disabled = false;
            button.textContent = '确认安装';
            element.querySelector('.capability-modal-body').insertAdjacentHTML('afterbegin', `<div class="capability-error-block">${escapeHtml(cause?.message || String(cause))}</div>`);
          }
        });
      },
    });
  }

  function manage(item) {
    const installation = item.installation;
    if (!installation && item.bundled) return void inspectBundled(item.id);
    if (!installation) return error('尚未提供', '该技能仍处于规划阶段，后续可通过 SkillHub 或上传包安装。');
    const managedNotice = installation.managedByPolicy ? '<div class="capability-error-block">这是组织默认 Skill。策略生效期间保持启用，不能关闭或卸载。</div>' : '';
    modal(`<header class="capability-modal-header"><div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.id)} · ${escapeHtml(item.version)}</p></div><button data-modal-close>×</button></header><div class="capability-modal-body">${managedNotice}<div class="capability-title-row"><p>${escapeHtml(item.description)}</p>${item.risk ? riskBadge({ risk: item.risk }) : ''}</div><dl class="capability-summary-list"><div><dt>状态</dt><dd>${installation.enabled ? '已启用' : '已关闭'}${installation.managedByPolicy ? ' · 组织默认' : ''}</dd></div><div><dt>范围</dt><dd>${installation.scope === 'project' ? '项目' : '当前用户'}</dd></div><div><dt>来源</dt><dd>${escapeHtml(installation.source?.type || 'local')}</dd></div><div><dt>安装路径</dt><dd><code>${escapeHtml(installation.installPath)}</code></dd></div></dl><h4>用于项目</h4><div class="capability-project-list">${projectOptions(installation.projectIds || [])}</div>${(installation.warnings || []).length ? `<h4>安装建议</h4><ul>${installation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}</div>
      <footer class="capability-modal-footer"><button class="ghost-button" id="open-skill-directory">打开目录</button>${installation.managedByPolicy ? '' : `<button class="ghost-button" id="toggle-skill">${installation.enabled ? '关闭技能' : '启用技能'}</button><button class="danger-text-button" id="uninstall-skill">卸载</button>`}<span class="capability-modal-spacer"></span><button class="primary-button" id="save-skill-projects">保存项目绑定</button></footer>`, {
      wide: true,
      onReady(element) {
        element.querySelector('#open-skill-directory').addEventListener('click', () => root.meteoDesktop.openCapabilityPath(installation.installPath));
        element.querySelector('#toggle-skill')?.addEventListener('click', async () => { const result = await root.meteoDesktop.setSkillEnabled({ id: installation.id, enabled: !installation.enabled }); api.center.registry = result.registry; element.remove(); render(); });
        element.querySelector('#uninstall-skill')?.addEventListener('click', async () => { if (!confirm(`确定卸载“${item.name}”吗？`)) return; const result = await root.meteoDesktop.uninstallSkill(installation.id); api.center.registry = result.registry; api.syncProjectCapability('skills', item.id, []); element.remove(); render(); });
        element.querySelector('#save-skill-projects').addEventListener('click', async () => { const projectIds = selectedProjects(element); const result = await root.meteoDesktop.updateSkillProjects({ id: installation.id, projectIds }); api.center.registry = result.registry; api.syncProjectCapability('skills', item.id, projectIds); element.remove(); render(); });
      },
    });
  }

  async function launchCreator() {
    let installation = api.skillInstallation('skill-creator');
    if (!installation) {
      try {
        const inspection = await root.meteoDesktop.inspectBundledSkill('skill-creator');
        const result = await root.meteoDesktop.installSkill({ token: inspection.token, reportHash: inspection.report.reportHash, scope: 'user', replace: false });
        api.center.registry = result.registry;
        installation = result.installation;
      } catch (cause) {
        return error('无法启用 Skill Creator', cause?.message || String(cause));
      }
    }
    const expertId = 'skill-creator-expert';
    if (!state.customExperts.some((item) => item.id === expertId)) state.customExperts.push({ id: expertId, kind: 'expert', name: 'Skill Creator', owner: 'MeteoMate', category: '效率工具', avatar: '技', description: '通过对话创建符合 Agent Skills 标准的 Skill 包。', tags: ['Skill', '创建', '契约'], instruction: '使用已安装的 skill-creator Skill。先澄清目标、触发条件、输入输出、权限、工具依赖和验收标准，再在用户指定的草稿目录生成文件。未经确认不要直接安装。', prompts: ['请帮我创建一个可以实现「……」的 Skill'], permissionProfile: 'workspace-approval', recommendedSkills: ['skill-creator'] });
    state.draftSkillIds = ['skill-creator'];
    openExpert(expertId);
    setTimeout(() => { const textarea = document.getElementById('task-prompt'); if (textarea) { textarea.value = '请帮我创建一个可以实现「……」的 Skill。先询问我需求、触发条件、输入输出、依赖工具、权限和验收标准，再生成草稿。'; textarea.focus(); } }, 0);
  }

  api.skills = { importSkill, uploadSkill, inspectBundled, inspect, manage, launchCreator };
})(typeof globalThis !== 'undefined' ? globalThis : window);
