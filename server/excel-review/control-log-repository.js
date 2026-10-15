'use strict';

/*
 * Excel Review Assistant V1.4 - Control Log repository.
 *
 * Owns only the two new tables (excel_review_control_logs /
 * excel_review_control_log_jobs). It reuses the shared contract pool and
 * never touches excel_review_jobs or the contracts schema.
 */

const { getPool, query } = require('../contracts/db');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function mapControlLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    name: row.name,
    status: row.status,
    fileCount: toNumber(row.file_count),
    questionCount: toNumber(row.question_count),
    threadedCount: toNumber(row.threaded_count),
    legacyCount: toNumber(row.legacy_count),
    authorCount: toNumber(row.author_count),
    snapshotPath: row.snapshot_path,
    controlLogPath: row.control_log_path,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/*
 * Insert the Control Log row and its job relations atomically. Duplicate job
 * ids are collapsed; the (control_log_id, excel_review_job_id) primary key is
 * the authoritative dedup guard.
 */
async function createControlLog({ id, ownerUsername, name, jobIds, status = 'processing' }) {
  const uniqueJobIds = [...new Set((jobIds || []).map((value) => String(value)))];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `
      INSERT INTO excel_review_control_logs (id, owner_username, name, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [id, ownerUsername, name, status]
    );
    for (const jobId of uniqueJobIds) {
      await client.query(
        `
        INSERT INTO excel_review_control_log_jobs (control_log_id, excel_review_job_id)
        VALUES ($1, $2)
        ON CONFLICT (control_log_id, excel_review_job_id) DO NOTHING
        `,
        [id, jobId]
      );
    }
    await client.query('COMMIT');
    return mapControlLog(inserted.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function getControlLogForOwner(id, ownerUsername) {
  const result = await query(
    `
    SELECT *
    FROM excel_review_control_logs
    WHERE
      id = $1
      AND owner_username = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [id, ownerUsername]
  );
  return mapControlLog(result.rows[0]);
}

async function listControlLogsForOwner(ownerUsername) {
  const result = await query(
    `
    SELECT *
    FROM excel_review_control_logs
    WHERE
      owner_username = $1
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    `,
    [ownerUsername]
  );
  return result.rows.map(mapControlLog);
}

const STATE_COLUMNS = {
  status: 'status',
  fileCount: 'file_count',
  questionCount: 'question_count',
  threadedCount: 'threaded_count',
  legacyCount: 'legacy_count',
  authorCount: 'author_count',
  snapshotPath: 'snapshot_path',
  controlLogPath: 'control_log_path',
  error: 'error_message'
};

async function updateControlLogState(id, patch = {}) {
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
  if (columns.length === 0) {
    const existing = await query('SELECT * FROM excel_review_control_logs WHERE id = $1', [id]);
    return mapControlLog(existing.rows[0]);
  }
  values.push(id);
  const result = await query(
    `
    UPDATE excel_review_control_logs
    SET
      ${columns.join(', ')},
      updated_at = NOW()
    WHERE id = $${index}
    RETURNING *
    `,
    values
  );
  return mapControlLog(result.rows[0]);
}

async function listJobIds(controlLogId) {
  const result = await query(
    `
    SELECT excel_review_job_id
    FROM excel_review_control_log_jobs
    WHERE control_log_id = $1
    ORDER BY added_at ASC
    `,
    [controlLogId]
  );
  return result.rows.map((row) => row.excel_review_job_id);
}

async function deleteControlLogForOwner(id, ownerUsername) {
  // Relation rows cascade. Source excel_review_jobs rows are untouched.
  const result = await query(
    `
    DELETE FROM excel_review_control_logs
    WHERE
      id = $1
      AND owner_username = $2
    RETURNING id
    `,
    [id, ownerUsername]
  );
  return result.rowCount > 0;
}

module.exports = {
  mapControlLog,
  createControlLog,
  getControlLogForOwner,
  listControlLogsForOwner,
  updateControlLogState,
  listJobIds,
  deleteControlLogForOwner
};
