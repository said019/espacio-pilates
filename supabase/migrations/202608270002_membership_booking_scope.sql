-- Harden class booking membership isolation for existing multi-branch installs.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_booking_membership_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  class_branch UUID;
  membership_branch UUID;
  membership_user UUID;
  class_date DATE;
  class_program TEXT;
  membership_program TEXT;
  membership_plan_kind TEXT;
  class_category TEXT;
  membership_category TEXT;
  membership_state TEXT;
  membership_start_date DATE;
  membership_end_date DATE;
  membership_classes_remaining INTEGER;
  categories_match BOOLEAN;
BEGIN
  IF NEW.membership_id IS NULL OR NEW.status::text NOT IN ('confirmed','waitlist') THEN
    RETURN NEW;
  END IF;

  SELECT c.branch_id, c.date,
         CASE WHEN LOWER(COALESCE(ct.category, '')) IN ('funcional','functional') THEN 'functional'
              WHEN LOWER(COALESCE(ct.category, '')) = 'prenatal' THEN 'prenatal'
              ELSE 'pilates' END,
         CASE WHEN LOWER(COALESCE(ct.category, 'all')) = 'pilates' THEN 'reformer'
              WHEN LOWER(COALESCE(ct.category, 'all')) = 'functional' THEN 'funcional'
              ELSE LOWER(COALESCE(ct.category, 'all')) END
    INTO class_branch, class_date, class_program, class_category
    FROM classes c
    JOIN class_types ct ON ct.id = c.class_type_id
   WHERE c.id = NEW.class_id;

  SELECT m.branch_id, m.user_id, m.status::text, m.start_date, m.end_date,
         m.classes_remaining,
         CASE WHEN LOWER(COALESCE(p.program, 'pilates')) = 'funcional' THEN 'functional'
              WHEN LOWER(COALESCE(p.program, 'pilates')) IN ('reformer','studio','tower') THEN 'pilates'
              ELSE LOWER(COALESCE(p.program, 'pilates')) END,
         CASE WHEN LOWER(COALESCE(p.class_category, 'all')) = 'pilates' THEN 'reformer'
              WHEN LOWER(COALESCE(p.class_category, 'all')) = 'functional' THEN 'funcional'
              ELSE LOWER(COALESCE(p.class_category, 'all')) END,
         LOWER(COALESCE(p.plan_kind, 'single'))
    INTO membership_branch, membership_user, membership_state,
         membership_start_date, membership_end_date, membership_classes_remaining,
         membership_program, membership_category, membership_plan_kind
    FROM memberships m
    LEFT JOIN plans p ON p.id = m.plan_id
   WHERE m.id = NEW.membership_id;

  categories_match := CASE
    WHEN membership_category = 'prenatal' OR class_category = 'prenatal'
      THEN membership_category = 'prenatal' AND class_category = 'prenatal'
    WHEN membership_category IN ('all','mixto') OR class_category = 'all' THEN true
    ELSE membership_category = class_category
  END;

  -- Los chequeos de CONSUMO (membresía activa + créditos disponibles) solo aplican
  -- al CREAR una reserva (INSERT), NO al MOVERLA (reagendar = UPDATE de class_id):
  -- al reagendar el crédito ya se consumió al reservar, así que exigir
  -- classes_remaining > 0 (o status 'active') rompía el reagendado de cualquier
  -- alumna que ya usó todos sus créditos. Branch/programa/categoría/vigencia SÍ se
  -- validan siempre (no se puede mover a una clase incompatible ni fuera de vigencia).
  IF class_branch IS DISTINCT FROM membership_branch
     OR class_program IS DISTINCT FROM membership_program
     OR NEW.user_id IS DISTINCT FROM membership_user
     OR membership_plan_kind = 'registration'
     OR (membership_start_date IS NOT NULL AND membership_start_date > class_date)
     OR (membership_end_date IS NOT NULL AND membership_end_date < class_date)
     OR NOT COALESCE(categories_match, false)
     OR (TG_OP = 'INSERT' AND membership_state IS DISTINCT FROM 'active')
     OR (TG_OP = 'INSERT' AND membership_classes_remaining IS NOT NULL AND membership_classes_remaining <= 0) THEN
    RAISE EXCEPTION 'booking membership scope mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_booking_membership_scope ON bookings;
CREATE TRIGGER trg_booking_membership_scope
BEFORE INSERT OR UPDATE OF class_id, membership_id, user_id, status ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_membership_scope();

COMMIT;
