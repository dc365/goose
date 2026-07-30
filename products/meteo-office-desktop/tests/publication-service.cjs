const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const gateStub = {
  runPublicationGate({ analysis, artifacts, evidence, humanSignoff, allowSynthetic }) {
    const blockers = [];
    if (!analysis?.conclusions?.length) blockers.push('缺少预报结论');
    if (!artifacts?.length) blockers.push('缺少可交付成果物');
    if (!evidence?.length) blockers.push('缺少证据');
    if (evidence?.some((item) => item?.metadata?.synthetic) && !allowSynthetic) blockers.push('构造数据不能签发');
    if (!humanSignoff?.approved) blockers.push('缺少预报员或业务人员签发');
    return { ready: blockers.length === 0, status: blockers.length ? 'draft' : 'ready', blockers, warnings: [] };
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith('publication-service.cjs') && request === '../harness/validation-engine') return gateStub;
  return originalLoad.call(this, request, parent, isMain);
};
const { createPublicationService } = require('../capabilities/publication-service.cjs');
Module._load = originalLoad;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-'));
const handlers = new Map();
const profileContext = {
  currentPaths: () => ({ root }),
  isAuthenticated: () => false,
  publicState: () => ({ cachedUser: null }),
};
const service = createPublicationService({
  ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
  profileContext,
  securityMode: 'internal',
});
service.registerIpc();
assert.equal(handlers.size, 3);
const input = {
  taskId: 'task-1',
  analysis: { conclusions: [{ text: '暴雨风险', evidenceIds: ['e1'] }] },
  artifacts: [{ id: 'a1' }],
  evidence: [{ id: 'e1' }],
  note: '已复核',
  reviewerName: '本机值班员',
};
const signed = service.sign(input);
assert.equal(signed.gate.ready, true);
assert.equal(signed.signoff.verification, 'local-profile');
assert.equal(signed.signoff.reviewerName, '本机值班员');
assert.equal(service.check(input).signoff.approved, true);
assert.throws(
  () => service.sign({ ...input, taskId: 'task-synthetic', allowSynthetic: true, evidence: [{ id: 'e-demo', metadata: { synthetic: true } }] }),
  /构造数据不能签发/,
);
const changed = { ...input, artifacts: [{ id: 'a2' }] };
assert.equal(service.check(changed).gate.ready, false);
assert.ok(service.check(changed).gate.blockers.some((item) => item.includes('已经变化')));
const changedAnalysis = {
  ...input,
  analysis: { conclusions: [{ text: '已经篡改的结论', evidenceIds: ['e1'] }] },
};
assert.equal(service.check(changedAnalysis).gate.ready, false);
assert.ok(service.check(changedAnalysis).gate.blockers.some((item) => item.includes('已经变化')));

const artifactPath = path.join(root, 'signed-artifact.txt');
fs.writeFileSync(artifactPath, 'original artifact');
const fileBackedInput = {
  ...input,
  taskId: 'task-file-backed',
  artifacts: [{ id: 'a-file', path: artifactPath }],
};
service.sign(fileBackedInput);
fs.writeFileSync(artifactPath, 'modified artifact');
assert.equal(service.check(fileBackedInput).gate.ready, false);
assert.ok(service.check(fileBackedInput).gate.blockers.some((item) => item.includes('已经变化')));
assert.equal(service.revoke({ taskId: 'task-1' }).revoked, true);

const strictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext,
  securityMode: 'strict',
});
assert.throws(() => strictService.sign({ ...input, taskId: 'strict-task' }), /在线登录/);

const viewerProfileContext = {
  currentPaths: () => ({ root }),
  isAuthenticated: () => true,
  publicState: () => ({ user: { id: 'viewer-1', displayName: '只读用户', role: 'viewer' } }),
};
const viewerStrictService = createPublicationService({
  ipcMain: { handle() {} },
  profileContext: viewerProfileContext,
  securityMode: 'strict',
});
assert.throws(() => viewerStrictService.sign({ ...input, taskId: 'viewer-task' }), /发布权限/);

fs.rmSync(root, { recursive: true, force: true });
console.log('publication service intranet-mode tests passed');
