(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.CapabilityResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  function versionlessId(value) {
    return typeof value === 'string' ? value.split('@')[0] : '';
  }

  function indexById(items) {
    return new Map((Array.isArray(items) ? items : []).filter(Boolean).map((item) => [item.id, item]));
  }

  function capabilityMode(task = {}) {
    if (task.capabilityMode === 'custom') return 'custom';
    if (task.capabilityMode === 'inherit') return 'inherit';
    const hasLegacySelection = Shared.asArray(task.connectorIds).length > 0
      || Object.keys(task.toolSelections || {}).length > 0;
    return hasLegacySelection ? 'custom' : 'inherit';
  }

  function explicitConnectorIds(prompt, connectors) {
    const normalizedPrompt = String(prompt || '')
      .toLocaleLowerCase()
      .replace(/[\s"'“”‘’「」『』]+/g, '');
    if (!normalizedPrompt) return [];
    return Shared.uniqueStrings(
      Shared.asArray(connectors)
        .filter((connector) => connector?.status === 'connected')
        .filter((connector) => [connector.id, connector.name].some((value) => {
          const token = String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '');
          if (token.length < 2) return false;
          return ['使用', '调用', '通过'].some((verb) => {
            const phrase = `${verb}${token}`;
            let offset = normalizedPrompt.indexOf(phrase);
            while (offset >= 0) {
              const prefix = normalizedPrompt.slice(Math.max(0, offset - 4), offset);
              if (!/(?:不要|禁止|无需|不必|别)$/.test(prefix)) return true;
              offset = normalizedPrompt.indexOf(phrase, offset + phrase.length);
            }
            return false;
          });
        }))
        .map((connector) => connector.id)
    );
  }

  function capabilityIssueLabel(item = {}) {
    const labels = {
      skill: '技能',
      connector: '工具服务',
      tool: '具体工具',
      'tool-catalog': '工具清单',
    };
    const reasons = {
      'not-connected': '未连接',
      'not-selected': '未授权',
      'not-found': '不存在',
      'not-tested': '尚未完成连接测试',
    };
    const label = labels[item.type] || '能力';
    const reason = reasons[item.reason];
    return `${label}“${item.id || '未知'}”${reason ? `（${reason}）` : ''}`;
  }

  function assertCapabilitiesReady(capabilities = {}) {
    if (capabilities.ready !== false) return capabilities;
    const required = Shared.asArray(capabilities.missing).filter((item) => item?.required);
    const detail = required.length
      ? required.map(capabilityIssueLabel).join('、')
      : '存在未就绪的必需能力';
    const error = new Error(`无法启动任务：${detail}。请先在专家、项目或当前任务中完成能力配置。`);
    error.code = 'CAPABILITY_NOT_READY';
    error.capabilities = capabilities;
    throw error;
  }

  function resolveCapabilities({ project, expert, task, catalog = {}, prompt = '' }) {
    const projectCaps = project?.spec?.capabilities || {};
    const grantMode = capabilityMode(task);
    const taskHasConnectorSelection = grantMode === 'custom';
    const promptConnectorIds = taskHasConnectorSelection
      ? []
      : explicitConnectorIds(prompt, catalog.connectors);
    const requestedSkills = Shared.uniqueStrings([
      ...(projectCaps.skills || []),
      ...(expert?.requiredSkills || []),
      ...(expert?.recommendedSkills || expert?.skills || []),
      ...(task?.skillIds || []),
    ]);
    const requestedConnectors = Shared.uniqueStrings([
      ...(taskHasConnectorSelection
        ? task.connectorIds
        : [
            ...(projectCaps.connectors || []),
            ...(expert?.requiredConnectors || []),
            ...(expert?.recommendedConnectors || []),
            ...promptConnectorIds,
          ]),
    ]);
    const selectedTools = taskHasConnectorSelection
      ? (task?.toolSelections && typeof task.toolSelections === 'object' ? task.toolSelections : {})
      : {
          ...(expert?.toolSelections && typeof expert.toolSelections === 'object' ? expert.toolSelections : {}),
          ...(projectCaps.toolSelections && typeof projectCaps.toolSelections === 'object'
            ? projectCaps.toolSelections
            : {}),
        };
    const skillIndex = indexById(catalog.skills);
    const connectorIndex = indexById(catalog.connectors);
    const skills = [];
    const connectors = [];
    const missing = [];
    const skillRequiredConnectors = new Set();

    if (taskHasConnectorSelection) {
      for (const connectorId of Shared.asArray(expert?.requiredConnectors)) {
        if (!requestedConnectors.includes(connectorId)) {
          missing.push({ type: 'connector', id: connectorId, required: true, reason: 'not-selected' });
        }
      }
    }

    for (const requested of requestedSkills) {
      const id = versionlessId(requested);
      const skill = skillIndex.get(id);
      if (!skill) {
        missing.push({ type: 'skill', id: requested, required: (expert?.requiredSkills || []).includes(requested) });
        continue;
      }
      skills.push({ ...skill, requestedVersion: requested.includes('@') ? requested.split('@').slice(1).join('@') : null });
      for (const connectorId of Shared.asArray(skill.requires?.connectors || skill.requiredConnectors)) {
        skillRequiredConnectors.add(versionlessId(connectorId));
        if (requestedConnectors.includes(connectorId)) continue;
        if (taskHasConnectorSelection) {
          missing.push({ type: 'connector', id: connectorId, required: true, reason: 'not-selected' });
        } else {
          requestedConnectors.push(connectorId);
        }
      }
    }

    for (const requested of requestedConnectors) {
      const id = versionlessId(requested);
      const connector = connectorIndex.get(id);
      const required = taskHasConnectorSelection
        || Shared.asArray(projectCaps.connectors).some((item) => versionlessId(item) === id)
        || Shared.asArray(expert?.requiredConnectors).some((item) => versionlessId(item) === id)
        || skillRequiredConnectors.has(id);
      if (!connector) {
        if (required) missing.push({ type: 'connector', id: requested, required: true, reason: 'not-found' });
        continue;
      }
      const available = !connector.status
        || connector.status === 'connected'
        || connector.id === 'local-workspace';
      if (!available) {
        if (required) missing.push({ type: 'connector', id: requested, required: true, reason: 'not-connected' });
        continue;
      }
      connectors.push({ ...connector, requestedVersion: requested.includes('@') ? requested.split('@').slice(1).join('@') : null });
    }

    const resolved = {
      expertId: expert?.id || null,
      grantMode,
      skills,
      connectors,
      connectorSources: Object.fromEntries(
        connectors.map((connector) => [
          connector.id,
          taskHasConnectorSelection
            ? 'task'
            : promptConnectorIds.includes(connector.id) ? 'prompt'
            : (projectCaps.connectors || []).includes(connector.id) ? 'project' : 'expert',
        ])
      ),
      toolSelections: Object.fromEntries(
        Object.entries(selectedTools)
          .filter(([connectorId, toolNames]) => connectors.some((item) => item.id === connectorId) && Array.isArray(toolNames))
          .map(([connectorId, toolNames]) => [connectorId, Shared.uniqueStrings(toolNames)])
      ),
      missing,
      ready: !missing.some((item) => item.required),
    };
    resolved.id = `capset-${Shared.contentHash({
      expertId: resolved.expertId,
      skills: skills.map((item) => [item.id, item.version || item.requestedVersion || null]),
      connectors: connectors.map((item) => [item.id, item.version || item.requestedVersion || null]),
      toolSelections: resolved.toolSelections,
      missing,
    })}`;
    return resolved;
  }

  return {
    resolveCapabilities,
    assertCapabilitiesReady,
    explicitConnectorIds,
    versionlessId,
    capabilityMode,
  };
});
