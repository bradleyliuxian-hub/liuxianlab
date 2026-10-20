BEGIN;

CREATE TABLE IF NOT EXISTS purchase_reconciliation_jobs (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    source_ext TEXT NOT NULL CHECK (source_ext IN ('xlsx', 'xlsm')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'queued', 'running', 'completed', 'failed')),
    progress SMALLINT NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100),
    progress_message TEXT,
    sheet_name TEXT,
    header_row INTEGER CHECK (header_row IS NULL OR header_row >= 1),
    request_json JSONB,
    source_path TEXT,
    source_sha256 TEXT,
    result_dir TEXT,
    xlsx_status TEXT CHECK (xlsx_status IN ('generating', 'ready', 'error')),
    summary_json JSONB,
    error_message TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS purchase_reconciliation_jobs_owner_created_idx
    ON purchase_reconciliation_jobs (owner_username, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_reconciliation_jobs_status_created_idx
    ON purchase_reconciliation_jobs (status, created_at);

COMMIT;
