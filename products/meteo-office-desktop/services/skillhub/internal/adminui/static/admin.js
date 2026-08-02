'use strict';

const state = {
  token: '',
  user: null,
  users: [],
  sessions: [],
  skills: [],
  skillTotal: 0,
  experts: [],
  expertTotal: 0,
  collections: [],
  recommendationRules: [],
  governance: null,
  modelCatalog: null,
  view: 'skills',
  audit: [],
  policies: null,
  toastTimer: null,
};

const adminSessionKey = 'meteomate.management.session.v1';
const roleLabels = { viewer: '使用者', publisher: 'Skill 发布者', admin: '管理员' };
const skillStatusLabels = { published: '已发布', draft: '草稿', pending_review: '待审核', deprecated: '已弃用' };
const expertStatusLabels = { enabled: '已启用', draft: '草稿', disabled: '已停用', archived: '已归档' };
const expertReviewLabels = { not_required: '无需审核', not_submitted: '未提交', pending: '待审核', approved: '已通过', rejected: '已退回' };
const expertDistributionLabels = { all: '全部用户', percentage: '按比例灰度', allowlist: '指定用户' };
const expertSourceLabels = { system: '系统', organization: '组织', user: '个人' };
const expertVisibilityLabels = { public: '全员可见', organization: '本组织', private: '仅本人' };
const visibilityLabels = { public: '公开', organization: '组织', private: '私有' };
const riskLabels = { low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险' };
const actionLabels = {
  'auth.login': '登录成功',
  'auth.login.failed': '登录失败',
  'auth.login.blocked': '登录已限速',
  'auth.logout': '退出登录',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.profile.update': '更新个人资料',
  'user.password.change': '修改密码',
  'user.password.reset': '重置密码',
  'user.sessions.revoke': '撤销用户会话',
  'session.revoke': '撤销会话',
  'policy.organization.update': '更新组织策略',
  'policy.role.update': '更新角色策略',
  'policy.role.reset': '重置角色策略',
  'policy.user.update': '更新用户策略',
  'policy.user.reset': '重置用户策略',
  'model.provider.put': '保存模型提供商',
  'model.provider.delete': '删除模型提供商',
  'model.provider.verify': '记录模型验证',
  'expert.create': '创建专家',
  'expert.update': '更新专家',
  'expert.review.submit': '提交专家审核',
  'expert.review.approve': '通过专家审核',
  'expert.review.reject': '退回专家审核',
  'expert.status.update': '更新专家状态',
  'expert.distribution.update': '更新专家分发',
  'expert.rollback': '回滚专家',
  'skill.update': '更新 Skill 资料',
  'skill.owner.transfer': '转交 Skill 负责人',
  'skill.version.upload': '上传 Skill 版本',
  'skill.version.publish': '发布 Skill',
  'skill.version.submit_review': '提交发布审核',
  'skill.version.reject': '退回 Skill 版本',
  'skill.version.deprecate': '废弃 Skill 版本',
  'collection.put': '保存 Skill 套件',
  'collection.delete': '删除 Skill 套件',
  'recommendation.rule.put': '保存推荐规则',
  'recommendation.rule.delete': '删除推荐规则',
  'featured.placements.put': '更新精选位',
};

const elements = {
  loginShell: document.getElementById('login-shell'),
  adminShell: document.getElementById('admin-shell'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  firstPasswordForm: document.getElementById('first-password-form'),
  firstPasswordError: document.getElementById('first-password-error'),
  skillsView: document.getElementById('skills-view'),
  expertsView: document.getElementById('experts-view'),
  operationsView: document.getElementById('operations-view'),
  governanceView: document.getElementById('governance-view'),
  usersView: document.getElementById('users-view'),
  modelCatalogView: document.getElementById('model-catalog-view'),
  policiesView: document.getElementById('policies-view'),
  auditView: document.getElementById('audit-view'),
  skillsBody: document.getElementById('skills-body'),
  skillsEmpty: document.getElementById('skills-empty'),
  expertsBody: document.getElementById('experts-body'),
  expertsEmpty: document.getElementById('experts-empty'),
  collectionsList: document.getElementById('collections-list'),
  collectionsEmpty: document.getElementById('collections-empty'),
  rulesList: document.getElementById('rules-list'),
  rulesEmpty: document.getElementById('rules-empty'),
  recommendationResults: document.getElementById('recommendation-results'),
  governanceBody: document.getElementById('governance-body'),
  governanceEmpty: document.getElementById('governance-empty'),
  reviewQueueList: document.getElementById('review-queue-list'),
  reviewQueueEmpty: document.getElementById('review-queue-empty'),
  versionDistributionList: document.getElementById('version-distribution-list'),
  versionDistributionEmpty: document.getElementById('version-distribution-empty'),
  usersBody: document.getElementById('users-body'),
  usersEmpty: document.getElementById('users-empty'),
  modelCatalogList: document.getElementById('model-catalog-list'),
  modelCatalogEmpty: document.getElementById('model-catalog-empty'),
  policiesBody: document.getElementById('policies-body'),
  policiesEmpty: document.getElementById('policies-empty'),
  auditBody: document.getElementById('audit-body'),
  auditEmpty: document.getElementById('audit-empty'),
  drawerLayer: document.getElementById('drawer-layer'),
  drawerContent: document.getElementById('drawer-content'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerEyebrow: document.getElementById('drawer-eyebrow'),
  toast: document.getElementById('toast'),
};

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`服务返回了无效响应（${response.status}）`);
  }
  if (!response.ok) {
    if (response.status === 401 && state.token && !options.keepSession) {
      showLogin('管理员会话已失效，请重新登录。');
    }
    throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  }
  return payload;
}

async function apiMultipart(path, formData) {
  const headers = { Accept: 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { method: 'POST', headers, body: formData });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`服务返回了无效响应（${response.status}）`);
  }
  if (!response.ok) {
    if (response.status === 401 && state.token) showLogin('管理员会话已失效，请重新登录。');
    throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  }
  return payload;
}

function setError(element, message = '') {
  element.textContent = message;
  element.hidden = !message;
}

function setSubmitting(form, busy, text) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.label;
}

function readAdminSession() {
  try {
    return window.sessionStorage.getItem(adminSessionKey) || '';
  } catch {
    return '';
  }
}

function persistAdminSession() {
  if (!state.token) return;
  try {
    window.sessionStorage.setItem(adminSessionKey, state.token);
  } catch {}
}

function clearAdminSession() {
  try {
    window.sessionStorage.removeItem(adminSessionKey);
  } catch {}
}

function showLogin(message = '') {
  clearAdminSession();
  state.token = '';
  state.user = null;
  state.users = [];
  state.sessions = [];
  state.skills = [];
  state.skillTotal = 0;
  state.experts = [];
  state.expertTotal = 0;
  state.collections = [];
  state.recommendationRules = [];
  state.governance = null;
  state.modelCatalog = null;
  state.policies = null;
  elements.adminShell.hidden = true;
  elements.loginShell.hidden = false;
  document.getElementById('skip-link').href = '#login-form';
  elements.loginForm.hidden = false;
  elements.firstPasswordForm.hidden = true;
  setError(elements.loginError, message);
  document.getElementById('login-password').value = '';
  document.getElementById('login-username').focus();
}

function showFirstPasswordChange(user) {
  elements.adminShell.hidden = true;
  elements.loginShell.hidden = false;
  document.getElementById('skip-link').href = '#first-password-form';
  document.getElementById('first-username').value = user.username;
  elements.loginForm.hidden = true;
  elements.firstPasswordForm.hidden = false;
  setError(elements.firstPasswordError);
  document.getElementById('first-current-password').focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  setError(elements.loginError);
  setSubmitting(elements.loginForm, true, '正在验证…');
  try {
    const result = await api('/v1/auth/login', {
      method: 'POST',
      keepSession: true,
      body: { username, password, clientId: 'meteomate-admin-console' },
    });
    if (result.user?.role !== 'admin') {
      state.token = result.sessionToken;
      await api('/v1/auth/logout', { method: 'POST', keepSession: true });
      state.token = '';
      throw new Error('当前账户没有管理员权限');
    }
    state.token = result.sessionToken;
    state.user = result.user;
    persistAdminSession();
    if (result.user.mustChangePassword) {
      showFirstPasswordChange(result.user);
      return;
    }
    await enterAdmin();
  } catch (error) {
    setError(elements.loginError, error.message);
    document.getElementById('login-password').focus();
  } finally {
    setSubmitting(elements.loginForm, false);
  }
}

async function handleFirstPassword(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('first-current-password').value;
  const newPassword = document.getElementById('first-new-password').value;
  const confirmation = document.getElementById('first-confirm-password').value;
  setError(elements.firstPasswordError);
  if ([...newPassword].length < 8) return setError(elements.firstPasswordError, '新密码至少需要 8 个字符');
  if (newPassword !== confirmation) return setError(elements.firstPasswordError, '两次输入的新密码不一致');
  setSubmitting(elements.firstPasswordForm, true, '正在更新…');
  try {
    await api('/v1/me/password', { method: 'POST', keepSession: true, body: { currentPassword, newPassword } });
    showLogin('密码已更新，请使用新密码重新登录。');
  } catch (error) {
    setError(elements.firstPasswordError, error.message);
  } finally {
    setSubmitting(elements.firstPasswordForm, false);
  }
}

async function enterAdmin() {
  persistAdminSession();
  elements.loginShell.hidden = true;
  elements.adminShell.hidden = false;
  document.getElementById('skip-link').href = '#main-content';
  document.getElementById('identity-name').textContent = state.user.displayName || state.user.username;
  document.getElementById('identity-username').textContent = state.user.username;
  document.getElementById('identity-avatar').textContent = initial(state.user.displayName || state.user.username);
  document.getElementById('service-origin').textContent = window.location.host;
  await loadSkills();
  await loadExperts();
  await loadOperations();
  await loadGovernance();
  await loadUsers();
  await loadPolicies();
}

async function restoreAdminSession() {
  const token = readAdminSession();
  if (!token) {
    showLogin();
    return;
  }
  state.token = token;
  try {
    const result = await api('/v1/me', { keepSession: true });
    if (!result.authenticated || result.user?.role !== 'admin') throw new Error('管理员会话已失效');
    state.user = result.user;
    if (result.user.mustChangePassword) {
      showFirstPasswordChange(result.user);
      return;
    }
    await enterAdmin();
  } catch {
    showLogin('管理员会话已失效，请重新登录。');
  }
}

async function logout() {
  try {
    await api('/v1/auth/logout', { method: 'POST', keepSession: true });
  } catch {}
  showLogin();
}

