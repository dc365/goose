(function skillHubDialogs(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const { connect, loadRemoteSkills } = skillHub;

  function settingsDialog() {
    const settings = hub.settings || { baseUrl: 'http://127.0.0.1:8088', requireSignature: true };
    api.ui.modal(`<header class="capability-modal-header"><div><h2>SkillHub 设置</h2><p>连接自托管 SkillHub，浏览、安装和发布团队技能</p></div><button data-modal-close>×</button></header><div class="capability-modal-body skillhub-settings-form"><label><span>服务器地址</span><input id="skillhub-base-url" value="${escapeHtml(
      settings.baseUrl || ''
    )}" placeholder="http://127.0.0.1:8088"/></label><label><span>访问 Token</span><input id="skillhub-token" type="password" placeholder="${
      settings.tokenConfigured ? '已保存；留空保持不变' : '可选；发布和组织技能需要'
    }"/></label><label><input type="checkbox" id="skillhub-clear-token"/> 清除已保存 Token</label><label><input type="checkbox" id="skillhub-require-signature" ${
      settings.requireSignature !== false ? 'checked' : ''
    }/> 安装前必须验证 Ed25519 签名</label><div class="skillhub-connection-info">${
      hub.identity?.subject
        ? `当前身份：${escapeHtml(hub.identity.name || hub.identity.subject)} · ${escapeHtml(hub.identity.role)}`
        : '当前为匿名浏览'
    }</div><div class="capability-error-block" id="skillhub-settings-result" hidden></div></div><footer class="capability-modal-footer"><button class="ghost-button" id="skillhub-test-connection">测试连接</button><span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="skillhub-save-settings">保存</button></footer>`, {
      onReady(element) {
        const resultBox = element.querySelector('#skillhub-settings-result');
        const values = () => ({
          baseUrl: element.querySelector('#skillhub-base-url').value,
          token: element.querySelector('#skillhub-token').value,
          clearToken: element.querySelector('#skillhub-clear-token').checked,
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

  Object.assign(skillHub, { settingsDialog, publishDraftDialog });
})(typeof globalThis !== 'undefined' ? globalThis : window);
