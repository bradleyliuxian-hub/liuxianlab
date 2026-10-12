BEGIN;


CREATE TABLE IF NOT EXISTS contracts (

    id UUID PRIMARY KEY,

    owner_username TEXT NOT NULL,

    original_name TEXT NOT NULL,

    stored_name TEXT NOT NULL
        DEFAULT 'source.pdf',

    file_path TEXT NOT NULL,

    size_bytes BIGINT NOT NULL
        CHECK (size_bytes >= 0),

    mime_type TEXT NOT NULL,

    status TEXT NOT NULL
        DEFAULT 'queued'
        CHECK (
            status IN (
                'queued',
                'processing',
                'completed',
                'failed'
            )
        ),

    stage TEXT NOT NULL
        DEFAULT 'queued'
        CHECK (
            stage IN (
                'queued',
                'parsing',
                'extracting',
                'reviewing',
                'completed',
                'failed'
            )
        ),

    progress SMALLINT NOT NULL
        DEFAULT 0
        CHECK (
            progress >= 0
            AND progress <= 100
        ),

    language TEXT,

    page_count INTEGER
        CHECK (
            page_count IS NULL
            OR page_count >= 0
        ),

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


CREATE INDEX IF NOT EXISTS
    contracts_owner_created_idx
ON contracts (
    owner_username,
    created_at DESC
);


CREATE INDEX IF NOT EXISTS
    contracts_status_created_idx
ON contracts (
    status,
    created_at
);


CREATE INDEX IF NOT EXISTS
    contracts_stage_created_idx
ON contracts (
    stage,
    created_at
);


COMMIT;
