'use strict';

/*
 * Excel Review Assistant - canonical single-file job creator.
 *
 * This is the ONLY place a review job directory + DB row + queue entry is
 * created. Every entry point funnels through it:
 *   - single .xlsx upload        -> POST /api/excel-reviews
 *   - one job per archive member -> POST /api/excel-reviews/archive
 *   - (multiple .xlsx upload is just N single uploads from the browser)
 *
 * Keeping one implementation is what prevents the single-file and archive
 * paths from drifting apart.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JobCreationError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'JobCreationError';
    this.code = code;
    this.status = status;
  }
}

// A real .xlsx / OOXML workbook is itself a ZIP container, so both workbook
// and archive members share this PK signature. It only proves "is a ZIP
// container", never "is an archive" — archive-vs-workbook is decided by the
// upload route + filename extension, never by the magic bytes.
function looksLikeZipBuffer(buffer) {
  return Boolean(buffer) && buffer.length >= 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]);
}

function isDatabaseUnavailable(error) {
  if (!error) return false;
  const code = error.code || error.errno;
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
    'ECONNRESET', 'EPIPE', '57P01', '57P02', '57P03'].includes(code)) return true;
  if (error.errno === -61) return true; // macOS ECONNREFUSED
  return /connect ECONNREFUSED|terminating connection|the database system is|Connection terminated/i
    .test(String(error.message || ''));
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/*
 * validate buffer -> job UUID -> private dir -> source.xlsx + meta.json ->
 * repository.createJob -> runner.enqueue -> return the raw job row.
 *
 * Failures are typed (JobCreationError.code) so the HTTP layer and the UI can
 * report the real reason instead of a generic message. A failure before the
 * DB row exists removes the freshly created directory (no ghost dir); a queue
 * failure marks the created row as failed (no ghost queued job).
 */
async function createExcelReviewJobFromBuffer({
  repository, runner, root, storageRoot, ownerUsername, originalFilename, buffer, fromArchive = false
}) {
  if (!ownerUsername) throw new JobCreationError('UNAUTHENTICATED', '请先登录。', 401);

  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!looksLikeZipBuffer(data)) {
    throw new JobCreationError('INVALID_XLSX', '文件内容不是有效的 .xlsx 工作簿。', 400);
  }

  const id = crypto.randomUUID();
  const dir = path.join(storageRoot, id);
  const sourcePath = path.join(dir, 'source.xlsx');

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sourcePath, data, { mode: 0o600 });
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      `${JSON.stringify({ originalFilename, fromArchive })}\n`,
      { mode: 0o600 }
    );
  } catch (_) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (__) {}
    throw new JobCreationError('STORAGE_WRITE_FAILED', '服务器无法保存文件，请稍后重试。', 500);
  }

  let job;
  try {
    job = await repository.createJob({
      id,
      ownerUsername,
      originalFilename,
      status: 'queued',
      phase: 'extract',
      progress: 0,
      progressMessage: fromArchive ? '压缩包已解析，等待处理…' : '文件已上传，等待处理…',
      sourcePath: relativePath(root, sourcePath)
    });
  } catch (error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (__) {}
    if (isDatabaseUnavailable(error)) {
      throw new JobCreationError('DB_UNAVAILABLE', '数据库暂时不可用，请稍后重试。', 503);
    }
    throw new JobCreationError('JOB_CREATE_FAILED', '无法创建任务，请稍后重试。', 500);
  }

  try {
    runner.enqueue(id);
  } catch (_) {
    try {
      await repository.updateJobState(id, { status: 'failed', progress: 100, error: '任务队列启动失败。' });
    } catch (__) {}
    throw new JobCreationError('WORKER_ENQUEUE_FAILED', '任务队列启动失败。', 500);
  }

  return job;
}

module.exports = {
  createExcelReviewJobFromBuffer,
  looksLikeZipBuffer,
  isDatabaseUnavailable,
  relativePath,
  JobCreationError
};
