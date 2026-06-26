-- ============================================================
-- VALIANCE PILATES — SEED COMPLETO
-- Generado: 2026-04-15
-- Fuente: imágenes oficiales del estudio (Valiance data/info/*)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. LIMPIAR DATOS VIEJOS
-- ============================================================
DELETE FROM classes;
DELETE FROM schedules;
DELETE FROM class_types;
UPDATE plans SET is_active = false;
DELETE FROM plans;

-- ============================================================
-- 2. SYSTEM SETTINGS — Valiance Pilates
-- ============================================================
UPDATE system_settings SET value = '{
  "name": "Valiance Pilates",
  "tagline": "Estudio boutique de Pilates Reformer y Barre",
  "address": "Av. Luis Hidalgo Monroy 369, San Miguel, Iztapalapa, 09360 Ciudad de México, CDMX",
  "address_short": "Av. Luis Hidalgo Monroy 369, Iztapalapa, CDMX",
  "phone": "+525523173402",
  "phone_display": "+52 55 2317 3402",
  "whatsapp": "525523173402",
  "email": "hola@valiancepilates.com.mx",
  "maps_url": "https://maps.app.goo.gl/dUdZQcjGMMzWQsGC8",
  "social_media": {
    "instagram": "https://www.instagram.com/valiance.pilates",
    "facebook": "https://www.facebook.com/share/1DcFEqokCv/"
  }
}'::jsonb WHERE key = 'studio_info';

UPDATE system_settings SET value = '{
  "bank": "",
  "bank_name": "",
  "account_holder": "",
  "card_number": "",
  "account_number": "",
  "clabe": "",
  "reference_instructions": "Solo aceptamos transferencias para clase muestra y clases sueltas. Incluye tu nombre en el concepto."
}'::jsonb WHERE key = 'bank_info';

UPDATE system_settings SET value = '{
  "cancellation_hours": 8,
  "no_show_penalty": true,
  "max_advance_days": 30,
  "tolerance_minutes": 5,
  "arrive_minutes_before": 5
}'::jsonb WHERE key = 'booking_policies';

-- ============================================================
-- 3. CLASS TYPES — Disciplinas de Valiance
-- Colores tomados de la paleta Valiance
-- ============================================================
INSERT INTO class_types (id, name, description, level, duration_minutes, max_capacity, icon, color, is_active)
VALUES
  ('a1000001-0001-4000-8000-000000000001',
   'Pilates Reformer',
   'Entrenamiento de bajo impacto en máquina reformer que tonifica, alarga y fortalece todo el cuerpo. Trabaja core, postura y movilidad con resistencia controlada.',
   'all', 55, 5, 'activity', '#FAE5E7', true),

  ('a1000001-0001-4000-8000-000000000002',
   'Barre',
   'Clase coreografiada inspirada en ballet, pilates y entrenamiento funcional. Tonifica piernas, glúteos y core con micro-movimientos de alta repetición.',
   'all', 55, 5, 'sparkles', '#D9B5BA', true),

  ('a1000001-0001-4000-8000-000000000003',
   'HIIT Barre',
   'Versión high-intensity de Barre: intervalos cardio + resistencia en barra. Quema calorías y eleva tu capacidad cardiovascular sin perder técnica.',
   'intermediate', 55, 5, 'flame', '#C9A96E', true),

  ('a1000001-0001-4000-8000-000000000004',
   'Mat',
   'Pilates clásico en colchoneta. Conexión profunda con el core, respiración consciente y control postural sin equipo de máquina.',
   'all', 55, 5, 'waves', '#8C6B6F', true);

-- ============================================================
-- 4. PLANS — Costos según imágenes oficiales
-- ============================================================
INSERT INTO plans (id, name, description, price, currency, duration_days, class_limit, features, is_active, sort_order)
VALUES
  -- ── PILATES REFORMER ──
  ('b2000001-0001-4000-8000-000000000001',
   'Reformer — Primera Vez',
   'Clase de prueba para nuevas alumnas en Pilates Reformer. Solo aceptamos transferencias.',
   150.00, 'MXN', 30, 1,
   '["1 clase de prueba", "Solo aceptamos transferencias", "No reembolsable"]'::jsonb,
   true, 0),

  ('b2000001-0001-4000-8000-000000000002',
   'Reformer — Clase Suelta',
   'Acceso a una clase individual de Pilates Reformer.',
   200.00, 'MXN', 30, 1,
   '["1 clase Reformer", "Vigencia 30 días"]'::jsonb,
   true, 1),

  ('b2000001-0001-4000-8000-000000000003',
   'Reformer — 2 Clases',
   'Paquete inicial de 2 clases de Pilates Reformer.',
   380.00, 'MXN', 30, 2,
   '["2 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 2),

  ('b2000001-0001-4000-8000-000000000004',
   'Reformer — 3 Clases',
   'Paquete de 3 clases de Pilates Reformer.',
   550.00, 'MXN', 30, 3,
   '["3 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 3),

  ('b2000001-0001-4000-8000-000000000005',
   'Reformer — 4 Clases',
   'Paquete de 4 clases de Pilates Reformer.',
   720.00, 'MXN', 30, 4,
   '["4 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 4),

  ('b2000001-0001-4000-8000-000000000006',
   'Reformer — 8 Clases',
   'Paquete de 8 clases de Pilates Reformer.',
   1400.00, 'MXN', 30, 8,
   '["8 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 5),

  ('b2000001-0001-4000-8000-000000000007',
   'Reformer — 12 Clases',
   'Paquete de 12 clases de Pilates Reformer.',
   2040.00, 'MXN', 30, 12,
   '["12 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 6),

  ('b2000001-0001-4000-8000-000000000008',
   'Reformer — 20 Clases',
   'Paquete grande de 20 clases de Pilates Reformer.',
   3300.00, 'MXN', 30, 20,
   '["20 clases Reformer", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 7),

  -- ── BARRE ──
  ('b2000001-0001-4000-8000-000000000010',
   'Barre — Primera Vez',
   'Clase de prueba para nuevas alumnas en Barre.',
   85.00, 'MXN', 30, 1,
   '["1 clase de prueba", "Solo aceptamos transferencias"]'::jsonb,
   true, 10),

  ('b2000001-0001-4000-8000-000000000011',
   'Barre — Clase Suelta',
   'Acceso a una clase individual de Barre.',
   145.00, 'MXN', 30, 1,
   '["1 clase Barre", "Vigencia 30 días"]'::jsonb,
   true, 11),

  ('b2000001-0001-4000-8000-000000000012',
   'Barre — 4 Clases',
   'Paquete de 4 clases de Barre.',
   540.00, 'MXN', 30, 4,
   '["4 clases Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 12),

  ('b2000001-0001-4000-8000-000000000013',
   'Barre — 8 Clases',
   'Paquete de 8 clases de Barre.',
   1040.00, 'MXN', 30, 8,
   '["8 clases Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 13),

  ('b2000001-0001-4000-8000-000000000014',
   'Barre — 12 Clases',
   'Paquete de 12 clases de Barre.',
   1500.00, 'MXN', 30, 12,
   '["12 clases Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 14),

  -- ── COMBOS PILATES + BARRE ──
  ('b2000001-0001-4000-8000-000000000020',
   'Combo 1 — 4 Reformer + 4 Barre',
   'Paquete combinado: 4 clases de Pilates Reformer + 4 clases de Barre.',
   1140.00, 'MXN', 30, 8,
   '["4 Reformer + 4 Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 20),

  ('b2000001-0001-4000-8000-000000000021',
   'Combo 2 — 8 Reformer + 4 Barre',
   'Paquete combinado: 8 clases de Pilates Reformer + 4 clases de Barre.',
   1680.00, 'MXN', 30, 12,
   '["8 Reformer + 4 Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 21),

  ('b2000001-0001-4000-8000-000000000022',
   'Combo 3 — 8 Reformer + 8 Barre',
   'Paquete combinado: 8 clases de Pilates Reformer + 8 clases de Barre.',
   2000.00, 'MXN', 30, 16,
   '["8 Reformer + 8 Barre", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 22),

  -- ── PROMOS ──
  ('b2000001-0001-4000-8000-000000000030',
   'Membresía Ilimitada',
   'Acceso ilimitado a clases de lunes a domingo durante 30 días.',
   2900.00, 'MXN', 30, 999,
   '["Clases ilimitadas Reformer y Barre", "Lunes a domingo", "Vigencia 30 días", "Personal e intransferible"]'::jsonb,
   true, 30),

  ('b2000001-0001-4000-8000-000000000031',
   'Morning Pass',
   'Pase mañanero: 8 clases en horarios de 7, 8 y 9 AM, lunes a viernes.',
   1250.00, 'MXN', 30, 8,
   '["8 clases", "Lunes a viernes", "Solo turnos 7, 8 y 9 AM", "Vigencia 30 días"]'::jsonb,
   true, 31);

-- ============================================================
-- 5. ADMIN USER + INSTRUCTORES
-- ============================================================
INSERT INTO users (id, email, phone, display_name, role, is_active)
VALUES (
  'c3000001-0001-4000-8000-000000000001',
  'admin@valiancepilates.com',
  '0000000000',
  'Administrador Valiance',
  'admin',
  true
) ON CONFLICT (email) DO NOTHING;

-- Instructores Valiance (vistos en horarios oficiales)
-- Maca, Jean, Idaid, Tania, Vane, Andy
INSERT INTO users (id, email, phone, display_name, role, is_active) VALUES
  ('c3000001-0001-4000-8000-000000000010', 'maca@valiancepilates.com',  '1000000001', 'Maca',  'instructor', true),
  ('c3000001-0001-4000-8000-000000000011', 'jean@valiancepilates.com',  '1000000002', 'Jean',  'instructor', true),
  ('c3000001-0001-4000-8000-000000000012', 'idaid@valiancepilates.com', '1000000003', 'Idaid', 'instructor', true),
  ('c3000001-0001-4000-8000-000000000013', 'tania@valiancepilates.com', '1000000004', 'Tania', 'instructor', true),
  ('c3000001-0001-4000-8000-000000000014', 'vane@valiancepilates.com',  '1000000005', 'Vane',  'instructor', true),
  ('c3000001-0001-4000-8000-000000000015', 'andy@valiancepilates.com',  '1000000006', 'Andy',  'instructor', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO instructors (id, user_id, display_name, bio, specialties, is_active) VALUES
  ('d4000001-0001-4000-8000-000000000010', 'c3000001-0001-4000-8000-000000000010', 'Maca',
   'Coach principal de Pilates Reformer en Valiance.',
   '["Pilates Reformer"]'::jsonb, true),
  ('d4000001-0001-4000-8000-000000000011', 'c3000001-0001-4000-8000-000000000011', 'Jean',
   'Coach de Pilates Reformer y Barre.',
   '["Pilates Reformer", "Barre"]'::jsonb, true),
  ('d4000001-0001-4000-8000-000000000012', 'c3000001-0001-4000-8000-000000000012', 'Idaid',
   'Coach de Pilates Reformer.',
   '["Pilates Reformer"]'::jsonb, true),
  ('d4000001-0001-4000-8000-000000000013', 'c3000001-0001-4000-8000-000000000013', 'Tania',
   'Coach de Pilates Reformer.',
   '["Pilates Reformer"]'::jsonb, true),
  ('d4000001-0001-4000-8000-000000000014', 'c3000001-0001-4000-8000-000000000014', 'Vane',
   'Coach de Pilates Reformer (turnos dominicales).',
   '["Pilates Reformer"]'::jsonb, true),
  ('d4000001-0001-4000-8000-000000000015', 'c3000001-0001-4000-8000-000000000015', 'Andy',
   'Coach de HIIT Barre.',
   '["Barre", "HIIT Barre"]'::jsonb, true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. SCHEDULES — Horario semanal (según imágenes oficiales)
-- day_of_week: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 0=Dom
-- ── Class Type IDs ──
-- Reformer:    a1000001-0001-4000-8000-000000000001
-- Barre:       a1000001-0001-4000-8000-000000000002
-- HIIT Barre:  a1000001-0001-4000-8000-000000000003
-- Mat:         a1000001-0001-4000-8000-000000000004
-- ============================================================

-- ── REFORMER — LUNES (Maca AM, Jean PM) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 1, '07:00','07:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 1, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 1, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 1, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 1, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 1, '20:00','20:55', 5, true, true);

-- ── REFORMER — MARTES (Maca AM, Idaid PM) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 2, '07:00','07:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 2, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 2, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000012', 2, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000012', 2, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000012', 2, '20:00','20:55', 5, true, true);

-- ── BARRE — MARTES (Jean PM, Mat) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000011', 2, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000011', 2, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000004','d4000001-0001-4000-8000-000000000011', 2, '20:00','20:55', 5, true, true);

-- ── REFORMER — MIÉRCOLES (Tania AM, Maca PM) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000013', 3, '07:00','07:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000013', 3, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000013', 3, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 3, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 3, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 3, '20:00','20:55', 5, true, true);

-- ── REFORMER — JUEVES (Maca AM y PM) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '07:00','07:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 4, '20:00','20:55', 5, true, true);

-- ── BARRE — JUEVES (Andy AM HIIT, Jean PM Mat) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000015', 4, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000015', 4, '10:00','10:55', 5, true, true),
('a1000001-0001-4000-8000-000000000003','d4000001-0001-4000-8000-000000000015', 4, '11:00','11:55', 5, true, true),
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000011', 4, '18:00','18:55', 5, true, true),
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000011', 4, '19:00','19:55', 5, true, true),
('a1000001-0001-4000-8000-000000000004','d4000001-0001-4000-8000-000000000011', 4, '20:00','20:55', 5, true, true);

-- ── REFORMER — VIERNES (Maca AM) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 5, '07:00','07:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 5, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000010', 5, '09:00','09:55', 5, true, true);

-- ── BARRE — VIERNES (Andy AM, HIIT a las 11) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000015', 5, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000002','d4000001-0001-4000-8000-000000000015', 5, '10:00','10:55', 5, true, true),
('a1000001-0001-4000-8000-000000000003','d4000001-0001-4000-8000-000000000015', 5, '11:00','11:55', 5, true, true);

-- ── REFORMER — SÁBADO (Jean) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 6, '08:00','08:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 6, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 6, '10:00','10:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000011', 6, '11:00','11:55', 5, true, true);

-- ── REFORMER — DOMINGO (Vane) ──
INSERT INTO schedules (class_type_id, instructor_id, day_of_week, start_time, end_time, max_capacity, is_recurring, is_active) VALUES
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000014', 0, '09:00','09:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000014', 0, '10:00','10:55', 5, true, true),
('a1000001-0001-4000-8000-000000000001','d4000001-0001-4000-8000-000000000014', 0, '11:00','11:55', 5, true, true);

-- ============================================================
-- 7. CLASSES — Generar próximas 4 semanas
-- ============================================================
DO $$
DECLARE
  rec RECORD;
  week_offset INT;
  target_date DATE;
  base_monday DATE;
BEGIN
  base_monday := date_trunc('week', CURRENT_DATE)::date;

  FOR week_offset IN 0..3 LOOP
    FOR rec IN SELECT * FROM schedules WHERE is_recurring = true AND is_active = true LOOP
      target_date := base_monday + (week_offset * 7) + (rec.day_of_week - 1);

      IF target_date >= CURRENT_DATE THEN
        INSERT INTO classes (
          schedule_id, class_type_id, instructor_id,
          date, start_time, end_time,
          max_capacity, current_bookings, status
        ) VALUES (
          rec.id, rec.class_type_id, rec.instructor_id,
          target_date, rec.start_time, rec.end_time,
          rec.max_capacity, 0, 'scheduled'
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE '✅ Clases Valiance generadas para las próximas 4 semanas';
END $$;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT '--- CLASS TYPES ---' AS info;
SELECT name, color, duration_minutes, max_capacity FROM class_types WHERE is_active = true ORDER BY name;

SELECT '--- PLANS ---' AS info;
SELECT name, price, class_limit, sort_order FROM plans WHERE is_active = true ORDER BY sort_order;

SELECT '--- SCHEDULES ---' AS info;
SELECT s.day_of_week, s.start_time, ct.name as class_name, i.display_name as instructor
FROM schedules s
JOIN class_types ct ON s.class_type_id = ct.id
JOIN instructors i ON s.instructor_id = i.id
WHERE s.is_active = true
ORDER BY s.day_of_week, s.start_time;
