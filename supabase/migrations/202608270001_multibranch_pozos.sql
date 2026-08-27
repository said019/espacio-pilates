-- Tu Espacio Pilates: multi-sucursal, catálogo por programa y apertura Pozos.
-- Es intencionalmente idempotente porque server/index.js también lo ejecuta al
-- arrancar (los despliegues actuales no tienen un runner de migraciones).
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS branches (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code       VARCHAR(50) NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  address    TEXT,
  phone      VARCHAR(30),
  timezone   VARCHAR(80) NOT NULL DEFAULT 'America/Mexico_City',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO branches (id, code, name, address, phone, timezone, is_active, sort_order)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'villa-magna', 'Villa Magna',
   'Av. Villa Magna Nte. 600 A, Villa Magna, 78183 San Luis Potosí, S.L.P.', '4445480352',
   'America/Mexico_City', true, 1),
  ('22222222-2222-4222-8222-222222222222', 'pozos', 'Pozos', NULL, NULL,
   'America/Mexico_City', true, 2)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    timezone = EXCLUDED.timezone,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

-- Defaults preserve every legacy caller as Villa Magna while API callers are
-- migrated to send an explicit branch.
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS program VARCHAR(30) NOT NULL DEFAULT 'pilates';

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS code VARCHAR(100);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS program VARCHAR(30) NOT NULL DEFAULT 'pilates';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_kind VARCHAR(30) NOT NULL DEFAULT 'single';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_category VARCHAR(30) DEFAULT 'pilates';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_admin_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS discount_price NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_slot       VARCHAR(20) NOT NULL,
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  class_type_id   UUID REFERENCES class_types(id) ON DELETE SET NULL,
  class_type_name VARCHAR(100),
  instructor_name VARCHAR(100),
  apparatus       VARCHAR(20) DEFAULT 'reformer',
  starts_on       DATE,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE schedule_slots
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS class_type_name VARCHAR(100);
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS instructor_name VARCHAR(100);
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS apparatus VARCHAR(20) DEFAULT 'reformer';
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS order_plan_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price  DECIMAL(10,2) NOT NULL,
  line_total  DECIMAL(10,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE order_plan_items
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id)
  DEFAULT '11111111-1111-4111-8111-111111111111';
ALTER TABLE order_plan_items ADD COLUMN IF NOT EXISTS program VARCHAR(30) NOT NULL DEFAULT 'pilates';

CREATE TABLE IF NOT EXISTS enrollments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  program          VARCHAR(30) NOT NULL,
  registration_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  registration_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, branch_id, program)
);

-- Historical ownership is unambiguously Villa Magna.
UPDATE facilities SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE schedules SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE classes SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE memberships SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE orders SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE plans SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE schedule_slots SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;
UPDATE order_plan_items SET branch_id = '11111111-1111-4111-8111-111111111111' WHERE branch_id IS NULL;

-- Stable metadata for legacy SKUs. Unknown products keep a deterministic code.
UPDATE plans SET code = 'legacy-' || id::text WHERE code IS NULL OR BTRIM(code) = '';
UPDATE plans
SET program = CASE
  WHEN LOWER(COALESCE(class_category, '')) IN ('funcional','functional') OR LOWER(name) LIKE '%funcional%' THEN 'functional'
  WHEN LOWER(COALESCE(class_category, '')) = 'prenatal' OR LOWER(name) LIKE '%prenatal%' THEN 'prenatal'
  ELSE 'pilates'
END
WHERE program IS NULL OR program = 'pilates';
UPDATE plans
SET plan_kind = CASE
  WHEN LOWER(name) LIKE '%inscripci%' THEN 'registration'
  WHEN COALESCE(class_limit, 0) >= 2 OR (class_limit IS NULL AND LOWER(name) ~ '(ilimitad|unlimited)') THEN 'package'
  WHEN LOWER(name) LIKE '%totalpass%' THEN 'internal'
  ELSE 'single'
END
WHERE plan_kind IS NULL OR plan_kind = 'single';

UPDATE orders o
SET program = p.program
FROM plans p
WHERE p.id = o.plan_id AND o.program IS DISTINCT FROM p.program;
UPDATE order_plan_items i
SET program = p.program,
    branch_id = p.branch_id
