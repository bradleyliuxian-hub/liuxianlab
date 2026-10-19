BEGIN;

-- Contract Review: per-contract parse backend + encrypted cloud
-- credential storage.
--
-- Additive / backward-compatible only.
-- No column is dropped or renamed; no contract row is deleted.
--
-- parse_backend_requested:
--   local | cloud
--   Historical rows are backfilled to 'local' (all pre-UI
--   contracts used local MinerU). New rows default to local.
--
-- contract_credentials:
--   Only created when a user supplies a per-task MinerU Token.
--   Stores AES-256-GCM ciphertext / IV / auth tag, never the
--   plaintext token. Deleted by the worker on terminal state or
--   by the expiry prune.

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_backend_requested TEXT;


UPDATE contracts
SET parse_backend_requested = 'local'
WHERE parse_backend_requested IS NULL;


ALTER TABLE contracts
    ALTER COLUMN parse_backend_requested
    SET DEFAULT 'local';

ALTER TABLE contracts
    ALTER COLUMN parse_backend_requested
    SET NOT NULL;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contracts_parse_backend_requested_check'
    ) THEN
        ALTER TABLE contracts
            ADD CONSTRAINT contracts_parse_backend_requested_check
            CHECK (
                parse_backend_requested IN ('local', 'cloud')
            );
    END IF;
END
$$;


CREATE TABLE IF NOT EXISTS contract_credentials (

    contract_id UUID PRIMARY KEY
        REFERENCES contracts(id)
        ON DELETE CASCADE,

    owner_username TEXT NOT NULL,

    ciphertext BYTEA NOT NULL,

    iv BYTEA NOT NULL
        CHECK (octet_length(iv) = 12),

    auth_tag BYTEA NOT NULL
        CHECK (octet_length(auth_tag) = 16),

    key_version INTEGER NOT NULL
        DEFAULT 1
        CHECK (key_version >= 1),

    expires_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS
    idx_contract_credentials_expires_at
ON contract_credentials (
    expires_at
);


CREATE INDEX IF NOT EXISTS
    idx_contracts_owner_backend_created
ON contracts (
    owner_username,
    parse_backend_requested,
    created_at DESC
);

COMMIT;
