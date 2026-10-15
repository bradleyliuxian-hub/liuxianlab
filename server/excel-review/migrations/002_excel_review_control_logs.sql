BEGIN;

-- Excel Review Assistant V1.4 (excel-review-v1.4) - Multi-file Control Log.
--
-- Additive / idempotent / backward-compatible. Does NOT touch the contracts
-- schema and does NOT modify excel_review_jobs.
--
-- One excel_review_jobs row = one Excel file (unchanged).
-- One excel_review_control_logs row = a snapshot aggregation of N jobs.
--
-- Deleting a Control Log must never delete the source jobs, so the relation
-- table stores the job id as a plain UUID (no FK / no cascade). The Control
-- Log keeps its own snapshot files and stays usable even after a source job
-- is removed.

CREATE TABLE IF NOT EXISTS excel_review_control_logs (

    id UUID PRIMARY KEY,

    owner_username TEXT NOT NULL,

    name TEXT NOT NULL,

    status TEXT NOT NULL
        DEFAULT 'processing'
        CHECK (
            status IN (
                'processing',
                'review_ready',
                'failed'
            )
        ),

    file_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (file_count >= 0),

    question_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (question_count >= 0),

    threaded_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (threaded_count >= 0),

    legacy_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (legacy_count >= 0),

    author_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (author_count >= 0),

    snapshot_path TEXT,

    control_log_path TEXT,

    error_message TEXT,

    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


CREATE INDEX IF NOT EXISTS
    excel_review_control_logs_owner_created_idx
ON excel_review_control_logs (
    owner_username,
    created_at DESC
);


CREATE TABLE IF NOT EXISTS excel_review_control_log_jobs (

    control_log_id UUID NOT NULL
        REFERENCES excel_review_control_logs (id)
        ON DELETE CASCADE,

    -- Plain UUID: a source job may be deleted independently and the
    -- relation simply becomes a historical reference. No FK / no cascade,
    -- so deleting a job never blocks or breaks the Control Log.
    excel_review_job_id UUID NOT NULL,

    added_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    PRIMARY KEY (control_log_id, excel_review_job_id)

);


CREATE INDEX IF NOT EXISTS
    excel_review_control_log_jobs_job_idx
ON excel_review_control_log_jobs (
    excel_review_job_id
);


COMMIT;
