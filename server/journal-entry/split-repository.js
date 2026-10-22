'use strict';

const { query } = require('../contracts/db');

function mapSplit(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    status: row.status,
    request: row.request_json || null,
    snapshot: row.snapshot_json || null,
    outputMode: row.output_mode,
    filePath: row.file_path,
    error: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiredAt: row.expired_at || null
  };
}

async function createOutput({ id, ownerUsername, scopeType, scopeId, request, snapshot, outputMode }) {
  const result = await query(
    `
    INSERT INTO journal_entry_split_outputs (
      id, owner_username, scope_type, scope_id, status,
      request_json, snapshot_json, output_mode
    )
    VALUES ($1, $2, $3, $4, 'generating', $5::jsonb, $6::jsonb, $7)
    RETURNING *
    `,
    [
      id, ownerUsername, scopeType, scopeId,
      JSON.stringify(request || {}), JSON.stringify(snapshot || {}), outputMode
    ]
  );
  return mapSplit(result.rows[0]);
}

async function markCompleted(id, { filePath, snapshot }) {
  const result = await query(
    `
    UPDATE journal_entry_split_outputs
    SET status = 'completed',
        file_path = $2,
        snapshot_json = COALESCE($3::jsonb, snapshot_json),
        error_message = NULL,
        completed_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, filePath, snapshot ? JSON.stringify(snapshot) : null]
  );
  return mapSplit(result.rows[0]);
}

async function markFailed(id, error) {
  const result = await query(
    `
    UPDATE journal_entry_split_outputs
    SET status = 'failed', error_message = $2, completed_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, String(error || '生成失败').slice(0, 500)]
  );
  return mapSplit(result.rows[0]);
}

async function expireOutput(id) {
  const result = await query(
    `
    UPDATE journal_entry_split_outputs
    SET expired_at = NOW(), file_path = NULL
    WHERE id = $1 AND expired_at IS NULL
    RETURNING *
    `,
    [id]
  );
  return mapSplit(result.rows[0]);
}

async function listExpiredOutputs(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const result = await query(
    `
    SELECT * FROM journal_entry_split_outputs
    WHERE expired_at IS NULL
      AND status IN ('completed', 'failed')
      AND completed_at IS NOT NULL
      AND completed_at < $1
    ORDER BY completed_at ASC
    LIMIT $2
    `,
    [cutoff, safeLimit]
  );
  return result.rows.map(mapSplit);
}

async function listByScope(scopeType, scopeId) {
  const result = await query(
    `
    SELECT * FROM journal_entry_split_outputs
    WHERE scope_type = $1 AND scope_id = $2
    ORDER BY created_at DESC
    `,
    [scopeType, scopeId]
  );
  return result.rows.map(mapSplit);
}

async function listAllOutputIds() {
  const result = await query('SELECT id FROM journal_entry_split_outputs');
  return result.rows.map((row) => row.id);
}

async function getLatestForScope(owner, scopeType, scopeId) {
  const result = await query(
    `
    SELECT * FROM journal_entry_split_outputs
    WHERE owner_username = $1 AND scope_type = $2 AND scope_id = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [owner, scopeType, scopeId]
  );
  return mapSplit(result.rows[0]);
}

async function getForOwner(id, owner) {
  const result = await query(
    `
    SELECT * FROM journal_entry_split_outputs
    WHERE id = $1 AND owner_username = $2
    LIMIT 1
    `,
    [id, owner]
  );
  return mapSplit(result.rows[0]);
}

async function failGeneratingOutputs() {
  const result = await query(
    `
    UPDATE journal_entry_split_outputs
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
  mapSplit,
  createOutput,
  markCompleted,
  markFailed,
  failGeneratingOutputs,
  expireOutput,
  listExpiredOutputs,
  listByScope,
  listAllOutputIds,
  getLatestForScope,
  getForOwner
};
