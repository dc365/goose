'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractZipFile } = require('./safe-zip.cjs');

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxTotalBytes: 128 * 1024 * 1024,
  maxSingleFileBytes: 32 * 1024 * 1024,
  maxDepth: 24,
});

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv',
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh',
  '.ps1', '.bat', '.cmd', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.sql',
]);
const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.py', '.js', '.cjs', '.mjs', '.ts', '.rb', '.php']);
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll', '.dylib', '.so', '.app', '.msi', '.pkg', '.deb', '.rpm']);
const DANGEROUS_PATTERNS = [
  { level: 'critical', pattern: /\b(?:sudo|doas)\b/i, label: '提权命令' },
  { level: 'critical', pattern: /rm\s+-rf\s+(?:\/|~|\$HOME)/i, label: '高风险递归删除' },
  { level: 'critical', pattern: /(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)/i, label: '下载并直接执行脚本' },
  { level: 'high', pattern: /\b(?:child_process|os\.system|subprocess\.(?:run|Popen|call)|Invoke-Expression|Start-Process)\b/i, label: '执行外部命令' },
  { level: 'high', pattern: /\b(?:curl|wget|fetch\(|axios\.|requests\.|http\.request|https\.request)\b/i, label: '访问网络' },
  { level: 'high', pattern: /(?:\.ssh|id_rsa|id_ed25519|keychain|credential|password|api[_-]?key|secret)/i, label: '可能访问凭据' },
];

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseFrontmatter(source) {
  const normalized = String(source || '').replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new Error('SKILL.md 缺少 YAML Frontmatter');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('SKILL.md Frontmatter 未闭合');
  const metadata = {};
  let section = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const nested = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && section) {
      metadata[section] = metadata[section] || {};
      metadata[section][nested[1]] = stripQuotes(nested[2]);
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    section = match[1];
    metadata[section] = stripQuotes(match[2]);
  }
  return { metadata, body: lines.slice(end + 1).join('\n') };
}

function parseMeteoMateSidecar(root) {
  const candidates = ['meteomate.json', 'meteomate.yaml', 'meteomate.yml'];
  for (const name of candidates) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, 'utf8');
    if (name.endsWith('.json')) {
      try {
        return { file: name, data: JSON.parse(source), source };
      } catch (error) {
        throw new Error(`meteomate.json 不是有效 JSON：${error.message}`);
      }
    }
    const data = {};
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s{0,4}([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
      if (match && !Object.prototype.hasOwnProperty.call(data, match[1])) data[match[1]] = stripQuotes(match[2]);
    }
    return { file: name, data, source };
  }
  return null;
}

function findSkillRoot(inputPath) {
  const stat = fs.lstatSync(inputPath);
  if (stat.isSymbolicLink()) throw new Error('Skill 来源不能是符号链接');
  if (stat.isFile()) {
    if (path.basename(inputPath).toLowerCase() !== 'skill.md') throw new Error('单文件导入只支持 SKILL.md');
    return path.dirname(inputPath);
  }
  if (!stat.isDirectory()) throw new Error('Skill 来源必须是目录、SKILL.md 或 ZIP');
  if (fs.existsSync(path.join(inputPath, 'SKILL.md'))) return inputPath;
  const candidates = fs
    .readdirSync(inputPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(inputPath, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, 'SKILL.md')));
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error('未找到 SKILL.md；ZIP 或目录必须包含一个 Skill 根目录');
  throw new Error('检测到多个 Skill，请分别导入或使用 Plugin/套件格式');
}

