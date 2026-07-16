'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxDepth: 24,
});

function normalizeEntryName(rawName, limits = DEFAULT_LIMITS) {
  if (!rawName || rawName.includes('\0')) throw new Error('ZIP entry has an invalid name');
  const normalized = rawName.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) {
    throw new Error(`ZIP entry uses an absolute path: ${rawName}`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length > limits.maxDepth) throw new Error(`ZIP entry is nested too deeply: ${rawName}`);
  if (parts.some((part) => part === '..')) throw new Error(`ZIP entry escapes the package root: ${rawName}`);
  const clean = parts.join('/');
  if (!clean && !normalized.endsWith('/')) throw new Error('ZIP entry has an empty path');
  return normalized.endsWith('/') && clean ? `${clean}/` : clean;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('ZIP end-of-central-directory record was not found');
}

function unixFileType(externalAttributes) {
  const mode = (externalAttributes >>> 16) & 0xffff;
  return mode & 0o170000;
}

function parseZipBuffer(buffer, inputLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...inputLimits };
  if (!Buffer.isBuffer(buffer)) throw new TypeError('ZIP input must be a Buffer');
  if (buffer.length > limits.maxArchiveBytes) throw new Error('ZIP archive exceeds the size limit');

  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || centralDisk !== 0) throw new Error('Multi-disk ZIP archives are not supported');
  if (entryCount > limits.maxEntries) throw new Error('ZIP archive contains too many files');
  if (centralOffset + centralSize > buffer.length) throw new Error('ZIP central directory is truncated');

  const entries = [];
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory entry is invalid');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > buffer.length) throw new Error('ZIP entry metadata is truncated');
    if (flags & 0x1) throw new Error('Encrypted ZIP entries are not supported');
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}`);
    if (uncompressedSize > limits.maxEntryBytes) throw new Error('A ZIP entry exceeds the per-file size limit');
    expandedBytes += uncompressedSize;
    if (expandedBytes > limits.maxExpandedBytes) throw new Error('ZIP archive exceeds the expanded size limit');

    const rawName = buffer.subarray(nameStart, nameEnd).toString('utf8');
    const name = normalizeEntryName(rawName, limits);
    const fileType = unixFileType(externalAttributes);
    if (fileType === 0o120000) throw new Error(`Symbolic links are not allowed in Skill ZIP files: ${name}`);
    const directory = name.endsWith('/');

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`ZIP local header is invalid for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`ZIP data is truncated for ${name}`);

    entries.push({
      name,
      directory,
      method,
      flags,
      crc32,
      compressedSize,
      uncompressedSize,
      dataOffset,
      dataEnd,
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return { entries, expandedBytes, archiveBytes: buffer.length };
}

function inflateEntry(buffer, entry) {
  if (entry.directory) return Buffer.alloc(0);
  const compressed = buffer.subarray(entry.dataOffset, entry.dataEnd);
  const output = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
  if (output.length !== entry.uncompressedSize) {
    throw new Error(`ZIP entry size mismatch for ${entry.name}`);
  }
  return output;
}

function assertInsideRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('ZIP extraction attempted to escape its destination');
  }
}

function extractZipFile(zipPath, destination, limits = {}) {
  const buffer = fs.readFileSync(zipPath);
  const parsed = parseZipBuffer(buffer, limits);
  fs.mkdirSync(destination, { recursive: true });
  const root = fs.realpathSync(destination);
  for (const entry of parsed.entries) {
    if (!entry.name) continue;
    const target = path.resolve(root, ...entry.name.replace(/\/$/, '').split('/'));
    assertInsideRoot(root, target);
    if (entry.directory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const output = inflateEntry(buffer, entry);
    fs.writeFileSync(target, output, { flag: 'wx', mode: 0o600 });
  }
  return parsed;
}

module.exports = {
  DEFAULT_LIMITS,
  normalizeEntryName,
  parseZipBuffer,
  extractZipFile,
};
