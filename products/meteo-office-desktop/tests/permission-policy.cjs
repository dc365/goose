const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PermissionPolicy = require('../capabilities/permission-policy.cjs');
const BrowserConnector = require('../capabilities/browser-connector.js');

const workspace = '/Users/test/Documents/MeteoMate/Claw/session';

const tree = PermissionPolicy.classifyPermissionRequest(
  {
    toolCall: {
      title: 'tree',
      kind: 'other',
      rawInput: { path: workspace, depth: 2 },
    },
  },
  { workspace }
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
  { workspace }
);
assert.equal(outsideTree.outsideWorkspace, true);
assert.equal(outsideTree.requiresSmartApproval, true);
assert.equal(PermissionPolicy.permissionHandling('artifact-approval', outsideTree), 'prompt');

const safeShell = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'shell', kind: 'other', rawInput: { command: 'pwd' } } },
  { workspace }
);
assert.equal(safeShell.kind, 'execute');
assert.equal(safeShell.requiresSmartApproval, false);

const destructiveShell = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'shell', kind: 'other', rawInput: { command: 'rm -rf output' } } },
  { workspace }
);
assert.equal(destructiveShell.requiresSmartApproval, true);

const unknownTool = PermissionPolicy.classifyPermissionRequest(
  { toolCall: { title: 'custom action', kind: 'other', rawInput: {} } },
  { workspace }
);
assert.equal(unknownTool.requiresSmartApproval, true);

const trustedHttpContext = {
  workspace,
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
  connectors: [{
    id: BrowserConnector.ID,
    connectorType: 'browser',
    transport: 'stdio',
    riskClassification: 'medium',
    verified: true,
    explicitToolSelection: true,
    selectedTools: [...BrowserConnector.SAFE_TOOLS],
    tools: [...BrowserConnector.SAFE_TOOLS, ...BrowserConnector.BLOCKED_TOOLS]
      .map((name) => ({ name, description: name })),
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

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
assert.ok(mainSource.includes('对于问候、寒暄、能力介绍、一般知识问答'));
assert.ok(mainSource.includes("PermissionPolicy.permissionHandling("));
assert.ok(mainSource.includes("handling === 'deny'"));

console.log('permission policy tests passed');
