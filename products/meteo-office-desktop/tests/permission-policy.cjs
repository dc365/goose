const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PermissionPolicy = require('../capabilities/permission-policy.cjs');
const BrowserConnector = require('../capabilities/browser-connector.js');
const ComputerConnector = require('../capabilities/computer-connector.js');
const OfficeConnector = require('../capabilities/office-connector.js');

const workspace = '/Users/test/Documents/MeteoMate/Claw/session';
const strictContext = { workspace, securityMode: 'strict' };

const tree = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'tree',
      kind: 'other',
      rawInput: { path: workspace, depth: 2 },
    },
  },
  strictContext
);
assert.equal(tree.kind, 'read');
assert.equal(tree.safeLocalRead, true);
assert.equal(tree.requiresSmartApproval, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', tree), 'allow_once');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', tree), 'allow_once');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', tree), 'allow_always');

const outsideTree = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'tree',
      kind: 'other',
      rawInput: { path: '/Users/test/Documents/Other', depth: 2 },
    },
  },
  strictContext
);
assert.equal(outsideTree.outsideWorkspace, true);
assert.equal(outsideTree.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', outsideTree), 'prompt');

const safeShell = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'shell', kind: 'other', rawInput: { command: 'pwd' } } },
  strictContext
);
assert.equal(safeShell.kind, 'execute');
assert.equal(safeShell.requiresSmartApproval, false);

const destructiveShell = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'shell', kind: 'other', rawInput: { command: 'rm -rf output' } } },
  strictContext
);
assert.equal(destructiveShell.requiresSmartApproval, true);

const deleteFile = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'delete_file', kind: 'delete', rawInput: { path: 'obsolete.txt' } } },
  strictContext
);
assert.equal(deleteFile.destructiveOperation, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', deleteFile), 'prompt');

const unknownTool = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'custom action', kind: 'other', rawInput: {} } },
  strictContext
);
assert.equal(unknownTool.requiresSmartApproval, true);

const trustedHttpContext = {
  workspace,
  securityMode: 'strict',
  connectors: [{
    id: 'fz-weather-mcp',
    transport: 'streamable-http',
    riskClassification: 'medium',
    verified: true,
    explicitToolSelection: true,
    selectedTools: ['get_system_time', 'make_product'],
    tools: [
      { name: 'get_system_time', description: '获取当前本地时间' },
      { name: 'make_product', description: '生成产品文档' },
    ],
  }],
};
const trustedHttpRead = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'fz-weather-mcp: get system time', kind: 'other', rawInput: {} } },
  trustedHttpContext
);
assert.equal(trustedHttpRead.safeRemoteRead, true);
assert.equal(trustedHttpRead.remoteConnectorId, 'fz-weather-mcp');
assert.equal(trustedHttpRead.requiresSmartApproval, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', trustedHttpRead), 'allow_once');

const remoteMutation = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'fz-weather-mcp: make product', kind: 'other', rawInput: {} } },
  trustedHttpContext
);
assert.equal(remoteMutation.safeRemoteRead, false);
assert.equal(remoteMutation.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', remoteMutation), 'prompt');

const unverifiedHttpRead = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'fz-weather-mcp: get system time', kind: 'other', rawInput: {} } },
  {
    ...trustedHttpContext,
    connectors: trustedHttpContext.connectors.map((connector) => ({ ...connector, verified: false })),
  }
);
assert.equal(unverifiedHttpRead.safeRemoteRead, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', unverifiedHttpRead), 'prompt');

const sensitiveHttpRead = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'fz-weather-mcp: get system time',
      kind: 'other',
      rawInput: { token: 'secret-value' },
    },
  },
  trustedHttpContext
);
assert.equal(sensitiveHttpRead.safeRemoteRead, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', sensitiveHttpRead), 'prompt');

const browserContext = {
  workspace,
  securityMode: 'strict',
  connectors: [{
    id: BrowserConnector.ID,
    connectorType: 'browser',
    transport: 'stdio',
    riskClassification: 'medium',
    verified: true,
    explicitToolSelection: true,
    selectedTools: [...BrowserConnector.SAFE_TOOLS],
    tools: [...BrowserConnector.SAFE_TOOLS, ...BrowserConnector.BLOCKED_TOOLS]
      .map((name) => ({
        name,
        description: name,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      })),
  }],
};
const browserSnapshot = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser__browser_snapshot', kind: 'other', rawInput: {} } },
  browserContext
);
assert.equal(browserSnapshot.browserRisk, 'observe');
assert.equal(browserSnapshot.safeRemoteRead, true);
assert.equal(browserSnapshot.requiresSmartApproval, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', browserSnapshot), 'allow_once');

const browserNavigate = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser: browser_navigate', kind: 'other', rawInput: { url: 'https://example.com' } } },
  browserContext
);
assert.equal(browserNavigate.safeRemoteRead, true);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', browserNavigate), 'allow_once');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', browserNavigate), 'allow_always');

