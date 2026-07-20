'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sanitizeProjectDirectoryName(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/:]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
    .trim();
  return normalized || '气象项目';
}

function defaultProjectWorkspaceRoot(documentsPath) {
  const documents = String(documentsPath || '').trim();
  if (!documents || !path.isAbsolute(documents)) throw new Error('MeteoMate 项目目录无效');
  return path.join(documents, 'MeteoMate', 'Projects');
}

async function createManagedProjectWorkspace({ root, name }) {
  const baseRoot = String(root || '').trim();
  if (!baseRoot || !path.isAbsolute(baseRoot)) throw new Error('MeteoMate 项目目录无效');
  await fs.promises.mkdir(baseRoot, { recursive: true });
  const directoryName = sanitizeProjectDirectoryName(name);

  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const candidateName = suffix === 1 ? directoryName : `${directoryName} ${suffix}`;
    const candidate = path.join(baseRoot, candidateName);
    try {
      await fs.promises.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('同名项目目录过多，请调整项目名称');
}

module.exports = {
  createManagedProjectWorkspace,
  defaultProjectWorkspaceRoot,
  sanitizeProjectDirectoryName,
};