FROM plans p
WHERE p.id = i.plan_id
  AND (i.program IS DISTINCT FROM p.program OR i.branch_id IS DISTINCT FROM p.branch_id);

-- Claim one canonical Villa Magna row for each known legacy name. Duplicates
-- remain addressable under their legacy UUID code and can be retired manually.
WITH ranked AS (
  SELECT id, LOWER(name) AS normalized_name,
         ROW_NUMBER() OVER (PARTITION BY LOWER(name) ORDER BY is_active DESC, created_at, id) AS rn
  FROM plans
  WHERE LOWER(name) IN (
    'paquete 7 clases','paquete 9 clases','paquete 14 clases','clase extra',
    'clase suelta / visita','inscripción','prenatal','totalpass 154'
  )
)
UPDATE plans p
SET code = CASE r.normalized_name
  WHEN 'paquete 7 clases' THEN 'pilates-7'
  WHEN 'paquete 9 clases' THEN 'pilates-9'
  WHEN 'paquete 14 clases' THEN 'pilates-14'
  WHEN 'clase extra' THEN 'pilates-extra'
  WHEN 'clase suelta / visita' THEN 'pilates-dropin'
  WHEN 'inscripción' THEN 'pilates-registration'
  WHEN 'prenatal' THEN 'prenatal-7'
  WHEN 'totalpass 154' THEN 'totalpass-154'
END,
program = CASE WHEN r.normalized_name = 'prenatal' THEN 'prenatal' ELSE 'pilates' END,
plan_kind = CASE
  WHEN r.normalized_name = 'inscripción' THEN 'registration'
  WHEN r.normalized_name = 'totalpass 154' THEN 'internal'
  WHEN r.normalized_name IN ('clase extra','clase suelta / visita') THEN 'single'
  ELSE 'package'
