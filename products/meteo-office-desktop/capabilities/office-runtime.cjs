'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const OfficeConnector = require('./office-connector.js');

const MODULE_ROOT = path.resolve(__dirname, '..');
const REQUIRED_PYTHON_MODULES = Object.freeze([
  'docx',
  'pptx',
  'openpyxl',
  'xlsxwriter',
  'pypdf',
  'reportlab',
  'pypdfium2',
]);

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExecutable(filePath, platform = process.platform) {
  if (!isFile(filePath)) return false;
  if (platform === 'win32') return true;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function productRoots(productRoot) {
  const root = path.resolve(productRoot || MODULE_ROOT);
  const roots = root.endsWith('.asar') ? [`${root}.unpacked`, root] : [root];
  return [...new Set(roots)];
}

function executableName(platform, name) {
  return platform === 'win32' ? `${name}.exe` : name;
}

function findOnPath(name, env, platform) {
  const locator = platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [name], {
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
}

function prependPath(directory, currentPath) {
  return [...new Set([directory, ...String(currentPath || '').split(path.delimiter).filter(Boolean)])]
    .join(path.delimiter);
}

function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function verifyBundledManifest({ productRoot, platform, arch, python, soffice }) {
  const runtimeRoots = productRoots(productRoot)
    .map((root) => path.join(root, 'runtime', 'office', `${platform}-${arch}`));
  const runtimeRoot = runtimeRoots.find((root) => {
    const relative = path.relative(root, python.command);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!runtimeRoot) throw new Error('Office 运行时目录与当前平台不匹配');
  const manifestPath = path.join(runtimeRoot, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('Office 运行时 manifest 缺失或损坏');
  }
  if (
    manifest.schemaVersion !== 'meteomate.office-runtime/v1'
    || manifest.runtimeVersion !== OfficeConnector.RUNTIME_VERSION
    || manifest.platform !== platform
    || manifest.arch !== arch
    || !Array.isArray(manifest.criticalFiles)
  ) {
    throw new Error('Office 运行时 manifest 与当前产品或平台不匹配');
  }
  const required = new Set([path.resolve(python.command), ...(soffice ? [path.resolve(soffice.command)] : [])]);
  for (const entry of manifest.criticalFiles) {
    const target = path.resolve(runtimeRoot, String(entry.path || ''));
    const relative = path.relative(runtimeRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !isFile(target)) {
      throw new Error('Office 运行时 manifest 包含非法关键文件路径');
    }
    if (
      fs.statSync(target).size !== Number(entry.sizeBytes)
      || sha256File(target) !== String(entry.sha256 || '')
    ) {
      throw new Error(`Office 运行时关键文件校验失败：${entry.path}`);
    }
    required.delete(target);
  }
  if (required.size) throw new Error('Office 运行时 manifest 未覆盖全部关键入口');
  return manifest;
}

function nodeRuntime({ productRoot, env, execPath, versions, platform, arch, allowSystemFallback }) {
  const name = executableName(platform, 'node');
  if (String(productRoot).endsWith('.asar') && versions.electron && isExecutable(execPath, platform)) {
    return {
      command: execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      source: 'electron-node',
      version: versions.node ? `v${versions.node}` : 'unknown',
    };
  }
  for (const root of productRoots(productRoot)) {
    const candidates = [
      path.join(root, 'runtime', 'node', `${platform}-${arch}`, platform === 'win32' ? '' : 'bin', name),
      path.join(root, 'runtime', 'node', platform === 'win32' ? '' : 'bin', name),
    ];
    const command = candidates.find((candidate) => isExecutable(candidate, platform));
    if (command) {
      return {
        command,
        env: { PATH: prependPath(path.dirname(command), env.PATH) },
        source: 'bundled-node',
        version: String(spawnSync(command, ['--version'], { env, encoding: 'utf8' }).stdout || '').trim(),
      };
    }
  }

  if (env.METEOMATE_NODE_PATH) {
    const command = path.resolve(env.METEOMATE_NODE_PATH);
    if (!isExecutable(command, platform)) throw new Error(`指定的 Node.js 不可执行：${command}`);
    return {
      command,
      env: { PATH: prependPath(path.dirname(command), env.PATH) },
      source: 'developer-override',
      version: String(spawnSync(command, ['--version'], { env, encoding: 'utf8' }).stdout || '').trim(),
    };
  }

  if (versions.electron && isExecutable(execPath, platform)) {
    return {
      command: execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      source: 'electron-node',
      version: versions.node ? `v${versions.node}` : 'unknown',
    };
  }

  if (allowSystemFallback) {
    const command = findOnPath('node', env, platform);
    if (command && isExecutable(command, platform)) {
      return {
        command,
        env: { PATH: prependPath(path.dirname(command), env.PATH) },
        source: 'system-node',
        version: String(spawnSync(command, ['--version'], { env, encoding: 'utf8' }).stdout || '').trim(),
      };
    }
  }
  return null;
}

function pythonProbe(command, env) {
  const source = [
    'import importlib.metadata as metadata',
    `modules = ${JSON.stringify(REQUIRED_PYTHON_MODULES)}`,
    'for module in modules: __import__(module)',
    'packages = ["python-docx", "python-pptx", "openpyxl", "XlsxWriter", "pypdf", "reportlab", "pypdfium2"]',
    'print("|".join(metadata.version(package) for package in packages))',
  ].join('\n');
  const result = spawnSync(command, ['-c', source], {
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.status !== 0) return null;
  const versions = String(result.stdout || '').trim().split('|');
  return Object.fromEntries(['python-docx', 'python-pptx', 'openpyxl', 'XlsxWriter', 'pypdf', 'reportlab', 'pypdfium2']
    .map((name, index) => [name, versions[index] || 'unknown']));
}

function bundledPythonHome(command, platform) {
  const pythonRoot = path.dirname(path.dirname(command));
  if (platform === 'win32') {
    return isFile(path.join(pythonRoot, 'Lib', 'os.py')) ? pythonRoot : null;
  }
  const libRoot = path.join(pythonRoot, 'lib');
  try {
    const hasStandardLibrary = fs.readdirSync(libRoot, { withFileTypes: true })
      .some((entry) => entry.isDirectory()
        && /^python\d+\.\d+$/.test(entry.name)
        && isFile(path.join(libRoot, entry.name, 'os.py')));
    return hasStandardLibrary ? pythonRoot : null;
  } catch {
    return null;
  }
}

function pythonRuntime({ productRoot, env, platform, arch, allowSystemFallback, probePython }) {
  const name = platform === 'win32' ? 'python.exe' : 'python3';
  const runtimePython = (root) => path.join(
    root,
    platform === 'win32' ? 'Scripts' : 'bin',
    name,
  );
  const candidates = [];
  if (env.METEOMATE_PYTHON_PATH) {
    candidates.push({ command: path.resolve(env.METEOMATE_PYTHON_PATH), source: 'developer-override' });
  }
  for (const root of productRoots(productRoot)) {
    candidates.push(
      {
        command: runtimePython(path.join(root, 'runtime', 'office', `${platform}-${arch}`, 'python')),
        source: 'bundled-office-runtime',
      },
      {
        command: runtimePython(path.join(root, 'runtime', 'office', 'python')),
        source: 'bundled-office-runtime',
      },
    );
  }
  if (allowSystemFallback) {
    const command = findOnPath('python3', env, platform);
    if (command) candidates.push({ command, source: 'system-python' });
  }

  const probe = probePython || pythonProbe;
  for (const candidate of candidates) {
    if (!isExecutable(candidate.command, platform)) {
      if (candidate.source === 'developer-override') {
        throw new Error(`指定的 Office Python 不可执行：${candidate.command}`);
      }
      continue;
    }
    const pythonHome = candidate.source === 'bundled-office-runtime'
      ? bundledPythonHome(candidate.command, platform)
      : null;
    const runtimeEnv = {
      ...env,
      PATH: prependPath(path.dirname(candidate.command), env.PATH),
      ...(pythonHome ? { PYTHONHOME: pythonHome } : {}),
    };
    const packages = probe(candidate.command, runtimeEnv);
    if (!packages) {
      if (candidate.source === 'developer-override') {
        throw new Error('指定的 Office Python 缺少 python-docx、pypdf、reportlab 或 pypdfium2');
      }
      continue;
    }
    return { ...candidate, env: runtimeEnv, packages };
  }
  return null;
}

function officeEntry(productRoot, platform, arch) {
  const roots = productRoots(productRoot);
  const entryPath = roots
    .map((root) => path.join(root, 'services', 'office-mcp', 'src', 'server.mjs'))
    .find(isFile);
  const workerPath = [
    ...roots.map((root) => path.join(root, 'runtime', 'office', `${platform}-${arch}`, 'worker.py')),
    ...roots.map((root) => path.join(root, 'services', 'office-mcp', 'python', 'worker.py')),
  ].find(isFile);
  return entryPath && workerPath ? { entryPath, workerPath } : null;
}

function sofficeRuntime({ productRoot, env, platform, arch, allowSystemFallback }) {
  const candidates = [];
  if (env.METEOMATE_SOFFICE_PATH) {
    candidates.push({ command: path.resolve(env.METEOMATE_SOFFICE_PATH), source: 'developer-override' });
  }
  for (const root of productRoots(productRoot)) {
    const base = path.join(root, 'runtime', 'office', `${platform}-${arch}`, 'libreoffice');
    candidates.push(
      {
        command: platform === 'darwin'
          ? path.join(base, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
          : path.join(base, platform === 'win32' ? 'program' : 'program', executableName(platform, 'soffice')),
        source: 'bundled-office-runtime',
      },
    );
  }
  if (allowSystemFallback) {
    const command = findOnPath('soffice', env, platform);
    if (command) candidates.push({ command, source: 'system-libreoffice' });
    if (platform === 'darwin') {
      candidates.push({
        command: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        source: 'system-libreoffice',
      });
    }
  }
  const resolved = candidates.find((candidate) => isExecutable(candidate.command, platform));
  if (!resolved && env.METEOMATE_SOFFICE_PATH) {
    throw new Error(`指定的 LibreOffice 不可执行：${path.resolve(env.METEOMATE_SOFFICE_PATH)}`);
  }
  return resolved || null;
}

function resolveOfficeRuntime({
  productRoot = MODULE_ROOT,
  env = process.env,
  execPath = process.execPath,
  versions = process.versions,
  platform = process.platform,
  arch = process.arch,
  allowSystemFallback = true,
  probePython,
} = {}) {
  const entry = officeEntry(productRoot, platform, arch);
  if (!entry) throw new Error('Office 运行时不完整：缺少内置的 MCP Host 或 Python Worker');

  const node = nodeRuntime({
    productRoot,
    env,
    execPath,
    versions,
    platform,
    arch,
    allowSystemFallback,
  });
  if (!node) throw new Error('Office 运行时不完整：缺少可用的产品 Node.js');

  const python = pythonRuntime({
    productRoot,
    env,
    platform,
    arch,
    allowSystemFallback,
    probePython,
  });
  if (!python) {
    throw new Error('Office 运行时不完整：缺少已安装 Office 与 PDF 依赖的产品 Python');
  }
  const soffice = sofficeRuntime({ productRoot, env, platform, arch, allowSystemFallback });
  if (python.source === 'bundled-office-runtime') {
    verifyBundledManifest({ productRoot, platform, arch, python, soffice });
  }
  const runtimeEnv = {
    ...node.env,
    ...(python.env.PYTHONHOME ? { PYTHONHOME: python.env.PYTHONHOME } : {}),
    METEOMATE_OFFICE_PYTHON: python.command,
    METEOMATE_OFFICE_WORKER: entry.workerPath,
    METEOMATE_OFFICE_RUNTIME_VERSION: OfficeConnector.RUNTIME_VERSION,
  };
  if (soffice) runtimeEnv.METEOMATE_SOFFICE_PATH = soffice.command;
  return {
    command: node.command,
    argsPrefix: [entry.entryPath],
    env: runtimeEnv,
    info: {
      source: python.source === 'bundled-office-runtime'
        && (node.source.startsWith('bundled') || node.source === 'electron-node')
        ? 'bundled-office-runtime'
        : 'development-runtime',
      managed: python.source === 'bundled-office-runtime',
      runtimeVersion: OfficeConnector.RUNTIME_VERSION,
      nodeVersion: node.version,
      pythonSource: python.source,
      pythonPackages: python.packages,
      libreOfficeSource: soffice?.source || null,
      libreOfficeAvailable: Boolean(soffice),
    },
  };
}

module.exports = {
  REQUIRED_PYTHON_MODULES,
  resolveOfficeRuntime,
  productRoots,
  pythonProbe,
  verifyBundledManifest,
};
