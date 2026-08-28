-- Tu Espacio Pilates: remove the accidental Pozos Pilates calendar for
-- September 2026. This is deliberately narrower than the permanent schedule
-- guard: Villa Magna, Functional, Prenatal, plans, and schedule slots are not
-- modified.
BEGIN;

-- Freeze class inserts/status changes while the exact cleanup set is
-- materialized. The lock is held only for this short migration transaction.
LOCK TABLE classes IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE pozos_sep_2026_pilates_cleanup_target
ON COMMIT DROP
AS
SELECT c.id
  FROM classes c
  JOIN branches br ON br.id = c.branch_id
  JOIN class_types ct ON ct.id = c.class_type_id
 WHERE br.code = 'pozos'
   AND c.date >= DATE '2026-09-01'
   AND c.date < DATE '2026-10-01'
   -- Functional and Prenatal are explicit programs. Every other class type is
   -- part of the Pilates calendar (for example Pilates Mat or Barre Studio).
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

ALTER TABLE pozos_sep_2026_pilates_cleanup_target
  ADD PRIMARY KEY (id);

DO $$
DECLARE
  has_reschedule_audit BOOLEAN := false;
BEGIN
  -- Lock the exact class rows before checking their status and dependants. A
  -- concurrent booking insert then waits and cannot be silently cascade-deleted.
  PERFORM c.id
    FROM classes c
    JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = c.id
     FOR UPDATE OF c;

  IF EXISTS (
    SELECT 1
      FROM classes c
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = c.id
     WHERE c.status::text IS DISTINCT FROM 'cancelled'
        OR COALESCE(c.current_bookings, 0) <> 0
  ) THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Pozos: existe una clase activa o con reservaciones contabilizadas.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM bookings b
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = b.class_id
    UNION ALL
    SELECT 1 FROM guest_bookings gb
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = gb.class_id
    UNION ALL
    SELECT 1 FROM checkin_logs cl
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = cl.class_id
    UNION ALL
    SELECT 1 FROM reviews r
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = r.class_id
    UNION ALL
    SELECT 1 FROM review_requests rr
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = rr.class_id
    UNION ALL
    SELECT 1 FROM coach_substitutions cs
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = cs.class_id
    UNION ALL
    SELECT 1 FROM class_substitutions cs
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = cs.class_id
    UNION ALL
    SELECT 1 FROM class_workouts cw
      JOIN pozos_sep_2026_pilates_cleanup_target target ON target.id = cw.class_id
  ) THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Pozos: existe información de reservas o actividad asociada.';
  END IF;

  -- booking_reschedules is created by the runtime bootstrap on older/fresh
  -- databases, so guard its audit IDs only when the table already exists.
  IF to_regclass('public.booking_reschedules') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE booking_reschedules IN SHARE ROW EXCLUSIVE MODE';
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
          FROM booking_reschedules r
          JOIN pozos_sep_2026_pilates_cleanup_target target
            ON target.id IN (r.from_class_id, r.to_class_id)
      )
    $query$ INTO has_reschedule_audit;
  END IF;

  IF has_reschedule_audit THEN
    RAISE EXCEPTION
      'No se eliminaron las clases de Pilates de Pozos: existe historial de reprogramación asociado.';
  END IF;
END $$;

DO $$
DECLARE
  expected_count INTEGER;
  deleted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_count
    FROM pozos_sep_2026_pilates_cleanup_target;

  DELETE FROM classes c
   USING pozos_sep_2026_pilates_cleanup_target target
   WHERE c.id = target.id
     AND c.status::text = 'cancelled'
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
      'No se completó la limpieza de clases de Pilates de septiembre en Pozos: se esperaban %, se eliminaron %.',
      expected_count, deleted_count;
  END IF;
END $$;

COMMIT;
