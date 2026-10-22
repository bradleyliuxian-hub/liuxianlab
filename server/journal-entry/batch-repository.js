'use strict';

/*
 * Journal Entry batch persistence.
 *
 * A batch is an orchestration container only. Child analysis state always
 * lives in journal_entry_jobs; batch counts/status/progress are derived from
 * those rows so there is no second status source.
 */

const { query } = require('../contracts/db');
const { mapJob } = require('./repository');

const BATCH_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed'
});

const SUMMARY_SELECT = `
  SELECT
    b.id,
    b.owner_username,
    b.name,
    b.created_at,
    b.updated_at,
    COUNT(j.id)::int AS total_count,
    COUNT(*) FILTER (WHERE j.status = 'draft')::int AS draft_count,
    COUNT(*) FILTER (WHERE j.status = 'queued')::int AS queued_count,
    COUNT(*) FILTER (WHERE j.status = 'running')::int AS running_count,
    COUNT(*) FILTER (WHERE j.status = 'completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE j.status = 'failed')::int AS failed_count,
    COALESCE(ROUND(AVG(j.progress))::int, 0) AS progress
  FROM journal_entry_batches b
  LEFT JOIN journal_entry_batch_items i ON i.batch_id = b.id
  LEFT JOIN journal_entry_jobs j ON j.id = i.job_id AND j.deleted_at IS NULL
  WHERE b.owner_username = $1
    AND b.deleted_at IS NULL
`;

function deriveBatchStatus(counts) {
  const total = Number(counts.totalCount || 0);
  const draft = Number(counts.draftCount || 0);
  const queued = Number(counts.queuedCount || 0);
  const running = Number(counts.runningCount || 0);
  const completed = Number(counts.completedCount || 0);
  const failed = Number(counts.failedCount || 0);

  if (running > 0) return BATCH_STATUS.RUNNING;
  if (queued > 0) return BATCH_STATUS.QUEUED;
  if (total > 0 && completed === total) return BATCH_STATUS.COMPLETED;
  if (total > 0 && failed === total) return BATCH_STATUS.FAILED;
  if (completed > 0 && failed > 0 && draft === 0) return BATCH_STATUS.PARTIAL_FAILED;
  return BATCH_STATUS.DRAFT;
}

function mapBatch(row) {
  if (!row) return null;
  const counts = {
    totalCount: Number(row.total_count || 0),
    draftCount: Number(row.draft_count || 0),
    queuedCount: Number(row.queued_count || 0),
    runningCount: Number(row.running_count || 0),
    completedCount: Number(row.completed_count || 0),
    failedCount: Number(row.failed_count || 0)
  };
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    name: row.name || null,
    status: deriveBatchStatus(counts),
    progress: Math.max(0, Math.min(100, Number(row.progress || 0))),
    ...counts,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createBatch({ id, ownerUsername, name }) {
  const result = await query(
    `
    INSERT INTO journal_entry_batches (id, owner_username, name)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [id, ownerUsername, name || null]
  );
  return result.rows[0];
}

async function addItem({ batchId, jobId, position, originalFilename, fileSize }) {
  const result = await query(
    `
    INSERT INTO journal_entry_batch_items (
      batch_id, job_id, position, original_filename, file_size
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [batchId, jobId, position, originalFilename, Number(fileSize) || 0]
  );
  return result.rows[0];
}

async function getBatchSummaryForOwner(batchId, ownerUsername) {
  const result = await query(
    `${SUMMARY_SELECT}
     AND b.id = $2
     GROUP BY b.id
     LIMIT 1`,
    [ownerUsername, batchId]
  );
  return mapBatch(result.rows[0]);
}

async function listBatchesForOwner(ownerUsername) {
  const result = await query(
    `${SUMMARY_SELECT}
     GROUP BY b.id
     ORDER BY b.created_at DESC`,
    [ownerUsername]
  );
  return result.rows.map(mapBatch);
}

async function getBatchDetailForOwner(batchId, ownerUsername) {
  const batch = await getBatchSummaryForOwner(batchId, ownerUsername);
  if (!batch) return null;
  const result = await query(
    `
    SELECT
      i.position AS item_position,
      i.original_filename AS item_filename,
      i.file_size AS item_file_size,
      j.*
    FROM journal_entry_batch_items i
    JOIN journal_entry_jobs j ON j.id = i.job_id AND j.deleted_at IS NULL
    WHERE i.batch_id = $1
    ORDER BY i.position ASC
    `,
    [batchId]
  );
  return {
    ...batch,
    items: result.rows.map((row) => ({
      position: Number(row.item_position),
      originalFilename: row.item_filename,
      fileSize: Number(row.item_file_size || 0),
      job: mapJob(row)
    }))
  };
}

async function touchBatch(batchId) {
  await query(
    'UPDATE journal_entry_batches SET updated_at = NOW() WHERE id = $1',
    [batchId]
  );
}

async function softDeleteBatch(batchId) {
  const result = await query(
    'UPDATE journal_entry_batches SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [batchId]
  );
  return result.rowCount > 0;
}

async function deleteItemsForBatch(batchId) {
  await query('DELETE FROM journal_entry_batch_items WHERE batch_id = $1', [batchId]);
}

async function deleteItemsForJob(jobId) {
  await query('DELETE FROM journal_entry_batch_items WHERE job_id = $1', [jobId]);
}

async function listEmptyBatches(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const result = await query(
    `
    SELECT b.id FROM journal_entry_batches b
    WHERE b.deleted_at IS NULL
      AND b.created_at < $1
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_batch_items i WHERE i.batch_id = b.id
      )
    ORDER BY b.created_at ASC
    LIMIT $2
    `,
    [cutoff, safeLimit]
  );
  return result.rows.map((row) => row.id);
}

async function listDeletedBatches(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const result = await query(
    `
    SELECT id FROM journal_entry_batches
    WHERE deleted_at IS NOT NULL AND deleted_at < $1
    ORDER BY deleted_at ASC
    LIMIT $2
    `,
    [cutoff, safeLimit]
  );
  return result.rows.map((row) => row.id);
}

async function listAllBatchIds() {
  const result = await query('SELECT id FROM journal_entry_batches');
  return result.rows.map((row) => row.id);
}

async function deleteBatch(batchId) {
  const result = await query(
    'DELETE FROM journal_entry_batches WHERE id = $1 RETURNING id',
    [batchId]
  );
  return result.rowCount > 0;
}

module.exports = {
  BATCH_STATUS,
  deriveBatchStatus,
  mapBatch,
  createBatch,
  addItem,
  getBatchSummaryForOwner,
  listBatchesForOwner,
  getBatchDetailForOwner,
  touchBatch,
  softDeleteBatch,
  deleteItemsForBatch,
  deleteItemsForJob,
  listEmptyBatches,
  listDeletedBatches,
  listAllBatchIds,
  deleteBatch
};
