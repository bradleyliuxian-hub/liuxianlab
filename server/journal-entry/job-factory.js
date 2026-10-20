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

function looksLikeXlsx(buffer) {
  return Boolean(buffer) && buffer.length >= 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(buffer[2]);
}

function looksLikeXls(buffer) {
  if (!buffer || buffer.length < 8) return false;
  return buffer[0] === 0xd0 && buffer[1] === 0xcf
    && buffer[2] === 0x11 && buffer[3] === 0xe0
    && buffer[4] === 0xa1 && buffer[5] === 0xb1
    && buffer[6] === 0x1a && buffer[7] === 0xe1;
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
  buffer
}) {
  if (!ownerUsername) {
    throw new JobCreationError('UNAUTHENTICATED', '请先登录。', 401);
  }
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!['xls', 'xlsx'].includes(ext)) {
    throw new JobCreationError('INVALID_FILE_TYPE', '仅支持 .xls / .xlsx 文件。', 400);
  }
  const magicOk = ext === 'xlsx' ? looksLikeXlsx(buffer) : looksLikeXls(buffer);
  if (!magicOk) {
    throw new JobCreationError('INVALID_WORKBOOK', '文件内容不是有效的 Excel 工作簿。', 400);
  }

  const id = crypto.randomUUID();
  const dir = path.join(storageRoot, id);
  const sourcePath = path.join(dir, `source.${ext}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sourcePath, buffer, { mode: 0o600 });
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      `${JSON.stringify({
        originalFilename,
        extension: ext,
        createdAt: new Date().toISOString()
      }, null, 2)}\n`,
      { mode: 0o600 }
    );
  } catch (error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    throw new JobCreationError('STORAGE_WRITE_FAILED', '服务器无法保存文件。', 500);
  }

  try {
    return await repository.createJob({
      id,
      ownerUsername,
      originalFilename,
      sourceExt: ext,
      status: 'draft',
      progress: 0,
      progressMessage: '已上传，等待字段映射确认。',
      sourcePath: relativePath(root, sourcePath),
      sourceSha256: sha256(buffer)
    });
  } catch (error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    throw new JobCreationError('JOB_CREATE_FAILED', '无法创建任务。', 500);
  }
}

module.exports = {
  JobCreationError,
  createDraftJobFromBuffer,
  looksLikeXls,
  looksLikeXlsx,
  relativePath
};
