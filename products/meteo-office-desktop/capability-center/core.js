(function capabilityCenterCore(root) {
  'use strict';

  const center = {
    status: 'loading',
    registry: { skills: [], connectors: [], bundledSkills: [] },
    installedOnly: false,
    connectedOnly: false,
    error: '',
  };

  const list = (value) => (Array.isArray(value) ? value : []);
  const installedSkills = () => list(center.registry.skills);
  const configuredConnectors = () => list(center.registry.connectors);
  const bundledSkills = () => list(center.registry.bundledSkills);

  function skillInstallation(skillId) {
    const matches = installedSkills().filter((item) => item.skillId === skillId);
    if (!matches.length) return null;
    const projectId = typeof getActiveProject === 'function' ? getActiveProject()?.id : null;
    return matches.find((item) => item.scope === 'project' && item.projectId === projectId)
      || matches.find((item) => item.scope === 'user')
      || matches.find((item) => item.enabled)
      || matches[0];
  }

  function skillCatalog() {
    const builtIn = new Map(list(catalog.skills).map((item) => [item.id, item]));
    const bundled = new Map(bundledSkills().map((item) => [item.id, item]));
    const ids = new Set([...builtIn.keys(), ...bundled.keys(), ...installedSkills().map((item) => item.skillId)]);
    return [...ids].map((id) => {
      const base = builtIn.get(id) || {};
      const shipped = bundled.get(id) || null;
      const installation = skillInstallation(id);
      return {
        id,
        name: installation?.name || shipped?.name || base.name || id,
        description: installation?.description || shipped?.description || base.description || '',
        version: installation?.version || shipped?.version || base.version || '0.1.0',
        category: base.category || '本地技能',
        icon: base.icon || (installation?.name || shipped?.name || id).slice(0, 1).toUpperCase(),
        tags: list(base.tags),
        status: installation ? (installation.enabled ? 'installed-enabled' : 'installed-disabled') : shipped ? 'bundled' : base.status,
        installation,
        bundled: shipped,
        risk: installation?.risk || shipped?.risk || null,
        warnings: installation?.warnings || shipped?.warnings || [],
        capabilityType: 'skill',
      };
    });
  }

  function connectorCatalog() {
    const builtIn = new Map(list(catalog.connectors).map((item) => [item.id, item]));
    const configured = new Map(configuredConnectors().map((item) => [item.id, item]));
    const ids = new Set([...builtIn.keys(), ...configured.keys()]);
    return [...ids].map((id) => {
      const base = builtIn.get(id) || {};
      const binding = configured.get(id) || null;
      return {
        id,
        name: binding?.name || base.name || id,
        description: binding?.description || base.description || '',
        version: binding?.version || base.version || '0.1.0',
        category: base.category || '自定义连接器',
        icon: base.icon || (binding?.name || id).slice(0, 1).toUpperCase(),
        tags: list(base.tags),
        status: binding ? (binding.enabled ? 'connected' : 'disabled') : base.status,
        binding,
        capabilityType: 'connector',
      };
    });
  }

  function mergedCatalog(input = catalog) {
    return {
      ...input,
      skills: skillCatalog().map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        version: item.version,
        status: item.status,
        requires: item.installation?.sidecar?.requires || item.bundled?.requires || {},
      })),
      connectors: connectorCatalog().map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        version: item.version,
        status: item.status,
        transport: item.binding?.transport || null,
      })),
    };
  }

  async function refresh({ rerender = true } = {}) {
    center.status = 'loading';
    center.error = '';
    if (rerender) render();
    try {
      center.registry = await root.meteoDesktop.listCapabilities();
      center.status = 'ready';
    } catch (error) {
      center.status = 'error';
      center.error = error?.message || String(error);
    }
    if (rerender) render();
    return center.registry;
  }

  function syncProjectCapability(type, capabilityId, projectIds) {
    for (const project of state.projects) {
      const normalized = root.MeteoMateHarness?.Project?.normalizeProject(project) || project;
      Object.assign(project, normalized);
      project.spec ||= {};
      project.spec.capabilities ||= { experts: [], skills: [], connectors: [] };
      const values = new Set(project.spec.capabilities[type] || []);
      if (projectIds.includes(project.id)) values.add(capabilityId);
      else values.delete(capabilityId);
      project.spec.capabilities[type] = [...values];
      project.updatedAt = Date.now();
    }
    saveState();
  }

  function clearSessionIfCapabilitiesChanged(task, skillIds, connectorIds) {
    if (!task) return;
    const changed = JSON.stringify(task.skillIds || []) !== JSON.stringify(skillIds)
      || JSON.stringify(task.connectorIds || []) !== JSON.stringify(connectorIds);
    task.skillIds = [...skillIds];
    task.connectorIds = [...connectorIds];
    if (changed && task.sessionId) {
      task.sessionId = null;
      task.runtimeMode = null;
    }
    task.updatedAt = Date.now();
  }

  root.MeteoMateCapabilityCenter = {
    center,
    installedSkills,
    configuredConnectors,
    bundledSkills,
    skillInstallation,
    skillCatalog,
    connectorCatalog,
    mergedCatalog,
    refresh,
    syncProjectCapability,
    clearSessionIfCapabilitiesChanged,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