async function loadSkills() {
  try {
    const result = await api('/v1/skills?includeDrafts=true&limit=200');
    state.skills = result.items || [];
    state.skillTotal = result.total || state.skills.length;
    renderSkillMetrics();
    renderSkills();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSkillMetrics() {
  setText('skill-metric-total', state.skillTotal);
  setText('skill-metric-published', state.skills.filter((skill) => skill.status === 'published').length);
  setText('skill-metric-draft', state.skills.filter((skill) => skill.status === 'draft').length);
  setText('skill-metric-deprecated', state.skills.filter((skill) => skill.status === 'deprecated').length);
}

function filteredSkills() {
  const query = document.getElementById('skill-search').value.trim().toLowerCase();
  const status = document.getElementById('skill-status-filter').value;
  const visibility = document.getElementById('skill-visibility-filter').value;
  return state.skills.filter((skill) => {
    const searchable = [skill.name, skill.id, skill.summary, ...(skill.categories || []), ...(skill.tags || [])].join(' ').toLowerCase();
    return (!query || searchable.includes(query)) && (!status || skill.status === status) && (!visibility || skill.visibility === visibility);
  });
}

function renderSkills() {
  elements.skillsBody.replaceChildren();
  const skills = filteredSkills();
  elements.skillsEmpty.hidden = skills.length > 0;
  for (const skill of skills) {
    const row = document.createElement('tr');
    row.append(
      tableCell('Skill', skillIdentity(skill)),
      tableCell('状态', skillStatusPill(skill.status)),
      tableCell('当前版本', skillVersionValue(skill)),
      tableCell('负责人', skillOwnerValue(skill)),
      tableCell('更新时间', textElement('span', formatDate(skill.updatedAt), 'date-cell')),
      tableCell('', actionButton('•••', `管理 ${skill.name}`, () => openSkill(skill))),
    );
    elements.skillsBody.append(row);
  }
}

function skillIdentity(skill) {
  const wrapper = element('div', 'skill-cell');
  wrapper.append(textElement('span', skill.icon || initial(skill.name), 'skill-avatar'));
  const copy = element('span', 'skill-copy');
  const title = element('span', 'skill-title-line');
  title.append(textElement('strong', skill.name));
  if (skill.featured) title.append(textElement('span', '精选', 'pill featured'));
  copy.append(title, textElement('small', skill.id));
  wrapper.append(copy);
  return wrapper;
}

function skillStatusPill(status) {
  return pill(skillStatusLabels[status] || status, `skill-${status || 'draft'}`);
}

function skillVersionValue(skill) {
  const wrapper = element('span', 'skill-table-value');
  wrapper.append(textElement('strong', skill.latestVersion || '尚未发布'));
  wrapper.append(textElement('small', `${skill.versions?.length || 0} 个版本`));
  return wrapper;
}

function skillOwnerValue(skill) {
  const wrapper = element('span', 'skill-table-value');
  wrapper.append(textElement('strong', skill.publisher?.name || skill.ownerId || '未指定'));
  wrapper.append(textElement('small', visibilityLabels[skill.visibility] || skill.visibility || '私有'));
  return wrapper;
}

async function loadExperts() {
  try {
    const result = await api('/v1/experts?includeInactive=true&limit=300');
    state.experts = result.items || [];
    state.expertTotal = result.total || state.experts.length;
    renderExpertMetrics();
    renderExperts();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderExpertMetrics() {
  setText('expert-metric-total', state.expertTotal);
  setText('expert-metric-enabled', state.experts.filter((expert) => expert.status === 'enabled').length);
  setText('expert-metric-managed', state.experts.filter((expert) => ['system', 'organization'].includes(expert.source?.type)).length);
  setText('expert-metric-review', state.experts.filter((expert) => expert.review?.status === 'pending').length);
}

function filteredExperts() {
  const query = document.getElementById('expert-search').value.trim().toLowerCase();
  const status = document.getElementById('expert-status-filter').value;
  const review = document.getElementById('expert-review-filter').value;
  const visibility = document.getElementById('expert-visibility-filter').value;
  return state.experts.filter((expert) => {
    const searchable = [expert.name, expert.id, expert.category, expert.description, expert.mission, ...(expert.tags || [])].join(' ').toLowerCase();
    return (!query || searchable.includes(query))
      && (!status || expert.status === status)
      && (!review || expert.review?.status === review)
      && (!visibility || expert.visibility === visibility);
  });
}

function renderExperts() {
  elements.expertsBody.replaceChildren();
  const experts = filteredExperts();
  elements.expertsEmpty.hidden = experts.length > 0;
  for (const expert of experts) {
    const row = document.createElement('tr');
    row.append(
      tableCell('专家', expertIdentity(expert)),
      tableCell('来源与范围', expertSourceValue(expert)),
      tableCell('状态', expertGovernanceStatus(expert)),
      tableCell('版本', expertVersionValue(expert)),
      tableCell('负责人', expertOwnerValue(expert)),
      tableCell('更新时间', textElement('span', formatDate(expert.updatedAt), 'date-cell')),
      tableCell('', actionButton('•••', `管理 ${expert.name}`, () => openExpert(expert))),
    );
    elements.expertsBody.append(row);
  }
}

function expertIdentity(expert) {
  const wrapper = element('div', 'expert-cell');
  wrapper.append(textElement('span', expert.avatar || initial(expert.name), 'expert-avatar'));
  const copy = element('span', 'expert-copy');
  copy.append(textElement('strong', expert.name), textElement('small', `${expert.id}${expert.category ? ` · ${expert.category}` : ''}`));
  wrapper.append(copy);
  return wrapper;
}

function expertSourceValue(expert) {
  const wrapper = element('span', 'expert-table-value');
  wrapper.append(textElement('strong', expertSourceLabels[expert.source?.type] || '个人'));
  wrapper.append(textElement('small', expertVisibilityLabels[expert.visibility] || '仅本人'));
  return wrapper;
}

function expertStatusPill(status) {
  return pill(expertStatusLabels[status] || status, `expert-${status || 'draft'}`);
}

function expertGovernanceStatus(expert) {
  const wrapper = element('span', 'expert-governance-status');
  wrapper.append(expertStatusPill(expert.status));
  if (expert.review?.status) {
    wrapper.append(textElement('small', expertReviewLabels[expert.review.status] || expert.review.status));
  }
  return wrapper;
}

function expertVersionValue(expert) {
  const wrapper = element('span', 'expert-table-value');
  wrapper.append(textElement('strong', expert.version || '未设置'));
  wrapper.append(textElement('small', `修订 ${expert.revision || 1}`));
  return wrapper;
}

function expertOwnerValue(expert) {
  const wrapper = element('span', 'expert-table-value');
  wrapper.append(textElement('strong', expert.owner || expert.ownerId || '未指定'));
  wrapper.append(textElement('small', expert.orgId || '个人空间'));
  return wrapper;
}

async function openExpert(expert) {
  openDrawer(expert.name, '专家详情与修订');
  elements.drawerContent.append(textElement('p', '正在读取专家资料…', 'drawer-loading'));
  try {
    const [detail, revisionResult] = await Promise.all([
      api(`/v1/experts/${encodeURIComponent(expert.id)}`),
      api(`/v1/experts/${encodeURIComponent(expert.id)}/revisions`),
    ]);
    renderExpertDetail(detail, revisionResult.items || []);
  } catch (error) {
    elements.drawerContent.replaceChildren(textElement('p', error.message, 'form-error'));
  }
}

function renderExpertDetail(expert, revisions) {
  elements.drawerTitle.textContent = expert.name;
  elements.drawerContent.replaceChildren(expertDetailHead(expert));

  const summary = element('section', 'expert-summary-panel');
  summary.append(textElement('p', expert.description || expert.mission || '还没有填写专家说明。'));
  if (expert.mission && expert.mission !== expert.description) {
    const mission = element('div', 'expert-mission');
    mission.append(textElement('span', '核心使命'), textElement('strong', expert.mission));
    summary.append(mission);
  }
  const facts = element('dl', 'skill-facts');
  appendFact(facts, '版本', expert.version || '未设置');
  appendFact(facts, '当前修订', String(expert.revision || 1));
  appendFact(facts, '负责人', expert.owner || expert.ownerId || '未指定');
  appendFact(facts, '更新时间', formatDate(expert.updatedAt));
  summary.append(facts);
  elements.drawerContent.append(summary);

  elements.drawerContent.append(expertGovernancePanel(expert));

  const actions = element('div', 'expert-primary-actions');
  const edit = textElement('button', '编辑专家', 'button primary');
  edit.type = 'button';
  edit.addEventListener('click', () => openExpertEditor(expert));
  actions.append(edit);
  if (expert.status !== 'enabled' && expert.status !== 'archived' && (expert.visibility === 'private' || expert.review?.status === 'approved')) {
    const enable = textElement('button', '启用', 'button quiet');
    enable.type = 'button';
    enable.addEventListener('click', () => updateExpertStatus(expert, 'enabled'));
    actions.append(enable);
  } else {
    const disable = textElement('button', '停用', 'button quiet');
    disable.type = 'button';
    disable.addEventListener('click', () => updateExpertStatus(expert, 'disabled'));
    actions.append(disable);
  }
  elements.drawerContent.append(actions);

  const methods = detailSection('工作方法', String((expert.methodology || []).length + (expert.workflow || []).length));
  methods.append(expertListBlock('方法论', expert.methodology), expertListBlock('标准流程', expert.workflow));
  elements.drawerContent.append(methods);

  const capabilities = detailSection('能力与工具');
  capabilities.append(
    expertReferenceBlock('必需 Skill', expert.requiredSkills),
    expertReferenceBlock('推荐 Skill', expert.recommendedSkills),
    expertReferenceBlock('必需工具服务', expert.requiredConnectors),
    expertReferenceBlock('推荐工具服务', expert.recommendedConnectors),
  );
  const toolScope = expertToolScopeBlock(expert.toolSelections);
  if (toolScope) capabilities.append(toolScope);
  elements.drawerContent.append(capabilities);

  const runtime = detailSection('运行策略');
  const runtimeFacts = element('dl', 'expert-runtime-facts');
  appendFact(runtimeFacts, '默认权限', expert.permissionProfile || 'artifact-approval');
  appendFact(runtimeFacts, '工作模式', expert.defaultWorkMode || 'execute');
  appendFact(runtimeFacts, '模型策略', expert.modelPolicy || 'inherit');
  appendFact(runtimeFacts, '分类', expert.category || '未分类');
  runtime.append(runtimeFacts);
  elements.drawerContent.append(runtime);

  const revisionSection = detailSection('修订记录', String(revisions.length));
  const revisionList = element('div', 'expert-revision-list');
  if (!revisions.length) {
    revisionList.append(textElement('p', '还没有修订记录。', 'session-empty'));
  } else {
    for (const revision of revisions) revisionList.append(expertRevisionRow(expert, revision));
  }
  revisionSection.append(revisionList);
  elements.drawerContent.append(revisionSection);

  if (expert.status !== 'archived') {
    const lifecycle = detailSection('生命周期');
    const archive = textElement('button', '归档专家', 'button danger');
    archive.type = 'button';
    archive.addEventListener('click', () => {
      if (window.confirm(`归档“${expert.name}”？归档后不会再分发到桌面端。`)) updateExpertStatus(expert, 'archived');
    });
    lifecycle.append(archive);
    elements.drawerContent.append(lifecycle);
  }
}

function expertGovernancePanel(expert) {
  const panel = element('section', 'expert-governance-panel');
  const heading = element('div', 'expert-governance-heading');
  const copy = element('span');
  copy.append(textElement('strong', '发布治理'), textElement('small', expert.visibility === 'private' ? '个人专家不进入组织审核与灰度分发' : '审核通过后才会按当前分发策略进入桌面端'));
  heading.append(copy, pill(expertReviewLabels[expert.review?.status] || '未提交', `review-${expert.review?.status || 'not-submitted'}`));
  panel.append(heading);

  const facts = element('dl', 'expert-governance-facts');
  appendFact(facts, '审核状态', expertReviewLabels[expert.review?.status] || '未提交');
  appendFact(facts, '分发范围', expertDistributionSummary(expert.distribution));
  if (expert.review?.submittedAt) appendFact(facts, '提交时间', formatDate(expert.review.submittedAt));
  if (expert.review?.reviewedAt) appendFact(facts, '审核时间', formatDate(expert.review.reviewedAt));
  panel.append(facts);
  if (expert.review?.note) panel.append(textElement('p', expert.review.note, 'expert-review-note'));

  if (expert.visibility !== 'private') {
    const actions = element('div', 'expert-governance-actions');
    if (['not_submitted', 'rejected'].includes(expert.review?.status)) {
      const submit = textElement('button', expert.review?.status === 'rejected' ? '重新提交审核' : '提交审核', 'button quiet');
      submit.type = 'button';
      submit.addEventListener('click', () => submitExpertReview(expert));
      actions.append(submit);
    }
    if (expert.review?.status === 'pending') {
      const approve = textElement('button', '通过并发布', 'button primary');
      approve.type = 'button';
      approve.addEventListener('click', () => approveExpertReview(expert));
      const reject = textElement('button', '退回修改', 'button quiet');
      reject.type = 'button';
      reject.addEventListener('click', () => openExpertRejection(expert));
      actions.append(approve, reject);
    }
    const distribution = textElement('button', '设置分发', 'button quiet');
    distribution.type = 'button';
    distribution.addEventListener('click', () => openExpertDistributionEditor(expert));
    actions.append(distribution);
    panel.append(actions);
  }
  return panel;
}

function expertDistributionSummary(distribution = {}) {
  const mode = distribution.mode || 'all';
  if (mode === 'percentage') return `${distribution.percentage || 0}% 用户`;
  if (mode === 'allowlist') return `${distribution.userIds?.length || 0} 位指定用户`;
  return expertDistributionLabels.all;
}

function expertDetailHead(expert) {
  const heading = element('div', 'expert-detail-head');
  heading.append(textElement('span', expert.avatar || initial(expert.name), 'expert-avatar'));
  const copy = element('div', 'expert-detail-copy');
  copy.append(textElement('h3', expert.name), textElement('p', expert.id));
  const badges = element('div', 'expert-badge-row');
  badges.append(
    expertStatusPill(expert.status),
    pill(expertSourceLabels[expert.source?.type] || '个人', 'viewer'),
    pill(expertVisibilityLabels[expert.visibility] || '仅本人', 'viewer'),
  );
  copy.append(badges);
  heading.append(copy);
  return heading;
}

function expertListBlock(label, values = []) {
  const wrapper = element('div', 'expert-list-block');
  wrapper.append(textElement('span', label));
  const list = element('ol');
  if (!values.length) {
    list.append(textElement('li', '未配置', 'muted'));
  } else {
    for (const value of values) list.append(textElement('li', value));
  }
  wrapper.append(list);
  return wrapper;
}

function expertReferenceBlock(label, values = []) {
  const wrapper = element('div', 'expert-reference-block');
  wrapper.append(textElement('span', label));
  const tags = element('div', 'expert-reference-tags');
  if (!values.length) {
    tags.append(textElement('small', '未配置'));
  } else {
    for (const value of values) tags.append(pill(value, 'viewer'));
  }
  wrapper.append(tags);
  return wrapper;
}

function expertToolScopeBlock(toolSelections = {}) {
  const entries = Object.entries(toolSelections || {});
  if (!entries.length) return null;
  const wrapper = element('div', 'expert-tool-scope');
  wrapper.append(textElement('span', '具体工具范围'));
  for (const [connectorID, tools] of entries) {
    const row = element('div');
    row.append(textElement('strong', connectorID), textElement('small', tools.length ? tools.join('、') : '全部工具'));
    wrapper.append(row);
  }
  return wrapper;
}

function expertRevisionRow(expert, revision) {
  const row = element('div', 'expert-revision-row');
  const copy = element('span');
  copy.append(
    textElement('strong', `修订 ${revision.revision} · ${revision.version}`),
    textElement('small', `${revision.createdBy || '未知'} · ${formatDate(revision.createdAt)}`),
  );
  const view = textElement('button', '查看', 'button quiet');
  view.type = 'button';
  view.addEventListener('click', () => openExpertRevision(expert, revision.revision));
  const actions = element('span', 'expert-revision-actions');
  actions.append(view);
  if (revision.revision < expert.revision) {
    const rollback = textElement('button', '回滚', 'button quiet');
    rollback.type = 'button';
    rollback.addEventListener('click', () => rollbackExpertRevision(expert, revision.revision));
    actions.append(rollback);
  }
  row.append(copy, actions);
  return row;
}

async function openExpertRevision(expert, revision) {
  openDrawer(`${expert.name} · 修订 ${revision}`, '专家历史版本');
  elements.drawerContent.append(textElement('p', '正在读取历史版本…', 'drawer-loading'));
  try {
    const record = await api(`/v1/experts/${encodeURIComponent(expert.id)}/revisions/${revision}`);
    elements.drawerContent.replaceChildren();
    const back = textElement('button', '← 返回当前版本', 'button quiet expert-back-button');
    back.type = 'button';
    back.addEventListener('click', () => openExpert(expert));
    elements.drawerContent.append(back, expertDetailHead(record.snapshot));
    const summary = element('section', 'expert-summary-panel');
    summary.append(textElement('p', record.snapshot.description || record.snapshot.mission || '还没有填写专家说明。'));
    const facts = element('dl', 'skill-facts');
    appendFact(facts, '修订', String(record.revision));
    appendFact(facts, '版本', record.version);
    appendFact(facts, '修改人', record.createdBy || '未知');
    appendFact(facts, '修改时间', formatDate(record.createdAt));
    summary.append(facts);
    elements.drawerContent.append(summary);
    const instruction = detailSection('专家指令');
    instruction.append(textElement('pre', record.snapshot.instruction, 'expert-instruction'));
    elements.drawerContent.append(instruction);
    const methods = detailSection('方法、流程与限制');
    methods.append(
      expertListBlock('方法论', record.snapshot.methodology),
      expertListBlock('标准流程', record.snapshot.workflow),
      expertListBlock('边界与限制', record.snapshot.limitations),
    );
    elements.drawerContent.append(methods);
  } catch (error) {
    elements.drawerContent.replaceChildren(textElement('p', error.message, 'form-error'));
  }
}

async function updateExpertStatus(expert, status) {
  try {
    const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/status`, {
      method: 'POST',
      body: { status, baseRevision: expert.revision },
    });
    await loadExperts();
    toast(`专家状态已更新为“${expertStatusLabels[status] || status}”`);
    await openExpert(updated);
  } catch (error) {
    toast(error.message, true);
  }
}

async function submitExpertReview(expert) {
  try {
    const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/submit-review`, { method: 'POST', body: {} });
    await loadExperts();
    toast('专家已进入审核队列');
    await openExpert(updated);
  } catch (error) {
    toast(error.message, true);
  }
}

async function approveExpertReview(expert) {
  if (!window.confirm(`通过“${expert.name}”的审核并立即按当前分发策略发布？`)) return;
  try {
    const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/review`, {
      method: 'POST',
      body: { decision: 'approve', baseRevision: expert.revision },
    });
    await loadExperts();
    toast('专家审核已通过并发布');
    await openExpert(updated);
  } catch (error) {
    toast(error.message, true);
  }
}

function openExpertRejection(expert) {
  openDrawer('退回专家', '审核意见');
  const form = element('form', 'drawer-form expert-governance-form');
  form.innerHTML = `
    <div class="governance-callout"><strong>退回当前专家</strong><span>退回后专家会保持草稿状态，负责人修改后可再次提交。</span></div>
    <label class="field"><span>退回原因</span><textarea name="note" maxlength="500" required placeholder="说明需要补充或修正的内容"></textarea></label>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">确认退回</button></div>
  `;
  elements.drawerContent.append(form);
  form.querySelector('[data-cancel]').addEventListener('click', () => openExpert(expert));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = form.elements.note.value.trim();
    if (!note) return;
    setSubmitting(form, true, '正在退回…');
    try {
      const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/review`, {
        method: 'POST',
        body: { decision: 'reject', note, baseRevision: expert.revision },
      });
      await loadExperts();
      toast('专家已退回修改');
      await openExpert(updated);
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  form.elements.note.focus();
}

function openExpertDistributionEditor(expert) {
  openDrawer('设置专家分发', '灰度与指定用户');
  const current = expert.distribution || { mode: 'all', percentage: 100, userIds: [] };
  const form = element('form', 'drawer-form expert-governance-form');
  form.innerHTML = `
    <div class="governance-callout"><strong>调整当前专家的分发范围</strong><span>分发策略只影响审核通过且已启用的专家，不会改变当前审核状态。</span></div>
    <label class="field"><span>分发方式</span><select name="mode"><option value="all">全部符合范围的用户</option><option value="percentage">按稳定比例灰度</option><option value="allowlist">仅指定用户</option></select></label>
    <label class="field" data-distribution-percentage><span>灰度比例</span><input name="percentage" type="number" min="1" max="100" value="10" /><small>同一用户对同一专家的命中结果保持稳定。</small></label>
    <label class="field" data-distribution-allowlist><span>用户 ID</span><textarea name="userIds" placeholder="每行一个用户 ID"></textarea><small>只允许列表中的用户获取该专家。</small></label>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存分发策略</button></div>
  `;
  form.elements.mode.value = current.mode || 'all';
  form.elements.percentage.value = current.percentage || 10;
  form.elements.userIds.value = listValue(current.userIds);
  const syncFields = () => {
    form.querySelector('[data-distribution-percentage]').hidden = form.elements.mode.value !== 'percentage';
    form.querySelector('[data-distribution-allowlist]').hidden = form.elements.mode.value !== 'allowlist';
  };
  form.elements.mode.addEventListener('change', syncFields);
  syncFields();
  form.querySelector('[data-cancel]').addEventListener('click', () => openExpert(expert));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setInlineFormError(form);
    const mode = form.elements.mode.value;
    const payload = { mode, baseRevision: expert.revision };
    if (mode === 'percentage') payload.percentage = Number(form.elements.percentage.value);
    if (mode === 'allowlist') payload.userIds = parseListValue(form.elements.userIds.value);
    setSubmitting(form, true, '正在保存…');
    try {
      const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/distribution`, {
        method: 'PUT',
        body: payload,
      });
      await loadExperts();
      toast('专家分发策略已更新');
      await openExpert(updated);
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  elements.drawerContent.append(form);
}

async function rollbackExpertRevision(expert, revision) {
  if (!window.confirm(`将“${expert.name}”恢复为修订 ${revision} 的内容？系统会保留当前分发策略并创建一个新修订。`)) return;
  try {
    const updated = await api(`/v1/experts/${encodeURIComponent(expert.id)}/rollback/${revision}`, {
      method: 'POST',
      body: { baseRevision: expert.revision },
    });
    await loadExperts();
    toast(`已恢复修订 ${revision}，当前为修订 ${updated.revision}`);
    await openExpert(updated);
  } catch (error) {
    toast(error.message, true);
  }
}

function openExpertEditor(expert = null) {
  openDrawer(expert ? '编辑专家' : '新建专家', expert ? `修订 ${expert.revision}` : '远程专家定义');
  const form = buildExpertForm(expert);
  elements.drawerContent.append(form);
  form.querySelector('[name="name"]').focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setInlineFormError(form);
    if (!form.reportValidity()) return;
    setSubmitting(form, true, expert ? '正在保存…' : '正在创建…');
    try {
      const payload = expertFormPayload(form, expert);
      const saved = await api(expert ? `/v1/experts/${encodeURIComponent(expert.id)}` : '/v1/experts', {
        method: expert ? 'PUT' : 'POST',
        body: payload,
      });
      await loadExperts();
      const needsReview = saved.visibility !== 'private' && saved.review?.status === 'not_submitted';
      toast(needsReview ? '专家修订已保存，请提交审核' : expert ? '专家修订已保存' : '专家已创建');
      await openExpert(saved);
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
}

function buildExpertForm(expert = null) {
  const form = element('form', 'drawer-form expert-editor-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="expert-editor-intro">
      <span class="expert-editor-intro-mark">专</span>
      <span><strong>${expert ? '调整专家职责与能力组合' : '创建一位可复用的气象专家'}</strong><small>先定义这位专家解决什么问题，再从已发布 Skill 中选择能力。运行参数放在高级设置中。</small></span>
    </div>
    <details class="expert-form-section" open>
      <summary>专家档案</summary>
      <div class="expert-form-section-content">
        <div class="field-row">
          <label class="field"><span>专家名称</span><input name="name" maxlength="120" required /></label>
          <label class="field"><span>头像文字</span><input name="avatar" maxlength="8" placeholder="形" /></label>
        </div>
        <div class="field-row">
          <label class="field"><span>分类</span><input name="category" placeholder="天气分析" /></label>
          <label class="field"><span>可见范围</span><select name="visibility"><option value="organization">组织</option><option value="public">系统公开</option><option value="private">私有</option></select></label>
        </div>
        <label class="field"><span>简短说明</span><textarea name="description" placeholder="说明这位专家擅长解决什么问题"></textarea></label>
        <label class="field"><span>核心使命</span><textarea name="mission" placeholder="定义稳定、可验证的交付目标"></textarea></label>
        <label class="field"><span>标签</span><input name="tags" placeholder="形势分析, 预报会商" /></label>
      </div>
    </details>
    <details class="expert-form-section" open>
      <summary>工作方式</summary>
      <div class="expert-form-section-content">
        <label class="field"><span>专家指令</span><textarea class="expert-instruction-input" name="instruction" required placeholder="定义职责、判断原则、工具使用与完成标准"></textarea></label>
        <label class="field"><span>方法论，每行一项</span><textarea name="methodology"></textarea></label>
        <label class="field"><span>标准流程，每行一项</span><textarea name="workflow"></textarea></label>
        <label class="field"><span>边界与限制，每行一项</span><textarea name="limitations"></textarea></label>
      </div>
    </details>
    <details class="expert-form-section">
      <summary>输入、输出与常用提示</summary>
      <div class="expert-form-section-content">
        <label class="field"><span>输入要求，每行一项</span><textarea name="inputs"></textarea></label>
        <label class="field"><span>输出成果，每行一项</span><textarea name="outputs"></textarea></label>
        <label class="field"><span>常用提示，每行一项</span><textarea name="prompts"></textarea></label>
      </div>
    </details>
    <details class="expert-form-section" open>
      <summary>Skill 能力组合</summary>
      <div class="expert-form-section-content">
        <div class="expert-skill-picker" data-expert-skill-picker>
          <header>
            <span><strong>选择已发布 Skill</strong><small>必需能力会随专家强制加载；推荐能力由任务场景按需使用。</small></span>
            <span class="expert-skill-count" data-expert-skill-count>已选 0</span>
          </header>
          <label class="expert-skill-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" data-expert-skill-search placeholder="搜索 Skill 名称、分类或说明" />
          </label>
          <div class="expert-skill-list" data-expert-skill-list></div>
          <input type="hidden" name="requiredSkills" />
          <input type="hidden" name="recommendedSkills" />
        </div>
      </div>
    </details>
    <details class="expert-form-section">
      <summary>高级设置</summary>
      <div class="expert-form-section-content">
        <div class="field-row">
          <label class="field"><span>专家 ID</span><input name="id" pattern="[a-z0-9][a-z0-9._-]{2,127}" required readonly /><small>创建时自动生成，保存后保持稳定。</small></label>
          <label class="field"><span>版本</span><input name="version" maxlength="64" required /><small>专家定义发生兼容性变化时再升级版本。</small></label>
        </div>
        <div class="field-row">
          <label class="field"><span>必需工具服务 ID</span><textarea name="requiredConnectors" placeholder="每行一个"></textarea></label>
          <label class="field"><span>推荐工具服务 ID</span><textarea name="recommendedConnectors" placeholder="每行一个"></textarea></label>
        </div>
        <label class="field"><span>具体工具范围</span><textarea name="toolSelections" placeholder="每行格式：服务ID: 工具一, 工具二"></textarea><small>未列出的已选工具服务默认允许其全部工具。</small></label>
        <div class="expert-editor-grid">
          <label class="field"><span>权限策略</span><input name="permissionProfile" /></label>
          <label class="field"><span>工作模式</span><select name="defaultWorkMode"><option value="execute">执行</option><option value="plan">规划</option><option value="ask">问答</option></select></label>
          <label class="field"><span>模型策略</span><input name="modelPolicy" /></label>
        </div>
        <label class="field"><span>输入 Schema JSON</span><textarea name="inputSchema" spellcheck="false"></textarea></label>
        <label class="field"><span>输出 Schema JSON</span><textarea name="outputSchema" spellcheck="false"></textarea></label>
      </div>
    </details>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">${expert ? '保存新修订' : '创建专家'}</button></div>
  `;
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  const defaults = expert || {
    id: generatedExpertID(),
    version: '1.0.0',
    status: 'draft',
    visibility: 'organization',
    permissionProfile: 'artifact-approval',
    defaultWorkMode: 'execute',
    modelPolicy: 'inherit',
  };
  for (const name of ['id', 'name', 'version', 'avatar', 'visibility', 'category', 'description', 'mission', 'instruction', 'permissionProfile', 'defaultWorkMode', 'modelPolicy']) {
    if (defaults[name] !== undefined) form.elements[name].value = defaults[name];
  }
  form.elements.tags.value = Array.isArray(defaults.tags) ? defaults.tags.join(', ') : '';
  for (const name of ['methodology', 'workflow', 'limitations', 'inputs', 'outputs', 'prompts', 'requiredConnectors', 'recommendedConnectors']) {
    form.elements[name].value = listValue(defaults[name]);
  }
  initializeExpertSkillPicker(form, defaults.requiredSkills, defaults.recommendedSkills);
  form.elements.toolSelections.value = toolSelectionValue(defaults.toolSelections);
  form.elements.inputSchema.value = schemaValue(defaults.inputSchema);
  form.elements.outputSchema.value = schemaValue(defaults.outputSchema);
  return form;
}

function generatedExpertID() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `expert-${date}-${time}`;
}

function initializeExpertSkillPicker(form, requiredValues = [], recommendedValues = []) {
  const picker = form.querySelector('[data-expert-skill-picker]');
  const list = picker.querySelector('[data-expert-skill-list]');
  const search = picker.querySelector('[data-expert-skill-search]');
  const count = picker.querySelector('[data-expert-skill-count]');
  const assignments = new Map();
  for (const skillID of requiredValues || []) assignments.set(skillID, 'required');
  for (const skillID of recommendedValues || []) {
    if (!assignments.has(skillID)) assignments.set(skillID, 'recommended');
  }

  const published = state.skills
    .filter((skill) => skill.status === 'published' && skill.latestVersion)
    .map((skill) => ({ ...skill, available: true }));
  const known = new Set(published.map((skill) => skill.id));
  for (const skillID of assignments.keys()) {
    if (!known.has(skillID)) {
      published.push({
        id: skillID,
        name: skillID,
        summary: '该 Skill 当前未发布，请移除或先到 Skill 管理完成发布。',
        categories: [],
        available: false,
      });
    }
  }

  const sync = () => {
    const required = [];
    const recommended = [];
    for (const [skillID, mode] of assignments) {
      if (mode === 'required') required.push(skillID);
      if (mode === 'recommended') recommended.push(skillID);
    }
    form.elements.requiredSkills.value = required.join('\n');
    form.elements.recommendedSkills.value = recommended.join('\n');
    const total = required.length + recommended.length;
    count.textContent = total ? `已选 ${total} · 必需 ${required.length} · 推荐 ${recommended.length}` : '已选 0';
  };

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const visible = published
      .filter((skill) => {
        const searchable = [
          skill.name,
          skill.id,
          skill.summary,
          ...(skill.categories || []),
          ...(skill.tags || []),
        ].join(' ').toLowerCase();
        return !query || searchable.includes(query);
      })
      .sort((left, right) => {
        const leftSelected = assignments.has(left.id) ? 0 : 1;
        const rightSelected = assignments.has(right.id) ? 0 : 1;
        return leftSelected - rightSelected || left.name.localeCompare(right.name, 'zh-CN');
      });
    list.replaceChildren();
    if (!visible.length) {
      list.append(textElement('p', published.length ? '没有匹配的 Skill。' : '还没有已发布的 Skill，请先到 Skill 管理上传并发布。', 'expert-skill-empty'));
      return;
    }
    for (const skill of visible) {
      const mode = assignments.get(skill.id) || '';
      const row = element('div', `expert-skill-row${mode ? ' selected' : ''}${skill.available ? '' : ' unavailable'}`);
      const identity = element('div', 'expert-skill-identity');
      identity.append(textElement('span', skill.icon || initial(skill.name), 'expert-skill-avatar'));
      const copy = element('span', 'expert-skill-copy');
      copy.append(textElement('strong', skill.name), textElement('small', skill.summary || '暂无说明'));
      const metadata = element('span', 'expert-skill-meta');
      metadata.append(
        textElement('span', skill.id),
        textElement('span', skill.available ? (skill.categories?.[0] || '未分类') : '当前不可用'),
        ...(skill.latestVersion ? [textElement('span', `v${skill.latestVersion}`)] : []),
      );
      copy.append(metadata);
      identity.append(copy);
      const choices = element('div', 'expert-skill-choices');
      if (!skill.available) {
        const remove = textElement('button', '移除', 'expert-skill-choice remove');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          assignments.delete(skill.id);
          sync();
          render();
        });
        choices.append(remove);
      } else {
        for (const choice of [
          { value: 'required', label: '必需' },
          { value: 'recommended', label: '推荐' },
        ]) {
          const button = textElement('button', choice.label, `expert-skill-choice${mode === choice.value ? ` active ${choice.value}` : ''}`);
          button.type = 'button';
          button.setAttribute('aria-pressed', String(mode === choice.value));
          button.addEventListener('click', () => {
            if (assignments.get(skill.id) === choice.value) assignments.delete(skill.id);
            else assignments.set(skill.id, choice.value);
            sync();
            render();
          });
          choices.append(button);
        }
      }
      row.append(identity, choices);
      list.append(row);
    }
  };

  search.addEventListener('input', render);
  sync();
  render();
}

