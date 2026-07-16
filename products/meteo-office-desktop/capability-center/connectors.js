(function capabilityCenterConnectors(root) {
  'use strict';
  const api = root.MeteoMateCapabilityCenter;
  const { modal, error, projectOptions } = api.ui;
  const selectedProjects = (element) => [...element.querySelectorAll('input[name="projectIds"]:checked')].map((input) => input.value);

  function formValue(element) {
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
    };
  }

  function editor(item = null, requestedTransport = null) {
    const binding = item?.binding || null;
    const transport = requestedTransport || binding?.transport || 'stdio';
    modal(`<header class="capability-modal-header"><div><h2>${binding ? '管理连接器' : '添加连接器'}</h2><p>MCP 配置、凭据与项目授权分别保存</p></div><button data-modal-close>×</button></header>
      <div class="capability-modal-body connector-form-grid"><label>名称<input id="connector-name" value="${escapeHtml(binding?.name || item?.name || '')}" /></label><label>ID<input id="connector-id" value="${escapeHtml(binding?.id || item?.id || '')}" ${binding ? 'readonly' : ''}/></label><label class="full">说明<textarea id="connector-description">${escapeHtml(binding?.description || item?.description || '')}</textarea></label><label>传输方式<select id="connector-transport"><option value="stdio" ${transport === 'stdio' ? 'selected' : ''}>STDIO MCP</option><option value="streamable-http" ${transport === 'streamable-http' ? 'selected' : ''}>Streamable HTTP</option></select></label><label>超时（秒）<input id="connector-timeout" type="number" min="3" max="600" value="${binding?.timeout || 30}" /></label>
        <div class="connector-transport-fields full" data-transport-fields="stdio"><label>命令<input id="connector-command" value="${escapeHtml(binding?.command || '')}" placeholder="例如 uv / npx / python" /></label><label>参数（每行一个）<textarea id="connector-args" placeholder="例如：\nweather-data-mcp\n--stdio">${escapeHtml((binding?.args || []).join('\n'))}</textarea></label><label>工作目录<input id="connector-cwd" value="${escapeHtml(binding?.cwd || '')}" placeholder="可选" /></label></div>
        <div class="connector-transport-fields full" data-transport-fields="streamable-http"><label>Endpoint URL<input id="connector-url" value="${escapeHtml(binding?.url || '')}" placeholder="https://example.internal/mcp" /></label><label>Headers（KEY=VALUE，每行一个）<textarea id="connector-headers" placeholder="Authorization=Bearer ..."></textarea></label></div>
        <label class="full">环境变量（KEY=VALUE，每行一个；值将加密保存）<textarea id="connector-env" placeholder="API_KEY=..."></textarea></label><label class="toggle-row full"><input id="connector-enabled" type="checkbox" ${binding?.enabled === false ? '' : 'checked'}/> 保存后启用</label><section class="full"><h4>绑定项目</h4><div class="capability-project-list">${projectOptions(binding?.projectIds || [])}</div></section><div class="connector-test-result full" id="connector-test-result">${binding?.lastTest ? binding.lastTest.ok ? '最近测试成功' : `最近测试失败：${escapeHtml(binding.lastTest.error || '')}` : '尚未测试连接'}</div></div>
      <footer class="capability-modal-footer">${binding ? '<button class="danger-text-button" id="delete-connector">删除</button>' : ''}<span class="capability-modal-spacer"></span><button class="ghost-button" id="test-connector">测试连接</button><button class="primary-button" id="save-connector">保存连接器</button></footer>`, {
      wide: true,
      onReady(element) {
        const transportSelect = element.querySelector('#connector-transport');
        const updateTransport = () => element.querySelectorAll('[data-transport-fields]').forEach((section) => { section.hidden = section.dataset.transportFields !== transportSelect.value; });
        transportSelect.addEventListener('change', updateTransport);
        updateTransport();
        element.querySelector('#test-connector').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const resultBox = element.querySelector('#connector-test-result');
          button.disabled = true;
          resultBox.textContent = '正在连接并读取 MCP 信息…';
          try {
            const result = await root.meteoDesktop.testConnector(formValue(element));
            resultBox.className = `connector-test-result full ${result.ok ? 'success' : 'failed'}`;
            resultBox.textContent = result.ok ? `连接成功，耗时 ${result.durationMs}ms${result.result?.tools?.length ? `，发现 ${result.result.tools.length} 个工具` : ''}` : `连接失败：${result.error}`;
          } catch (cause) {
            resultBox.className = 'connector-test-result full failed';
            resultBox.textContent = `连接失败：${cause?.message || cause}`;
          } finally {
            button.disabled = false;
          }
        });
        element.querySelector('#save-connector').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            const result = await root.meteoDesktop.saveConnector(formValue(element));
            api.center.registry = result.registry;
            api.syncProjectCapability('connectors', result.connector.id, result.connector.projectIds || []);
            element.remove();
            render();
          } catch (cause) {
            button.disabled = false;
            element.querySelector('#connector-test-result').className = 'connector-test-result full failed';
            element.querySelector('#connector-test-result').textContent = cause?.message || String(cause);
          }
        });
        element.querySelector('#delete-connector')?.addEventListener('click', async () => {
          if (!confirm(`确定删除连接器“${binding.name}”吗？`)) return;
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
    if (!item.binding && ['runtime', 'beta'].includes(item.status)) return error('内置能力', '该能力由 MeteoMate 管理，不需要单独配置。');
    editor(item, item.binding?.transport || 'stdio');
  }

  api.connectors = { editor, manage };
})(typeof globalThis !== 'undefined' ? globalThis : window);
