(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports ? require('./shared') : root.MeteoMateHarness.Shared;
  const api = factory(Shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.PolicyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared) {
  'use strict';

  const WORK_MODES = Object.freeze({ ASK: 'ask', PLAN: 'plan', EXECUTE: 'execute' });
  const DECISIONS = Object.freeze({ ALLOW: 'allow', APPROVAL: 'approval', DENY: 'deny' });

  const DEFAULT_PERMISSION_POLICIES = Object.freeze({
    'analysis-readonly': {
      id: 'analysis-readonly',
      name: '请求批准',
      filesystem: { read: 'workspace', write: 'approval' },
      shell: 'approval',
      network: 'approval',
      publish: 'approval',
    },
    'artifact-approval': {
      id: 'artifact-approval',
      name: '智能审批',
      filesystem: { read: 'workspace', write: 'workspace' },
      shell: 'workspace',
      network: 'connector-only',
      publish: 'approval',
    },
    'workspace-approval': {
      id: 'workspace-approval',
      name: '完全访问',
      filesystem: { read: 'all', write: 'allow' },
      shell: 'allow',
      network: 'allow',
      publish: 'allow',
    },
    'trusted-workspace': {
      id: 'trusted-workspace',
      name: '受信任工作区',
      filesystem: { read: 'workspace', write: 'workspace' },
      shell: 'workspace',
      network: 'approval',
      publish: 'approval',
    },
  });

  const PERMISSION_PROFILE_RANK = Object.freeze({
    'analysis-readonly': 0,
    'trusted-workspace': 0.5,
    'artifact-approval': 1,
    'workspace-approval': 2,
  });

  function restrictivePermissionProfile(requestedId, workflowProfileIds) {
    const normalizedRequested = Object.prototype.hasOwnProperty.call(PERMISSION_PROFILE_RANK, requestedId)
      ? requestedId
      : 'analysis-readonly';
    return Shared.uniqueStrings(workflowProfileIds).reduce((current, candidate) => {
      if (!Object.prototype.hasOwnProperty.call(PERMISSION_PROFILE_RANK, candidate)) {
        return 'analysis-readonly';
      }
      return PERMISSION_PROFILE_RANK[candidate] < PERMISSION_PROFILE_RANK[current]
        ? candidate
        : current;
    }, normalizedRequested);
  }

  function resolvePolicy({ project, expert, task, capabilities = {}, permissionProfiles = {} }) {
    const projectPolicies = project?.spec?.policies || {};
    const workMode = task?.workMode || projectPolicies.defaultWorkMode || expert?.defaultWorkMode || WORK_MODES.ASK;
    const requestedPermissionProfileId =
      task?.permissionProfileId ||
      projectPolicies.defaultPermissionProfileId ||
      expert?.permissionProfile ||
      'analysis-readonly';
    const workflowPermissionProfiles = Shared.uniqueStrings([
      ...Shared.asArray(capabilities.workflowPermissionProfiles),
      ...Shared.asArray(capabilities.workflows).map((workflow) => workflow?.permissionProfile),
    ]);
    const permissionProfileId = restrictivePermissionProfile(
      requestedPermissionProfileId,
      workflowPermissionProfiles
    );
    const profile = {
      ...(DEFAULT_PERMISSION_POLICIES[permissionProfileId] || DEFAULT_PERMISSION_POLICIES['analysis-readonly']),
      ...Shared.cleanObject(permissionProfiles[permissionProfileId]),
      id: permissionProfileId,
    };
    return {
      workMode: Object.values(WORK_MODES).includes(workMode) ? workMode : WORK_MODES.ASK,
      permissionProfileId,
      requestedPermissionProfileId,
      workflowPermissionProfiles,
      permissionProfile: profile,
      modelPolicy: task?.modelPolicy || projectPolicies.modelPolicy || expert?.modelPolicy || 'workspace-default',
    };
  }

  function authorize(operation, policy, context = {}) {
    const profile = policy.permissionProfile || policy;
    const kind = operation.kind || operation.type || 'unknown';
    if (policy.workMode === WORK_MODES.ASK && ['write', 'shell', 'publish'].includes(kind)) {
      return { decision: DECISIONS.DENY, reason: 'Ask 模式禁止执行写入、命令或发布操作。' };
    }
    if (policy.workMode === WORK_MODES.PLAN && ['write', 'shell', 'publish'].includes(kind)) {
      return { decision: DECISIONS.DENY, reason: 'Plan 模式只生成计划，不执行有副作用的操作。' };
    }

    if (kind === 'read') {
      if (profile.filesystem?.read === 'workspace' && context.insideWorkspace === false) {
        return { decision: DECISIONS.DENY, reason: '读取目标不在授权工作区内。' };
      }
      return { decision: DECISIONS.ALLOW, reason: '允许读取授权范围内的资料。' };
    }
    if (kind === 'write') return decisionFromRule(profile.filesystem?.write, context, '文件写入');
    if (kind === 'shell') return decisionFromRule(profile.shell, context, '命令执行');
    if (kind === 'network') return decisionFromRule(profile.network, context, '网络访问');
    if (kind === 'publish') return decisionFromRule(profile.publish, context, '成果发布');
    return { decision: DECISIONS.APPROVAL, reason: '未知操作默认需要审批。' };
  }

  function decisionFromRule(rule, context, label) {
    if (rule === true || rule === 'allow') return { decision: DECISIONS.ALLOW, reason: `${label}已被策略允许。` };
    if (rule === 'workspace' && context.insideWorkspace !== false) return { decision: DECISIONS.ALLOW, reason: `${label}位于受信任工作区。` };
    if (rule === 'connector-only' && context.viaConnector) return { decision: DECISIONS.ALLOW, reason: `${label}由受控工具执行。` };
    if (rule === 'approval') return { decision: DECISIONS.APPROVAL, reason: `${label}需要用户审批。` };
    return { decision: DECISIONS.DENY, reason: `${label}未被当前策略授权。` };
  }

  return {
    WORK_MODES,
    DECISIONS,
    DEFAULT_PERMISSION_POLICIES,
    PERMISSION_PROFILE_RANK,
    restrictivePermissionProfile,
    resolvePolicy,
    authorize,
  };
});