const browserExplicitlyDestructive = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser: browser_navigate', kind: 'other', rawInput: { url: 'https://example.com' } } },
  {
    ...browserContext,
    connectors: browserContext.connectors.map((connector) => ({
      ...connector,
      tools: connector.tools.map((tool) => tool.name === 'browser_navigate'
        ? { ...tool, effects: { destructive: true } }
        : tool),
    })),
  }
);
assert.equal(browserExplicitlyDestructive.effects.destructive, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', browserExplicitlyDestructive), 'prompt');

const browserClick = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser__browser_click', kind: 'other', rawInput: { ref: 'e1' } } },
  browserContext
);
assert.equal(browserClick.browserRisk, 'interaction');
assert.equal(browserClick.kind, 'execute');
assert.equal(browserClick.requiresSmartApproval, false);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', browserClick), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', browserClick), 'allow_once');

const browserDialog = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser__browser_handle_dialog', kind: 'other', rawInput: { accept: true } } },
  browserContext
);
assert.equal(browserDialog.browserRisk, 'sensitive');
assert.equal(browserDialog.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', browserDialog), 'prompt');

const browserUnsafe = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'playwright-browser__browser_run_code_unsafe', kind: 'other', rawInput: { code: 'process.exit()' } } },
  browserContext
);
assert.equal(browserUnsafe.browserRisk, 'blocked');
assert.equal(browserUnsafe.safeRemoteRead, false);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', browserUnsafe), 'deny');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', browserUnsafe), 'deny');

for (const toolName of BrowserConnector.SAFE_TOOLS) {
  const assessment = PermissionPolicy.classifyPermissionRequest(
    { toolCall: { title: `${BrowserConnector.ID}: ${toolName}`, kind: 'other', rawInput: {} } },
    browserContext
  );
  assert.equal(
    PermissionPolicy.permissionHandling('workspace-approval', assessment),
    'allow_always',
    `完全访问应自动允许浏览器工具：${toolName}`,
  );
}
for (const toolName of BrowserConnector.BLOCKED_TOOLS) {
  const assessment = PermissionPolicy.classifyPermissionRequest(
    { toolCall: { title: `${BrowserConnector.ID}: ${toolName}`, kind: 'other', rawInput: {} } },
    browserContext
  );
  assert.equal(
    PermissionPolicy.permissionHandling('workspace-approval', assessment),
    'deny',
    `完全访问不能绕过浏览器工具禁用：${toolName}`,
  );
}

const computerContext = {
  workspace,
  securityMode: 'strict',
  connectors: [{
    id: ComputerConnector.ID,
    connectorType: 'computer',
    transport: 'stdio',
    riskClassification: 'high',
    verified: true,
    explicitToolSelection: true,
    selectedTools: [...ComputerConnector.SAFE_TOOLS],
    tools: [...ComputerConnector.SAFE_TOOLS, ...ComputerConnector.BLOCKED_TOOLS]
      .map((name) => ({
        name,
        description: name,
        annotations: {
          destructiveHint: ['interaction', 'sensitive'].includes(ComputerConnector.toolRisk(name)),
        },
      })),
  }],
};
const computerApps = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__list_apps', kind: 'other', rawInput: {} } },
  computerContext
);
assert.equal(computerApps.computerRisk, 'observe');
assert.equal(computerApps.effectiveRisk, 'high');
assert.equal(computerApps.safeRemoteRead, false);
assert.equal(computerApps.nonBypassableApproval, true);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', computerApps), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerApps), 'allow_always');
assert.equal(PermissionPolicy.permissionGrantReusable(computerApps), false);