function expertFormPayload(form, expert) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    ...(expert || {}),
    id: expert?.id || data.id.trim(),
    name: data.name.trim(),
    version: data.version.trim(),
    avatar: data.avatar.trim(),
    status: expert?.status || 'draft',
    visibility: data.visibility,
    category: data.category.trim(),
    description: data.description.trim(),
    mission: data.mission.trim(),
    tags: parseListValue(data.tags),
    instruction: data.instruction.trim(),
    methodology: parseListValue(data.methodology),
    workflow: parseListValue(data.workflow),
    limitations: parseListValue(data.limitations),
    inputs: parseListValue(data.inputs),
    outputs: parseListValue(data.outputs),
    prompts: parseListValue(data.prompts),
    requiredSkills: parseListValue(data.requiredSkills),
    recommendedSkills: parseListValue(data.recommendedSkills),
    requiredConnectors: parseListValue(data.requiredConnectors),
    recommendedConnectors: parseListValue(data.recommendedConnectors),
    toolSelections: parseToolSelections(data.toolSelections),
    permissionProfile: data.permissionProfile.trim(),
    defaultWorkMode: data.defaultWorkMode,
    modelPolicy: data.modelPolicy.trim(),
    inputSchema: parseSchemaValue(data.inputSchema, '输入 Schema'),
    outputSchema: parseSchemaValue(data.outputSchema, '输出 Schema'),
    ...(expert ? { baseRevision: expert.revision } : {}),
  };
}

function listValue(values = []) {
  return Array.isArray(values) ? values.join('\n') : '';
}

function parseListValue(value) {
  return [...new Set(String(value || '').split(/[\n,，]/).map((item) => item.trim()).filter(Boolean))];
}

function toolSelectionValue(value = {}) {
  return Object.entries(value || {}).map(([connectorID, tools]) => `${connectorID}: ${(tools || []).join(', ')}`).join('\n');
}

function parseToolSelections(value) {
  const selections = {};
  for (const line of String(value || '').split('\n').map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('=');
    if (separator < 1) throw new Error(`具体工具范围格式不正确：${line}`);
    const connectorID = line.slice(0, separator).trim();
    selections[connectorID] = parseListValue(line.slice(separator + 1));
  }
  return selections;
}

function schemaValue(value) {
  if (!value || !Object.keys(value).length) return '';
  return JSON.stringify(value, null, 2);
}

