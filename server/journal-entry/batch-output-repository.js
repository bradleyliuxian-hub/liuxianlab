'use strict';

const { query } = require('../contracts/db');

function mapOutput(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    ownerUsername: row.owner_username,
    status: row.status,
    snapshot: row.snapshot_json || null,
    summaryPath: row.summary_path,
    mergedPath: row.merged_path,
    zipPath: row.zip_path,
    error: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiredAt: row.expired_at || null
  };
}

async function createOutput({ id, batchId, ownerUsername, snapshot }) {
  const result = await query(
    `
    INSERT INTO journal_entry_batch_outputs (
      id, batch_id, owner_username, status, snapshot_json
    )
    VALUES ($1, $2, $3, 'generating', $4::jsonb)
    RETURNING *
    `,
    [id, batchId, ownerUsername, JSON.stringify(snapshot || {})]
  );
  return mapOutput(result.rows[0]);
}

async function markCompleted(id, { summaryPath, mergedPath, zipPath, snapshot }) {
  const result = await query(
    `
    UPDATE journal_entry_batch_outputs
    SET status = 'completed',
        summary_path = $2,
        merged_path = $3,
        zip_path = $4,
        snapshot_json = COALESCE($5::jsonb, snapshot_json),
        error_message = NULL,
        completed_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [
      id,
      summaryPath,
      mergedPath,
      zipPath,
      snapshot ? JSON.stringify(snapshot) : null
    ]
  );
  return mapOutput(result.rows[0]);
}

async function markFailed(id, error) {
  const result = await query(
    `
    UPDATE journal_entry_batch_outputs
    SET status = 'failed',
        error_message = $2,
        completed_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, String(error || '生成失败').slice(0, 500)]
  );
  return mapOutput(result.rows[0]);
}

async function expireOutput(id) {
  const result = await query(
    `
    UPDATE journal_entry_batch_outputs
    SET expired_at = NOW(),
        summary_path = NULL,
        merged_path = NULL,
        zip_path = NULL
    WHERE id = $1 AND expired_at IS NULL
    RETURNING *
    `,
    [id]
  );
  return mapOutput(result.rows[0]);
}

async function listExpiredOutputs(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const result = await query(
    `
    SELECT * FROM journal_entry_batch_outputs
    WHERE expired_at IS NULL
      AND status IN ('completed', 'failed')
      AND completed_at IS NOT NULL
      AND completed_at < $1
    ORDER BY completed_at ASC
    LIMIT $2
    `,
    [cutoff, safeLimit]
  );
  return result.rows.map(mapOutput);
}

async function listForBatch(batchId) {
  const result = await query(
    'SELECT * FROM journal_entry_batch_outputs WHERE batch_id = $1 ORDER BY created_at DESC',
    [batchId]
  );
  return result.rows.map(mapOutput);
}

async function listAllOutputIds() {
  const result = await query('SELECT id, batch_id FROM journal_entry_batch_outputs');
  return result.rows.map((row) => ({ id: row.id, batchId: row.batch_id }));
}

async function getLatestForOwner(batchId, ownerUsername) {
  const result = await query(
    `
    SELECT o.*
    FROM journal_entry_batch_outputs o
    JOIN journal_entry_batches b ON b.id = o.batch_id
    WHERE o.batch_id = $1
      AND o.owner_username = $2
      AND b.owner_username = $2
      AND b.deleted_at IS NULL
    ORDER BY o.created_at DESC
    LIMIT 1
    `,
    [batchId, ownerUsername]
  );
  return mapOutput(result.rows[0]);
}

async function getForOwner(outputId, batchId, ownerUsername) {
  const result = await query(
    `
    SELECT o.*
    FROM journal_entry_batch_outputs o
    JOIN journal_entry_batches b ON b.id = o.batch_id
    WHERE o.id = $1
      AND o.batch_id = $2
      AND o.owner_username = $3
      AND b.owner_username = $3
      AND b.deleted_at IS NULL
    LIMIT 1
    `,
    [outputId, batchId, ownerUsername]
  );
  return mapOutput(result.rows[0]);
}

async function failGeneratingOutputs() {
  const result = await query(
    `
    UPDATE journal_entry_batch_outputs
    SET status = 'failed',
        error_message = '服务器重启，生成中断，请重新生成。',
        completed_at = NOW()
    WHERE status = 'generating'
    RETURNING id
    `
  );
  return result.rowCount;
}

module.exports = {
  mapOutput,
  createOutput,
  markCompleted,
  markFailed,
  failGeneratingOutputs,
  expireOutput,
  listExpiredOutputs,
  listForBatch,
  listAllOutputIds,
  getLatestForOwner,
  getForOwner
};
