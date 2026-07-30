(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Shared = isNode ? require('./shared') : root.MeteoMateHarness.Shared;
  const Project = isNode ? require('./project') : root.MeteoMateHarness.Project;
  const Task = isNode ? require('./task-state-machine') : root.MeteoMateHarness.TaskStateMachine;
  const Artifact = isNode ? require('./artifact-registry') : root.MeteoMateHarness.ArtifactRegistry;
  const Evidence = isNode ? require('./evidence-ledger') : root.MeteoMateHarness.EvidenceLedger;
  const PublicationState = isNode ? require('./publication-state') : root.MeteoMateHarness.PublicationState;
  const api = factory(Shared, Project, Task, Artifact, Evidence, PublicationState);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.StateStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  Shared,
  Project,
  Task,
  Artifact,
  Evidence,
  PublicationState
) {
  'use strict';

  const STORAGE_KEY = 'meteomate-desktop-state-v2';
  const LEGACY_STORAGE_KEY = 'meteo-office-desktop-state-v1';
  const BACKUP_KEY = 'meteomate-desktop-state-bootstrap-backup-v1';
  const DEFAULT_STORAGE_LIMITS = Object.freeze({
    messages: 120,
    activities: 80,
    artifacts: 40,
    evidence: 200,
    harnessEvents: 200,
  });

  function tail(value, limit) {
    return (Array.isArray(value) ? value : []).slice(-Math.max(0, Number(limit) || 0));
  }

  function compactTaskForStorage(task = {}, limits = {}) {
    const configured = { ...DEFAULT_STORAGE_LIMITS, ...limits };
    const signed = task.publication?.signoff?.approved === true;
    const referencedEvidenceIds = PublicationState.referencedEvidenceIds(
      PublicationState.analysisForTask(task)
    );
    const recentEvidence = tail(task.evidence, configured.evidence);
    const retainedEvidenceIds = new Set(recentEvidence.map((record) => record?.id).filter(Boolean));
    const evidence = (task.evidence || []).filter((record) =>
      retainedEvidenceIds.has(record?.id) || referencedEvidenceIds.has(String(record?.id || ''))
    );
    const compacted = {
      ...task,
      messages: tail(task.messages, configured.messages),
      activities: tail(task.activities, configured.activities),
      artifacts: signed ? [...(task.artifacts || [])] : tail(task.artifacts, configured.artifacts),
      evidence,
      harnessEvents: tail(task.harnessEvents, configured.harnessEvents),
      pendingPermissions: [],
    };
    if (
      task.id
      && task.publication
      && !PublicationState.requestMatchesTask(task, PublicationState.requestForTask(compacted))
    ) {
      compacted.publication = {
        ...task.publication,
        signoff: null,
        gate: null,
        checkedAt: null,
        error: null,
        dirty: true,
      };
    }
    return compacted;
  }

  function clonePlan(planFactory, completed = false) {
    const source = typeof planFactory === 'function' ? planFactory() : [];
    return (Array.isArray(source) ? source : []).map((item) => ({
      ...item,
      status: completed ? 'completed' : item.status,
    }));
  }

  function normalizeMessage(message, task, planFactory, isLatestAssistant) {
    if (!message || typeof message !== 'object') return null;
    if (message.role !== 'assistant') return { ...message };
    const startedAt = message.startedAt || message.createdAt || task.createdAt || Date.now();
    const completed = message.status !== 'streaming' || task.status !== 'running';
    const completedAt =
      message.completedAt ||
      (isLatestAssistant && completed && Number(task.updatedAt) >= Number(startedAt) ? task.updatedAt : null);
    const fallbackPlan = clonePlan(planFactory, completed);
    const storedPlan = Array.isArray(message.processPlan) && message.processPlan.length
      ? message.processPlan
      : fallbackPlan;
    const defaultTitles = new Map(fallbackPlan.map((item) => [item.id, item.title]));
    return {
      ...message,
      status: completed ? 'completed' : message.status,
      startedAt,
      completedAt,
      durationMs: message.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : null),
      runStatus: message.runStatus || (task.status === 'failed' && isLatestAssistant ? 'failed' : completed ? 'completed' : 'running'),
      processPlan: storedPlan.map((item) => ({
        ...item,
        title: item.title || defaultTitles.get(item.id) || item.id,
      })),
      usage: message.usage || (isLatestAssistant ? task.usage || null : null),
      modelId: message.modelId || task.modelId || '',
    };
  }

  function normalizeStoredTask(task, env = {}) {
    const planFactory = env.createDefaultPlan;
    const sourceMessages = Array.isArray(task?.messages) ? task.messages : [];
    const messages = sourceMessages.filter((message, index) => {
      if (task?.status === 'running' || message?.role !== 'assistant') return true;
      if (message.status !== 'streaming' || String(message.text || '').trim()) return true;
      const previousMessage = sourceMessages.slice(0, index).reverse().find((candidate) =>
        ['user', 'assistant'].includes(candidate?.role)
      );
      return previousMessage?.role !== 'assistant';
    });
    const latestAssistantId = [...messages].reverse().find((message) => message?.role === 'assistant')?.id || null;
    const normalizedMessages = messages
      .map((message) => normalizeMessage(message, task, planFactory, message?.id === latestAssistantId))
      .filter(Boolean);
    const responseTiming = new Map(
      normalizedMessages
        .filter((message) => message.role === 'assistant')
        .map((message) => [
          message.id,
          {
            startedAt: message.startedAt || 0,
            completedAt: message.completedAt || Number.POSITIVE_INFINITY,
            runStatus: message.runStatus,
          },
        ])
    );
    const soleAssistantId = responseTiming.size === 1 ? [...responseTiming.keys()][0] : null;
    const activities = (Array.isArray(task?.activities) ? task.activities : []).map((activity) => {
      const responseId = activity.responseId || soleAssistantId || null;
      const timing = responseTiming.get(responseId);
      const createdAt = activity.createdAt || 0;
      const belongs = !timing || (createdAt >= timing.startedAt && createdAt <= timing.completedAt + 1000);
      return {
        ...activity,
        responseId: belongs ? responseId : null,
        status:
          belongs && timing?.runStatus === 'completed' && ['running', 'waiting', 'pending', 'in_progress'].includes(activity.status)
            ? 'completed'
            : activity.status,
      };
    });
    const artifacts = (Array.isArray(task?.artifacts) ? task.artifacts : []).map((artifact) => {
      try {
        return Artifact.createArtifact(artifact, { taskId: task.id, contextSnapshotId: task.contextSnapshotId });
      } catch {
        return { ...artifact };
      }
    });
    const evidence = (Array.isArray(task?.evidence) ? task.evidence : []).map((record) => {
      try {
        return Evidence.createEvidence(record, { taskId: task.id, contextSnapshotId: task.contextSnapshotId });
      } catch {
        return { ...record };
      }
    });
    const teamRun = task?.teamRun && typeof task.teamRun === 'object'
      ? {
          ...task.teamRun,
          status: ['running', 'synthesizing'].includes(task.teamRun.status)
            ? 'interrupted'
            : task.teamRun.status,
          phase: ['dispatching', 'executing', 'members', 'synthesizing'].includes(task.teamRun.phase)
            ? 'interrupted'
            : task.teamRun.phase,
          members: (Array.isArray(task.teamRun.members) ? task.teamRun.members : []).map((member) => ({
            ...member,
            status: ['pending', 'running'].includes(member.status) ? 'interrupted' : member.status,
          })),
        }
      : null;

    return Task.normalizeTask({
      ...task,
      status: task?.status === 'running' ? 'interrupted' : task?.status || 'draft',
      messages: normalizedMessages,
      activities,
      artifacts,
      evidence,
      teamRun,
      plan: Array.isArray(task?.plan) && task.plan.length ? task.plan : clonePlan(planFactory),
      pendingPermissions: [],
    });
  }

  function normalizeProjects(projects, env = {}) {
    return (Array.isArray(projects) ? projects : []).map((project, index) =>
      Project.normalizeProject(project, { fallbackName: `气象项目 ${index + 1}` })
    );
  }

  function defaultProjectFromLegacy(legacy, env = {}) {
    const workspace = typeof legacy?.workspace === 'string' ? legacy.workspace : '';
    if (!workspace) return [];
    return [
      Project.normalizeProject({
        id: env.createId ? env.createId() : Shared.createId('project'),
        name: env.pathBaseName ? env.pathBaseName(workspace) || '气象办公空间' : '气象办公空间',
        workspace,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ];
  }

  function migrateLegacyState(legacy, env = {}) {
    if (!legacy || typeof legacy !== 'object') return null;
    const initialState = Shared.deepClone(env.initialState || {});
    const projects = defaultProjectFromLegacy(legacy, env);
    const projectId = projects[0]?.id || null;
    const defaultExpert = env.catalog?.experts?.[0] || { id: 'unknown-expert', name: '历史专家' };
    const tasks = (Array.isArray(legacy.tasks) ? legacy.tasks : []).map((task) => {
      const migrated = {
        id: task.id || (env.createId ? env.createId() : Shared.createId('task')),
        kind: 'task',
        title: task.title || '历史任务',
        expertId: task.expertId || defaultExpert.id,
        expertName: task.expertName || defaultExpert.name,
        projectId,
        workspace: task.workspace || projects[0]?.workspace || '',
        status: task.status === 'running' ? 'interrupted' : task.status || 'completed',
        runtimeMode: task.mode || 'headless',
        runtimePreference: 'auto',
        sessionId: null,
        permissionProfileId: task.allowFileTools ? 'workspace-approval' : 'analysis-readonly',
        allowFileTools: true,
        workMode: 'execute',
        messages: [
          ...(task.prompt
            ? [{ id: Shared.createId('message'), role: 'user', text: task.prompt, createdAt: task.createdAt || Date.now() }]
            : []),
          ...(task.output
            ? [{ id: Shared.createId('message'), role: 'assistant', text: task.output, createdAt: task.updatedAt || Date.now() }]
            : []),
        ],
        activities: [],
        artifacts: [],
        evidence: [],
        plan: clonePlan(env.createDefaultPlan),
        pendingPermissions: [],
        createdAt: task.createdAt || Date.now(),
        updatedAt: task.updatedAt || Date.now(),
      };
      return normalizeStoredTask(migrated, env);
    });
    return {
      ...initialState,
      projects,
      activeProjectId: projectId,
      tasks,
      favoriteExpertIds: [],
      customExperts: [],
    };
  }

  function normalizeStoredState(stored, env = {}) {
    const initialState = Shared.deepClone(env.initialState || {});
    if (!stored || typeof stored !== 'object') return initialState;
    const projects = normalizeProjects(stored.projects, env);
    const tasks = (Array.isArray(stored.tasks) ? stored.tasks : []).map((task) => normalizeStoredTask(task, env));
    const assistantTask = tasks.find((task) => task.id === stored.assistantTaskId && task.kind === 'assistant') || tasks.find((task) => task.kind === 'assistant');
    return {
      ...initialState,
      ...stored,
      runtime: Shared.deepClone(initialState.runtime || {}),
      activeTaskId: null,
      projects,
      tasks,
      assistantTaskId: assistantTask?.id || null,
      favoriteExpertIds: Shared.uniqueStrings(stored.favoriteExpertIds),
      customExperts: Array.isArray(stored.customExperts) ? stored.customExperts : [],
    };
  }

  function restoreState({ current, legacy, ...env }) {
    if (current && typeof current === 'object') return normalizeStoredState(current, env);
    const migrated = migrateLegacyState(legacy, env);
    return migrated || Shared.deepClone(env.initialState || {});
  }

  return {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    BACKUP_KEY,
    DEFAULT_STORAGE_LIMITS,
    compactTaskForStorage,
    normalizeStoredTask,
    normalizeStoredState,
    migrateLegacyState,
    restoreState,
  };
});
