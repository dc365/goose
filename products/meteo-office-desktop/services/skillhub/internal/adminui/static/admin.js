'use strict';

const state = {
  token: '',
  user: null,
  users: [],
  sessions: [],
  view: 'users',
  audit: [],
  policies: null,
  toastTimer: null,
};

const roleLabels = { viewer: '使用者', publisher: 'Skill 发布者', admin: '管理员' };
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
  'skill.update': '更新 Skill 资料',
  'skill.owner.transfer': '转交 Skill 负责人',
  'skill.version.upload': '上传 Skill 版本',
  'skill.version.publish': '发布 Skill',
  'skill.version.deprecate': '废弃 Skill 版本',
};

const elements = {
  loginShell: document.getElementById('login-shell'),
  adminShell: document.getElementById('admin-shell'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  firstPasswordForm: document.getElementById('first-password-form'),
  firstPasswordError: document.getElementById('first-password-error'),
  usersView: document.getElementById('users-view'),
  policiesView: document.getElementById('policies-view'),
  auditView: document.getElementById('audit-view'),
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
  await loadUsers();
  await loadPolicies();
}

async function logout() {
  try {
    await api('/v1/auth/logout', { method: 'POST', keepSession: true });
  } catch {}
  showLogin();
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
  { key: 'allowedConnectorIds', label: '允许使用的 Connector', type: 'list', help: '每行一个 Connector ID。留空表示不限制。' },
  { key: 'defaultPermissionProfileId', label: '默认权限', type: 'permission', help: '留空表示沿用专家或助理的产品默认权限。' },
  { key: 'allowedPermissionProfileIds', label: '允许选择的权限', type: 'permission-list', help: '每行一个权限 ID：analysis-readonly、artifact-approval、workspace-approval。留空表示不限制。' },
  { key: 'autoCompactThreshold', label: '自动压缩阈值（%）', type: 'percent', help: '上下文占用达到该比例后自动压缩。可设置 50–95，建议保持 80。' },
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
  settings.allowedConnectorIds ||= [];
  settings.allowedPermissionProfileIds ||= [];
  settings.autoCompactThreshold ||= 0.8;
  if (settings.allowedModels.length && !settings.allowedModels.includes(settings.defaultModel)) settings.defaultModel = '';
  if (settings.allowedPermissionProfileIds.length && !settings.allowedPermissionProfileIds.includes(settings.defaultPermissionProfileId)) {
    settings.defaultPermissionProfileId = settings.allowedPermissionProfileIds[0] || '';
  }
  return settings;
}

function emptyPolicySettings() {
  return {
    defaultModel: '', allowedModels: [], defaultSkillIds: [], allowedConnectorIds: [],
    defaultPermissionProfileId: '', allowedPermissionProfileIds: [], autoCompactThreshold: 0.8,
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
    const overrides = row.type === 'organization' ? policyFieldDefinitions.length : policyFieldDefinitions.filter((field) => Object.hasOwn(patch, field.key)).length;
    const record = document.createElement('tr');
    record.append(
      tableCell('适用范围', policyScopeIdentity(row)),
      tableCell('覆盖状态', pill(row.type === 'organization' ? '组织基线' : overrides ? `覆盖 ${overrides} 项` : '完全继承', overrides || row.type === 'organization' ? 'policy-override' : 'viewer')),
      tableCell('默认模型', policyValue(effective.defaultModel || '产品默认', effective.allowedModels?.length ? `${effective.allowedModels.length} 个允许模型` : '模型不受限')),
      tableCell('默认权限', policyValue(permissionLabel(effective.defaultPermissionProfileId), effective.allowedPermissionProfileIds?.length ? `${effective.allowedPermissionProfileIds.length} 个可选权限` : '权限选择不受限')),
      tableCell('自动压缩', policyValue(`${Math.round(effective.autoCompactThreshold * 100)}%`, '达到阈值后压缩上下文')),
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
    ['允许 Connector', settings.allowedConnectorIds?.length ? settings.allowedConnectorIds.join('、') : '不限制'],
    ['默认权限', permissionLabel(settings.defaultPermissionProfileId)],
    ['允许权限', settings.allowedPermissionProfileIds?.length ? settings.allowedPermissionProfileIds.map(permissionLabel).join('、') : '不限制'],
    ['自动压缩阈值', `${Math.round(Number(settings.autoCompactThreshold || 0.8) * 100)}%`],
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
  elements.usersView.hidden = view !== 'users';
  elements.policiesView.hidden = view !== 'policies';
  elements.auditView.hidden = view !== 'audit';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  setText('view-eyebrow', view === 'users' ? '账户与权限' : view === 'policies' ? '空间与组织策略' : '安全与追溯');
  setText('view-title', view === 'users' ? '用户管理' : view === 'policies' ? '策略下发' : '审计记录');
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
document.getElementById('create-user-button').addEventListener('click', openCreateUser);
document.getElementById('refresh-users-button').addEventListener('click', loadUsers);
document.getElementById('refresh-policies-button').addEventListener('click', loadPolicies);
document.getElementById('refresh-audit-button').addEventListener('click', loadAudit);
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
