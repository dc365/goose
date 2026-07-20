(function skillHubDialogs(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const { connect, loadRemoteSkills, loadManagedSkills, list } = skillHub;
  const visibilityLabels = { private: '仅自己', organization: '当前组织', public: '全体用户' };
  const statusLabels = { draft: '草稿', published: '已发布', deprecated: '已弃用' };

  function settingsDialog() {
    const settings = hub.settings || { baseUrl: 'http://127.0.0.1:8088', requireSignature: true };
    api.ui.modal(`<header class="capability-modal-header"><div><h2>SkillHub 设置</h2><p>当前账户使用登录会话连接单位内网 SkillHub</p></div><button data-modal-close>×</button></header><div class="capability-modal-body skillhub-settings-form"><div class="skillhub-connection-info"><strong>服务器</strong><span>${escapeHtml(
      settings.baseUrl || ''
    )}</span></div><label><input type="checkbox" id="skillhub-require-signature" ${
      settings.requireSignature !== false ? 'checked' : ''
    }/> 安装前必须验证 Ed25519 签名</label><div class="skillhub-connection-info"><strong>当前用户</strong><span>${
      hub.identity?.id || hub.identity?.subject
        ? `${escapeHtml(hub.identity.displayName || hub.identity.name || hub.identity.username || hub.identity.subject)} · ${escapeHtml(hub.identity.role)}`
        : '离线或未登录'
    }</span></div><div class="capability-error-block" id="skillhub-settings-result" hidden></div></div><footer class="capability-modal-footer"><button class="ghost-button" id="skillhub-test-connection">测试连接</button><span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="skillhub-save-settings">保存</button></footer>`, {
      onReady(element) {
        const resultBox = element.querySelector('#skillhub-settings-result');
        const values = () => ({
          requireSignature: element.querySelector('#skillhub-require-signature').checked,
        });
        element.querySelector('#skillhub-test-connection').addEventListener('click', async (event) => {
          event.currentTarget.disabled = true;
          try {
            hub.settings = await root.meteoDesktop.saveSkillHubSettings(values());
            const result = await root.meteoDesktop.testSkillHub();
            hub.identity = result.identity;
            hub.status = result.ok ? 'ready' : 'error';
            resultBox.hidden = false;
            resultBox.classList.toggle('success', Boolean(result.ok));
            resultBox.textContent = result.ok ? `连接成功，耗时 ${result.durationMs} ms` : '连接未通过';
          } catch (error) {
            resultBox.hidden = false;
            resultBox.classList.remove('success');
            resultBox.textContent = error?.message || String(error);
          } finally {
            event.currentTarget.disabled = false;
          }
        });
        element.querySelector('#skillhub-save-settings').addEventListener('click', async (event) => {
          event.currentTarget.disabled = true;
          try {
            hub.settings = await root.meteoDesktop.saveSkillHubSettings(values());
            element.remove();
            await connect({ rerender: false });
            if (hub.view === 'skillhub') await loadRemoteSkills();
            else render();
          } catch (error) {
            event.currentTarget.disabled = false;
            resultBox.hidden = false;
            resultBox.textContent = error?.message || String(error);
          }
        });
      },
    });
  }

  async function publishDraftDialog() {
    const drafts = await root.meteoDesktop.listSkillDrafts();
    if (!drafts.length) return api.ui.error('没有可发布草稿', '请先通过 Skill Creator 创建一个 Skill 草稿。');
    api.ui.modal(`<header class="capability-modal-header"><div><h2>发布 Skill 草稿</h2><p>上传为不可变版本，并由 SkillHub 签名</p></div><button data-modal-close>×</button></header><div class="capability-modal-body skillhub-publish-form"><label><span>Skill 草稿</span><select id="skillhub-publish-draft-id">${drafts
      .map(
        (draft) => `<option value="${escapeHtml(draft.id)}">${escapeHtml(
          draft.displayName || draft.skillId
        )} · ${escapeHtml(draft.version || '0.1.0')}</option>`
      )
      .join('')}</select></label><label><span>可见范围</span><select id="skillhub-publish-visibility"><option value="private">仅自己</option><option value="organization">当前组织</option><option value="public">公开 SkillHub</option></select></label><label><span>版本说明</span><textarea id="skillhub-publish-changelog" placeholder="说明本版本新增或修复的内容"></textarea></label><label><input type="checkbox" id="skillhub-publish-now" checked/> 上传后立即发布</label><label><input type="checkbox" id="skillhub-publish-override"/> 我已审查并忽略非严重测试问题</label><div class="capability-error-block" id="skillhub-publish-error" hidden></div></div><footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="skillhub-confirm-publish">上传到 SkillHub</button></footer>`, {
      onReady(element) {
        element.querySelector('#skillhub-confirm-publish').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const errorBox = element.querySelector('#skillhub-publish-error');
          button.disabled = true;
          button.textContent = '正在上传…';
          errorBox.hidden = true;
          try {
            const result = await root.meteoDesktop.publishSkillDraftToHub({
              draftId: element.querySelector('#skillhub-publish-draft-id').value,
              visibility: element.querySelector('#skillhub-publish-visibility').value,
              changelog: element.querySelector('#skillhub-publish-changelog').value,
              publish: element.querySelector('#skillhub-publish-now').checked,
              overrideValidation: element.querySelector('#skillhub-publish-override').checked,
            });
            element.remove();
            api.ui.modal(`<header class="capability-modal-header"><div><h2>已上传到 SkillHub</h2><p>${escapeHtml(
              result.skillId
            )} · ${escapeHtml(result.version)}</p></div><button data-modal-close>×</button></header><div class="capability-modal-body"><p>${
              result.published ? '版本已经发布并签名。' : '版本已保存为草稿。'
            }</p></div><footer class="capability-modal-footer"><button class="primary-button" data-modal-close>完成</button></footer>`);
            await loadRemoteSkills({ rerender: false });
            await loadManagedSkills({ rerender: false });
          } catch (error) {
            button.disabled = false;
            button.textContent = '上传到 SkillHub';
            errorBox.hidden = false;
            errorBox.textContent = error?.message || String(error);
          }
        });
      },
    });
  }

  async function manageSkillDialog(skillId) {
    api.ui.modal('<div class="capability-modal-loading">正在读取发布记录…</div>');
    try {
      const [detail, publisherResponse] = await Promise.all([
        root.meteoDesktop.getSkillHubSkill(skillId),
        hub.identity?.role === 'admin'
          ? root.meteoDesktop.listSkillHubPublishers().catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      const skill = detail.skill;
      const versions = list(detail.versions);
      const publishers = list(publisherResponse?.items);
      if (hub.identity?.role === 'admin' && !publishers.some((user) => user.id === skill.ownerId)) {
        publishers.unshift({ id: skill.ownerId, displayName: skill.publisher?.name || skill.ownerId, status: 'disabled', role: 'publisher' });
      }
      const ownerField = hub.identity?.role === 'admin'
        ? `<label><span>负责人</span><select id="skillhub-manage-owner">${publishers
          .filter((user) => user.id === skill.ownerId || (user.status === 'active' && ['publisher', 'admin'].includes(user.role)))
          .map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === skill.ownerId ? 'selected' : ''}>${escapeHtml(user.displayName || user.username || user.id)} · ${user.role === 'admin' ? '管理员' : '发布者'}${user.status === 'active' ? '' : '（已停用）'}</option>`)
          .join('')}</select></label>`
        : '';
      const versionRows = versions
        .map((version) => `<article class="skillhub-managed-version">
          <div><span class="skillhub-lifecycle ${escapeHtml(version.status)}">${escapeHtml(statusLabels[version.status] || version.status)}</span><strong>${escapeHtml(version.version)}</strong><small>${escapeHtml(version.changelog || '没有版本说明')}</small></div>
          <dl><div><dt>风险</dt><dd>${escapeHtml(version.risk?.level || 'low')}</dd></div><div><dt>大小</dt><dd>${Math.max(1, Math.ceil(Number(version.packageSize || 0) / 1024))} KB</dd></div></dl>
          ${version.status === 'draft' ? `<button class="secondary-action" data-publish-version="${escapeHtml(version.version)}">发布</button>` : ''}
          ${version.status === 'published' ? `<button class="danger-text-button" data-deprecate-version="${escapeHtml(version.version)}">弃用</button>` : ''}
        </article>`)
        .join('');
      const element = api.ui.modal(`<header class="capability-modal-header"><div><h2>${escapeHtml(skill.name || skill.id)}</h2><p>${escapeHtml(skill.id)} · ${escapeHtml(skill.publisher?.name || '')}</p></div><button data-modal-close aria-label="关闭">×</button></header>
        <div class="capability-modal-body skillhub-management">
          <section class="skillhub-management-form"><h3>发布资料</h3><div class="skillhub-management-grid"><label><span>名称</span><input id="skillhub-manage-name" maxlength="120" value="${escapeHtml(skill.name || '')}" required /></label><label><span>可见范围</span><select id="skillhub-manage-visibility">${Object.entries(visibilityLabels).map(([value, label]) => `<option value="${value}" ${skill.visibility === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${ownerField}<label class="full"><span>摘要</span><input id="skillhub-manage-summary" maxlength="300" value="${escapeHtml(skill.summary || '')}" /></label><label class="full"><span>详细说明</span><textarea id="skillhub-manage-description" maxlength="4000">${escapeHtml(skill.description || '')}</textarea></label><label><span>分类</span><input id="skillhub-manage-categories" value="${escapeHtml(list(skill.categories).join('，'))}" placeholder="天气分析，预报服务" /></label><label><span>标签</span><input id="skillhub-manage-tags" value="${escapeHtml(list(skill.tags).join('，'))}" placeholder="天气，复盘" /></label></div></section>
          <section class="skillhub-management-versions"><div><h3>不可变版本</h3><span>${versions.length} 个版本</span></div>${versionRows || '<p class="capability-muted">尚未上传版本。</p>'}</section>
          <div class="capability-error-block" id="skillhub-manage-error" hidden></div>
        </div>
        <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>关闭</button><span class="capability-modal-spacer"></span><button class="primary-button" id="skillhub-save-managed">保存资料</button></footer>`, {
        wide: true,
        onReady(modal) {
          const errorBox = modal.querySelector('#skillhub-manage-error');
          const refreshDialog = async () => {
            await loadManagedSkills({ rerender: false });
            await manageSkillDialog(skillId);
          };
          modal.querySelector('#skillhub-save-managed').addEventListener('click', async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            errorBox.hidden = true;
            try {
              const nameInput = modal.querySelector('#skillhub-manage-name');
              if (!nameInput.value.trim()) {
                nameInput.setCustomValidity('请输入 Skill 名称');
                nameInput.reportValidity();
                nameInput.addEventListener('input', () => nameInput.setCustomValidity(''), { once: true });
                button.disabled = false;
                return;
              }
              const split = (value) => value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
              const request = {
                skillId,
                name: modal.querySelector('#skillhub-manage-name').value,
                summary: modal.querySelector('#skillhub-manage-summary').value,
                description: modal.querySelector('#skillhub-manage-description').value,
                visibility: modal.querySelector('#skillhub-manage-visibility').value,
                categories: split(modal.querySelector('#skillhub-manage-categories').value),
                tags: split(modal.querySelector('#skillhub-manage-tags').value),
              };
              const owner = modal.querySelector('#skillhub-manage-owner');
              if (owner && owner.value !== skill.ownerId) request.ownerId = owner.value;
              await root.meteoDesktop.updateSkillHubSkill(request);
              await refreshDialog();
            } catch (error) {
              button.disabled = false;
              errorBox.hidden = false;
              errorBox.textContent = error?.message || String(error);
            }
          });
          modal.querySelectorAll('[data-publish-version]').forEach((button) => button.addEventListener('click', async () => {
            const version = button.dataset.publishVersion;
            if (!confirm(`确定发布 ${skill.id} ${version} 吗？发布后该版本内容不可修改。`)) return;
            button.disabled = true;
            try {
              await root.meteoDesktop.publishSkillHubVersion({ skillId, version });
              await refreshDialog();
            } catch (error) {
              button.disabled = false;
              errorBox.hidden = false;
              errorBox.textContent = error?.message || String(error);
            }
          }));
          modal.querySelectorAll('[data-deprecate-version]').forEach((button) => button.addEventListener('click', async () => {
            const version = button.dataset.deprecateVersion;
            if (!confirm(`确定弃用 ${skill.id} ${version} 吗？已安装副本不会被删除。`)) return;
            button.disabled = true;
            try {
              await root.meteoDesktop.deprecateSkillHubVersion({ skillId, version });
              await refreshDialog();
            } catch (error) {
              button.disabled = false;
              errorBox.hidden = false;
              errorBox.textContent = error?.message || String(error);
            }
          }));
        },
      });
      return element;
    } catch (error) {
      api.ui.error('无法读取发布记录', error?.message || String(error));
      return null;
    }
  }

  Object.assign(skillHub, { settingsDialog, publishDraftDialog, manageSkillDialog });
})(typeof globalThis !== 'undefined' ? globalThis : window);
