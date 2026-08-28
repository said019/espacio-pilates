-- Regression test for the one-time September 2026 Pozos Pilates cleanup.
-- Run only against a disposable database after schema_complete.sql and the
-- versioned migrations through 202608270004_pozos_functional_schedule_only.sql.
-- This script intentionally commits because the migration under test owns its
-- transaction.
--
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" \
--     -f supabase/tests/pozos_september_pilates_cleanup.sql

\set ON_ERROR_STOP on

INSERT INTO users (id, email, phone, display_name, role)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'cleanup-client@example.invalid',
   '+5210000000201', 'Cleanup Client', 'client'),
  ('81000000-0000-4000-8000-000000000002', 'cleanup-coach@example.invalid',
   '+5210000000202', 'Cleanup Coach', 'client');

INSERT INTO instructors (id, user_id, display_name, is_active)
VALUES (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002',
  'Cleanup Coach', true
);

INSERT INTO class_types
  (id, name, description, category, capacity, duration_min, is_active, sort_order)
VALUES
  ('83000000-0000-4000-8000-000000000001', 'Pilates Cleanup Fixture',
   'Fixture Pilates', 'pilates', 8, 55, true, 901),
  ('83000000-0000-4000-8000-000000000002', 'Functional Cleanup Fixture',
   'Fixture Functional', 'functional', 8, 55, true, 902),
  ('83000000-0000-4000-8000-000000000003', 'Prenatal Cleanup Fixture',
   'Fixture Prenatal', 'prenatal', 8, 55, true, 903);

INSERT INTO classes
  (id, branch_id, class_type_id, instructor_id, date, start_time, end_time,
   max_capacity, current_bookings, status, apparatus)
VALUES
  -- The only class that the migration must remove.
  ('84000000-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222',
   '83000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '09:00', TIME '09:55', 8, 0, 'cancelled', 'reformer'),
  -- Same month and program, but Villa Magna must remain.
  ('84000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111',
   '83000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '09:00', TIME '09:55', 8, 0, 'scheduled', 'reformer'),
  -- Same branch and month, but Functional must remain.
  ('84000000-0000-4000-8000-000000000003',
   '22222222-2222-4222-8222-222222222222',
   '83000000-0000-4000-8000-000000000002',
   '82000000-0000-4000-8000-000000000001',
   DATE '2026-09-02', TIME '08:00', TIME '08:55', 8, 0, 'scheduled', 'functional'),
  -- Same branch and month, but Prenatal must remain.
  ('84000000-0000-4000-8000-000000000004',
   '22222222-2222-4222-8222-222222222222',
   '83000000-0000-4000-8000-000000000003',
   '82000000-0000-4000-8000-000000000001',
   DATE '2026-09-08', TIME '10:00', TIME '10:55', 8, 0, 'cancelled', 'reformer'),
  -- Same branch and program, but October must remain.
  ('84000000-0000-4000-8000-000000000005',
   '22222222-2222-4222-8222-222222222222',
   '83000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000001',
   DATE '2026-10-01', TIME '09:00', TIME '09:55', 8, 0, 'cancelled', 'reformer');

-- A booking of any status must make the migration fail closed. ON_ERROR_STOP is
-- disabled only for this expected exception; the assertions below prove that
-- the migration rolled back without deleting the class or its booking.
INSERT INTO bookings (id, class_id, user_id, status)
VALUES (
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'cancelled'
);

\set ON_ERROR_STOP off
\ir ../migrations/202608280001_remove_pozos_september_pilates_classes.sql
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM classes
     WHERE id = '84000000-0000-4000-8000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM bookings
     WHERE id = '85000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Cleanup guard did not roll back safely';
  END IF;
END $$;

DELETE FROM bookings
 WHERE id = '85000000-0000-4000-8000-000000000001';

\ir ../migrations/202608280001_remove_pozos_september_pilates_classes.sql

DO $$
DECLARE
  kept_controls INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM classes
     WHERE id = '84000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Pozos September Pilates fixture was not deleted';
  END IF;

  SELECT COUNT(*) INTO kept_controls
    FROM classes
   WHERE id IN (
     '84000000-0000-4000-8000-000000000002',
     '84000000-0000-4000-8000-000000000003',
     '84000000-0000-4000-8000-000000000004',
     '84000000-0000-4000-8000-000000000005'
   );

  IF kept_controls <> 4 THEN
    RAISE EXCEPTION 'Cleanup crossed branch, program, or month scope: kept %/4 controls', kept_controls;
  END IF;
END $$;

-- A second application must be a no-op.
\ir ../migrations/202608280001_remove_pozos_september_pilates_classes.sql

SELECT 'Pozos September Pilates cleanup regression passed' AS result;
