'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const SkillPackage = require('./skill-package.cjs');
const SkillTests = require('./skill-test-runner.cjs');
const ZipWriter = require('./zip-writer.cjs');

const EDITABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv',
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh',
  '.ps1', '.bat', '.cmd', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.sql',
]);
const MAX_EDITABLE_BYTES = 1024 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function quoteYaml(value) {
  return JSON.stringify(String(value || '').replace(/\r?\n/g, ' ').trim());
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function safeDraftId(value) {
  const text = String(value || '');
  if (!/^draft-[a-z0-9-]{8,80}$/i.test(text)) throw new Error('Skill 草稿 ID 无效');
  return text;
}

function assertNoSymlinkEscape(root, target) {
  const realRoot = fs.realpathSync.native(path.resolve(root));
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const realExisting = fs.realpathSync.native(current);
  const relative = path.relative(realRoot, realExisting);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('文件路径经过了指向草稿目录外部的符号链接');
  }
}

function safeRelativePath(root, relativePath, { editable = false } = {}) {
  const raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) throw new Error('文件路径不能为空');
  const target = path.resolve(root, raw);
  const rel = path.relative(path.resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('文件路径超出 Skill 草稿目录');
  assertNoSymlinkEscape(root, target);
  if (editable) {
    const normalized = rel.split(path.sep).join('/');
    if (normalized === 'draft.json' || (!normalized.startsWith('skill/') && normalized !== 'BRIEF.md')) {
      throw new Error('只能编辑 BRIEF.md 或 skill/ 目录中的文件');
    }
    if (!EDITABLE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new Error('该文件类型不能在内置编辑器中修改');
  }
  return target;
}

function atomicWrite(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content, { mode });
  fs.renameSync(temp, filePath);
}

