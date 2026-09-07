ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS walk_in_requires_inscription BOOLEAN NOT NULL DEFAULT true;

-- Cortesías totales seleccionadas por administración para el 7 de septiembre.
UPDATE classes
   SET walk_in_requires_inscription = false
 WHERE id IN (
   '58b9cd9e-0ac8-439f-b38b-e4ec5eeecb6a',
   '6da96abb-b428-49b9-95fc-5c42eb22588d',
   'faff01c2-26f8-45ac-8b07-f2d6dafef319'
 )
   AND is_walk_in = true;

CREATE INDEX IF NOT EXISTS idx_classes_walk_in
  ON classes (branch_id, date, is_walk_in)
  WHERE is_walk_in = true;
