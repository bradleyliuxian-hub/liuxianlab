'use strict';

const path = require('path');

const EXTENSION_KIND = new Map([
  ['.png', 'png'],
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
  ['.webp', 'webp']
]);

const MIME_KIND = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp']
]);

function detectKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function probePng(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function probeJpeg(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1;
      marker = buffer[offset + 1];
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0x00) break;
    if (offset + 4 > buffer.length) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isSof && offset + 9 <= buffer.length) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function probeWebp(buffer) {
  if (buffer.length < 30) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const fourcc = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (size < 0 || data + size > buffer.length) break;
    if (fourcc === 'VP8X' && size >= 10) {
      const width = 1 + buffer.readUIntLE(data + 4, 3);
      const height = 1 + buffer.readUIntLE(data + 7, 3);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === 'VP8 ' && size >= 10 && data + 10 <= buffer.length) {
      const chunk = buffer.subarray(data, data + 10);
      const startCode = chunk.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
      const base = startCode >= 0 ? data + startCode + 3 : data + 6;
      if (base + 4 <= buffer.length) {
        const width = buffer.readUInt16LE(base) & 0x3fff;
        const height = buffer.readUInt16LE(base + 2) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : null;
      }
    }
    if (fourcc === 'VP8L' && size >= 5 && buffer[data] === 0x2f) {
      const b1 = buffer[data + 1];
      const b2 = buffer[data + 2];
      const b3 = buffer[data + 3];
      const b4 = buffer[data + 4];
      const width = 1 + (((b2 & 0x3f) << 8) | b1);
      const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function probeImage(buffer) {
  const kind = detectKind(buffer);
  if (!kind) return { ok: false, code: 'INVALID_IMAGE_SIGNATURE', status: 400, message: '文件内容不是有效的 PNG/JPEG/WebP 图片。' };
  let dimensions = null;
  if (kind === 'png') dimensions = probePng(buffer);
  if (kind === 'jpeg') dimensions = probeJpeg(buffer);
  if (kind === 'webp') dimensions = probeWebp(buffer);
  if (!dimensions) {
    return { ok: false, code: 'IMAGE_DECODE_FAILED', status: 400, message: '图片无法解析或缺少有效尺寸。' };
  }
  return { ok: true, kind, width: dimensions.width, height: dimensions.height };
}

function validateUpload({ buffer, originalFilename, mimeType, maxPixels = 50_000_000 }) {
  const extension = path.extname(String(originalFilename || '')).toLowerCase();
  const extensionKind = EXTENSION_KIND.get(extension);
  const mimeKind = MIME_KIND.get(String(mimeType || '').toLowerCase());
  if (!extensionKind || !mimeKind) {
    return { ok: false, code: 'INVALID_FILE_TYPE', status: 400, message: '仅支持 PNG / JPG / JPEG / WebP 图片。' };
  }

  const probe = probeImage(buffer);
  if (!probe.ok) return probe;
  if (extensionKind !== probe.kind || mimeKind !== probe.kind) {
    return { ok: false, code: 'INVALID_FILE_TYPE', status: 400, message: '图片扩展名、MIME 与文件内容不一致。' };
  }
  if (probe.width * probe.height > maxPixels) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', status: 413, message: '图片像素数超过限制。' };
  }
  return { ...probe, kind: probe.kind };
}

module.exports = {
  detectKind,
  probeImage,
  validateUpload,
  EXTENSION_KIND,
  MIME_KIND
};