function parseSchemaValue(value, label) {
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} 必须是有效的 JSON 对象`);
  }
}

async function openSkill(skill) {
  openDrawer(skill.name, 'Skill 详情与版本');
  elements.drawerContent.append(textElement('p', '正在读取 Skill 详情…', 'drawer-loading'));
  try {
    const result = await api(`/v1/skills/${encodeURIComponent(skill.id)}`);
    renderSkillDetail(result.skill, result.versions || []);
  } catch (error) {
    elements.drawerContent.replaceChildren(textElement('p', error.message, 'form-error'));
  }
}

function renderSkillDetail(skill, versions) {
  elements.drawerTitle.textContent = skill.name;
  elements.drawerContent.replaceChildren();
  const heading = element('div', 'skill-detail-head');
  heading.append(textElement('span', skill.icon || initial(skill.name), 'skill-avatar'));
  const copy = element('div', 'skill-detail-copy');
  copy.append(textElement('h3', skill.name), textElement('p', skill.id));
  const badges = element('div', 'skill-badge-row');
  badges.append(skillStatusPill(skill.status), pill(visibilityLabels[skill.visibility] || skill.visibility, 'viewer'));
  if (skill.featured) badges.append(pill('精选', 'featured'));
  copy.append(badges);
  heading.append(copy);
  elements.drawerContent.append(heading);

  const summary = element('section', 'skill-summary-panel');
  summary.append(textElement('p', skill.summary || skill.description || '还没有填写 Skill 摘要。'));
  const facts = element('dl', 'skill-facts');
  appendFact(facts, '当前版本', skill.latestVersion || '尚未发布');
  appendFact(facts, '负责人', skill.publisher?.name || skill.ownerId || '未指定');
  appendFact(facts, '下载次数', String(skill.downloads || 0));
  appendFact(facts, '更新时间', formatDate(skill.updatedAt));
  summary.append(facts);
  elements.drawerContent.append(summary);

  const metadata = detailSection('资料与范围');
  const tags = element('div', 'skill-tag-list');
  for (const label of [...(skill.categories || []), ...(skill.tags || [])]) tags.append(pill(label, 'viewer'));
  if (!tags.childElementCount) tags.append(textElement('span', '暂无分类或标签', 'session-empty'));
  metadata.append(tags);
  const edit = textElement('button', '编辑资料', 'button quiet');
  edit.type = 'button';
  edit.addEventListener('click', () => openSkillEditor(skill));
  metadata.append(edit);
  elements.drawerContent.append(metadata);

  const versionSection = detailSection('版本记录', String(versions.length));
  const versionList = element('div', 'skill-version-list');
  if (!versions.length) {
    versionList.append(textElement('p', '还没有上传版本。', 'session-empty'));
  } else {
    for (const version of versions) versionList.append(skillVersionRow(skill, version));
  }
  versionSection.append(versionList);
  elements.drawerContent.append(versionSection);
}

function appendFact(list, label, value) {
  const item = document.createElement('div');
  item.append(textElement('dt', label), textElement('dd', value));
  list.append(item);
}

function skillVersionRow(skill, version) {
  const row = element('article', 'skill-version-row');
  const header = element('div', 'skill-version-header');
  const identity = element('div', 'skill-version-identity');
  identity.append(textElement('strong', version.version), skillStatusPill(version.status));
  identity.append(textElement('small', version.changelog || `上传于 ${formatDate(version.createdAt)}`));
  header.append(identity, pill(riskLabels[version.risk?.level] || '风险未知', `risk-${version.risk?.level || 'unknown'}`));
  row.append(header);
  const meta = textElement('p', `${formatFileSize(version.packageSize)} · ${version.files?.length || 0} 个文件 · ${version.integrity || '未记录完整性'}`, 'skill-version-meta');
  row.append(meta);
  if (version.warnings?.length) {
    const warnings = element('ul', 'skill-warning-list');
    for (const warning of version.warnings) warnings.append(textElement('li', warning));
    row.append(warnings);
  }
  const actions = element('div', 'skill-version-actions');
  if (version.status === 'draft') {
    const publish = textElement('button', '发布版本', 'button primary');
    publish.type = 'button';
    publish.addEventListener('click', () => changeSkillVersionStatus(skill, version, 'publish'));
    actions.append(publish);
  }
  if (version.status === 'pending_review') {
    const approve = textElement('button', '批准发布', 'button primary');
    approve.type = 'button';
    approve.addEventListener('click', () => changeSkillVersionStatus(skill, version, 'publish'));
    const reject = textElement('button', '退回修改', 'button danger');
    reject.type = 'button';
    reject.addEventListener('click', () => rejectSkillVersion(skill, version));
    actions.append(reject, approve);
  }
  if (version.status === 'published') {
    const deprecate = textElement('button', '弃用版本', 'button danger');
    deprecate.type = 'button';
    deprecate.addEventListener('click', () => changeSkillVersionStatus(skill, version, 'deprecate'));
    actions.append(deprecate);
  }
  if (actions.childElementCount) row.append(actions);
  return row;
}

async function rejectSkillVersion(skill, version) {
  const note = window.prompt(`退回 ${skill.name} ${version.version} 的原因`, version.reviewNote || '请补充发布说明后重新提交');
  if (note === null) return;
  try {
    await api(`/v1/skills/${encodeURIComponent(skill.id)}/versions/${encodeURIComponent(version.version)}/reject`, { method: 'POST', body: { note } });
    await Promise.all([loadSkills(), loadGovernance()]);
    const updated = state.skills.find((item) => item.id === skill.id) || skill;
    await openSkill(updated);
    toast('版本已退回修改');
  } catch (error) {
    toast(error.message, true);
  }
}

async function changeSkillVersionStatus(skill, version, action) {
  const publishing = action === 'publish';
  if (!window.confirm(`${publishing ? '发布' : '弃用'} ${skill.name} ${version.version}？`)) return;
  try {
    await api(`/v1/skills/${encodeURIComponent(skill.id)}/versions/${encodeURIComponent(version.version)}/${action}`, { method: 'POST' });
    await loadSkills();
    const updated = state.skills.find((item) => item.id === skill.id) || skill;
    await openSkill(updated);
    toast(publishing ? 'Skill 版本已发布' : 'Skill 版本已弃用');
  } catch (error) {
    toast(error.message, true);
  }
}

function openSkillEditor(skill) {
  openDrawer(skill.name, '编辑 Skill 资料');
  const form = element('form', 'drawer-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="field-row">
      <label class="field"><span>显示名称</span><input name="name" required maxlength="120" /></label>
      <label class="field"><span>图标文字</span><input name="icon" maxlength="16" /></label>
    </div>
    <label class="field"><span>摘要</span><textarea name="summary" rows="3" maxlength="300"></textarea></label>
    <label class="field"><span>详细说明</span><textarea name="description" rows="6" maxlength="4000"></textarea></label>
    <div class="field-row">
      <label class="field"><span>分类</span><textarea name="categories" rows="3" placeholder="每行一个分类"></textarea></label>
      <label class="field"><span>标签</span><textarea name="tags" rows="3" placeholder="每行一个标签"></textarea></label>
    </div>
    <div class="field-row">
      <label class="field"><span>可见范围</span><select name="visibility"><option value="public">公开</option><option value="organization">组织</option><option value="private">私有</option></select></label>
      <label class="field"><span>负责人</span><select name="ownerId"></select></label>
    </div>
    <div class="field-row">
      <label class="check-row"><input type="checkbox" name="featured" /><span><strong>设为精选</strong><small>加入精选集合并提高默认推荐分数。</small></span></label>
      <label class="field"><span>精选顺序</span><input name="featuredRank" type="number" min="0" max="999" placeholder="0 表示自动排序" /></label>
    </div>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存资料</button></div>
  `;
  form.elements.name.value = skill.name || '';
  form.elements.icon.value = skill.icon || '';
  form.elements.summary.value = skill.summary || '';
  form.elements.description.value = skill.description || '';
  form.elements.categories.value = (skill.categories || []).join('\n');
  form.elements.tags.value = (skill.tags || []).join('\n');
  form.elements.visibility.value = skill.visibility || 'private';
  form.elements.featured.checked = Boolean(skill.featured);
  form.elements.featuredRank.value = skill.featuredRank || '';
  fillOwnerSelect(form.elements.ownerId, skill.ownerId);
  form.querySelector('[data-cancel]').addEventListener('click', () => openSkill(skill));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true, '正在保存…');
    try {
      const data = {
        name: form.elements.name.value.trim(), icon: form.elements.icon.value.trim(),
        summary: form.elements.summary.value.trim(), description: form.elements.description.value.trim(),
        categories: splitList(form.elements.categories.value), tags: splitList(form.elements.tags.value),
        visibility: form.elements.visibility.value,
        featured: form.elements.featured.checked,
        featuredRank: form.elements.featured.checked ? Number(form.elements.featuredRank.value || 0) : 0,
      };
      if (form.elements.ownerId.value !== skill.ownerId) data.ownerId = form.elements.ownerId.value;
      const updated = await api(`/v1/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', body: data });
      await loadSkills();
      await openSkill(updated);
      toast('Skill 资料已保存');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  elements.drawerContent.append(form);
  form.elements.name.focus();
}

function fillOwnerSelect(select, ownerId) {
  select.replaceChildren();
  const owners = state.users.filter((user) => user.status === 'active' && ['publisher', 'admin'].includes(user.role));
  if (ownerId && !owners.some((user) => user.id === ownerId)) {
    const current = new Option(`当前负责人（${ownerId}）`, ownerId);
    select.append(current);
  }
  for (const user of owners) select.append(new Option(`${user.displayName || user.username} · ${roleLabels[user.role]}`, user.id));
  select.value = ownerId || owners[0]?.id || '';
}

function openSkillUpload() {
  openDrawer('上传 Skill', '包检查与草稿创建');
  const form = element('form', 'drawer-form upload-drop-form');
  form.noValidate = true;
  form.innerHTML = `
    <label class="upload-drop"><input name="package" type="file" accept=".zip,application/zip" required /><span aria-hidden="true">ZIP</span><strong>选择 Skill 压缩包</strong><small>系统会先检查 SKILL.md、清单、依赖和风险，不会直接发布。</small></label>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">检查压缩包</button></div>
  `;
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = form.elements.package.files[0];
    if (!file) return setInlineFormError(form, '请选择一个 Skill ZIP 压缩包');
    setSubmitting(form, true, '正在检查…');
    try {
      const body = new FormData();
      body.append('package', file);
      const report = await apiMultipart('/v1/packages/inspect', body);
      showSkillInspection(file, report);
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  elements.drawerContent.append(form);
  form.elements.package.focus();
}

function showSkillInspection(file, report) {
  elements.drawerTitle.textContent = report.skill?.displayName || report.skill?.name || '检查结果';
  elements.drawerEyebrow.textContent = '检查通过，保存为草稿';
  elements.drawerContent.replaceChildren();
  const result = element('section', 'inspection-result');
  const head = element('div', 'inspection-head');
  head.append(textElement('span', '通过', 'inspection-mark'));
  const copy = element('div');
  copy.append(textElement('h3', `${report.skill?.id || report.skill?.name} · ${report.skill?.version || ''}`), textElement('p', `${report.files?.length || 0} 个文件 · ${riskLabels[report.risk?.level] || '风险未知'} · ${report.integrity || '未记录完整性'}`));
  head.append(copy);
  result.append(head);
  if (report.warnings?.length) {
    const warnings = element('ul', 'skill-warning-list');
    for (const warning of report.warnings) warnings.append(textElement('li', warning));
    result.append(warnings);
  }
  elements.drawerContent.append(result);

  const form = element('form', 'drawer-form inspection-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="field-row">
      <label class="field"><span>显示名称</span><input name="name" required maxlength="120" /></label>
      <label class="field"><span>图标文字</span><input name="icon" maxlength="16" /></label>
    </div>
    <label class="field"><span>摘要</span><textarea name="summary" rows="3" maxlength="300"></textarea></label>
    <label class="field"><span>详细说明</span><textarea name="description" rows="5" maxlength="4000"></textarea></label>
    <div class="field-row">
      <label class="field"><span>分类</span><textarea name="categories" rows="3" placeholder="每行一个分类"></textarea></label>
      <label class="field"><span>标签</span><textarea name="tags" rows="3" placeholder="每行一个标签"></textarea></label>
    </div>
    <div class="field-row">
      <label class="field"><span>可见范围</span><select name="visibility"><option value="organization">组织</option><option value="private">私有</option><option value="public">公开</option></select></label>
      <label class="field"><span>版本说明</span><input name="changelog" maxlength="300" /></label>
    </div>
    <label class="check-row"><input type="checkbox" name="featured" /><span><strong>设为精选</strong><small>保存后可继续在详情中发布该版本。</small></span></label>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-back>重新选择</button><button class="button primary" type="submit">保存草稿</button></div>
  `;
  form.elements.name.value = report.skill?.displayName || report.skill?.name || '';
  form.elements.summary.value = report.skill?.description || '';
  form.elements.description.value = report.skill?.description || '';
  form.elements.categories.value = (report.sidecar?.categories || []).join('\n');
  form.elements.tags.value = (report.sidecar?.tags || []).join('\n');
  form.querySelector('[data-back]').addEventListener('click', openSkillUpload);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true, '正在保存…');
    try {
      const metadata = {
        name: form.elements.name.value.trim(), icon: form.elements.icon.value.trim(),
        summary: form.elements.summary.value.trim(), description: form.elements.description.value.trim(),
        categories: splitList(form.elements.categories.value), tags: splitList(form.elements.tags.value),
        visibility: form.elements.visibility.value, changelog: form.elements.changelog.value.trim(), featured: form.elements.featured.checked,
      };
      const body = new FormData();
      body.append('package', file);
      body.append('metadata', JSON.stringify(metadata));
      const skillID = report.skill?.id || report.skill?.name;
      const created = await apiMultipart(`/v1/skills/${encodeURIComponent(skillID)}/versions`, body);
      await loadSkills();
      await openSkill(created.skill);
      toast('Skill 版本已保存为草稿');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  elements.drawerContent.append(form);
  form.elements.name.focus();
}

function splitList(value) {
  return [...new Set(String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadOperations() {
  try {
    const [collections, rules] = await Promise.all([
      api('/v1/collections'),
      api('/v1/admin/recommendation-rules'),
    ]);
    state.collections = collections.items || [];
    state.recommendationRules = rules.items || [];
    renderOperations();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderOperations() {
  const customCollections = state.collections.filter((item) => item.id !== 'featured');
  setText('operation-metric-collections', customCollections.length);
  setText('operation-metric-rules', state.recommendationRules.length);
  setText('operation-metric-featured', state.skills.filter((skill) => skill.featured).length);
  setText('operation-metric-enabled', state.recommendationRules.filter((rule) => rule.enabled).length);
  setText('rule-count', `${state.recommendationRules.length} 条`);
  renderCollections();
  renderRecommendationRules();
}

function renderCollections() {
  elements.collectionsList.replaceChildren();
  elements.collectionsEmpty.hidden = state.collections.length > 0;
  for (const collection of state.collections) {
    const item = element('article', 'operation-item');
    const head = element('div', 'operation-item-head');
    const copy = element('div');
    const title = element('div', 'operation-title');
    title.append(textElement('h4', collection.name));
    if (collection.id === 'featured') title.append(pill('系统精选', 'featured'));
    else if (collection.featured) title.append(pill('推荐套件', 'featured'));
    copy.append(title, textElement('p', collection.description || '暂无套件说明'));
    head.append(copy, actionButton('管理', `管理套件 ${collection.name}`, () => {
      if (collection.id === 'featured') openFeaturedPlacements();
      else openCollectionEditor(collection);
    }));
    item.append(head);
    const skills = element('div', 'operation-tags');
    const refs = collection.skills || [];
    for (const ref of refs.slice(0, 4)) {
      const skill = state.skills.find((candidate) => candidate.id === ref.skillId);
      skills.append(textElement('span', skill?.name || ref.skillId));
    }
    if (refs.length > 4) skills.append(textElement('span', `+${refs.length - 4}`));
    if (!refs.length) skills.append(textElement('span', '空套件', 'muted-tag'));
    item.append(skills, textElement('small', `${refs.length} 个 Skill · 更新于 ${formatDate(collection.updatedAt)}`, 'operation-meta'));
    elements.collectionsList.append(item);
  }
}

function renderRecommendationRules() {
  elements.rulesList.replaceChildren();
  elements.rulesEmpty.hidden = state.recommendationRules.length > 0;
  for (const rule of state.recommendationRules) {
    const item = element('article', 'operation-item');
    const head = element('div', 'operation-item-head');
    const copy = element('div');
    const title = element('div', 'operation-title');
    title.append(textElement('h4', rule.name), pill(rule.enabled ? '已启用' : '已停用', rule.enabled ? 'skill-published' : 'skill-deprecated'));
    copy.append(title, textElement('p', rule.description || recommendationRuleSummary(rule)));
    head.append(copy, actionButton('管理', `管理规则 ${rule.name}`, () => openRecommendationRuleEditor(rule)));
    item.append(head);
    const facts = element('div', 'operation-tags');
    facts.append(textElement('span', `优先级 ${rule.priority || 0}`));
    if (rule.action?.pin) facts.append(textElement('span', '置顶'));
    if (rule.action?.exclude) facts.append(textElement('span', '排除'));
    if (rule.action?.scoreBoost) facts.append(textElement('span', `${rule.action.scoreBoost > 0 ? '+' : ''}${rule.action.scoreBoost} 分`));
    item.append(facts, textElement('small', `更新于 ${formatDate(rule.updatedAt)}`, 'operation-meta'));
    elements.rulesList.append(item);
  }
}

function recommendationRuleSummary(rule) {
  const matches = [
    ...(rule.match?.skillIds || []),
    ...(rule.match?.skillCategories || []),
    ...(rule.match?.queryTerms || []),
  ];
  return matches.length ? `匹配 ${matches.slice(0, 3).join('、')}` : '匹配全部已发布 Skill';
}

function publishedSkills() {
  return state.skills.filter((skill) => skill.status === 'published' && skill.latestVersion);
}

function buildOrderedSkillPicker(selectedRefs = []) {
  const selected = new Map(selectedRefs.map((ref, index) => [ref.skillId, { index: index + 1, version: ref.version }]));
  const list = element('div', 'ordered-skill-list');
  const skills = publishedSkills();
  for (const skill of skills) {
    const current = selected.get(skill.id);
    const row = element('label', 'ordered-skill-row');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'skillId';
    checkbox.value = skill.id;
    checkbox.checked = Boolean(current);
    const copy = element('span');
    copy.append(textElement('strong', skill.name), textElement('small', `${skill.id} · ${skill.latestVersion}`));
    const order = element('input', 'skill-order-input');
    order.type = 'number';
    order.name = `order-${skill.id}`;
    order.min = '1';
    order.max = String(Math.max(skills.length, 1));
    order.value = String(current?.index || selected.size + 1);
    order.disabled = !checkbox.checked;
    order.setAttribute('aria-label', `${skill.name} 的展示顺序`);
    checkbox.addEventListener('change', () => { order.disabled = !checkbox.checked; });
    row.append(checkbox, copy, order);
    list.append(row);
  }
  return list;
}

function selectedSkillRefs(list) {
  return [...list.querySelectorAll('input[name="skillId"]:checked')]
    .map((input) => ({
      skillId: input.value,
      version: state.skills.find((skill) => skill.id === input.value)?.latestVersion || '',
      order: Number(list.querySelector(`[name="order-${CSS.escape(input.value)}"]`)?.value || 999),
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ skillId, version }) => ({ skillId, version }));
}

function openCollectionEditor(collection = null) {
  const creating = !collection;
  openDrawer(creating ? '新建 Skill 套件' : collection.name, creating ? '内容运营 · 创建套件' : '内容运营 · 编辑套件');
  const form = element('form', 'drawer-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="field-row">
      <label class="field"><span>套件 ID</span><input name="id" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="weekly-forecast-kit" /></label>
      <label class="field"><span>套件名称</span><input name="name" required maxlength="120" /></label>
    </div>
    <label class="field"><span>套件说明</span><textarea name="description" rows="4" maxlength="500"></textarea></label>
    <label class="check-row"><input type="checkbox" name="featured" /><span><strong>推荐此套件</strong><small>推荐套件会在套件列表中优先展示。</small></span></label>
    <section class="selection-section"><header><div><h4>包含的 Skill</h4><p>勾选后填写顺序，数字越小越靠前。</p></div><span>${publishedSkills().length} 个可选</span></header></section>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button danger" type="button" data-delete ${creating ? 'hidden' : ''}>删除套件</button><span class="drawer-action-spacer"></span><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存套件</button></div>
  `;
  form.elements.id.value = collection?.id || '';
  form.elements.id.disabled = !creating;
  form.elements.name.value = collection?.name || '';
  form.elements.description.value = collection?.description || '';
  form.elements.featured.checked = Boolean(collection?.featured);
  const selection = form.querySelector('.selection-section');
  const picker = buildOrderedSkillPicker(collection?.skills || []);
  selection.append(picker);
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setSubmitting(form, true, '正在保存…');
    setInlineFormError(form, '');
    try {
      const id = creating ? form.elements.id.value.trim() : collection.id;
      await api(`/v1/collections/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: {
          name: form.elements.name.value.trim(),
          description: form.elements.description.value.trim(),
          featured: form.elements.featured.checked,
          skills: selectedSkillRefs(picker),
        },
      });
      await loadOperations();
      closeDrawer();
      toast(creating ? 'Skill 套件已创建' : 'Skill 套件已保存');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  form.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!window.confirm(`删除套件“${collection?.name}”？`)) return;
    try {
      await api(`/v1/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
      await loadOperations();
      closeDrawer();
      toast('Skill 套件已删除');
    } catch (error) {
      setInlineFormError(form, error.message);
    }
  });
  elements.drawerContent.append(form);
  form.elements[creating ? 'id' : 'name'].focus();
}

function openFeaturedPlacements() {
  openDrawer('精选 Skill', '内容运营 · 精选位与人工置顶');
  const form = element('form', 'drawer-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="drawer-note"><strong>统一管理精选位</strong><span>保存时会原子更新全部精选状态，避免部分成功导致顺序混乱。</span></div>
    <section class="selection-section"><header><div><h4>精选顺序</h4><p>勾选需要进入精选集合的 Skill，数字越小越靠前。</p></div><span>${publishedSkills().length} 个可选</span></header></section>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存精选位</button></div>
  `;
  const refs = state.skills.filter((skill) => skill.featured).sort((left, right) => (left.featuredRank || 999) - (right.featuredRank || 999)).map((skill) => ({ skillId: skill.id, version: skill.latestVersion }));
  const picker = buildOrderedSkillPicker(refs);
  form.querySelector('.selection-section').append(picker);
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true, '正在保存…');
    try {
      const items = selectedSkillRefs(picker).map((ref, index) => ({ skillId: ref.skillId, rank: index + 1 }));
      await api('/v1/admin/featured-placements', { method: 'PUT', body: { items } });
      await loadSkills();
      await loadOperations();
      closeDrawer();
      toast('精选位已更新');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  elements.drawerContent.append(form);
  picker.querySelector('input')?.focus();
}

function openRecommendationRuleEditor(rule = null) {
  const creating = !rule;
  openDrawer(creating ? '新建推荐规则' : rule.name, creating ? '内容运营 · 创建规则' : '内容运营 · 编辑规则');
  const form = element('form', 'drawer-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="field-row">
      <label class="field"><span>规则 ID</span><input name="id" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="forecast-priority" /></label>
      <label class="field"><span>规则名称</span><input name="name" required maxlength="120" /></label>
    </div>
    <label class="field"><span>规则说明</span><textarea name="description" rows="3" maxlength="500"></textarea></label>
    <div class="field-row">
      <label class="field"><span>优先级</span><input name="priority" type="number" min="-9999" max="9999" value="100" /></label>
      <label class="field"><span>运营动作</span><select name="mode"><option value="boost">调整分数</option><option value="pin">人工置顶</option><option value="exclude">排除结果</option></select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>分数调整</span><input name="scoreBoost" type="number" min="-10000" max="10000" value="20" /></label>
      <label class="field"><span>展示原因</span><input name="reason" maxlength="160" placeholder="例如：匹配值班预报场景" /></label>
    </div>
    <label class="check-row"><input type="checkbox" name="enabled" checked /><span><strong>启用规则</strong><small>停用后规则仍保留，但不会参与推荐计算。</small></span></label>
    <section class="rule-match-section"><header><h4>候选 Skill 条件</h4><p>同一字段内任意命中，不同字段之间需要同时满足。全部留空表示不限制候选。</p></header>
      <label class="field"><span>指定 Skill ID</span><textarea name="skillIds" rows="2" placeholder="每行一个 Skill ID"></textarea></label>
      <div class="field-row"><label class="field"><span>Skill 分类</span><textarea name="skillCategories" rows="2"></textarea></label><label class="field"><span>Skill 标签</span><textarea name="skillTags" rows="2"></textarea></label></div>
    </section>
    <section class="rule-match-section"><header><h4>请求上下文条件</h4><p>用于匹配模拟器或桌面端传入的任务需求、场景和连接器。</p></header>
      <label class="field"><span>需求关键词</span><textarea name="queryTerms" rows="2" placeholder="例如：周报, 下周天气"></textarea></label>
      <div class="field-row"><label class="field"><span>请求分类</span><textarea name="requestCategories" rows="2"></textarea></label><label class="field"><span>连接器 ID</span><textarea name="connectorIds" rows="2"></textarea></label></div>
    </section>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button danger" type="button" data-delete ${creating ? 'hidden' : ''}>删除规则</button><span class="drawer-action-spacer"></span><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存规则</button></div>
  `;
  const match = rule?.match || {};
  form.elements.id.value = rule?.id || '';
  form.elements.id.disabled = !creating;
  form.elements.name.value = rule?.name || '';
  form.elements.description.value = rule?.description || '';
  form.elements.priority.value = rule?.priority ?? 100;
  form.elements.mode.value = rule?.action?.exclude ? 'exclude' : rule?.action?.pin ? 'pin' : 'boost';
  form.elements.scoreBoost.value = rule?.action?.scoreBoost ?? 20;
  form.elements.reason.value = rule?.action?.reason || '';
  form.elements.enabled.checked = rule?.enabled ?? true;
  for (const name of ['skillIds', 'skillCategories', 'skillTags', 'requestCategories', 'queryTerms', 'connectorIds']) form.elements[name].value = (match[name] || []).join('\n');
  const syncMode = () => {
    const excluded = form.elements.mode.value === 'exclude';
    form.elements.scoreBoost.disabled = excluded;
    if (excluded) form.elements.scoreBoost.value = '0';
  };
  syncMode();
  form.elements.mode.addEventListener('change', syncMode);
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setSubmitting(form, true, '正在保存…');
    try {
      const mode = form.elements.mode.value;
      const id = creating ? form.elements.id.value.trim() : rule.id;
      await api(`/v1/admin/recommendation-rules/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: {
          name: form.elements.name.value.trim(), description: form.elements.description.value.trim(),
          enabled: form.elements.enabled.checked, priority: Number(form.elements.priority.value || 0),
          match: {
            skillIds: splitList(form.elements.skillIds.value), skillCategories: splitList(form.elements.skillCategories.value),
            skillTags: splitList(form.elements.skillTags.value), requestCategories: splitList(form.elements.requestCategories.value),
            queryTerms: splitList(form.elements.queryTerms.value), connectorIds: splitList(form.elements.connectorIds.value),
          },
          action: {
            scoreBoost: mode === 'exclude' ? 0 : Number(form.elements.scoreBoost.value || 0),
            pin: mode === 'pin', exclude: mode === 'exclude', reason: form.elements.reason.value.trim(),
          },
        },
      });
      await loadOperations();
      closeDrawer();
      toast(creating ? '推荐规则已创建' : '推荐规则已保存');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  form.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!window.confirm(`删除推荐规则“${rule?.name}”？`)) return;
    try {
      await api(`/v1/admin/recommendation-rules/${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
      await loadOperations();
      closeDrawer();
      toast('推荐规则已删除');
    } catch (error) {
      setInlineFormError(form, error.message);
    }
  });
  elements.drawerContent.append(form);
  form.elements[creating ? 'id' : 'name'].focus();
}

async function runRecommendationSimulation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '正在计算…';
  setText('simulator-state', '计算中');
  try {
    const params = new URLSearchParams({ limit: '20' });
    for (const name of ['q', 'categories', 'connectorIds', 'installedSkillIds']) {
      const value = form.elements[name].value.trim();
      if (value) params.set(name, value);
    }
    const result = await api(`/v1/recommendations?${params}`);
    renderRecommendationPreview(result.items || []);
    setText('simulator-state', `${result.items?.length || 0} 个结果`);
  } catch (error) {
    elements.recommendationResults.replaceChildren(textElement('div', error.message, 'simulator-error'));
    setText('simulator-state', '模拟失败');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderRecommendationPreview(items) {
  elements.recommendationResults.replaceChildren();
  if (!items.length) {
    const empty = element('div', 'simulator-placeholder');
    empty.append(textElement('strong', '没有符合条件的推荐'), textElement('span', '检查排除规则、已安装列表和 Skill 发布状态。'));
    elements.recommendationResults.append(empty);
    return;
  }
  items.forEach((item, index) => {
    const row = element('article', 'recommendation-row');
    row.append(textElement('span', String(index + 1).padStart(2, '0'), 'recommendation-rank'));
    const copy = element('div', 'recommendation-copy');
    const title = element('div', 'recommendation-title');
    title.append(textElement('strong', item.skill?.name || item.skill?.id || '未知 Skill'));
    if (item.pinned) title.append(pill('置顶', 'featured'));
    copy.append(title, textElement('small', (item.reasons || []).join(' · ') || '按基础热度排序'));
    if (item.ruleIds?.length) copy.append(textElement('span', `命中规则：${item.ruleIds.join('、')}`, 'recommendation-rules'));
    row.append(copy, textElement('strong', Number(item.score || 0).toFixed(1), 'recommendation-score'));
    elements.recommendationResults.append(row);
  });
}

async function loadGovernance() {
  try {
    state.governance = await api('/v1/admin/installations/summary');
    renderGovernance();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderGovernance() {
  const governance = state.governance || { metrics: {}, items: [], pendingReviews: [], versionDistribution: [] };
  setText('governance-metric-installations', governance.metrics.installations || 0);
  setText('governance-metric-clients', governance.metrics.activeClients || 0);
  setText('governance-metric-upgrades', governance.metrics.upgrades || 0);
  setText('governance-metric-reviews', governance.metrics.pendingReviews || 0);
  renderReviewQueue(governance.pendingReviews || []);
  renderVersionDistribution(governance.versionDistribution || []);

  const query = document.getElementById('governance-search').value.trim().toLowerCase();
  const scope = document.getElementById('governance-scope-filter').value;
  const upgrade = document.getElementById('governance-upgrade-filter').value;
  const items = (governance.items || []).filter((item) => {
    const searchable = `${item.skillName} ${item.skillId} ${item.userName} ${item.userId} ${item.projectId || ''} ${item.clientId}`.toLowerCase();
    return (!query || searchable.includes(query))
      && (!scope || item.scope === scope)
      && (!upgrade || (upgrade === 'upgrade') === Boolean(item.upgradeReady));
  });
  elements.governanceBody.replaceChildren();
  elements.governanceEmpty.hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement('tr');
    const skill = element('span', 'governance-skill');
    skill.append(textElement('strong', item.skillName || item.skillId), textElement('small', item.skillId));
    const version = element('span', 'governance-version');
    version.append(
      textElement('strong', item.version),
      item.upgradeReady ? pill(`可升级至 ${item.latestVersion}`, 'upgrade-ready') : pill('已是最新', 'skill-published'),
    );
    const identity = element('span', 'governance-identity');
    identity.append(textElement('strong', item.userName || item.userId), textElement('small', item.projectId || '个人范围'));
    row.append(
      tableCell('Skill', skill),
      tableCell('安装版本', version),
      tableCell('使用范围', pill(item.scope === 'project' ? '项目' : '用户', item.scope === 'project' ? 'publisher' : 'viewer')),
      tableCell('用户 / 项目', identity),
      tableCell('客户端', textElement('span', item.clientId, 'governance-client')),
      tableCell('最后活跃', textElement('span', `${formatDate(item.lastSeenAt)}${item.active ? ' · 活跃' : ''}`, `date-cell ${item.active ? 'active-installation' : ''}`)),
    );
    elements.governanceBody.append(row);
  }
}

function renderReviewQueue(items) {
  setText('review-queue-count', `${items.length} 项`);
  elements.reviewQueueList.replaceChildren();
  elements.reviewQueueEmpty.hidden = items.length > 0;
  for (const item of items) {
    const row = element('article', 'governance-list-row');
    const copy = element('span', 'governance-list-copy');
    copy.append(textElement('strong', `${item.skillName} ${item.version}`), textElement('small', `${item.ownerName} · ${riskLabels[item.risk] || '风险未知'} · ${formatDate(item.submittedAt)}`));
    const actions = element('span', 'governance-row-actions');
    const reject = textElement('button', '退回', 'button danger');
    reject.type = 'button';
    reject.addEventListener('click', () => rejectGovernanceReview(item));
    const approve = textElement('button', '批准', 'button primary');
    approve.type = 'button';
    approve.addEventListener('click', () => approveGovernanceReview(item));
    actions.append(reject, approve);
    row.append(copy, actions);
    elements.reviewQueueList.append(row);
  }
}

function renderVersionDistribution(items) {
  const visible = items.slice(0, 8);
  setText('version-distribution-count', `${items.length} 组`);
  elements.versionDistributionList.replaceChildren();
  elements.versionDistributionEmpty.hidden = visible.length > 0;
  const maximum = Math.max(1, ...visible.map((item) => item.count));
  for (const item of visible) {
    const row = element('article', 'distribution-row');
    const copy = element('span', 'governance-list-copy');
    copy.append(textElement('strong', item.skillName), textElement('small', item.version));
    const meter = element('span', 'distribution-meter');
    const fill = element('i');
    fill.style.setProperty('--distribution-width', `${Math.max(8, Math.round((item.count / maximum) * 100))}%`);
    meter.append(fill);
    row.append(copy, meter, textElement('strong', item.count, 'distribution-count'));
    elements.versionDistributionList.append(row);
  }
}

async function approveGovernanceReview(item) {
  if (!window.confirm(`批准发布 ${item.skillName} ${item.version}？`)) return;
  try {
    await api(`/v1/skills/${encodeURIComponent(item.skillId)}/versions/${encodeURIComponent(item.version)}/publish`, { method: 'POST' });
    await Promise.all([loadSkills(), loadGovernance()]);
    toast('版本已批准发布');
  } catch (error) {
    toast(error.message, true);
  }
}

async function rejectGovernanceReview(item) {
  const note = window.prompt(`退回 ${item.skillName} ${item.version} 的原因`, '请修改后重新提交');
  if (note === null) return;
  try {
    await api(`/v1/skills/${encodeURIComponent(item.skillId)}/versions/${encodeURIComponent(item.version)}/reject`, { method: 'POST', body: { note } });
    await Promise.all([loadSkills(), loadGovernance()]);
    toast('版本已退回修改');
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadUsers() {
  try {
    const [users, sessions] = await Promise.all([api('/v1/admin/users'), api('/v1/admin/sessions')]);
    state.users = users.items || [];
    state.sessions = sessions.items || [];
    renderMetrics();
    renderUsers();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderMetrics() {
  setText('metric-active', state.users.filter((user) => user.status === 'active').length);
  setText('metric-publishers', state.users.filter((user) => user.status === 'active' && ['publisher', 'admin'].includes(user.role)).length);
  setText('metric-sessions', state.sessions.length);
  setText('metric-disabled', state.users.filter((user) => user.status === 'disabled').length);
}

function filteredUsers() {
  const query = document.getElementById('user-search').value.trim().toLowerCase();
  const role = document.getElementById('role-filter').value;
  const status = document.getElementById('status-filter').value;
  return state.users.filter((user) => {
    const matchesText = !query || `${user.username} ${user.displayName}`.toLowerCase().includes(query);
    return matchesText && (!role || user.role === role) && (!status || user.status === status);
  });
}

function renderUsers() {
  elements.usersBody.replaceChildren();
  const users = filteredUsers();
  elements.usersEmpty.hidden = users.length > 0;
  for (const user of users) {
    const row = document.createElement('tr');
    row.append(
      tableCell('用户', userIdentity(user)),
      tableCell('角色', pill(roleLabels[user.role] || user.role, user.role)),
      tableCell('状态', statusLabel(user.status)),
      tableCell('最近登录', textElement('span', formatDate(user.lastLoginAt), 'date-cell')),
      tableCell('会话', textElement('span', String(sessionCount(user.id)), 'session-count')),
      tableCell('', actionButton('•••', `管理 ${user.displayName || user.username}`, () => openUser(user))),
    );
    elements.usersBody.append(row);
  }
}

function userIdentity(user) {
  const wrapper = element('div', 'user-cell');
  wrapper.append(textElement('span', initial(user.displayName || user.username), 'user-avatar'));
  const copy = element('span', 'user-copy');
  copy.append(textElement('strong', user.displayName || user.username), textElement('small', `${user.username}${user.orgId ? ` · ${user.orgId}` : ''}`));
  wrapper.append(copy);
  return wrapper;
}

function pill(label, style) {
  return textElement('span', label, `pill ${style}`);
}

function statusLabel(status) {
  return textElement('span', status === 'active' ? '已启用' : '已停用', `status-cell ${status === 'disabled' ? 'disabled' : ''}`);
}

function tableCell(label, child) {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  cell.append(child);
  return cell;
}

function actionButton(label, ariaLabel, onClick) {
  const button = textElement('button', label, 'icon-button row-action');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

function openDrawer(title, eyebrow) {
  elements.drawerTitle.textContent = title;
  elements.drawerEyebrow.textContent = eyebrow;
  elements.drawerContent.replaceChildren();
  elements.drawerLayer.hidden = false;
  document.body.classList.add('drawer-open');
  document.getElementById('drawer-close').focus();
}

function closeDrawer() {
  elements.drawerLayer.hidden = true;
  elements.drawerContent.replaceChildren();
  document.body.classList.remove('drawer-open');
}

function openCreateUser() {
  openDrawer('新建用户', '账户与初始权限');
  const form = buildUserForm();
  elements.drawerContent.append(form);
  form.querySelector('[name="username"]').focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = temporaryPassword();
    const data = Object.fromEntries(new FormData(form).entries());
    setSubmitting(form, true, '正在创建…');
    try {
      const user = await api('/v1/admin/users', {
        method: 'POST',
        body: { ...data, password, mustChangePassword: true },
      });
      await loadUsers();
      showCreatedUser(user, password);
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
}

function buildUserForm(user = null) {
  const form = element('form', 'drawer-form');
  form.noValidate = true;
  form.innerHTML = `
    <label class="field"><span>用户名</span><input name="username" autocomplete="off" pattern="[a-z0-9][-a-z0-9._]{2,63}" required /></label>
    <label class="field"><span>显示名称</span><input name="displayName" autocomplete="off" required /></label>
    <div class="field-row">
      <label class="field"><span>角色</span><select name="role"><option value="viewer">使用者</option><option value="publisher">Skill 发布者</option><option value="admin">管理员</option></select></label>
      <label class="field"><span>单位标识</span><input name="orgId" autocomplete="off" value="meteomate" /></label>
    </div>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">${user ? '保存修改' : '创建用户'}</button></div>
  `;
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  if (user) {
    form.elements.username.value = user.username;
    form.elements.username.disabled = true;
    form.elements.displayName.value = user.displayName;
    form.elements.role.value = user.role;
    form.elements.orgId.value = user.orgId || '';
  }
  return form;
}

function showCreatedUser(user, password) {
  elements.drawerTitle.textContent = '用户已创建';
  elements.drawerEyebrow.textContent = '请交付临时密码';
  elements.drawerContent.replaceChildren();
  const heading = element('div', 'user-detail-head');
  heading.append(textElement('span', initial(user.displayName), 'user-avatar'));
  const copy = element('span');
  copy.append(textElement('h3', user.displayName), textElement('p', `${user.username} · ${roleLabels[user.role]}`));
  heading.append(copy);
  elements.drawerContent.append(heading, passwordPanel(password));
  const actions = element('div', 'drawer-actions');
  const done = textElement('button', '完成', 'button primary');
  done.addEventListener('click', closeDrawer);
  actions.append(done);
  elements.drawerContent.append(actions);
}

async function openUser(user) {
  openDrawer(user.displayName || user.username, '用户详情');
  const heading = element('div', 'user-detail-head');
  heading.append(textElement('span', initial(user.displayName || user.username), 'user-avatar'));
  const copy = element('span');
  copy.append(textElement('h3', user.displayName || user.username), textElement('p', `${user.username} · ${roleLabels[user.role] || user.role}`));
  heading.append(copy);
  elements.drawerContent.append(heading);

  const formSection = detailSection('账户资料');
  const form = buildUserForm(user);
  form.querySelector('[data-cancel]').textContent = '关闭';
  formSection.append(form);
  elements.drawerContent.append(formSection);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    setSubmitting(form, true, '正在保存…');
    try {
      const updated = await api(`/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: data });
      if (updated.id === state.user.id && (updated.role !== 'admin' || updated.status !== 'active')) {
        showLogin('当前管理员账户的权限已变更，请使用有效的管理员账户重新登录。');
        return;
      }
      await loadUsers();
      toast('用户资料已更新');
      closeDrawer();
      if (updated.id === state.user.id) {
        state.user = updated;
        document.getElementById('identity-name').textContent = updated.displayName;
      }
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });

  const sessionSection = detailSection('当前会话', String(sessionCount(user.id)));
  const sessionList = element('div', 'session-list');
  const sessions = state.sessions.filter((session) => session.userId === user.id);
  if (!sessions.length) {
    sessionList.append(textElement('p', '当前没有在线会话。', 'session-empty'));
  } else {
    for (const session of sessions) sessionList.append(sessionRow(session, user));
  }
  sessionSection.append(sessionList);
  elements.drawerContent.append(sessionSection);

  const policySection = detailSection('空间与组织策略');
  const policySummary = element('div', 'policy-effective-list');
  const spaceRow = document.createElement('div');
  spaceRow.append(textElement('dt', '默认助理空间'), textElement('dd', user.defaultSpaceId || `personal:${user.id}`));
  const overrideRow = document.createElement('div');
  overrideRow.append(textElement('dt', '用户策略'), textElement('dd', state.policies?.users?.[user.id] ? '已设置用户覆盖' : '继承组织和角色策略'));
  policySummary.append(spaceRow, overrideRow);
  const editPolicy = textElement('button', '编辑用户策略', 'button quiet');
  editPolicy.type = 'button';
  editPolicy.addEventListener('click', async () => {
    if (!state.policies) await loadPolicies();
    const row = policyRows().find((item) => item.type === 'user' && item.id === user.id)
      || { type: 'user', id: user.id, name: user.displayName || user.username, detail: user.username, mark: initial(user.displayName || user.username), user };
    openPolicyScope(row);
  });
  policySection.append(policySummary, editPolicy);
  elements.drawerContent.append(policySection);

  const securitySection = detailSection('安全操作');
  const danger = element('div', 'danger-zone');
  const reset = textElement('button', '重置临时密码', 'button quiet');
  reset.disabled = user.id === state.user.id;
  if (reset.disabled) reset.title = '当前管理员请通过密码修改流程更新自己的密码';
  reset.addEventListener('click', () => resetPassword(user));
  const revoke = textElement('button', '退出所有设备', 'button quiet');
  revoke.disabled = sessions.length === 0;
  revoke.addEventListener('click', () => revokeUserSessions(user));
  const toggle = textElement('button', user.status === 'active' ? '停用账户' : '重新启用', `button ${user.status === 'active' ? 'danger' : 'quiet'}`);
  toggle.addEventListener('click', () => toggleUser(user));
  danger.append(reset, revoke, toggle);
  securitySection.append(danger);
  elements.drawerContent.append(securitySection);
}

function sessionRow(session, user) {
  const row = element('div', 'session-row');
  const copy = element('span');
  copy.append(textElement('strong', session.clientId || '未知客户端'), textElement('small', `最近活动 ${formatDate(session.lastSeenAt)} · 到期 ${formatDate(session.expiresAt)}`));
  const revoke = actionButton('×', `撤销 ${user.displayName} 的会话`, async () => {
    if (!window.confirm(`撤销 ${user.displayName || user.username} 的这个会话？`)) return;
    try {
      await api(`/v1/admin/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      await loadUsers();
      closeDrawer();
      toast('会话已撤销');
    } catch (error) {
      toast(error.message, true);
    }
  });
  row.append(copy, revoke);
  return row;
}

async function resetPassword(user) {
  if (!window.confirm(`为 ${user.displayName || user.username} 重置临时密码？现有会话会立即失效。`)) return;
  const password = temporaryPassword();
  try {
    await api(`/v1/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: 'POST', body: { password } });
    await loadUsers();
    elements.drawerContent.prepend(passwordPanel(password));
    toast('临时密码已重置');
  } catch (error) {
    toast(error.message, true);
  }
}

async function revokeUserSessions(user) {
  if (!window.confirm(`让 ${user.displayName || user.username} 退出所有设备？`)) return;
  try {
    const result = await api(`/v1/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: 'POST' });
    if (user.id === state.user.id) {
      showLogin(`已撤销 ${result.revoked} 个会话，请重新登录。`);
      return;
    }
    await loadUsers();
    closeDrawer();
    toast(`已撤销 ${result.revoked} 个会话`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function toggleUser(user) {
  const nextStatus = user.status === 'active' ? 'disabled' : 'active';
  const action = nextStatus === 'disabled' ? '停用' : '启用';
  if (!window.confirm(`${action} ${user.displayName || user.username}？${nextStatus === 'disabled' ? '现有会话会立即失效。' : ''}`)) return;
  try {
    const updated = await api(`/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: { status: nextStatus } });
    if (updated.id === state.user.id && updated.status !== 'active') {
      showLogin('当前管理员账户已停用，请使用其他管理员账户登录。');
      return;
    }
    await loadUsers();
    closeDrawer();
    toast(`账户已${action}`);
  } catch (error) {
    toast(error.message, true);
  }
}

function passwordPanel(password) {
  const panel = element('section', 'temporary-password');
  panel.append(textElement('p', '临时密码只在这里显示一次。请通过单位内部的安全渠道交给用户。'));
  const value = element('div', 'password-value');
  value.append(textElement('code', password));
  const copy = textElement('button', '复制', 'button quiet');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast('临时密码已复制');
    } catch {
      window.prompt('复制临时密码', password);
    }
  });
  value.append(copy);
  panel.append(value);
  return panel;
}

