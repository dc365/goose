'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PRODUCT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_APP_PATH = path.join(
  PRODUCT_ROOT,
  'dist',
  'MeteoMate-darwin-arm64',
  'MeteoMate.app',
);
const LOCAL_SIGNING_COMMON_NAME = 'MeteoMate Local Signing (com.meteomate.desktop)';
const DEFAULT_LOCAL_KEYCHAIN = path.join(
  os.homedir(),
  'Library',
  'Keychains',
  'meteomate-local-signing.keychain-db',
);
const DEFAULT_LOCAL_KEYCHAIN_PASSWORD = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'MeteoMate',
  'signing',
  'local-keychain-password',
);
const SOURCE_BROWSER_ROOT = path.join(PRODUCT_ROOT, 'runtime', 'browsers');
const SOURCE_OFFICE_ROOT = path.join(PRODUCT_ROOT, 'runtime', 'office');
const PACKAGED_BROWSER_RELATIVE_PATH = path.join(
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'runtime',
  'browsers',
);
const PACKAGED_OFFICE_RELATIVE_PATH = path.join(
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'runtime',
  'office',
);
const MACH_O_MAGICS = new Set([
  'cafebabe',
  'cafebabf',
  'cefaedfe',
  'cffaedfe',
  'feedface',
  'feedfacf',
]);

function execute(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw commandFailure(command, result);
  }
  return result;
}

function commandFailure(command, result) {
  const detail = String(result?.stderr || result?.stdout || '').trim();
  return new Error(`${path.basename(command)} 失败${detail ? `：${detail}` : ''}`);
}

function localSigningRequestSource(commonName = LOCAL_SIGNING_COMMON_NAME) {
  return [
    '[req]',
    'distinguished_name=dn',
    'x509_extensions=ext',
    'prompt=no',
    '[dn]',
    `CN=${commonName}`,
    '[ext]',
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature',
    'extendedKeyUsage=critical,codeSigning',
    '',
  ].join('\n');
}

function parseCodesigningIdentity(output, commonName = LOCAL_SIGNING_COMMON_NAME) {
  const matchingLine = String(output || '')
    .split(/\r?\n/)
    .find((line) => line.includes(`"${commonName}"`));
  return matchingLine?.match(/\b([a-f0-9]{40})\b/i)?.[1] || '';
}

function codesignRequirementIsStable(output) {
  const requirement = String(output || '');
  return requirement.includes('certificate leaf') && !requirement.includes('cdhash H"');
}

function managedKeychainPassword(passwordPath = DEFAULT_LOCAL_KEYCHAIN_PASSWORD) {
  if (fs.existsSync(passwordPath)) {
    return fs.readFileSync(passwordPath, 'utf8').trim();
  }
  fs.mkdirSync(path.dirname(passwordPath), { recursive: true, mode: 0o700 });
  const password = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(passwordPath, `${password}\n`, { mode: 0o600 });
  return password;
}

