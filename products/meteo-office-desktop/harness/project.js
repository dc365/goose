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

  function normalizeMembers(value) {
    const source = Shared.cleanObject(value);
    return Object.fromEntries(
      Object.entries(source)
        .map(([userId, member]) => {
          const role = ['viewer', 'editor', 'owner'].includes(member?.role) ? member.role : 'viewer';
          return [String(userId), { userId: String(member?.userId || userId), role }];
        })
        .filter(([userId]) => userId)
    );
  }

  function normalizeSharing(value = {}) {
    const input = Shared.cleanObject(value);
    return {
      remoteId: String(input.remoteId || input.id || ''),
      revision: Math.max(0, Number(input.revision || 0) || 0),
      ownerId: String(input.ownerId || ''),
      orgId: String(input.orgId || ''),
      visibility: input.visibility === 'organization' ? 'organization' : 'private',
      workspaceURI: String(input.workspaceURI || input.workspaceUri || ''),
      members: normalizeMembers(input.members),
      syncStatus: ['local', 'synced', 'pending', 'conflict', 'error'].includes(input.syncStatus)
        ? input.syncStatus
        : input.remoteId || input.id ? 'synced' : 'local',
      syncedAt: input.syncedAt || null,
      syncError: input.syncError || null,
    };
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
    const sharing = normalizeSharing(project.sharing || spec.sharing);

    const connectorIds = Shared.uniqueStrings(capabilities.connectors ?? project.connectorIds);
    return {
      ...project,
      apiVersion: project.apiVersion || 'meteomate/v1',
      kind: 'Project',
      id,
      name: project.name || options.fallbackName || '未命名气象项目',
      version: project.version || '1.0.0',
      workspace,
      sharing,
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
          workflows: Shared.uniqueStrings(capabilities.workflows ?? project.workflowIds),
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
        sharing,
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
      sharing: Shared.deepClone(normalized.sharing),
      spec: Shared.deepClone(normalized.spec),
      hash: Shared.contentHash({
        id: normalized.id,
        version: normalized.version,
        workspace: normalized.workspace,
        sharing: normalized.sharing,
        spec: normalized.spec,
      }),
    };
  }

  function applyRemoteProject(localProject, remoteProject = {}) {
    const remote = Shared.cleanObject(remoteProject);
    const local = normalizeProject(localProject || {});
    const remoteSpec = Shared.cleanObject(remote.spec);
    const mergedSpec = {
      ...local.spec,
      ...remoteSpec,
      // A shared project carries metadata and capability intent; the absolute local binding stays device-local.
      workspaces: Shared.deepClone(local.spec.workspaces || []),
    };
    return normalizeProject({
      ...local,
      name: remote.name || local.name,
      description: remote.description ?? local.description,
      spec: mergedSpec,
      sharing: {
        remoteId: remote.id,
        revision: remote.revision,
        ownerId: remote.ownerId,
        orgId: remote.orgId,
        visibility: remote.visibility,
        workspaceURI: remote.workspaceURI || remote.workspaceUri,
        members: remote.members,
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
        syncError: null,
      },
      updatedAt: Date.now(),
    });
  }

  return { DEFAULT_PROJECT_POLICY, normalizeProject, projectSnapshot, normalizeSharing, applyRemoteProject };
});