async function loadModelCatalog({ render = true } = {}) {
  try {
    state.modelCatalog = await api('/v1/admin/model-providers');
    if (render) renderModelCatalog();
    return state.modelCatalog;
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}

function modelCatalogProviders() {
  return Object.values(state.modelCatalog?.providers || {}).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function filteredModelCatalogProviders() {
  const query = document.getElementById('model-catalog-search').value.trim().toLowerCase();
  const status = document.getElementById('model-catalog-status-filter').value;
  return modelCatalogProviders().filter((provider) => {
    const searchable = [provider.id, provider.name, provider.description, provider.baseUrl, ...(provider.models || []).flatMap((model) => [model.id, model.name])]
      .join(' ').toLowerCase();
    const statusMatches = !status
      || (status === 'enabled' && provider.enabled)
      || (status === 'disabled' && !provider.enabled)
      || (status === 'verified' && provider.verification?.status === 'verified')
      || (status === 'untested' && provider.verification?.status !== 'verified');
    return statusMatches && (!query || searchable.includes(query));
  });
}

function renderModelCatalog() {
  if (!state.modelCatalog) return;
  const providers = modelCatalogProviders();
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const models = enabledProviders.flatMap((provider) => (provider.models || []).filter((model) => model.enabled));
  setText('model-catalog-metric-revision', state.modelCatalog.revision || 0);
  setText('model-catalog-metric-providers', enabledProviders.length);
  setText('model-catalog-metric-models', models.length);
  setText('model-catalog-metric-verified', models.filter((model) => model.verification?.status === 'verified').length);
  const filtered = filteredModelCatalogProviders();
  elements.modelCatalogList.replaceChildren(...filtered.map(modelProviderCard));
  elements.modelCatalogEmpty.hidden = filtered.length > 0;
}

function modelProviderCard(provider) {
  const card = element('article', `model-provider-card ${provider.enabled ? '' : 'disabled'}`.trim());
  const header = element('header', 'model-provider-card-header');
  const identity = element('div', 'model-provider-identity');
  identity.append(textElement('span', initial(provider.name), 'model-provider-mark'));
  const copy = element('div');
  const title = element('div', 'model-provider-title');
  title.append(textElement('h3', provider.name), pill(provider.enabled ? '已启用' : '已停用', provider.enabled ? 'model-enabled' : 'model-disabled'));
  if (provider.verification?.status === 'verified') title.append(pill('已验证', 'model-verified'));
  copy.append(title, textElement('p', provider.description || provider.id));
  identity.append(copy);
  const actions = element('div', 'model-provider-card-actions');
  const verify = textElement('button', '登记验证', 'button quiet');
  verify.type = 'button';
  verify.addEventListener('click', () => openModelVerification(provider));
  const edit = textElement('button', '编辑', 'button quiet');
  edit.type = 'button';
  edit.addEventListener('click', () => openModelProviderEditor(provider));
  actions.append(verify, edit);
  header.append(identity, actions);

  const flow = element('div', 'model-provider-flow');
  flow.append(
    modelProviderFlowStep('01 · 传输', `${provider.presetMode === 'volcengine-ark' ? '火山方舟' : 'OpenAI 兼容'} · ${provider.protocol === 'responses' ? 'Responses' : 'Chat Completions'}`, provider.baseUrl),
    modelProviderFlowStep('02 · 凭据', modelProviderCredentialLabel(provider), provider.credentialMode === 'secret_ref' ? provider.secretRef : provider.requiresAuth ? '密钥留在用户设备' : '仅适用于可信内网地址'),
    modelProviderFlowStep('03 · 验证', modelVerificationLabel(provider.verification), provider.verification?.checkedAt ? formatDate(provider.verification.checkedAt) : '尚无验证记录'),
  );

  const models = element('section', 'model-provider-models');
  const modelHeading = element('div', 'model-provider-models-heading');
  modelHeading.append(textElement('strong', '模型目录'), textElement('span', `${provider.models?.length || 0} 个`));
  models.append(modelHeading);
  for (const model of provider.models || []) models.append(modelCatalogRow(model));

  const footer = element('footer', 'model-provider-card-footer');
  footer.append(textElement('code', provider.id), textElement('span', `r${provider.revision || 1} · ${provider.endpointPath ? `/${provider.endpointPath}` : '自动请求路径'}`));
  const remove = textElement('button', '删除提供商');
  remove.type = 'button';
  remove.addEventListener('click', () => deleteModelProvider(provider));
  footer.append(remove);
  card.append(header, flow, models, footer);
  return card;
}

function modelProviderFlowStep(label, value, detail) {
  const step = element('div');
  step.append(textElement('span', label), textElement('strong', value), textElement('small', detail));
  return step;
}

function modelProviderCredentialLabel(provider) {
  if (!provider.requiresAuth) return '无需认证';
  if (provider.credentialMode === 'secret_ref') return provider.secretRef ? '密钥引用已登记' : '缺少密钥引用';
  return '用户本机密钥';
}

function modelVerificationLabel(verification) {
  if (verification?.status === 'verified') return '验证通过';
  if (verification?.status === 'failed') return '验证失败';
  return '等待验证';
}

function modelCatalogRow(model) {
  const row = element('div', `model-catalog-row ${model.enabled ? '' : 'disabled'}`.trim());
  const copy = element('div');
  copy.append(textElement('strong', model.name || model.id), textElement('code', model.id));
  const capabilities = element('div', 'model-catalog-capabilities');
  const labels = [model.toolCall ? '工具调用' : '', model.imageInput ? '图片输入' : '', model.reasoning ? '推理' : ''].filter(Boolean);
  for (const label of labels.length ? labels : ['基础对话']) capabilities.append(textElement('span', label));
  const limits = textElement('span', `输入 ${model.contextLimit ? compactNumber(model.contextLimit) : '默认'} · 输出 ${model.maxOutputTokens ? compactNumber(model.maxOutputTokens) : '默认'}`, 'model-catalog-limits');
  const status = pill(modelVerificationLabel(model.verification), model.verification?.status === 'verified' ? 'model-verified' : model.verification?.status === 'failed' ? 'model-failed' : 'model-untested');
  row.append(copy, capabilities, limits, status);
  return row;
}

function compactNumber(value) {
  const number = Number(value || 0);
  return number >= 1000 ? `${Math.round(number / 100) / 10}K` : String(number || 0);
}

function buildModelProviderForm(provider = null) {
  const form = element('form', 'drawer-form model-provider-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="model-provider-form-section"><h4>目录标识</h4><p>Provider ID 必须与桌面 Goose 中的自定义提供商 ID 一致，才能应用托管连接。</p>
      <label class="field"><span>Provider ID</span><input name="id" pattern="[a-z0-9][-a-z0-9._]{0,63}" required /></label>
      <label class="field"><span>显示名称</span><input name="name" maxlength="80" required /></label>
      <label class="field"><span>说明</span><textarea name="description" maxlength="500"></textarea></label>
      <label class="model-provider-toggle"><input name="enabled" type="checkbox" /><span><strong>启用提供商</strong><small>停用后不会下发给桌面端。</small></span></label>
    </div>
    <div class="model-provider-form-section"><h4>传输配置</h4><p>Base URL 与请求路径分开保存，避免重复拼接 /v1 或 /api/v3。</p>
      <div class="field-row"><label class="field"><span>提供商类型</span><select name="presetMode"><option value="openai-compatible">OpenAI 兼容</option><option value="volcengine-ark">火山方舟</option></select></label><label class="field"><span>API 协议</span><select name="protocol"><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option></select></label></div>
      <label class="field"><span>Base URL</span><input name="baseUrl" type="url" inputmode="url" required /></label>
      <div class="field-row"><label class="field"><span>请求路径（可选）</span><input name="endpointPath" placeholder="api/v3/responses" /></label><label class="field"><span>流式输出</span><select name="streamingMode"><option value="auto">自动</option><option value="on">开启</option><option value="off">关闭</option></select></label></div>
      <div class="model-provider-route-preview"><span>实际地址</span><code data-model-provider-endpoint>填写 Base URL 后显示</code></div>
    </div>
    <div class="model-provider-form-section"><h4>凭据边界</h4><p>这里不接受 API Key。secretRef 只用于部署侧解析，不会返回普通用户接口。</p>
      <label class="field"><span>凭据模式</span><select name="credentialMode"><option value="local">用户本机密钥</option><option value="secret_ref">服务端密钥引用</option><option value="none">无需认证</option></select></label>
      <label class="field" data-secret-ref><span>密钥引用</span><input name="secretRef" placeholder="vault://meteomate/provider-key" autocomplete="off" /><small>仅允许 env://、vault://、secret://、k8s://。</small></label>
    </div>
    <div class="model-provider-form-section"><div class="model-provider-form-heading"><div><h4>模型</h4><p>声明实际可调用的模型 ID、能力和 Token 上限。</p></div><button class="button quiet" type="button" data-add-catalog-model>＋ 添加模型</button></div><div class="model-provider-form-models" data-catalog-models></div></div>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存提供商</button></div>`;
  form.elements.id.value = provider?.id || '';
  form.elements.id.disabled = Boolean(provider);
  form.elements.name.value = provider?.name || '';
  form.elements.description.value = provider?.description || '';
  form.elements.enabled.checked = provider ? provider.enabled : true;
  form.elements.presetMode.value = provider?.presetMode || 'openai-compatible';
  form.elements.protocol.value = provider?.protocol || 'chat_completions';
  form.elements.baseUrl.value = provider?.baseUrl || '';
  form.elements.endpointPath.value = provider?.endpointPath || '';
  form.elements.streamingMode.value = provider?.streamingMode || 'auto';
  form.elements.credentialMode.value = provider?.credentialMode || 'local';
  form.elements.secretRef.value = provider?.secretRef || '';
  for (const model of provider?.models || [{ enabled: true, toolCall: true }]) appendCatalogModelRow(form, model);
  form.querySelector('[data-add-catalog-model]').addEventListener('click', () => appendCatalogModelRow(form, { enabled: true, toolCall: true }));
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  for (const control of [form.elements.baseUrl, form.elements.endpointPath, form.elements.protocol]) control.addEventListener('input', () => refreshCatalogEndpoint(form));
  form.elements.credentialMode.addEventListener('change', () => refreshCatalogCredentialMode(form));
  refreshCatalogEndpoint(form);
  refreshCatalogCredentialMode(form);
  return form;
}

function appendCatalogModelRow(form, model = {}) {
  const row = element('div', 'model-provider-form-model');
  row.dataset.catalogModel = '';
  row.innerHTML = `
    <div class="model-provider-form-model-head"><strong>模型条目</strong><button type="button" data-remove-catalog-model>移除</button></div>
    <div class="field-row"><label class="field"><span>模型 ID</span><input name="modelId" required maxlength="160" /></label><label class="field"><span>显示名称</span><input name="modelName" maxlength="100" /></label></div>
    <div class="model-provider-capability-checks"><label><input name="modelEnabled" type="checkbox" />启用</label><label><input name="toolCall" type="checkbox" />工具调用</label><label><input name="imageInput" type="checkbox" />图片输入</label><label><input name="reasoning" type="checkbox" />推理</label></div>
    <div class="field-row"><label class="field"><span>最大输入 Token</span><input name="contextLimit" type="number" min="0" step="1" /></label><label class="field"><span>最大输出 Token</span><input name="maxOutputTokens" type="number" min="0" step="1" /></label></div>`;
  row.querySelector('[name="modelId"]').value = model.id || '';
  row.querySelector('[name="modelName"]').value = model.name || '';
  row.querySelector('[name="modelEnabled"]').checked = model.enabled !== false;
  row.querySelector('[name="toolCall"]').checked = Boolean(model.toolCall);
  row.querySelector('[name="imageInput"]').checked = Boolean(model.imageInput);
  row.querySelector('[name="reasoning"]').checked = Boolean(model.reasoning);
  row.querySelector('[name="contextLimit"]').value = model.contextLimit || '';
  row.querySelector('[name="maxOutputTokens"]').value = model.maxOutputTokens || '';
  row.querySelector('[data-remove-catalog-model]').addEventListener('click', () => {
    if (form.querySelectorAll('[data-catalog-model]').length === 1) return setInlineFormError(form, '提供商至少需要一个模型');
    row.remove();
  });
  form.querySelector('[data-catalog-models]').append(row);
}

function refreshCatalogCredentialMode(form) {
  const secretMode = form.elements.credentialMode.value === 'secret_ref';
  form.querySelector('[data-secret-ref]').hidden = !secretMode;
  form.elements.secretRef.required = secretMode;
}

function refreshCatalogEndpoint(form) {
  const target = form.querySelector('[data-model-provider-endpoint]');
  try {
    const base = new URL(form.elements.baseUrl.value);
    const explicit = form.elements.endpointPath.value.trim().replace(/^\/+/, '');
    if (explicit) {
      target.textContent = `${base.origin}/${explicit}`;
      return;
    }
    const suffix = form.elements.protocol.value === 'responses' ? 'responses' : 'chat/completions';
    target.textContent = `${base.toString().replace(/\/$/, '')}/${suffix}`;
  } catch {
    target.textContent = '填写 Base URL 后显示';
  }
}

function readModelProviderForm(form) {
  const credentialMode = form.elements.credentialMode.value;
  const models = [...form.querySelectorAll('[data-catalog-model]')].map((row) => ({
    id: row.querySelector('[name="modelId"]').value.trim(),
    name: row.querySelector('[name="modelName"]').value.trim(),
    enabled: row.querySelector('[name="modelEnabled"]').checked,
    toolCall: row.querySelector('[name="toolCall"]').checked,
    imageInput: row.querySelector('[name="imageInput"]').checked,
    reasoning: row.querySelector('[name="reasoning"]').checked,
    contextLimit: Number(row.querySelector('[name="contextLimit"]').value || 0),
    maxOutputTokens: Number(row.querySelector('[name="maxOutputTokens"]').value || 0),
  }));
  if (models.some((model) => !model.id)) throw new Error('每个模型都必须填写模型 ID');
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new Error('模型 ID 不能重复');
  return {
    id: form.elements.id.value.trim(),
    body: {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      enabled: form.elements.enabled.checked,
      presetMode: form.elements.presetMode.value,
      protocol: form.elements.protocol.value,
      streamingMode: form.elements.streamingMode.value,
      baseUrl: form.elements.baseUrl.value.trim(),
      endpointPath: form.elements.endpointPath.value.trim(),
      requiresAuth: credentialMode !== 'none',
      credentialMode,
      secretRef: credentialMode === 'secret_ref' ? form.elements.secretRef.value.trim() : '',
      models,
    },
  };
}

function openModelProviderEditor(provider = null) {
  openDrawer(provider ? provider.name : '添加模型提供商', provider ? '编辑组织模型目录' : '新建组织模型连接');
  const form = buildModelProviderForm(provider);
  elements.drawerContent.append(form);
  form.querySelector(provider ? '[name="name"]' : '[name="id"]')?.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setInlineFormError(form, '');
    setSubmitting(form, true, '正在保存…');
    try {
      const input = readModelProviderForm(form);
      await api(`/v1/admin/model-providers/${encodeURIComponent(input.id)}`, { method: 'PUT', body: input.body });
      await loadModelCatalog();
      closeDrawer();
      toast('模型提供商已保存');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
}

async function deleteModelProvider(provider) {
  if (!window.confirm(`删除模型提供商“${provider.name}”？被策略引用时服务端会拒绝删除。`)) return;
  try {
    await api(`/v1/admin/model-providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' });
    await loadModelCatalog();
    toast('模型提供商已删除');
  } catch (error) {
    toast(error.message, true);
  }
}

function openModelVerification(provider) {
  openDrawer(provider.name, '登记最近一次连接验证');
  const form = element('form', 'drawer-form model-verification-form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="drawer-note"><strong>只登记真实测试结果</strong><span>这里不会发起模型请求。请先在桌面端完成连接测试，再把结果记录到组织目录。</span></div>
    <label class="field"><span>验证模型</span><select name="modelId"></select></label>
    <label class="field"><span>结果</span><select name="status"><option value="verified">验证通过</option><option value="failed">验证失败</option></select></label>
    <fieldset class="model-verification-checks"><legend>通过的检查</legend><label><input type="checkbox" name="check" value="text" checked />文本响应</label><label><input type="checkbox" name="check" value="streaming" />流式输出</label><label><input type="checkbox" name="check" value="tool_call" />工具调用</label><label><input type="checkbox" name="check" value="image_input" />图片输入</label><label><input type="checkbox" name="check" value="reasoning" />推理模式</label></fieldset>
    <label class="field"><span>验证说明</span><textarea name="message" maxlength="500" placeholder="例如：Responses 非流式、文本与工具调用通过"></textarea></label>
    <div class="form-error" data-form-error role="alert" hidden></div>
    <div class="drawer-actions"><button class="button quiet" type="button" data-cancel>取消</button><button class="button primary" type="submit">保存验证记录</button></div>`;
  for (const model of provider.models || []) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.name || model.id} · ${model.id}`;
    form.elements.modelId.append(option);
  }
  form.querySelector('[data-cancel]').addEventListener('click', closeDrawer);
  elements.drawerContent.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true, '正在保存…');
    setInlineFormError(form, '');
    try {
      const status = form.elements.status.value;
      const passed = new Set([...form.querySelectorAll('[name="check"]:checked')].map((input) => input.value));
      const checks = [...form.querySelectorAll('[name="check"]')].map((input) => ({
        id: input.value,
        status: passed.has(input.value) ? 'passed' : status === 'failed' && input.value === 'text' ? 'failed' : 'skipped',
      }));
      await api(`/v1/admin/model-providers/${encodeURIComponent(provider.id)}/verification`, {
        method: 'POST',
        body: { modelId: form.elements.modelId.value, status, message: form.elements.message.value.trim(), checks },
      });
      await loadModelCatalog();
      closeDrawer();
      toast('模型验证记录已更新');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
}

const policyFieldDefinitions = [
  { key: 'defaultModel', label: '默认模型', type: 'model-select', help: '从组织模型目录选择。留空表示沿用桌面端已配置模型。' },
  { key: 'allowedModels', label: '允许使用的模型', type: 'model-list', help: '从组织目录勾选。全部不选表示不额外限制。' },
  { key: 'allowedProviderIds', label: '允许使用的提供商', type: 'provider-list', help: '从组织目录勾选。全部不选表示不额外限制。' },
  { key: 'requireVerifiedModels', label: '只允许已验证模型', type: 'boolean', help: '启用后，桌面端会隐藏并拒绝运行尚未登记验证通过的模型。' },
  { key: 'defaultSkillIds', label: '默认安装的 Skill', type: 'list', help: '每行一个 Skill ID。登录后同步可信的已发布版本或产品内置版本。' },
  { key: 'allowedSkillIds', label: '允许使用的 Skill', type: 'list', help: '每行一个 Skill ID。留空表示不限制，默认 Skill 必须包含在此范围中。' },
  { key: 'allowedConnectorIds', label: '允许使用的 Connector', type: 'list', help: '每行一个 Connector ID。留空表示不限制。' },
  { key: 'defaultPermissionProfileId', label: '默认权限', type: 'permission', help: '留空表示沿用专家或助理的产品默认权限。' },
  { key: 'allowedPermissionProfileIds', label: '允许选择的权限', type: 'permission-list', help: '每行一个权限 ID：analysis-readonly、artifact-approval、workspace-approval。留空表示不限制。' },
  { key: 'autoCompactThreshold', label: '自动压缩阈值（%）', type: 'percent', help: '上下文占用达到该比例后自动压缩。可设置 50–95，建议保持 80。' },
  { key: 'skillPublishMode', label: 'Skill 发布方式', type: 'publish-mode', organizationOnly: true, help: '发布者直接发布适合小团队；管理员审核适合需要统一质量和安全把关的组织。' },
];

async function loadPolicies() {
  try {
    const [policies, modelCatalog] = await Promise.all([
      api('/v1/admin/policies'),
      api('/v1/admin/model-providers'),
    ]);
    state.policies = policies;
    state.modelCatalog = modelCatalog;
    renderPolicies();
  } catch (error) {
    toast(error.message, true);
  }
}

function policyRows() {
  if (!state.policies) return [];
  const rows = [
    { type: 'organization', id: 'organization', name: '组织默认', detail: '所有用户的策略基线', mark: '组' },
    ...['viewer', 'publisher', 'admin'].map((role) => ({
      type: 'role', id: role, name: roleLabels[role], detail: '角色覆盖', mark: '角', userRole: role,
    })),
    ...state.users.map((user) => ({
      type: 'user', id: user.id, name: user.displayName || user.username,
      detail: `${user.username} · ${roleLabels[user.role] || user.role}${user.status === 'disabled' ? ' · 已停用' : ''}`,
      mark: initial(user.displayName || user.username), user,
    })),
  ];
  const query = document.getElementById('policy-search').value.trim().toLowerCase();
  const scope = document.getElementById('policy-scope-filter').value;
  return rows.filter((row) => (!scope || row.type === scope) && (!query || `${row.name} ${row.detail}`.toLowerCase().includes(query)));
}

function policyPatchFor(row) {
  if (row.type === 'organization') return state.policies?.organization || {};
  if (row.type === 'role') return state.policies?.roles?.[row.id] || {};
  return state.policies?.users?.[row.id] || {};
}

function policyEffectiveFor(row) {
  const settings = structuredClone(state.policies?.organization || emptyPolicySettings());
  if (row.type === 'role') applyPolicyPatch(settings, state.policies?.roles?.[row.id]);
  if (row.type === 'user') {
    applyPolicyPatch(settings, state.policies?.roles?.[row.user.role]);
    applyPolicyPatch(settings, state.policies?.users?.[row.id]);
  }
  settings.allowedModels ||= [];
  settings.allowedProviderIds ||= [];
  settings.requireVerifiedModels = Boolean(settings.requireVerifiedModels);
  settings.defaultSkillIds ||= [];
  settings.allowedSkillIds ||= [];
  settings.allowedConnectorIds ||= [];
  settings.allowedPermissionProfileIds ||= [];
  settings.autoCompactThreshold ||= 0.8;
  settings.skillPublishMode ||= 'publisher_direct';
  if (settings.allowedModels.length && !settings.allowedModels.includes(settings.defaultModel)) settings.defaultModel = '';
  if (settings.allowedPermissionProfileIds.length && !settings.allowedPermissionProfileIds.includes(settings.defaultPermissionProfileId)) {
    settings.defaultPermissionProfileId = settings.allowedPermissionProfileIds[0] || '';
  }
  return settings;
}

function emptyPolicySettings() {
  return {
    defaultModel: '', allowedModels: [], allowedProviderIds: [], requireVerifiedModels: false, defaultSkillIds: [], allowedSkillIds: [], allowedConnectorIds: [],
    defaultPermissionProfileId: '', allowedPermissionProfileIds: [], autoCompactThreshold: 0.8, skillPublishMode: 'publisher_direct',
  };
}

function applyPolicyPatch(settings, patch) {
  if (!patch) return settings;
  for (const definition of policyFieldDefinitions) {
    if (Object.hasOwn(patch, definition.key)) settings[definition.key] = structuredClone(patch[definition.key]);
  }
  return settings;
}

function renderPolicies() {
  if (!state.policies) return;
  setText('policy-metric-revision', state.policies.revision || 0);
  setText('policy-metric-models', state.policies.organization?.allowedModels?.length || '不限');
  setText('policy-metric-skills', state.policies.organization?.defaultSkillIds?.length || 0);
  setText('policy-metric-users', Object.keys(state.policies.users || {}).length);
  elements.policiesBody.replaceChildren();
  const rows = policyRows();
  elements.policiesEmpty.hidden = rows.length > 0;
  for (const row of rows) {
    const patch = policyPatchFor(row);
    const effective = policyEffectiveFor(row);
    const availableFields = policyFieldDefinitions.filter((field) => row.type === 'organization' || !field.organizationOnly);
    const overrides = row.type === 'organization' ? availableFields.length : availableFields.filter((field) => Object.hasOwn(patch, field.key)).length;
    const record = document.createElement('tr');
    record.append(
      tableCell('适用范围', policyScopeIdentity(row)),
      tableCell('覆盖状态', pill(row.type === 'organization' ? '组织基线' : overrides ? `覆盖 ${overrides} 项` : '完全继承', overrides || row.type === 'organization' ? 'policy-override' : 'viewer')),
      tableCell('默认模型', policyValue(effective.defaultModel || '产品默认', effective.allowedModels?.length ? `${effective.allowedModels.length} 个允许模型` : '模型不受限')),
      tableCell('默认权限', policyValue(permissionLabel(effective.defaultPermissionProfileId), effective.allowedPermissionProfileIds?.length ? `${effective.allowedPermissionProfileIds.length} 个可选权限` : '权限选择不受限')),
      tableCell('Skill 范围', policyValue(`${effective.defaultSkillIds.length} 个默认`, effective.allowedSkillIds?.length ? `${effective.allowedSkillIds.length} 个允许 Skill` : 'Skill 不受限')),
      tableCell('', actionButton('•••', `管理 ${row.name} 的策略`, () => openPolicyScope(row))),
    );
    elements.policiesBody.append(record);
  }
}

function policyScopeIdentity(row) {
  const wrapper = element('div', 'policy-scope-cell');
  wrapper.append(textElement('span', row.mark, 'policy-scope-mark'));
  const copy = element('span', 'policy-scope-copy');
  copy.append(textElement('strong', row.name), textElement('small', row.detail));
  wrapper.append(copy);
  return wrapper;
}

function policyValue(value, detail) {
  const wrapper = element('span', 'policy-value');
  wrapper.append(textElement('strong', value), textElement('small', detail));
  return wrapper;
}

function permissionLabel(value) {
  return ({
    'analysis-readonly': '请求批准',
    'artifact-approval': '智能审批',
    'workspace-approval': '完全访问',
  })[value] || '产品默认';
}

function buildPolicyForm(row) {
  const organization = row.type === 'organization';
  const patch = policyPatchFor(row);
  const effective = policyEffectiveFor(row);
  const form = element('form', 'drawer-form policy-form');
  form.noValidate = true;
  for (const definition of policyFieldDefinitions) {
    if (!organization && definition.organizationOnly) continue;
    const overridden = organization || Object.hasOwn(patch, definition.key);
    const wrapper = element('section', `policy-field ${overridden ? '' : 'inherited'}`.trim());
    wrapper.dataset.policyField = definition.key;
    const header = element('div', 'policy-field-header');
    header.append(textElement('span', definition.label));
    if (organization) {
      header.append(textElement('span', '组织基线', 'pill policy-override'));
    } else {
      const toggle = element('label', 'policy-override-toggle');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = overridden;
      checkbox.dataset.policyOverride = definition.key;
      toggle.append(checkbox, document.createTextNode('覆盖上级设置'));
      header.append(toggle);
      checkbox.addEventListener('change', () => setPolicyFieldEnabled(wrapper, checkbox.checked));
    }
    wrapper.append(header);
    const field = element('label', 'field');
    field.append(textElement('span', definition.label));
    const control = policyControl(definition);
    control.setAttribute('name', definition.key);
    const value = overridden ? patch[definition.key] : effective[definition.key];
    setPolicyControlValue(control, definition, value);
    field.append(control);
    wrapper.append(field, textElement('small', definition.help));
    setPolicyFieldEnabled(wrapper, overridden);
    form.append(wrapper);
  }
  const error = element('div', 'form-error');
  error.dataset.formError = '';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(error, policyEffectivePreview(effective));
  if (!organization) {
    const resetRow = element('div', 'policy-reset-row');
    const reset = textElement('button', '恢复继承', 'button danger');
    reset.type = 'button';
    reset.dataset.policyReset = '';
    reset.disabled = Object.keys(patch).length === 0;
    resetRow.append(reset);
    form.append(resetRow);
  }
  const actions = element('div', 'drawer-actions');
  const cancel = textElement('button', '取消', 'button quiet');
  cancel.type = 'button';
  cancel.addEventListener('click', closeDrawer);
  const save = textElement('button', '保存策略', 'button primary');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(actions);
  return form;
}

function policyControl(definition) {
  if (definition.type === 'model-select') {
    const select = document.createElement('select');
    select.append(new Option('产品默认', ''));
    for (const provider of modelCatalogProviders().filter((item) => item.enabled)) {
      const group = document.createElement('optgroup');
      group.label = provider.name;
      for (const model of provider.models || []) {
        if (!model.enabled) continue;
        group.append(new Option(`${model.name || model.id} · ${modelVerificationLabel(model.verification)}`, `${provider.id}/${model.id}`));
      }
      select.append(group);
    }
    return select;
  }
  if (definition.type === 'model-list' || definition.type === 'provider-list') {
    const picker = element('div', 'policy-catalog-picker');
    picker.dataset.policyPicker = definition.type;
    const items = definition.type === 'provider-list'
      ? modelCatalogProviders().filter((provider) => provider.enabled).map((provider) => ({
          value: provider.id, label: provider.name, detail: `${provider.models?.filter((model) => model.enabled).length || 0} 个模型`, verified: provider.verification?.status === 'verified',
        }))
      : modelCatalogProviders().filter((provider) => provider.enabled).flatMap((provider) => (provider.models || []).filter((model) => model.enabled).map((model) => ({
          value: `${provider.id}/${model.id}`, label: model.name || model.id, detail: provider.name, verified: model.verification?.status === 'verified',
        })));
    if (!items.length) picker.append(textElement('p', '模型目录为空，请先登记提供商和模型。', 'policy-catalog-empty'));
    for (const item of items) {
      const label = element('label', 'policy-catalog-option');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.value;
      const copy = element('span');
      copy.append(textElement('strong', item.label), textElement('small', item.detail));
      label.append(checkbox, copy, pill(item.verified ? '已验证' : '待验证', item.verified ? 'model-verified' : 'model-untested'));
      picker.append(label);
    }
    return picker;
  }
  if (definition.type === 'boolean') {
    const label = element('label', 'policy-boolean-control');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    label.append(checkbox, textElement('span', '启用这项约束'));
    return label;
  }
  if (definition.type === 'publish-mode') {
    const select = document.createElement('select');
    select.innerHTML = '<option value="publisher_direct">发布者直接发布</option><option value="admin_approval">管理员审核后发布</option>';
    return select;
  }
  if (definition.type === 'permission') {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">产品默认</option><option value="analysis-readonly">请求批准</option><option value="artifact-approval">智能审批</option><option value="workspace-approval">完全访问</option>';
    return select;
  }
  if (definition.type === 'list' || definition.type === 'permission-list') {
    const textarea = document.createElement('textarea');
    textarea.rows = definition.type === 'permission-list' ? 3 : 4;
    return textarea;
  }
  const input = document.createElement('input');
  if (definition.type === 'percent') {
    input.type = 'number';
    input.min = '50';
    input.max = '95';
    input.step = '1';
    input.inputMode = 'numeric';
  }
  return input;
}

function setPolicyControlValue(control, definition, value) {
  if (definition.type === 'boolean') {
    control.querySelector('input').checked = Boolean(value);
    return;
  }
  if (definition.type === 'model-list' || definition.type === 'provider-list') {
    const selected = new Set(Array.isArray(value) ? value : []);
    control.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => { checkbox.checked = selected.has(checkbox.value); });
    return;
  }
  control.value = definition.type === 'percent'
    ? Math.round(Number(value || 0.8) * 100)
    : Array.isArray(value) ? value.join('\n') : value || '';
}

function setPolicyFieldEnabled(wrapper, enabled) {
  wrapper.classList.toggle('inherited', !enabled);
  wrapper.querySelector('.field')?.querySelectorAll('input, select, textarea, button').forEach((control) => { control.disabled = !enabled; });
}

function policyEffectivePreview(settings) {
  const section = element('section', 'policy-effective-preview');
  section.append(textElement('h4', '当前最终策略'), textElement('p', '保存后桌面端会在下一次登录时获取最新策略。'));
  const list = element('dl', 'policy-effective-list');
  const rows = [
    ['默认空间', 'personal:<userId>'],
    ['默认模型', settings.defaultModel || '产品默认'],
    ['允许模型', settings.allowedModels?.length ? settings.allowedModels.join('、') : '不限制'],
    ['允许提供商', settings.allowedProviderIds?.length ? settings.allowedProviderIds.join('、') : '不限制'],
    ['验证要求', settings.requireVerifiedModels ? '仅已验证模型' : '不强制'],
    ['默认 Skill', settings.defaultSkillIds?.length ? settings.defaultSkillIds.join('、') : '无'],
    ['允许 Skill', settings.allowedSkillIds?.length ? settings.allowedSkillIds.join('、') : '不限制'],
    ['允许 Connector', settings.allowedConnectorIds?.length ? settings.allowedConnectorIds.join('、') : '不限制'],
    ['默认权限', permissionLabel(settings.defaultPermissionProfileId)],
    ['允许权限', settings.allowedPermissionProfileIds?.length ? settings.allowedPermissionProfileIds.map(permissionLabel).join('、') : '不限制'],
    ['自动压缩阈值', `${Math.round(Number(settings.autoCompactThreshold || 0.8) * 100)}%`],
    ['Skill 发布方式', settings.skillPublishMode === 'admin_approval' ? '管理员审核后发布' : '发布者直接发布'],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.append(textElement('dt', label), textElement('dd', value));
    list.append(row);
  }
  section.append(list);
  return section;
}

function readPolicyForm(form, organization) {
  const output = {};
  for (const definition of policyFieldDefinitions) {
    const wrapper = form.querySelector(`[data-policy-field="${definition.key}"]`);
    if (!wrapper) continue;
    const overridden = organization || wrapper.querySelector('[data-policy-override]')?.checked;
    if (!overridden) continue;
    const control = wrapper.querySelector('[name]');
    const raw = control?.value || '';
    if (definition.type === 'percent') {
      const percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 50 || percent > 95) {
        throw new Error('自动压缩阈值必须在 50% 到 95% 之间');
      }
      output[definition.key] = percent / 100;
    } else if (definition.type === 'boolean') {
      output[definition.key] = control.querySelector('input').checked;
    } else if (definition.type === 'model-list' || definition.type === 'provider-list') {
      output[definition.key] = [...control.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => checkbox.value);
    } else {
      output[definition.key] = definition.type === 'list' || definition.type === 'permission-list'
        ? [...new Set(raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))]
        : raw.trim();
    }
  }
  if (output.allowedSkillIds?.length) {
    const missing = (output.defaultSkillIds || []).filter((skillId) => !output.allowedSkillIds.includes(skillId));
    if (missing.length) throw new Error(`默认 Skill 必须包含在允许范围中：${missing.join('、')}`);
  }
  if (output.allowedModels?.length && output.defaultModel && !output.allowedModels.includes(output.defaultModel)) {
    throw new Error('默认模型必须包含在允许模型中');
  }
  if (output.allowedProviderIds?.length && output.defaultModel) {
    const providerId = output.defaultModel.split('/', 1)[0];
    if (!output.allowedProviderIds.includes(providerId)) throw new Error('默认模型所属提供商必须包含在允许提供商中');
  }
  return output;
}

