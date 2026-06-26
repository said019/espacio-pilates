-- ============================================================
--  MÓDULO DE EVENTOS — Punto Neutro
--  Migración: 20260226_events_module.sql
-- ============================================================

-- Tipo de evento (enum)
DO $$ BEGIN
  CREATE TYPE event_type AS ENUM (
    'masterclass', 'workshop', 'retreat', 'challenge', 'openhouse', 'special'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabla de eventos
CREATE TABLE IF NOT EXISTS events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type                event_type NOT NULL,
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    instructor_name     VARCHAR(100) NOT NULL,
    instructor_photo    TEXT,
    date                DATE NOT NULL,
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    location            VARCHAR(200) NOT NULL,
    capacity            INTEGER NOT NULL DEFAULT 1,
    registered          INTEGER DEFAULT 0,
    price               NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency            VARCHAR(3) DEFAULT 'MXN',
    early_bird_price    NUMERIC(10,2),
    early_bird_deadline DATE,
    member_discount     NUMERIC(5,2) DEFAULT 0,
    image               TEXT,
    requirements        VARCHAR(500) DEFAULT '',
    includes            JSONB DEFAULT '[]',
    tags                JSONB DEFAULT '[]',
    status              VARCHAR(20) DEFAULT 'draft',
    created_by          UUID,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de inscripciones
CREATE TABLE IF NOT EXISTS event_registrations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id                 UUID,
    name                    VARCHAR(100) NOT NULL,
    email                   VARCHAR(255) NOT NULL,
    phone                   VARCHAR(20) DEFAULT '',
    status                  VARCHAR(20) DEFAULT 'pending',
    amount                  NUMERIC(10,2) DEFAULT 0,
    payment_method          VARCHAR(20),
    payment_reference       VARCHAR(200),
    payment_proof_url       TEXT,
    payment_proof_file_name VARCHAR(255),
    transfer_date           DATE,
    paid_at                 TIMESTAMPTZ,
    checked_in              BOOLEAN DEFAULT false,
    checked_in_at           TIMESTAMPTZ,
    checked_in_by           UUID,
    waitlist_position       INTEGER,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_events_status     ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_date        ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_type        ON events(type);
CREATE INDEX IF NOT EXISTS idx_event_regs_event   ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_regs_user    ON event_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_event_regs_status  ON event_registrations(status);
