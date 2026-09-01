-- Pozos keeps a Functional-only recurring schedule template, while admins may
-- intentionally create individual or bulk Pilates classes on the calendar.
BEGIN;

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
    RAISE EXCEPTION 'El horario recurrente de Pozos solo permite Funcional los lunes, miércoles y viernes a las 8:00 am.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pozos_functional_schedule_slot ON schedule_slots;
CREATE TRIGGER trg_pozos_functional_schedule_slot
BEFORE INSERT OR UPDATE OF branch_id, day_of_week, time_slot, class_type_id,
  class_type_name, apparatus, is_active ON schedule_slots
FOR EACH ROW EXECUTE FUNCTION enforce_pozos_functional_schedule_slot();

-- The former class trigger was too broad: it also rejected intentional admin
-- creation through “Nueva clase” and “Generar semana”.
DROP TRIGGER IF EXISTS trg_pozos_functional_scheduled_class ON classes;
DROP FUNCTION IF EXISTS enforce_pozos_functional_scheduled_class();

COMMIT;
