# Módulo de Eventos — Documentación Completa

> **Propósito:** Documentación integral del sistema de eventos especiales de Catarsis Studio. Cubre base de datos, API backend, panel de administración (lista, detalle, crear/editar, check-in) y vista de cliente (exploración, inscripción, pago por transferencia o en studio). Escrita como prompt replicable para IA.

---

## Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Base de Datos](#2-base-de-datos)
3. [Variables de Entorno](#3-variables-de-entorno)
4. [API Backend — Endpoints](#4-api-backend--endpoints)
5. [Validación con Zod (Schemas)](#5-validación-con-zod-schemas)
6. [Tipos de Evento](#6-tipos-de-evento)
7. [Lógica de Precios](#7-lógica-de-precios)
8. [Lógica de Inscripción](#8-lógica-de-inscripción)
9. [Panel Admin — Componentes](#9-panel-admin--componentes)
10. [Vista Cliente — Componentes](#10-vista-cliente--componentes)
11. [Flujo Completo de Pago por Transferencia (Cliente)](#11-flujo-completo-de-pago-por-transferencia-cliente)
12. [TypeScript — Interfaces Principales](#12-typescript--interfaces-principales)

---

## 1. Arquitectura General

```
┌──────────────────────────────────────────────────────────────────────┐
│                         ADMIN                                        │
│  EventsManager.tsx      → Orquestador de vistas, todas las mutaciones│
│  EventListView.tsx      → Lista de eventos con filtros y stats       │
│  EventDetailView.tsx    → Detalle, inscripciones, check-in, config   │
│  CreateEventView.tsx    → Formulario 4 pasos (crear / editar)        │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENTE                                      │
│  Events.tsx             → Lista de eventos próximos + detalle inline │
│                           Inscripción, pago transferencia o studio   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         BACKEND                                      │
│  server/src/routes/events.ts   → 11 endpoints REST                  │
└──────────────────────────────────────────────────────────────────────┘
```

**Rutas del panel:**
```
/admin/events              → EventsManager (lista)
/admin/events              → EventsManager (crear, editar, detalle — SPA interna)
/app/events                → ClientEvents (exploración + inscripción)
```

**Stack:**
- **Frontend:** React 18 + TypeScript + Vite, Shadcn/ui + Tailwind CSS, TanStack Query, Lucide icons
- **Backend:** Express.js + PostgreSQL
- **Auth:** Bearer token, middleware `authenticate` + `requireRole('admin')` para rutas admin, `optionalAuth` en rutas públicas

---

## 2. Base de Datos

### 2.1 Tipos (Enums en PostgreSQL)

```sql
CREATE TYPE event_type AS ENUM (
    'masterclass', 'workshop', 'retreat', 'challenge', 'openhouse', 'special'
);

-- Status de un evento
-- 'draft'      → visible solo para admins, no para clientes
-- 'published'  → visible para todos
-- 'cancelled'  → cancelado (permanece en historial)
-- 'completed'  → evento realizado

-- Status de una inscripción
-- 'confirmed'  → pago recibido / evento gratuito
-- 'pending'    → inscrito pero pago pendiente
-- 'waitlist'   → lista de espera (cupo lleno)
-- 'cancelled'  → cancelado por el cliente o admin
-- 'no_show'    → no asistió el día del evento
```

### 2.2 Tabla `events`

```sql
CREATE TABLE events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type                event_type NOT NULL,             -- masterclass|workshop|retreat|challenge|openhouse|special
    title               VARCHAR(200) NOT NULL,           -- mín 3 chars
    description         TEXT NOT NULL,                   -- mín 10 chars, máx 2000
    instructor_name     VARCHAR(100) NOT NULL,           -- nombre del instructor
    instructor_photo    TEXT,                            -- URL de foto (opcional)
    date                DATE NOT NULL,                   -- fecha del evento
    start_time          TIME NOT NULL,                   -- hora inicio (formato HH:MM)
    end_time            TIME NOT NULL,                   -- hora fin (formato HH:MM)
    location            VARCHAR(200) NOT NULL,           -- ubicación física o virtual
    capacity            INTEGER NOT NULL DEFAULT 1,      -- máximo de participantes
    registered          INTEGER DEFAULT 0,               -- contador de inscritos confirmados
    price               NUMERIC(10,2) NOT NULL DEFAULT 0,-- precio general (0 = gratuito)
    currency            VARCHAR(3) DEFAULT 'MXN',
    early_bird_price    NUMERIC(10,2),                   -- precio reducido por inscripción temprana
    early_bird_deadline DATE,                            -- fecha límite para el precio early bird
    member_discount     NUMERIC(5,2) DEFAULT 0,          -- % de descuento para miembros (0-100)
    image               TEXT,                            -- URL de imagen del evento
    requirements        VARCHAR(500) DEFAULT '',         -- requisitos de entrada
    includes            JSONB DEFAULT '[]',              -- array de strings (qué incluye)
    tags                JSONB DEFAULT '[]',              -- etiquetas/hashtags del evento
    status              VARCHAR(20) DEFAULT 'draft',     -- draft|published|cancelled|completed
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 Tabla `event_registrations`

```sql
CREATE TABLE event_registrations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id                 UUID REFERENCES users(id),           -- null = invitado
    name                    VARCHAR(100) NOT NULL,
    email                   VARCHAR(255) NOT NULL,
    phone                   VARCHAR(20) DEFAULT '',
    status                  VARCHAR(20) DEFAULT 'pending',       -- confirmed|pending|waitlist|cancelled|no_show
    amount                  NUMERIC(10,2) DEFAULT 0,             -- monto calculado en el momento de inscripción
    payment_method          VARCHAR(20),                         -- card|transfer|cash|null (si gratis)
    payment_reference       VARCHAR(200),                        -- referencia de transferencia SPEI
    payment_proof_url       TEXT,                                -- comprobante en base64 o URL
    payment_proof_file_name VARCHAR(255),
    transfer_date           DATE,
    paid_at                 TIMESTAMPTZ,                         -- cuándo se confirmó el pago
    checked_in              BOOLEAN DEFAULT false,
    checked_in_at           TIMESTAMPTZ,
    checked_in_by           UUID REFERENCES users(id),           -- admin que hizo el check-in
    waitlist_position       INTEGER,                             -- posición en lista de espera
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 Índices recomendados

```sql
CREATE INDEX idx_events_status      ON events(status);
CREATE INDEX idx_events_date        ON events(date);
CREATE INDEX idx_events_type        ON events(type);
CREATE INDEX idx_event_regs_event   ON event_registrations(event_id);
CREATE INDEX idx_event_regs_user    ON event_registrations(user_id);
CREATE INDEX idx_event_regs_status  ON event_registrations(status);
```

---

## 3. Variables de Entorno

El módulo de eventos no requiere variables de entorno específicas. Usa la misma base de datos del proyecto:

```env
DATABASE_URL=postgresql://user:password@host:5432/catarsis
JWT_SECRET=tu_jwt_secret
```

---

## 4. API Backend — Endpoints

**Archivo:** `server/src/routes/events.ts` (686 líneas)
**Base path:** `/api/events`

### Tabla resumen

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/` | Público (optAuth) | Lista eventos publicados (futuros si `upcoming=true`) |
| `GET` | `/admin/all` | Admin | Todos los eventos + inscripciones de cada uno |
| `GET` | `/:id` | Público (optAuth) | Detalle del evento + `myRegistration` si autenticado |
| `POST` | `/` | Admin | Crear evento |
| `PUT` | `/:id` | Admin | Actualizar evento (update dinámico) |
| `DELETE` | `/:id` | Admin | Eliminar evento |
| `POST` | `/:id/register` | Auth | Inscribirse al evento |
| `DELETE` | `/:id/register` | Auth | Cancelar inscripción |
| `GET` | `/:id/registrations` | Admin | Listar todas las inscripciones de un evento |
| `PUT` | `/:eventId/registrations/:regId` | Admin | Cambiar status de una inscripción |
| `POST` | `/:eventId/checkin/:regId` | Admin | Registrar asistencia (check-in) |
| `PUT` | `/:id/register/payment` | Auth | Enviar comprobante de pago |

---

### 4.1 GET /api/events — Lista pública

**Query params:**
```
type=masterclass|workshop|retreat|challenge|openhouse|special   → filtra por tipo
upcoming=true                                                   → solo eventos con date >= hoy
```

Solo retorna eventos con `status = 'published'`. Ordenado por `date ASC, start_time ASC`.

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Masterclass Reformer",
    "description": "...",
    "type": "masterclass",
    "instructor": "Ana López",
    "instructorPhoto": null,
    "date": "2026-03-15",
    "startTime": "10:00",
    "endTime": "12:00",
    "location": "Sala Principal",
    "capacity": 12,
    "registered": 4,
    "price": 800,
    "earlyBirdPrice": 650,
    "earlyBirdDeadline": "2026-03-01",
    "memberDiscount": 15,
    "image": null,
    "status": "published",
    "tags": ["reformer", "avanzado"],
    "requirements": "6 meses de experiencia",
    "includes": ["Material incluido", "Café"],
    "createdAt": "2026-02-20T...",
    "updatedAt": "2026-02-20T..."
  }
]
```

**Nota de normalización del backend (`mapEventRow`):**
- `date`: PostgreSQL devuelve `Date` o ISO string → se normaliza a `YYYY-MM-DD`
- `startTime` / `endTime`: PostgreSQL devuelve `HH:MM:SS` → se normaliza a `HH:MM`
- `instructor`: mapeado desde `instructor_name`
- `instructorPhoto`: mapeado desde `instructor_photo`

---

### 4.2 GET /api/events/admin/all — Lista admin (con inscripciones)

Requiere rol `admin` o `super_admin`. Retorna **todos** los eventos (incluyendo drafts, cancelados, completados), ordenados por `date DESC, start_time DESC`.

Cada evento incluye su array `registrations[]` completo:
```json
{
  "id": "uuid",
  "title": "...",
  "status": "draft",
  // ...campos del evento...
  "registrations": [
    {
      "id": "uuid",
      "name": "María García",
      "email": "maria@email.com",
      "phone": "8112345678",
      "status": "confirmed",
      "amount": 650,
      "paidAt": "2026-02-25T...",
      "checkedIn": false,
      "paymentMethod": "transfer",
      "paymentReference": "SPEI123456"
    }
  ]
}
```

---

### 4.3 GET /api/events/:id — Detalle de evento

- Admins pueden ver eventos en cualquier status
- Clientes solo pueden ver eventos `published`
- Si el usuario está autenticado, incluye `myRegistration` con su inscripción actual

**Response adicional cuando autenticado:**
```json
{
  "myRegistration": {
    "id": "uuid",
    "status": "pending",
    "amount": 650,
    "checkedIn": false,
    "paymentMethod": "transfer",
    "paymentReference": null,
    "hasPaymentProof": false,
    "paymentProofFileName": null,
    "transferDate": null
  }
}
```

---

### 4.4 POST /api/events — Crear evento

Requiere rol admin. Valida con `CreateEventSchema` (Zod).

**Body:**
```json
{
  "type": "masterclass",
  "title": "Masterclass Reformer Avanzado",
  "description": "Sesión intensiva de trabajo en reformer...",
  "instructor_name": "Ana López",
  "instructor_photo": null,
  "date": "2026-03-15",
  "start_time": "10:00",
  "end_time": "12:00",
  "location": "Sala Principal",
  "capacity": 12,
  "price": 800,
  "early_bird_price": 650,
  "early_bird_deadline": "2026-03-01",
  "member_discount": 15,
  "image": null,
  "requirements": "Mínimo 6 meses de experiencia",
  "includes": ["Material incluido", "Café"],
  "tags": ["reformer", "avanzado"],
  "status": "draft"
}
```

**Response:** El evento creado completo (con `mapEventRow`), status 201.

---

### 4.5 PUT /api/events/:id — Actualizar evento

Usa `UpdateEventSchema` (igual que Create pero todo opcional, con `status` extendido a `cancelled | completed`).

**Update dinámico:** Solo actualiza los campos que vengan en el body. Los campos JSONB (`includes`, `tags`) se serializan con `JSON.stringify`.

**Casos de uso comunes:**
- Publicar borrador: `{ "status": "published" }`
- Cancelar evento: `{ "status": "cancelled" }`
- Marcar completado: `{ "status": "completed" }`
- Actualizar precio: `{ "price": 900, "early_bird_price": 700 }`

---

### 4.6 DELETE /api/events/:id — Eliminar evento

Elimina permanentemente el evento (hard delete). Si tiene `event_registrations`, se eliminan en cascada (por `ON DELETE CASCADE`).

---

### 4.7 POST /api/events/:id/register — Inscribirse

Solo para eventos `published`. Requiere autenticación.

**Body:**
```json
{
  "name": "María García",
  "email": "maria@email.com",
  "phone": "8112345678",
  "payment_method": "transfer"
}
```

**Lógica completa (en orden):**

```
1. Verificar que el evento existe y está published
2. Verificar que el usuario no esté ya inscrito (status != 'cancelled')
   → Si está cancelado, permite re-inscripción (UPDATE del registro existente)
3. Calcular monto:
   a. Base = event.price
   b. Si early_bird_price Y ahora <= early_bird_deadline → usar early_bird_price
   c. Si member_discount > 0 → buscar membresía activa del usuario
      → Si tiene membresía → amount = round(amount * (1 - member_discount / 100))
4. Determinar status de la inscripción:
   - Si evento lleno (registered >= capacity) → status='waitlist', calcular waitlist_position
   - Si precio = 0 (gratis) → status='confirmed', paid_at=NOW()
   - Si precio > 0 → status='pending'
5. Insertar o actualizar event_registrations
6. Retornar resultado con mensaje descriptivo
```

**Response:**
```json
{
  "id": "uuid",
  "status": "pending",
  "amount": 650,
  "isFree": false,
  "waitlistPosition": null,
  "message": "Registro pendiente de pago. Una vez confirmado tu pago, recibirás la confirmación."
}
```

**Mensajes según caso:**
| Escenario | Mensaje |
|-----------|---------|
| Evento lleno → waitlist | `"Te agregamos a la lista de espera (posición N)"` |
| Evento gratuito | `"¡Registro confirmado! Te esperamos en el evento."` |
| Pago en studio (cash) | `"Registro pendiente. Puedes pagar en recepción del studio para confirmar tu lugar."` |
| Transferencia pendiente | `"Registro pendiente de pago. Una vez confirmado tu pago, recibirás la confirmación."` |

---

### 4.8 DELETE /api/events/:id/register — Cancelar inscripción

Solo puede cancelar registros con status `confirmed`, `pending` o `waitlist`. Status `no_show` o `cancelled` no se pueden cancelar.

**Response:**
```json
{ "message": "Registro cancelado exitosamente" }
```

---

### 4.9 GET /api/events/:id/registrations — Inscripciones (Admin)

Lista todas las inscripciones del evento con join a `users` para obtener `display_name`.

**Response:**
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "name": "María García",
    "email": "maria@email.com",
    "phone": "8112345678",
    "status": "pending",
    "amount": 650,
    "paymentMethod": "transfer",
    "paymentReference": "SPEI123456",
    "paidAt": null,
    "checkedIn": false,
    "checkedInAt": null,
    "waitlistPosition": null,
    "notes": null,
    "createdAt": "2026-02-25T..."
  }
]
```

---

### 4.10 PUT /api/events/:eventId/registrations/:regId — Actualizar status (Admin)

**Body:**
```json
{
  "status": "confirmed",
  "notes": "Pago verificado manualmente"
}
```

**Statuses válidos:** `confirmed | pending | waitlist | cancelled | no_show`

**Comportamiento especial:** Si `status = 'confirmed'` → se actualiza `paid_at = COALESCE(paid_at, NOW())` (solo si no tenía ya un `paid_at`).

**Response:**
```json
{ "message": "Registro actualizado", "status": "confirmed" }
```

---

### 4.11 POST /api/events/:eventId/checkin/:regId — Check-in (Admin)

Marca `checked_in = true`, `checked_in_at = NOW()`, `checked_in_by = adminId`.

**Response:**
```json
{ "message": "Check-in exitoso", "checkedIn": true }
```

---

### 4.12 PUT /api/events/:id/register/payment — Enviar comprobante (Cliente)

Solo funciona si existe una inscripción con `status = 'pending'` para el usuario autenticado.

**Método transferencia:**
```json
{
  "payment_method": "transfer",
  "transfer_reference": "SPEI202603151234",
  "transfer_date": "2026-03-10",
  "file_data": "data:image/jpeg;base64,...",
  "file_name": "comprobante.jpg",
  "notes": "Transferí desde BBVA"
}
```

**Método pago en studio:**
```json
{
  "payment_method": "cash"
}
```

**Validación:** Si `payment_method = 'transfer'` y no hay `transfer_reference` ni `file_data` → error 400.

**Comportamiento:**
- `cash`: Limpia los campos de referencia y comprobante, mantiene `status = 'pending'` (admin confirma en recepción)
- `transfer`: Guarda referencia, fecha, y comprobante en base64 en `payment_proof_url`

**Nota:** El status de la inscripción **no cambia** al enviar el comprobante. Permanece en `pending` hasta que el admin confirme manualmente con `PUT /registrations/:regId` → `status: 'confirmed'`.

**Response:**
```json
{
  "message": "Comprobante enviado exitosamente. Tu pago será verificado pronto.",
  "registration": {
    "id": "uuid",
    "status": "pending",
    "paymentReference": "SPEI202603151234",
    "paymentProofUrl": true
  }
}
```

---

## 5. Validación con Zod (Schemas)

```typescript
const CreateEventSchema = z.object({
    type: z.enum(['masterclass', 'workshop', 'retreat', 'challenge', 'openhouse', 'special']),
    title: z.string().min(3).max(200),
    description: z.string().min(10).max(2000),
    instructor_name: z.string().min(2).max(100),
    instructor_photo: z.string().url().optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),       // formato YYYY-MM-DD
    start_time: z.string().regex(/^\d{2}:\d{2}$/),         // formato HH:MM
    end_time: z.string().regex(/^\d{2}:\d{2}$/),
    location: z.string().min(2).max(200),
    capacity: z.coerce.number().int().min(1).max(500),
    price: z.coerce.number().min(0),
    early_bird_price: z.coerce.number().min(0).optional().nullable(),
    early_bird_deadline: z.string().optional().nullable(),
    member_discount: z.coerce.number().min(0).max(100).optional().default(0),
    image: z.string().url().optional().nullable(),
    requirements: z.string().max(500).optional().default(''),
    includes: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    status: z.enum(['draft', 'published']).optional().default('draft'),
});

// Para actualizar: todos los campos opcionales + status extendido
const UpdateEventSchema = CreateEventSchema.partial().extend({
    status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
});

// Para inscripción del cliente
const RegisterSchema = z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    phone: z.string().max(20).optional().default(''),
    payment_method: z.enum(['card', 'transfer', 'cash', 'free']).optional(),
    payment_reference: z.string().max(200).optional(),
});
```

---

## 6. Tipos de Evento

```typescript
export type EventType = 'masterclass' | 'workshop' | 'retreat' | 'challenge' | 'openhouse' | 'special';

export const EVENT_TYPES = [
    { value: 'masterclass', label: 'Masterclass',         iconName: 'star',     color: '#8B5CF6' },
    { value: 'workshop',    label: 'Workshop / Taller',   iconName: 'wrench',   color: '#F59E0B' },
    { value: 'retreat',     label: 'Retiro',              iconName: 'leaf',     color: '#10B981' },
    { value: 'challenge',   label: 'Challenge / Reto',    iconName: 'flame',    color: '#EF4444' },
    { value: 'openhouse',   label: 'Open House',          iconName: 'home',     color: '#3B82F6' },
    { value: 'special',     label: 'Clase Especial',      iconName: 'sparkles', color: '#EC4899' },
];
```

Cada tipo tiene un color de marca que se usa en:
- Borde de cards (20% opacidad: `${color}30`)
- Fondo de ícono (8% opacidad: `${color}15`)
- Precio en lista (`style={{ color }}`)
- Avatar de inscritos en detalle

---

## 7. Lógica de Precios

El precio final que paga cada cliente se calcula en el backend al momento de inscribirse:

```
precio_base = event.price

SI early_bird_price EXISTS AND fecha_actual <= early_bird_deadline:
    precio_base = early_bird_price

SI member_discount > 0:
    membresía = buscar membresía activa del usuario
    SI tiene membresía activa:
        precio_final = ROUND(precio_base * (1 - member_discount / 100))
    SINO:
        precio_final = precio_base
SINO:
    precio_final = precio_base
```

**Ejemplo:**
- Precio general: $800
- Early bird: $650 (hasta 1 marzo)
- Descuento miembros: 15%

| Escenario | Precio |
|-----------|--------|
| Cliente sin membresía, después de 1 marzo | $800 |
| Cliente sin membresía, antes de 1 marzo | $650 |
| Miembro, después de 1 marzo | $680 (800 × 0.85) |
| Miembro, antes de 1 marzo | $553 (650 × 0.85) |

> ⚠️ El descuento de miembro **se aplica sobre el precio vigente** (ya sea general o early bird).

**Preview en el formulario admin (CreateEventView, paso 3):** Se muestran 3 cards en tiempo real con el precio general, el early bird (si existe) y el precio para miembros (si existe descuento).

---

## 8. Lógica de Inscripción

### Estado de la inscripción según disponibilidad

```
SI event.registered >= event.capacity:
    → status = 'waitlist'
    → waitlist_position = MAX(posición actual) + 1

SI price == 0 (gratuito):
    → status = 'confirmed'
    → paid_at = NOW()

SI price > 0:
    → status = 'pending'
    → paid_at = null
```

### Re-inscripción

Si el usuario ya tiene un registro con `status = 'cancelled'`, se hace `UPDATE` del registro existente (no INSERT). Esto preserva el historial.

Si el usuario ya tiene un registro activo (`!= 'cancelled'`) → error 400 `"Ya estás inscrito en este evento"`.

### Cancelación de inscripción (cliente)

Solo se puede cancelar si el status actual es `confirmed`, `pending` o `waitlist`. El status pasa a `cancelled`.

---

## 9. Panel Admin — Componentes

### 9.1 EventsManager.tsx

**Ruta:** `/admin/events`
**Archivo:** `src/pages/admin/events/EventsManager.tsx` (190 líneas)

Orquestador SPA sin rutas adicionales. Maneja 4 vistas con `useState`:
- `'list'` → `EventListView`
- `'detail'` → `EventDetailView`
- `'create'` → `CreateEventView` (sin initialData)
- `'edit'` → `CreateEventView` (con initialData del evento seleccionado)

**Queries:**
- `GET /events/admin/all` → `queryKey: ['admin-events']`

**Mutations y sus invalidaciones:**

| Mutation | Endpoint | Invalida | Toast |
|----------|----------|----------|-------|
| `createMutation` | `POST /events` | `['admin-events']` | "Borrador guardado" / "¡Evento publicado!" |
| `updateMutation` | `PUT /events/:id` | `['admin-events']` | "Evento actualizado" |
| `deleteMutation` | `DELETE /events/:id` | `['admin-events']` | "Evento eliminado" |
| `updateRegMutation` | `PUT /events/:id/registrations/:regId` | `['admin-events']` | "Inscripción confirmada/cancelada/actualizada" |
| `checkinMutation` | `POST /events/:id/checkin/:regId` | `['admin-events']` | "Check-in exitoso" |

---

### 9.2 EventListView.tsx

**Archivo:** `src/pages/admin/events/EventListView.tsx` (250 líneas aprox.)

**Header:**
- Título "Eventos del Estudio"
- Contador: `N eventos creados · N activos`
- Botón "Crear Evento" (llama `onCreateNew`)

**Filtros:** Botones pill con ícono: "Todos" + un botón por tipo de evento (6 tipos)

**Cada card de evento muestra:**
- Ícono del tipo con fondo coloreado
- Título + badge de status (Publicado/Borrador/Cancelado/Completado)
- Instructor, fecha formateada, tipo de evento
- Precio con early bird si existe
- **4 stats:** Capacidad (`registrados/máximo`), Ocupación (barra de progreso coloreada), Ingreso confirmado (`$ de inscritos confirmed`), Horario

**Colores de la barra de ocupación:**
- `> 80%` → rojo
- `> 50%` → ámbar
- `≤ 50%` → verde

**Badges de status:**
| Status | Variante |
|--------|---------|
| `published` | `default` (verde/primary) |
| `draft` | `secondary` (gris) |
| `cancelled` | `destructive` (rojo) |
| `completed` | `outline` (contorno) |

---

### 9.3 EventDetailView.tsx

**Archivo:** `src/pages/admin/events/EventDetailView.tsx` (500 líneas aprox.)

**Header Card:**
- Ícono + título + badge de status
- Descripción
- Chips con: fecha, horario, ubicación, instructor
- Botones: "Editar", "Compartir", "Publicar" (solo si draft)
- **5 stats cards:** Inscritos confirmados/capacidad (+ pendientes), Lista de espera, Ingreso confirmado, Precio actual (+ early bird si existe), Descuento miembros

**4 tabs:**

#### Tab "Resumen"
- Card "Requisitos" con el texto de requisitos
- Card "Incluye" con lista de items con ícono CheckCircle verde
- **Embudo de Registro** (gráfico de barras): Visitas → Iniciaron → Pendientes → Confirmados → Check-in

#### Tab "Inscripciones (N)"
- Badges resumen: confirmados / pendientes / en espera
- Botones: "Agregar", "Exportar", "Recordatorio"
- Tabla con columnas: Nombre (avatar + nombre), Contacto (email + teléfono), Estado (badge), Pago (fecha + referencia), Monto, Acciones

**Acciones por inscripción:**
| Status actual | Acciones disponibles |
|---------------|---------------------|
| `pending` | Botón "Confirmar" (verde) + Botón "Cancelar" (rojo) |
| `waitlist` | Botón "Mover a inscrito" |
| `confirmed` | Botón "Cancelar" (rojo) |
| `cancelled` | Sin acciones |
| `no_show` | Sin acciones |

#### Tab "Check-in"
- **Check-in por QR:** Placeholder para escáner (botón "Abrir Escáner" — UI preparada)
- **Check-in manual:** Lista de inscritos confirmados
  - Si `checkedIn = false` → botón verde "Check-in"
  - Si `checkedIn = true` → badge verde "Registrado"
  - Contador grande: `N/M Check-ins realizados`

#### Tab "Configuración"
- Card con switches de configuración:
  - Lista de espera
  - Pago obligatorio
  - Wallet Pass
  - Recordatorios automáticos
  - Permitir cancelaciones
- Card de Notificaciones (botones: Push Notification, WhatsApp Masivo, Email a inscritas)
- **Zona de peligro** (rojo): "Cancelar Evento" + "Eliminar Evento"

---

### 9.4 CreateEventView.tsx

**Archivo:** `src/pages/admin/events/CreateEventView.tsx` (513 líneas)
**Usado para crear Y editar** (prop `initialData` para modo edición)

**Stepper de 4 pasos:**

```
[1 Tipo y detalles] → [2 Fecha y lugar] → [3 Precios] → [4 Extras y publicar]
```

Cada paso tiene validación antes de avanzar. El indicador muestra checkmark (✓) en pasos completados.

#### Paso 1: Tipo y detalles
- Grid de 6 cards de tipo (con ícono y color)
- Título (mín 3 chars)
- Descripción (mín 10 chars, Textarea)
- Instructor (Select desde `GET /api/instructors`)

#### Paso 2: Fecha y lugar
- Fecha (date input) — requerida
- Capacidad máxima (number, mín 1) — default 12
- Hora inicio (time input HH:MM) — requerida
- Hora fin (time input HH:MM) — requerida
- Ubicación (text) — requerida, mín 2 chars

#### Paso 3: Precios y descuentos
| Campo | Tipo | Descripción |
|-------|------|-------------|
| Precio general | number | 0 = evento gratuito |
| % Descuento miembros | number | máx 50 en UI (100 en backend) |
| Precio Early Bird | number | Opcional |
| Fecha límite Early Bird | date | Opcional |

**Preview en tiempo real:** Si precio > 0, muestra 3 cards: General / Early Bird (si existe) / Miembros (si existe descuento) con el precio calculado y el ahorro.

#### Paso 4: Extras y publicar
- Requisitos de entrada (text input)
- Lista dinámica "¿Qué incluye?" (campos text + botón Agregar/Eliminar)
- 3 Switches opcionales:
  - **Wallet Pass** — Pase digital para Apple/Google Wallet con QR de check-in
  - **Lista de espera** — Permite registros cuando se llene la capacidad
  - **Recordatorios automáticos** — Push 24h y 1h antes del evento

**Botones finales:**
- **"Guardar borrador"** (solo en modo crear) → `onSave(payload, 'draft')`
- **"Publicar Evento"** (crear) / **"Guardar Cambios"** (editar) → `onSave(payload, 'published' o status original)`

**Payload que se envía:**
```typescript
{
    type, title, description, instructor_name,
    date, start_time, end_time, location, capacity,
    price, early_bird_price, early_bird_deadline,
    member_discount, requirements,
    includes: form.includes.filter(Boolean),  // elimina strings vacíos
    tags,
}
```

---

## 10. Vista Cliente — Componentes

### 10.1 ClientEvents (Events.tsx)

**Ruta:** `/app/events`
**Archivo:** `src/pages/client/Events.tsx` (1077 líneas)

**Query:** `GET /api/events?upcoming=true` (solo eventos futuros publicados)

**Filtros:** Botones pill "Todos" + uno por tipo de evento (igual que admin)

**Cada card de la lista muestra:**
- Ícono del tipo con color de marca
- Título + tipo label
- Info: fecha, hora, ubicación, instructor
- Barra de capacidad con colores (verde/ámbar/rojo)
- Precio o badge "Gratis"
- Badge de descuento early bird si aplica
- Badge de descuento miembros si existe `memberDiscount > 0`
- Badge de estado del usuario (si ya tiene inscripción activa)

**Click en card:** Carga detalle completo con `GET /api/events/:id` (para obtener `myRegistration` actualizado)

---

### 10.2 Vista de Detalle (inline en Events.tsx)

Cuando `selectedEvent != null`, reemplaza la lista con la vista de detalle.

**Secciones:**

1. **Header del evento:** Ícono + título + precio calculado (con early bird si aplica)
2. **Descripción**
3. **Chips de info:** Fecha, horario, ubicación, instructor
4. **Barra de capacidad** con aviso si está lleno
5. **Requisitos** (si existen)
6. **Incluye** (lista con CheckCircle verde)
7. **Descuento para miembros** (panel primary si `memberDiscount > 0`)
8. **Botón principal / Estado** (según estado de inscripción del usuario)

**Estados del botón principal:**

| Condición | Botón / Banner |
|-----------|----------------|
| No inscrito, evento libre, hay lugares | `"Registrarme gratis"` |
| No inscrito, evento de pago, hay lugares | `"Inscribirme — $XXX MXN"` |
| No inscrito, evento lleno | `"Inscribirme en lista de espera"` |
| Inscrito, status `confirmed` | Banner verde "¡Estás inscrita!" + botón cancelar |
| Inscrito, status `pending`, sin comprobante | Banner ámbar "Pendiente de pago" + botón cancelar |
| Inscrito, status `pending`, con comprobante | Banner ámbar "Comprobante enviado — en revisión" + botón cancelar |
| Inscrito, status `pending`, método `cash` | Banner ámbar "Pendiente de pago en studio" + botón cancelar |
| Inscrito, status `waitlist` | Banner azul "Estás en la lista de espera" + botón cancelar |

---

### 10.3 Dialog de Registro

Se abre con "Inscribirme". Para eventos de pago, permite elegir método:

- **Transferencia bancaria** — Sube comprobante para validación
- **Pagar en studio** — Liquidar en recepción

Para eventos gratuitos, se inscribe directamente sin dialog (sin elección de método).

Al confirmar: `POST /api/events/:id/register` con `{ name, email, phone, payment_method }`

---

### 10.4 Sección de Pago (solo cuando `status='pending'` y sin comprobante enviado)

Se muestra debajo del header del evento solo si:
- El usuario está inscrito
- `status = 'pending'`
- NO tiene comprobante ya enviado (`!hasPaymentProof && !paymentReference`)

**Subcomponentes:**

#### Selector de método de pago (RadioGroup)
- Transferencia bancaria (Landmark icon)
- Pagar en studio (CreditCard icon)

#### Si método = "Transferencia":
1. **Datos bancarios** (de `GET /api/settings/bank-info`):
   - Banco, Titular, Cuenta, CLABE — cada uno con botón copiar
   - Instrucciones de referencia si existen

2. **Formulario de comprobante:**
   - Referencia de transferencia (text)
   - Fecha de transferencia (date)
   - Archivo (drag/click, acepta imagen + PDF, máximo 5MB)
     - Preview inline para imágenes
     - Nombre del archivo para PDFs
     - Botón X para remover
   - Botón "Enviar comprobante" (disabled si no hay referencia ni archivo)

3. **Submit:** Convierte archivo a base64 con `FileReader` → `PUT /api/events/:id/register/payment`

#### Si método = "Studio":
- Instrucciones simples de que el pago se realiza en recepción
- Botón "Marcar como pago en studio" → `PUT /api/events/:id/register/payment { payment_method: 'cash' }`

---

## 11. Flujo Completo de Pago por Transferencia (Cliente)

```
┌─────────────────────────────────────────────────────────────────────┐
│ PASO 1: Cliente ve evento y hace click en "Inscribirme"             │
│         → Dialog de registro con método de pago                     │
│         → Selecciona "Transferencia bancaria"                       │
└────────────────────────┬────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│ PASO 2: POST /events/:id/register                                   │
│         { name, email, phone, payment_method: 'transfer' }          │
│         → Crea event_registration con status='pending'              │
│         → Precio = early_bird o general - descuento miembro         │
└────────────────────────┬────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│ PASO 3: Se muestra sección de pago con datos bancarios              │
│         (GET /settings/bank-info)                                    │
│         → Banco, Titular, Cuenta, CLABE (cada uno copiable)        │
│         → El cliente realiza transferencia en su banco              │
└────────────────────────┬────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│ PASO 4: PUT /events/:id/register/payment                            │
│         { payment_method: 'transfer', transfer_reference,           │
│           transfer_date, file_data (base64), file_name }            │
│         → Guarda comprobante, mantiene status='pending'             │
│         → Se muestra banner "Comprobante enviado — en revisión"     │
└────────────────────────┬────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│ PASO 5: Admin revisa en EventDetailView → Tab "Inscripciones"       │
│         → Ve referencia de transferencia y/o comprobante            │
│         → Botón "Confirmar" → PUT /events/:id/registrations/:regId  │
│           { status: 'confirmed' }                                   │
│         → paid_at = NOW() se actualiza automáticamente              │
└────────────────────────┬────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│ PASO 6: Cliente refresca la vista del evento                        │
│         → myRegistration.status = 'confirmed'                       │
│         → Banner verde "¡Estás inscrita! Te esperamos en el evento" │
└─────────────────────────────────────────────────────────────────────┘
```

**Flujo de pago en studio (cash):**
```
Inscripción → PUT /register/payment { payment_method: 'cash' }
→ Admin confirma en recepción física
→ Admin cambia status a 'confirmed' manualmente desde EventDetailView
```

---

## 12. TypeScript — Interfaces Principales

### Backend: `mapEventRow` output

```typescript
interface MappedEvent {
    id: string;
    title: string;
    description: string;
    type: EventType;
    instructor: string;          // mapeado desde instructor_name
    instructorPhoto: string | null;
    date: string;                // formato 'YYYY-MM-DD'
    startTime: string;           // formato 'HH:MM'
    endTime: string;
    location: string;
    capacity: number;
    registered: number;
    price: number;
    earlyBirdPrice: number | null;
    earlyBirdDeadline: string | null;
    memberDiscount: number;
    image: string | null;
    status: 'draft' | 'published' | 'cancelled' | 'completed';
    tags: string[];
    requirements: string;
    includes: string[];
    createdAt: string;
    updatedAt: string;
}
```

### Frontend Admin: `StudioEvent`

```typescript
interface StudioEvent {
    id: string;
    title: string;
    description: string;
    type: EventType;
    instructor: string;
    instructorPhoto?: string | null;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    capacity: number;
    registered: number;
    price: number;
    earlyBirdPrice?: number;
    earlyBirdDeadline?: string;
    memberDiscount: number;
    image?: string | null;
    status: 'published' | 'draft' | 'cancelled' | 'completed';
    tags: string[];
    requirements: string;
    includes: string[];
    registrations: EventRegistration[];
}

interface EventRegistration {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: 'confirmed' | 'pending' | 'waitlist' | 'cancelled' | 'no_show';
    paidAt: string | null;
    amount: number;
    checkedIn?: boolean;
    paymentMethod?: string | null;
    paymentReference?: string | null;
}
```

### Frontend Cliente: `ClientEvent`

```typescript
interface ClientEvent {
    id: string;
    title: string;
    description: string;
    type: string;
    instructor: string;
    instructorPhoto: string | null;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    capacity: number;
    registered: number;
    price: number;
    earlyBirdPrice: number | null;
    earlyBirdDeadline: string | null;
    memberDiscount: number;
    image: string | null;
    status: string;
    tags: string[];
    requirements: string;
    includes: string[];
    myRegistration?: {
        id: string;
        status: string;
        amount: number;
        checkedIn: boolean;
        paymentMethod: string | null;
        paymentReference: string | null;
        hasPaymentProof: boolean;
        paymentProofFileName: string | null;
        transferDate: string | null;
    } | null;
}
```

### Tipos auxiliares

```typescript
type EventType = 'masterclass' | 'workshop' | 'retreat' | 'challenge' | 'openhouse' | 'special';
type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed';
type RegistrationStatus = 'confirmed' | 'pending' | 'waitlist' | 'cancelled' | 'no_show';
type EventPaymentMethod = 'transfer' | 'cash';

interface EventTypeInfo {
    value: EventType;
    label: string;
    iconName: 'star' | 'wrench' | 'leaf' | 'flame' | 'home' | 'sparkles';
    color: string;     // hex color
}
```

---

## Resumen de Archivos del Módulo

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `server/src/routes/events.ts` | 686 | API completa de eventos |
| `src/pages/admin/events/EventsManager.tsx` | ~190 | Orquestador SPA, todas las mutations |
| `src/pages/admin/events/EventListView.tsx` | ~250 | Lista de eventos con filtros y stats |
| `src/pages/admin/events/EventDetailView.tsx` | ~500 | Detalle, inscripciones, check-in, config |
| `src/pages/admin/events/CreateEventView.tsx` | 513 | Formulario 4 pasos (crear / editar) |
| `src/pages/admin/events/types.ts` | ~80 | Interfaces y constantes de tipos |
| `src/pages/admin/events/utils.ts` | ~20 | Helpers: `formatEventDate`, `formatCurrency` |
| `src/pages/admin/events/EventTypeIcon.tsx` | — | Ícono dinámico según tipo de evento |
| `src/pages/client/Events.tsx` | 1077 | Vista cliente: lista + detalle + inscripción + pago |

**Total:** ~3,315 líneas dedicadas al módulo de eventos.
