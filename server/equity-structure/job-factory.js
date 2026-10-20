'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class JobCreationError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'JobCreationError';
    this.code = code;
    this.status = status;
  }
}

function imageKind(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function createDraftJobFromBuffer({
  repository,
  root,
  storageRoot,
  ownerUsername,
  originalFilename,
  extension,
  mimeType,
  buffer
}) {
  if (!ownerUsername) throw new JobCreationError('UNAUTHENTICATED', '请先登录。', 401);
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    throw new JobCreationError('INVALID_FILE_TYPE', '仅支持 PNG / JPG / WebP 图片。', 400);
  }
  const kind = imageKind(buffer);
  if (!kind) {
    throw new JobCreationError('INVALID_IMAGE', '文件内容不是有效的 PNG / JPG / WebP 图片。', 400);
  }

  const id = crypto.randomUUID();
  const dir = path.join(storageRoot, id);
  const sourceFile = `source.${ext}`;
  const sourcePath = path.join(dir, sourceFile);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sourcePath, buffer, { mode: 0o600 });
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      `${JSON.stringify({
        originalFilename,
        extension: ext,
        sourceFile,
        mimeType,
        fileSize: buffer.length,
        createdAt: new Date().toISOString()
      }, null, 2)}\n`,
      { mode: 0o600 }
    );
  } catch (_error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    throw new JobCreationError('STORAGE_WRITE_FAILED', '服务器无法保存图片。', 500);
  }

  try {
    return await repository.createJob({
      id,
      ownerUsername,
      originalFilename,
      sourceExt: ext,
      mimeType,
      fileSize: buffer.length,
      status: 'draft',
      progress: 0,
      progressMessage: '已上传，等待开始识别。',
      sourcePath: relativePath(root, sourcePath),
      sourceSha256: sha256(buffer)
    });
  } catch (_error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    throw new JobCreationError('JOB_CREATE_FAILED', '无法创建任务。', 500);
  }
}

module.exports = { JobCreationError, createDraftJobFromBuffer, imageKind };