const computerDesktop = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__get_desktop_state', kind: 'other', rawInput: {} } },
  computerContext
);
assert.equal(computerDesktop.computerRisk, 'inspect');
assert.equal(computerDesktop.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', computerDesktop), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerDesktop), 'allow_always');
assert.equal(PermissionPolicy.permissionGrantReusable(computerDesktop), false);

const computerClick = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__click', kind: 'other', rawInput: { pid: 100, x: 10, y: 10 } } },
  computerContext
);
assert.equal(computerClick.computerRisk, 'interaction');
assert.equal(computerClick.kind, 'execute');
assert.equal(computerClick.effects.destructive, false);
assert.equal(computerClick.destructiveOperation, false);
assert.equal(computerClick.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', computerClick), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', computerClick), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerClick), 'allow_always');

const computerType = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__type_text', kind: 'other', rawInput: { pid: 100, text: 'forecast' } } },
  computerContext
);
assert.equal(computerType.computerRisk, 'sensitive');
assert.equal(computerType.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', computerType), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerType), 'allow_always');

const computerKill = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__kill_app', kind: 'other', rawInput: { pid: 100 } } },
  computerContext
);
assert.equal(computerKill.computerRisk, 'sensitive');
assert.equal(computerKill.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerKill), 'allow_always');

const computerBrowserNavigate = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__browser_navigate', kind: 'other', rawInput: { url: 'https://example.com' } } },
  computerContext
);
assert.equal(computerBrowserNavigate.computerRisk, 'interaction');
assert.equal(computerBrowserNavigate.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerBrowserNavigate), 'allow_always');

const computerDestructiveClick = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__click', kind: 'other', rawInput: { pid: 100, x: 10, y: 10 } } },
  {
    ...computerContext,
    connectors: computerContext.connectors.map((connector) => ({
      ...connector,
      tools: connector.tools.map((tool) => tool.name === 'click'
        ? { ...tool, effects: { destructive: true } }
        : tool),
    })),
  }
);
assert.equal(computerDestructiveClick.effects.destructive, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerDestructiveClick), 'prompt');

for (const toolName of ComputerConnector.SAFE_TOOLS) {
  const assessment = PermissionPolicy.classifyPermissionRequest(
    { toolCall: { title: `${ComputerConnector.ID}: ${toolName.replaceAll('_', ' ')}`, kind: 'other', rawInput: {} } },
    computerContext
  );
  assert.equal(
    PermissionPolicy.permissionHandling('workspace-approval', assessment),
    'allow_always',
    `完全访问应自动允许 CUA 工具：${toolName}`,
  );
}
for (const toolName of ComputerConnector.BLOCKED_TOOLS) {
  const assessment = PermissionPolicy.classifyPermissionRequest(
    { toolCall: { title: `${ComputerConnector.ID}: ${toolName.replaceAll('_', ' ')}`, kind: 'other', rawInput: {} } },
    computerContext
  );
  assert.equal(
    PermissionPolicy.permissionHandling('workspace-approval', assessment),
    'deny',
    `完全访问不能绕过 Driver 工具禁用：${toolName}`,
  );
}

const computerBlocked = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'cua-desktop__start_session', kind: 'other', rawInput: {} } },
  computerContext
);
assert.equal(computerBlocked.computerRisk, 'blocked');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', computerBlocked), 'deny');

const officeContext = {
  workspace,
  securityMode: 'strict',
  connectors: [{
    id: OfficeConnector.ID,
    connectorType: 'office',
    transport: 'stdio',
    riskClassification: 'medium',
    verified: true,
    explicitToolSelection: true,
    selectedTools: [...OfficeConnector.SAFE_TOOLS],
    tools: [...OfficeConnector.SAFE_TOOLS, 'shell']
      .map((name) => ({ name, description: name })),
  }],
};
const officeInspect = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'office-artifacts__docx_inspect',
      kind: 'other',
      rawInput: { sourcePath: 'inputs/report.docx' },
    },
  },
  officeContext
);
assert.equal(officeInspect.officeRisk, 'observe');
assert.equal(officeInspect.safeRemoteRead, true);
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', officeInspect), 'allow_once');

