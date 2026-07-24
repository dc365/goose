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
  view: 'skills',
  audit: [],
  policies: null,
  toastTimer: null,
};

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

function showLogin(message = '') {
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
    if (result.user.mustChangePassword) {
      document.getElementById('first-username').value = result.user.username;
      elements.loginForm.hidden = true;
      elements.firstPasswordForm.hidden = false;
      document.getElementById('first-current-password').focus();
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
    <details class="expert-form-section" open>
      <summary>基础资料</summary>
      <div class="expert-form-section-content">
        <div class="field-row">
          <label class="field"><span>专家名称</span><input name="name" maxlength="120" required /></label>
          <label class="field"><span>专家 ID</span><input name="id" pattern="[a-z0-9][a-z0-9._-]{2,127}" required /></label>
        </div>
        <div class="field-row">
          <label class="field"><span>版本</span><input name="version" maxlength="64" required /></label>
          <label class="field"><span>头像文字</span><input name="avatar" maxlength="8" placeholder="形" /></label>
        </div>
        <div class="expert-editor-grid">
          <label class="field"><span>可见范围</span><select name="visibility"><option value="organization">组织</option><option value="public">系统公开</option><option value="private">私有</option></select></label>
          <label class="field"><span>分类</span><input name="category" placeholder="天气分析" /></label>
        </div>
        <label class="field"><span>简短说明</span><textarea name="description" placeholder="说明这位专家擅长解决什么问题"></textarea></label>
        <label class="field"><span>核心使命</span><textarea name="mission" placeholder="定义稳定、可验证的交付目标"></textarea></label>
        <label class="field"><span>标签</span><input name="tags" placeholder="形势分析, 预报会商" /></label>
      </div>
    </details>
    <details class="expert-form-section" open>
      <summary>指令与工作方法</summary>
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
    <details class="expert-form-section">
      <summary>Skill 与工具范围</summary>
      <div class="expert-form-section-content">
        <div class="field-row">
          <label class="field"><span>必需 Skill ID</span><textarea name="requiredSkills" placeholder="每行一个"></textarea></label>
          <label class="field"><span>推荐 Skill ID</span><textarea name="recommendedSkills" placeholder="每行一个"></textarea></label>
        </div>
        <div class="field-row">
          <label class="field"><span>必需工具服务 ID</span><textarea name="requiredConnectors" placeholder="每行一个"></textarea></label>
          <label class="field"><span>推荐工具服务 ID</span><textarea name="recommendedConnectors" placeholder="每行一个"></textarea></label>
        </div>
        <label class="field"><span>具体工具范围</span><textarea name="toolSelections" placeholder="每行格式：服务ID: 工具一, 工具二"></textarea><small>未列出的已选工具服务默认允许其全部工具。</small></label>
      </div>
    </details>
    <details class="expert-form-section">
      <summary>运行与数据契约</summary>
      <div class="expert-form-section-content">
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
  for (const name of ['methodology', 'workflow', 'limitations', 'inputs', 'outputs', 'prompts', 'requiredSkills', 'recommendedSkills', 'requiredConnectors', 'recommendedConnectors']) {
    form.elements[name].value = listValue(defaults[name]);
  }
  form.elements.toolSelections.value = toolSelectionValue(defaults.toolSelections);
  form.elements.inputSchema.value = schemaValue(defaults.inputSchema);
  form.elements.outputSchema.value = schemaValue(defaults.outputSchema);
  if (expert) form.elements.id.disabled = true;
  return form;
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
    <label class="field"><span>用户名</span><input name="username" autocomplete="off" pattern="[a-z0-9][a-z0-9._-]{2,63}" required /></label>
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

const policyFieldDefinitions = [
  { key: 'defaultModel', label: '默认模型', type: 'text', help: '使用 provider/model 格式。留空表示沿用桌面端已配置模型。' },
  { key: 'allowedModels', label: '允许使用的模型', type: 'list', help: '每行一个 provider/model。留空表示不限制。' },
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
    state.policies = await api('/v1/admin/policies');
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
    defaultModel: '', allowedModels: [], defaultSkillIds: [], allowedSkillIds: [], allowedConnectorIds: [],
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
    control.name = definition.key;
    const value = overridden ? patch[definition.key] : effective[definition.key];
    control.value = definition.type === 'percent'
      ? Math.round(Number(value || 0.8) * 100)
      : Array.isArray(value) ? value.join('\n') : value || '';
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

function setPolicyFieldEnabled(wrapper, enabled) {
  wrapper.classList.toggle('inherited', !enabled);
  const control = wrapper.querySelector('[name]');
  if (control) control.disabled = !enabled;
}

function policyEffectivePreview(settings) {
  const section = element('section', 'policy-effective-preview');
  section.append(textElement('h4', '当前最终策略'), textElement('p', '保存后桌面端会在下一次登录时获取最新策略。'));
  const list = element('dl', 'policy-effective-list');
  const rows = [
    ['默认空间', 'personal:<userId>'],
    ['默认模型', settings.defaultModel || '产品默认'],
    ['允许模型', settings.allowedModels?.length ? settings.allowedModels.join('、') : '不限制'],
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
    const raw = wrapper.querySelector('[name]').value;
    if (definition.type === 'percent') {
      const percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 50 || percent > 95) {
        throw new Error('自动压缩阈值必须在 50% 到 95% 之间');
      }
      output[definition.key] = percent / 100;
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
  elements.policiesView.hidden = view !== 'policies';
  elements.auditView.hidden = view !== 'audit';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const viewCopy = {
    skills: ['内容与版本', 'Skill 管理'],
    experts: ['角色、方法与能力', '专家管理'],
    operations: ['分发与排序', '内容运营'],
    governance: ['安装、升级与审核', '安装治理'],
    users: ['账户与权限', '用户管理'],
    policies: ['空间与组织策略', '策略下发'],
    audit: ['安全与追溯', '审计记录'],
  }[view];
  setText('view-eyebrow', viewCopy[0]);
  setText('view-title', viewCopy[1]);
  if (view === 'skills') state.skills.length ? renderSkills() : loadSkills();
  if (view === 'experts') state.experts.length ? renderExperts() : loadExperts();
  if (view === 'operations') state.collections.length || state.recommendationRules.length ? renderOperations() : loadOperations();
  if (view === 'governance') state.governance ? renderGovernance() : loadGovernance();
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
document.getElementById('login-username').focus();
