'use strict';

const { query } = require('../contracts/db');

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    originalFilename: row.original_filename,
    sourceExt: row.source_ext,
    mimeType: row.mime_type,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    imageWidth: row.image_width === null ? null : Number(row.image_width),
    imageHeight: row.image_height === null ? null : Number(row.image_height),
    status: row.status,
    progress: Number(row.progress || 0),
    progressMessage: row.progress_message,
    sourcePath: row.source_path,
    sourceSha256: row.source_sha256,
    resultDir: row.result_dir,
    summaryJson: row.summary_json || null,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

async function createJob(job) {
  const result = await query(
    `
    INSERT INTO equity_structure_jobs (
      id, owner_username, original_filename, source_ext, mime_type, file_size,
      status, progress, progress_message, source_path, source_sha256
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
    `,
    [
      job.id,
      job.ownerUsername,
      job.originalFilename,
      job.sourceExt,
      job.mimeType || null,
      job.fileSize || null,
      job.status || 'draft',
      job.progress || 0,
      job.progressMessage || '已上传，等待开始识别。',
      job.sourcePath || null,
      job.sourceSha256 || null
    ]
  );
  return mapJob(result.rows[0]);
}

async function getJobForOwner(jobId, ownerUsername) {
  const result = await query(
    `
    SELECT * FROM equity_structure_jobs
    WHERE id = $1 AND owner_username = $2 AND deleted_at IS NULL
    LIMIT 1
    `,
    [jobId, ownerUsername]
  );
  return mapJob(result.rows[0]);
}

async function findCompletedByHash(ownerUsername, sha256) {
  if (!sha256) return null;
  const result = await query(
    `
    SELECT * FROM equity_structure_jobs
    WHERE owner_username = $1 AND source_sha256 = $2
      AND status = 'completed' AND result_dir IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
    `,
    [ownerUsername, sha256]
  );
  return mapJob(result.rows[0]);
}

async function listJobsForOwner(ownerUsername) {
  const result = await query(
    `
    SELECT * FROM equity_structure_jobs
    WHERE owner_username = $1 AND deleted_at IS NULL
    ORDER BY created_at DESC
    `,
    [ownerUsername]
  );
  return result.rows.map(mapJob);
}

async function claimJob(jobId, { message } = {}) {
  const result = await query(
    `
    UPDATE equity_structure_jobs
    SET status = 'running', progress = 0, progress_message = $2,
        error_message = NULL, updated_at = NOW()
    WHERE id = $1 AND status = 'queued' AND deleted_at IS NULL
    RETURNING *
    `,
    [jobId, message || '正在启动股权结构识别…']
  );
  return mapJob(result.rows[0]);
}

const STATE_COLUMNS = {
  status: 'status',
  progress: 'progress',
  progressMessage: 'progress_message',
  imageWidth: 'image_width',
  imageHeight: 'image_height',
  resultDir: 'result_dir',
  summaryJson: 'summary_json',
  error: 'error_message',
  completedAt: 'completed_at'
};

async function updateJobState(jobId, patch = {}) {
  const columns = [];
  const values = [];
  let index = 1;
  for (const [key, column] of Object.entries(STATE_COLUMNS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    let cast = '';
    let value = patch[key];
    if (value === undefined) continue;
    if (key === 'summaryJson') {
      cast = '::jsonb';
      value = value === null ? null : JSON.stringify(value);
    }
    columns.push(`${column} = $${index}${cast}`);
    values.push(value);
    index += 1;
  }
  if (!columns.length) {
    const existing = await query('SELECT * FROM equity_structure_jobs WHERE id = $1 LIMIT 1', [jobId]);
    return mapJob(existing.rows[0]);
  }
  values.push(jobId);
  const result = await query(
    `
    UPDATE equity_structure_jobs
    SET ${columns.join(', ')}, updated_at = NOW()
    WHERE id = $${index}
    RETURNING *
    `,
    values
  );
  return mapJob(result.rows[0]);
}

async function listJobsByStatus(statuses, limit = 100) {
  if (!Array.isArray(statuses) || !statuses.length) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const result = await query(
    `
    SELECT * FROM equity_structure_jobs
    WHERE status = ANY($1::text[]) AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [statuses, safeLimit]
  );
  return result.rows.map(mapJob);
}

async function listExpiredJobs(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const result = await query(
    `
    SELECT * FROM equity_structure_jobs
    WHERE status IN ('draft', 'completed', 'failed')
      AND updated_at < $1 AND deleted_at IS NULL
    ORDER BY updated_at ASC
    LIMIT $2
    `,
    [cutoff, safeLimit]
  );
  return result.rows.map(mapJob);
}

async function deleteJobForOwner(jobId, ownerUsername) {
  const result = await query(
    'DELETE FROM equity_structure_jobs WHERE id = $1 AND owner_username = $2 RETURNING id',
    [jobId, ownerUsername]
  );
  return result.rowCount > 0;
}

async function deleteJobById(jobId) {
  const result = await query('DELETE FROM equity_structure_jobs WHERE id = $1 RETURNING id', [jobId]);
  return result.rowCount > 0;
}

async function addCorrection({ ownerUsername, jobId, originalName, correctedName }) {
  const result = await query(
    `
    INSERT INTO equity_structure_corrections (owner_username, job_id, original_name, corrected_name)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [ownerUsername, jobId || null, originalName, correctedName]
  );
  const row = result.rows[0];
  return {
    id: Number(row.id),
    original: row.original_name,
    corrected: row.corrected_name,
    createdAt: row.created_at
  };
}

module.exports = {
  mapJob,
  createJob,
  getJobForOwner,
  findCompletedByHash,
  listJobsForOwner,
  claimJob,
  updateJobState,
  listJobsByStatus,
  listExpiredJobs,
  deleteJobForOwner,
  deleteJobById,
  addCorrection
};
