'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BrowserConnector = require('./browser-connector.js');
const ComputerConnector = require('./computer-connector.js');
const OfficeConnector = require('./office-connector.js');
const SafeWorkspace = require('./safe-workspace.cjs');
const SecurityMode = require('./security-mode.cjs');

const READ_ONLY_KINDS = new Set(['read', 'search', 'think', 'switch_mode']);
const READ_ONLY_TOOLS = new Set(['tree', 'read', 'read_file', 'read_text_file', 'read_image', 'list_directory', 'list_files']);
const EDIT_TOOLS = new Set(['write', 'edit', 'write_file', 'edit_file']);
const EXECUTE_TOOLS = new Set(['shell', 'execute', 'run_command']);
const REMOTE_READ_PREFIX = /^(?:get|list|search|read|query|fetch|lookup|describe|inspect|check|validate)_/;
const REMOTE_MUTATION_PREFIX = /^(?:make|create|update|delete|remove|write|edit|publish|send|upload|install|uninstall|execute|run|trigger|set|manage|apply|import|export|generate|render)_/;
const DESTRUCTIVE_TOOL_NAME = /(?:^|_)(?:delete|remove|trash|erase|uninstall|destroy)(?:_|$)/;
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function maximumRisk(...values) {
  return values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => Object.hasOwn(RISK_RANK, value))
    .reduce((current, value) => RISK_RANK[value] > RISK_RANK[current] ? value : current, 'low');
}

function normalizedToolName(toolCall = {}) {
  const value = String(toolCall.name || toolCall.title || '').trim().toLowerCase();
  const segment = value.split(/[:./\\]/).at(-1) || value;
  return segment.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizedCatalogToolName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toolNameMatches(toolName, candidates) {
  return [...candidates].some((candidate) => toolName === candidate || toolName.endsWith(`_${candidate}`));
}

function collectInputPaths(value, paths = [], depth = 0) {
  if (!value || depth > 5) return paths;
  if (Array.isArray(value)) {
    value.forEach((item) => collectInputPaths(item, paths, depth + 1));
    return paths;
  }
  if (typeof value !== 'object') return paths;
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === 'string' && /(?:^|_)(?:path|file|directory|dir|cwd|root)$/i.test(key) && !/^https?:\/\//i.test(entry)) {
      paths.push(entry);
    } else if (entry && typeof entry === 'object') {
      collectInputPaths(entry, paths, depth + 1);
    }
  });
  return paths;
}

function collectURLs(value, urls = [], depth = 0) {
  if (value == null || depth > 5) return urls;
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) urls.push(match[0]);
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectURLs(item, urls, depth + 1));
    return urls;
  }
  if (typeof value === 'object') Object.values(value).forEach((item) => collectURLs(item, urls, depth + 1));
  return urls;
}

