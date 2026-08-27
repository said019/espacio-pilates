-- Tu Espacio Pilates: el calendario de Pozos publica únicamente Funcional.
-- Los planes y servicios de Pilates permanecen disponibles; esta migración
-- modifica solo slots y clases del horario.
BEGIN;

-- Fresh databases receive this column later in the legacy bootstrap. Create it
-- here because the schedule cleanup needs to identify Functional classes.
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS apparatus VARCHAR(20) DEFAULT 'reformer';

-- No ocultar una clase que ya tenga una reserva activa. El despliegue hace
-- también un preflight inmediato, pero esta defensa evita estados huérfanos si
-- apareciera una reserva entre la revisión y la transacción.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM classes c
      JOIN branches br ON br.id = c.branch_id
      LEFT JOIN class_types ct ON ct.id = c.class_type_id
      JOIN bookings bk ON bk.class_id = c.id
     WHERE br.code = 'pozos'
       AND c.date >= CURRENT_DATE
       AND c.status = 'scheduled'
       AND bk.status IN ('confirmed', 'waitlist', 'checked_in')
       AND NOT (
         (
           LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
           OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
           OR LOWER(COALESCE(c.apparatus, '')) IN ('functional', 'funcional')
         )
         AND EXTRACT(ISODOW FROM c.date)::integer IN (1, 3, 5)
         AND c.start_time::time = TIME '08:00'
       )
  ) THEN
    RAISE EXCEPTION 'No se cambió el horario de Pozos: hay reservas activas en clases fuera del horario Funcional.';
  END IF;
END $$;

-- Mantener activos únicamente los slots Funcional de lunes, miércoles y
-- viernes a las 8:00 am. Los registros se conservan para auditoría.
UPDATE schedule_slots ss
   SET is_active = (
         (
           LOWER(COALESCE(ss.class_type_name, '')) IN ('functional', 'funcional')
           OR LOWER(COALESCE(ss.apparatus, '')) IN ('functional', 'funcional')
           OR EXISTS (
             SELECT 1
               FROM class_types ct
              WHERE ct.id = ss.class_type_id
                AND (
                  LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
                  OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
                )
           )
         )
         AND ss.day_of_week IN (1, 3, 5)
         AND LOWER(BTRIM(ss.time_slot)) = '8:00 am'
       )
  FROM branches br
 WHERE ss.branch_id = br.id
   AND br.code = 'pozos'
   AND ss.is_active IS DISTINCT FROM (
         (
           LOWER(COALESCE(ss.class_type_name, '')) IN ('functional', 'funcional')
           OR LOWER(COALESCE(ss.apparatus, '')) IN ('functional', 'funcional')
           OR EXISTS (
             SELECT 1
               FROM class_types ct
              WHERE ct.id = ss.class_type_id
                AND (
                  LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
                  OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
                )
           )
         )
         AND ss.day_of_week IN (1, 3, 5)
         AND LOWER(BTRIM(ss.time_slot)) = '8:00 am'
       );

-- Conservar el historial. Solo se cancelan las clases futuras fuera del
-- horario Funcional canónico; el preflight anterior garantiza cero reservas.
UPDATE classes c
   SET status = 'cancelled',
       cancellation_reason = COALESCE(
         NULLIF(BTRIM(c.cancellation_reason), ''),
         'El horario de Pozos muestra únicamente Funcional.'
       ),
       cancelled_at = COALESCE(c.cancelled_at, NOW()),
       updated_at = NOW()
  FROM branches br
 WHERE c.branch_id = br.id
   AND br.code = 'pozos'
   AND c.date >= CURRENT_DATE
   AND c.status = 'scheduled'
   AND NOT (
     (
       LOWER(COALESCE(c.apparatus, '')) IN ('functional', 'funcional')
       OR EXISTS (
         SELECT 1
           FROM class_types ct
          WHERE ct.id = c.class_type_id
            AND (
              LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
              OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
            )
       )
     )
     AND EXTRACT(ISODOW FROM c.date)::integer IN (1, 3, 5)
     AND c.start_time::time = TIME '08:00'
   );

-- Protect every admin/API write path without affecting the Pilates plans sold
-- for Pozos. Only active schedule slots and scheduled classes are restricted.
CREATE OR REPLACE FUNCTION enforce_pozos_functional_schedule_slot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  branch_code TEXT;
  type_is_functional BOOLEAN;
BEGIN
  SELECT code INTO branch_code FROM branches WHERE id = NEW.branch_id;
  IF branch_code <> 'pozos' OR COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM class_types ct
     WHERE ct.id = NEW.class_type_id
       AND (
         LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
         OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
       )
  ) INTO type_is_functional;

  IF NOT (
    (
      LOWER(COALESCE(NEW.class_type_name, '')) IN ('functional', 'funcional')
      OR LOWER(COALESCE(NEW.apparatus, '')) IN ('functional', 'funcional')
      OR type_is_functional
    )
    AND NEW.day_of_week IN (1, 3, 5)
    AND LOWER(BTRIM(NEW.time_slot)) = '8:00 am'
  ) THEN
    RAISE EXCEPTION 'El horario de Pozos solo permite Funcional los lunes, miércoles y viernes a las 8:00 am.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pozos_functional_schedule_slot ON schedule_slots;
CREATE TRIGGER trg_pozos_functional_schedule_slot
BEFORE INSERT OR UPDATE OF branch_id, day_of_week, time_slot, class_type_id,
  class_type_name, apparatus, is_active ON schedule_slots
FOR EACH ROW EXECUTE FUNCTION enforce_pozos_functional_schedule_slot();

CREATE OR REPLACE FUNCTION enforce_pozos_functional_scheduled_class()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  branch_code TEXT;
  type_is_functional BOOLEAN;
BEGIN
  SELECT code INTO branch_code FROM branches WHERE id = NEW.branch_id;
  IF branch_code <> 'pozos' OR NEW.status::text <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM class_types ct
     WHERE ct.id = NEW.class_type_id
       AND (
         LOWER(COALESCE(ct.name, '')) IN ('functional', 'funcional')
         OR LOWER(COALESCE(ct.category, '')) IN ('functional', 'funcional')
       )
  ) INTO type_is_functional;

  IF NOT (
    (LOWER(COALESCE(NEW.apparatus, '')) IN ('functional', 'funcional') OR type_is_functional)
    AND EXTRACT(ISODOW FROM NEW.date)::integer IN (1, 3, 5)
    AND NEW.start_time::time = TIME '08:00'
  ) THEN
    RAISE EXCEPTION 'El calendario de Pozos solo permite clases de Funcional los lunes, miércoles y viernes a las 8:00 am.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pozos_functional_scheduled_class ON classes;
CREATE TRIGGER trg_pozos_functional_scheduled_class
BEFORE INSERT OR UPDATE OF branch_id, class_type_id, date, start_time,
  apparatus, status ON classes
FOR EACH ROW EXECUTE FUNCTION enforce_pozos_functional_scheduled_class();

COMMIT;
