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

  function resolveCapabilities({ project, expert, task, catalog = {} }) {
    const projectCaps = project?.spec?.capabilities || {};
    const grantMode = capabilityMode(task);
    const taskHasConnectorSelection = grantMode === 'custom';
    const requestedSkills = Shared.uniqueStrings([
      ...(projectCaps.skills || []),
      ...(expert?.requiredSkills || []),
      ...(expert?.recommendedSkills || expert?.skills || []),
      ...(task?.skillIds || []),
    ]);
    const requestedConnectors = Shared.uniqueStrings([
      ...(taskHasConnectorSelection
        ? task.connectorIds
        : [...(projectCaps.connectors || []), ...(expert?.requiredConnectors || []), ...(expert?.recommendedConnectors || [])]),
    ]);
    const selectedTools = taskHasConnectorSelection
      ? (task?.toolSelections && typeof task.toolSelections === 'object' ? task.toolSelections : {})
      : projectCaps.toolSelections || {};
    const skillIndex = indexById(catalog.skills);
    const connectorIndex = indexById(catalog.connectors);
    const skills = [];
    const connectors = [];
    const missing = [];

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
      if (!connector) {
        missing.push({ type: 'connector', id: requested, required: (expert?.requiredConnectors || []).includes(requested) });
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
            : (projectCaps.connectors || []).includes(connector.id) ? 'project' : 'expert',
        ])
      ),
      toolSelections: Object.fromEntries(
        Object.entries(selectedTools)
          .filter(([connectorId, toolNames]) => requestedConnectors.includes(connectorId) && Array.isArray(toolNames))
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

  return { resolveCapabilities, versionlessId, capabilityMode };
});
