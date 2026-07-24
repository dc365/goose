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
    )}${canPublish() ? tab('managed', hub.identity?.role === 'admin' ? `发布管理 ${hub.managedTotal}` : `我的发布 ${hub.managedTotal}`) : ''}${tab('collections', '套件')}`;
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
    const updateAvailable = Boolean(installed && latest && api.compareSkillVersions(installed, latest) < 0);
    const categories = list(skill.categories);
    return `<article class="capability-card capability-center-card skillhub-card">
      <div class="capability-icon">${escapeHtml(skill.icon || skill.name?.slice(0, 1) || 'S')}</div>
      <div class="capability-copy"><h3>${escapeHtml(skill.name || skill.id)}</h3><span>${escapeHtml(
        skill.publisher?.name || 'SkillHub'
      )}</span></div>
      <span class="capability-status ${skill.featured || installed === latest ? 'ready' : ''}">${
        updateAvailable ? '可更新' : skill.featured ? '精选' : escapeHtml(latest || '已发布')
      }</span>
      <p>${escapeHtml(skill.summary || skill.description || '')}</p>
      <div class="tag-row small">${categories
        .slice(0, 1)
        .map((item) => `<span>${escapeHtml(item)}</span>`)
        .join('')}${list(skill.tags)
          .filter((item) => !categories.includes(item))
          .slice(0, 1)
          .map((item) => `<span>${escapeHtml(item)}</span>`)
          .join('')}</div>
      ${
        reasons.length
          ? `<div class="skillhub-reasons">${reasons
              .slice(0, 1)
              .map((item) => `<span>${escapeHtml(item)}</span>`)
              .join('')}</div>`
          : ''
      }
      <footer class="skillhub-card-footer">
        <div class="skillhub-card-meta"><span>${Number(skill.downloads || 0)} 次下载</span><span>${escapeHtml(
          skill.visibility || 'public'
        )}</span></div>
        <button class="secondary-action" data-skillhub-skill="${escapeHtml(skill.id)}">${
          installed === latest && latest ? '已安装 · 查看' : updateAvailable ? `更新到 ${escapeHtml(latest)}` : '查看与安装'
        }</button>
      </footer>
    </article>`;
  }

  const originalCatalogTitlebarActions = renderCatalogTitlebarActions;
  renderCatalogTitlebarActions = function renderSkillHubTitlebarActions() {
    const remoteView = state.view === 'catalog' && state.catalogTab === 'skills' && hub.view !== 'installed';
    if (!remoteView) return originalCatalogTitlebarActions();
    return `<div class="top-actions capability-top-actions"><label class="search-box">${icon(
      'search'
    )}<input id="catalog-search" value="${escapeHtml(hub.query)}" placeholder="搜索 SkillHub" /></label>${
      canPublish() ? `<button class="my-experts" id="skillhub-publish-draft">${icon('plus')} 发布草稿</button>` : ''
    }${api.skillAddMenu()}${serverBadge()}</div>`;
  };

  function skillCategories(source, recommended) {
    return ['全部', ...new Set(source.flatMap((item) => {
      const skill = recommended ? item.skill : item;
      return list(skill?.categories).filter(Boolean);
    }))];
  }

  function categoryStrip(categories, activeCategory) {
    return `<div class="category-strip skillhub-category-strip" aria-label="技能分类">${categories
      .map((category) => `<button class="category-pill ${activeCategory === category ? 'active' : ''}" data-skillhub-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
      .join('')}</div>`;
  }

  function remoteShell(title, description, content) {
    return `<div class="content-scroll window-content-full"><section class="catalog-section capability-center-section skillhub-section">
      <div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(
        description
      )}</p></div><span class="capability-local-badge">SkillHub Server V1</span></div>
      <div class="capability-subtabs">${tabs()}</div>
      ${hub.error ? `<div class="capability-error">${escapeHtml(hub.error)}</div>` : ''}
      ${content}
    </section></div>`;
  }

  function renderRemoteSkills(recommended) {
    const allSkills = recommended ? hub.recommendations : hub.skills;
    const categories = skillCategories(allSkills, recommended);
    const activeCategory = categories.includes(hub.category) ? hub.category : '全部';
    const source = allSkills.filter((item) => {
      const skill = recommended ? item.skill : item;
      return activeCategory === '全部' || list(skill?.categories).includes(activeCategory);
    });
    const cards = source
      .map((item) => (recommended ? remoteCard(item.skill, item.reasons) : remoteCard(item)))
      .join('');
    const empty =
      hub.status === 'loading'
        ? '<div class="empty-result">正在读取 SkillHub…</div>'
        : '<div class="large-empty"><span>S</span><h2>没有找到匹配技能</h2><p>调整搜索词，或连接另一个 SkillHub 服务。</p></div>';
    return remoteShell(
      recommended ? '为你推荐' : 'SkillHub',
      recommended ? '结合已安装能力、项目和工具给出推荐' : '浏览服务器中已发布和签名的 Skill',
      `${categoryStrip(categories, activeCategory)}<div class="catalog-grid compact">${cards || empty}</div>`
    );
  }

  function renderOfflineSkills() {
    const previous = api.center.installedOnly;
    const previousCategory = state.category;
    const previousSearch = state.search;
    api.center.installedOnly = false;
    state.category = '全部';
    state.search = '';
    let html;
    try {
      html = originalCatalogView();
    } finally {
      api.center.installedOnly = previous;
      state.category = previousCategory;
      state.search = previousSearch;
    }
    html = html.replace(
      /<div class="capability-subtabs">[\s\S]*?<\/div>/,
      `<div class="capability-subtabs">${tabs()}</div>`
    );
    html = html.replace(
      '<span class="capability-local-badge">本地能力中心 V1</span>',
      `${serverBadge()}<span class="capability-local-badge">离线包</span>`
    );
    html = html.replace(
      '<div class="category-strip">',
      `<div class="capability-error">${escapeHtml(hub.error || 'SkillHub 暂时不可用')}。已切换到随应用提供的本地技能，不影响离线安装和使用。</div><div class="category-strip">`
    );
    return html;
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
      '按业务场景组合专家、Skill、工具与模板',
      `<div class="skillhub-collection-grid">${
        cards ||
        (hub.status === 'loading'
          ? '<div class="empty-result">正在读取套件…</div>'
          : '<div class="empty-result">暂无套件</div>')
      }</div>`
    );
  }

  function renderManagedSkills() {
    const visibilityLabels = { private: '仅自己', organization: '当前组织', public: '全体用户' };
    const statusLabels = { draft: '草稿', published: '已发布', deprecated: '已弃用' };
    const rows = hub.managedSkills
      .map(
        (skill) => `<article class="skillhub-managed-row">
          <div class="skillhub-managed-identity"><span class="skillhub-managed-icon">${escapeHtml(skill.icon || skill.name?.slice(0, 1) || 'S')}</span><div><h3>${escapeHtml(skill.name || skill.id)}</h3><p>${escapeHtml(skill.id)} · ${escapeHtml(skill.publisher?.name || '')}</p></div></div>
          <div class="skillhub-managed-fact"><span>状态</span><strong class="skillhub-lifecycle ${escapeHtml(skill.status || 'draft')}">${escapeHtml(statusLabels[skill.status] || skill.status || '草稿')}</strong></div>
          <div class="skillhub-managed-fact"><span>可见范围</span><strong>${escapeHtml(visibilityLabels[skill.visibility] || skill.visibility || '仅自己')}</strong></div>
          <div class="skillhub-managed-fact"><span>当前版本</span><strong>${escapeHtml(skill.latestVersion || '尚未发布')}</strong></div>
          <div class="skillhub-managed-fact"><span>更新时间</span><strong>${escapeHtml(formatDateTime(skill.updatedAt) || '-')}</strong></div>
          <button class="secondary-action skillhub-manage-action" data-skillhub-manage="${escapeHtml(skill.id)}">管理</button>
        </article>`
      )
      .join('');
    const empty = hub.status === 'loading'
      ? '<div class="empty-result">正在读取发布记录…</div>'
      : '<div class="large-empty"><span>版</span><h2>还没有发布记录</h2><p>从 Skill Creator 选择一个草稿并上传到 SkillHub。</p></div>';
    return remoteShell(
      hub.identity?.role === 'admin' ? '发布管理' : '我的发布',
      hub.identity?.role === 'admin' ? '管理全部发布者的 Skill、版本和可见范围' : '管理由当前账户上传的 Skill 和不可变版本',
      `<div class="skillhub-managed-summary"><span><strong>${hub.managedTotal}</strong> 个 Skill</span><span><strong>${hub.managedSkills.filter((skill) => skill.status === 'draft').length}</strong> 个待发布</span><span><strong>${hub.managedSkills.filter((skill) => skill.status === 'published').length}</strong> 个已发布</span></div><div class="skillhub-managed-list">${rows || empty}</div>`
    );
  }

  const originalCatalogView = renderCatalogView;
  renderCatalogView = function renderSkillHubCatalog() {
    if (state.catalogTab !== 'skills') return originalCatalogView();
    if (hub.status === 'error' && ['skillhub', 'recommendations', 'collections'].includes(hub.view)) return renderOfflineSkills();
    if (hub.view === 'skillhub') return renderRemoteSkills(false);
    if (hub.view === 'recommendations') return renderRemoteSkills(true);
    if (hub.view === 'collections') return renderCollections();
    if (hub.view === 'managed') return renderManagedSkills();
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

  Object.assign(skillHub, { tabs, serverBadge, remoteCard, remoteShell, renderRemoteSkills, renderOfflineSkills, renderCollections, renderManagedSkills });
})(typeof globalThis !== 'undefined' ? globalThis : window);
