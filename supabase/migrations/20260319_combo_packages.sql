-- ─── Paquetes Completos: complementos + consultas ─────────────────────────────
-- Permite que un cliente compre un paquete básico (8, 12 o 16 clases)
-- + un complemento (consulta de nutrición o descarga muscular) a precio fijo.

-- 1. Tabla de complementos (catálogo de servicios adicionales)
CREATE TABLE IF NOT EXISTS complements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    specialist  VARCHAR(255) NOT NULL,
    instagram   VARCHAR(100),
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Precios combo por cantidad de clases (no por plan individual)
--    Así aplica igual para Jumping, Pilates o Mixto
CREATE TABLE IF NOT EXISTS combo_pricing (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_count     INTEGER NOT NULL,
    price           DECIMAL(10,2) NOT NULL,
    discount_price  DECIMAL(10,2),
    is_active       BOOLEAN DEFAULT true,
    UNIQUE(class_count)
);

-- 3. Tabla de seguimiento de consultas compradas
CREATE TABLE IF NOT EXISTS consultations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    complement_id   UUID NOT NULL REFERENCES complements(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
    scheduled_date  DATE,
    notes           TEXT,
    completed_at    TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultations_user ON consultations(user_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations(status);
CREATE INDEX IF NOT EXISTS idx_consultations_order ON consultations(order_id);

-- 4. Agregar complement_id a la tabla orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS complement_id UUID REFERENCES complements(id);

-- ── Seed: 3 complementos ──────────────────────────────────────────────────────
INSERT INTO complements (id, name, specialist, instagram, description, sort_order) VALUES
  ('c0000001-0000-0000-0000-000000000001',
   'Consulta de nutrición "Salud hormonal"',
   'LN. Clara Pérez',
   '@nutriologaclarapr',
   'Consulta personalizada de nutrición enfocada en salud hormonal.',
   1),
  ('c0000002-0000-0000-0000-000000000002',
   'Consulta de nutrición "Rendimiento Físico"',
   'LN. Majo Zamorano',
   '@nutriologa_majozamorano',
   'Consulta personalizada de nutrición enfocada en rendimiento físico.',
   2),
  ('c0000003-0000-0000-0000-000000000003',
   'Descarga muscular',
   'LTF. Angelina Huante',
   '@angelinash_ft',
   'Sesión de descarga muscular con fisioterapeuta.',
   3)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  specialist = EXCLUDED.specialist,
  instagram = EXCLUDED.instagram,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Seed: precios combo por tier ──────────────────────────────────────────────
INSERT INTO combo_pricing (class_count, price, discount_price) VALUES
  (8,  1030,  990),
  (12, 1250, 1190),
  (16, 1450, 1340)
ON CONFLICT (class_count) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price;

-- ── Desactivar planes "Paquete +" viejos si existen ───────────────────────────
UPDATE plans SET is_active = false WHERE name LIKE 'Paquete +%';
