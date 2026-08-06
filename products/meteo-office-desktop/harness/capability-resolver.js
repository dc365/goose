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

  function workflowReference(value) {
    const [id = '', ...versionParts] = String(value || '').trim().split('@');
    return { id, version: versionParts.join('@') };
  }

  function workflowId(workflow) {
    return String(workflow?.metadata?.id || workflow?.id || '').trim();
  }

  function workflowVersion(workflow) {
    return String(workflow?.metadata?.version || workflow?.version || '').trim();
  }

  function findWorkflow(workflows, reference) {
    const requested = workflowReference(reference);
    const matches = Shared.asArray(workflows)
      .filter((workflow) => workflowId(workflow) === requested.id)
      .filter((workflow) => !requested.version || workflowVersion(workflow) === requested.version)
      .filter((workflow) => !workflow?.metadata?.status || workflow.metadata.status === 'published')
      .sort((left, right) => Number(right.publishedAt || right.updatedAt || 0) - Number(left.publishedAt || left.updatedAt || 0));
    return matches[0] || null;
  }

  function capabilityMode(task = {}) {
    if (task.capabilityMode === 'custom') return 'custom';
    if (task.capabilityMode === 'inherit') return 'inherit';
    const hasLegacySelection = Shared.asArray(task.connectorIds).length > 0
      || Object.keys(task.toolSelections || {}).length > 0;
    return hasLegacySelection ? 'custom' : 'inherit';
  }

  function activeArtifactSelections(task = {}) {
    const direct = Shared.asArray(task.artifactSelections);
    if (direct.length) return direct;
    return Shared.asArray(task.messages)
      .slice()
      .reverse()
      .find((message) => message?.role === 'user' && Shared.asArray(message.artifactSelections).length)
      ?.artifactSelections || [];
  }

  function requiresDocxSelectionEditing(task = {}) {
    return activeArtifactSelections(task).some((selection) =>
      selection?.editability === 'editable'
      && String(selection.format || '').toUpperCase() === 'DOCX'
    );
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
      workflow: '工作流',
      expert: '专家',
      connector: '工具服务',
      tool: '具体工具',
      'tool-catalog': '工具清单',
    };
    const reasons = {
      'not-connected': '未连接',
      'not-selected': '未授权',
      'not-found': '不存在',
      'not-tested': '尚未完成连接测试',
      recursive: '存在递归依赖',
      unpinned: '未固定发布版本',
      'version-mismatch': '版本不匹配',
      'expert-node-unsupported': '含不受支持的专家节点',
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
    const selectionEditingRequired = requiresDocxSelectionEditing(task);
    const promptConnectorIds = taskHasConnectorSelection
      ? []
      : explicitConnectorIds(prompt, catalog.connectors);
    const requestedSkills = Shared.uniqueStrings([
      ...(projectCaps.skills || []),
      ...(expert?.requiredSkills || []),
      ...(taskHasConnectorSelection ? [] : expert?.recommendedSkills || expert?.skills || []),
      ...(task?.skillIds || []),
    ]);
    const taskWorkflowReference = task?.workflowId
      ? `${task.workflowId}${task.workflowVersion ? `@${task.workflowVersion}` : ''}`
      : '';
    const requestedWorkflows = Shared.uniqueStrings([
      ...(projectCaps.workflows || []),
      ...(expert?.requiredWorkflows || []),
      ...(taskHasConnectorSelection ? [] : expert?.recommendedWorkflows || []),
      ...(task?.workflowIds || []),
      taskWorkflowReference,
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
      ...(selectionEditingRequired ? ['office-artifacts'] : []),
    ]);
    const selectedTools = taskHasConnectorSelection
      ? Shared.deepClone(task?.toolSelections && typeof task.toolSelections === 'object' ? task.toolSelections : {})
      : {
          ...Shared.deepClone(expert?.toolSelections && typeof expert.toolSelections === 'object' ? expert.toolSelections : {}),
          ...Shared.deepClone(projectCaps.toolSelections && typeof projectCaps.toolSelections === 'object'
            ? projectCaps.toolSelections
            : {}),
        };
    if (selectionEditingRequired) {
      selectedTools['office-artifacts'] = Shared.uniqueStrings([
        ...Shared.asArray(selectedTools['office-artifacts']),
        'docx_edit_selection',
      ]);
    }
    const skillIndex = indexById(catalog.skills);
    const connectorIndex = indexById(catalog.connectors);
    const expertIndex = indexById([
      ...Shared.asArray(catalog.experts),
      ...Shared.asArray(catalog.teams),
      ...Shared.asArray(catalog.customExperts),
    ]);
    const skills = [];
    const workflows = [];
    const connectors = [];
    const missing = [];
    const skillRequiredConnectors = new Set();
    const requiredSkills = new Set([
      ...Shared.asArray(expert?.requiredSkills),
      ...Shared.asArray(projectCaps.skills),
      ...Shared.asArray(task?.skillIds),
    ].map(versionlessId));
    const requiredWorkflows = new Set([
      ...Shared.asArray(expert?.requiredWorkflows),
      ...Shared.asArray(projectCaps.workflows),
      ...Shared.asArray(task?.workflowIds),
      taskWorkflowReference,
    ].filter(Boolean));
    const workflowRequiredConnectors = new Set();
    const workflowToolRequirements = new Map();
    if (selectionEditingRequired) {
      workflowRequiredConnectors.add('office-artifacts');
      workflowToolRequirements.set('office-artifacts', new Set(['docx_edit_selection']));
    }
    const workflowPermissionProfiles = new Set();
    const resolvedWorkflowKeys = new Set();
    const resolvingWorkflowKeys = new Set();
    const resolvedExpertIds = new Set();
    const resolvingExpertIds = new Set();

    function addMissing(issue) {
      const key = `${issue.type}:${issue.id}:${issue.reason || ''}:${Boolean(issue.required)}`;
      if (!missing.some((item) =>
        `${item.type}:${item.id}:${item.reason || ''}:${Boolean(item.required)}` === key
      )) missing.push(issue);
    }

    function addRequested(list, reference) {
      const normalized = String(reference || '').trim();
      if (normalized && !list.includes(normalized)) list.push(normalized);
    }

    function addToolRequirement(connectorId, toolName) {
      if (!connectorId || !toolName) return;
      const id = versionlessId(connectorId);
      workflowRequiredConnectors.add(id);
      const tools = workflowToolRequirements.get(id) || new Set();
      tools.add(toolName);
      workflowToolRequirements.set(id, tools);
      if (!taskHasConnectorSelection) {
        selectedTools[id] = Shared.uniqueStrings([
          ...Shared.asArray(selectedTools[id]),
          toolName,
        ]);
      }
    }

    function includeExpertDependencies(expertId, requestedVersion = '') {
      const dependencyExpert = expertIndex.get(expertId);
      if (!dependencyExpert) {
        addMissing({ type: 'expert', id: expertId, required: true, reason: 'not-found' });
        return;
      }
      if (requestedVersion && dependencyExpert.version && String(dependencyExpert.version) !== requestedVersion) {
        addMissing({
          type: 'expert',
          id: `${expertId}@${requestedVersion}`,
          required: true,
          reason: 'version-mismatch',
        });
      }
      if (resolvingExpertIds.has(expertId)) {
        addMissing({ type: 'expert', id: expertId, required: true, reason: 'recursive' });
        return;
      }
      if (resolvedExpertIds.has(expertId)) return;
      resolvingExpertIds.add(expertId);
      for (const reference of Shared.asArray(dependencyExpert.requiredSkills)) {
        requiredSkills.add(versionlessId(reference));
        addRequested(requestedSkills, reference);
      }
      if (!taskHasConnectorSelection) {
        for (const reference of Shared.asArray(dependencyExpert.recommendedSkills || dependencyExpert.skills)) {
          addRequested(requestedSkills, reference);
        }
      }
      for (const reference of Shared.asArray(dependencyExpert.requiredConnectors)) {
        workflowRequiredConnectors.add(versionlessId(reference));
        if (!taskHasConnectorSelection) addRequested(requestedConnectors, reference);
      }
      for (const reference of Shared.asArray(dependencyExpert.recommendedConnectors)) {
        if (!taskHasConnectorSelection) addRequested(requestedConnectors, reference);
      }
      for (const [connectorId, toolNames] of Object.entries(dependencyExpert.toolSelections || {})) {
        for (const toolName of Shared.asArray(toolNames)) addToolRequirement(connectorId, toolName);
      }
      for (const reference of Shared.asArray(dependencyExpert.requiredWorkflows)) {
        requiredWorkflows.add(reference);
        includeWorkflow(reference, true, true);
      }
      if (!taskHasConnectorSelection) {
        for (const reference of Shared.asArray(dependencyExpert.recommendedWorkflows)) {
          includeWorkflow(reference, false, true);
        }
      }
      for (const snapshot of Shared.asArray(dependencyExpert.memberSnapshots)) {
        if (snapshot?.id && !expertIndex.has(snapshot.id)) expertIndex.set(snapshot.id, snapshot);
      }
      const memberIds = Shared.uniqueStrings([
        ...Shared.asArray(dependencyExpert.memberSnapshots).map((snapshot) => snapshot?.id),
        ...Shared.asArray(dependencyExpert.nodes).map((node) =>
          typeof node?.expert === 'string' ? node.expert : node?.expert?.id
        ),
      ]);
      for (const memberId of memberIds) includeExpertDependencies(memberId);
      resolvingExpertIds.delete(expertId);
      resolvedExpertIds.add(expertId);
    }

    function includeWorkflow(reference, required, asDependency = false) {
      const workflow = findWorkflow(catalog.workflows, reference);
      if (!workflow) {
        if (required) addMissing({ type: 'workflow', id: reference, required: true, reason: 'not-found' });
        return;
      }
      const key = `${workflowId(workflow)}@${workflowVersion(workflow)}`;
      if (resolvingWorkflowKeys.has(key)) {
        addMissing({ type: 'workflow', id: key, required: true, reason: 'recursive' });
        return;
      }
      if (resolvedWorkflowKeys.has(key)) {
        if (!asDependency) {
          const resolved = workflows.find((item) => `${item.id}@${item.version}` === key);
          if (resolved) resolved.role = 'selected';
        }
        return;
      }
      resolvingWorkflowKeys.add(key);

      const permissionProfile = workflow.spec?.policy?.permissionProfile || null;
      if (permissionProfile) workflowPermissionProfiles.add(permissionProfile);
      for (const node of Shared.asArray(workflow.spec?.nodes)) {
        for (const skill of Shared.asArray(node.skills)) {
          const skillReference = typeof skill === 'string'
            ? skill
            : `${skill?.id || ''}${skill?.version ? `@${skill.version}` : ''}`;
          if (!skillReference) continue;
          requiredSkills.add(versionlessId(skillReference));
          addRequested(requestedSkills, skillReference);
        }
        if (node.type === 'tool' || node.capability?.kind === 'Tool') {
          const connectorId = String(node.capability?.connectorId || '').trim();
          const toolName = String(node.capability?.toolName || '').trim();
          if (connectorId) {
            workflowRequiredConnectors.add(versionlessId(connectorId));
            if (!taskHasConnectorSelection) addRequested(requestedConnectors, connectorId);
          }
          addToolRequirement(connectorId, toolName);
        }
        if (node.type === 'expert' || node.capability?.kind === 'Expert') {
          addMissing({
            type: 'workflow',
            id: `${key}:${node.id || 'expert-node'}`,
            required: true,
            reason: 'expert-node-unsupported',
          });
        }
        if (node.type === 'workflow' || node.capability?.kind === 'Workflow') {
          const childId = String(node.capability?.id || '').trim();
          const childVersion = String(node.capability?.version || '').trim();
          if (childId && !childVersion) {
            addMissing({ type: 'workflow', id: childId, required: true, reason: 'unpinned' });
          } else if (childId) {
            includeWorkflow(`${childId}@${childVersion}`, true, true);
          }
        }
      }

      workflows.push({
        id: workflowId(workflow),
        name: workflow.metadata?.name || workflow.name || workflowId(workflow),
        version: workflowVersion(workflow),
        digest: workflow.digest || null,
        status: workflow.metadata?.status || workflow.status || 'published',
        permissionProfile,
        role: asDependency ? 'dependency' : 'selected',
      });
      resolvingWorkflowKeys.delete(key);
      resolvedWorkflowKeys.add(key);
    }

    if (taskHasConnectorSelection) {
      for (const connectorId of Shared.asArray(expert?.requiredConnectors)) {
        if (!requestedConnectors.includes(connectorId)) {
          addMissing({ type: 'connector', id: connectorId, required: true, reason: 'not-selected' });
        }
      }
    }

    for (const requested of requestedWorkflows) {
      includeWorkflow(requested, requiredWorkflows.has(requested), false);
    }

    for (const requested of requestedSkills) {
      const id = versionlessId(requested);
      const skill = skillIndex.get(id);
      if (!skill) {
        addMissing({ type: 'skill', id: requested, required: requiredSkills.has(id), reason: 'not-found' });
        continue;
      }
      const requestedVersion = requested.includes('@') ? requested.split('@').slice(1).join('@') : null;
      if (requestedVersion && skill.version && String(skill.version) !== requestedVersion) {
        addMissing({
          type: 'skill',
          id: requested,
          required: requiredSkills.has(id),
          reason: 'version-mismatch',
        });
      }
      skills.push({ ...skill, requestedVersion });
      for (const connectorId of Shared.asArray(skill.requires?.connectors || skill.requiredConnectors)) {
        skillRequiredConnectors.add(versionlessId(connectorId));
        if (requestedConnectors.some((reference) =>
          versionlessId(reference) === versionlessId(connectorId)
        )) continue;
        if (taskHasConnectorSelection) {
          addMissing({ type: 'connector', id: connectorId, required: true, reason: 'not-selected' });
        } else {
          requestedConnectors.push(connectorId);
        }
      }
    }

    if (taskHasConnectorSelection) {
      for (const connectorId of workflowRequiredConnectors) {
        if (!requestedConnectors.some((reference) => versionlessId(reference) === connectorId)) {
          addMissing({ type: 'connector', id: connectorId, required: true, reason: 'not-selected' });
        }
      }
      for (const [connectorId, toolNames] of workflowToolRequirements) {
        if (!Object.prototype.hasOwnProperty.call(selectedTools, connectorId)) continue;
        for (const toolName of toolNames) {
          if (!Shared.asArray(selectedTools[connectorId]).includes(toolName)) {
            addMissing({
              type: 'tool',
              id: `${connectorId}.${toolName}`,
              required: true,
              reason: 'not-selected',
            });
          }
        }
      }
    }

    for (const requested of requestedConnectors) {
      const id = versionlessId(requested);
      const connector = connectorIndex.get(id);
      const required = taskHasConnectorSelection
        || Shared.asArray(projectCaps.connectors).some((item) => versionlessId(item) === id)
        || Shared.asArray(expert?.requiredConnectors).some((item) => versionlessId(item) === id)
        || skillRequiredConnectors.has(id)
        || workflowRequiredConnectors.has(id);
      if (!connector) {
        if (required) addMissing({ type: 'connector', id: requested, required: true, reason: 'not-found' });
        continue;
      }
      const requestedVersion = requested.includes('@') ? requested.split('@').slice(1).join('@') : null;
      if (requestedVersion && connector.version && String(connector.version) !== requestedVersion) {
        addMissing({
          type: 'connector',
          id: requested,
          required,
          reason: 'version-mismatch',
        });
      }
      const available = !connector.status
        || connector.status === 'connected'
        || connector.id === 'local-workspace';
      if (!available) {
        if (required) addMissing({ type: 'connector', id: requested, required: true, reason: 'not-connected' });
        continue;
      }
      const availableTools = new Set(Shared.asArray(connector.tools).map((tool) => tool?.name).filter(Boolean));
      const requiredTools = workflowToolRequirements.get(id) || new Set();
      if (requiredTools.size && !availableTools.size && connector.toolCount === null) {
        addMissing({ type: 'tool-catalog', id, required: true, reason: 'not-tested' });
      } else if (requiredTools.size && (availableTools.size || connector.toolCount === 0)) {
        for (const toolName of requiredTools) {
          if (!availableTools.has(toolName)) {
            addMissing({
              type: 'tool',
              id: `${id}.${toolName}`,
              required: true,
              reason: 'not-found',
            });
          }
        }
      }
      connectors.push({ ...connector, requestedVersion });
    }

    const resolved = {
      expertId: expert?.id || null,
      grantMode,
      skills,
      workflows,
      workflowPermissionProfiles: [...workflowPermissionProfiles],
      connectors,
      connectorSources: Object.fromEntries(
        connectors.map((connector) => [
          connector.id,
          selectionEditingRequired && connector.id === 'office-artifacts'
            ? 'artifact-selection'
            : taskHasConnectorSelection
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
      workflows: workflows.map((item) => [
        item.id,
        item.version || null,
        item.digest || null,
        item.role || 'selected',
      ]),
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
