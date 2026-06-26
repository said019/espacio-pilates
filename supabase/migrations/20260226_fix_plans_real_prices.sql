-- ─── Fix planes: reemplazar con precios y estructura reales ──────────────────
-- Basado en los precios oficiales de Punto Neutro
-- Categorías: Pilates + planes sueltos (inscripción, sesión individual, extra)

-- 1. Eliminar todos los planes existentes (cascada solo si no tienen membresías activas)
--    Usamos UPDATE en lugar de DELETE para conservar referencias en membresías/órdenes
UPDATE plans SET is_active = false;

-- 2. Insertar planes correctos (se usa ON CONFLICT DO UPDATE por si se corre más de una vez)

-- ── Planes base (no son paquetes mensuales) ──────────────────────────────────
INSERT INTO plans (id, name, description, price, currency, duration_days, class_limit, features, is_active, sort_order)
VALUES
  ('fa69839f-f88b-4775-a50f-a1a0e18391c5',
   'Inscripción (Pago Anual)',
   'Pago anual de inscripción. Requerido para todos los miembros.',
   500, 'MXN', 365, 0,
   '["Válido por 1 año","Requerido para todos los miembros","Pago único anual"]',
   true, 0),

  ('a5ba1a0f-92a3-417e-a221-26e459161fbb',
   'Sesión Muestra o Individual',
   'Acceso a una clase de prueba o sesión individual.',
   150, 'MXN', 30, 1,
   '["1 clase de prueba","Ideal para nuevos alumnos","Sin compromiso"]',
   true, 1),

  ('f4bf1e7a-74ca-4d42-b118-be20730a010c',
   'Sesión Extra (Socias o Inscritas)',
   'Clase extra para socias con membresía activa.',
   120, 'MXN', 30, 1,
   '["1 clase adicional","Solo para miembros inscritos","Válido por 30 días"]',
   true, 2)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  duration_days = EXCLUDED.duration_days,
  class_limit = EXCLUDED.class_limit,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Paquetes Jumping ─────────────────────────────────────────────────────────
INSERT INTO plans (id, name, description, price, currency, duration_days, class_limit, features, is_active, sort_order)
VALUES
  ('52b3fdcb-859d-4a85-9ff6-e029d7ceceb2',
   'Jumping — 4 Clases',
   'Paquete Jumping: 4 sesiones al mes.',
   300, 'MXN', 30, 4,
   '["4 clases de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 10),

  ('5cc2a902-c7e5-447e-94b2-5545f3b3598d',
   'Jumping — 8 Clases',
   'Paquete Jumping: 8 sesiones al mes.',
   560, 'MXN', 30, 8,
   '["8 clases de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 11),

  ('a26a4d57-b2b0-4d91-8ace-00ef5f9b31ec',
   'Jumping — 12 Clases',
   'Paquete Jumping: 12 sesiones al mes.',
   780, 'MXN', 30, 12,
   '["12 clases de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 12),

  ('f79e374c-0f13-4417-8f17-0f9d0b913d18',
   'Jumping — 16 Clases',
   'Paquete Jumping: 16 sesiones al mes.',
   960, 'MXN', 30, 16,
   '["16 clases de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 13),

  ('6b7c46c2-1205-4e75-b527-bd392da47715',
   'Jumping — 20 Clases',
   'Paquete Jumping: 20 sesiones al mes.',
   1100, 'MXN', 30, 20,
   '["20 clases de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 14),

  ('aac7b0af-56a7-4786-be98-50d744781e8a',
   'Jumping — Ilimitado',
   'Paquete Jumping ilimitado.',
   1000, 'MXN', 30, NULL,
   '["Clases ilimitadas de Jumping","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 15)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  duration_days = EXCLUDED.duration_days,
  class_limit = EXCLUDED.class_limit,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Paquetes Pilates ─────────────────────────────────────────────────────────
INSERT INTO plans (id, name, description, price, currency, duration_days, class_limit, features, is_active, sort_order)
VALUES
  ('264f9c4a-b8fc-4bcc-8a33-11303eb624c8',
   'Pilates — 4 Clases',
   'Paquete Pilates: 4 sesiones al mes.',
   300, 'MXN', 30, 4,
   '["4 clases de Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 20),

  (gen_random_uuid()::text,
   'Pilates — 8 Clases',
   'Paquete Pilates: 8 sesiones al mes.',
   600, 'MXN', 30, 8,
   '["8 clases de Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 21),

  (gen_random_uuid()::text,
   'Pilates — 12 Clases',
   'Paquete Pilates: 12 sesiones al mes.',
   840, 'MXN', 30, 12,
   '["12 clases de Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 22),

  (gen_random_uuid()::text,
   'Pilates — 16 Clases',
   'Paquete Pilates: 16 sesiones al mes.',
   1120, 'MXN', 30, 16,
   '["16 clases de Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 23),

  (gen_random_uuid()::text,
   'Pilates — Ilimitado',
   'Paquete Pilates ilimitado.',
   1000, 'MXN', 30, NULL,
   '["Clases ilimitadas de Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 24)

ON CONFLICT (id) DO NOTHING;

-- ── Paquetes Mixtos (Jumping + Pilates) ───────────────────────────────────────
INSERT INTO plans (id, name, description, price, currency, duration_days, class_limit, features, is_active, sort_order)
VALUES
  (gen_random_uuid()::text,
   'Mixto — 8 Clases',
   'Paquete Mixto Jumping & Pilates: 8 sesiones al mes.',
   600, 'MXN', 30, 8,
   '["8 clases combinadas Jumping & Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 30),

  (gen_random_uuid()::text,
   'Mixto — 12 Clases',
   'Paquete Mixto Jumping & Pilates: 12 sesiones al mes.',
   860, 'MXN', 30, 12,
   '["12 clases combinadas Jumping & Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 31),

  (gen_random_uuid()::text,
   'Mixto — 16 Clases',
   'Paquete Mixto Jumping & Pilates: 16 sesiones al mes.',
   1120, 'MXN', 30, 16,
   '["16 clases combinadas Jumping & Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 32),

  (gen_random_uuid()::text,
   'Mixto — 20 Clases',
   'Paquete Mixto Jumping & Pilates: 20 sesiones al mes.',
   1300, 'MXN', 30, 20,
   '["20 clases combinadas Jumping & Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 33),

  (gen_random_uuid()::text,
   'Mixto — Ilimitado',
   'Paquete Mixto ilimitado Jumping & Pilates.',
   1000, 'MXN', 30, NULL,
   '["Clases ilimitadas Jumping & Pilates","Vigencia 30 días","Aplican términos y condiciones"]',
   true, 34)

ON CONFLICT (id) DO NOTHING;

-- Desactivar los 3 planes viejos que ya no corresponden (Seis Sesiones, Siete Sesiones quedan reemplazados arriba)
-- Los que ya estaban como is_active=false arriba quedan bien.
-- Reactivar solo los que insertamos:
UPDATE plans SET is_active = true
WHERE sort_order IN (0,1,2,10,11,12,13,14,15,20,21,22,23,24,30,31,32,33,34);