END
FROM ranked r
WHERE p.id = r.id AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_branch_code ON plans(branch_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plans_branch_program_active ON plans(branch_id, program, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_classes_branch_date ON classes(branch_id, date, start_time);
CREATE INDEX IF NOT EXISTS idx_memberships_user_branch_program ON memberships(user_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user_branch ON orders(user_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrollments_scope ON enrollments(user_id, branch_id, program);

-- The old index prevented simultaneous classes at two branches (and Pilates +
-- Funcional at 08:00 in Pozos). Scope uniqueness by branch and class type.
DROP INDEX IF EXISTS idx_schedule_slots_slot;
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY branch_id, day_of_week, time_slot,
             LOWER(COALESCE(class_type_name, 'pilates'))
           ORDER BY is_active DESC, created_at, id
         ) AS rn
  FROM schedule_slots
  WHERE is_active = true
)
UPDATE schedule_slots ss SET is_active = false
FROM duplicates d WHERE ss.id = d.id AND d.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_slots_branch_type
  ON schedule_slots(branch_id, day_of_week, time_slot, LOWER(COALESCE(class_type_name, 'pilates')))
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_schedule_slots_branch_day ON schedule_slots(branch_id, day_of_week) WHERE is_active = true;

-- Add the program metadata expected by the runtime class generator.
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'pilates';
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 8;
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 55;
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS subtitle VARCHAR(150);
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS intensity VARCHAR(20) DEFAULT 'media';
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS emoji VARCHAR(10);
ALTER TABLE class_types ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

INSERT INTO class_types (name, description, category, capacity, duration_min, is_active, sort_order)
SELECT 'Functional', 'Entrenamiento funcional en grupos de 8.', 'funcional', 8, 55, true, 3
WHERE NOT EXISTS (SELECT 1 FROM class_types WHERE LOWER(name) IN ('functional','funcional'));
UPDATE class_types
SET category = 'funcional', capacity = 8, duration_min = 55, is_active = true,
    description = COALESCE(description, 'Entrenamiento funcional en grupos de 8.')
WHERE LOWER(name) IN ('functional','funcional');

-- Canonical SKUs. Same Pilates catalog in both branches; Functional only Pozos.
INSERT INTO plans
  (branch_id, code, name, description, price, currency, duration_days, class_limit,
   class_category, program, plan_kind, features, is_active, sort_order, is_admin_only)
VALUES
  ('11111111-1111-4111-8111-111111111111','pilates-7','Paquete 7 Clases','7 clases al mes; válido únicamente en Villa Magna.',880,'MXN',30,7,'pilates','pilates','package','["7 clases","Vigencia: hasta fin de mes","Válido solo en Villa Magna"]',true,1,false),
  ('11111111-1111-4111-8111-111111111111','pilates-9','Paquete 9 Clases','9 clases al mes; válido únicamente en Villa Magna.',1050,'MXN',30,9,'pilates','pilates','package','["9 clases","Vigencia: hasta fin de mes","Válido solo en Villa Magna"]',true,2,false),
  ('11111111-1111-4111-8111-111111111111','pilates-14','Paquete 14 Clases','14 clases al mes; válido únicamente en Villa Magna.',1400,'MXN',30,14,'pilates','pilates','package','["14 clases","Vigencia: hasta fin de mes","Válido solo en Villa Magna"]',true,3,false),
  ('11111111-1111-4111-8111-111111111111','pilates-extra','Clase Extra','Clase adicional para alumnas inscritas en Villa Magna.',130,'MXN',30,1,'pilates','pilates','single','["1 clase extra","Solo para inscritas"]',true,5,false),
  ('11111111-1111-4111-8111-111111111111','pilates-dropin','Clase Suelta / Visita','Clase individual en Villa Magna sin inscripción.',250,'MXN',7,1,'pilates','pilates','single','["1 clase","Sin inscripción"]',true,6,false),
  ('11111111-1111-4111-8111-111111111111','pilates-registration','Inscripción','Inscripción Pilates en Villa Magna.',500,'MXN',3650,0,'pilates','pilates','registration','["Inscripción Pilates","Válida en Villa Magna"]',true,7,false),
  ('11111111-1111-4111-8111-111111111111','prenatal-7','Prenatal','7 clases de Pilates Prenatal en Villa Magna.',1180,'MXN',30,7,'prenatal','prenatal','package','["7 clases Prenatal","Uso exclusivo en clases Prenatal"]',true,8,false),
  ('22222222-2222-4222-8222-222222222222','pilates-7','Paquete 7 Clases','7 clases al mes; válido únicamente en Pozos.',880,'MXN',30,7,'pilates','pilates','package','["7 clases","Vigencia: hasta fin de mes","Válido solo en Pozos"]',true,1,false),
  ('22222222-2222-4222-8222-222222222222','pilates-9','Paquete 9 Clases','9 clases al mes; válido únicamente en Pozos.',1050,'MXN',30,9,'pilates','pilates','package','["9 clases","Vigencia: hasta fin de mes","Válido solo en Pozos"]',true,2,false),
  ('22222222-2222-4222-8222-222222222222','pilates-14','Paquete 14 Clases','14 clases al mes; válido únicamente en Pozos.',1400,'MXN',30,14,'pilates','pilates','package','["14 clases","Vigencia: hasta fin de mes","Válido solo en Pozos"]',true,3,false),
  ('22222222-2222-4222-8222-222222222222','pilates-extra','Clase Extra','Clase adicional para alumnas inscritas en Pozos.',130,'MXN',30,1,'pilates','pilates','single','["1 clase extra","Solo para inscritas"]',true,5,false),
  ('22222222-2222-4222-8222-222222222222','pilates-dropin','Clase Suelta / Visita','Clase individual en Pozos sin inscripción.',250,'MXN',7,1,'pilates','pilates','single','["1 clase","Sin inscripción"]',true,6,false),
  ('22222222-2222-4222-8222-222222222222','pilates-registration','Inscripción','Inscripción Pilates en Pozos.',500,'MXN',3650,0,'pilates','pilates','registration','["Inscripción Pilates","Válida en Pozos"]',true,7,false),
  ('22222222-2222-4222-8222-222222222222','functional-7','Funcional · 7 Clases','7 clases de Funcional; válido únicamente en Pozos.',780,'MXN',30,7,'funcional','functional','package','["7 clases de Funcional","Válido solo en Pozos"]',true,20,false),
  ('22222222-2222-4222-8222-222222222222','functional-9','Funcional · 9 Clases','9 clases de Funcional; válido únicamente en Pozos.',890,'MXN',30,9,'funcional','functional','package','["9 clases de Funcional","Válido solo en Pozos"]',true,21,false),
  ('22222222-2222-4222-8222-222222222222','functional-unlimited','Funcional · Ilimitado','Clases ilimitadas de Funcional; válido únicamente en Pozos.',1050,'MXN',30,NULL,'funcional','functional','package','["Funcional ilimitado","Válido solo en Pozos"]',true,22,false),
  ('22222222-2222-4222-8222-222222222222','functional-registration','Inscripción Funcional','Inscripción al programa Funcional en Pozos.',300,'MXN',3650,0,'funcional','functional','registration','["Inscripción Funcional","Válida solo en Pozos"]',true,23,false),
  ('22222222-2222-4222-8222-222222222222','prenatal-7','Prenatal','Programa Prenatal en Pozos (próxima apertura).',1180,'MXN',30,7,'prenatal','prenatal','package','["Próximamente"]',false,30,false),
  ('22222222-2222-4222-8222-222222222222','prenatal-registration','Inscripción Prenatal','Inscripción Prenatal en Pozos (inactiva).',500,'MXN',3650,0,'prenatal','prenatal','registration','["Próximamente"]',false,31,false)
ON CONFLICT (branch_id, code) WHERE code IS NOT NULL DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    duration_days = EXCLUDED.duration_days,
    class_limit = EXCLUDED.class_limit,
    class_category = EXCLUDED.class_category,
    program = EXCLUDED.program,
    plan_kind = EXCLUDED.plan_kind,
    features = EXCLUDED.features,
    is_active = CASE
      WHEN EXCLUDED.branch_id = '22222222-2222-4222-8222-222222222222'
       AND EXCLUDED.program = 'prenatal'
      THEN plans.is_active
      ELSE EXCLUDED.is_active
    END,
    sort_order = EXCLUDED.sort_order,
    is_admin_only = EXCLUDED.is_admin_only,
    updated_at = NOW();

-- Existing schedule belongs to Villa Magna. Clone only Pilates to Pozos;
-- Prenatal is configured there but remains inactive/hidden.
UPDATE schedule_slots ss
SET class_type_name = COALESCE(ss.class_type_name, ct.name, 'Pilates')
FROM class_types ct
WHERE ss.class_type_id = ct.id AND ss.class_type_name IS NULL;
UPDATE schedule_slots SET class_type_name = 'Pilates' WHERE class_type_name IS NULL;

INSERT INTO schedule_slots
  (branch_id, time_slot, day_of_week, class_type_id, class_type_name, instructor_name, apparatus, starts_on, is_active)
SELECT '22222222-2222-4222-8222-222222222222', vm.time_slot, vm.day_of_week,
       vm.class_type_id, 'Pilates', COALESCE(vm.instructor_name, 'Coach Tu Espacio'),
       COALESCE(vm.apparatus, 'reformer'), vm.starts_on, true
FROM schedule_slots vm
WHERE vm.branch_id = '11111111-1111-4111-8111-111111111111'
  AND vm.is_active = true
  AND LOWER(COALESCE(vm.class_type_name, 'pilates')) = 'pilates'
  AND NOT EXISTS (
    SELECT 1 FROM schedule_slots p
    WHERE p.branch_id = '22222222-2222-4222-8222-222222222222'
      AND p.day_of_week = vm.day_of_week AND p.time_slot = vm.time_slot
      AND LOWER(COALESCE(p.class_type_name, 'pilates')) = 'pilates'
  );

INSERT INTO schedule_slots
  (branch_id, time_slot, day_of_week, class_type_name, instructor_name, apparatus, starts_on, is_active)
SELECT '22222222-2222-4222-8222-222222222222', '8:00 am', d, 'Functional',
       'Coach Tu Espacio', 'functional', DATE '2026-09-02', true
FROM (VALUES (1),(3),(5)) AS days(d)
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_slots s
  WHERE s.branch_id = '22222222-2222-4222-8222-222222222222'
    AND s.day_of_week = days.d AND s.time_slot = '8:00 am'
    AND LOWER(COALESCE(s.class_type_name, '')) IN ('functional','funcional')
);

INSERT INTO schedule_slots
  (branch_id, time_slot, day_of_week, class_type_id, class_type_name, instructor_name, apparatus, starts_on, is_active)
SELECT '22222222-2222-4222-8222-222222222222', vm.time_slot, vm.day_of_week,
       vm.class_type_id, 'Prenatal', COALESCE(vm.instructor_name, 'Coach Tu Espacio'),
       COALESCE(vm.apparatus, 'reformer'), vm.starts_on, false
FROM schedule_slots vm
WHERE vm.branch_id = '11111111-1111-4111-8111-111111111111'
  AND LOWER(COALESCE(vm.class_type_name, '')) = 'prenatal'
  AND NOT EXISTS (
    SELECT 1 FROM schedule_slots p
    WHERE p.branch_id = '22222222-2222-4222-8222-222222222222'
      AND p.day_of_week = vm.day_of_week AND p.time_slot = vm.time_slot
      AND LOWER(COALESCE(p.class_type_name, '')) = 'prenatal'
  );

ALTER TABLE facilities ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE schedules ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE classes ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE memberships ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE plans ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE schedule_slots ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE order_plan_items ALTER COLUMN branch_id SET NOT NULL;

-- Defense in depth: every write path (including future admin scripts) must keep
-- package, order, membership and booking ownership in the same branch/program.
CREATE OR REPLACE FUNCTION enforce_membership_plan_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_branch UUID;
BEGIN
  SELECT branch_id INTO plan_branch FROM plans WHERE id = NEW.plan_id;
  IF plan_branch IS NOT NULL AND plan_branch <> NEW.branch_id THEN
    RAISE EXCEPTION 'membership branch does not match plan branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_membership_plan_scope ON memberships;
CREATE TRIGGER trg_membership_plan_scope
BEFORE INSERT OR UPDATE OF plan_id, branch_id ON memberships
FOR EACH ROW EXECUTE FUNCTION enforce_membership_plan_scope();

CREATE OR REPLACE FUNCTION enforce_order_plan_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_branch UUID; plan_program TEXT;
BEGIN
  IF NEW.plan_id IS NULL THEN RETURN NEW; END IF;
  SELECT branch_id, program INTO plan_branch, plan_program FROM plans WHERE id = NEW.plan_id;
  IF plan_branch <> NEW.branch_id OR plan_program <> NEW.program THEN
    RAISE EXCEPTION 'order scope does not match plan scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_plan_scope ON orders;
CREATE TRIGGER trg_order_plan_scope
BEFORE INSERT OR UPDATE OF plan_id, branch_id, program ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_order_plan_scope();

CREATE OR REPLACE FUNCTION enforce_order_item_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_branch UUID; plan_program TEXT; order_branch UUID; order_program TEXT;
BEGIN
  SELECT branch_id, program INTO plan_branch, plan_program FROM plans WHERE id = NEW.plan_id;
  SELECT branch_id, program INTO order_branch, order_program FROM orders WHERE id = NEW.order_id;
  IF NEW.branch_id <> plan_branch OR NEW.branch_id <> order_branch
     OR NEW.program <> plan_program OR NEW.program <> order_program THEN
    RAISE EXCEPTION 'order item scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_item_scope ON order_plan_items;
CREATE TRIGGER trg_order_item_scope
BEFORE INSERT OR UPDATE OF order_id, plan_id, branch_id, program ON order_plan_items
FOR EACH ROW EXECUTE FUNCTION enforce_order_item_scope();

CREATE OR REPLACE FUNCTION enforce_booking_membership_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE class_branch UUID; membership_branch UUID; class_program TEXT; membership_program TEXT;
BEGIN
  IF NEW.membership_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.branch_id,
         CASE WHEN LOWER(COALESCE(ct.category, '')) IN ('funcional','functional') THEN 'functional'
              WHEN LOWER(COALESCE(ct.category, '')) = 'prenatal' THEN 'prenatal'
              ELSE 'pilates' END
    INTO class_branch, class_program
    FROM classes c JOIN class_types ct ON ct.id = c.class_type_id WHERE c.id = NEW.class_id;
  SELECT m.branch_id, COALESCE(p.program, 'pilates')
    INTO membership_branch, membership_program
    FROM memberships m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id = NEW.membership_id;
  IF class_branch <> membership_branch OR class_program <> membership_program THEN
    RAISE EXCEPTION 'booking membership scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_booking_membership_scope ON bookings;
CREATE TRIGGER trg_booking_membership_scope
BEFORE INSERT OR UPDATE OF class_id, membership_id ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_membership_scope();

COMMIT;
