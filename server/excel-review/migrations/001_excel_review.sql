BEGIN;

-- Excel Review Assistant v1 (excel-review-v1)
--
-- Independent module. Does NOT touch the contracts schema.
-- Additive / idempotent / backward-compatible only.
--
-- One row = one Excel review job. A job moves through two phases:
--
--   extract:  source.xlsx            -> review.xlsx        (status review_ready)
--   apply:    uploaded-review.xlsx   -> final.xlsx         (status completed)
--
-- Files live under storage/excel-reviews/<id>/ and are served only
-- through owner-scoped APIs. No workbook content is stored here.

CREATE TABLE IF NOT EXISTS excel_review_jobs (

    id UUID PRIMARY KEY,

    owner_username TEXT NOT NULL,

    original_filename TEXT NOT NULL,

    status TEXT NOT NULL
        DEFAULT 'queued'
        CHECK (
            status IN (
                'queued',
                'processing',
                'review_ready',
                'applying_replies',
                'completed',
                'failed'
            )
        ),

    phase TEXT NOT NULL
        DEFAULT 'extract'
        CHECK (
            phase IN (
                'extract',
                'apply'
            )
        ),

    progress SMALLINT NOT NULL
        DEFAULT 0
        CHECK (
            progress >= 0
            AND progress <= 100
        ),

    progress_message TEXT,

    item_count INTEGER
        CHECK (
            item_count IS NULL
            OR item_count >= 0
        ),

    reply_count INTEGER
        CHECK (
            reply_count IS NULL
            OR reply_count >= 0
        ),

    source_path TEXT,

    review_path TEXT,

    final_path TEXT,

    source_sha256 TEXT,

    mapping_version TEXT,

    review_token TEXT,

    error_message TEXT,

    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


CREATE INDEX IF NOT EXISTS
    excel_review_jobs_owner_created_idx
ON excel_review_jobs (
    owner_username,
    created_at DESC
);


CREATE INDEX IF NOT EXISTS
    excel_review_jobs_status_created_idx
ON excel_review_jobs (
    status,
    created_at
);


COMMIT;
