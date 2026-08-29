-- Regression test for the September 2026 Villa Magna Pilates cleanup and
-- recreation guard. Run only against a disposable database after the schema
-- and migrations through 202608280001.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_blackout_rejection(statement TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected Villa Magna September Pilates blackout rejection';
EXCEPTION
  WHEN check_violation THEN
    IF SQLERRM <> 'Villa Magna no tendrá clases de Pilates durante septiembre de 2026.' THEN
      RAISE;
    END IF;
END;
$$;

INSERT INTO users (id, email, phone, display_name, role)
VALUES
  ('91000000-0000-4000-8000-000000000001', 'vm-cleanup-client@example.invalid',
   '+5210000000301', 'VM Cleanup Client', 'client'),
  ('91000000-0000-4000-8000-000000000002', 'vm-cleanup-coach@example.invalid',
   '+5210000000302', 'VM Cleanup Coach', 'client');

INSERT INTO instructors (id, user_id, display_name, is_active)
VALUES (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'VM Cleanup Coach', true
);

INSERT INTO class_types
  (id, name, description, category, capacity, duration_min, is_active, sort_order)
VALUES
  ('93000000-0000-4000-8000-000000000001', 'VM Pilates Cleanup Fixture',
   'Fixture Pilates', 'pilates', 8, 55, true, 911),
  ('93000000-0000-4000-8000-000000000002', 'VM Functional Cleanup Fixture',
   'Fixture Functional', 'functional', 8, 55, true, 912),
  ('93000000-0000-4000-8000-000000000003', 'VM Prenatal Cleanup Fixture',
   'Fixture Prenatal', 'prenatal', 8, 55, true, 913);

INSERT INTO classes
  (id, branch_id, class_type_id, instructor_id, date, start_time, end_time,
   max_capacity, current_bookings, status, apparatus)
VALUES
  -- Both scheduled and cancelled Villa Magna Pilates rows must be removed.
  ('94000000-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '09:00', TIME '09:55', 8, 0, 'scheduled', 'reformer'),
  ('94000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-09', TIME '09:00', TIME '09:55', 8, 0, 'cancelled', 'tower'),
  -- Villa Magna Prenatal and Functional in September remain.
  ('94000000-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000003',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '18:30', TIME '19:25', 8, 0, 'scheduled', 'reformer'),
  ('94000000-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000002',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '08:00', TIME '08:55', 8, 0, 'scheduled', 'functional'),
  -- Villa Magna Pilates outside September remains.
  ('94000000-0000-4000-8000-000000000005',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-10-01', TIME '09:00', TIME '09:55', 8, 0, 'scheduled', 'reformer'),
  -- The migration must never cross into Pozos.
  ('94000000-0000-4000-8000-000000000006',
   '22222222-2222-4222-8222-222222222222',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '09:00', TIME '09:55', 8, 0, 'cancelled', 'reformer');

-- Any booking history must fail closed and roll back the full migration.
INSERT INTO bookings (id, class_id, user_id, status)
VALUES (
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'cancelled'
);

\set ON_ERROR_STOP off
\ir ../migrations/202608280002_remove_villa_magna_september_pilates_classes.sql
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = '94000000-0000-4000-8000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM classes WHERE id = '94000000-0000-4000-8000-000000000002')
     OR NOT EXISTS (SELECT 1 FROM bookings WHERE id = '95000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Villa Magna cleanup guard did not roll back safely';
  END IF;
END $$;

DELETE FROM bookings
 WHERE id = '95000000-0000-4000-8000-000000000001';

\ir ../migrations/202608280002_remove_villa_magna_september_pilates_classes.sql

DO $$
DECLARE
  removed_targets INTEGER;
  kept_controls INTEGER;
BEGIN
  SELECT COUNT(*) INTO removed_targets
    FROM classes
   WHERE id IN (
     '94000000-0000-4000-8000-000000000001',
     '94000000-0000-4000-8000-000000000002'
   );
  IF removed_targets <> 0 THEN
    RAISE EXCEPTION 'Expected both Villa Magna September Pilates fixtures removed';
  END IF;

  SELECT COUNT(*) INTO kept_controls
    FROM classes
   WHERE id IN (
     '94000000-0000-4000-8000-000000000003',
     '94000000-0000-4000-8000-000000000004',
     '94000000-0000-4000-8000-000000000005',
     '94000000-0000-4000-8000-000000000006'
   );
  IF kept_controls <> 4 THEN
    RAISE EXCEPTION 'Villa Magna cleanup crossed program, month, or branch scope: kept %/4 controls', kept_controls;
  END IF;
END $$;

SELECT pg_temp.expect_blackout_rejection($sql$
  INSERT INTO classes
    (id, branch_id, class_type_id, instructor_id, date, start_time, end_time,
     max_capacity, status, apparatus)
  VALUES
    ('96000000-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111',
     '93000000-0000-4000-8000-000000000001',
     '92000000-0000-4000-8000-000000000001',
     DATE '2026-09-15', TIME '09:00', TIME '09:55', 8, 'scheduled', 'reformer')
$sql$);

-- A second application is a no-op and recreates the guard idempotently.
\ir ../migrations/202608280002_remove_villa_magna_september_pilates_classes.sql

-- The final runtime migration removes the broad trigger: automatic generation
-- is skipped in server code, while an admin can intentionally add a class.
\ir ../migrations/202608290001_allow_manual_villa_magna_september_classes.sql

INSERT INTO classes
  (id, branch_id, class_type_id, instructor_id, date, start_time, end_time,
   max_capacity, status, apparatus)
VALUES
  ('96000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111',
   '93000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001',
   DATE '2026-09-15', TIME '10:00', TIME '10:55', 8, 'scheduled', 'reformer');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM classes
     WHERE id = '96000000-0000-4000-8000-000000000002'
       AND status = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'Manual Villa Magna September class generation should be allowed';
  END IF;
END $$;

-- The permission migration is also safe to reapply.
\ir ../migrations/202608290001_allow_manual_villa_magna_september_classes.sql

SELECT 'Villa Magna September Pilates cleanup regression passed' AS result;
