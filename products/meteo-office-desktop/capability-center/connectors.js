(function capabilityCenterConnectors(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;
  const { modal, error, projectOptions } = api.ui;
  const selectedProjects = (element) => [...element.querySelectorAll('input[name="projectIds"]:checked')].map((input) => input.value);

  function discoveryTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  }

  function toolCatalogMarkup(lastTest, toolAllowlist = null) {
    if (!lastTest?.ok) return '';
    const discoveredTools = Array.isArray(lastTest.result?.tools) ? lastTest.result.tools : [];
    const allowed = Array.isArray(toolAllowlist) ? new Set(toolAllowlist.map(String)) : null;
    const tools = allowed
      ? discoveredTools.filter((tool) => allowed.has(String(tool.name || '')))
      : discoveredTools;
    const blockedCount = discoveredTools.length - tools.length;
    const searchable = tools.length > 5;
    const toolItems = tools.map((tool) => {
      const name = String(tool.name || '未命名工具');
      const description = String(tool.description || '').trim();
      const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
      const required = new Set(Array.isArray(tool.requiredParameters) ? tool.requiredParameters : []);
      const parameterSummary = parameters.length
        ? `<div class="connector-tool-parameters"><span>${parameters.length} 个参数</span>${parameters.slice(0, 5).map((parameter) => `<code>${escapeHtml(parameter)}${required.has(parameter) ? '<b aria-label="必填">*</b>' : ''}</code>`).join('')}${parameters.length > 5 ? `<span>+${parameters.length - 5}</span>` : ''}</div>`
        : '';
      return `<article class="connector-tool-item" data-tool-search="${escapeHtml(`${name} ${description}`.toLocaleLowerCase())}">
        <div class="connector-tool-glyph" aria-hidden="true">ƒ</div>
        <div class="connector-tool-content"><code class="connector-tool-name">${escapeHtml(name)}</code><p class="${description ? '' : 'is-empty'}">${escapeHtml(description || '该工具服务未提供描述。')}</p>${parameterSummary}</div>
      </article>`;
    }).join('');
    const checkedAt = discoveryTime(lastTest.checkedAt);
    return `<section class="connector-tool-catalog" aria-labelledby="connector-tool-catalog-title">
      <header class="connector-tool-catalog-header">
        <div><span class="connector-tool-catalog-icon" aria-hidden="true">⌘</span><div><h3 id="connector-tool-catalog-title">可用工具 <small data-tool-count>${tools.length}</small></h3><p>${checkedAt ? `最近发现于 ${escapeHtml(checkedAt)}` : '来自最近一次连接测试'}</p></div></div>
        ${searchable ? '<label class="connector-tool-search"><span class="sr-only">搜索可用工具</span><input type="search" data-tool-search-input placeholder="搜索工具名称或描述" autocomplete="off" /></label>' : ''}
      </header>
      ${blockedCount ? `<p class="capability-muted">安全策略已隐藏 ${blockedCount} 个高风险工具。</p>` : ''}
      ${tools.length ? `<div class="connector-tool-list">${toolItems}</div><div class="connector-tool-empty" data-tool-empty hidden>没有匹配的工具</div>` : '<div class="connector-tool-empty">连接成功，但服务没有返回可用工具。请确认服务已声明 tools 能力。</div>'}
    </section>`;
  }

  function attachToolSearch(element) {
    const input = element.querySelector('[data-tool-search-input]');
    if (!input) return;
    const items = [...element.querySelectorAll('.connector-tool-item')];
    const count = element.querySelector('[data-tool-count]');
    const empty = element.querySelector('[data-tool-empty]');
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      items.forEach((item) => {
        const matched = !query || item.dataset.toolSearch.includes(query);
        item.hidden = !matched;
        if (matched) visible += 1;
      });
      if (count) count.textContent = query ? `${visible}/${items.length}` : String(items.length);
      if (empty) empty.hidden = visible > 0;
    });
  }

  function formValue(element, lastTest = null) {
    return {
      id: element.querySelector('#connector-id').value,
      name: element.querySelector('#connector-name').value,
      description: element.querySelector('#connector-description').value,
      transport: element.querySelector('#connector-transport').value,
      command: element.querySelector('#connector-command').value,
      args: element.querySelector('#connector-args').value,
      cwd: element.querySelector('#connector-cwd').value,
      url: element.querySelector('#connector-url').value,
      env: element.querySelector('#connector-env').value,
      headers: element.querySelector('#connector-headers').value,
      timeout: Number(element.querySelector('#connector-timeout').value || 30),
      projectIds: selectedProjects(element),
      enabled: element.querySelector('#connector-enabled').checked,
      lastTest,
    };
  }

  function editor(item = null, requestedTransport = null) {
    const binding = item?.binding || null;
    const preset = item?.preset || null;
    const source = binding || preset || {};
    const managedPreset = Boolean(preset);
    const toolAllowlist = binding?.toolAllowlist || preset?.toolAllowlist || null;
    const transport = requestedTransport || source.transport || 'stdio';
    let latestTest = binding?.lastTest || null;
    modal(`<header class="capability-modal-header connector-modal-header"><div><span class="connector-modal-eyebrow">MCP TOOL SERVICE</span><h2>${binding ? '管理工具服务' : managedPreset ? '启用浏览器操作' : '添加工具服务'}</h2><p>连接配置与项目授权保存在当前用户空间，凭据仅保留在本机。</p></div><button data-modal-close aria-label="关闭工具服务配置">×</button></header>
      <div class="capability-modal-body connector-editor">
        ${managedPreset ? '<div class="connector-test-result full success">由 MeteoMate 托管 Playwright MCP 版本、隔离模式和安全工具范围；测试成功后即可绑定项目使用。</div>' : ''}
        <section class="connector-editor-section">
          <div class="connector-section-heading"><div><span>01</span><h3>基本信息</h3></div><p>用于在任务和技能中识别这个工具服务。</p></div>
          <div class="connector-form-grid">
            <label><span>名称</span><input id="connector-name" value="${escapeHtml(source.name || item?.name || '')}" placeholder="例如：气象数据服务" /></label>
            <label><span>服务 ID</span><input id="connector-id" class="connector-code-input" value="${escapeHtml(source.id || item?.id || '')}" ${binding || managedPreset ? 'readonly' : ''} placeholder="weather-data" /></label>
            <label class="full"><span>说明</span><textarea id="connector-description" rows="2" placeholder="说明该服务提供什么能力，以及适用场景">${escapeHtml(source.description || item?.description || '')}</textarea></label>
          </div>
        </section>
        <section class="connector-editor-section">
          <div class="connector-section-heading"><div><span>02</span><h3>连接配置</h3></div><p>选择 MCP 传输方式，并填写对应的启动或服务地址。</p></div>
          <div class="connector-form-grid connector-connection-grid">
            <label><span>传输方式</span><select id="connector-transport" ${managedPreset ? 'disabled' : ''}><option value="stdio" ${transport === 'stdio' ? 'selected' : ''}>STDIO MCP</option><option value="streamable-http" ${transport === 'streamable-http' ? 'selected' : ''}>Streamable HTTP</option></select></label>
            <label><span>连接超时</span><div class="connector-input-suffix"><input id="connector-timeout" type="number" min="3" max="600" value="${source.timeout || 30}" ${managedPreset ? 'readonly' : ''}/><small>秒</small></div></label>
            <div class="connector-transport-fields full" data-transport-fields="stdio">
              <label><span>启动命令</span><input id="connector-command" class="connector-code-input" value="${escapeHtml(source.command || '')}" placeholder="uv / npx / python" ${managedPreset ? 'readonly' : ''}/></label>
              <label><span>参数</span><textarea id="connector-args" rows="3" placeholder="每行一个参数，例如：\nweather-data-mcp\n--stdio" ${managedPreset ? 'readonly' : ''}>${escapeHtml((source.args || []).join('\n'))}</textarea></label>
              <label class="full"><span>工作目录</span><input id="connector-cwd" value="${escapeHtml(source.cwd || '')}" placeholder="可选，默认使用当前项目目录" ${managedPreset ? 'readonly' : ''}/></label>
            </div>
            <div class="connector-transport-fields full" data-transport-fields="streamable-http">
              <label><span>服务地址</span><input id="connector-url" class="connector-code-input" value="${escapeHtml(binding?.url || '')}" placeholder="https://example.internal/mcp" /></label>
              <label><span>请求 Headers</span><textarea id="connector-headers" rows="3" spellcheck="false" placeholder="每行一个，例如：\nAuthorization=Bearer ..."></textarea></label>
            </div>
          </div>
        </section>
        <section class="connector-editor-section connector-secret-section">
          <div class="connector-section-heading"><div><span>03</span><h3>本机环境变量</h3></div><p>每行填写一个 KEY=VALUE，仅保存在当前用户本机，当前版本未使用钥匙串加密。</p></div>
          <label class="connector-secret-field"><textarea id="connector-env" rows="3" spellcheck="false" placeholder="API_KEY=..."></textarea></label>
        </section>
        <section class="connector-editor-section">
          <div class="connector-section-heading"><div><span>04</span><h3>使用范围</h3></div><p>决定保存后的启用状态，以及哪些项目可以调用这个服务。</p></div>
          <div class="connector-scope-grid">
            <label class="connector-enable-option"><input id="connector-enabled" type="checkbox" ${source.enabled === false ? '' : 'checked'}/><span><strong>保存后启用</strong><small>启用后，已绑定项目可在任务和技能中调用此服务。</small></span></label>
            <div class="connector-project-binding"><div class="connector-project-heading"><strong>绑定项目</strong><small>未选择时仅保存配置，不授权给项目。</small></div><div class="capability-project-list">${projectOptions(source.projectIds || [])}</div></div>
          </div>
        </section>
        <div class="connector-test-result full ${binding?.lastTest?.ok ? 'success' : binding?.lastTest ? 'failed' : ''}" id="connector-test-result" role="status" aria-live="polite">${binding?.lastTest ? binding.lastTest.ok ? `最近测试成功${binding.lastTest.result?.tools?.length ? `，发现 ${binding.lastTest.result.tools.length} 个工具` : ''}` : `最近测试失败：${escapeHtml(binding.lastTest.error || '')}` : '尚未测试连接'}</div>
        <div id="connector-tool-catalog-root">${toolCatalogMarkup(binding?.lastTest, toolAllowlist)}</div>
      </div>
      <footer class="capability-modal-footer connector-modal-footer">${binding ? '<button class="danger-text-button" id="delete-connector">删除服务</button>' : ''}<span class="capability-modal-spacer"></span><button class="ghost-button" data-modal-close>取消</button><button class="ghost-button" id="test-connector">测试连接</button><button class="primary-button" id="save-connector">保存工具服务</button></footer>`, {
      wide: true,
      onReady(element) {
        element.querySelector('.capability-modal')?.classList.add('connector-modal');
        const transportSelect = element.querySelector('#connector-transport');
        const updateTransport = () => element.querySelectorAll('[data-transport-fields]').forEach((section) => { section.hidden = section.dataset.transportFields !== transportSelect.value; });
        const invalidateDiscovery = () => {
          if (!latestTest) return;
          latestTest = null;
          element.querySelector('#connector-tool-catalog-root').replaceChildren();
          const resultBox = element.querySelector('#connector-test-result');
          resultBox.className = 'connector-test-result full';
          resultBox.textContent = '连接配置已修改，请重新测试以刷新工具目录。';
        };
        transportSelect.addEventListener('change', () => {
          updateTransport();
          invalidateDiscovery();
        });
        ['connector-command', 'connector-args', 'connector-cwd', 'connector-url', 'connector-env', 'connector-headers', 'connector-timeout']
          .forEach((id) => element.querySelector(`#${id}`)?.addEventListener('input', invalidateDiscovery));
        updateTransport();
        attachToolSearch(element);
        element.querySelector('#test-connector').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const resultBox = element.querySelector('#connector-test-result');
          const catalogRoot = element.querySelector('#connector-tool-catalog-root');
          button.disabled = true;
          button.textContent = '测试中…';
          resultBox.className = 'connector-test-result full pending';
          resultBox.textContent = '正在连接并读取 MCP 信息…';
          try {
            const result = await root.meteoDesktop.testConnector(formValue(element));
            latestTest = result;
            resultBox.className = `connector-test-result full ${result.ok ? 'success' : 'failed'}`;
            const discoveredCount = result.result?.tools?.length || 0;
            const enabledCount = Array.isArray(toolAllowlist)
              ? result.result?.tools?.filter((tool) => toolAllowlist.includes(tool.name)).length || 0
              : discoveredCount;
            resultBox.textContent = result.ok ? `连接成功，耗时 ${result.durationMs}ms${discoveredCount ? `，启用 ${enabledCount}/${discoveredCount} 个工具` : ''}` : `连接失败：${result.error}`;
            catalogRoot.innerHTML = toolCatalogMarkup(result, toolAllowlist);
            attachToolSearch(catalogRoot);
          } catch (cause) {
            latestTest = null;
            resultBox.className = 'connector-test-result full failed';
            resultBox.textContent = `连接失败：${cause?.message || cause}`;
            catalogRoot.replaceChildren();
          } finally {
            button.disabled = false;
            button.textContent = '测试连接';
          }
        });
        element.querySelector('#save-connector').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = '保存中…';
          try {
            const result = await root.meteoDesktop.saveConnector(formValue(element, latestTest));
            api.center.registry = result.registry;
            api.syncProjectCapability('connectors', result.connector.id, result.connector.projectIds || []);
            element.remove();
            render();
          } catch (cause) {
            button.disabled = false;
            button.textContent = '保存工具服务';
            element.querySelector('#connector-test-result').className = 'connector-test-result full failed';
            element.querySelector('#connector-test-result').textContent = cause?.message || String(cause);
          }
        });
        element.querySelector('#delete-connector')?.addEventListener('click', async () => {
          if (!confirm(`确定删除工具服务“${binding.name}”吗？`)) return;
          const result = await root.meteoDesktop.deleteConnector(binding.id);
          api.center.registry = result.registry;
          api.syncProjectCapability('connectors', binding.id, []);
          element.remove();
          render();
        });
      },
    });
  }

  function manage(item) {
    if (item.binding?.policyBlocked) return error('组织策略限制', '当前账户不能使用这个工具。请联系管理员调整角色或用户策略。');
    if (!item.binding && !item.preset && ['runtime', 'beta'].includes(item.status)) return error('内置能力', '该能力由 MeteoMate 管理，不需要单独配置。');
    editor(item, item.binding?.transport || 'stdio');
  }

  api.connectors = { editor, manage };
})(typeof globalThis !== 'undefined' ? globalThis : window);