function lexicalInsideWorkspace(location, workspace) {
  const target = String(location?.path || location || '').trim();
  if (!target) return true;
  const root = path.resolve(workspace);
  const resolvedTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
  const relative = path.relative(root, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function locationInsideWorkspace(location, workspace, options = {}) {
  const mode = SecurityMode.normalizeSecurityMode(options.securityMode);
  if (mode === SecurityMode.MODES.INTERNAL) return true;
  if (!fs.existsSync(workspace)) return lexicalInsideWorkspace(location, workspace);
  try {
    const result = SafeWorkspace.resolveInside(
      workspace,
      String(location?.path || location || ''),
      { allowMissing: true, securityMode: mode },
    );
    return !result.outsideWorkspace;
  } catch {
    return false;
  }
}

function effectiveToolKind(toolCall, toolName, inputText) {
  const reportedKind = String(toolCall.kind || 'other').toLowerCase();
  if (reportedKind !== 'other') return reportedKind;
  if (toolNameMatches(toolName, READ_ONLY_TOOLS)) {
    if (toolNameMatches(toolName, new Set(['read_image'])) && /https?:\/\//i.test(inputText)) return 'fetch';
    return 'read';
  }
  if (toolNameMatches(toolName, EDIT_TOOLS)) return 'edit';
  if (toolNameMatches(toolName, EXECUTE_TOOLS)) return 'execute';
  return 'other';
}

function normalizedEffects(tool = {}) {
  const source = tool.effects && typeof tool.effects === 'object'
    ? tool.effects
    : tool.annotations?.effects && typeof tool.annotations.effects === 'object'
      ? tool.annotations.effects
      : {};
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  return {
    readOnly: source.readOnly === true || annotations.readOnlyHint === true,
    filesystemRead: source.filesystemRead || null,
    filesystemWrite: source.filesystemWrite || null,
    networkRead: source.networkRead === true,
    networkMutation: source.networkMutation === true,
    processExecution: source.processExecution === true,
    publish: source.publish === true,
    destructive: source.destructive === true || annotations.destructiveHint === true,
    requiresApproval: source.requiresApproval === true,
    blocked: source.blocked === true,
    risk: String(source.risk || '').toLowerCase() || null,
    allowedHosts: Array.isArray(source.allowedHosts) ? source.allowedHosts.map(String) : [],
  };
}

function remoteToolAssessment(toolCall, toolName, context) {
  const title = String(toolCall.title || toolCall.name || '').trim().toLowerCase();
  const connectors = Array.isArray(context.connectors) ? context.connectors : [];
  const candidates = connectors.filter((connector) => {
    const selectedTools = (connector.selectedTools || []).map(normalizedCatalogToolName);
    const connectorID = String(connector.id || '').toLowerCase();
    const prefixed = title.startsWith(`${connectorID}:`) || title.startsWith(`${connectorID}__`);
    return prefixed || selectedTools.includes(toolName);
  });
  const connector = candidates.length === 1 ? candidates[0] : null;
  if (!connector) return null;
  const selectedTools = (connector.selectedTools || []).map(normalizedCatalogToolName);
  const tool = (connector.tools || []).find((candidate) => {
    const candidateName = normalizedCatalogToolName(candidate.name);
    return toolName === candidateName || toolName.endsWith(`_${candidateName}`);
  });
  const catalogToolName = normalizedCatalogToolName(tool?.name || toolName);
  const risk = String(connector.riskClassification || 'medium').toLowerCase();
  const browserRisk = connector.connectorType === 'browser' ? BrowserConnector.toolRisk(catalogToolName) : null;
  const computerRisk = connector.connectorType === 'computer' ? ComputerConnector.toolRisk(catalogToolName) : null;
  const officeRisk = connector.connectorType === 'office' ? OfficeConnector.toolRisk(catalogToolName) : null;
  const effects = normalizedEffects(tool || {});
  const explicitDestructiveEffect = tool?.effects?.destructive === true
    || tool?.annotations?.effects?.destructive === true;
  if ((browserRisk || computerRisk) && !explicitDestructiveEffect) effects.destructive = false;
  const effectiveRisk = maximumRisk(risk, effects.risk);
  const inferredReadOnly = Boolean(tool) && (
    browserRisk === 'observe'
    || computerRisk === 'observe'
    || officeRisk === 'observe'
    || (REMOTE_READ_PREFIX.test(toolName) && !REMOTE_MUTATION_PREFIX.test(toolName))
  );
  const mutating = effects.filesystemWrite || effects.networkMutation || effects.processExecution || effects.publish || effects.destructive;
  const readOnly = (effects.readOnly || inferredReadOnly) && !mutating;
  return {
    connectorId: connector.id,
    connectorType: connector.connectorType || null,
    transport: connector.transport,
    verified: connector.verified === true,
    explicitlySelected: connector.explicitToolSelection === true && selectedTools.includes(catalogToolName),
    acceptableRisk: !['high', 'critical'].includes(effectiveRisk),
    connectorRisk: risk,
    effectiveRisk,
    readOnly,
    browserRisk,
    computerRisk,
    officeRisk,
    effects,
    allowedHosts: [...new Set([...(connector.allowedHosts || []), ...effects.allowedHosts].map(String))],
    toolDescription: String(tool?.description || ''),
  };
}

function hostAllowed(url, allowedHosts) {
  if (!allowedHosts.length) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const hostWithPort = parsed.host.toLowerCase();
    return allowedHosts.some((candidate) => {
      const normalized = String(candidate || '').trim().toLowerCase();
      if (!normalized || normalized === '*') return true;
      if (normalized === host || normalized === hostWithPort) return true;
      return normalized.startsWith('*.') && host.endsWith(normalized.slice(1));
    });
  } catch {
    return false;
  }
}

function classifyPermissionRequest(request = {}, context = {}) {
  const securityMode = SecurityMode.normalizeSecurityMode(context.securityMode);
  const strict = securityMode === SecurityMode.MODES.STRICT;
  const toolCall = request.toolCall || {};
  const workspace = path.resolve(context.workspace || process.cwd());
  const toolName = normalizedToolName(toolCall);
  const inputText = JSON.stringify(toolCall.rawInput || '').toLowerCase();
  const remoteTool = remoteToolAssessment(toolCall, toolName, context);
  const effects = remoteTool?.effects || normalizedEffects(toolCall);
  const kind = remoteTool?.readOnly
    ? 'read'
    : effects.filesystemWrite
      ? 'edit'
      : effects.processExecution
        ? 'execute'
        : effects.networkMutation
          ? 'fetch'
          : remoteTool?.browserRisk === 'interaction' || remoteTool?.computerRisk === 'interaction'
            ? 'execute'
            : remoteTool?.officeRisk === 'mutation'
              ? 'edit'
              : effectiveToolKind(toolCall, toolName, inputText);
  const locations = [
    ...(Array.isArray(toolCall.locations) ? toolCall.locations : []),
    ...collectInputPaths(toolCall.rawInput),
  ];
  const outsideWorkspace = strict
    ? locations.some((location) => !locationInsideWorkspace(location, workspace, { securityMode }))
    : false;
  const urls = [...new Set(collectURLs(toolCall.rawInput))];
  const usesNetwork = Boolean(remoteTool) || urls.length > 0 || effects.networkRead || effects.networkMutation;
  const allowedHosts = [...new Set([...(remoteTool?.allowedHosts || []), ...(context.allowedNetworkHosts || [])].map(String))];
  const enforceHostPolicy = strict || context.enforceNetworkHostPolicy === true;
  const networkHostBlocked = enforceHostPolicy && urls.some((url) => !hostAllowed(url, allowedHosts));
  const sensitiveTarget = strict && /(?:\.ssh|\.aws|\.gnupg|keychain|login\.keychain|\/etc\/|\/private\/|credentials?|api[_-]?keys?|secrets?|passwords?|tokens?)/.test(`${toolName} ${inputText}`);
  const dangerousCommand = /\b(?:sudo|rm|rmdir|unlink|shred|chmod|chown|kill|pkill|reboot|shutdown)\b|git\s+(?:push|reset\s+--hard|clean)|(?:npm|cargo|twine)\s+publish|(?:drop|truncate)\s+(?:table|database)|delete\s+from/.test(inputText);
  const mutatingNetworkRequest = effects.networkMutation || /(?:"method"\s*:\s*"(?:post|put|patch|delete)"|upload|multipart|authorization|bearer)/.test(inputText);
  const readOnly = READ_ONLY_KINDS.has(kind) || remoteTool?.readOnly === true;
  const safeLocalRead = readOnly && !remoteTool && !outsideWorkspace && !sensitiveTarget && (!usesNetwork || !strict);
  const safeRemoteRead = Boolean(
    remoteTool
    && remoteTool.readOnly
    && !outsideWorkspace
    && !sensitiveTarget
    && !networkHostBlocked
    && (!strict || (remoteTool.verified && remoteTool.explicitlySelected && remoteTool.acceptableRisk))
  );
  const hardDeny = effects.blocked
    || remoteTool?.browserRisk === 'blocked'
    || remoteTool?.computerRisk === 'blocked'
    || remoteTool?.officeRisk === 'blocked';
  const destructiveOperation = effects.destructive
    || kind === 'delete'
    || DESTRUCTIVE_TOOL_NAME.test(toolName);
  const protectedDesktopAction = ['inspect', 'interaction', 'sensitive'].includes(remoteTool?.computerRisk);
  const effectiveRisk = maximumRisk(remoteTool?.effectiveRisk, effects.risk);
  const nonBypassableApproval = Boolean(
    effects.requiresApproval
    || destructiveOperation
    || effects.publish
    || dangerousCommand
    || protectedDesktopAction
    || ['high', 'critical'].includes(effectiveRisk)
  );

  let requiresSmartApproval;
  if (strict) {
    requiresSmartApproval = hardDeny
      || outsideWorkspace
      || sensitiveTarget
      || networkHostBlocked
      || effects.requiresApproval
      || effects.destructive
      || effects.publish
      || ['high', 'critical'].includes(effectiveRisk)
      || ['inspect', 'interaction', 'sensitive'].includes(remoteTool?.computerRisk);
    if (!requiresSmartApproval) {
      if (safeRemoteRead || safeLocalRead) requiresSmartApproval = false;
      else if (['delete', 'move', 'other'].includes(kind)) requiresSmartApproval = true;
      else if (kind === 'execute') requiresSmartApproval = dangerousCommand || effects.processExecution;
      else if (kind === 'fetch') requiresSmartApproval = mutatingNetworkRequest;
      else requiresSmartApproval = false;
    }
  } else {
    requiresSmartApproval = hardDeny
      || effects.requiresApproval
      || effects.destructive
      || effects.publish
      || dangerousCommand
      || remoteTool?.computerRisk === 'sensitive';
    requiresSmartApproval ||= ['high', 'critical'].includes(effectiveRisk);
  }

  return {
    securityMode,
    kind,
    toolName,
    readOnly,
    safeLocalRead,
    safeRemoteRead,
    remoteConnectorId: remoteTool?.connectorId || null,
    browserRisk: remoteTool?.browserRisk || null,
    computerRisk: remoteTool?.computerRisk || null,
    officeRisk: remoteTool?.officeRisk || null,
    effects,
    outsideWorkspace,
    usesNetwork,
    networkHostBlocked,
    sensitiveTarget,
    hardDeny,
    destructiveOperation,
    dangerousCommand,
    mutatingNetworkRequest,
    protectedDesktopAction,
    effectiveRisk,
    nonBypassableApproval,
    requiresSmartApproval,
  };
}

function permissionHandling(permissionProfileId, assessment) {
  if (assessment.hardDeny) return 'deny';
  if (permissionProfileId === 'workspace-approval' && assessment.computerRisk) {
    return assessment.destructiveOperation ? 'prompt' : 'allow_always';
  }
  if (assessment.nonBypassableApproval) return 'prompt';
  const strict = SecurityMode.normalizeSecurityMode(assessment.securityMode) === SecurityMode.MODES.STRICT;

  if (!strict) {
    if (permissionProfileId === 'workspace-approval') return 'allow_always';
    if (permissionProfileId === 'analysis-readonly') {
      return assessment.readOnly || assessment.safeLocalRead || assessment.safeRemoteRead ? 'allow_once' : 'prompt';
    }
    if (permissionProfileId === 'artifact-approval') {
      return assessment.requiresSmartApproval ? 'prompt' : 'allow_once';
    }
    return assessment.requiresSmartApproval ? 'prompt' : 'allow_once';
  }

  if (permissionProfileId === 'workspace-approval') {
    if (
      assessment.outsideWorkspace
      || assessment.sensitiveTarget
      || assessment.networkHostBlocked
      || assessment.effects?.requiresApproval
      || assessment.effects?.destructive
      || assessment.effects?.publish
    ) {
      return 'prompt';
    }
    return 'allow_always';
  }
  if (['inspect', 'interaction', 'sensitive'].includes(assessment.computerRisk)) return 'prompt';
  if (permissionProfileId === 'analysis-readonly' && (assessment.safeLocalRead || assessment.safeRemoteRead)) return 'allow_once';
  if (permissionProfileId === 'artifact-approval' && !assessment.requiresSmartApproval) return 'allow_once';
  return 'prompt';
}

function permissionGrantReusable(assessment = {}) {
  return !assessment.hardDeny
    && !assessment.nonBypassableApproval
    && !assessment.outsideWorkspace
    && !assessment.sensitiveTarget
    && !assessment.networkHostBlocked
    && !['high', 'critical'].includes(String(assessment.effectiveRisk || assessment.effects?.risk || '').toLowerCase());
}

module.exports = {
  classifyPermissionRequest,
  permissionHandling,
  permissionGrantReusable,
  normalizedEffects,
  locationInsideWorkspace,
};
