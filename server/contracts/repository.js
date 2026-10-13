"use strict";

const {
  query
} = require("./db");


function mapContract(row) {

  if (!row) {
    return null;
  }


  return {

    id:
      row.id,

    ownerUsername:
      row.owner_username,

    originalName:
      row.original_name,

    storedName:
      row.stored_name,

    filePath:
      row.file_path,

    size:
      Number(
        row.size_bytes
      ),

    mimeType:
      row.mime_type,

    status:
      row.status,

    stage:
      row.stage,

    progress:
      Number(
        row.progress
      ),

    language:
      row.language,

    pageCount:
      row.page_count,

    error:
      row.error_message,

    sourceSha256:
      row.source_sha256,

    parseModeRequested:
      row.parse_mode_requested,

    parseTierActual:
      row.parse_tier_actual,

    parseCacheHit:
      row.parse_cache_hit,

    parseFallbackUsed:
      row.parse_fallback_used,

    parseFallbackReason:
      row.parse_fallback_reason,

    progressMessage:
      row.progress_message,

    parseMetrics:
      row.parse_metrics,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at

  };

}


async function createContract(
  contract
) {

  const result =
    await query(
      `
      INSERT INTO contracts (
        id,
        owner_username,
        original_name,
        stored_name,
        file_path,
        size_bytes,
        mime_type,
        status,
        stage,
        progress,
        error_message,
        parse_mode_requested,
        source_sha256,
        page_count
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14
      )
      RETURNING *
      `,
      [
        contract.id,
        contract.ownerUsername,
        contract.originalName,
        contract.storedName,
        contract.filePath,
        contract.size,
        contract.mimeType,
        contract.status,
        contract.stage,
        contract.progress,
        contract.error,
        contract.parseModeRequested ?? null,
        contract.sourceSha256 ?? null,
        contract.pageCount ?? null
      ]
    );


  return mapContract(
    result.rows[0]
  );

}


async function getContractById(
  contractId
) {

  const result =
    await query(
      `
      SELECT *
      FROM contracts
      WHERE id = $1
      LIMIT 1
      `,
      [
        contractId
      ]
    );


  return mapContract(
    result.rows[0]
  );

}


async function getContractForOwner(
  contractId,
  ownerUsername
) {

  const result =
    await query(
      `
      SELECT *
      FROM contracts
      WHERE
        id = $1
        AND owner_username = $2
      LIMIT 1
      `,
      [
        contractId,
        ownerUsername
      ]
    );


  return mapContract(
    result.rows[0]
  );

}


async function updateContractState(
  contractId,
  {
    status,
    stage,
    progress,
    error = null,
    language = null,
    pageCount = null
  }
) {

  const result =
    await query(
      `
      UPDATE contracts

      SET
        status = COALESCE($2, status),

        stage = COALESCE($3, stage),

        progress = COALESCE($4, progress),

        error_message = $5,

        language = COALESCE($6, language),

        page_count = COALESCE($7, page_count),

        updated_at = NOW()

      WHERE id = $1

      RETURNING *
      `,
      [
        contractId,
        status ?? null,
        stage ?? null,
        progress ?? null,
        error,
        language,
        pageCount
      ]
    );


  return mapContract(
    result.rows[0]
  );

}


async function listQueuedContracts(
  limit = 10
) {

  const safeLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number(limit) || 10
      )
    );


  const result =
    await query(
      `
      SELECT *
      FROM contracts

      WHERE
        status = 'queued'
        AND stage = 'queued'

      ORDER BY created_at ASC

      LIMIT $1
      `,
      [
        safeLimit
      ]
    );


  return result.rows.map(
    mapContract
  );

}




async function getLatestContractForOwner(
  ownerUsername
) {

  const result =
    await query(
      `
      SELECT *
      FROM contracts
      WHERE owner_username = $1
      AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [
        ownerUsername
      ]
    );


  return mapContract(
    result.rows[0]
  );

}




async function listContractsForOwner(
  ownerUsername
) {

  const result =
    await query(
      `
      SELECT *
      FROM contracts
      WHERE owner_username = $1
      AND deleted_at IS NULL
      ORDER BY created_at DESC
      `,
      [
        ownerUsername
      ]
    );


  return result.rows.map(
    mapContract
  );

}




async function softDeleteContractForOwner(
  contractId,
  ownerUsername
) {

  const result =
    await query(
      `
      UPDATE contracts

      SET
          deleted_at = NOW(),
          updated_at = NOW()

      WHERE
          id = $1
          AND owner_username = $2
          AND deleted_at IS NULL

      RETURNING *
      `,
      [
        contractId,
        ownerUsername
      ]
    );


  return mapContract(
    result.rows[0]
  );

}


async function hardDeleteContract(
  contractId
) {

  await query(
    `
    DELETE FROM contracts

    WHERE
        id = $1
        AND deleted_at IS NOT NULL
    `,
    [
      contractId
    ]
  );

}


module.exports = {
  hardDeleteContract,
  softDeleteContractForOwner,
  listContractsForOwner,
  getLatestContractForOwner,
  createContract,
  getContractById,
  getContractForOwner,
  updateContractState,
  listQueuedContracts
};
