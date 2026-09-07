ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_classes_walk_in
  ON classes (branch_id, date, is_walk_in)
  WHERE is_walk_in = true;