function userKeychains() {
  const result = execute('/usr/bin/security', ['list-keychains', '-d', 'user']);
  return [...String(result.stdout || '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function addKeychainToUserSearchList(keychain) {
  const current = userKeychains();
  if (current.includes(keychain)) return;
  execute('/usr/bin/security', [
    'list-keychains',
    '-d',
    'user',
    '-s',
    ...current,
    keychain,
  ]);
}

function keychainUnlockPasswordRejected(result) {
  if (!result || result.status === 0) return false;
  const detail = String(result.stderr || result.stdout || '');
  return /passphrase[^\n]*not correct/i.test(detail);
}

function keychainRecoveryTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function recreateManagedLocalKeychain({
  keychain,
  password,
  executeCommand = execute,
  timestamp = keychainRecoveryTimestamp(),
}) {
  let recoveredKeychain = `${keychain}.unusable-${timestamp}`;
  let suffix = 1;
  while (fs.existsSync(recoveredKeychain)) {
    recoveredKeychain = `${keychain}.unusable-${timestamp}-${suffix}`;
    suffix += 1;
  }
  fs.renameSync(keychain, recoveredKeychain);
  try {
    executeCommand('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
    executeCommand('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain]);
    executeCommand('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
  } catch (error) {
    fs.rmSync(keychain, { force: true });
    fs.renameSync(recoveredKeychain, keychain);
    throw new Error(`${error.message}；旧钥匙串已恢复`);
  }
  return recoveredKeychain;
}

function prepareLocalKeychain(env = process.env) {
  const configuredKeychain = String(env.METEOMATE_LOCAL_SIGNING_KEYCHAIN || '').trim();
  const keychain = path.resolve(configuredKeychain || DEFAULT_LOCAL_KEYCHAIN);
  const managed = !configuredKeychain;
  const configuredPassword = String(env.METEOMATE_LOCAL_SIGNING_KEYCHAIN_PASSWORD || '');
  const password = configuredPassword || (managed ? managedKeychainPassword() : '');
  const keychainExisted = fs.existsSync(keychain);
  let recoveredKeychain = '';

  if (!keychainExisted) {
    if (!password) {
      throw new Error('自定义签名钥匙串不存在，且未提供 METEOMATE_LOCAL_SIGNING_KEYCHAIN_PASSWORD');
    }
    execute('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
    execute('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain]);
  }
  if (password) {
    const unlock = execute(
      '/usr/bin/security',
      ['unlock-keychain', '-p', password, keychain],
      { allowFailure: true },
    );
    if (unlock.status !== 0) {
      const canRecover = managed
        && !configuredPassword
        && keychainExisted
        && keychainUnlockPasswordRejected(unlock);
      if (!canRecover) throw commandFailure('/usr/bin/security', unlock);
      recoveredKeychain = recreateManagedLocalKeychain({ keychain, password });
      console.warn(`MeteoMate 本地签名钥匙串密码已失配，旧钥匙串已归档到：${recoveredKeychain}`);
      console.warn('已创建新的本地签名身份；macOS 桌面权限可能需要重新授权一次。');
    }
  }
  addKeychainToUserSearchList(keychain);
  return { keychain, password, managed, recoveredKeychain };
}

function findLocalIdentity(keychain, commonName = LOCAL_SIGNING_COMMON_NAME) {
  const result = execute(
    '/usr/bin/security',
    ['find-identity', '-p', 'codesigning', keychain],
    { allowFailure: true },
  );
  return parseCodesigningIdentity(`${result.stdout || ''}\n${result.stderr || ''}`, commonName);
}

function findValidLocalIdentity(keychain, commonName = LOCAL_SIGNING_COMMON_NAME) {
  const result = execute(
    '/usr/bin/security',
    ['find-identity', '-v', '-p', 'codesigning', keychain],
    { allowFailure: true },
  );
  return parseCodesigningIdentity(`${result.stdout || ''}\n${result.stderr || ''}`, commonName);
}

function trustLocalCertificate(keychain, commonName = LOCAL_SIGNING_COMMON_NAME) {
  const exported = execute('/usr/bin/security', [
    'find-certificate',
    '-c',
    commonName,
    '-p',
    keychain,
  ]);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'meteomate-certificate-'),
  );
  const certificatePath = path.join(temporaryDirectory, 'certificate.pem');
  fs.writeFileSync(certificatePath, exported.stdout, { mode: 0o600 });
  try {
    execute('/usr/bin/security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-p',
      'codeSign',
      '-k',
      keychain,
      certificatePath,
    ]);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function ensureLocalSigningIdentity({
  env = process.env,
  commonName = LOCAL_SIGNING_COMMON_NAME,
} = {}) {
  const configuredIdentity = String(env.METEOMATE_CODESIGN_IDENTITY || '').trim();
  if (configuredIdentity) {
    return { identity: configuredIdentity, source: 'configured', created: false };
  }

  const { keychain, password } = prepareLocalKeychain(env);

  const existingIdentity = findLocalIdentity(keychain, commonName);
  if (existingIdentity) {
    if (!findValidLocalIdentity(keychain, commonName)) {
      trustLocalCertificate(keychain, commonName);
    }
    if (password) {
      execute('/usr/bin/security', [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:,codesign:',
        '-s',
        '-k',
        password,
        keychain,
      ]);
    }
    return {
      identity: existingIdentity,
      source: 'local-keychain',
      created: false,
      keychain,
    };
  }

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'meteomate-codesign-'),
  );
  const requestPath = path.join(temporaryDirectory, 'request.cnf');
  const keyPath = path.join(temporaryDirectory, 'key.pem');
  const certificatePath = path.join(temporaryDirectory, 'certificate.pem');
  const identityPath = path.join(temporaryDirectory, 'identity.p12');
  const pkcs12Password = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(requestPath, localSigningRequestSource(commonName), { mode: 0o600 });

  try {
    execute('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-days',
      '3650',
      '-nodes',
      '-config',
      requestPath,
    ]);
    const legacyExport = execute('openssl', [
      'pkcs12',
      '-export',
      '-legacy',
      '-inkey',
      keyPath,
      '-in',
      certificatePath,
      '-out',
      identityPath,
      '-passout',
      `pass:${pkcs12Password}`,
      '-name',
      commonName,
    ], { allowFailure: true });
    if (legacyExport.status !== 0) {
      execute('openssl', [
        'pkcs12',
        '-export',
        '-inkey',
        keyPath,
        '-in',
        certificatePath,
        '-out',
        identityPath,
        '-passout',
        `pass:${pkcs12Password}`,
        '-name',
        commonName,
      ]);
    }
    execute('/usr/bin/security', [
      'import',
      identityPath,
      '-k',
      keychain,
      '-P',
      pkcs12Password,
      '-A',
      '-T',
      '/usr/bin/codesign',
    ]);
    trustLocalCertificate(keychain, commonName);
    if (password) {
      execute('/usr/bin/security', [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:,codesign:',
        '-s',
        '-k',
        password,
        keychain,
      ]);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const identity = findLocalIdentity(keychain, commonName);
  if (!identity) throw new Error('MeteoMate 本地代码签名身份创建失败');
  return {
    identity,
    source: 'local-keychain',
    created: true,
    keychain,
  };
}

function runningProcessIds(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function isMachOFile(filePath) {
  try {
    const descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    try {
      if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
    } finally {
      fs.closeSync(descriptor);
    }
    return MACH_O_MAGICS.has(header.toString('hex'));
  } catch {
    return false;
  }
}

function skipNonCodeFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && !isMachOFile(filePath);
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function refreshPackagedOfficeManifests(appPath = DEFAULT_APP_PATH) {
  const officeRoot = path.join(
    path.resolve(appPath),
    PACKAGED_OFFICE_RELATIVE_PATH,
  );
  if (!fs.existsSync(officeRoot)) return 0;
  let refreshedFiles = 0;
  for (const entry of fs.readdirSync(officeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runtimeRoot = path.join(officeRoot, entry.name);
    const manifestPath = path.join(runtimeRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (
      manifest.schemaVersion !== 'meteomate.office-runtime/v1'
      || !Array.isArray(manifest.criticalFiles)
    ) {
      throw new Error(`Office Runtime manifest 格式无效：${manifestPath}`);
    }
    for (const criticalFile of manifest.criticalFiles) {
      const target = path.resolve(runtimeRoot, String(criticalFile.path || ''));
      const relative = path.relative(runtimeRoot, target);
      if (
        !relative
        || relative.startsWith('..')
        || path.isAbsolute(relative)
        || !fs.statSync(target).isFile()
      ) {
        throw new Error(`Office Runtime manifest 包含非法关键文件路径：${criticalFile.path}`);
      }
      criticalFile.sizeBytes = fs.statSync(target).size;
      criticalFile.sha256 = sha256File(target);
      refreshedFiles += 1;
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
  return refreshedFiles;
}

function repairPackagedRuntimeSymlinks(appPath, sourceRoot, packagedRelativePath) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const packagedRuntimeRoot = path.join(
    path.resolve(appPath),
    packagedRelativePath,
  );
  if (!fs.existsSync(resolvedSourceRoot) || !fs.existsSync(packagedRuntimeRoot)) return 0;

  let repaired = 0;
  const visit = (sourceDirectory) => {
    for (const entry of fs.readdirSync(sourceDirectory)) {
      const sourcePath = path.join(sourceDirectory, entry);
      const sourceStat = fs.lstatSync(sourcePath);
      if (sourceStat.isSymbolicLink()) {
        const packagedPath = path.join(
          packagedRuntimeRoot,
          path.relative(resolvedSourceRoot, sourcePath),
        );
        fs.rmSync(packagedPath, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(packagedPath), { recursive: true });
        fs.symlinkSync(fs.readlinkSync(sourcePath), packagedPath);
        repaired += 1;
      } else if (sourceStat.isDirectory()) {
        visit(sourcePath);
      }
    }
  };

  visit(resolvedSourceRoot);
  return repaired;
}

function repairPackagedBrowserSymlinks(
  appPath = DEFAULT_APP_PATH,
  sourceBrowserRoot = SOURCE_BROWSER_ROOT,
) {
  return repairPackagedRuntimeSymlinks(
    appPath,
    sourceBrowserRoot,
    PACKAGED_BROWSER_RELATIVE_PATH,
  );
}

function repairPackagedOfficeSymlinks(
  appPath = DEFAULT_APP_PATH,
  sourceOfficeRoot = SOURCE_OFFICE_ROOT,
) {
  return repairPackagedRuntimeSymlinks(
    appPath,
    sourceOfficeRoot,
    PACKAGED_OFFICE_RELATIVE_PATH,
  );
}

function assertAppNotRunning(appPath = DEFAULT_APP_PATH) {
  if (process.platform !== 'darwin') return;
  const executablePath = path.join(appPath, 'Contents', 'MacOS', 'MeteoMate');
  const result = execute('/usr/bin/pgrep', ['-f', executablePath], { allowFailure: true });
  const processIds = runningProcessIds(result.stdout);
  if (processIds.length) {
    throw new Error(`打包前请完全退出 MeteoMate（仍在运行：PID ${processIds.join('、')}）`);
  }
}

async function signApp(appPath = DEFAULT_APP_PATH, options = {}) {
  if (process.platform !== 'darwin') throw new Error('MeteoMate macOS 签名只能在 macOS 上执行');
  const resolvedAppPath = path.resolve(appPath);
  if (!fs.existsSync(resolvedAppPath)) throw new Error(`找不到待签名应用：${resolvedAppPath}`);

  const repairedSymlinks = repairPackagedBrowserSymlinks(resolvedAppPath);
  if (repairedSymlinks) {
    console.log(`Restored ${repairedSymlinks} packaged browser framework symlinks.`);
  }
  const repairedOfficeSymlinks = repairPackagedOfficeSymlinks(resolvedAppPath);
  if (repairedOfficeSymlinks) {
    console.log(`Restored ${repairedOfficeSymlinks} packaged Office Runtime symlinks.`);
  }
  const signing = ensureLocalSigningIdentity(options);
  const { sign } = await import('@electron/osx-sign');
  const localSigning = signing.source === 'local-keychain';
  const signOptions = {
    app: resolvedAppPath,
    identity: signing.identity,
    identityValidation: !localSigning,
    platform: 'darwin',
  };
  if (localSigning) {
    Object.assign(signOptions, {
      ignore: skipNonCodeFile,
      optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
    });
  }
  await sign(signOptions);
  const refreshedOfficeFiles = refreshPackagedOfficeManifests(resolvedAppPath);
  if (refreshedOfficeFiles) {
    await sign({
      ...signOptions,
      ignore: (filePath) => path.resolve(filePath) !== resolvedAppPath,
    });
    console.log(`Refreshed ${refreshedOfficeFiles} signed Office Runtime manifest entries.`);
  }
  verifyApp(resolvedAppPath);
  console.log(
    `MeteoMate signed with stable ${signing.source} identity${signing.created ? ' (created)' : ' (reused)'}.`,
  );
  return signing;
}

function verifyApp(appPath = DEFAULT_APP_PATH) {
  if (process.platform !== 'darwin') throw new Error('MeteoMate macOS 签名只能在 macOS 上验证');
  const resolvedAppPath = path.resolve(appPath);
  if (!fs.existsSync(resolvedAppPath)) throw new Error(`找不到待验证应用：${resolvedAppPath}`);
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', resolvedAppPath]);
  const requirementResult = execute(
    '/usr/bin/codesign',
    ['-d', '-r-', resolvedAppPath],
    { allowFailure: true },
  );
  const requirement = `${requirementResult.stdout || ''}\n${requirementResult.stderr || ''}`;
  if (!codesignRequirementIsStable(requirement)) {
    throw new Error('MeteoMate 签名仍未形成稳定的证书身份，已拒绝生成会丢失 TCC 权限的包');
  }
  console.log('MeteoMate stable certificate signature verified.');
  return requirement;
}

async function main(argv = process.argv.slice(2)) {
  const [command = '', appPath = DEFAULT_APP_PATH] = argv;
  if (command === 'assert-not-running') {
    assertAppNotRunning(appPath);
    return;
  }
  if (command === 'identity') {
    const signing = ensureLocalSigningIdentity();
    console.log(signing.identity);
    return;
  }
  if (command === 'sign') {
    await signApp(appPath);
    return;
  }
  if (command === 'verify') {
    verifyApp(appPath);
    return;
  }
  throw new Error('用法：node scripts/macos-signing.cjs <assert-not-running|identity|sign|verify> [MeteoMate.app]');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LOCAL_KEYCHAIN,
  DEFAULT_LOCAL_KEYCHAIN_PASSWORD,
  DEFAULT_APP_PATH,
  LOCAL_SIGNING_COMMON_NAME,
  assertAppNotRunning,
  codesignRequirementIsStable,
  ensureLocalSigningIdentity,
  localSigningRequestSource,
  isMachOFile,
  findValidLocalIdentity,
  keychainUnlockPasswordRejected,
  parseCodesigningIdentity,
  prepareLocalKeychain,
  recreateManagedLocalKeychain,
  refreshPackagedOfficeManifests,
  repairPackagedBrowserSymlinks,
  repairPackagedOfficeSymlinks,
  trustLocalCertificate,
  userKeychains,
  runningProcessIds,
  skipNonCodeFile,
  signApp,
  verifyApp,
};
