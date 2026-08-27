-- Regression test for branch/program/category/owner booking isolation.
-- Run only against a disposable database after schema_complete.sql and
-- 202608270001_multibranch_pozos.sql and
-- 202608270002_membership_booking_scope.sql. The transaction always rolls back.
--
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f supabase/tests/membership_scope.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_scope_rejection(statement TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected booking membership scope rejection';
EXCEPTION
  WHEN check_violation THEN
    IF SQLERRM <> 'booking membership scope mismatch' THEN
      RAISE;
    END IF;
END;
$$;

INSERT INTO users (id, email, phone, display_name, role)
VALUES
  ('33333333-3333-4333-8333-333333333333', 'scope-a@example.invalid', '+5210000000101', 'Scope Client A', 'client'),
  ('44444444-4444-4444-8444-444444444444', 'scope-b@example.invalid', '+5210000000102', 'Scope Client B', 'client'),
  ('55555555-5555-4555-8555-555555555555', 'scope-coach@example.invalid', '+5210000000103', 'Scope Coach', 'client');

INSERT INTO instructors (id, user_id, display_name, is_active)
VALUES (
  '66666666-6666-4666-8666-666666666666',
  '55555555-5555-4555-8555-555555555555',
  'Scope Coach',
  true
);

INSERT INTO plans
  (id, branch_id, code, program, plan_kind, name, price, duration_days,
   class_limit, class_category, is_active, sort_order)
VALUES
  ('77777777-7777-4777-8777-777777777777',
   '22222222-2222-4222-8222-222222222222', 'scope-test-barre', 'pilates',
   'package', 'Scope Test Barre', 1, 30, 7, 'barre', true, 999);

INSERT INTO memberships
  (id, user_id, plan_id, branch_id, status, classes_remaining, start_date, end_date)
SELECT 'd1111111-1111-4111-8111-111111111111'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 7, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '11111111-1111-4111-8111-111111111111' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd2222222-2222-4222-8222-222222222222'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 7, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd3333333-3333-4333-8333-333333333333'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, NULL, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'functional-unlimited'
UNION ALL
SELECT 'd4444444-4444-4444-8444-444444444444'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 7, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.id = '77777777-7777-4777-8777-777777777777'
UNION ALL
SELECT 'd5555555-5555-4555-8555-555555555555'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'cancelled'::membership_status, 7, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd6666666-6666-4666-8666-666666666666'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 7, DATE '2099-01-01', DATE '2099-09-01'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd7777777-7777-4777-8777-777777777777'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 7, DATE '2099-09-03', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd8888888-8888-4888-8888-888888888888'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, 0, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-7'
UNION ALL
SELECT 'd9999999-9999-4999-8999-999999999999'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid, p.id, p.branch_id,
       'active'::membership_status, NULL, DATE '2099-01-01', DATE '2099-12-31'
  FROM plans p
 WHERE p.branch_id = '22222222-2222-4222-8222-222222222222' AND p.code = 'pilates-registration';

-- Nine independent classes avoid uniqueness conflicts obscuring the trigger.
INSERT INTO classes
  (id, branch_id, class_type_id, instructor_id, date, start_time, end_time,
   max_capacity, current_bookings, status)
SELECT fixtures.id, fixtures.branch_id, ct.id,
       '66666666-6666-4666-8666-666666666666', DATE '2099-09-02',
       fixtures.start_time, fixtures.start_time + INTERVAL '55 minutes', 8, 0, 'scheduled'
  FROM (VALUES
    ('a1111111-1111-4111-8111-111111111111'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'pilates', TIME '08:00'),
    ('a2222222-2222-4222-8222-222222222222'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'functional', TIME '08:00'),
    ('a3333333-3333-4333-8333-333333333333'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pilates', TIME '09:00'),
    ('a4444444-4444-4444-8444-444444444444'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'functional', TIME '10:00'),
    ('a5555555-5555-4555-8555-555555555555'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pilates', TIME '11:00'),
    ('a6666666-6666-4666-8666-666666666666'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pilates', TIME '12:00'),
    ('a7777777-7777-4777-8777-777777777777'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'functional', TIME '13:00'),
    ('a8888888-8888-4888-8888-888888888888'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pilates', TIME '14:00'),
    ('a9999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pilates', TIME '15:00')
  ) AS fixtures(id, branch_id, program, start_time)
  JOIN LATERAL (
    SELECT id
      FROM class_types
     WHERE CASE
       WHEN fixtures.program = 'functional' THEN LOWER(category) IN ('funcional','functional')
       ELSE LOWER(name) LIKE '%pilates%'
     END
     ORDER BY id
     LIMIT 1
  ) ct ON true;

-- Positive controls: the canonical Pilates alias and Functional both work.
INSERT INTO bookings (id, class_id, user_id, membership_id, status)
VALUES
  ('b1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333', 'd1111111-1111-4111-8111-111111111111', 'confirmed'),
  ('b2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333', 'd3333333-3333-4333-8333-333333333333', 'confirmed'),
  ('b3333333-3333-4333-8333-333333333333', 'a9999999-9999-4999-8999-999999999999',
   '33333333-3333-4333-8333-333333333333', 'd2222222-2222-4222-8222-222222222222', 'confirmed');

-- Villa Magna membership -> Pozos class.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd1111111-1111-4111-8111-111111111111', 'confirmed')
$sql$);

-- Inactive, expired, not-yet-started, and exhausted memberships are invalid.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd5555555-5555-4555-8555-555555555555', 'confirmed')
$sql$);
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd6666666-6666-4666-8666-666666666666', 'confirmed')
$sql$);
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd7777777-7777-4777-8777-777777777777', 'confirmed')
$sql$);
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd8888888-8888-4888-8888-888888888888', 'confirmed')
$sql$);

