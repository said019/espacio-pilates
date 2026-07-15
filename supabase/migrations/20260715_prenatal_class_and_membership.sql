-- Programa Prenatal · inicia agosto 2026
-- Martes y jueves 18:30 · membresía exclusiva de 7 clases por $1,180 MXN.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS starts_on DATE;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'plans'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE plans DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'class_types'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE class_types DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE class_types
   SET subtitle = 'Martes y jueves · 6:30 pm',
       description = 'Pilates prenatal con acompañamiento especializado y grupos pequeños.',
       category = 'prenatal', intensity = 'ligera', level = 'all',
       duration_min = 55, capacity = 8, color = '#D9B5BA', emoji = '🤰',
       sort_order = 2, is_active = true, updated_at = NOW()
 WHERE name = 'Prenatal';

INSERT INTO class_types
  (name, subtitle, description, category, intensity, level, duration_min,
   capacity, color, emoji, sort_order, is_active)
SELECT
  'Prenatal', 'Martes y jueves · 6:30 pm',
  'Pilates prenatal con acompañamiento especializado y grupos pequeños.',
  'prenatal', 'ligera', 'all', 55, 8, '#D9B5BA', '🤰', 2, true
WHERE NOT EXISTS (SELECT 1 FROM class_types WHERE name = 'Prenatal');

UPDATE plans
   SET description = '7 clases de Pilates Prenatal, martes y jueves a las 6:30 pm.',
       price = 1180, currency = 'MXN', duration_days = 30, class_limit = 7,
       class_category = 'prenatal', starts_on = DATE '2026-08-01',
       features = '["7 clases Prenatal","Martes y jueves · 6:30 pm","Uso exclusivo en clases Prenatal","Vigencia: hasta fin de mes"]'::jsonb,
       is_active = true, sort_order = 4, updated_at = NOW()
 WHERE name = 'Prenatal';

INSERT INTO plans
  (name, description, price, currency, duration_days, class_limit,
   class_category, starts_on, features, is_active, sort_order)
SELECT
  'Prenatal', '7 clases de Pilates Prenatal, martes y jueves a las 6:30 pm.',
  1180, 'MXN', 30, 7, 'prenatal', DATE '2026-08-01',
  '["7 clases Prenatal","Martes y jueves · 6:30 pm","Uso exclusivo en clases Prenatal","Vigencia: hasta fin de mes"]'::jsonb,
  true, 4
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Prenatal');

INSERT INTO schedule_slots
  (time_slot, day_of_week, class_type_id, class_type_name, apparatus, starts_on, is_active)
SELECT
  '6:30 pm', weekday, ct.id, 'Prenatal', 'reformer', DATE '2026-08-01', true
FROM class_types ct
CROSS JOIN (VALUES (2), (4)) AS days(weekday)
WHERE ct.name = 'Prenatal'
  AND NOT EXISTS (
    SELECT 1 FROM schedule_slots ss
     WHERE ss.day_of_week = weekday
       AND ss.time_slot = '6:30 pm'
       AND ss.is_active = true
  );

-- Materializa las clases de agosto; el generador recurrente continuará usando
-- los schedule_slots para los meses posteriores.
INSERT INTO classes
  (class_type_id, instructor_id, date, start_time, end_time,
   max_capacity, current_bookings, status, apparatus)
SELECT
  ct.id, instructor.id, day::date, TIME '18:30', TIME '19:25',
  8, 0, 'scheduled', 'reformer'
FROM generate_series(DATE '2026-08-01', DATE '2026-08-31', INTERVAL '1 day') AS day
CROSS JOIN LATERAL (
  SELECT id FROM class_types WHERE name = 'Prenatal' AND is_active = true LIMIT 1
) ct
CROSS JOIN LATERAL (
  SELECT id FROM instructors WHERE is_active = true ORDER BY created_at ASC LIMIT 1
) instructor
WHERE EXTRACT(DOW FROM day) IN (2, 4)
  AND NOT EXISTS (
    SELECT 1 FROM classes c
     WHERE c.class_type_id = ct.id
       AND c.date = day::date
       AND c.start_time = TIME '18:30'
  );
