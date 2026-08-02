'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const productRoot = path.resolve(__dirname, '..');
const runtimeVersion = '1.3.0';
const runtimeRoot = path.join(productRoot, 'runtime', 'office', `${process.platform}-${process.arch}`);
const requirementsPath = path.join(productRoot, 'services', 'office-mcp', 'python', 'requirements.lock');
const workerSourcePath = path.join(productRoot, 'services', 'office-mcp', 'python', 'worker.py');
const notoCjkReleaseBase = 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004';
const cjkFontAssets = [
  {
    name: 'NotoSansCJKsc-Regular.otf',
    relativeUrl: 'Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
    sha256: '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
    envPath: 'METEOMATE_OFFICE_CJK_FONT_PATH',
    destination: 'font',
  },
  {
    name: 'LICENSE.Noto-CJK.txt',
    relativeUrl: 'LICENSE',
    sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2',
    envPath: 'METEOMATE_OFFICE_CJK_FONT_LICENSE_PATH',
    destination: 'license',
  },
];

function isExecutable(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [name], { encoding: 'utf8', shell: false, windowsHide: true });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: productRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} 执行失败（exit ${result.status}）${result.stderr ? `：${String(result.stderr).trim()}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, {
    cwd: productRoot,
    env: process.env,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  });
  return result.status === 0;
}

function sha256(filePath) {
  const digest = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(handle);
  }
  return digest.digest('hex');
}

function findPython() {
  const pythonHome = process.env.METEOMATE_PYTHON_HOME_PATH;
  const homeCandidate = pythonHome
    ? path.join(
        pythonHome,
        process.platform === 'win32' ? 'python.exe' : 'bin',
        process.platform === 'win32' ? '' : 'python3',
      )
    : null;
  const candidate = process.env.METEOMATE_PYTHON_PATH || homeCandidate || commandPath('python3');
  if (!candidate || !isExecutable(candidate)) {
    throw new Error('未找到用于构建 Office Runtime 的 Python 3');
  }
  return path.resolve(candidate);
}

function findPortablePythonHome(sourcePython) {
  const candidate = process.env.METEOMATE_PYTHON_HOME_PATH;
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const relativePython = path.relative(resolved, sourcePython);
  if (relativePython.startsWith('..') || path.isAbsolute(relativePython)) {
    throw new Error('METEOMATE_PYTHON_PATH 必须位于 METEOMATE_PYTHON_HOME_PATH 内');
  }
  return resolved;
}

function macOSLibreOfficeCommand(runtimeDirectory) {
  return path.join(
    runtimeDirectory,
    'libreoffice',
    'LibreOffice.app',
    'Contents',
    'MacOS',
    'soffice',
  );
}

function packagableLibreOfficeCommand(candidate, platform) {
  if (!candidate || !isExecutable(candidate)) return null;
  const resolved = fs.realpathSync(candidate);
  if (platform === 'darwin') {
    const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}soffice`;
    if (!resolved.endsWith(marker)) return null;
  }
  return resolved;
}

function pathsPointToSameLocation(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function normalizeBundleSymlinks(bundleRoot) {
  const contentsMarker = `${path.sep}Contents${path.sep}`;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      const target = fs.readlinkSync(entryPath);
      if (!path.isAbsolute(target)) {
        if (!fs.existsSync(entryPath)) {
          throw new Error(`LibreOffice.app 包含损坏的符号链接：${entryPath} -> ${target}`);
        }
        continue;
      }
      const contentsIndex = target.lastIndexOf(contentsMarker);
      const relativeToContents = contentsIndex >= 0
        ? target.slice(contentsIndex + contentsMarker.length)
        : '';
      const relocatedTarget = relativeToContents
        ? path.join(bundleRoot, 'Contents', relativeToContents)
        : '';
      if (!relocatedTarget || !fs.existsSync(relocatedTarget)) {
        throw new Error(`LibreOffice.app 包含无法重定位的绝对符号链接：${entryPath} -> ${target}`);
      }
      fs.unlinkSync(entryPath);
      fs.symlinkSync(path.relative(path.dirname(entryPath), relocatedTarget), entryPath);
    }
  };
  visit(bundleRoot);
}

