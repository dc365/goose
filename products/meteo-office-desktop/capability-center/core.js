(function capabilityCenterCore(root) {
  'use strict';

  const center = {
    status: 'loading',
    registry: { skills: [], connectors: [], experts: [], bundledSkills: [] },
    installedOnly: false,
    connectedOnly: false,
    error: '',
  };

  const list = (value) => (Array.isArray(value) ? value : []);
  const installedSkills = () => list(center.registry.skills);
  const configuredConnectors = () => list(center.registry.connectors);
  const bundledSkills = () => list(center.registry.bundledSkills);
  const userExperts = () => list(center.registry.experts);

  function compareSkillVersions(left, right) {
    const parts = (value) => String(value || '0.0.0').replace(/^v/i, '').split('-', 2);
    const [leftCore, leftPrerelease = ''] = parts(left);
    const [rightCore, rightPrerelease = ''] = parts(right);
    const a = leftCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const b = rightCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1;
    }
    if (leftPrerelease === rightPrerelease) return 0;
    if (!leftPrerelease) return 1;
    if (!rightPrerelease) return -1;
    return leftPrerelease.localeCompare(rightPrerelease, 'en', { numeric: true });
  }

  function skillInstallation(skillId, projectId) {
    const matches = installedSkills().filter((item) => item.skillId === skillId);
    if (!matches.length) return null;
    const usesActiveProject = projectId === undefined;
    const targetProjectId = usesActiveProject && typeof getActiveProject === 'function'
      ? getActiveProject()?.id || null
      : projectId || null;
    return matches.find((item) => item.scope === 'project' && item.projectId === targetProjectId)
      || matches.find((item) => item.scope === 'user')
      || (usesActiveProject ? matches.find((item) => item.enabled) || matches[0] : null)
      || null;
  }

  function skillCatalog(projectId) {
    const builtIn = new Map(list(catalog.skills).map((item) => [item.id, item]));
    const bundled = new Map(bundledSkills().map((item) => [item.id, item]));
    const remoteSkills = [
      ...list(root.MeteoMateCapabilityCenter?.skillHub?.state?.skills),
      ...list(root.MeteoMateCapabilityCenter?.skillHub?.state?.recommendations).map((item) => item?.skill),
    ].filter(Boolean);
    const remote = new Map(remoteSkills.map((item) => [item.id, item]));
    const ids = new Set([...builtIn.keys(), ...bundled.keys(), ...installedSkills().map((item) => item.skillId)]);
    return [...ids].map((id) => {
      const base = builtIn.get(id) || {};
      const shipped = bundled.get(id) || null;
      const installation = skillInstallation(id, projectId);
      const remoteSkill = remote.get(id) || null;
      const sidecar = installation?.sidecar || shipped?.sidecar || {};
      const latestVersion = remoteSkill?.latestVersion || '';
      const updateAvailable = Boolean(
        installation?.version && latestVersion && compareSkillVersions(installation.version, latestVersion) < 0
      );
      return {
        id,
        name: installation?.name || shipped?.name || base.name || id,
        description: installation?.description || shipped?.description || base.description || '',
        version: installation?.version || shipped?.version || base.version || '0.1.0',
        category: list(sidecar.categories)[0] || shipped?.category || base.category || '本地技能',
        icon: sidecar.icon || shipped?.icon || base.icon || (installation?.name || shipped?.name || id).slice(0, 1).toUpperCase(),
        tags: list(sidecar.tags).length ? list(sidecar.tags) : list(shipped?.tags).length ? list(shipped.tags) : list(base.tags),
        status: installation ? (installation.enabled ? 'installed-enabled' : 'installed-disabled') : shipped ? 'bundled' : base.status,
        installation,
        bundled: shipped,
        remoteSkill,
        latestVersion,
        updateAvailable,
        risk: installation?.risk || shipped?.risk || null,
        warnings: installation?.warnings || shipped?.warnings || [],
        capabilityType: 'skill',
      };
    });
  }

  function enabledSkillCatalog(projectId) {
    return skillCatalog(projectId).filter((item) => item.installation?.enabled);
  }

  function projectSelectableSkillCatalog(remoteSkills = [], projectId = null) {
    const items = new Map(
      skillCatalog(projectId)
        .filter((item) => item.installation?.enabled || item.bundled)
        .map((item) => [item.id, item])
    );
    for (const remote of list(remoteSkills)) {
      const id = String(remote?.id || '').trim();
      if (!id) continue;
      const existing = items.get(id);
      if (existing) {
        items.set(id, { ...existing, remoteSkill: remote, latestVersion: remote.latestVersion || existing.version });
        continue;
      }
      const installation = skillInstallation(id, projectId);
      items.set(id, {
        id,
        name: remote.name || id,
        description: remote.summary || remote.description || '',
        version: remote.latestVersion || '0.1.0',
        latestVersion: remote.latestVersion || '',
        category: list(remote.categories)[0] || 'SkillHub',
        icon: remote.icon || (remote.name || id).slice(0, 1).toUpperCase(),
        tags: [...new Set([...list(remote.categories), ...list(remote.tags)])],
        status: installation ? 'installed-disabled' : 'skillhub',
        installation,
        remoteSkill: remote,
        capabilityType: 'skill',
      });
    }
    return [...items.values()];
  }

  function connectorCatalog() {
    const builtIn = new Map(list(catalog.connectors).map((item) => [item.id, item]));
    const configured = new Map(configuredConnectors().map((item) => [item.id, item]));
    const ids = new Set([...builtIn.keys(), ...configured.keys()]);
    return [...ids].map((id) => {
      const base = builtIn.get(id) || {};
      const binding = configured.get(id) || null;
      const discoveredTools = binding?.lastTest?.ok && Array.isArray(binding.lastTest.result?.tools)
        ? binding.lastTest.result.tools
        : [];
      const allowedTools = Array.isArray(binding?.toolAllowlist)
        ? new Set(binding.toolAllowlist.map(String))
        : null;
      const tools = allowedTools
        ? discoveredTools.filter((tool) => allowedTools.has(String(tool.name || '')))
        : discoveredTools;
      return {
        id,
        name: binding?.name || base.name || id,
        description: binding?.description || base.description || '',
        version: binding?.version || base.version || '0.1.0',
        category: base.category || '自定义工具',
        icon: base.icon || (binding?.name || id).slice(0, 1).toUpperCase(),
        tags: list(base.tags),
        tools,
        toolCount: binding?.lastTest?.ok ? tools.length : null,
        status: binding ? (binding.policyBlocked ? 'policy-blocked' : binding.enabled ? 'connected' : 'disabled') : base.status,
        binding,
        preset: base.preset || null,
        capabilityType: 'connector',
      };
    });
  }

  function expertCatalog({ includeInactive = false } = {}) {
    return userExperts()
      .filter((item) => includeInactive || item.status === 'enabled')
      .map((item) => ({
        ...item,
        capabilityType: 'expert',
        userManaged: item.source?.type === 'user',
      }));
  }

  function mergedCatalog(input = catalog, projectId) {
    return {
      ...input,
      skills: enabledSkillCatalog(projectId).map((item) => ({
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
        tools: list(item.tools),
        toolCount: item.toolCount,
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

  function effectiveConnectorSelection(task = null, project = null) {
    const resolver = root.MeteoMateHarness?.CapabilityResolver;
    const mode = task
      ? resolver?.capabilityMode(task) || task.capabilityMode || 'inherit'
      : state.draftCapabilityMode === 'custom' ? 'custom' : 'inherit';
    const projectCapabilities = project?.spec?.capabilities || {};
    const connectorIds = mode === 'custom'
      ? [...(task?.connectorIds || state.draftConnectorIds || [])]
      : [...(projectCapabilities.connectors || [])];
    const toolSelections = mode === 'custom'
      ? task?.toolSelections || state.draftToolSelections || {}
      : projectCapabilities.toolSelections || {};
    return {
      mode,
      connectorIds,
      toolSelections: normalizeToolSelections(toolSelections, connectorIds),
    };
  }

  function clearSessionIfCapabilitiesChanged(
    task,
    skillIds,
    connectorIds,
    toolSelections = task?.toolSelections || {},
    capabilityMode = task?.capabilityMode || 'custom'
  ) {
    if (!task) return;
    const normalizedTools = normalizeToolSelections(toolSelections, connectorIds);
    const changed = JSON.stringify(task.skillIds || []) !== JSON.stringify(skillIds)
      || JSON.stringify(task.connectorIds || []) !== JSON.stringify(connectorIds)
      || JSON.stringify(task.toolSelections || {}) !== JSON.stringify(normalizedTools)
      || task.capabilityMode !== capabilityMode;
    task.skillIds = [...skillIds];
    task.capabilityMode = capabilityMode;
    task.connectorIds = [...connectorIds];
    task.toolSelections = normalizedTools;
    if (changed) {
      task.sessionId = null;
      task.sessionCapabilityHash = null;
      task.capabilityLoad = null;
      task.runtimeMode = null;
      task.usage = null;
      task.contextState = { phase: 'idle', message: '' };
    }
    task.updatedAt = Date.now();
  }

  root.MeteoMateCapabilityCenter = {
    center,
    installedSkills,
    configuredConnectors,
    bundledSkills,
    userExperts,
    skillInstallation,
    skillCatalog,
    enabledSkillCatalog,
    projectSelectableSkillCatalog,
    connectorCatalog,
    expertCatalog,
    mergedCatalog,
    refresh,
    syncProjectCapability,
    effectiveConnectorSelection,
    clearSessionIfCapabilitiesChanged,
    compareSkillVersions,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