const officeCreate = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'office-artifacts__pdf_create',
      kind: 'other',
      rawInput: { outputPath: 'artifacts/report.pdf' },
    },
  },
  officeContext
);
assert.equal(officeCreate.officeRisk, 'mutation');
assert.equal(officeCreate.kind, 'edit');
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', officeCreate), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', officeCreate), 'allow_once');

const presentationInspect = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'office-artifacts__pptx_inspect',
      kind: 'other',
      rawInput: { sourcePath: 'inputs/briefing.pptx' },
    },
  },
  officeContext
);
assert.equal(presentationInspect.officeRisk, 'observe');
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', presentationInspect), 'allow_once');

const spreadsheetEdit = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'office-artifacts__xlsx_edit',
      kind: 'other',
      rawInput: {
        sourcePath: 'inputs/rainfall.xlsx',
        outputPath: 'artifacts/rainfall-v2.xlsx',
      },
    },
  },
  officeContext
);
assert.equal(spreadsheetEdit.officeRisk, 'mutation');
assert.equal(PermissionPolicy.permissionHandling('analysis-readonly', spreadsheetEdit), 'prompt');
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', spreadsheetEdit), 'allow_once');

const officeBlocked = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'office-artifacts__shell', kind: 'other', rawInput: {} } },
  officeContext
);
assert.equal(officeBlocked.officeRisk, 'blocked');
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', officeBlocked), 'deny');

const internalDestructive = PermissionPolicy.classifyPermissionRequest({
  toolCall: {
    title: 'weather-data__publish_warning',
    kind: 'other',
    rawInput: { region: '华南' },
  },
}, {
  workspace,
  securityMode: 'internal',
  connectors: [{
    id: 'weather-data',
    verified: true,
    explicitToolSelection: true,
    selectedTools: ['publish_warning'],
    tools: [{
      name: 'publish_warning',
      effects: { publish: true, destructive: true, requiresApproval: true },
    }],
  }],
});
for (const profile of ['analysis-readonly', 'artifact-approval', 'workspace-approval']) {
  assert.equal(PermissionPolicy.permissionHandling(profile, internalDestructive), 'prompt');
}
assert.equal(internalDestructive.nonBypassableApproval, true);
assert.equal(PermissionPolicy.permissionGrantReusable(internalDestructive), false);
assert.equal(PermissionPolicy.permissionGrantReusable(tree), true);
assert.equal(PermissionPolicy.permissionGrantReusable(destructiveShell), false);

const highRiskRead = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'high-risk-data__read_observation', kind: 'other', rawInput: {} } },
  {
    ...strictContext,
    connectors: [{
      id: 'high-risk-data',
      transport: 'streamable-http',
      riskClassification: 'high',
      verified: true,
      explicitToolSelection: true,
      selectedTools: ['read_observation'],
      tools: [{ name: 'read_observation', annotations: { readOnlyHint: true } }],
    }],
  },
);
assert.equal(highRiskRead.effectiveRisk, 'high');
assert.equal(highRiskRead.nonBypassableApproval, true);
assert.equal(PermissionPolicy.permissionHandling('workspace-approval', highRiskRead), 'prompt');
assert.equal(PermissionPolicy.permissionGrantReusable(highRiskRead), false);

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
assert.ok(mainSource.includes('对于问候、寒暄、能力介绍、一般知识问答'));
assert.ok(mainSource.includes("PermissionPolicy.permissionHandling("));
assert.ok(mainSource.includes('PermissionPolicy.permissionGrantReusable(assessment)'));
assert.ok(mainSource.includes("handling === 'deny'"));
assert.ok(mainSource.indexOf('PermissionPolicy.permissionHandling(') < mainSource.indexOf('this.sessionPermissionGrants.get(grantKey.sessionId)'));
assert.ok(!mainSource.includes('automaticPermissionResponse(request, true)'));
assert.ok(mainSource.includes('除破坏性删除操作外，已允许的桌面操作无需再次请求审批'));

console.log('permission policy tests passed');
