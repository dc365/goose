(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.Project = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const DEFAULT_PROJECT_POLICY = Object.freeze({
    defaultWorkMode: 'ask',
    defaultPermissionProfileId: 'analysis-readonly',
    modelPolicy: 'workspace-default',
  });

  function normalizeToolSelections(value, connectorIds) {
    const source = Shared.cleanObject(value);
    const allowed = new Set(connectorIds);
    return Object.fromEntries(
      Object.entries(source)
        .filter(([connectorId, toolNames]) => allowed.has(connectorId) && Array.isArray(toolNames))
        .map(([connectorId, toolNames]) => [connectorId, Shared.uniqueStrings(toolNames)])
    );
  }

  function normalizeProject(project = {}, options = {}) {
    const now = options.now || Date.now();
    const id = project.id || Shared.createId('project');
    const workspace = typeof project.workspace === 'string' ? project.workspace : '';
    const spec = Shared.cleanObject(project.spec);
    const capabilities = Shared.cleanObject(spec.capabilities);
    const assets = Shared.cleanObject(spec.assets);
    const policies = { ...DEFAULT_PROJECT_POLICY, ...Shared.cleanObject(spec.policies), ...Shared.cleanObject(project.policies) };
    const meteorologicalContext = {
      timezone: 'Asia/Shanghai',
      region: '',
      defaultModels: [],
      defaultForecastHours: [],
      ...Shared.cleanObject(spec.meteorologicalContext),
      ...Shared.cleanObject(project.meteorologicalContext),
    };

    const connectorIds = Shared.uniqueStrings(capabilities.connectors ?? project.connectorIds);
    return {
      ...project,
      apiVersion: project.apiVersion || 'meteomate/v1',
      kind: 'Project',
      id,
      name: project.name || options.fallbackName || '未命名气象项目',
      version: project.version || '1.0.0',
      workspace,
      createdAt: project.createdAt || now,
      updatedAt: project.updatedAt || now,
      spec: {
        instructions: Shared.asArray(spec.instructions ?? project.instructions).filter(Boolean),
        workspaces: Array.isArray(spec.workspaces) && spec.workspaces.length
          ? spec.workspaces
          : workspace
            ? [{ id: 'primary', root: workspace, access: 'read-write-approved' }]
            : [],
        meteorologicalContext,
        capabilities: {
          experts: Shared.uniqueStrings(capabilities.experts ?? project.expertIds),
          skills: Shared.uniqueStrings(capabilities.skills ?? project.skillIds),
          connectors: connectorIds,
          toolSelections: normalizeToolSelections(capabilities.toolSelections ?? project.toolSelections, connectorIds),
        },
        assets: {
          libraries: Shared.uniqueStrings(assets.libraries ?? project.assetLibraryIds),
          knowledgeSources: Shared.uniqueStrings(assets.knowledgeSources ?? project.knowledgeSourceIds),
          templates: Shared.uniqueStrings(assets.templates ?? project.templateIds),
        },
        policies,
        outputs: {
          defaultContract: 'meteorological-analysis',
          ...Shared.cleanObject(spec.outputs),
          ...Shared.cleanObject(project.outputs),
        },
      },
    };
  }

  function projectSnapshot(project) {
    const normalized = normalizeProject(project);
    return {
      id: normalized.id,
      name: normalized.name,
      version: normalized.version,
      workspace: normalized.workspace,
      spec: Shared.deepClone(normalized.spec),
      hash: Shared.contentHash({
        id: normalized.id,
        version: normalized.version,
        workspace: normalized.workspace,
        spec: normalized.spec,
      }),
    };
  }

  return { DEFAULT_PROJECT_POLICY, normalizeProject, projectSnapshot };
});
