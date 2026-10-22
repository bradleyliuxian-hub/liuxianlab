'use strict';

const { query } = require('../contracts/db');

function mapPreset(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUsername: row.owner_username,
    name: row.name,
    spec: row.spec_json || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createPreset({ id, ownerUsername, name, spec }) {
  const result = await query(
    `
    INSERT INTO journal_entry_split_presets (id, owner_username, name, spec_json)
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING *
    `,
    [id, ownerUsername, name, JSON.stringify(spec || {})]
  );
  return mapPreset(result.rows[0]);
}

async function listPresets(ownerUsername) {
  const result = await query(
    `
    SELECT * FROM journal_entry_split_presets
    WHERE owner_username = $1 AND deleted_at IS NULL
    ORDER BY updated_at DESC, created_at DESC
    `,
    [ownerUsername]
  );
  return result.rows.map(mapPreset);
}

async function getPreset(id, ownerUsername) {
  const result = await query(
    `
    SELECT * FROM journal_entry_split_presets
    WHERE id = $1 AND owner_username = $2 AND deleted_at IS NULL
    LIMIT 1
    `,
    [id, ownerUsername]
  );
  return mapPreset(result.rows[0]);
}

async function updatePreset(id, ownerUsername, { name, spec }) {
  const result = await query(
    `
    UPDATE journal_entry_split_presets
    SET name = COALESCE($3, name),
        spec_json = COALESCE($4::jsonb, spec_json),
        updated_at = NOW()
    WHERE id = $1 AND owner_username = $2 AND deleted_at IS NULL
    RETURNING *
    `,
    [id, ownerUsername, name ?? null, spec ? JSON.stringify(spec) : null]
  );
  return mapPreset(result.rows[0]);
}

async function deletePreset(id, ownerUsername) {
  const result = await query(
    `
    UPDATE journal_entry_split_presets
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND owner_username = $2 AND deleted_at IS NULL
    RETURNING id
    `,
    [id, ownerUsername]
  );
  return result.rowCount > 0;
}

async function purgeDeletedPresets(cutoff, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const result = await query(
    `
    DELETE FROM journal_entry_split_presets
    WHERE id IN (
      SELECT id FROM journal_entry_split_presets
      WHERE deleted_at IS NOT NULL AND deleted_at < $1
      ORDER BY deleted_at ASC
      LIMIT $2
    )
    RETURNING id
    `,
    [cutoff, safeLimit]
  );
  return result.rowCount;
}

module.exports = {
  mapPreset,
  createPreset,
  listPresets,
  getPreset,
  updatePreset,
  deletePreset,
  purgeDeletedPresets
};