function policyEndpoint(row) {
  if (row.type === 'organization') return '/v1/admin/policies/organization';
  if (row.type === 'role') return `/v1/admin/policies/roles/${encodeURIComponent(row.id)}`;
  return `/v1/admin/policies/users/${encodeURIComponent(row.id)}`;
}

function openPolicyScope(row) {
  openDrawer(row.name, row.type === 'organization' ? '组织默认策略' : row.type === 'role' ? '角色策略覆盖' : '用户策略覆盖');
  const form = buildPolicyForm(row);
  elements.drawerContent.append(form);
  form.querySelector('[name]')?.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true, '正在保存…');
    setInlineFormError(form, '');
    try {
      state.policies = await api(policyEndpoint(row), { method: 'PUT', body: readPolicyForm(form, row.type === 'organization') });
      renderPolicies();
      closeDrawer();
      toast('组织策略已保存');
    } catch (error) {
      setInlineFormError(form, error.message);
      setSubmitting(form, false);
    }
  });
  form.querySelector('[data-policy-reset]')?.addEventListener('click', async () => {
    if (!window.confirm(`让 ${row.name} 恢复继承上级策略？`)) return;
    try {
      state.policies = await api(policyEndpoint(row), { method: 'DELETE' });
      renderPolicies();
      closeDrawer();
      toast('策略覆盖已清除');
    } catch (error) {
      setInlineFormError(form, error.message);
    }
  });
}

