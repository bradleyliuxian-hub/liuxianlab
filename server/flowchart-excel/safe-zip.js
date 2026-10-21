'use strict';

const zlib = require('zlib');

const DEFAULTS = {
  maxPackageBytes: 15 * 1024 * 1024,
  maxEntries: 12,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
  maxCompressionRatio: 200
};

const REQUIRED = new Set([
  'manifest.json',
  'flowchart.json',
  'nodes.csv',
  'edges.csv',
  'style.json',
  'conversion_report.md'
]);
const OPTIONAL = new Set(['review_overlay.png']);
const ALLOWED = new Set([...REQUIRED, ...OPTIONAL]);

function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function u16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) throw invalid('INVALID_ZIP', 'ZIP 结构越界。');
  return buffer.readUInt16LE(offset);
}

function u32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) throw invalid('INVALID_ZIP', 'ZIP 结构越界。');
  return buffer.readUInt32LE(offset);
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (u32(buffer, offset) === 0x06054b50) return offset;
  }
  throw invalid('INVALID_ZIP', '不是有效的 ZIP 文件。');
}

function decodeName(bytes) {
  try {
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!name || name.includes('\u0000')) throw new Error('invalid');
    return name;
  } catch (_error) {
    throw invalid('ZIP_INVALID_NAME', 'ZIP 文件名不是有效 UTF-8。');
  }
}

function validateEntryName(name) {
  if (!name || name.endsWith('/')) throw invalid('ZIP_DIRECTORY_ENTRY', 'ZIP 不允许目录条目。');
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    throw invalid('ZIP_ABSOLUTE_PATH', 'ZIP 包含绝对路径。');
  }
  if (name.includes('\\')) throw invalid('ZIP_PATH_TRAVERSAL', 'ZIP 包含反斜杠路径。');
  const parts = name.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    throw invalid('ZIP_PATH_TRAVERSAL', 'ZIP 包含路径穿越。');
  }
  if (name.toLowerCase().endsWith('.zip')) throw invalid('ZIP_NESTED_ZIP', 'ZIP 不允许嵌套 ZIP。');
  if (!ALLOWED.has(name)) throw invalid('ZIP_UNEXPECTED_FILE', `不允许的 ZIP 文件：${name}`);
}

function isSymlink(externalAttributes) {
  const mode = (externalAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

/**
 * Parse and extract a small, allow-listed helper ZIP in memory.
 * This does not use a general-purpose recursive unzip and rejects any
 * unexpected entry rather than silently ignoring it.
 */
function unzipSafe(buffer, options = {}) {
  const limits = { ...DEFAULTS, ...options };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw invalid('EMPTY_ZIP', 'ZIP 文件为空。');
  if (buffer.length > limits.maxPackageBytes) throw invalid('PACKAGE_TOO_LARGE', 'ZIP 超过大小限制。');

  const eocd = findEocd(buffer);
  const disk = u16(buffer, eocd + 4);
  const centralDisk = u16(buffer, eocd + 6);
  const entriesOnDisk = u16(buffer, eocd + 8);
  const entryCount = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw invalid('ZIP_MULTIDISK', '不支持多卷 ZIP。');
  }
  if (entryCount === 0 || entryCount > limits.maxEntries) throw invalid('ZIP_TOO_MANY_FILES', 'ZIP 条目数量超过限制。');
  if (centralOffset + centralSize > buffer.length) throw invalid('INVALID_ZIP', 'ZIP 中央目录越界。');

  const names = new Set();
  const files = new Map();
  const entries = [];
  let totalBytes = 0;
  let offset = centralOffset;
  let foundManifest = false;

  for (let i = 0; i < entryCount; i += 1) {
    if (u32(buffer, offset) !== 0x02014b50) throw invalid('INVALID_ZIP', 'ZIP 中央目录条目无效。');
    const flags = u16(buffer, offset + 8);
    const method = u16(buffer, offset + 10);
    const crc = u32(buffer, offset + 16);
    const compressedSize = u32(buffer, offset + 20);
    const uncompressedSize = u32(buffer, offset + 24);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const externalAttributes = u32(buffer, offset + 38);
    const localOffset = u32(buffer, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw invalid('INVALID_ZIP', 'ZIP 文件名越界。');
    const name = decodeName(buffer.subarray(nameStart, nameEnd));
    if (names.has(name.toLowerCase())) throw invalid('ZIP_DUPLICATE_NAME', `ZIP 重复文件名：${name}`);
    validateEntryName(name);
    names.add(name.toLowerCase());
    if (flags & 0x0001) throw invalid('ZIP_ENCRYPTED', '不支持加密 ZIP。');
    if (isSymlink(externalAttributes)) throw invalid('ZIP_SYMLINK', 'ZIP 不允许符号链接。');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw invalid('ZIP64_UNSUPPORTED', '不支持 ZIP64。');
    if (method !== 0 && method !== 8) throw invalid('ZIP_UNSUPPORTED_METHOD', '只支持 stored/deflate ZIP。');
    if (uncompressedSize > limits.maxEntryBytes) throw invalid('ZIP_ENTRY_TOO_LARGE', `ZIP 单文件过大：${name}`);
    totalBytes += uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) throw invalid('ZIP_TOTAL_TOO_LARGE', 'ZIP 解压总量超过限制。');
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      throw invalid('ZIP_COMPRESSION_RATIO', 'ZIP 压缩比异常。');
    }

    if (u32(buffer, localOffset) !== 0x04034b50) throw invalid('INVALID_ZIP', 'ZIP 本地文件头无效。');
    const localNameLength = u16(buffer, localOffset + 26);
    const localExtraLength = u16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw invalid('INVALID_ZIP', 'ZIP 数据越界。');
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    } catch (_error) {
      throw invalid('ZIP_DECOMPRESSION_FAILED', `ZIP 文件解压失败：${name}`);
    }
    if (data.length !== uncompressedSize) throw invalid('INVALID_ZIP', `ZIP 文件大小不一致：${name}`);
    if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== crc) {
      throw invalid('ZIP_CRC_MISMATCH', `ZIP CRC 校验失败：${name}`);
    }
    files.set(name, data);
    entries.push({ name, compressedSize, uncompressedSize, method });
    if (name === 'manifest.json') foundManifest = true;
    offset = nameEnd + extraLength + commentLength;
  }

  if (!foundManifest) throw invalid('MANIFEST_MISSING', 'ZIP 缺少 manifest.json。');
  for (const name of REQUIRED) {
    if (!files.has(name)) throw invalid('PACKAGE_FILE_MISSING', `ZIP 缺少必需文件：${name}`);
  }
  return { files, entries, totalUncompressedBytes: totalBytes };
}

module.exports = { unzipSafe, ALLOWED, REQUIRED, OPTIONAL, DEFAULTS };
