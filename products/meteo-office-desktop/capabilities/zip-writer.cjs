'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
    }
    table[value] = current >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day = ((year - 1980) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { time, date: day };
}

function safePrefix(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ZIP 顶层目录名称无效');
  }
  return normalized;
}

function collectFiles(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.statSync(resolvedRoot).isDirectory()) throw new Error('ZIP 来源必须是目录');
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`导出 ZIP 时不允许符号链接：${entry.name}`);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push({
          fullPath,
          relativePath: path.relative(resolvedRoot, fullPath).split(path.sep).join('/'),
          stat,
        });
      } else {
        throw new Error(`导出 ZIP 时遇到不支持的文件类型：${entry.name}`);
      }
    }
  }

  visit(resolvedRoot);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function localHeader({ nameBuffer, data, crc, modified }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(modified.time, 10);
  header.writeUInt16LE(modified.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader({ nameBuffer, data, crc, modified, offset, mode }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(modified.time, 12);
  header.writeUInt16LE(modified.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((((mode || 0o644) & 0xffff) << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endRecord({ entries, centralSize, centralOffset }) {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(entries, 8);
  buffer.writeUInt16LE(entries, 10);
  buffer.writeUInt32LE(centralSize, 12);
  buffer.writeUInt32LE(centralOffset, 16);
  buffer.writeUInt16LE(0, 20);
  return buffer;
}

function createZipBuffer(root, { prefix = path.basename(path.resolve(root)) } = {}) {
  const folder = safePrefix(prefix);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of collectFiles(root)) {
    const data = fs.readFileSync(file.fullPath);
    const nameBuffer = Buffer.from(`${folder}/${file.relativePath}`, 'utf8');
    const crc = crc32(data);
    const modified = dosDateTime(file.stat.mtime);
    const local = localHeader({ nameBuffer, data, crc, modified });
    const central = centralHeader({
      nameBuffer,
      data,
      crc,
      modified,
      offset,
      mode: file.stat.mode,
    });
    localParts.push(local, nameBuffer, data);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, item) => total + item.length, 0);
  return Buffer.concat([
    ...localParts,
    ...centralParts,
    endRecord({ entries: centralParts.length / 2, centralSize, centralOffset }),
  ]);
}

function writeZipFile(root, destination, options = {}) {
  const target = path.resolve(destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, createZipBuffer(root, options), { mode: 0o600 });
  fs.renameSync(temp, target);
  return target;
}

module.exports = { crc32, createZipBuffer, writeZipFile, collectFiles };
