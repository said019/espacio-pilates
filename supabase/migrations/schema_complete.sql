-- ============================================================
-- CATARSIS STUDIO — ESQUEMA COMPLETO DE POSTGRESQL
-- Versión consolidada: base schema + todas las migraciones
-- Fecha: 2026
-- ============================================================
-- USO:
--   psql -U <usuario> -d <base_de_datos> -f schema_complete.sql
--
-- Este archivo es idempotente: puede ejecutarse en una base de
-- datos vacía o ya existente (usa IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- ============================================================
-- SECCIÓN 1: EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SECCIÓN 2: TIPOS ENUM
-- ============================================================

-- Roles de usuario
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('client', 'instructor', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Agregar roles adicionales (migraciones 002 y 005)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'reception';

COMMENT ON TYPE user_role IS 'Roles: client, instructor, admin, super_admin, reception';

-- Estado de membresía
DO $$ BEGIN
    CREATE TYPE membership_status AS ENUM (
        'pending_payment',
        'pending_activation',
        'active',
        'expired',
        'paused',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Métodos de pago
DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM ('cash', 'transfer', 'card', 'online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Niveles de clase
DO $$ BEGIN
    CREATE TYPE class_level AS ENUM ('beginner', 'intermediate', 'advanced', 'all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de clase
DO $$ BEGIN
    CREATE TYPE class_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de reservación
DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM ('confirmed', 'waitlist', 'checked_in', 'no_show', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipo de puntos de lealtad
DO $$ BEGIN
    CREATE TYPE loyalty_points_type AS ENUM ('class_attended', 'referral', 'bonus', 'redemption');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Categorías de recompensa
DO $$ BEGIN
    CREATE TYPE reward_category AS ENUM ('merchandise', 'class', 'discount', 'experience');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de canje
DO $$ BEGIN
    CREATE TYPE redemption_status AS ENUM ('pending', 'fulfilled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipos de notificación
DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'booking_reminder',
        'class_cancelled',
        'membership_expiring',
        'points_earned',
        'promotion'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notificaciones de coach (migración 002_coach_system)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coach_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coach_removed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coach_substituted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'class_updated';

-- Plataformas de wallet
DO $$ BEGIN
    CREATE TYPE wallet_platform AS ENUM ('apple', 'google');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de orden (migración 003_orders_payment_system)
DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
        'pending_payment',
        'pending_verification',
        'approved',
        'rejected',
        'expired',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de compra de video (migración 010_video_purchase_unlocks)
DO $$ BEGIN
    CREATE TYPE video_purchase_status AS ENUM (
        'pending_payment',
        'pending_verification',
        'approved',
        'rejected',
        'expired'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Método de check-in (migración 004_checkins_reviews_system)
DO $$ BEGIN
    CREATE TYPE checkin_method AS ENUM (
        'qr_scan',
        'manual_reception',
        'self_checkin',
        'nfc_tap',
        'wallet_scan'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado de reseña (migración 004)
DO $$ BEGIN
    CREATE TYPE review_status AS ENUM (
        'pending',
        'published',
        'hidden',
        'flagged',
        'removed'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipo de actividad sospechosa (migración 004)
DO $$ BEGIN
    CREATE TYPE suspicious_activity_type AS ENUM (
        'multiple_devices',
        'rapid_checkins',
        'location_mismatch',
        'duplicate_qr_attempt',
        'invalid_qr',
        'device_clone_suspected'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipo de respuesta (migración 004)
DO $$ BEGIN
    CREATE TYPE response_type AS ENUM (
        'thank_you',
        'apology',
        'explanation',
        'offer',
        'follow_up'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Canal de notificación (migración 003_wallet_tables)
DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM ('apple', 'google');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipos de evento (migración 008_events_system)
DO $$ BEGIN
    CREATE TYPE event_type AS ENUM (
        'masterclass', 'workshop', 'retreat', 'challenge', 'openhouse', 'special'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE event_registration_status AS ENUM (
        'confirmed', 'pending', 'waitlist', 'cancelled', 'no_show'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SECCIÓN 3: FUNCIÓN AUXILIAR updated_at (necesaria antes de tablas con triggers)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECCIÓN 4: TABLAS BASE
-- ============================================================

-- --------------------------------------------------------
-- USERS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                     VARCHAR(255) UNIQUE NOT NULL,
    phone                     VARCHAR(20) NOT NULL,
    display_name              VARCHAR(255) NOT NULL,
    photo_url                 TEXT,
    role                      user_role NOT NULL DEFAULT 'client',
    emergency_contact_name    VARCHAR(255),
    emergency_contact_phone   VARCHAR(20),
    health_notes              TEXT,
    accepts_communications    BOOLEAN DEFAULT false,
    date_of_birth             DATE,
    receive_reminders         BOOLEAN DEFAULT true,
    receive_promotions        BOOLEAN DEFAULT false,
    receive_weekly_summary    BOOLEAN DEFAULT false,
    firebase_uid              VARCHAR(128) UNIQUE,
    -- migración 002_coach_system
    instructor_notes          TEXT,
    alert_flag                BOOLEAN DEFAULT false,
    alert_message             VARCHAR(255),
    -- migración 006_add_is_active_to_users
    is_active                 BOOLEAN DEFAULT true,
    created_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone        ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_active       ON users(is_active);

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- PLANS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    price         DECIMAL(10, 2) NOT NULL,
    currency      VARCHAR(3) DEFAULT 'MXN',
    duration_days INTEGER NOT NULL,
    class_limit   INTEGER,           -- NULL = ilimitado
    features      JSONB DEFAULT '[]'::jsonb,
    is_active     BOOLEAN DEFAULT true,
    sort_order    INTEGER DEFAULT 0,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_plans_sort   ON plans(sort_order);

DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- MEMBERSHIPS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id              UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status               membership_status NOT NULL DEFAULT 'pending_payment',
    classes_remaining    INTEGER,
    start_date           DATE,
    end_date             DATE,
    activated_by         UUID REFERENCES users(id),
    activated_at         TIMESTAMP WITH TIME ZONE,
    payment_method       payment_method,
    payment_reference    VARCHAR(255),
    paused_at            TIMESTAMP WITH TIME ZONE,
    pause_reason         TEXT,
    cancelled_at         TIMESTAMP WITH TIME ZONE,
    cancellation_reason  TEXT,
    -- migración 003_orders_payment_system
    order_id             UUID,   -- FK se agrega al crear orders
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memberships_user     ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status   ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_end_date ON memberships(end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_active   ON memberships(user_id, status) WHERE status = 'active';

DROP TRIGGER IF EXISTS update_memberships_updated_at ON memberships;
CREATE TRIGGER update_memberships_updated_at
    BEFORE UPDATE ON memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- CLASS TYPES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_types (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(100) NOT NULL,
    description      TEXT,
    level            class_level DEFAULT 'all',
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    max_capacity     INTEGER NOT NULL DEFAULT 8,
    icon             VARCHAR(50),
    color            VARCHAR(7),
    is_active        BOOLEAN DEFAULT true,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_class_types_active ON class_types(is_active);

DROP TRIGGER IF EXISTS update_class_types_updated_at ON class_types;
CREATE TRIGGER update_class_types_updated_at
    BEFORE UPDATE ON class_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- FACILITIES (migración 002_coach_system)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    capacity    INTEGER NOT NULL DEFAULT 12,
    equipment   JSONB DEFAULT '[]'::jsonb,
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO facilities (name, description, capacity)
VALUES ('Sala Principal', 'Sala principal con reformers', 12)
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------
-- INSTRUCTORS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS instructors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    VARCHAR(255) NOT NULL,
    bio             TEXT,
    photo_url       TEXT,
    specialties     JSONB DEFAULT '[]'::jsonb,
    certifications  JSONB DEFAULT '[]'::jsonb,
    is_active       BOOLEAN DEFAULT true,
    -- migraciones 002_coach_system / 003_add_coach_portal_fields / 006_coach_features
    pay_rate_per_class  DECIMAL(10, 2),
    pay_rate_per_hour   DECIMAL(10, 2),
    permissions         JSONB DEFAULT '{"can_checkin": true, "can_view_client_notes": true, "can_edit_profile": true}'::jsonb,
    phone               VARCHAR(20),
    email               VARCHAR(255),
    visible_public      BOOLEAN DEFAULT true,
    coach_number        VARCHAR(20) UNIQUE,
    password_hash       VARCHAR(255),
    temp_password       BOOLEAN DEFAULT false,
    last_login          TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instructors_user         ON instructors(user_id);
CREATE INDEX IF NOT EXISTS idx_instructors_active       ON instructors(is_active);
CREATE INDEX IF NOT EXISTS idx_instructors_coach_number ON instructors(coach_number);

DROP TRIGGER IF EXISTS update_instructors_updated_at ON instructors;
CREATE TRIGGER update_instructors_updated_at
    BEFORE UPDATE ON instructors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- SCHEDULES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_type_id  UUID NOT NULL REFERENCES class_types(id) ON DELETE CASCADE,
    instructor_id  UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    facility_id    UUID REFERENCES facilities(id),
    day_of_week    INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    max_capacity   INTEGER NOT NULL DEFAULT 8,
    is_recurring   BOOLEAN DEFAULT true,
    specific_date  DATE,
    is_active      BOOLEAN DEFAULT true,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedules_day        ON schedules(day_of_week) WHERE is_recurring = true;
CREATE INDEX IF NOT EXISTS idx_schedules_instructor ON schedules(instructor_id);
CREATE INDEX IF NOT EXISTS idx_schedules_class_type ON schedules(class_type_id);
CREATE INDEX IF NOT EXISTS idx_schedules_active     ON schedules(is_active);

DROP TRIGGER IF EXISTS update_schedules_updated_at ON schedules;
CREATE TRIGGER update_schedules_updated_at
    BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- CLASSES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id          UUID REFERENCES schedules(id) ON DELETE SET NULL,
    class_type_id        UUID NOT NULL REFERENCES class_types(id) ON DELETE RESTRICT,
    instructor_id        UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
    facility_id          UUID REFERENCES facilities(id),
    date                 DATE NOT NULL,
    start_time           TIME NOT NULL,
    end_time             TIME NOT NULL,
    max_capacity         INTEGER NOT NULL DEFAULT 8,
    current_bookings     INTEGER DEFAULT 0,
    status               class_status DEFAULT 'scheduled',
    level                class_level,
    notes                TEXT,
    cancellation_reason  TEXT,
    cancelled_by         UUID REFERENCES users(id),
    cancelled_at         TIMESTAMP WITH TIME ZONE,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_classes_date      ON classes(date);
CREATE INDEX IF NOT EXISTS idx_classes_instructor ON classes(instructor_id);
CREATE INDEX IF NOT EXISTS idx_classes_status    ON classes(status);
CREATE INDEX IF NOT EXISTS idx_classes_date_time ON classes(date, start_time);

DROP TRIGGER IF EXISTS update_classes_updated_at ON classes;
CREATE TRIGGER update_classes_updated_at
    BEFORE UPDATE ON classes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- BOOKINGS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id             UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id        UUID REFERENCES memberships(id) ON DELETE SET NULL,
    status               booking_status NOT NULL DEFAULT 'confirmed',
    waitlist_position    INTEGER,
    checked_in_at        TIMESTAMP WITH TIME ZONE,
    checked_in_by        UUID REFERENCES users(id),
    cancelled_at         TIMESTAMP WITH TIME ZONE,
    cancellation_reason  TEXT,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_booking UNIQUE (class_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_class      ON bookings(class_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user       ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_membership ON bookings(membership_id);

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- LOYALTY POINTS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_points (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points            INTEGER NOT NULL,
    type              loyalty_points_type NOT NULL,
    description       TEXT,
    related_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    related_reward_id  UUID,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_points_user    ON loyalty_points(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_type    ON loyalty_points(type);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_created ON loyalty_points(created_at);

-- --------------------------------------------------------
-- REWARDS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewards (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    points_cost INTEGER NOT NULL,
    category    reward_category NOT NULL,
    image_url   TEXT,
    stock       INTEGER,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE loyalty_points
    ADD CONSTRAINT IF NOT EXISTS fk_loyalty_related_reward
    FOREIGN KEY (related_reward_id) REFERENCES rewards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rewards_active   ON rewards(is_active);
CREATE INDEX IF NOT EXISTS idx_rewards_category ON rewards(category);

DROP TRIGGER IF EXISTS update_rewards_updated_at ON rewards;
CREATE TRIGGER update_rewards_updated_at
    BEFORE UPDATE ON rewards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- REDEMPTIONS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS redemptions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id     UUID NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
    points_spent  INTEGER NOT NULL,
    status        redemption_status NOT NULL DEFAULT 'pending',
    fulfilled_at  TIMESTAMP WITH TIME ZONE,
    fulfilled_by  UUID REFERENCES users(id),
    notes         TEXT,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user   ON redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_status ON redemptions(status);

DROP TRIGGER IF EXISTS update_redemptions_updated_at ON redemptions;
CREATE TRIGGER update_redemptions_updated_at
    BEFORE UPDATE ON redemptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- NOTIFICATIONS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL,
    body       TEXT NOT NULL,
    type       notification_type NOT NULL,
    data       JSONB DEFAULT '{}'::jsonb,
    is_read    BOOLEAN DEFAULT false,
    sent_at    TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type    ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- --------------------------------------------------------
-- WALLET PASSES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_passes (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id        UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    platform             wallet_platform NOT NULL,
    serial_number        VARCHAR(255) NOT NULL UNIQUE,
    pass_type_identifier VARCHAR(255),
    google_object_id     VARCHAR(255),
    auth_token           VARCHAR(255),
    last_updated         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_passes_user       ON wallet_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_passes_membership ON wallet_passes(membership_id);
CREATE INDEX IF NOT EXISTS idx_wallet_passes_serial     ON wallet_passes(serial_number);

-- --------------------------------------------------------
-- PAYMENTS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
    amount         DECIMAL(10, 2) NOT NULL,
    currency       VARCHAR(3) DEFAULT 'MXN',
    payment_method payment_method NOT NULL,
    reference      VARCHAR(255),
    notes          TEXT,
    status         VARCHAR(50) DEFAULT 'completed',
    processed_by   UUID REFERENCES users(id),
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user       ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_membership ON payments(membership_id);
CREATE INDEX IF NOT EXISTS idx_payments_date       ON payments(created_at);

-- --------------------------------------------------------
-- SYSTEM SETTINGS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by  UUID REFERENCES users(id)
);

-- --------------------------------------------------------
-- ADMIN NOTES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_notes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    note       TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_notes(user_id);

-- ============================================================
-- SECCIÓN 5: TABLAS DE VIDEOS
-- (de la tabla videos base + migraciones 009 y 010)
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    subtitle         VARCHAR(255),
    tagline          VARCHAR(255),
    video_url        TEXT,
    drive_file_id    VARCHAR(255),
    thumbnail_url    TEXT,
    thumbnail_drive_id VARCHAR(255),
    duration_seconds INTEGER,
    days             VARCHAR(100),
    brand_color      VARCHAR(7),
    access_type      VARCHAR(50) DEFAULT 'free'
        CHECK (access_type IN ('free', 'members', 'gratuito', 'miembros')),
    class_type_id    UUID REFERENCES class_types(id) ON DELETE SET NULL,
    instructor_id    UUID REFERENCES instructors(id) ON DELETE SET NULL,
    is_published     BOOLEAN DEFAULT false,
    is_featured      BOOLEAN DEFAULT false,
    -- Campos de venta (migración 009)
    sales_enabled       BOOLEAN DEFAULT false,
    sales_price_mxn     DECIMAL(10,2),
    sales_class_credits INTEGER,
    sales_cta_text      VARCHAR(100),
    -- Campo de desbloqueo (migración 010)
    sales_unlocks_video BOOLEAN DEFAULT false,
    view_count       INTEGER DEFAULT 0,
    sort_order       INTEGER DEFAULT 0,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_videos_published   ON videos(is_published);
CREATE INDEX IF NOT EXISTS idx_videos_access_type ON videos(access_type);
CREATE INDEX IF NOT EXISTS idx_videos_instructor  ON videos(instructor_id);
CREATE INDEX IF NOT EXISTS idx_videos_class_type  ON videos(class_type_id);
CREATE INDEX IF NOT EXISTS idx_videos_featured    ON videos(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_videos_sales       ON videos(sales_enabled) WHERE sales_enabled = true;

DROP TRIGGER IF EXISTS update_videos_updated_at ON videos;
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SECCIÓN 6: ÓRDENES Y PAGOS (migración 003_orders_payment_system)
-- ============================================================

-- Secuencia para número de orden legible
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1000;

-- Función para generar número de orden
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'ORD-' || LPAD(nextval('order_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Función trigger para asignar número de orden
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL THEN
        NEW.order_number := generate_order_number();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number     VARCHAR(20) UNIQUE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id          UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status           order_status NOT NULL DEFAULT 'pending_payment',
    payment_method   payment_method NOT NULL DEFAULT 'transfer',
    subtotal         DECIMAL(10, 2) NOT NULL,
    tax_amount       DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_amount     DECIMAL(10, 2) NOT NULL,
    currency         VARCHAR(3) DEFAULT 'MXN',
    bank_info        JSONB,
    notes            TEXT,
    admin_notes      TEXT,
    rejection_reason TEXT,
    expires_at       TIMESTAMP WITH TIME ZONE,
    paid_at          TIMESTAMP WITH TIME ZONE,
    approved_at      TIMESTAMP WITH TIME ZONE,
    rejected_at      TIMESTAMP WITH TIME ZONE,
    approved_by      UUID REFERENCES users(id),
    rejected_by      UUID REFERENCES users(id),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_number  ON orders(order_number);

DROP TRIGGER IF EXISTS set_order_number_trigger ON orders;
CREATE TRIGGER set_order_number_trigger
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION set_order_number();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- FK de memberships hacia orders (se agrega después de crear orders)
ALTER TABLE memberships
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS payment_proofs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    file_url            TEXT NOT NULL,
    file_name           VARCHAR(255),
    file_size           INTEGER,
    mime_type           VARCHAR(100),
    last_four_digits    VARCHAR(4),
    bank_reference      VARCHAR(100),
    amount_shown        DECIMAL(10, 2),
    status              VARCHAR(50) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason    TEXT,
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMP WITH TIME ZONE,
    uploaded_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proofs_order   ON payment_proofs(order_id);
CREATE INDEX IF NOT EXISTS idx_proofs_status  ON payment_proofs(status);
CREATE INDEX IF NOT EXISTS idx_proofs_uploaded ON payment_proofs(uploaded_at DESC);

DROP TRIGGER IF EXISTS update_payment_proofs_updated_at ON payment_proofs;
CREATE TRIGGER update_payment_proofs_updated_at
    BEFORE UPDATE ON payment_proofs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabla de auditoría de acciones admin
CREATE TABLE IF NOT EXISTS admin_actions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type    VARCHAR(100) NOT NULL,
    entity_type    VARCHAR(50) NOT NULL,
    entity_id      UUID NOT NULL,
    description    TEXT,
    old_data       JSONB,
    new_data       JSONB,
    ip_address     INET,
    user_agent     TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin   ON admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_entity  ON admin_actions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at DESC);

-- ============================================================
-- SECCIÓN 7: COMPRAS DE VIDEOS (migración 010_video_purchase_unlocks)
-- ============================================================
CREATE TABLE IF NOT EXISTS video_purchases (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id            UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              video_purchase_status NOT NULL DEFAULT 'pending_payment',
    payment_method      payment_method DEFAULT 'transfer',
    amount_mxn          DECIMAL(10,2),
    proof_url           TEXT,
    proof_uploaded_at   TIMESTAMP WITH TIME ZONE,
    bank_reference      VARCHAR(100),
    rejection_reason    TEXT,
    has_access          BOOLEAN DEFAULT false,
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMP WITH TIME ZONE,
    rejected_by         UUID REFERENCES users(id),
    rejected_at         TIMESTAMP WITH TIME ZONE,
    expires_at          TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_video_purchase UNIQUE (video_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_purchases_video   ON video_purchases(video_id);
CREATE INDEX IF NOT EXISTS idx_video_purchases_user    ON video_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_video_purchases_status  ON video_purchases(status);
CREATE INDEX IF NOT EXISTS idx_video_purchases_access  ON video_purchases(has_access) WHERE has_access = true;

DROP TRIGGER IF EXISTS update_video_purchases_updated_at ON video_purchases;
CREATE TRIGGER update_video_purchases_updated_at
    BEFORE UPDATE ON video_purchases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SECCIÓN 8: RESERVACIONES DE INVITADOS (migración 001_add_guest_bookings)
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_bookings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id            UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    guest_name          VARCHAR(255) NOT NULL,
    guest_email         VARCHAR(255),
    guest_phone         VARCHAR(20) NOT NULL,
    confirmation_code   VARCHAR(20) UNIQUE NOT NULL,
    status              booking_status NOT NULL DEFAULT 'confirmed',
    payment_method      payment_method NOT NULL,
    amount_paid         DECIMAL(10, 2) NOT NULL,
    currency            VARCHAR(3) DEFAULT 'MXN',
    payment_reference   VARCHAR(255),
    notes               TEXT,
    checked_in_at       TIMESTAMP WITH TIME ZONE,
    checked_in_by       UUID REFERENCES users(id),
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guest_bookings_class        ON guest_bookings(class_id);
CREATE INDEX IF NOT EXISTS idx_guest_bookings_phone        ON guest_bookings(guest_phone);
CREATE INDEX IF NOT EXISTS idx_guest_bookings_email        ON guest_bookings(guest_email);
CREATE INDEX IF NOT EXISTS idx_guest_bookings_confirmation ON guest_bookings(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_guest_bookings_created_at  ON guest_bookings(created_at);

DROP TRIGGER IF EXISTS update_guest_bookings_updated_at ON guest_bookings;
CREATE TRIGGER update_guest_bookings_updated_at
    BEFORE UPDATE ON guest_bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE guest_bookings IS 'Reservaciones de walk-in sin membresía';

-- ============================================================
-- SECCIÓN 9: SISTEMA DE WALLET (migraciones 001 y 003_wallet_tables)
-- ============================================================

-- Apple Wallet: dispositivos registrados
CREATE TABLE IF NOT EXISTS apple_wallet_devices (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id      VARCHAR(255) NOT NULL,
    push_token     VARCHAR(255) NOT NULL,
    pass_type_id   VARCHAR(255) NOT NULL,
    membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_device_registration UNIQUE (device_id, pass_type_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_awd_membership ON apple_wallet_devices(membership_id);
CREATE INDEX IF NOT EXISTS idx_awd_device     ON apple_wallet_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_awd_push_token ON apple_wallet_devices(push_token);

DROP TRIGGER IF EXISTS update_apple_wallet_devices_updated_at ON apple_wallet_devices;
CREATE TRIGGER update_apple_wallet_devices_updated_at
    BEFORE UPDATE ON apple_wallet_devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apple Wallet: historial de actualizaciones
CREATE TABLE IF NOT EXISTS apple_wallet_updates (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    classes_old    INT,
    classes_new    INT,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_awu_membership ON apple_wallet_updates(membership_id);
CREATE INDEX IF NOT EXISTS idx_awu_updated    ON apple_wallet_updates(updated_at);

-- Notificaciones de wallet push
CREATE TABLE IF NOT EXISTS notification_logs (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    title          VARCHAR(255),
    message        TEXT NOT NULL,
    channel        notification_channel NOT NULL,
    status         notification_status NOT NULL DEFAULT 'pending',
    error          TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nl_membership ON notification_logs(membership_id);
CREATE INDEX IF NOT EXISTS idx_nl_created    ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_nl_channel    ON notification_logs(channel);
CREATE INDEX IF NOT EXISTS idx_nl_status     ON notification_logs(status);

-- Historial de actualizaciones de pases (migración 004)
CREATE TABLE IF NOT EXISTS wallet_pass_updates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_pass_id   UUID NOT NULL REFERENCES wallet_passes(id) ON DELETE CASCADE,
    membership_id    UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    classes_before   INTEGER,
    classes_after    INTEGER,
    status_before    membership_status,
    status_after     membership_status,
    trigger_type     VARCHAR(50) NOT NULL,
    trigger_booking_id UUID REFERENCES bookings(id),
    push_sent        BOOLEAN DEFAULT false,
    push_sent_at     TIMESTAMP WITH TIME ZONE,
    push_status      VARCHAR(50),
    push_error       TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_updates_pass       ON wallet_pass_updates(wallet_pass_id);
CREATE INDEX IF NOT EXISTS idx_wallet_updates_membership ON wallet_pass_updates(membership_id);
CREATE INDEX IF NOT EXISTS idx_wallet_updates_created   ON wallet_pass_updates(created_at);

-- ============================================================
-- SECCIÓN 10: SISTEMA DE COACH (migración 002_coach_system)
-- ============================================================

-- Disponibilidad de instructores
CREATE TABLE IF NOT EXISTS instructor_availability (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instructor_id  UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    day_of_week    INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    is_available   BOOLEAN DEFAULT true,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_instructor_day_time UNIQUE (instructor_id, day_of_week, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_instructor_availability_instructor ON instructor_availability(instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_availability_day        ON instructor_availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_availability_instructor ON instructor_availability(instructor_id);
CREATE INDEX IF NOT EXISTS idx_availability_day        ON instructor_availability(day_of_week);

DROP TRIGGER IF EXISTS update_instructor_availability_updated_at ON instructor_availability;
CREATE TRIGGER update_instructor_availability_updated_at
    BEFORE UPDATE ON instructor_availability
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sustituciones de coach (migración 002)
CREATE TABLE IF NOT EXISTS coach_substitutions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id              UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    original_instructor_id UUID NOT NULL REFERENCES instructors(id),
    new_instructor_id     UUID NOT NULL REFERENCES instructors(id),
    reason                TEXT,
    substituted_by        UUID NOT NULL REFERENCES users(id),
    notified_original     BOOLEAN DEFAULT false,
    notified_new          BOOLEAN DEFAULT false,
    notified_clients      BOOLEAN DEFAULT false,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_substitutions_class    ON coach_substitutions(class_id);
CREATE INDEX IF NOT EXISTS idx_substitutions_original ON coach_substitutions(original_instructor_id);
CREATE INDEX IF NOT EXISTS idx_substitutions_new      ON coach_substitutions(new_instructor_id);

-- Sustituciones de coach v2 (migración 006_coach_features)
CREATE TABLE IF NOT EXISTS class_substitutions (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id                 UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    original_instructor_id   UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    substitute_instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL,
    reason                   TEXT,
    status                   VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    requested_at             TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    responded_at             TIMESTAMP WITH TIME ZONE,
    response_note            TEXT,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_class_sub_class      ON class_substitutions(class_id);
CREATE INDEX IF NOT EXISTS idx_class_sub_original   ON class_substitutions(original_instructor_id);
CREATE INDEX IF NOT EXISTS idx_class_sub_substitute ON class_substitutions(substitute_instructor_id);
CREATE INDEX IF NOT EXISTS idx_class_sub_status     ON class_substitutions(status);

DROP TRIGGER IF EXISTS update_class_substitutions_updated_at ON class_substitutions;
CREATE TRIGGER update_class_substitutions_updated_at
    BEFORE UPDATE ON class_substitutions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Playlists de coach (migración 006_coach_features)
CREATE TABLE IF NOT EXISTS coach_playlists (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instructor_id  UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    class_type_id  UUID REFERENCES class_types(id) ON DELETE SET NULL,
    name           VARCHAR(255) NOT NULL,
    description    TEXT,
    platform       VARCHAR(50) NOT NULL DEFAULT 'spotify'
        CHECK (platform IN ('spotify', 'apple_music', 'youtube', 'other')),
    url            TEXT NOT NULL,
    duration_minutes INTEGER,
    is_public      BOOLEAN DEFAULT false,
    is_favorite    BOOLEAN DEFAULT false,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlists_instructor  ON coach_playlists(instructor_id);
CREATE INDEX IF NOT EXISTS idx_playlists_class_type  ON coach_playlists(class_type_id);
CREATE INDEX IF NOT EXISTS idx_playlists_public      ON coach_playlists(is_public) WHERE is_public = true;

DROP TRIGGER IF EXISTS update_coach_playlists_updated_at ON coach_playlists;
CREATE TRIGGER update_coach_playlists_updated_at
    BEFORE UPDATE ON coach_playlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tokens para reset de contraseña (migración 003_add_coach_portal_fields)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    used        BOOLEAN DEFAULT false,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_token   ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at);

-- Función para generar número de coach
CREATE OR REPLACE FUNCTION generate_coach_number()
RETURNS VARCHAR(20) AS $$
DECLARE
    new_number VARCHAR(20);
    max_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(coach_number FROM 7) AS INTEGER)), 0)
    INTO max_num
    FROM instructors
    WHERE coach_number IS NOT NULL;
    new_number := 'COACH-' || LPAD((max_num + 1)::TEXT, 4, '0');
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECCIÓN 11: CHECK-INS Y RESEÑAS (migración 004)
-- ============================================================

CREATE TABLE IF NOT EXISTS checkin_logs (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id               UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id                 UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    membership_id            UUID REFERENCES memberships(id) ON DELETE SET NULL,
    checkin_method           checkin_method NOT NULL DEFAULT 'qr_scan',
    checked_in_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    checked_in_by            UUID REFERENCES users(id),
    device_id                VARCHAR(255),
    device_type              VARCHAR(100),
    device_model             VARCHAR(100),
    app_version              VARCHAR(20),
    ip_address               INET,
    user_agent               TEXT,
    latitude                 DECIMAL(10, 8),
    longitude                DECIMAL(11, 8),
    location_accuracy        DECIMAL(6, 2),
    distance_from_studio     DECIMAL(8, 2),
    qr_code_used             VARCHAR(255),
    qr_generated_at          TIMESTAMP WITH TIME ZONE,
    is_late                  BOOLEAN DEFAULT false,
    minutes_early_late       INTEGER,
    is_first_class           BOOLEAN DEFAULT false,
    notes                    TEXT,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checkin_logs_booking ON checkin_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_user    ON checkin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_class   ON checkin_logs(class_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_date    ON checkin_logs(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_device  ON checkin_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_ip      ON checkin_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_method  ON checkin_logs(checkin_method);

COMMENT ON TABLE checkin_logs IS 'Log detallado de todos los check-ins con tracking de dispositivo y ubicación';

CREATE TABLE IF NOT EXISTS review_tags (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(50) NOT NULL,
    name_en     VARCHAR(50),
    category    VARCHAR(50) NOT NULL,
    icon        VARCHAR(50),
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_tags_category ON review_tags(category);
CREATE INDEX IF NOT EXISTS idx_review_tags_active   ON review_tags(is_active);

CREATE TABLE IF NOT EXISTS reviews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id            UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    instructor_id       UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    overall_rating      SMALLINT NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    instructor_rating   SMALLINT CHECK (instructor_rating >= 1 AND instructor_rating <= 5),
    difficulty_rating   SMALLINT CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5),
    ambiance_rating     SMALLINT CHECK (ambiance_rating >= 1 AND ambiance_rating <= 5),
    comment             TEXT,
    comment_length      INTEGER GENERATED ALWAYS AS (COALESCE(LENGTH(comment), 0)) STORED,
    status              review_status NOT NULL DEFAULT 'published',
    is_anonymous        BOOLEAN DEFAULT false,
    is_featured         BOOLEAN DEFAULT false,
    points_earned       INTEGER DEFAULT 0,
    points_awarded_at   TIMESTAMP WITH TIME ZONE,
    flagged_at          TIMESTAMP WITH TIME ZONE,
    flagged_reason      TEXT,
    moderated_by        UUID REFERENCES users(id),
    moderated_at        TIMESTAMP WITH TIME ZONE,
    submitted_from      VARCHAR(50),
    notification_sent_at TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_review_per_booking UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_user           ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_class          ON reviews(class_id);
CREATE INDEX IF NOT EXISTS idx_reviews_instructor     ON reviews(instructor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status         ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_overall_rating ON reviews(overall_rating);
CREATE INDEX IF NOT EXISTS idx_reviews_created        ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_featured       ON reviews(is_featured) WHERE is_featured = true;

DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS review_tag_selections (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id   UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES review_tags(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_tag_per_review UNIQUE (review_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_review_tags_review ON review_tag_selections(review_id);
CREATE INDEX IF NOT EXISTS idx_review_tags_tag    ON review_tag_selections(tag_id);

CREATE TABLE IF NOT EXISTS review_responses (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id             UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    responded_by          UUID NOT NULL REFERENCES users(id),
    response_type         response_type NOT NULL DEFAULT 'thank_you',
    response_text         TEXT NOT NULL,
    is_public             BOOLEAN DEFAULT true,
    is_resolved           BOOLEAN DEFAULT false,
    compensation_offered  TEXT,
    compensation_value    DECIMAL(10, 2),
    compensation_redeemed BOOLEAN DEFAULT false,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review ON review_responses(review_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_user   ON review_responses(responded_by);

DROP TRIGGER IF EXISTS update_review_responses_updated_at ON review_responses;
CREATE TRIGGER update_review_responses_updated_at
    BEFORE UPDATE ON review_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS review_requests (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id         UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    class_ended_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    send_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at          TIMESTAMP WITH TIME ZONE,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending',
    channel          VARCHAR(20) NOT NULL DEFAULT 'push',
    reminder_count   INTEGER DEFAULT 0,
    last_reminder_at TIMESTAMP WITH TIME ZONE,
    review_id        UUID REFERENCES reviews(id),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_review_request UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_status  ON review_requests(status);
CREATE INDEX IF NOT EXISTS idx_review_requests_send_at ON review_requests(send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_requests_user    ON review_requests(user_id);

DROP TRIGGER IF EXISTS update_review_requests_updated_at ON review_requests;
CREATE TRIGGER update_review_requests_updated_at
    BEFORE UPDATE ON review_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS suspicious_activity (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
    checkin_log_id  UUID REFERENCES checkin_logs(id) ON DELETE SET NULL,
    activity_type   suspicious_activity_type NOT NULL,
    severity        VARCHAR(20) NOT NULL DEFAULT 'low',
    description     TEXT NOT NULL,
    evidence        JSONB DEFAULT '{}'::jsonb,
    device_ids      TEXT[],
    ip_addresses    INET[],
    is_reviewed     BOOLEAN DEFAULT false,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    is_false_positive BOOLEAN DEFAULT false,
    action_taken    VARCHAR(100),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suspicious_user     ON suspicious_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_type     ON suspicious_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_suspicious_severity ON suspicious_activity(severity);
CREATE INDEX IF NOT EXISTS idx_suspicious_reviewed ON suspicious_activity(is_reviewed);
CREATE INDEX IF NOT EXISTS idx_suspicious_created  ON suspicious_activity(created_at);

-- ============================================================
-- SECCIÓN 12: WORKOUT TEMPLATES (migración 005_workout_templates)
-- ============================================================

CREATE TABLE IF NOT EXISTS workout_templates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    class_type_id    UUID REFERENCES class_types(id) ON DELETE SET NULL,
    created_by       UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    duration_minutes INTEGER DEFAULT 50,
    difficulty       VARCHAR(20) DEFAULT 'intermediate'
        CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    equipment_needed JSONB DEFAULT '[]'::jsonb,
    music_playlist_url TEXT,
    is_public        BOOLEAN DEFAULT true,
    is_featured      BOOLEAN DEFAULT false,
    uses_count       INTEGER DEFAULT 0,
    tags             JSONB DEFAULT '[]'::jsonb,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workout_templates_class_type  ON workout_templates(class_type_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_created_by  ON workout_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_workout_templates_public      ON workout_templates(is_public);
CREATE INDEX IF NOT EXISTS idx_workout_templates_featured    ON workout_templates(is_featured);

DROP TRIGGER IF EXISTS update_workout_templates_updated_at ON workout_templates;
CREATE TRIGGER update_workout_templates_updated_at
    BEFORE UPDATE ON workout_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS workout_exercises (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id      UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    duration_seconds INTEGER,
    reps             INTEGER,
    sets             INTEGER DEFAULT 1,
    rest_seconds     INTEGER DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    section          VARCHAR(50) DEFAULT 'main',
    video_url        TEXT,
    image_url        TEXT,
    notes            TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_template ON workout_exercises(template_id);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_order   ON workout_exercises(template_id, sort_order);

CREATE TABLE IF NOT EXISTS class_workouts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    template_id  UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
    assigned_by  UUID NOT NULL REFERENCES instructors(id),
    notes        TEXT,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_class_workout UNIQUE (class_id)
);

CREATE INDEX IF NOT EXISTS idx_class_workouts_class    ON class_workouts(class_id);
CREATE INDEX IF NOT EXISTS idx_class_workouts_template ON class_workouts(template_id);

CREATE TABLE IF NOT EXISTS template_favorites (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id   UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_favorite UNIQUE (template_id, instructor_id)
);

CREATE INDEX IF NOT EXISTS idx_template_favorites_instructor ON template_favorites(instructor_id);

-- Trigger para contar usos de template
CREATE OR REPLACE FUNCTION update_template_uses_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE workout_templates SET uses_count = uses_count + 1 WHERE id = NEW.template_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE workout_templates SET uses_count = uses_count - 1 WHERE id = OLD.template_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_template_uses ON class_workouts;
CREATE TRIGGER trigger_update_template_uses
AFTER INSERT OR DELETE ON class_workouts
FOR EACH ROW EXECUTE FUNCTION update_template_uses_count();

-- ============================================================
-- SECCIÓN 13: EVENTOS (migración 008_events_system)
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                VARCHAR(255) NOT NULL,
    description          TEXT,
    type                 event_type NOT NULL DEFAULT 'special',
    status               event_status NOT NULL DEFAULT 'draft',
    date                 DATE NOT NULL,
    start_time           TIME NOT NULL,
    end_time             TIME NOT NULL,
    location             VARCHAR(255) DEFAULT 'Catarsis Studio',
    capacity             INTEGER NOT NULL DEFAULT 20,
    registered           INTEGER NOT NULL DEFAULT 0,
    price                DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    currency             VARCHAR(3) DEFAULT 'MXN',
    early_bird_price     DECIMAL(10, 2),
    early_bird_deadline  DATE,
    member_discount      INTEGER DEFAULT 0,
    image                TEXT,
    instructor_id        UUID REFERENCES instructors(id) ON DELETE SET NULL,
    instructor_name      VARCHAR(255),
    instructor_photo     TEXT,
    requirements         TEXT,
    includes             JSONB DEFAULT '[]'::jsonb,
    tags                 JSONB DEFAULT '[]'::jsonb,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_date       ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_status     ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_instructor ON events(instructor_id);
CREATE INDEX IF NOT EXISTS idx_events_upcoming   ON events(date, start_time) WHERE status = 'published';

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS event_registrations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    name             VARCHAR(255) NOT NULL,
    email            VARCHAR(255) NOT NULL,
    phone            VARCHAR(20),
    status           event_registration_status NOT NULL DEFAULT 'pending',
    amount           DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    payment_method   payment_method,
    payment_reference VARCHAR(255),
    paid_at          TIMESTAMP WITH TIME ZONE,
    checked_in       BOOLEAN DEFAULT false,
    checked_in_at    TIMESTAMP WITH TIME ZONE,
    checked_in_by    UUID REFERENCES users(id),
    waitlist_position INTEGER,
    notes            TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_event_registration UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_event_reg_event  ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_user   ON event_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_status ON event_registrations(status);
CREATE INDEX IF NOT EXISTS idx_event_reg_email  ON event_registrations(email);

DROP TRIGGER IF EXISTS update_event_registrations_updated_at ON event_registrations;
CREATE TRIGGER update_event_registrations_updated_at
    BEFORE UPDATE ON event_registrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: actualizar contador de registros en evento
CREATE OR REPLACE FUNCTION update_event_registration_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IN ('confirmed', 'pending') THEN
            UPDATE events SET registered = registered + 1 WHERE id = NEW.event_id;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status NOT IN ('confirmed', 'pending') AND NEW.status IN ('confirmed', 'pending') THEN
            UPDATE events SET registered = registered + 1 WHERE id = NEW.event_id;
        ELSIF OLD.status IN ('confirmed', 'pending') AND NEW.status NOT IN ('confirmed', 'pending') THEN
            UPDATE events SET registered = GREATEST(registered - 1, 0) WHERE id = NEW.event_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('confirmed', 'pending') THEN
            UPDATE events SET registered = GREATEST(registered - 1, 0) WHERE id = OLD.event_id;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_event_registration_count ON event_registrations;
CREATE TRIGGER trigger_update_event_registration_count
    AFTER INSERT OR UPDATE OR DELETE ON event_registrations
    FOR EACH ROW EXECUTE FUNCTION update_event_registration_count();

-- ============================================================
-- SECCIÓN 14: FUNCIONES DE NEGOCIO
-- ============================================================

-- Puntos acumulados de un usuario
CREATE OR REPLACE FUNCTION get_user_points(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_points INTEGER;
BEGIN
    SELECT COALESCE(SUM(points), 0) INTO total_points
    FROM loyalty_points
    WHERE user_id = p_user_id;
    RETURN total_points;
END;
$$ LANGUAGE plpgsql;

-- ── [REMOVIDO] Triggers de descuento de créditos y booking count ──
-- Ver INCIDENTE-CLASES-DUPLICADAS.md.
-- Estos triggers duplicaban la lógica que el backend (server/index.js)
-- ya ejecuta al crear/cancelar reservas y al asignar desde admin,
-- causando un doble descuento por cada check-in. La fuente de verdad
-- para `classes_remaining` y `classes.current_bookings` es el servidor.
-- Defensa extra: server/index.js `ensureSchema()` hace DROP idempotente
-- en cada arranque, así que si alguien reaplica este schema los triggers
-- se eliminan en el siguiente boot.
DROP TRIGGER IF EXISTS trigger_decrement_classes ON bookings;
DROP FUNCTION IF EXISTS decrement_membership_classes() CASCADE;
DROP TRIGGER IF EXISTS trigger_update_booking_count ON bookings;
DROP FUNCTION IF EXISTS update_class_booking_count() CASCADE;

-- Otorgar puntos por reseña
CREATE OR REPLACE FUNCTION award_review_points()
RETURNS TRIGGER AS $$
DECLARE
    points_for_review INTEGER := 50;
    bonus_for_comment INTEGER := 25;
    total_points INTEGER;
BEGIN
    IF NEW.status = 'published' AND (OLD IS NULL OR OLD.status != 'published') THEN
        total_points := points_for_review;
        IF NEW.comment_length > 50 THEN
            total_points := total_points + bonus_for_comment;
        END IF;
        INSERT INTO loyalty_points (user_id, points, type, description, related_booking_id)
        VALUES (
            NEW.user_id, total_points, 'bonus',
            CASE WHEN NEW.comment_length > 50 THEN 'Reseña con comentario detallado' ELSE 'Reseña de clase' END,
            NEW.booking_id
        );
        NEW.points_earned := total_points;
        NEW.points_awarded_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_award_review_points ON reviews;
CREATE TRIGGER trigger_award_review_points
    BEFORE INSERT OR UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION award_review_points();

-- Crear solicitud de reseña automática al hacer check-in
CREATE OR REPLACE FUNCTION create_review_request()
RETURNS TRIGGER AS $$
DECLARE
    class_end TIMESTAMP WITH TIME ZONE;
BEGIN
    IF NEW.status = 'checked_in' AND (OLD IS NULL OR OLD.status != 'checked_in') THEN
        SELECT (c.date + c.end_time)::timestamp with time zone
        INTO class_end
        FROM classes c WHERE c.id = NEW.class_id;
        INSERT INTO review_requests (
            booking_id, user_id, class_id, class_ended_at, send_at, status
        ) VALUES (
            NEW.id, NEW.user_id, NEW.class_id,
            class_end, class_end + INTERVAL '2 hours', 'pending'
        )
        ON CONFLICT (booking_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_review_request ON bookings;
CREATE TRIGGER trigger_create_review_request
    AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION create_review_request();

-- Detectar actividad sospechosa en check-ins
CREATE OR REPLACE FUNCTION detect_suspicious_checkin()
RETURNS TRIGGER AS $$
DECLARE
    recent_checkins_count INTEGER;
    different_devices_count INTEGER;
    max_distance DECIMAL := 500;
BEGIN
    SELECT COUNT(*) INTO recent_checkins_count
    FROM checkin_logs
    WHERE user_id = NEW.user_id
    AND checked_in_at > (NEW.checked_in_at - INTERVAL '5 minutes')
    AND id != NEW.id;
    IF recent_checkins_count > 0 THEN
        INSERT INTO suspicious_activity (user_id, booking_id, checkin_log_id, activity_type, severity, description, evidence)
        VALUES (NEW.user_id, NEW.booking_id, NEW.id, 'rapid_checkins', 'medium', 'Múltiples check-ins en menos de 5 minutos',
            jsonb_build_object('recent_count', recent_checkins_count + 1, 'device_id', NEW.device_id, 'ip', NEW.ip_address::text));
    END IF;
    IF NEW.device_id IS NOT NULL THEN
        SELECT COUNT(DISTINCT device_id) INTO different_devices_count
        FROM checkin_logs
        WHERE user_id = NEW.user_id AND device_id IS NOT NULL
        AND checked_in_at > (NEW.checked_in_at - INTERVAL '24 hours');
        IF different_devices_count > 2 THEN
            INSERT INTO suspicious_activity (user_id, booking_id, checkin_log_id, activity_type, severity, description, evidence)
            VALUES (NEW.user_id, NEW.booking_id, NEW.id, 'multiple_devices', 'high', 'Check-in desde múltiples dispositivos en 24 horas',
                jsonb_build_object('device_count', different_devices_count, 'current_device', NEW.device_id));
        END IF;
    END IF;
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        IF NEW.distance_from_studio > max_distance THEN
            INSERT INTO suspicious_activity (user_id, booking_id, checkin_log_id, activity_type, severity, description, evidence)
            VALUES (NEW.user_id, NEW.booking_id, NEW.id, 'location_mismatch', 'high', 'Check-in desde ubicación lejana al estudio',
                jsonb_build_object('distance_meters', NEW.distance_from_studio, 'latitude', NEW.latitude, 'longitude', NEW.longitude));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_detect_suspicious_checkin ON checkin_logs;
CREATE TRIGGER trigger_detect_suspicious_checkin
    AFTER INSERT ON checkin_logs
    FOR EACH ROW EXECUTE FUNCTION detect_suspicious_checkin();

-- Calcular distancia desde el estudio
CREATE OR REPLACE FUNCTION calculate_distance_from_studio(p_lat DECIMAL, p_lon DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
    studio_lat DECIMAL := 19.4326;
    studio_lon DECIMAL := -99.1332;
    R DECIMAL := 6371000;
    dlat DECIMAL; dlon DECIMAL; a DECIMAL; c DECIMAL;
BEGIN
    dlat := radians(p_lat - studio_lat);
    dlon := radians(p_lon - studio_lon);
    a := sin(dlat/2) * sin(dlat/2) + cos(radians(studio_lat)) * cos(radians(p_lat)) * sin(dlon/2) * sin(dlon/2);
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    RETURN R * c;
END;
$$ LANGUAGE plpgsql;

-- Tasa de conversión de reseñas
CREATE OR REPLACE FUNCTION get_review_conversion_rate(
    p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (total_completed_classes BIGINT, total_reviews BIGINT, conversion_rate NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT COUNT(DISTINCT b.id), COUNT(DISTINCT r.id),
        ROUND((COUNT(DISTINCT r.id)::numeric / NULLIF(COUNT(DISTINCT b.id), 0) * 100), 2)
    FROM bookings b
    JOIN classes c ON b.class_id = c.id
    LEFT JOIN reviews r ON b.id = r.booking_id
    WHERE b.status = 'checked_in' AND c.date BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECCIÓN 15: VISTAS
-- ============================================================

-- Membresías activas
CREATE OR REPLACE VIEW active_memberships_view AS
SELECT
    m.id as membership_id, m.status, m.classes_remaining, m.start_date, m.end_date,
    u.id as user_id, u.email, u.display_name, u.phone,
    p.name as plan_name, p.class_limit as plan_class_limit
FROM memberships m
JOIN users u ON m.user_id = u.id
JOIN plans p ON m.plan_id = p.id
WHERE m.status = 'active';

-- Clases próximas
CREATE OR REPLACE VIEW upcoming_classes_view AS
SELECT
    c.id as class_id, c.date, c.start_time, c.end_time,
    c.max_capacity, c.current_bookings, c.status,
    ct.name as class_type_name, ct.level, ct.duration_minutes, ct.color,
    i.display_name as instructor_name, i.photo_url as instructor_photo,
    (c.max_capacity - c.current_bookings) as available_spots
FROM classes c
JOIN class_types ct ON c.class_type_id = ct.id
JOIN instructors i ON c.instructor_id = i.id
WHERE c.date >= CURRENT_DATE AND c.status = 'scheduled'
ORDER BY c.date, c.start_time;

-- Reservaciones de usuario
CREATE OR REPLACE VIEW user_bookings_view AS
SELECT
    b.id as booking_id, b.user_id, b.status as booking_status,
    b.waitlist_position, b.checked_in_at,
    c.id as class_id, c.date, c.start_time, c.end_time,
    ct.name as class_type_name, ct.level, ct.color as class_type_color,
    i.display_name as instructor_name
FROM bookings b
JOIN classes c ON b.class_id = c.id
JOIN class_types ct ON c.class_type_id = ct.id
JOIN instructors i ON c.instructor_id = i.id
ORDER BY c.date DESC, c.start_time DESC;

-- Órdenes con detalles completos
CREATE OR REPLACE VIEW orders_with_details AS
SELECT
    o.id, o.order_number, o.status, o.payment_method,
    o.subtotal, o.tax_amount, o.total_amount, o.currency,
    o.created_at, o.paid_at, o.approved_at, o.rejected_at, o.rejection_reason, o.expires_at,
    u.id as user_id, u.display_name as user_name, u.email as user_email, u.phone as user_phone,
    p.id as plan_id, p.name as plan_name, p.class_limit as plan_classes, p.duration_days as plan_duration,
    pp.id as proof_id, pp.file_url as proof_url, pp.status as proof_status,
    pp.uploaded_at as proof_uploaded_at, pp.last_four_digits, pp.bank_reference,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o.created_at))/3600 as hours_since_created,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pp.uploaded_at))/3600 as hours_since_proof
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN plans p ON o.plan_id = p.id
LEFT JOIN LATERAL (
    SELECT * FROM payment_proofs WHERE order_id = o.id ORDER BY uploaded_at DESC LIMIT 1
) pp ON true;

-- Dashboard stats de órdenes
CREATE OR REPLACE VIEW orders_dashboard_stats AS
SELECT
    COUNT(*) FILTER (WHERE status = 'pending_verification') as pending_verification_count,
    COUNT(*) FILTER (WHERE status = 'pending_payment') as pending_payment_count,
    COUNT(*) FILTER (WHERE status = 'approved' AND DATE(approved_at) = CURRENT_DATE) as approved_today,
    COUNT(*) FILTER (WHERE status = 'rejected' AND DATE(rejected_at) = CURRENT_DATE) as rejected_today,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' AND DATE(approved_at) = CURRENT_DATE), 0) as revenue_today,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' AND approved_at >= DATE_TRUNC('week', CURRENT_DATE)), 0) as revenue_week,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' AND approved_at >= DATE_TRUNC('month', CURRENT_DATE)), 0) as revenue_month,
    COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as orders_today
FROM orders;

-- Stats de instructor
CREATE OR REPLACE VIEW instructor_stats AS
SELECT
    i.id AS instructor_id, i.display_name,
    COUNT(DISTINCT c.id) AS total_classes_taught,
    COUNT(DISTINCT b.id) AS total_bookings,
    COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN b.id END) AS total_checkins,
    ROUND(CASE WHEN COUNT(DISTINCT b.id) > 0
        THEN (COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN b.id END)::DECIMAL / COUNT(DISTINCT b.id)) * 100
        ELSE 0 END, 1) AS attendance_rate,
    COUNT(DISTINCT CASE WHEN c.date = CURRENT_DATE THEN c.id END) AS classes_today,
    COUNT(DISTINCT CASE WHEN c.date >= date_trunc('week', CURRENT_DATE) AND c.date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days' THEN c.id END) AS classes_this_week
FROM instructors i
LEFT JOIN classes c ON c.instructor_id = i.id AND c.status != 'cancelled'
LEFT JOIN bookings b ON b.class_id = c.id AND b.status != 'cancelled'
WHERE i.is_active = true
GROUP BY i.id, i.display_name;

-- Reseñas con detalles completos
CREATE OR REPLACE VIEW reviews_with_details AS
SELECT
    r.id as review_id, r.overall_rating, r.instructor_rating, r.difficulty_rating,
    r.ambiance_rating, r.comment, r.status, r.is_anonymous, r.is_featured, r.points_earned, r.created_at,
    CASE WHEN r.is_anonymous THEN NULL ELSE u.id END as user_id,
    CASE WHEN r.is_anonymous THEN 'Anónimo' ELSE u.display_name END as user_name,
    CASE WHEN r.is_anonymous THEN NULL ELSE u.photo_url END as user_photo,
    c.id as class_id, c.date as class_date, c.start_time, ct.name as class_type, ct.color as class_color,
    i.id as instructor_id, i.display_name as instructor_name, i.photo_url as instructor_photo,
    (SELECT COALESCE(json_agg(json_build_object('id', rt.id, 'name', rt.name, 'icon', rt.icon, 'category', rt.category)), '[]'::json)
        FROM review_tag_selections rts JOIN review_tags rt ON rts.tag_id = rt.id WHERE rts.review_id = r.id) as tags,
    (SELECT json_build_object('id', rr.id, 'text', rr.response_text, 'type', rr.response_type, 'created_at', rr.created_at)
        FROM review_responses rr WHERE rr.review_id = r.id AND rr.is_public = true ORDER BY rr.created_at DESC LIMIT 1) as studio_response
FROM reviews r
JOIN users u ON r.user_id = u.id
JOIN classes c ON r.class_id = c.id
JOIN class_types ct ON c.class_type_id = ct.id
JOIN instructors i ON r.instructor_id = i.id
WHERE r.status = 'published';

-- Ratings promedio por instructor
CREATE OR REPLACE VIEW instructor_ratings AS
SELECT
    i.id as instructor_id, i.display_name as instructor_name, i.photo_url,
    COUNT(r.id) as total_reviews,
    ROUND(AVG(r.overall_rating)::numeric, 2) as avg_overall_rating,
    ROUND(AVG(r.instructor_rating)::numeric, 2) as avg_instructor_rating,
    ROUND(AVG(r.difficulty_rating)::numeric, 2) as avg_difficulty_rating,
    COUNT(*) FILTER (WHERE r.overall_rating = 5) as five_star_count,
    COUNT(*) FILTER (WHERE r.overall_rating = 4) as four_star_count,
    COUNT(*) FILTER (WHERE r.overall_rating = 3) as three_star_count,
    COUNT(*) FILTER (WHERE r.overall_rating <= 2) as low_rating_count,
    ROUND((COUNT(*) FILTER (WHERE r.overall_rating >= 4)::numeric / NULLIF(COUNT(r.id), 0) * 100), 1) as satisfaction_percentage,
    MAX(r.created_at) as last_review_at
FROM instructors i
LEFT JOIN reviews r ON i.id = r.instructor_id AND r.status = 'published'
WHERE i.is_active = true
GROUP BY i.id, i.display_name, i.photo_url
ORDER BY avg_overall_rating DESC NULLS LAST;

-- Estadísticas de check-in por día
CREATE OR REPLACE VIEW checkin_stats AS
SELECT
    DATE(checked_in_at) as date,
    COUNT(*) as total_checkins,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT class_id) as classes_with_checkins,
    COUNT(*) FILTER (WHERE checkin_method = 'qr_scan') as qr_checkins,
    COUNT(*) FILTER (WHERE checkin_method = 'manual_reception') as manual_checkins,
    COUNT(*) FILTER (WHERE checkin_method = 'self_checkin') as self_checkins,
    COUNT(*) FILTER (WHERE is_late = true) as late_checkins,
    COUNT(*) FILTER (WHERE is_late = false) as on_time_checkins,
    ROUND(AVG(minutes_early_late)::numeric, 1) as avg_minutes_early_late,
    COUNT(*) FILTER (WHERE is_first_class = true) as first_time_users
FROM checkin_logs
GROUP BY DATE(checked_in_at)
ORDER BY date DESC;

-- Eventos próximos
CREATE OR REPLACE VIEW upcoming_events_view AS
SELECT
    e.id, e.title, e.description, e.type, e.status,
    e.date, e.start_time, e.end_time, e.location,
    e.capacity, e.registered,
    e.price, e.currency, e.early_bird_price, e.early_bird_deadline,
    e.member_discount, e.image, e.instructor_name, e.instructor_photo,
    e.requirements, e.includes, e.tags,
    (e.capacity - e.registered) AS available_spots,
    CASE WHEN e.early_bird_deadline IS NOT NULL AND CURRENT_DATE <= e.early_bird_deadline
        THEN e.early_bird_price
        ELSE e.price
    END AS current_price
FROM events e
WHERE e.date >= CURRENT_DATE AND e.status = 'published'
ORDER BY e.date, e.start_time;

-- ============================================================
-- SECCIÓN 16: DATOS INICIALES (SEED DATA)
-- ============================================================

-- --------------------------------------------------------
-- Tipos de clase por defecto
-- --------------------------------------------------------
INSERT INTO class_types (name, description, level, duration_minutes, max_capacity, icon, color)
VALUES
    ('Barre Studio', 'Trabajo en barra para postura, fuerza y tono con control.', 'all', 50, 12, 'sparkles', '#8C8475'),
    ('Pilates Mat', 'Core y movilidad en colchoneta con secuencias controladas.', 'all', 50, 12, 'circle-dot', '#A2A88B'),
    ('Yoga Sculpt', 'Flujo dinamico con pesas ligeras para esculpir y elevar el ritmo.', 'intermediate', 50, 12, 'leaf', '#B7AE9B')
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------
-- Sala principal por defecto
-- --------------------------------------------------------
INSERT INTO facilities (name, description, capacity)
VALUES ('Sala Principal', 'Sala principal con reformers', 12)
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------
-- Planes de membresía (precios 2026 — migración 007)
-- --------------------------------------------------------
INSERT INTO plans (name, description, price, currency, duration_days, class_limit, features, is_active, sort_order) VALUES
(
    'Inscripción (Pago Anual)',
    'Pago anual de inscripción',
    500.00, 'MXN', 365, 0,
    '["Válido por 1 año", "Requerido para todos los miembros", "Pago único anual"]'::jsonb,
    true, 0
),
(
    'Sesión Muestra o Individual',
    'Acceso a una clase de prueba o individual',
    150.00, 'MXN', 30, 1,
    '["1 clase de prueba", "Ideal para nuevos alumnos", "Sin compromiso"]'::jsonb,
    true, 1
),
(
    'Sesión Extra (Socias o Inscritas)',
    'Clase extra para socias con membresía activa',
    120.00, 'MXN', 30, 1,
    '["1 clase", "Solo para miembros inscritos", "Válido por 30 días"]'::jsonb,
    true, 2
),
(
    'Una Sesión (4 al Mes)',
    '4 sesiones mensuales',
    570.00, 'MXN', 30, 4,
    '["4 clases al mes", "1 clase por semana", "Válido por 30 días"]'::jsonb,
    true, 3
),
(
    'Dos Sesiones (8 al Mes)',
    '8 sesiones mensuales',
    870.00, 'MXN', 30, 8,
    '["8 clases al mes", "2 clases por semana", "Válido por 30 días"]'::jsonb,
    true, 4
),
(
    'Tres Sesiones (12 al Mes)',
    '12 sesiones mensuales',
    1040.00, 'MXN', 30, 12,
    '["12 clases al mes", "3 clases por semana", "Válido por 30 días"]'::jsonb,
    true, 5
),
(
    'Cuatro Sesiones (16 al Mes)',
    '16 sesiones mensuales',
    1230.00, 'MXN', 30, 16,
    '["16 clases al mes", "4 clases por semana", "Válido por 30 días"]'::jsonb,
    true, 6
),
(
    'Cinco Sesiones (20 al Mes)',
    '20 sesiones mensuales',
    1420.00, 'MXN', 30, 20,
    '["20 clases al mes", "5 clases por semana", "Válido por 30 días"]'::jsonb,
    true, 7
),
(
    'Seis Sesiones (24 al Mes)',
    '24 sesiones mensuales',
    1600.00, 'MXN', 30, 24,
    '["24 clases al mes", "6 clases por semana", "Válido por 30 días", "Máximo ahorro"]'::jsonb,
    true, 8
),
(
    'Siete Sesiones (28 al Mes)',
    '28 sesiones mensuales',
    1750.00, 'MXN', 30, 28,
    '["28 clases al mes", "7 clases por semana", "Válido por 30 días"]'::jsonb,
    true, 9
)
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------
-- Configuración del sistema
-- --------------------------------------------------------
INSERT INTO system_settings (key, value, description) VALUES
(
    'studio_info',
    '{"name": "Catarsis Studio", "address": "", "phone": "", "email": "", "social_media": {}}'::jsonb,
    'Información del estudio'
),
(
    'booking_policies',
    '{"cancellation_hours": 12, "no_show_penalty": true, "max_advance_days": 14}'::jsonb,
    'Políticas de reservación'
),
(
    'loyalty_settings',
    '{"points_per_class": 10, "welcome_bonus": 50, "referral_bonus": 100}'::jsonb,
    'Configuración del programa de lealtad'
),
(
    'notification_settings',
    '{"reminder_hours": 24, "expiring_days": [7, 3, 1]}'::jsonb,
    'Configuración de notificaciones'
),
(
    'bank_info',
    '{
        "bank_name": "BBVA",
        "account_holder": "Balance Studio SA de CV",
        "account_number": "0123456789",
        "clabe": "012180001234567890",
        "reference_instructions": "Incluye tu nombre en el concepto"
    }'::jsonb,
    'Información bancaria para transferencias'
),
(
    'tax_rate',
    '0.16'::jsonb,
    'Tasa de IVA (16%)'
),
(
    'review_settings',
    '{
        "points_for_review": 50,
        "points_for_detailed_comment": 25,
        "min_comment_length_for_bonus": 50,
        "request_delay_hours": 2,
        "reminder_intervals_hours": [24, 72],
        "max_reminders": 2,
        "review_expiry_days": 7
    }'::jsonb,
    'Configuración del sistema de reseñas'
),
(
    'checkin_settings',
    '{
        "methods_enabled": ["qr_scan", "manual_reception", "self_checkin"],
        "self_checkin_enabled": true,
        "self_checkin_radius_meters": 200,
        "late_threshold_minutes": 10,
        "early_checkin_minutes": 30,
        "require_geolocation": false,
        "track_device_fingerprint": true
    }'::jsonb,
    'Configuración del sistema de check-in'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- --------------------------------------------------------
-- Tags de reseñas por defecto
-- --------------------------------------------------------
INSERT INTO review_tags (name, name_en, category, icon, sort_order) VALUES
('Excelente instructora', 'Excellent instructor', 'positive', '⭐', 1),
('Música increíble', 'Amazing music', 'positive', '🎵', 2),
('Buen ambiente', 'Great atmosphere', 'positive', '✨', 3),
('Ejercicios desafiantes', 'Challenging exercises', 'positive', '💪', 4),
('Buenas correcciones', 'Good corrections', 'positive', '👍', 5),
('Motivadora', 'Motivating', 'positive', '🔥', 6),
('Clase bien estructurada', 'Well structured class', 'positive', '📋', 7),
('Atención personalizada', 'Personal attention', 'positive', '🎯', 8),
('Clase intensa', 'Intense class', 'neutral', '💨', 10),
('Para todos los niveles', 'For all levels', 'neutral', '👥', 11),
('Clase relajante', 'Relaxing class', 'neutral', '🧘', 12),
('Muy lleno', 'Too crowded', 'negative', '👥', 20),
('Música muy alta', 'Music too loud', 'negative', '🔊', 21),
('Faltó atención', 'Needed more attention', 'negative', '👀', 22),
('Clase corta', 'Class too short', 'negative', '⏱️', 23),
('Demasiado fácil', 'Too easy', 'negative', '😴', 24),
('Demasiado difícil', 'Too difficult', 'negative', '😰', 25)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECCIÓN 17: GRANTS (ajustar según usuario de PostgreSQL)
-- ============================================================
-- Descomenta y edita según tu configuración:

-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO catarsis_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO catarsis_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO catarsis_app;

-- ============================================================
-- FIN DEL ESQUEMA COMPLETO
-- Tablas creadas: ~35
-- Migraciones integradas: 17
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Catarsis Studio — Esquema completo cargado correctamente.';
    RAISE NOTICE '   Tablas: users, plans, memberships, class_types, facilities, instructors,';
    RAISE NOTICE '           schedules, classes, bookings, loyalty_points, rewards, redemptions,';
    RAISE NOTICE '           notifications, wallet_passes, payments, system_settings, admin_notes,';
    RAISE NOTICE '           videos, orders, payment_proofs, admin_actions, video_purchases,';
    RAISE NOTICE '           guest_bookings, apple_wallet_devices, apple_wallet_updates,';
    RAISE NOTICE '           notification_logs, wallet_pass_updates, instructor_availability,';
    RAISE NOTICE '           coach_substitutions, class_substitutions, coach_playlists,';
    RAISE NOTICE '           password_reset_tokens, checkin_logs, review_tags, reviews,';
    RAISE NOTICE '           review_tag_selections, review_responses, review_requests,';
    RAISE NOTICE '           suspicious_activity, workout_templates, workout_exercises,';
    RAISE NOTICE '           class_workouts, template_favorites, events, event_registrations.';
END $$;
