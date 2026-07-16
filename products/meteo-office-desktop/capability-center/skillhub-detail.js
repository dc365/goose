(function skillHubDialogs(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const { list } = skillHub;

  async function openSkill(skillId) {
    api.ui.modal('<div class="capability-modal-loading">正在读取 SkillHub 详情…</div>');
    try {
      const detail = await root.meteoDesktop.getSkillHubSkill(skillId);
      const skill = detail.skill;
      const versions = list(detail.versions).filter((item) => item.status === 'published');
      const latest = versions.find((item) => item.version === skill.latestVersion) || versions[0];
      api.ui.modal(`<header class="capability-modal-header"><div><h2>${escapeHtml(
        skill.name || skill.id
      )}</h2><p>${escapeHtml(skill.publisher?.name || '')} · ${escapeHtml(
        skill.visibility || ''
      )}</p></div><button data-modal-close>×</button></header>
        <div class="capability-modal-body skillhub-detail"><p>${escapeHtml(
          skill.description || skill.summary || ''
        )}</p><dl class="capability-summary-list"><div><dt>最新版本</dt><dd>${escapeHtml(
          skill.latestVersion || '-'
        )}</dd></div><div><dt>下载</dt><dd>${Number(
          skill.downloads || 0
        )}</dd></div><div><dt>分类</dt><dd>${escapeHtml(
          list(skill.categories).join('、') || '-'
        )}</dd></div><div><dt>可见范围</dt><dd>${escapeHtml(
          skill.visibility || 'public'
        )}</dd></div></dl><h4>已发布版本</h4><div class="skillhub-version-list">${versions
          .map(
            (version) => `<label><input type="radio" name="skillhubVersion" value="${escapeHtml(
              version.version
            )}" ${version.version === latest?.version ? 'checked' : ''}/><span><strong>${escapeHtml(
              version.version
            )}</strong><small>${escapeHtml(version.risk?.level || 'low')} · ${Math.ceil(
              Number(version.packageSize || 0) / 1024
            )} KB</small></span></label>`
          )
          .join('')}</div><div class="capability-error-block" id="skillhub-install-error" hidden></div></div>
        <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="install-skillhub-skill" ${
          latest ? '' : 'disabled'
        }>校验并安装</button></footer>`, {
        wide: true,
        onReady(element) {
          element.querySelector('#install-skillhub-skill')?.addEventListener('click', async (event) => {
            const button = event.currentTarget;
            const version = element.querySelector('input[name="skillhubVersion"]:checked')?.value;
            button.disabled = true;
            button.textContent = '下载并验证中…';
            try {
              const inspection = await root.meteoDesktop.downloadSkillHubSkill({ skillId, version });
              element.remove();
              api.skills.inspect(inspection);
            } catch (error) {
              button.disabled = false;
              button.textContent = '校验并安装';
              const box = element.querySelector('#skillhub-install-error');
              box.hidden = false;
              box.textContent = error?.message || String(error);
            }
          });
        },
      });
    } catch (error) {
      api.ui.error('无法读取 SkillHub 技能', error?.message || String(error));
    }
  }

  async function openCollection(id) {
    const collection = hub.collections.find((item) => item.id === id);
    if (!collection) return;
    hub.status = 'loading';
    render();
    try {
      const details = await Promise.all(
        list(collection.skills).map((ref) => root.meteoDesktop.getSkillHubSkill(ref.skillId).catch(() => null))
      );
      hub.collectionSkills = details.filter(Boolean).map((item) => item.skill);
      hub.activeCollection = collection;
      hub.status = 'ready';
    } catch (error) {
      hub.status = 'error';
      hub.error = error?.message || String(error);
    }
    render();
  }

  Object.assign(skillHub, { openSkill, openCollection });
})(typeof globalThis !== 'undefined' ? globalThis : window);
