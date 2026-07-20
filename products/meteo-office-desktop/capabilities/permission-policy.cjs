const path = require('node:path');
const BrowserConnector = require('./browser-connector.js');

const READ_ONLY_KINDS = new Set(['read', 'search', 'think', 'switch_mode']);
const READ_ONLY_TOOLS = new Set([
  'tree',
  'read',
  'read_file',
  'read_text_file',
  'read_image',
  'list_directory',
  'list_files',
]);
const EDIT_TOOLS = new Set(['write', 'edit', 'write_file', 'edit_file']);
const EXECUTE_TOOLS = new Set(['shell', 'execute', 'run_command']);
const REMOTE_READ_PREFIX = /^(?:get|list|search|read|query|fetch|lookup|describe|inspect|check)_/;
const REMOTE_MUTATION_PREFIX = /^(?:make|create|update|delete|remove|write|edit|publish|send|upload|install|uninstall|execute|run|trigger|set|manage|apply|import|export|generate)_/;

function normalizedToolName(toolCall = {}) {
  const value = String(toolCall.name || toolCall.title || '').trim().toLowerCase();
  const segment = value.split(/[:./\\]/).at(-1) || value;
  return segment.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toolNameMatches(toolName, candidates) {
  return [...candidates].some(
    (candidate) => toolName === candidate || toolName.endsWith(`_${candidate}`)
  );
}

function collectInputPaths(value, paths = [], depth = 0) {
  if (!value || depth > 4) return paths;
  if (Array.isArray(value)) {
    value.forEach((item) => collectInputPaths(item, paths, depth + 1));
    return paths;
  }
  if (typeof value !== 'object') return paths;
  Object.entries(value).forEach(([key, entry]) => {
    if (
      typeof entry === 'string'
      && /(?:^|_)(?:path|file|directory|dir|cwd|root)$/i.test(key)
      && !/^https?:\/\//i.test(entry)
    ) {
      paths.push(entry);
      return;
    }
    if (entry && typeof entry === 'object') collectInputPaths(entry, paths, depth + 1);
  });
  return paths;
}

function locationInsideWorkspace(location, workspace) {
  const target = String(location?.path || location || '').trim();
  if (!target) return true;
  const resolvedTarget = path.resolve(workspace, target);
  const relative = path.relative(workspace, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function effectiveToolKind(toolCall, toolName, inputText) {
  const reportedKind = String(toolCall.kind || 'other').toLowerCase();
  if (reportedKind !== 'other') return reportedKind;
  if (toolNameMatches(toolName, READ_ONLY_TOOLS)) {
    if (toolNameMatches(toolName, new Set(['read_image'])) && /https?:\/\//i.test(inputText)) {
      return 'fetch';
    }
    return 'read';
  }
  if (toolNameMatches(toolName, EDIT_TOOLS)) return 'edit';
  if (toolNameMatches(toolName, EXECUTE_TOOLS)) return 'execute';
  return 'other';
}

function normalizedCatalogToolName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function remoteToolAssessment(toolCall, toolName, context) {
  const title = String(toolCall.title || toolCall.name || '').trim().toLowerCase();
  const connectors = Array.isArray(context.connectors) ? context.connectors : [];
  const candidates = connectors.filter((connector) => {
    const selectedTools = (connector.selectedTools || []).map(normalizedCatalogToolName);
    const prefixed = title.startsWith(`${String(connector.id || '').toLowerCase()}:`)
      || title.startsWith(`${String(connector.id || '').toLowerCase()}__`);
    return prefixed || selectedTools.includes(toolName);
  });
  const connector = candidates.length === 1 ? candidates[0] : null;
  if (!connector) return null;
  const selectedTools = (connector.selectedTools || []).map(normalizedCatalogToolName);
  const tool = (connector.tools || []).find(
    (candidate) => {
      const candidateName = normalizedCatalogToolName(candidate.name);
      return toolName === candidateName || toolName.endsWith(`_${candidateName}`);
    }
  );
  const catalogToolName = normalizedCatalogToolName(tool?.name || toolName);
  const risk = String(connector.riskClassification || 'medium').toLowerCase();
  const browserRisk = connector.connectorType === 'browser'
    ? BrowserConnector.toolRisk(catalogToolName)
    : null;
  const readOnly = Boolean(tool) && (
    browserRisk === 'observe'
    || (REMOTE_READ_PREFIX.test(toolName) && !REMOTE_MUTATION_PREFIX.test(toolName))
  );
  return {
    connectorId: connector.id,
    connectorType: connector.connectorType || null,
    transport: connector.transport,
    verified: connector.verified === true,
    explicitlySelected: connector.explicitToolSelection === true && selectedTools.includes(catalogToolName),
    acceptableRisk: !['high', 'critical'].includes(risk),
    readOnly,
    browserRisk,
    toolDescription: String(tool?.description || ''),
  };
}

function classifyPermissionRequest(request = {}, context = {}) {
  const toolCall = request.toolCall || {};
  const workspace = path.resolve(context.workspace || process.cwd());
  const toolName = normalizedToolName(toolCall);
  const inputText = JSON.stringify(toolCall.rawInput || '').toLowerCase();
  const remoteTool = remoteToolAssessment(toolCall, toolName, context);
  const kind = remoteTool?.readOnly
    ? 'read'
    : remoteTool?.browserRisk === 'interaction'
      ? 'execute'
      : effectiveToolKind(toolCall, toolName, inputText);
  const locations = [
    ...(Array.isArray(toolCall.locations) ? toolCall.locations : []),
    ...collectInputPaths(toolCall.rawInput),
  ];
  const outsideWorkspace = locations.some(
    (location) => !locationInsideWorkspace(location, workspace)
  );
  const usesNetwork = Boolean(remoteTool) || /https?:\/\//i.test(inputText);
  const sensitiveTarget = /(?:\.ssh|\.aws|\.gnupg|keychain|login\.keychain|\/etc\/|\/private\/|credentials?|api[_-]?keys?|secrets?|passwords?|tokens?)/.test(`${toolName} ${inputText}`);
  const dangerousCommand = /\b(?:sudo|rm|rmdir|unlink|shred|chmod|chown|kill|pkill|reboot|shutdown)\b|git\s+(?:push|reset\s+--hard|clean)|(?:npm|cargo|twine)\s+publish|(?:drop|truncate)\s+(?:table|database)|delete\s+from/.test(inputText);
  const mutatingNetworkRequest = /(?:"method"\s*:\s*"(?:post|put|patch|delete)"|upload|multipart|authorization|bearer)/.test(inputText);
  const readOnly = READ_ONLY_KINDS.has(kind);
  const safeLocalRead = readOnly && !outsideWorkspace && !sensitiveTarget && !usesNetwork;
  const safeRemoteRead = Boolean(
    remoteTool
    && (remoteTool.transport === 'streamable-http' || remoteTool.connectorType === 'browser')
    && remoteTool.verified
    && remoteTool.explicitlySelected
    && remoteTool.acceptableRisk
    && remoteTool.readOnly
    && !locations.length
    && !sensitiveTarget
  );

  let requiresSmartApproval = outsideWorkspace || sensitiveTarget;
  if (safeRemoteRead) requiresSmartApproval = false;
  if (!requiresSmartApproval) {
    if (safeRemoteRead) requiresSmartApproval = false;
    else if (['delete', 'move', 'other'].includes(kind)) requiresSmartApproval = true;
    else if (kind === 'execute') requiresSmartApproval = dangerousCommand;
    else if (kind === 'fetch') requiresSmartApproval = mutatingNetworkRequest;
    else requiresSmartApproval = false;
  }

  return {
    kind,
    toolName,
    readOnly,
    safeLocalRead,
    safeRemoteRead,
    remoteConnectorId: remoteTool?.connectorId || null,
    browserRisk: remoteTool?.browserRisk || null,
    outsideWorkspace,
    usesNetwork,
    sensitiveTarget,
    requiresSmartApproval,
  };
}

function permissionHandling(permissionProfileId, assessment) {
  if (assessment.browserRisk === 'blocked') return 'deny';
  if (permissionProfileId === 'workspace-approval') return 'allow_always';
  if (
    permissionProfileId === 'analysis-readonly'
    && (assessment.safeLocalRead || assessment.safeRemoteRead)
  ) {
    return 'allow_once';
  }
  if (permissionProfileId === 'artifact-approval' && !assessment.requiresSmartApproval) {
    return 'allow_once';
  }
  return 'prompt';
}

module.exports = { classifyPermissionRequest, permissionHandling };
