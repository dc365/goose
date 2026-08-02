(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const Shared = isNode ? require('./shared') : root.MeteoMateHarness.Shared;
  const Project = isNode ? require('./project') : root.MeteoMateHarness.Project;
  const Task = isNode ? require('./task-state-machine') : root.MeteoMateHarness.TaskStateMachine;
  const Artifact = isNode ? require('./artifact-registry') : root.MeteoMateHarness.ArtifactRegistry;
  const Evidence = isNode ? require('./evidence-ledger') : root.MeteoMateHarness.EvidenceLedger;
  const ExpertTeam = isNode ? require('./expert-team') : root.MeteoMateHarness.ExpertTeam;
  const api = factory(Shared, Project, Task, Artifact, Evidence, ExpertTeam);
  if (isNode) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.StateStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  Shared,
  Project,
  Task,
  Artifact,
  Evidence,
  ExpertTeam
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
    teamRuns: 20,
    teamTimeline: 60,
  });

  function tail(value, limit) {
    return (Array.isArray(value) ? value : []).slice(-Math.max(0, Number(limit) || 0));
  }

  function compactTaskForStorage(task = {}, limits = {}) {
    const configured = { ...DEFAULT_STORAGE_LIMITS, ...limits };
    const recentEvidence = tail(task.evidence, configured.evidence);
    const retainedEvidenceIds = new Set(recentEvidence.map((record) => record?.id).filter(Boolean));
    const evidence = (task.evidence || []).filter((record) => retainedEvidenceIds.has(record?.id));
    const { publication: _publication, publicationAnalysis: _publicationAnalysis, ...taskFields } = task;
    const sourceTeamRuns = Array.isArray(task.teamRuns) ? [...task.teamRuns] : [];
    if (task.teamRun && !sourceTeamRuns.some((run) => run?.id === task.teamRun.id)) {
      sourceTeamRuns.push(task.teamRun);
    }
    const teamRuns = tail(sourceTeamRuns, configured.teamRuns).map((run) => ({
      ...run,
      timeline: tail(run?.timeline, configured.teamTimeline),
      members: (Array.isArray(run?.members) ? run.members : []).map((member) => ({
        ...member,
        activities: tail(member?.activities, 6),
        updates: tail(member?.updates, 16),
      })),
    }));
    const teamRun = teamRuns.find((run) => run.id === task.teamRun?.id) || teamRuns.at(-1) || null;
    const compacted = {
      ...taskFields,
      messages: tail(task.messages, configured.messages),
      activities: tail(task.activities, configured.activities),
      artifacts: tail(task.artifacts, configured.artifacts),
      evidence,
      harnessEvents: tail(task.harnessEvents, configured.harnessEvents),
      teamRun,
      teamRuns,
      pendingPermissions: [],
    };
    return compacted;
  }

  function clonePlan(planFactory, completed = false) {
    const source = typeof planFactory === 'function' ? planFactory() : [];
    return (Array.isArray(source) ? source : []).map((item) => ({
      ...item,
      status: completed ? 'completed' : item.status,
    }));
  }

  function interruptTeamRun(run) {
    if (!run || typeof run !== 'object') return null;
    const interrupted = ['running', 'synthesizing'].includes(run.status)
      || ['dispatching', 'executing', 'members', 'synthesizing'].includes(run.phase);
    const interruptedAt = interrupted ? Number(run.interruptedAt || Date.now()) : null;
    const terminalAt = interruptedAt || Number(run.completedAt || run.updatedAt || Date.now());
    const timeline = tail(run.timeline, DEFAULT_STORAGE_LIMITS.teamTimeline);
    if (interrupted && !timeline.some((entry) => entry?.key === `run:${run.id}:interrupted`)) {
      timeline.push({
        id: `team-event-${run.id}-interrupted`,
        key: `run:${run.id}:interrupted`,
        type: 'completion',
        memberId: null,
        actor: 'MeteoMate',
        title: '应用重启后协作已中断',
        detail: '已保留重启前完成的成员结果和协作记录。',
        status: 'interrupted',
        at: interruptedAt,
      });
    }
    const members = (Array.isArray(run.members) ? run.members : []).map((member) => ({
      ...member,
      status: ['pending', 'running'].includes(member.status) ? 'interrupted' : member.status,
      completedAt: ['pending', 'running'].includes(member.status)
        ? member.completedAt || terminalAt
        : member.completedAt,
      activities: tail(member.activities, 6),
      updates: tail(member.updates, 16),
    }));
    const completedCount = members.filter((member) => member.status === 'completed').length;
    const failedCount = members.filter((member) => ['failed', 'interrupted', 'cancelled'].includes(member.status)).length;
    const inconsistentCompletion = run.status === 'completed' && failedCount > 0;
    return {
      ...run,
      status: interrupted ? 'interrupted' : inconsistentCompletion ? (completedCount ? 'partial' : 'failed') : run.status,
      phase: interrupted ? 'interrupted' : inconsistentCompletion ? 'completed' : run.phase,
      completedAt: interrupted ? run.completedAt || interruptedAt : run.completedAt,
      interruptedAt: interrupted ? interruptedAt : run.interruptedAt,
      completedCount,
      failedCount,
      members,
      timeline: tail(timeline, DEFAULT_STORAGE_LIMITS.teamTimeline),
    };
  }

  function storedRuntimeFailureMessage(task, message, failure) {
    const teamRuns = Array.isArray(task?.teamRuns) ? task.teamRuns : [];
    const teamRun = teamRuns.find((run) => run?.id === message?.teamRunId)
      || (task?.teamRun?.id === message?.teamRunId ? task.teamRun : null)
      || task?.teamRun;
    if (!teamRun) return failure.message;
    const completedCount = (Array.isArray(teamRun.members) ? teamRun.members : [])
      .filter((member) => member?.status === 'completed').length;
    return `负责人汇总时遇到工具调用格式错误。已保留 ${completedCount} 位专家的完成结果，请重试本轮汇总。`;
  }

  function normalizeMessage(message, task, planFactory, isLatestAssistant) {
    if (!message || typeof message !== 'object') return null;
    if (message.role !== 'assistant') return { ...message };
    const runtimeOutputFailure = ExpertTeam.runtimeOutputFailure(message.text);
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
      text: runtimeOutputFailure
        ? storedRuntimeFailureMessage(task, message, runtimeOutputFailure)
        : message.text,
      status: completed ? 'completed' : message.status,
      startedAt,
      completedAt,
      durationMs: message.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : null),
      runStatus: runtimeOutputFailure
        ? 'failed'
        : message.runStatus || (task.status === 'failed' && isLatestAssistant ? 'failed' : completed ? 'completed' : 'running'),
      runtimeOutputFailure: runtimeOutputFailure || message.runtimeOutputFailure,
      processPlan: storedPlan.map((item) => ({
        ...item,
        title: item.title || defaultTitles.get(item.id) || item.id,
      })),
      usage: message.usage || (isLatestAssistant ? task.usage || null : null),
      modelId: message.modelId || task.modelId || '',
    };
  }

  function isUnverifiedLegacyArtifact(artifact) {
    return Boolean(
      artifact?.path
      && !artifact.uri
      && !artifact.contentHash
      && !artifact.metadata?.source
      && !artifact.lineage?.toolCallId
      && (!artifact.status || artifact.status === 'draft')
    );
  }

  function artifactFileName(artifact) {
    const target = String(artifact?.uri || artifact?.path || '').split(/[?#]/)[0];
    return target.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() || '';
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
    const sourceArtifacts = Array.isArray(task?.artifacts) ? task.artifacts : [];
    const verifiedArtifactNames = new Set(
      sourceArtifacts
        .filter((artifact) => !isUnverifiedLegacyArtifact(artifact))
        .map(artifactFileName)
        .filter(Boolean)
    );
    const legacyArtifactPaths = new Map(
      sourceArtifacts
        .filter((artifact) => isUnverifiedLegacyArtifact(artifact) && !/\.html$/i.test(String(artifact.path)))
        .map((artifact) => [artifactFileName(artifact), artifact.path])
        .filter(([name]) => Boolean(name))
    );
    const artifacts = sourceArtifacts
      .filter((artifact) =>
        !isUnverifiedLegacyArtifact(artifact)
        || (
          !/\.html$/i.test(String(artifact.path))
          && !verifiedArtifactNames.has(artifactFileName(artifact))
        )
      )
      .map((artifact) => {
        let normalizedArtifact = artifact;
        const legacyPath = legacyArtifactPaths.get(artifactFileName(artifact));
        const target = String(artifact?.uri || '');
        if (
          legacyPath
          && target
          && !/^(?:https?:|file:|[A-Za-z]:[\\/]|\/)/i.test(target)
        ) {
          normalizedArtifact = {
            ...artifact,
            path: legacyPath,
            uri: legacyPath,
            metadata: {
              ...(artifact.metadata || {}),
              source: 'legacy-artifact-reconciliation',
              originalUri: target,
            },
          };
        }
        try {
          const lineage = normalizedArtifact?.lineage && typeof normalizedArtifact.lineage === 'object'
            ? normalizedArtifact.lineage
            : {};
          return Artifact.createArtifact(normalizedArtifact, {
            taskId: lineage.taskId || task.id,
            runId: lineage.runId || null,
            contextSnapshotId: Object.hasOwn(lineage, 'contextSnapshotId')
              ? lineage.contextSnapshotId
              : task.contextSnapshotId,
            expertId: lineage.expertId || null,
            templateId: lineage.templateId || null,
            evidenceIds: lineage.evidenceIds || [],
            toolCallId: lineage.toolCallId || null,
          });
        } catch {
          return { ...normalizedArtifact };
        }
      });
    const retainedArtifactIds = new Set(artifacts.map((artifact) => artifact.id).filter(Boolean));
    const messagesWithArtifacts = normalizedMessages.map((message) =>
      Array.isArray(message.artifactIds)
        ? {
            ...message,
            artifactIds: message.artifactIds.filter((id) => retainedArtifactIds.has(id)),
          }
        : message
    );
    const evidence = (Array.isArray(task?.evidence) ? task.evidence : []).map((record) => {
      try {
        const lineage = record?.lineage && typeof record.lineage === 'object'
          ? record.lineage
          : {};
        return Evidence.createEvidence(record, {
          taskId: lineage.taskId || task.id,
          runId: lineage.runId || null,
          contextSnapshotId: Object.hasOwn(lineage, 'contextSnapshotId')
            ? lineage.contextSnapshotId
            : task.contextSnapshotId,
          toolCallId: lineage.toolCallId || null,
        });
      } catch {
        return { ...record };
      }
    });
    const sourceTeamRuns = Array.isArray(task?.teamRuns) ? task.teamRuns : [];
    const teamRuns = sourceTeamRuns.map(interruptTeamRun).filter(Boolean);
    const legacyTeamRun = interruptTeamRun(task?.teamRun);
    if (legacyTeamRun && !teamRuns.some((run) => run.id === legacyTeamRun.id)) {
      teamRuns.push(legacyTeamRun);
    }
    const teamRun = teamRuns.find((run) => run.id === task?.teamRun?.id) || teamRuns.at(-1) || null;
    const latestAssistant = messagesWithArtifacts.find((message) => message.id === latestAssistantId);
    const runtimeOutputFailed = Boolean(latestAssistant?.runtimeOutputFailure);

    return Task.normalizeTask({
      ...task,
      status: runtimeOutputFailed
        ? 'failed'
        : task?.status === 'running' ? 'interrupted' : task?.status || 'draft',
      messages: messagesWithArtifacts,
      activities,
      artifacts,
      artifactIds: [...retainedArtifactIds],
      evidence,
      teamRun,
      teamRuns,
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