async function loadAudit() {
  const query = document.getElementById('audit-search').value.trim();
  const action = document.getElementById('audit-action-filter').value;
  const params = new URLSearchParams({ limit: '200' });
  if (query) params.set('q', query);
  if (action) params.set('action', action);
  try {
    const result = await api(`/v1/admin/audit?${params}`);
    state.audit = result.items || [];
    renderAudit();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderAudit() {
  elements.auditBody.replaceChildren();
  elements.auditEmpty.hidden = state.audit.length > 0;
  for (const event of state.audit) {
    const row = document.createElement('tr');
    const actor = event.actor?.name || event.actor?.subject || '匿名请求';
    row.append(
      tableCell('时间', textElement('span', formatDate(event.time), 'date-cell')),
      tableCell('操作', textElement('span', actionLabels[event.action] || event.action, 'audit-action')),
      tableCell('执行者', textElement('span', actor, 'audit-target')),
      tableCell('目标', textElement('span', event.target || '无', 'audit-target')),
      tableCell('来源', textElement('span', remoteHost(event.remote), 'audit-remote')),
    );
    elements.auditBody.append(row);
  }
}

function switchView(view) {
  state.view = view;
  elements.skillsView.hidden = view !== 'skills';
  elements.expertsView.hidden = view !== 'experts';
  elements.operationsView.hidden = view !== 'operations';
  elements.governanceView.hidden = view !== 'governance';
  elements.usersView.hidden = view !== 'users';
  elements.modelCatalogView.hidden = view !== 'model-catalog';
  elements.policiesView.hidden = view !== 'policies';
  elements.auditView.hidden = view !== 'audit';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const viewCopy = {
    skills: ['内容与版本', 'Skill 管理'],
    experts: ['角色、方法与能力', '专家管理'],
    operations: ['分发与排序', '内容运营'],
    governance: ['安装、升级与审核', '安装治理'],
    users: ['账户与权限', '用户管理'],
    'model-catalog': ['连接、能力与验证', '模型目录'],
    policies: ['空间与组织策略', '策略下发'],
    audit: ['安全与追溯', '审计记录'],
  }[view];
  setText('view-eyebrow', viewCopy[0]);
  setText('view-title', viewCopy[1]);
  if (view === 'skills') state.skills.length ? renderSkills() : loadSkills();
  if (view === 'experts') state.experts.length ? renderExperts() : loadExperts();
  if (view === 'operations') state.collections.length || state.recommendationRules.length ? renderOperations() : loadOperations();
  if (view === 'governance') state.governance ? renderGovernance() : loadGovernance();
  if (view === 'model-catalog') state.modelCatalog ? renderModelCatalog() : loadModelCatalog();
  if (view === 'policies') state.policies ? renderPolicies() : loadPolicies();
  if (view === 'audit') loadAudit();
}

function detailSection(title, count = '') {
  const section = element('section', 'detail-section');
  const heading = element('div', 'detail-section-heading');
  heading.append(textElement('h4', title));
  if (count) heading.append(textElement('span', count));
  section.append(heading);
  return section;
}

function setInlineFormError(form, message) {
  const error = form.querySelector('[data-form-error]');
  if (error) setError(error, message);
}

function sessionCount(userID) {
  return state.sessions.filter((session) => session.userId === userID).length;
}

function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const random = [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
  return `Mm7-${random}`;
}

function initial(value) {
  return [...String(value || 'M').trim()][0]?.toUpperCase() || 'M';
}

function formatDate(value) {
  if (!value) return '从未登录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function remoteHost(value) {
  const text = String(value || '本机');
  if (text.startsWith('[')) return text.replace(/^\[([^\]]+)\].*$/, '$1');
  return text.replace(/:\d+$/, '') || '本机';
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}

function element(tag, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement(tag, text, className = '') {
  const node = element(tag, className);
  node.textContent = String(text);
  return node;
}

function toast(message, error = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

let auditSearchTimer = null;
elements.loginForm.addEventListener('submit', handleLogin);
elements.firstPasswordForm.addEventListener('submit', handleFirstPassword);
document.getElementById('logout-button').addEventListener('click', logout);
document.getElementById('upload-skill-button').addEventListener('click', openSkillUpload);
document.getElementById('refresh-skills-button').addEventListener('click', loadSkills);
document.getElementById('create-expert-button').addEventListener('click', () => openExpertEditor());
document.getElementById('refresh-experts-button').addEventListener('click', loadExperts);
document.getElementById('create-collection-button').addEventListener('click', () => openCollectionEditor());
document.getElementById('create-rule-button').addEventListener('click', () => openRecommendationRuleEditor());
document.getElementById('refresh-operations-button').addEventListener('click', loadOperations);
document.getElementById('refresh-governance-button').addEventListener('click', loadGovernance);
document.getElementById('recommendation-simulator-form').addEventListener('submit', runRecommendationSimulation);
document.getElementById('create-user-button').addEventListener('click', openCreateUser);
document.getElementById('refresh-users-button').addEventListener('click', loadUsers);
document.getElementById('create-model-provider-button').addEventListener('click', () => openModelProviderEditor());
document.getElementById('refresh-model-catalog-button').addEventListener('click', loadModelCatalog);
document.getElementById('refresh-policies-button').addEventListener('click', loadPolicies);
document.getElementById('refresh-audit-button').addEventListener('click', loadAudit);
document.getElementById('skill-search').addEventListener('input', renderSkills);
document.getElementById('skill-status-filter').addEventListener('change', renderSkills);
document.getElementById('skill-visibility-filter').addEventListener('change', renderSkills);
document.getElementById('expert-search').addEventListener('input', renderExperts);
document.getElementById('expert-status-filter').addEventListener('change', renderExperts);
document.getElementById('expert-review-filter').addEventListener('change', renderExperts);
document.getElementById('expert-visibility-filter').addEventListener('change', renderExperts);
document.getElementById('governance-search').addEventListener('input', renderGovernance);
document.getElementById('governance-scope-filter').addEventListener('change', renderGovernance);
document.getElementById('governance-upgrade-filter').addEventListener('change', renderGovernance);
document.getElementById('user-search').addEventListener('input', renderUsers);
document.getElementById('role-filter').addEventListener('change', renderUsers);
document.getElementById('status-filter').addEventListener('change', renderUsers);
document.getElementById('model-catalog-search').addEventListener('input', renderModelCatalog);
document.getElementById('model-catalog-status-filter').addEventListener('change', renderModelCatalog);
document.getElementById('policy-search').addEventListener('input', renderPolicies);
document.getElementById('policy-scope-filter').addEventListener('change', renderPolicies);
document.getElementById('audit-action-filter').addEventListener('change', loadAudit);
document.getElementById('audit-search').addEventListener('input', () => {
  window.clearTimeout(auditSearchTimer);
  auditSearchTimer = window.setTimeout(loadAudit, 250);
});
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.drawerLayer.hidden) closeDrawer();
});
restoreAdminSession();
