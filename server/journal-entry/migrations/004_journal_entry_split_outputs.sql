BEGIN;

CREATE TABLE IF NOT EXISTS journal_entry_split_outputs (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('job', 'batch')),
    scope_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating'
        CHECK (status IN ('generating', 'completed', 'failed')),
    request_json JSONB,
    snapshot_json JSONB,
    output_mode TEXT CHECK (output_mode IS NULL OR output_mode IN ('multi_sheet', 'zip')),
    file_path TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journal_entry_split_outputs_scope_idx
    ON journal_entry_split_outputs (owner_username, scope_type, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS journal_entry_split_outputs_created_idx
    ON journal_entry_split_outputs (created_at DESC);

COMMIT;