-- Paying registration never grants class access by itself.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a3333333-3333-4333-8333-333333333333',
          '33333333-3333-4333-8333-333333333333',
          'd9999999-9999-4999-8999-999999999999', 'confirmed')
$sql$);

-- Pozos Pilates -> Pozos Functional, including the waitlist path.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a4444444-4444-4444-8444-444444444444',
          '33333333-3333-4333-8333-333333333333',
          'd2222222-2222-4222-8222-222222222222', 'waitlist')
$sql$);

-- Pozos Functional -> Pozos Pilates.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a5555555-5555-4555-8555-555555555555',
          '33333333-3333-4333-8333-333333333333',
          'd3333333-3333-4333-8333-333333333333', 'confirmed')
$sql$);

-- Same branch/program but wrong class category.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a6666666-6666-4666-8666-666666666666',
          '33333333-3333-4333-8333-333333333333',
          'd4444444-4444-4444-8444-444444444444', 'confirmed')
$sql$);

-- A client cannot use another client's membership.
SELECT pg_temp.expect_scope_rejection($sql$
  INSERT INTO bookings (class_id, user_id, membership_id, status)
  VALUES ('a8888888-8888-4888-8888-888888888888',
          '44444444-4444-4444-8444-444444444444',
          'd2222222-2222-4222-8222-222222222222', 'confirmed')
$sql$);

-- A valid booking cannot be moved to a class from another branch.
SELECT pg_temp.expect_scope_rejection($sql$
  UPDATE bookings
     SET class_id = 'a7777777-7777-4777-8777-777777777777'
   WHERE id = 'b1111111-1111-4111-8111-111111111111'
$sql$);

DO $$
DECLARE accepted_controls INTEGER;
BEGIN
  SELECT COUNT(*) INTO accepted_controls
    FROM bookings
   WHERE id IN (
     'b1111111-1111-4111-8111-111111111111',
     'b2222222-2222-4222-8222-222222222222',
     'b3333333-3333-4333-8333-333333333333'
   );
  IF accepted_controls <> 3 THEN
    RAISE EXCEPTION 'Expected 3 valid booking controls, got %', accepted_controls;
  END IF;
END;
$$;

SELECT 'membership scope regression passed' AS result;

ROLLBACK;
