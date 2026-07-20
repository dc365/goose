const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ProjectWorkspace = require('../capabilities/project-workspace.cjs');

async function run() {
  assert.equal(ProjectWorkspace.sanitizeProjectDirectoryName(' 7·18/强降水:复盘 '), '7·18-强降水-复盘');
  assert.equal(ProjectWorkspace.sanitizeProjectDirectoryName('..'), '气象项目');
  assert.equal(
    ProjectWorkspace.defaultProjectWorkspaceRoot('/Users/test/Documents'),
    path.join('/Users/test/Documents', 'MeteoMate', 'Projects')
  );

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meteomate-project-workspace-'));
  try {
    const root = path.join(temporaryRoot, 'Projects');
    const first = await ProjectWorkspace.createManagedProjectWorkspace({ root, name: '福州下周天气' });
    const second = await ProjectWorkspace.createManagedProjectWorkspace({ root, name: '福州下周天气' });
    assert.equal(first, path.join(root, '福州下周天气'));
    assert.equal(second, path.join(root, '福州下周天气 2'));
    assert.equal((await fs.promises.stat(first)).isDirectory(), true);
    assert.equal((await fs.promises.stat(second)).isDirectory(), true);
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }

  console.log('MeteoMate project workspace tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
