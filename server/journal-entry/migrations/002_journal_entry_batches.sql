BEGIN;

CREATE TABLE IF NOT EXISTS journal_entry_batches (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journal_entry_batches_owner_created_idx
    ON journal_entry_batches (owner_username, created_at DESC);

CREATE TABLE IF NOT EXISTS journal_entry_batch_items (
    batch_id UUID NOT NULL
        REFERENCES journal_entry_batches (id) ON DELETE CASCADE,
    job_id UUID NOT NULL
        REFERENCES journal_entry_jobs (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    original_filename TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (batch_id, job_id),
    UNIQUE (batch_id, position)
);

CREATE INDEX IF NOT EXISTS journal_entry_batch_items_job_idx
    ON journal_entry_batch_items (job_id);

COMMIT;
