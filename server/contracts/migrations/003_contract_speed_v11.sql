BEGIN;

-- Contract Digitization v1.1 (contract-speed-v1.1)
--
-- Additive / backward-compatible only.
-- No column is dropped or renamed.
--
-- Columns:
--   source_sha256          streaming SHA256 of the uploaded source PDF
--   parse_mode_requested   auto | fast | accurate (user intent)
--   parse_tier_actual      basic | standard (what MinerU actually ran)
--   parse_cache_hit        whether MinerU artifacts were reused from cache
--   parse_fallback_used    AUTO only: basic quality gate failed -> standard
--   parse_fallback_reason  machine-readable reason, e.g. basic_quality_gate_failed:page_count_mismatch
--   progress_message       human-readable, non-technical progress text
--   parse_metrics          JSONB timing / quality metrics (no contract text)

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS source_sha256 TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_mode_requested TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_tier_actual TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_cache_hit BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_fallback_used BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_fallback_reason TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS progress_message TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_metrics JSONB;


-- page_count already exists from 001_contracts.sql
-- (INTEGER NULL CHECK (page_count IS NULL OR page_count >= 0)).
-- This line is a defensive, idempotent no-op so that any
-- environment whose schema drifted still ends up consistent with
-- repository.js INSERT/SELECT and the worker's usage.
-- It is nullable, additive, backward-compatible, and needs no
-- backfill (historical rows keep NULL).
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS page_count INTEGER;


-- Historical v1.0.2 contracts were all parsed with the
-- Standard tier, so backfill them as accurate/standard.
--
-- The WHERE clause only touches rows that have never been
-- classified, so re-running this migration is a no-op.
UPDATE contracts
SET
    parse_mode_requested = 'accurate',
    parse_tier_actual = 'standard'
WHERE parse_mode_requested IS NULL;


-- New contracts default to AUTO (customer-facing "自动").
ALTER TABLE contracts
    ALTER COLUMN parse_mode_requested
    SET DEFAULT 'auto';

ALTER TABLE contracts
    ALTER COLUMN parse_cache_hit
    SET DEFAULT FALSE;

ALTER TABLE contracts
    ALTER COLUMN parse_fallback_used
    SET DEFAULT FALSE;


CREATE INDEX IF NOT EXISTS
    idx_contracts_owner_source_sha256
ON contracts (
    owner_username,
    source_sha256
);

COMMIT;
