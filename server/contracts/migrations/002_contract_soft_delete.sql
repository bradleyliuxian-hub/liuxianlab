ALTER TABLE contracts
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS
idx_contracts_owner_active_created
ON contracts (
  owner_username,
  created_at DESC
)
WHERE deleted_at IS NULL;