function findLibreOffice({
  env = process.env,
  platform = process.platform,
  runtimeDirectory = runtimeRoot,
  commandLookup = commandPath,
} = {}) {
  const candidates = [
    env.METEOMATE_LIBREOFFICE_APP_PATH && platform === 'darwin'
      ? path.join(env.METEOMATE_LIBREOFFICE_APP_PATH, 'Contents', 'MacOS', 'soffice')
      : null,
    env.METEOMATE_SOFFICE_PATH,
    platform === 'darwin' ? macOSLibreOfficeCommand(runtimeDirectory) : null,
    platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : null,
    platform === 'darwin' ? '/Applications/LibreOfficeDev.app/Contents/MacOS/soffice' : null,
    commandLookup('soffice'),
  ].filter(Boolean);
  const command = candidates
    .map((candidate) => packagableLibreOfficeCommand(candidate, platform))
    .find(Boolean);
  if (!command) {
    throw new Error(
      '未找到可打包的 LibreOffice；请安装 LibreOffice，或通过 '
      + 'METEOMATE_LIBREOFFICE_APP_PATH / METEOMATE_SOFFICE_PATH 指定 LibreOffice.app 内的 soffice',
    );
  }
  return command;
}

function copyLibreOffice(
  sourceCommand,
  { runtimeDirectory = runtimeRoot, platform = process.platform } = {},
) {
  const destination = path.join(runtimeDirectory, 'libreoffice');
  if (platform === 'darwin') {
    const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}soffice`;
    if (!sourceCommand.endsWith(marker)) throw new Error('macOS soffice 必须位于 LibreOffice.app 内');
    const appRoot = sourceCommand.slice(0, -marker.length);
    const target = path.join(destination, 'LibreOffice.app');
    if (pathsPointToSameLocation(appRoot, target)) {
      normalizeBundleSymlinks(target);
      return sourceCommand;
    }
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    fs.cpSync(appRoot, target, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    normalizeBundleSymlinks(target);
    return path.join(target, 'Contents', 'MacOS', 'soffice');
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const programRoot = path.dirname(sourceCommand);
  const target = path.join(destination, 'program');
  fs.cpSync(programRoot, target, { recursive: true, preserveTimestamps: true });
  return path.join(target, path.basename(sourceCommand));
}

function libreOfficeFontDirectories(
  sofficeCommand,
  platform = process.platform,
) {
  if (platform === 'darwin') {
    const contents = path.dirname(path.dirname(sofficeCommand));
    const resources = path.join(contents, 'Resources');
    return {
      fonts: path.join(resources, 'fonts', 'truetype'),
      licenses: path.join(resources, 'fonts'),
    };
  }
  const installationRoot = path.resolve(path.dirname(sofficeCommand), '..');
  return {
    fonts: path.join(installationRoot, 'share', 'fonts', 'truetype'),
    licenses: path.join(installationRoot, 'share', 'fonts'),
  };
}

function downloadRuntimeAsset(asset, {
  env = process.env,
  cacheDirectory = path.join(os.tmpdir(), 'meteomate-runtime-downloads'),
  releaseBase = notoCjkReleaseBase,
} = {}) {
  const providedPath = String(env[asset.envPath] || '').trim();
  if (providedPath) {
    const source = path.resolve(providedPath);
    if (!fs.statSync(source).isFile()) throw new Error(`${asset.envPath} 必须指向文件`);
    const digest = sha256(source);
    if (digest !== asset.sha256) {
      throw new Error(`${asset.name} 完整性校验失败：期望 ${asset.sha256}，实际 ${digest}`);
    }
    return source;
  }

  fs.mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
  const cached = path.join(cacheDirectory, asset.name);
  if (fs.existsSync(cached) && sha256(cached) !== asset.sha256) {
    fs.rmSync(cached, { force: true });
  }
  if (!fs.existsSync(cached)) {
    const base = String(env.METEOMATE_OFFICE_FONT_DOWNLOAD_BASE_URL || releaseBase).replace(/\/+$/, '');
    const url = `${base}/${asset.relativeUrl}`;
    run('curl', [
      '--location',
      '--fail',
      '--show-error',
      '--retry',
      '3',
      '--connect-timeout',
      '20',
      '--max-time',
      '900',
      '--user-agent',
      'MeteoMate Runtime Builder',
      '--output',
      cached,
      '--url',
      url,
    ]);
  }
  const digest = sha256(cached);
  if (digest !== asset.sha256) {
    fs.rmSync(cached, { force: true });
    throw new Error(`${asset.name} 完整性校验失败：期望 ${asset.sha256}，实际 ${digest}`);
  }
  return cached;
}

function installCjkFont(
  sofficeCommand,
  {
    platform = process.platform,
    env = process.env,
    cacheDirectory,
    assets = cjkFontAssets,
  } = {},
) {
  const directories = libreOfficeFontDirectories(sofficeCommand, platform);
  fs.mkdirSync(directories.fonts, { recursive: true, mode: 0o700 });
  fs.mkdirSync(directories.licenses, { recursive: true, mode: 0o700 });
  return assets.map((asset) => {
    const source = downloadRuntimeAsset(asset, { env, cacheDirectory });
    const directory = asset.destination === 'font' ? directories.fonts : directories.licenses;
    const target = path.join(directory, asset.name);
    fs.copyFileSync(source, target);
    return target;
  });
}

function normalizePortableSymlinks(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      normalizePortableSymlinks(entryPath);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    const target = fs.readlinkSync(entryPath);
    if (!path.isAbsolute(target)) {
      if (!fs.existsSync(entryPath)) {
        throw new Error(`便携 Python 包含损坏的符号链接：${entryPath} -> ${target}`);
      }
      continue;
    }
    const siblingTarget = path.join(path.dirname(entryPath), path.basename(target));
    if (!fs.existsSync(siblingTarget)) {
      throw new Error(`便携 Python 包含无法重定位的绝对符号链接：${entryPath} -> ${target}`);
    }
    fs.unlinkSync(entryPath);
    fs.symlinkSync(path.basename(siblingTarget), entryPath);
  }
}

function prepareOfficeRuntime() {
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const sourcePython = findPython();
  const portablePythonHome = findPortablePythonHome(sourcePython);
  const pythonRoot = path.join(runtimeRoot, 'python');
  const pythonCommand = path.join(
    pythonRoot,
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python3',
  );
  if (portablePythonHome) {
    fs.rmSync(pythonRoot, { recursive: true, force: true });
    fs.cpSync(portablePythonHome, pythonRoot, { recursive: true, preserveTimestamps: true });
  } else if (isExecutable(pythonCommand) && !commandSucceeds(pythonCommand, ['-m', 'pip', '--version'])) {
    fs.rmSync(pythonRoot, { recursive: true, force: true });
  }
  if (!isExecutable(pythonCommand)) {
    try {
      run(sourcePython, ['-m', 'venv', '--copies', pythonRoot]);
    } catch (error) {
      fs.rmSync(pythonRoot, { recursive: true, force: true });
      throw new Error(
        `${error.message}\n发布构建请通过 METEOMATE_PYTHON_HOME_PATH 提供完整、可搬迁的 Python 运行时。`,
      );
    }
  }
  normalizePortableSymlinks(pythonRoot);
  const pythonEnv = portablePythonHome
    ? { ...process.env, PYTHONHOME: pythonRoot }
    : process.env;
  run(pythonCommand, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--requirement',
    requirementsPath,
  ], { env: pythonEnv });

  const packageSource = [
    'import importlib.metadata as metadata',
    'names = ["python-docx", "python-pptx", "openpyxl", "XlsxWriter", "pypdf", "pdfplumber", "reportlab", "pypdfium2", "Pillow", "lxml", "defusedxml"]',
    'import json',
    'print(json.dumps({name: metadata.version(name) for name in names}))',
  ].join('\n');
  const packages = JSON.parse(run(pythonCommand, ['-c', packageSource], {
    capture: true,
    env: pythonEnv,
  }));
  const bundledSoffice = copyLibreOffice(findLibreOffice());
  const bundledCjkFontFiles = installCjkFont(bundledSoffice);
  const workerPath = path.join(runtimeRoot, 'worker.py');
  fs.copyFileSync(workerSourcePath, workerPath);
  fs.chmodSync(workerPath, 0o600);
  const manifestPath = path.join(runtimeRoot, 'manifest.json');
  const manifest = {
    schemaVersion: 'meteomate.office-runtime/v1',
    runtimeVersion,
    platform: process.platform,
    arch: process.arch,
    createdAt: new Date().toISOString(),
    pythonProvisioning: portablePythonHome ? 'portable-home' : 'venv-copies',
    packages,
    criticalFiles: [
      path.relative(runtimeRoot, pythonCommand),
      path.relative(runtimeRoot, bundledSoffice),
      ...bundledCjkFontFiles.map((filePath) => path.relative(runtimeRoot, filePath)),
      path.relative(runtimeRoot, workerPath),
    ].map((relativePath) => ({
      path: relativePath.split(path.sep).join('/'),
      sizeBytes: fs.statSync(path.join(runtimeRoot, relativePath)).size,
      sha256: sha256(path.join(runtimeRoot, relativePath)),
    })),
    requirements: {
      path: path.relative(productRoot, requirementsPath).split(path.sep).join('/'),
      sha256: sha256(requirementsPath),
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`MeteoMate Office Runtime ${runtimeVersion} prepared at ${runtimeRoot}.`);
}

if (require.main === module) prepareOfficeRuntime();

module.exports = {
  cjkFontAssets,
  copyLibreOffice,
  downloadRuntimeAsset,
  findLibreOffice,
  installCjkFont,
  libreOfficeFontDirectories,
  normalizeBundleSymlinks,
  normalizePortableSymlinks,
  prepareOfficeRuntime,
};
