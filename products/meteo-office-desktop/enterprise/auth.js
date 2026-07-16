(function enterpriseAuth(root) {
  'use strict';

  const enterprise = root.MeteoMateEnterprise;
  const api = root.MeteoMateCapabilityCenter;
  const { modal, error } = api.ui;

  function loginDialog() {
    const current = enterprise.state.account || {};
    modal(`<header class="capability-modal-header"><div><h2>登录 MeteoMate 企业空间</h2><p>登录后同步组织项目、团队 Skill 和企业连接器</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body enterprise-login-form">
        <label><span>服务地址</span><input id="enterprise-base-url" value="${escapeHtml(current.baseUrl || 'http://127.0.0.1:8088')}" /></label>
        <label><span>用户名或邮箱</span><input id="enterprise-username" autocomplete="username" /></label>
        <label><span>密码</span><input id="enterprise-password" type="password" autocomplete="current-password" /></label>
        <label class="enterprise-check"><input id="enterprise-remember" type="checkbox" /> 保持登录 30 天</label>
        <div class="capability-error-block" id="enterprise-login-error" hidden></div>
      </div>
      <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="enterprise-login-submit">登录</button></footer>`, {
      onReady(element) {
        const submit = element.querySelector('#enterprise-login-submit');
        const password = element.querySelector('#enterprise-password');
        const perform = async () => {
          const message = element.querySelector('#enterprise-login-error');
          message.hidden = true;
          submit.disabled = true;
          submit.textContent = '登录中…';
          try {
            enterprise.state.account = await root.meteoDesktop.enterpriseLogin({
              baseUrl: element.querySelector('#enterprise-base-url').value,
              username: element.querySelector('#enterprise-username').value,
              password: password.value,
              remember: element.querySelector('#enterprise-remember').checked,
            });
            await enterprise.refreshData();
            element.remove();
            render();
          } catch (cause) {
            submit.disabled = false;
            submit.textContent = '登录';
            message.hidden = false;
            message.textContent = cause?.message || String(cause);
          }
        };
        submit.addEventListener('click', perform);
        password.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void perform();
        });
        element.querySelector('#enterprise-username').focus();
      },
    });
  }

  function createUserDialog() {
    const org = enterprise.activeOrganization();
    if (!org) return error('无法创建用户', '当前没有可用组织。');
    modal(`<header class="capability-modal-header"><div><h2>添加组织用户</h2><p>${escapeHtml(org.name)}</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body enterprise-form-grid">
        <label><span>用户名 *</span><input id="enterprise-new-username" /></label>
        <label><span>显示名称 *</span><input id="enterprise-new-display-name" /></label>
        <label><span>邮箱</span><input id="enterprise-new-email" type="email" /></label>
        <label><span>组织角色</span><select id="enterprise-new-role"><option value="viewer">查看者</option><option value="member" selected>成员</option><option value="publisher">发布者</option><option value="admin">管理员</option></select></label>
        <label class="wide"><span>初始密码 *</span><input id="enterprise-new-password" type="password" /></label>
        <div class="capability-error-block wide" id="enterprise-new-user-error" hidden></div>
      </div>
      <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="enterprise-create-user">创建用户</button></footer>`, {
      onReady(element) {
        element.querySelector('#enterprise-create-user').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const errorBox = element.querySelector('#enterprise-new-user-error');
          button.disabled = true;
          errorBox.hidden = true;
          try {
            await root.meteoDesktop.createEnterpriseUser({
              username: element.querySelector('#enterprise-new-username').value,
              displayName: element.querySelector('#enterprise-new-display-name').value,
              email: element.querySelector('#enterprise-new-email').value,
              password: element.querySelector('#enterprise-new-password').value,
              orgId: org.id,
              role: element.querySelector('#enterprise-new-role').value,
            });
            await enterprise.refreshData();
            element.remove();
            accountDialog();
          } catch (cause) {
            button.disabled = false;
            errorBox.hidden = false;
            errorBox.textContent = cause?.message || String(cause);
          }
        });
      },
    });
  }

  function usersMarkup() {
    if (!enterprise.canManageOrganization()) return '';
    const users = enterprise.state.users;
    return `<section class="enterprise-account-section"><div class="enterprise-section-heading"><div><h3>组织成员</h3><p>账号、角色与项目成员由企业空间统一管理</p></div><button class="ghost-button compact" id="enterprise-add-user">添加用户</button></div>
      <div class="enterprise-member-list">${users.length ? users.map((membership) => {
        const user = membership.user || {};
        return `<article><span class="enterprise-user-avatar">${escapeHtml((user.displayName || user.username || 'U').slice(0, 1))}</span><div><strong>${escapeHtml(user.displayName || user.username)}</strong><small>${escapeHtml(user.email || user.username)} · ${escapeHtml(membership.role)}</small></div><span class="capability-status ${user.status === 'active' ? 'ready' : ''}">${escapeHtml(user.status || 'active')}</span><button class="ghost-button compact" data-enterprise-user="${escapeHtml(membership.userId)}">管理</button></article>`;
      }).join('') : '<p class="capability-muted">暂无成员。</p>'}</div></section>`;
  }

  function createOrganizationDialog() {
    modal(`<header class="capability-modal-header"><div><h2>创建组织</h2><p>仅系统管理员可以创建新的企业空间</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body enterprise-form-grid"><label><span>组织名称 *</span><input id="enterprise-org-name" /></label><label><span>Slug *</span><input id="enterprise-org-slug" placeholder="weather-center" /></label><label class="wide"><span>说明</span><textarea id="enterprise-org-description"></textarea></label><div class="capability-error-block wide" id="enterprise-org-error" hidden></div></div>
      <footer class="capability-modal-footer"><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="enterprise-org-submit">创建组织</button></footer>`, {
      onReady(element) {
        element.querySelector('#enterprise-org-submit').addEventListener('click', async (event) => {
          const errorBox = element.querySelector('#enterprise-org-error');
          event.currentTarget.disabled = true;
          errorBox.hidden = true;
          try {
            await root.meteoDesktop.createEnterpriseOrganization({
              name: element.querySelector('#enterprise-org-name').value,
              slug: element.querySelector('#enterprise-org-slug').value,
              description: element.querySelector('#enterprise-org-description').value,
            });
            await enterprise.refreshSession();
            await enterprise.refreshData();
            element.remove();
            accountDialog();
          } catch (cause) {
            event.currentTarget.disabled = false;
            errorBox.hidden = false;
            errorBox.textContent = cause?.message || String(cause);
          }
        });
      },
    });
  }

  function userManager(membership) {
    const user = membership?.user || {};
    const org = enterprise.activeOrganization();
    if (!user.id || !org) return error('无法管理用户', '用户或组织信息不完整。');
    const isSelf = user.id === enterprise.actor()?.subject;
    modal(`<header class="capability-modal-header"><div><h2>管理用户</h2><p>${escapeHtml(user.username || user.id)} · ${escapeHtml(org.name)}</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body enterprise-form-grid">
        <label><span>显示名称</span><input id="enterprise-user-display-name" value="${escapeHtml(user.displayName || '')}" /></label>
        <label><span>邮箱</span><input id="enterprise-user-email" value="${escapeHtml(user.email || '')}" /></label>
        <label><span>组织角色</span><select id="enterprise-user-role"><option value="viewer">查看者</option><option value="member">成员</option><option value="publisher">发布者</option><option value="admin">管理员</option>${enterprise.role() === 'owner' || enterprise.actor()?.systemRole === 'admin' ? '<option value="owner">所有者</option>' : ''}</select></label>
        <label><span>账号状态</span><select id="enterprise-user-status" ${isSelf ? 'disabled' : ''}><option value="active">启用</option><option value="disabled">停用</option></select></label>
        <label class="wide"><span>重置密码（留空不修改）</span><input id="enterprise-user-password" type="password" autocomplete="new-password" placeholder="至少 10 个字符" /></label>
        <div class="capability-error-block wide" id="enterprise-user-manage-error" hidden></div>
      </div><footer class="capability-modal-footer">${!isSelf && membership.role !== 'owner' ? '<button class="danger-text-button" id="enterprise-remove-member">移出组织</button>' : ''}<span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button><button class="primary-button" id="enterprise-user-save">保存</button></footer>`, {
      onReady(element) {
        element.querySelector('#enterprise-user-role').value = membership.role || 'viewer';
        element.querySelector('#enterprise-user-status').value = user.status || 'active';
        element.querySelector('#enterprise-user-save').addEventListener('click', async (event) => {
          const errorBox = element.querySelector('#enterprise-user-manage-error');
          event.currentTarget.disabled = true;
          errorBox.hidden = true;
          try {
            await root.meteoDesktop.updateEnterpriseUser({ id: user.id, patch: {
              displayName: element.querySelector('#enterprise-user-display-name').value,
              email: element.querySelector('#enterprise-user-email').value,
              ...(!isSelf ? { status: element.querySelector('#enterprise-user-status').value } : {}),
            }});
            await root.meteoDesktop.putEnterpriseMember({ orgId: org.id, userId: user.id, role: element.querySelector('#enterprise-user-role').value });
            const password = element.querySelector('#enterprise-user-password').value;
            if (password) await root.meteoDesktop.resetEnterprisePassword({ id: user.id, password });
            if (password && isSelf) {
              enterprise.state.account = await root.meteoDesktop.enterpriseLogout();
              await enterprise.refreshData();
              element.remove();
              return loginDialog();
            }
            await enterprise.refreshSession().catch(() => null);
            await enterprise.refreshData();
            element.remove();
            accountDialog();
          } catch (cause) {
            event.currentTarget.disabled = false;
            errorBox.hidden = false;
            errorBox.textContent = cause?.message || String(cause);
          }
        });
        element.querySelector('#enterprise-remove-member')?.addEventListener('click', async () => {
          if (!confirm(`确定将“${user.displayName || user.username}”移出当前组织吗？`)) return;
          await root.meteoDesktop.removeEnterpriseMember({ orgId: org.id, userId: user.id });
          await enterprise.refreshData();
          element.remove();
          accountDialog();
        });
      },
    });
  }

  function accountDialog() {
    const profile = enterprise.profile();
    if (!profile?.authenticated) return loginDialog();
    const actor = enterprise.actor() || {};
    const orgs = enterprise.organizations();
    const active = enterprise.activeOrganization();
    modal(`<header class="capability-modal-header"><div><h2>企业账号与组织</h2><p>${escapeHtml(actor.name || actor.subject)} · ${escapeHtml(actor.role || '')}</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body enterprise-account-body">
        <section class="enterprise-account-hero"><span>${escapeHtml((actor.name || actor.subject || 'M').slice(0, 1))}</span><div><h3>${escapeHtml(actor.name || actor.subject)}</h3><p>${escapeHtml(actor.email || '')}</p></div><button class="danger-text-button" id="enterprise-logout">退出登录</button></section>
        <section class="enterprise-account-section"><h3>当前组织</h3><select id="enterprise-organization-select">${orgs.map((org) => `<option value="${escapeHtml(org.id)}" ${org.id === active?.id ? 'selected' : ''}>${escapeHtml(org.name)} · ${escapeHtml(org.role || '')}</option>`).join('')}</select></section>
        ${usersMarkup()}
        ${enterprise.state.error ? `<div class="capability-error-block">${escapeHtml(enterprise.state.error)}</div>` : ''}
      </div>
      <footer class="capability-modal-footer">${actor.systemRole === 'admin' ? '<button class="ghost-button" id="enterprise-create-organization">新建组织</button>' : ''}<button class="ghost-button" id="enterprise-refresh">刷新数据</button><button class="primary-button" data-modal-close>完成</button></footer>`, {
      wide: true,
      onReady(element) {
        element.querySelector('#enterprise-organization-select')?.addEventListener('change', async (event) => {
          try {
            enterprise.state.account = await root.meteoDesktop.switchEnterpriseOrganization(event.target.value);
            await enterprise.refreshData();
            element.remove();
            accountDialog();
          } catch (cause) {
            error('切换组织失败', cause?.message || String(cause));
          }
        });
        element.querySelectorAll('[data-enterprise-user]').forEach((button) => button.addEventListener('click', () => {
          const membership = enterprise.state.users.find((item) => item.userId === button.dataset.enterpriseUser);
          element.remove();
          userManager(membership);
        }));
        element.querySelector('#enterprise-create-organization')?.addEventListener('click', () => { element.remove(); createOrganizationDialog(); });
        element.querySelector('#enterprise-add-user')?.addEventListener('click', () => {
          element.remove();
          createUserDialog();
        });
        element.querySelector('#enterprise-refresh').addEventListener('click', async () => {
          await enterprise.refreshSession();
          await enterprise.refreshData();
          element.remove();
          accountDialog();
        });
        element.querySelector('#enterprise-logout').addEventListener('click', async () => {
          enterprise.state.account = await root.meteoDesktop.enterpriseLogout();
          await enterprise.refreshData();
          element.remove();
          render();
        });
      },
    });
  }

  enterprise.auth = { loginDialog, accountDialog, createUserDialog, createOrganizationDialog, userManager };
})(typeof globalThis !== 'undefined' ? globalThis : window);