function relativeUnix(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function walkFiles(root, inputLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...inputLimits };
  const files = [];
  let totalBytes = 0;
  function visit(directory, depth) {
    if (depth > limits.maxDepth) throw new Error('Skill 目录层级过深');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`Skill 中不允许符号链接：${relativeUnix(root, fullPath)}`);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Skill 中包含不支持的文件类型：${relativeUnix(root, fullPath)}`);
      if (stat.size > limits.maxSingleFileBytes) throw new Error(`文件过大：${relativeUnix(root, fullPath)}`);
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalBytes) throw new Error('Skill 解压后的总大小超过限制');
      files.push({ fullPath, relativePath: relativeUnix(root, fullPath), size: stat.size, mode: stat.mode });
      if (files.length > limits.maxFiles) throw new Error('Skill 文件数量超过限制');
    }
  }
  visit(root, 0);
  return { files, totalBytes };
}

function riskRank(level) {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level] ?? 0;
}

function inspectRoot(root, options = {}) {
  const skillFile = path.join(root, 'SKILL.md');
  if (!fs.existsSync(skillFile)) throw new Error('Skill 根目录缺少 SKILL.md');
  const { metadata, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  const name = String(metadata.name || '').trim();
  const description = String(metadata.description || '').trim();
  if (!name) throw new Error('SKILL.md Frontmatter 缺少 name');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error('Skill name 只能包含小写字母、数字和连字符，且不超过 64 个字符');
  }
  if (!description || description.length > 1024) throw new Error('Skill description 必填且不能超过 1024 个字符');

  const sidecar = parseMeteoMateSidecar(root);
  const { files, totalBytes } = walkFiles(root, options.limits);
  const warnings = [];
  const findings = [];
  let riskLevel = 'low';
  let hasScripts = false;
  let hasHooks = false;
  let network = false;
  let shell = false;

  const fileRecords = files.map((file) => {
    const extension = path.extname(file.relativePath).toLowerCase();
    const executable = EXECUTABLE_EXTENSIONS.has(extension) || Boolean(file.mode & 0o111);
    if (EXECUTABLE_EXTENSIONS.has(extension)) {
      findings.push({ level: 'critical', file: file.relativePath, message: '包含本机可执行或动态库文件' });
      riskLevel = 'critical';
    }
    if (SCRIPT_EXTENSIONS.has(extension) || executable) {
      hasScripts = true;
      shell = true;
      if (riskRank(riskLevel) < riskRank('medium')) riskLevel = 'medium';
    }
    if (/^(?:hooks\/|.*\/hooks\/)/i.test(file.relativePath)) {
      hasHooks = true;
      if (riskRank(riskLevel) < riskRank('high')) riskLevel = 'high';
      findings.push({ level: 'high', file: file.relativePath, message: '包含生命周期 Hook' });
    }
    let buffer = fs.readFileSync(file.fullPath);
    const hash = sha256(buffer);
    if (TEXT_EXTENSIONS.has(extension) && buffer.length <= 1024 * 1024) {
      const text = buffer.toString('utf8');
      for (const rule of DANGEROUS_PATTERNS) {
        if (!rule.pattern.test(text)) continue;
        findings.push({ level: rule.level, file: file.relativePath, message: rule.label });
        if (rule.label === '访问网络') network = true;
        if (rule.label.includes('命令') || rule.label.includes('执行')) shell = true;
        if (riskRank(rule.level) > riskRank(riskLevel)) riskLevel = rule.level;
      }
    }
    buffer = null;
    return { path: file.relativePath, size: file.size, sha256: hash, executable };
  });

  const folderName = path.basename(root);
  if (folderName !== name) warnings.push(`Skill 目录名“${folderName}”与 name“${name}”不同，安装时将使用标准名称。`);
  if (!body.trim()) warnings.push('SKILL.md 只有 Frontmatter，没有正文说明。');
  if (!/\b(?:验证|检查|verify|validation|test)\b/i.test(body)) warnings.push('建议在 Skill 中增加可验证的完成标准。');

  const version = String(
    sidecar?.data?.version || sidecar?.data?.metadata?.version || metadata.metadata?.version || metadata.version || '0.1.0'
  );
  const manifestDigest = sha256(
    JSON.stringify(fileRecords.map((file) => [file.path, file.sha256]).sort((left, right) => left[0].localeCompare(right[0])))
  );
  const report = {
    apiVersion: 'meteomate.ai/v1',
    kind: 'SkillInspection',
    skill: {
      id: name,
      name,
      displayName: sidecar?.data?.displayName || sidecar?.data?.name || name,
      description,
      version,
      license: metadata.license || null,
      compatibility: metadata.compatibility || sidecar?.data?.compatibility || null,
      metadata: typeof metadata.metadata === 'object' ? metadata.metadata : {},
    },
    root,
    files: fileRecords,
    totalBytes,
    integrity: manifestDigest,
    risk: {
      level: riskLevel,
      findings,
      permissions: {
        filesystemRead: true,
        filesystemWrite: Boolean(sidecar?.source?.match(/\bwrite\b/i)),
        shell,
        network,
        hooks: hasHooks,
      },
    },
    warnings,
    sidecar: sidecar ? { file: sidecar.file, data: sidecar.data } : null,
    autoInstallEligible: riskLevel === 'low' && !hasScripts && !hasHooks && !network && !shell,
  };
  report.reportHash = sha256(JSON.stringify({ ...report, root: undefined, reportHash: undefined }));
  return report;
}

function prepareSource(sourcePath, tempParent = os.tmpdir(), options = {}) {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) throw new Error('所选 Skill 来源不存在');
  let tempDir = null;
  let inputPath = resolved;
  if (fs.lstatSync(resolved).isFile() && path.extname(resolved).toLowerCase() === '.zip') {
    tempDir = fs.mkdtempSync(path.join(tempParent, 'meteomate-skill-'));
    extractZipFile(resolved, tempDir, options.zipLimits);
    inputPath = tempDir;
  }
  const root = findSkillRoot(inputPath);
  const report = inspectRoot(root, options);
  return { sourcePath: resolved, root, tempDir, report };
}

function assertDestinationRoot(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('安装目标超出允许目录');
  }
}

function copyDirectorySafe(source, destination) {
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(destination, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) throw new Error(`不允许复制符号链接：${entry.name}`);
    if (entry.isDirectory()) {
      copyDirectorySafe(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(targetPath, stat.mode & 0o777);
    } else {
      throw new Error(`不支持的 Skill 文件类型：${entry.name}`);
    }
  }
}

function installPreparedSkill(preparedRoot, targetBase, skillName, { replace = false } = {}) {
  const base = path.resolve(targetBase);
  fs.mkdirSync(base, { recursive: true });
  const target = path.join(base, skillName);
  assertDestinationRoot(base, target);
  const staging = path.join(base, `.meteomate-install-${skillName}-${crypto.randomUUID()}`);
  const backup = path.join(base, `.meteomate-backup-${skillName}-${crypto.randomUUID()}`);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  copyDirectorySafe(preparedRoot, staging);
  let movedExisting = false;
  try {
    if (fs.existsSync(target)) {
      if (!replace) throw new Error(`Skill “${skillName}”已经存在，请选择替换安装`);
      fs.renameSync(target, backup);
      movedExisting = true;
    }
    fs.renameSync(staging, target);
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
    return target;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (movedExisting && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

module.exports = {
  DEFAULT_LIMITS,
  parseFrontmatter,
  findSkillRoot,
  inspectRoot,
  prepareSource,
  installPreparedSkill,
  assertDestinationRoot,
  sha256,
};
