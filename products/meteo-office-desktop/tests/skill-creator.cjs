'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SkillPackage = require('../capabilities/skill-package.cjs');
const { extractZipFile } = require('../capabilities/safe-zip.cjs');
const { createSkillCreatorService, safeRelativePath } = require('../capabilities/skill-creator-service.cjs');

const productRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(productRoot, 'index.html'), 'utf8');
const preloadSource = fs.readFileSync(path.join(productRoot, 'preload.cjs'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(productRoot, 'capabilities', 'main-wrapper.cjs'), 'utf8');
const creatorUiSource = fs.readFileSync(path.join(productRoot, 'capability-center', 'skill-creator.js'), 'utf8');
assert.ok(indexSource.includes('styles-skill-creator.css'));
assert.ok(indexSource.includes('capability-center/skill-creator.js'));
assert.ok(preloadSource.includes('createSkillDraft'));
assert.ok(preloadSource.includes('installSkillDraft'));
assert.ok(wrapperSource.includes('createSkillCreatorService'));
assert.ok(creatorUiSource.includes('创建草稿并开始对话'));
assert.ok(creatorUiSource.includes('草稿工作台'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-skill-creator-test-'));
const userData = path.join(temp, 'user-data');
const home = path.join(temp, 'home');
const exportPath = path.join(temp, 'exports', 'skill.zip');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(home, { recursive: true });

const pending = new Map();
const installations = [];
const capabilityRoot = path.join(userData, 'capabilities');
const capabilityService = {
  paths() {
    fs.mkdirSync(capabilityRoot, { recursive: true });
    return { root: capabilityRoot };
  },
  inspectSkill(sourcePath) {
    const report = SkillPackage.inspectRoot(sourcePath);
    const token = `token-${pending.size + 1}`;
    pending.set(token, { root: sourcePath, report });
    return { token, report: { ...report, root: undefined } };
  },
  installSkill(request) {
    const prepared = pending.get(request.token);
    assert.ok(prepared, 'inspection token must exist');
    const base = request.scope === 'project'
      ? path.join(request.workspace, '.agents', 'skills')
      : path.join(home, '.agents', 'skills');
    const target = SkillPackage.installPreparedSkill(prepared.root, base, prepared.report.skill.id, {
      replace: Boolean(request.replace),
    });
    const installation = {
      id: `${request.scope || 'user'}:${request.projectId || 'user'}:${prepared.report.skill.id}`,
      skillId: prepared.report.skill.id,
      version: prepared.report.skill.version,
      scope: request.scope || 'user',
      projectId: request.projectId || null,
      projectIds: request.projectId ? [request.projectId] : [],
      installPath: target,
      enabled: true,
    };
    installations.push(installation);
    return { installation, registry: { skills: [...installations], connectors: [], bundledSkills: [] } };
  },
};

const handlers = new Map();
const service = createSkillCreatorService({
  app: { getPath: () => userData },
  dialog: { showSaveDialog: async () => ({ canceled: false, filePath: exportPath }) },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  shell: { openPath: async () => '' },
  capabilityService,
});
service.registerIpc();
assert.ok(handlers.has('skill-creator:create-draft'));
assert.ok(handlers.has('skill-creator:install-draft'));

const created = service.createDraft({
  displayName: '气象过程复盘',
  skillId: 'weather-event-review',
  description: '当用户要求复盘一次天气过程、比较预报与实况并生成可核验总结时使用。',
  category: '气象业务',
  goal: '复盘一次天气过程，比较预报、实况、算法证据和主要偏差。',
  triggers: '用户要求复盘暴雨、强对流或台风过程时。',
  nonGoals: '缺少实况资料时不得给出确定性评分。',
  inputs: '模式预报、实况、雷达、站点统计和业务结论。',
  outputs: '过程复盘报告、偏差清单和改进建议。',
  successCriteria: '结论引用证据，明确预报命中与偏差，报告包含改进建议。',
  examplePrompt: '复盘 7 月 15 日华南暴雨过程并生成报告。',
  connectorIds: ['weather-data', 'weather-diagnosis'],
  permissions: { filesystemRead: true, filesystemWrite: true, network: false, shell: false },
});
assert.equal(created.draft.skillId, 'weather-event-review');
assert.equal(created.ready, true);
assert.ok(fs.existsSync(path.join(created.draft.skillRoot, 'SKILL.md')));
assert.ok(fs.existsSync(path.join(created.draft.skillRoot, 'tests', 'basic.json')));
assert.ok(created.conversationPrompt.includes(created.draft.root));
assert.equal(service.listDrafts().length, 1);

const skillFile = service.readDraftFile({ id: created.draft.id, path: 'skill/SKILL.md' });
assert.ok(skillFile.content.includes('## 执行流程'));
const updated = service.writeDraftFile({
  id: created.draft.id,
  path: 'skill/SKILL.md',
  content: `${skillFile.content}\n\n## 补充说明\n\n所有结论都要注明数据时次。\n`,
});
assert.equal(updated.ready, true);
assert.throws(
  () => safeRelativePath(created.draft.root, '../outside.txt', { editable: true }),
  /超出/
);
assert.throws(
  () => service.writeDraftFile({ id: created.draft.id, path: 'draft.json', content: '{}' }),
  /只能编辑/
);

(async () => {
  const exported = await service.exportDraft({ id: created.draft.id });
  assert.equal(exported.canceled, false);
  assert.ok(fs.existsSync(exportPath));
  const extracted = path.join(temp, 'extracted');
  extractZipFile(exportPath, extracted);
  assert.ok(fs.existsSync(path.join(extracted, 'weather-event-review', 'SKILL.md')));

  const installed = service.installDraft({ id: created.draft.id, scope: 'user', replace: false });
  assert.equal(installed.installation.skillId, 'weather-event-review');
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'weather-event-review', 'SKILL.md')));
  assert.equal(service.getDraft(created.draft.id).draft.status, 'installed');

  const removed = service.deleteDraft(created.draft.id);
  assert.equal(removed.removed, true);
  assert.equal(service.listDrafts().length, 0);

  fs.rmSync(temp, { recursive: true, force: true });
  console.log('MeteoMate Skill Creator tests passed.');
})().catch((error) => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
