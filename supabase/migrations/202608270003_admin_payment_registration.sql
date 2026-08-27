-- Columns used by the branch-scoped manual registration payment flow.
-- Kept idempotent because server/index.js also executes this migration at boot.

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(30) DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inscription_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_by UUID;

COMMIT;
