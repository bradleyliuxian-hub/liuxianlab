BEGIN;

ALTER TABLE journal_entry_batch_outputs
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

ALTER TABLE journal_entry_split_outputs
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS journal_entry_batch_outputs_expired_idx
    ON journal_entry_batch_outputs (expired_at);

CREATE INDEX IF NOT EXISTS journal_entry_split_outputs_expired_idx
    ON journal_entry_split_outputs (expired_at);

COMMIT;
