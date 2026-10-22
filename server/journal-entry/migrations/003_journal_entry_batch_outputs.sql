BEGIN;

CREATE TABLE IF NOT EXISTS journal_entry_batch_outputs (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL
        REFERENCES journal_entry_batches (id) ON DELETE CASCADE,
    owner_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating'
        CHECK (status IN ('generating', 'completed', 'failed')),
    snapshot_json JSONB,
    summary_path TEXT,
    merged_path TEXT,
    zip_path TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journal_entry_batch_outputs_batch_idx
    ON journal_entry_batch_outputs (batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS journal_entry_batch_outputs_owner_idx
    ON journal_entry_batch_outputs (owner_username, created_at DESC);

COMMIT;
