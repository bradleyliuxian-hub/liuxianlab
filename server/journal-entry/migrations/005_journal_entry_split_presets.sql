BEGIN;

CREATE TABLE IF NOT EXISTS journal_entry_split_presets (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    name TEXT NOT NULL,
    spec_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journal_entry_split_presets_owner_idx
    ON journal_entry_split_presets (owner_username, created_at DESC);

COMMIT;
