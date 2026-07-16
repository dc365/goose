(function skillHubRender(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const { list, installedVersion, canPublish } = skillHub;

  function tabs() {
    const tab = (id, label) =>
      `<button class="${hub.view === id ? 'active' : ''}" data-skillhub-view="${id}">${label}</button>`;
    return `${tab('recommendations', '推荐')}${tab('skillhub', 'SkillHub')}${tab(
      'installed',
      `我的安装 ${api.installedSkills().length}`
    )}${tab('collections', '套件')}`;
  }

  function serverBadge() {
    const label =
      hub.status === 'ready'
        ? '已连接'
        : hub.status === 'loading'
          ? '连接中'
          : hub.status === 'error'
            ? '未连接'
            : '未配置';
    return `<button class="skillhub-server-badge ${hub.status}" id="skillhub-settings"><span></span>${escapeHtml(
      label
    )}</button>`;
  }

  function remoteCard(skill, reasons = []) {
    const installed = installedVersion(skill.id);
    const latest = skill.latestVersion || '';
    const categories = list(skill.categories);
    return `<article class="capability-card capability-center-card skillhub-card">
      <div class="capability-icon">${escapeHtml(skill.icon || skill.name?.slice(0, 1) || 'S')}</div>
      <div class="capability-copy"><h3>${escapeHtml(skill.name || skill.id)}</h3><span>${escapeHtml(
        skill.publisher?.name || 'SkillHub'
      )}</span></div>
      <span class="capability-status ${skill.featured ? 'ready' : ''}">${
        skill.featured ? '精选' : escapeHtml(latest || '已发布')
      }</span>
      <p>${escapeHtml(skill.summary || skill.description || '')}</p>
      <div class="tag-row small">${categories
        .slice(0, 2)
        .map((item) => `<span>${escapeHtml(item)}</span>`)
        .join('')}${list(skill.tags)
          .slice(0, 2)
          .map((item) => `<span>${escapeHtml(item)}</span>`)
          .join('')}</div>
      ${
        reasons.length
          ? `<div class="skillhub-reasons">${reasons
              .slice(0, 2)
              .map((item) => `<span>${escapeHtml(item)}</span>`)
              .join('')}</div>`
          : ''
      }
      <div class="skillhub-card-meta"><span>${Number(skill.downloads || 0)} 次下载</span><span>${escapeHtml(
        skill.visibility || 'public'
      )}</span></div>
      <button class="secondary-action" data-skillhub-skill="${escapeHtml(skill.id)}">${
        installed === latest && latest ? '已安装 · 查看' : '查看与安装'
      }</button>
    </article>`;
  }

  function remoteShell(title, description, content) {
    return `<header class="topbar">
      <div class="top-tabs">${catalogTabButton('experts', '专家')}${catalogTabButton(
        'skills',
        '技能'
      )}${catalogTabButton('connectors', '连接器')}</div>
      <div class="top-actions capability-top-actions"><label class="search-box">${icon(
        'search'
      )}<input id="catalog-search" value="${escapeHtml(hub.query)}" placeholder="搜索 SkillHub" /></label>${
        canPublish() ? '<button class="my-experts" id="skillhub-publish-draft">发布草稿</button>' : ''
      }${serverBadge()}</div>
    </header>
    <div class="content-scroll"><section class="catalog-section capability-center-section skillhub-section">
      <div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(
        description
      )}</p></div><span class="capability-local-badge">SkillHub Server V1</span></div>
      <div class="capability-subtabs">${tabs()}</div>
      ${hub.error ? `<div class="capability-error">${escapeHtml(hub.error)}</div>` : ''}
      ${content}
    </section></div>`;
  }

  function renderRemoteSkills(recommended) {
    const source = recommended ? hub.recommendations : hub.skills;
    const cards = source
      .map((item) => (recommended ? remoteCard(item.skill, item.reasons) : remoteCard(item)))
      .join('');
    const empty =
      hub.status === 'loading'
        ? '<div class="empty-result">正在读取 SkillHub…</div>'
        : '<div class="large-empty"><span>S</span><h2>没有找到匹配技能</h2><p>调整搜索词，或连接另一个 SkillHub 服务。</p></div>';
    return remoteShell(
      recommended ? '为你推荐' : 'SkillHub',
      recommended ? '结合已安装能力、项目和连接器给出推荐' : '浏览服务器中已发布和签名的 Skill',
      `<div class="catalog-grid compact">${cards || empty}</div>`
    );
  }

  function renderCollections() {
    if (hub.activeCollection) {
      const cards = hub.collectionSkills.map((item) => remoteCard(item)).join('');
      return remoteShell(
        hub.activeCollection.name,
        hub.activeCollection.description || 'Skill 套件',
        `<button class="ghost-button skillhub-back" data-skillhub-collection-back>← 返回套件</button><div class="catalog-grid compact">${
          cards || '<div class="empty-result">该套件暂无可见技能</div>'
        }</div>`
      );
    }
    const cards = hub.collections
      .map(
        (collection) => `<article class="skillhub-collection-card"><div><span>${
          collection.featured ? '精选套件' : '技能套件'
        }</span><h3>${escapeHtml(collection.name)}</h3><p>${escapeHtml(
          collection.description || ''
        )}</p></div><footer><small>${list(collection.skills).length} 个技能</small><button class="secondary-action" data-skillhub-collection="${escapeHtml(
          collection.id
        )}">查看套件</button></footer></article>`
      )
      .join('');
    return remoteShell(
      '技能套件',
      '按业务场景组合专家、Skill、连接器与模板',
      `<div class="skillhub-collection-grid">${
        cards ||
        (hub.status === 'loading'
          ? '<div class="empty-result">正在读取套件…</div>'
          : '<div class="empty-result">暂无套件</div>')
      }</div>`
    );
  }

  const originalCatalogView = renderCatalogView;
  renderCatalogView = function renderSkillHubCatalog() {
    if (state.catalogTab !== 'skills') return originalCatalogView();
    if (hub.view === 'skillhub') return renderRemoteSkills(false);
    if (hub.view === 'recommendations') return renderRemoteSkills(true);
    if (hub.view === 'collections') return renderCollections();
    api.center.installedOnly = true;
    let html = originalCatalogView();
    const oldTabs = /<div class="capability-subtabs">[\s\S]*?<\/div>/;
    html = html.replace(oldTabs, `<div class="capability-subtabs">${tabs()}</div>`);
    html = html.replace(
      '<span class="capability-local-badge">本地能力中心 V1</span>',
      `${serverBadge()}<span class="capability-local-badge">本地能力中心 V1</span>`
    );
    return html;
  };

  Object.assign(skillHub, { tabs, serverBadge, remoteCard, remoteShell, renderRemoteSkills, renderCollections });
})(typeof globalThis !== 'undefined' ? globalThis : window);
