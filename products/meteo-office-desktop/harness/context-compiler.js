(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Shared = isNode ? require('./shared') : root.MeteoMateHarness.Shared;
  const Project = isNode ? require('./project') : root.MeteoMateHarness.Project;
  const Resolver = isNode ? require('./capability-resolver') : root.MeteoMateHarness.CapabilityResolver;
  const Policy = isNode ? require('./policy-engine') : root.MeteoMateHarness.PolicyEngine;
  const api = factory(Shared, Project, Resolver, Policy);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ContextCompiler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared, Project, Resolver, Policy) {
  'use strict';

  function latestUserPrompt(task, explicitPrompt) {
    if (explicitPrompt) return explicitPrompt;
    const messages = Array.isArray(task?.messages) ? task.messages : [];
    return [...messages].reverse().find((message) => message.role === 'user' && message.text)?.text || '';
  }

  function compileTaskContext({ task = {}, project = {}, expert = {}, catalog = {}, prompt = '', clock = Date }) {
    const normalizedProject = Project.normalizeProject(project);
    const capabilities = Resolver.resolveCapabilities({ project: normalizedProject, expert, task, catalog });
    const policy = Policy.resolvePolicy({
      project: normalizedProject,
      expert,
      task,
      permissionProfiles: catalog.permissionProfiles || {},
    });
    const body = {
      apiVersion: 'meteomate/v1',
      kind: 'TaskContextSnapshot',
      schemaVersion: Shared.SCHEMA_VERSION,
      compiledAt: Shared.nowIso(clock),
      task: {
        id: task.id || null,
        kind: task.kind || 'task',
        title: task.title || '',
        prompt: latestUserPrompt(task, prompt),
        workMode: policy.workMode,
        expectedOutputs: Shared.deepClone(task.expectedOutputs || []),
      },
      project: Project.projectSnapshot(normalizedProject),
      expert: {
        id: expert.id || null,
        name: expert.name || '',
        version: expert.version || '1.0.0',
        instruction: expert.instruction || '',
        methodology: Shared.deepClone(expert.methodology || []),
        limitations: Shared.deepClone(expert.limitations || []),
        inputSchema: expert.inputSchema || null,
        outputSchema: expert.outputSchema || null,
      },
      capabilities: Shared.deepClone(capabilities),
      meteorologicalContext: Shared.deepClone(normalizedProject.spec.meteorologicalContext),
      assets: Shared.deepClone(normalizedProject.spec.assets),
      modelPolicy: {
        id: policy.modelPolicy,
        providerId: task.providerId || '',
        modelId: task.modelId || '',
      },
      permissionPolicy: {
        id: policy.permissionProfileId,
        workMode: policy.workMode,
        profile: Shared.deepClone(policy.permissionProfile),
      },
      workspaceGrant: {
        root: task.workspace || normalizedProject.workspace || '',
        access: normalizedProject.spec.workspaces[0]?.access || 'read-only',
      },
      outputContract: Shared.deepClone(normalizedProject.spec.outputs),
      memoryPolicy: {
        weatherFactsTtlHours: 168,
        preserveUserPreferences: true,
        preserveProjectDecisions: true,
      },
    };
    const hash = Shared.contentHash(body);
    const snapshot = { ...body, id: `ctx-${hash}`, hash };
    return Shared.deepFreeze(snapshot);
  }

  function runtimeEnvelope(snapshot) {
    return {
      contextSnapshotId: snapshot.id,
      contextSnapshotHash: snapshot.hash,
      workMode: snapshot.task.workMode,
      permissionPolicyId: snapshot.permissionPolicy.id,
      capabilities: {
        skillIds: snapshot.capabilities.skills.map((item) => item.id),
        connectorIds: snapshot.capabilities.connectors.map((item) => item.id),
      },
      meteorologicalContext: snapshot.meteorologicalContext,
      expectedOutputs: snapshot.task.expectedOutputs,
    };
  }

  return { compileTaskContext, runtimeEnvelope };
});
