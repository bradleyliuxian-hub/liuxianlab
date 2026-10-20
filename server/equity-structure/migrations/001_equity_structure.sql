BEGIN;

CREATE TABLE IF NOT EXISTS equity_structure_jobs (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    source_ext TEXT NOT NULL CHECK (source_ext IN ('png', 'jpg', 'jpeg', 'webp')),
    mime_type TEXT,
    file_size BIGINT,
    image_width INTEGER,
    image_height INTEGER,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'queued', 'running', 'completed', 'failed')),
    progress SMALLINT NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100),
    progress_message TEXT,
    source_path TEXT,
    source_sha256 TEXT,
    result_dir TEXT,
    summary_json JSONB,
    error_message TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS equity_structure_jobs_owner_created_idx
    ON equity_structure_jobs (owner_username, created_at DESC);

CREATE INDEX IF NOT EXISTS equity_structure_jobs_status_created_idx
    ON equity_structure_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS equity_structure_jobs_owner_sha_idx
    ON equity_structure_jobs (owner_username, source_sha256);

CREATE TABLE IF NOT EXISTS equity_structure_corrections (
    id BIGSERIAL PRIMARY KEY,
    owner_username TEXT NOT NULL,
    job_id UUID,
    original_name TEXT NOT NULL,
    corrected_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS equity_structure_corrections_owner_created_idx
    ON equity_structure_corrections (owner_username, created_at DESC);

COMMIT;