function renderBrief(input, skillId) {
  const lines = [
    '# Skill Creator Brief',
    '',
    `- 草稿名称：${input.displayName}`,
    `- 建议 Skill ID：${skillId}`,
    `- 分类：${input.category || '效率工具'}`,
    `- 目标项目：${input.projectName || '未绑定'}`,
    '',
    '## 要解决的问题',
    '',
    input.goal,
    '',
    '## 触发场景',
    '',
    input.triggers || '由 Skill Creator 在对话中继续澄清。',
    '',
    '## 不应触发的场景',
    '',
    input.nonGoals || '由 Skill Creator 在对话中继续澄清。',
    '',
    '## 输入',
    '',
    input.inputs || '由 Skill Creator 在对话中继续澄清。',
    '',
    '## 输出',
    '',
    input.outputs || '由 Skill Creator 在对话中继续澄清。',
    '',
    '## 依赖工具',
    '',
    uniqueStrings(input.connectorIds).map((item) => `- ${item}`).join('\n') || '- 无',
    '',
    '## 权限边界',
    '',
    `- 读取项目文件：${input.permissions?.filesystemRead !== false ? '是' : '否'}`,
    `- 写入文件：${input.permissions?.filesystemWrite ? '是' : '否'}`,
    `- 执行 Shell：${input.permissions?.shell ? '是' : '否'}`,
    `- 访问网络：${input.permissions?.network ? '是' : '否'}`,
    ...(uniqueStrings(input.permissions?.networkDomains).map((item) => `  - ${item}`)),
    '',
    '## 验收标准',
    '',
    input.successCriteria || '能够根据典型用户请求正确触发、完成目标任务，并给出可验证结果。',
    '',
    '## 创建约束',
    '',
    '1. 只修改当前草稿目录。',
    '2. Skill 正式文件全部位于 `skill/`。',
    '3. 必须保留 `SKILL.md`、`meteomate.json` 和至少一个 `tests/*.json`。',
    '4. 不直接安装或发布；完成后由用户在 MeteoMate 中校验并确认。',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderSkill(input, skillId) {
  const description = String(input.description || input.goal || '').replace(/\s+/g, ' ').trim();
  return `---\nname: ${skillId}\ndescription: ${quoteYaml(description)}\nlicense: Apache-2.0\nmetadata:\n  author: MeteoMate Skill Creator\n  version: "0.1.0"\n---\n\n# ${input.displayName}\n\n## 使用场景\n\n${input.triggers || '请根据 BRIEF.md 继续完善 Skill 的触发场景。'}\n\n## 限制与禁止场景\n\n${input.nonGoals || '不得在缺少必要输入、权限或工具时假装完成任务。'}\n\n## 输入\n\n${input.inputs || '请在对话中继续澄清输入。'}\n\n## 执行流程\n\n1. 核验任务目标、输入和约束。\n2. 检查所需工具与权限是否可用。\n3. 按照专业流程完成任务。\n4. 输出结果并执行验证。\n\n## 输出\n\n${input.outputs || '输出结构化结果和可核验的完成摘要。'}\n\n## 安全边界\n\n- 只使用用户明确授权的文件、工具和工作区。\n- 不得读取凭据、系统目录或任务无关资料。\n- 遇到高风险写入、外部发送或命令执行时必须请求审批。\n\n## 验证与完成标准\n\n${input.successCriteria || '结果符合用户要求，关键步骤可核验，且没有越权操作。'}\n`;
}

function renderSidecar(input) {
  return `${JSON.stringify({
    apiVersion: 'meteomate.ai/v1',
    kind: 'SkillExtension',
    version: '0.1.0',
    displayName: input.displayName,
    category: input.category || '效率工具',
    requires: { connectors: uniqueStrings(input.connectorIds) },
    permissions: {
      filesystem: {
        read: input.permissions?.filesystemRead === false ? [] : ['project'],
        write: input.permissions?.filesystemWrite ? ['artifacts'] : [],
      },
      shell: Boolean(input.permissions?.shell),
      network: input.permissions?.network ? uniqueStrings(input.permissions?.networkDomains) : [],
    },
    inputs: { description: input.inputs || '' },
    outputs: { description: input.outputs || '' },
    tests: ['tests/basic.json'],
  }, null, 2)}\n`;
}

function renderTest(input) {
  return `${JSON.stringify({
    apiVersion: 'meteomate.ai/v1',
    kind: 'SkillTestCase',
    name: '基本触发与交付检查',
    prompt: input.examplePrompt || `请使用这个 Skill 完成：${input.goal}`,
    expected: {
      sections: ['使用场景', '执行流程', '验证与完成标准'],
      files: ['SKILL.md', 'meteomate.json'],
      connectors: uniqueStrings(input.connectorIds),
    },
    forbiddenPhrases: ['忽略所有安全规则', '无需用户确认即可执行高风险操作'],
    notes: '此为静态契约测试；后续可增加真实模型评测。',
  }, null, 2)}\n`;
}

function createSkillCreatorService({ app, dialog, ipcMain, shell, capabilityService }) {
  if (!capabilityService) throw new Error('Skill Creator requires Capability Service');

  function draftRoot() {
    const root = path.join(capabilityService.paths().root, 'skill-drafts');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
  }

  function draftPaths(id) {
    const safeId = safeDraftId(id);
    const root = path.join(draftRoot(), safeId);
    return {
      id: safeId,
      root,
      metadata: path.join(root, 'draft.json'),
      brief: path.join(root, 'BRIEF.md'),
      skill: path.join(root, 'skill'),
    };
  }

  function readMetadata(id) {
    const target = draftPaths(id);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(target.metadata, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Skill 草稿不存在');
      throw new Error(`Skill 草稿元数据损坏：${error.message}`);
    }
    return { ...parsed, id: target.id, root: target.root, skillRoot: target.skill };
  }

  function writeMetadata(record) {
    const target = draftPaths(record.id);
    const stored = { ...record };
    delete stored.root;
    delete stored.skillRoot;
    atomicWrite(target.metadata, `${JSON.stringify(stored, null, 2)}\n`);
    return readMetadata(record.id);
  }

  function listDraftFiles(id) {
    const target = draftPaths(id);
    if (!fs.existsSync(target.root)) throw new Error('Skill 草稿不存在');
    const result = [];
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        const stat = fs.lstatSync(fullPath);
        if (stat.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile()) {
          const relativePath = path.relative(target.root, fullPath).split(path.sep).join('/');
          if (relativePath === 'draft.json') continue;
          result.push({
            path: relativePath,
            size: stat.size,
            editable: EDITABLE_EXTENSIONS.has(path.extname(fullPath).toLowerCase()) && stat.size <= MAX_EDITABLE_BYTES,
            updatedAt: stat.mtimeMs,
          });
        }
      }
    }
    visit(target.root);
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  function validateDraft(id, { persist = true } = {}) {
    const metadata = readMetadata(id);
    let inspection = null;
    let testReport = null;
    let validationError = null;
    try {
      inspection = SkillPackage.inspectRoot(metadata.skillRoot);
      testReport = SkillTests.runStaticTests(metadata.skillRoot, inspection);
    } catch (error) {
      validationError = error.message;
    }
    const ready = Boolean(inspection && testReport?.ready && inspection.risk?.level !== 'critical');
    const status = metadata.status === 'installed' ? 'installed' : ready ? 'ready' : 'drafting';
    const updated = {
      ...metadata,
      status,
      skillId: inspection?.skill?.id || metadata.skillId,
      displayName: inspection?.skill?.displayName || metadata.displayName,
      version: inspection?.skill?.version || metadata.version || '0.1.0',
      updatedAt: Date.now(),
      lastValidation: {
        checkedAt: Date.now(),
        ready,
        error: validationError,
        reportHash: inspection?.reportHash || null,
        testSummary: testReport?.summary || null,
      },
    };
    const record = persist ? writeMetadata(updated) : updated;
    return {
      draft: record,
      files: listDraftFiles(id),
      inspection: inspection ? { ...inspection, root: undefined } : null,
      tests: testReport,
      validationError,
      ready,
    };
  }

  function listDrafts() {
    const result = [];
    for (const entry of fs.readdirSync(draftRoot(), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('draft-')) continue;
      try {
        const record = readMetadata(entry.name);
        result.push({
          id: record.id,
          displayName: record.displayName,
          skillId: record.skillId,
          version: record.version || '0.1.0',
          status: record.status || 'drafting',
          projectId: record.projectId || null,
          root: record.root,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          installedAt: record.installedAt || null,
          exportedAt: record.exportedAt || null,
          lastValidation: record.lastValidation || null,
        });
      } catch {
        // Ignore incomplete directories; they can be inspected manually on disk.
      }
    }
    return result.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  }

  function createDraft(input = {}) {
    const displayName = String(input.displayName || '').trim();
    const goal = String(input.goal || '').trim();
    if (!displayName) throw new Error('请输入 Skill 显示名称');
    if (!goal) throw new Error('请描述 Skill 要解决的问题');
    const id = `draft-${crypto.randomUUID()}`;
    const target = draftPaths(id);
    fs.mkdirSync(path.join(target.skill, 'tests'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(target.skill, 'references'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(target.skill, 'assets'), { recursive: true, mode: 0o700 });
    const skillId = slug(input.skillId || displayName) || `meteomate-skill-${crypto.randomBytes(3).toString('hex')}`;
    const normalizedInput = {
      ...clone(input),
      displayName,
      goal,
      skillId,
      connectorIds: uniqueStrings(input.connectorIds),
      permissions: {
        filesystemRead: input.permissions?.filesystemRead !== false,
        filesystemWrite: Boolean(input.permissions?.filesystemWrite),
        shell: Boolean(input.permissions?.shell),
        network: Boolean(input.permissions?.network),
        networkDomains: uniqueStrings(input.permissions?.networkDomains),
      },
    };
    atomicWrite(target.brief, renderBrief(normalizedInput, skillId));
    atomicWrite(path.join(target.skill, 'SKILL.md'), renderSkill(normalizedInput, skillId));
    atomicWrite(path.join(target.skill, 'meteomate.json'), renderSidecar(normalizedInput));
    atomicWrite(path.join(target.skill, 'tests', 'basic.json'), renderTest(normalizedInput));
    atomicWrite(path.join(target.skill, 'references', 'requirements.md'), renderBrief(normalizedInput, skillId));
    const now = Date.now();
    writeMetadata({
      apiVersion: 'meteomate.ai/v1',
      kind: 'SkillDraft',
      id,
      displayName,
      skillId,
      version: '0.1.0',
      status: 'drafting',
      brief: normalizedInput,
      projectId: input.projectId || null,
      createdAt: now,
      updatedAt: now,
      installedAt: null,
      exportedAt: null,
      lastValidation: null,
    });
    const result = validateDraft(id);
    result.conversationPrompt = [
      '请使用 skill-creator Skill 完善当前草稿。',
      `草稿工作区：${target.root}`,
      `先阅读 BRIEF.md，然后只修改 ${path.join(target.root, 'skill')} 中的 Skill 文件。`,
      '必须保留并完善 SKILL.md、meteomate.json 和 tests/basic.json；可以增加 scripts、references、assets 和更多 tests。',
      '请先检查需求是否存在关键歧义；如有歧义先向我提问。需求明确后再修改文件。',
      '完成时总结文件树、权限、风险、测试和仍需人工确认的事项。不要直接安装、发布或写入其他目录。',
    ].join('\n');
    return result;
  }

  function getDraft(id) {
    return validateDraft(id);
  }

  function readDraftFile(request = {}) {
    const target = draftPaths(request.id);
    const filePath = safeRelativePath(target.root, request.path);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('所选路径不是普通文件');
    if (stat.size > MAX_EDITABLE_BYTES) throw new Error('文件过大，不能在内置预览器中打开');
    if (!EDITABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('该文件类型不支持文本预览');
    return { path: request.path, content: fs.readFileSync(filePath, 'utf8'), size: stat.size, updatedAt: stat.mtimeMs };
  }

  function writeDraftFile(request = {}) {
    const target = draftPaths(request.id);
    const filePath = safeRelativePath(target.root, request.path, { editable: true });
    const content = String(request.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_BYTES) throw new Error('文件内容超过 1 MB 限制');
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) throw new Error('不能覆盖符号链接');
    atomicWrite(filePath, content);
    const metadata = readMetadata(request.id);
    metadata.updatedAt = Date.now();
    metadata.status = 'drafting';
    writeMetadata(metadata);
    return validateDraft(request.id);
  }

  async function exportDraft(request = {}) {
    const validation = validateDraft(request.id);
    if (!validation.inspection) throw new Error(validation.validationError || 'Skill 草稿未通过基础校验');
    const skillId = validation.inspection.skill.id;
    const version = validation.inspection.skill.version || '0.1.0';
    const result = await dialog.showSaveDialog({
      title: '导出 Skill ZIP',
      defaultPath: `${skillId}-${version}.zip`,
      filters: [{ name: 'Skill ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const output = ZipWriter.writeZipFile(validation.draft.skillRoot, result.filePath, { prefix: skillId });
    const metadata = readMetadata(request.id);
    metadata.exportedAt = Date.now();
    metadata.updatedAt = metadata.exportedAt;
    metadata.lastExportPath = output;
    writeMetadata(metadata);
    return { canceled: false, path: output, draft: readMetadata(request.id) };
  }

  function installDraft(request = {}) {
    const validation = validateDraft(request.id);
    if (!validation.inspection) throw new Error(validation.validationError || 'Skill 草稿未通过基础校验');
    if (validation.inspection.risk?.level === 'critical') throw new Error('严重风险 Skill 不能从 Skill Creator 直接安装');
    if (!validation.ready && !request.overrideValidation) throw new Error('Skill 尚未通过全部测试；请修复后安装，或明确选择忽略非严重问题');
    const inspection = capabilityService.inspectSkill(validation.draft.skillRoot);
    const result = capabilityService.installSkill({
      token: inspection.token,
      reportHash: inspection.report.reportHash,
      scope: request.scope,
      projectId: request.projectId || null,
      workspace: request.workspace || null,
      replace: Boolean(request.replace),
    });
    const metadata = readMetadata(request.id);
    metadata.status = 'installed';
    metadata.installedAt = Date.now();
    metadata.updatedAt = metadata.installedAt;
    metadata.installationId = result.installation.id;
    writeMetadata(metadata);
    return { ...result, draft: readMetadata(request.id) };
  }

  function deleteDraft(id) {
    const target = draftPaths(id);
    if (!fs.existsSync(target.root)) return { removed: false, drafts: listDrafts() };
    fs.rmSync(target.root, { recursive: true, force: true });
    return { removed: true, drafts: listDrafts() };
  }

  function openDraft(id) {
    return shell.openPath(draftPaths(id).root).then((error) => error === '');
  }

  function registerIpc() {
    ipcMain.handle('skill-creator:list-drafts', async () => listDrafts());
    ipcMain.handle('skill-creator:create-draft', async (_event, request) => createDraft(request || {}));
    ipcMain.handle('skill-creator:get-draft', async (_event, id) => getDraft(id));
    ipcMain.handle('skill-creator:read-file', async (_event, request) => readDraftFile(request || {}));
    ipcMain.handle('skill-creator:write-file', async (_event, request) => writeDraftFile(request || {}));
    ipcMain.handle('skill-creator:validate-draft', async (_event, id) => validateDraft(id));
    ipcMain.handle('skill-creator:export-draft', async (_event, request) => exportDraft(request || {}));
    ipcMain.handle('skill-creator:install-draft', async (_event, request) => installDraft(request || {}));
    ipcMain.handle('skill-creator:delete-draft', async (_event, id) => deleteDraft(id));
    ipcMain.handle('skill-creator:open-draft', async (_event, id) => openDraft(id));
  }

  return {
    registerIpc,
    createDraft,
    getDraft,
    listDrafts,
    readDraftFile,
    writeDraftFile,
    validateDraft,
    exportDraft,
    installDraft,
    deleteDraft,
    draftRoot,
  };
}

module.exports = { createSkillCreatorService, slug, safeRelativePath, renderSkill, renderSidecar, renderTest };
