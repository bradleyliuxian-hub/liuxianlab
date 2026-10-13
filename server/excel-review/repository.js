'use strict';

/*
 * Excel Review Assistant - PostgreSQL repository.
 *
 * Reuses the shared contract pool (server/contracts/db.js) so the
 * site keeps a single pg connection pool. This module owns only the
 * excel_review_jobs table; it never touches the contracts table.
 */

const { query } = require('../contracts/db');

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    originalFilename: row.original_filename,
    status: row.status,
    phase: row.phase,
    progress: Number(row.progress || 0),
    progressMessage: row.progress_message,
    itemCount: toNumberOrNull(row.item_count),
    replyCount: toNumberOrNull(row.reply_count),
    sourcePath: row.source_path,
    reviewPath: row.review_path,
    finalPath: row.final_path,
    sourceSha256: row.source_sha256,
    mappingVersion: row.mapping_version,
    reviewToken: row.review_token,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createJob(job) {
  const result = await query(
    `
    INSERT INTO excel_review_jobs (
      id,
      owner_username,
      original_filename,
      status,
      phase,
      progress,
      progress_message,
      source_path
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [
      job.id,
      job.ownerUsername,
      job.originalFilename,
      job.status ?? 'queued',
      job.phase ?? 'extract',
      job.progress ?? 0,
      job.progressMessage ?? '文件已上传，等待处理…',
      job.sourcePath ?? null
    ]
  );
  return mapJob(result.rows[0]);
}

async function getJobById(jobId) {
  const result = await query(
    `
    SELECT *
    FROM excel_review_jobs
    WHERE id = $1
    LIMIT 1
    `,
    [jobId]
  );
  return mapJob(result.rows[0]);
}

async function getJobForOwner(jobId, ownerUsername) {
  const result = await query(
    `
    SELECT *
    FROM excel_review_jobs
    WHERE
      id = $1
      AND owner_username = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [jobId, ownerUsername]
  );
  return mapJob(result.rows[0]);
}

async function listJobsForOwner(ownerUsername) {
  const result = await query(
    `
    SELECT *
    FROM excel_review_jobs
    WHERE
      owner_username = $1
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    `,
    [ownerUsername]
  );
  return result.rows.map(mapJob);
}

/*
 * Atomically move a queued job into processing.
 * Returns the claimed job or null if it was not queued anymore.
 */
async function claimJob(jobId, { message } = {}) {
  const result = await query(
    `
    UPDATE excel_review_jobs
    SET
      status = 'processing',
      phase = 'extract',
      progress = 0,
      progress_message = $2,
      error_message = NULL,
      updated_at = NOW()
    WHERE
      id = $1
      AND status = 'queued'
      AND deleted_at IS NULL
    RETURNING *
    `,
    [jobId, message ?? null]
  );
  return mapJob(result.rows[0]);
}

const STATE_COLUMNS = {
  status: 'status',
  phase: 'phase',
  progress: 'progress',
  progressMessage: 'progress_message',
  itemCount: 'item_count',
  replyCount: 'reply_count',
  sourcePath: 'source_path',
  reviewPath: 'review_path',
  finalPath: 'final_path',
  sourceSha256: 'source_sha256',
  mappingVersion: 'mapping_version',
  reviewToken: 'review_token',
  error: 'error_message'
};

/*
 * Update any subset of state columns. progress/status are written
 * as-is (the caller guarantees monotonic progress per phase).
 */
async function updateJobState(jobId, patch = {}) {
  const columns = [];
  const values = [];
  let index = 1;

  for (const [key, column] of Object.entries(STATE_COLUMNS)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      columns.push(`${column} = $${index}`);
      values.push(patch[key]);
      index += 1;
    }
  }

  if (columns.length === 0) return getJobById(jobId);

  values.push(jobId);
  const result = await query(
    `
    UPDATE excel_review_jobs
    SET
      ${columns.join(', ')},
      updated_at = NOW()
    WHERE id = $${index}
    RETURNING *
    `,
    values
  );
  return mapJob(result.rows[0]);
}

async function listJobsByStatus(statuses, limit = 50) {
  if (!Array.isArray(statuses) || statuses.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const result = await query(
    `
    SELECT *
    FROM excel_review_jobs
    WHERE
      status = ANY($1::text[])
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [statuses, safeLimit]
  );
  return result.rows.map(mapJob);
}

async function deleteJobForOwner(jobId, ownerUsername) {
  const result = await query(
    `
    DELETE FROM excel_review_jobs
    WHERE
      id = $1
      AND owner_username = $2
    RETURNING id
    `,
    [jobId, ownerUsername]
  );
  return result.rowCount > 0;
}

module.exports = {
  mapJob,
  createJob,
  getJobById,
  getJobForOwner,
  listJobsForOwner,
  claimJob,
  updateJobState,
  listJobsByStatus,
  deleteJobForOwner
};
