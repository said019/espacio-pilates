-- Tu Espacio Pilates: remove the Villa Magna Pilates calendar for September
-- 2026 while preserving Prenatal, other months, Pozos, plans, and schedule
-- slots. A trigger prevents those fixed-date classes from being recreated.
BEGIN;

-- Freeze class inserts/status changes while the exact cleanup set is
-- materialized. The lock is held only for this short migration transaction.
LOCK TABLE classes IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE villa_magna_sep_2026_pilates_cleanup_target
ON COMMIT DROP
AS
SELECT c.id
  FROM classes c
  JOIN branches br ON br.id = c.branch_id
  JOIN class_types ct ON ct.id = c.class_type_id
 WHERE br.code = 'villa-magna'
   AND c.date >= DATE '2026-09-01'
   AND c.date < DATE '2026-10-01'
   AND NOT (
     LOWER(BTRIM(COALESCE(ct.name, ''))) LIKE '%functional%'
     OR LOWER(BTRIM(COALESCE(ct.name, ''))) LIKE '%funcional%'
     OR LOWER(BTRIM(COALESCE(ct.category, ''))) IN ('functional', 'funcional')
     OR LOWER(BTRIM(COALESCE(c.apparatus, ''))) IN ('functional', 'funcional')
   )
   AND NOT (
     LOWER(BTRIM(COALESCE(ct.name, ''))) LIKE '%prenatal%'
     OR LOWER(BTRIM(COALESCE(ct.category, ''))) = 'prenatal'
     OR LOWER(BTRIM(COALESCE(c.apparatus, ''))) = 'prenatal'
   );

ALTER TABLE villa_magna_sep_2026_pilates_cleanup_target
  ADD PRIMARY KEY (id);

DO $$
DECLARE
  has_reschedule_audit BOOLEAN := false;
BEGIN
  PERFORM c.id
    FROM classes c
    JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = c.id
     FOR UPDATE OF c;

  -- Future scheduled/cancelled rows are safe to remove after the dependency
  -- checks below. Any unexpected historical status fails closed.
  IF EXISTS (
    SELECT 1
      FROM classes c
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = c.id
     WHERE c.status::text NOT IN ('scheduled', 'cancelled')
        OR COALESCE(c.current_bookings, 0) <> 0
  ) THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Villa Magna: existe una clase histórica o con reservaciones contabilizadas.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM bookings b
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = b.class_id
    UNION ALL
    SELECT 1 FROM guest_bookings gb
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = gb.class_id
    UNION ALL
    SELECT 1 FROM checkin_logs cl
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = cl.class_id
    UNION ALL
    SELECT 1 FROM reviews r
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = r.class_id
    UNION ALL
    SELECT 1 FROM review_requests rr
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = rr.class_id
    UNION ALL
    SELECT 1 FROM coach_substitutions cs
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = cs.class_id
    UNION ALL
    SELECT 1 FROM class_substitutions cs
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = cs.class_id
    UNION ALL
    SELECT 1 FROM class_workouts cw
      JOIN villa_magna_sep_2026_pilates_cleanup_target target ON target.id = cw.class_id
  ) THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Villa Magna: existe información de reservas o actividad asociada.';
  END IF;

  IF to_regclass('public.booking_reschedules') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE booking_reschedules IN SHARE ROW EXCLUSIVE MODE';
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
          FROM booking_reschedules r
          JOIN villa_magna_sep_2026_pilates_cleanup_target target
            ON target.id IN (r.from_class_id, r.to_class_id)
      )
    $query$ INTO has_reschedule_audit;
  END IF;

  IF has_reschedule_audit THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Villa Magna: existe historial de reprogramación asociado.';
  END IF;
END $$;

DO $$
DECLARE
  expected_count INTEGER;
  deleted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_count
    FROM villa_magna_sep_2026_pilates_cleanup_target;

  DELETE FROM classes c
   USING villa_magna_sep_2026_pilates_cleanup_target target
   WHERE c.id = target.id
     AND c.status::text IN ('scheduled', 'cancelled')
     AND COALESCE(c.current_bookings, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM guest_bookings gb WHERE gb.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM checkin_logs cl WHERE cl.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM review_requests rr WHERE rr.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM coach_substitutions cs WHERE cs.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM class_substitutions cs WHERE cs.class_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM class_workouts cw WHERE cw.class_id = c.id);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> expected_count THEN
    RAISE EXCEPTION
      'No se completó la limpieza de Pilates de septiembre en Villa Magna: se esperaban %, se eliminaron %.',
      expected_count, deleted_count;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_villa_magna_september_pilates_blackout()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  branch_code TEXT;
  type_name TEXT;
  type_category TEXT;
BEGIN
  IF NEW.date < DATE '2026-09-01'
     OR NEW.date >= DATE '2026-10-01'
     OR NEW.status::text IS DISTINCT FROM 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT code INTO branch_code FROM branches WHERE id = NEW.branch_id;
  IF branch_code <> 'villa-magna' THEN
    RETURN NEW;
  END IF;

  SELECT name, category INTO type_name, type_category
    FROM class_types
   WHERE id = NEW.class_type_id;

  IF NOT (
       LOWER(BTRIM(COALESCE(type_name, ''))) LIKE '%functional%'
       OR LOWER(BTRIM(COALESCE(type_name, ''))) LIKE '%funcional%'
       OR LOWER(BTRIM(COALESCE(type_category, ''))) IN ('functional', 'funcional')
       OR LOWER(BTRIM(COALESCE(NEW.apparatus, ''))) IN ('functional', 'funcional')
     )
     AND NOT (
       LOWER(BTRIM(COALESCE(type_name, ''))) LIKE '%prenatal%'
       OR LOWER(BTRIM(COALESCE(type_category, ''))) = 'prenatal'
       OR LOWER(BTRIM(COALESCE(NEW.apparatus, ''))) = 'prenatal'
     ) THEN
    RAISE EXCEPTION
      'Villa Magna no tendrá clases de Pilates durante septiembre de 2026.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_villa_magna_september_pilates_blackout ON classes;
CREATE TRIGGER trg_villa_magna_september_pilates_blackout
BEFORE INSERT OR UPDATE OF branch_id, class_type_id, date, apparatus, status ON classes
FOR EACH ROW EXECUTE FUNCTION enforce_villa_magna_september_pilates_blackout();

COMMIT;
