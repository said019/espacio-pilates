# Módulo de Videos — Documentación Completa

> **Propósito:** Documentación integral del sistema de videos de Catarsis Studio. Cubre base de datos, API backend, componentes frontend (admin y cliente), flujo de compra por transferencia, almacenamiento (Cloudinary / Google Drive), y configuración de entorno. Escrita como prompt replicable para IA.

---

## Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Base de Datos](#2-base-de-datos)
3. [Variables de Entorno](#3-variables-de-entorno)
4. [Cloudinary — Librería de Soporte](#4-cloudinary--librería-de-soporte)
5. [API Backend — Endpoints](#5-api-backend--endpoints)
6. [Validación con Zod (Schemas)](#6-validación-con-zod-schemas)
7. [Helpers del Backend](#7-helpers-del-backend)
8. [Frontend Admin — Componentes](#8-frontend-admin--componentes)
9. [Frontend Cliente — Componentes](#9-frontend-cliente--componentes)
10. [Componentes Compartidos](#10-componentes-compartidos)
11. [Matriz de Acceso a Videos](#11-matriz-de-acceso-a-videos)
12. [Flujo Completo de Compra por Transferencia](#12-flujo-completo-de-compra-por-transferencia)
13. [TypeScript — Interfaces Principales](#13-typescript--interfaces-principales)

---

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LANDING (público)                            │
│  VideoGallery.tsx → GET /videos/public → videos publicados          │
│  Fullscreen modal con iframe/video, navegación prev/next            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     CLIENTE AUTENTICADO                              │
│  VideoLibrary.tsx → GET /videos → grid filtrable por categoría      │
│  VideoPlayer.tsx  → GET /videos/:id + GET /videos/:id/stream        │
│  CommentSection   → GET/POST /videos/:id/comments                   │
│  Compra           → POST /:id/purchase → PUT /:id/purchase/proof    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        ADMIN                                        │
│  VideoList.tsx              → GET /videos (listado + delete)        │
│  VideoUpload.tsx            → POST /videos/upload + POST /videos    │
│  VideoSalesVerification.tsx → GET /purchases/pending + approve/reject│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       ALMACENAMIENTO                                │
│  Cloudinary (preferido): authenticated type, signed URLs (2h TTL)   │
│  Google Drive (fallback): OAuth2 refresh, permisos reader public    │
│  Multer: multipart, 600MB límite, campos video + thumbnail          │
└─────────────────────────────────────────────────────────────────────┘
```

**Stack:**
- **Frontend:** React 18 + TypeScript + Vite, Shadcn/ui + Tailwind CSS, TanStack Query, React Hook Form + Zod, Axios
- **Backend:** Express.js + PostgreSQL, multer para uploads, cloudinary SDK v2
- **Auth:** Bearer token (localStorage), middleware `authenticate` + `requireRole`

---

## 2. Base de Datos

### 2.1 Enums

```sql
CREATE TYPE video_purchase_status AS ENUM (
    'pending_payment',
    'pending_verification',
    'approved',
    'rejected',
    'cancelled',
    'expired'
);
```

### 2.2 Tablas

#### `video_categories`
```sql
CREATE TABLE video_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    color       VARCHAR(7) DEFAULT '#8F9A8A',
    icon        VARCHAR(50),
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### `videos`
```sql
CREATE TABLE videos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(255) NOT NULL,
    slug                VARCHAR(255) UNIQUE NOT NULL,
    description         TEXT,
    cloudinary_id       VARCHAR(500),        -- ID en Cloudinary (authenticated)
    drive_file_id       VARCHAR(500),        -- ID en Google Drive (fallback)
    thumbnail_url       TEXT,                -- URL directa del thumbnail
    thumbnail_drive_id  VARCHAR(500),        -- Thumbnail en Drive
    category_id         UUID REFERENCES video_categories(id),
    level               VARCHAR(50) DEFAULT 'todos',  -- principiante|intermedio|avanzado|todos
    access_type         VARCHAR(50) DEFAULT 'gratuito', -- gratuito|miembros
    is_published        BOOLEAN DEFAULT false,
    published_at        TIMESTAMPTZ,
    duration_seconds    INTEGER DEFAULT 0,
    views_count         INTEGER DEFAULT 0,
    likes_count         INTEGER DEFAULT 0,
    comments_count      INTEGER DEFAULT 0,
    sort_order          INTEGER DEFAULT 0,
    -- Campos de presentación (landing/galería)
    subtitle            VARCHAR(255),        -- ej. "elegance in motion"
    tagline             VARCHAR(255),        -- ej. "Ballet · Pilates · Funcional"
    days                VARCHAR(255),        -- ej. "Lunes, Miércoles y Viernes"
    brand_color         VARCHAR(7) DEFAULT '#8F9A8A',
    is_featured         BOOLEAN DEFAULT false,
    -- Campos de venta
    sales_enabled       BOOLEAN DEFAULT false,   -- ¿mostrar botón de compra?
    sales_price_mxn     NUMERIC(10,2),           -- precio en MXN
    sales_class_credits INTEGER,                 -- créditos de clases sugeridos
    sales_cta_text      VARCHAR(255),            -- texto del botón CTA
    sales_unlocks_video BOOLEAN DEFAULT false,   -- ¿bloquea el video hasta pagar?
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

**Nota clave sobre `access_type` vs `sales_unlocks_video`:**
- `access_type` = quién puede VER el video (gratuito = todos, miembros = solo con membresía activa)
- `sales_enabled` = si se muestra sección de compra con precio
- `sales_unlocks_video` = si el video está BLOQUEADO hasta que se apruebe una compra por transferencia

#### `video_purchases`
```sql
CREATE TABLE video_purchases (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id),
    video_id            UUID NOT NULL REFERENCES videos(id),
    amount              NUMERIC(10,2) NOT NULL,
    currency            VARCHAR(3) DEFAULT 'MXN',
    payment_method      VARCHAR(50) DEFAULT 'transfer',
    status              video_purchase_status DEFAULT 'pending_payment',
    payment_reference   VARCHAR(255),        -- referencia SPEI
    transfer_date       DATE,                -- fecha de la transferencia
    proof_file_url      TEXT,                -- imagen/PDF del comprobante (base64→URL)
    proof_file_name     VARCHAR(255),
    proof_file_type     VARCHAR(100),
    customer_notes      TEXT,
    admin_notes         TEXT,
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,          -- 48 horas desde creación
    has_access          BOOLEAN DEFAULT false, -- true cuando approved
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

#### `video_likes`
```sql
CREATE TABLE video_likes (
    user_id    UUID REFERENCES users(id),
    video_id   UUID REFERENCES videos(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);
```

#### `video_comments`
```sql
CREATE TABLE video_comments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id   UUID NOT NULL REFERENCES videos(id),
    user_id    UUID NOT NULL REFERENCES users(id),
    parent_id  UUID REFERENCES video_comments(id), -- para replies (no implementado en UI)
    content    TEXT NOT NULL,
    status     VARCHAR(20) DEFAULT 'approved',       -- approved|pending|rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `video_history`
```sql
CREATE TABLE video_history (
    user_id       UUID REFERENCES users(id),
    video_id      UUID REFERENCES videos(id),
    last_position NUMERIC(10,2) DEFAULT 0,  -- segundos reproducidos
    completed     BOOLEAN DEFAULT false,
    watched_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);
```

### 2.3 Índices recomendados

```sql
CREATE INDEX idx_videos_category ON videos(category_id);
CREATE INDEX idx_videos_published ON videos(is_published);
CREATE INDEX idx_video_purchases_user ON video_purchases(user_id);
CREATE INDEX idx_video_purchases_status ON video_purchases(status);
CREATE INDEX idx_video_comments_video ON video_comments(video_id);
CREATE INDEX idx_video_history_user ON video_history(user_id);
```

---

## 3. Variables de Entorno

### Cloudinary (almacenamiento preferido)
```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvwxyz
```

### Google Drive (fallback)
```env
GOOGLE_DRIVE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_DRIVE_REFRESH_TOKEN=1//0xxxxx
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUv   # carpeta donde se suben los archivos
```

### Frontend
```env
VITE_API_URL=https://tu-api.up.railway.app/api
```

---

## 4. Cloudinary — Librería de Soporte

**Archivo:** `server/src/lib/cloudinary.ts`

```typescript
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

// URL firmada para streaming (authenticated type, expira en 2 horas)
export const generateSignedVideoUrl = (publicId: string, expiresInMinutes = 120) => {
    const expiresAt = Math.floor(Date.now() / 1000) + (expiresInMinutes * 60);
    return cloudinary.url(publicId, {
        resource_type: 'video',
        type: 'authenticated',
        sign_url: true,
        expires_at: expiresAt,
        streaming_profile: 'auto', // HLS/DASH adaptive streaming
    });
};

// Thumbnail auto-generado desde frame del video (640x360, frame en segundo 10)
export const generateThumbnailUrl = (publicId: string) => {
    return cloudinary.url(publicId, {
        resource_type: 'video',
        format: 'jpg',
        transformation: [
            { width: 640, height: 360, crop: 'fill' },
            { quality: 'auto' },
            { start_offset: '10' }
        ]
    });
};

export default cloudinary;
```

**Importante:** Los videos se suben con `type: 'authenticated'`, lo cual significa que NO tienen URL pública. Solo se pueden acceder con URLs firmadas que expiran.

---

## 5. API Backend — Endpoints

**Archivo:** `server/src/routes/videos.ts` (1369 líneas)
**Base path:** `/api/videos`
**Middlewares:** `authenticate` (valida Bearer token), `requireRole('admin')` para rutas admin

### 5.1 Categorías

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/categories` | No | Lista categorías activas ordenadas por `sort_order` |

**Response:**
```json
[{ "id": "uuid", "name": "Pilates", "slug": "pilates", "color": "#8F9A8A", "icon": null }]
```

### 5.2 Videos Públicos (Landing)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/public` | No | Videos publicados con `is_published = true`, ordenados por `sort_order, published_at DESC` |

**Response:** Array de videos con campos: `id, title, slug, description, thumbnail_url, category_name, category_color, level, access_type, duration_seconds, views_count, subtitle, tagline, days, brand_color, is_featured, sales_enabled, sales_price_mxn, video_url (si Cloudinary), embed_url (si Drive)`

### 5.3 Upload de Video

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/upload` | Admin | Sube archivo de video y thumbnail opcional vía multipart/form-data |

**Multer config:**
- Límite: 600MB
- Campos: `video` (1 archivo), `thumbnail` (1 archivo)
- Storage: memory (buffer)

**Lógica de upload:**
1. Si existe `CLOUDINARY_CLOUD_NAME` → sube a Cloudinary como `resource_type: 'video', type: 'authenticated'`
2. Si existe `GOOGLE_DRIVE_FOLDER_ID` → sube a Google Drive con OAuth2, luego hace público con permisos reader
3. El thumbnail sigue la misma lógica (Cloudinary como `image/upload`, Drive al mismo folder)

**Response:**
```json
{
    "cloudinary_id": "videos/abc123",
    "drive_file_id": null,
    "thumbnail_url": "https://res.cloudinary.com/...",
    "thumbnail_drive_id": null,
    "duration_seconds": 0
}
```

### 5.4 Lista de Videos (Autenticado)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/` | Sí | Admin ve todos; cliente ve solo `is_published = true` |

**Query params:** `search` (filtro por título ILIKE), `category` (UUID)
**Response:** Array de videos con joins a `video_categories`

### 5.5 Compras del Usuario

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/purchases/my` | Sí | Todas las compras del usuario actual |
| `GET` | `/:id/purchase` | Sí | Compra del usuario actual para un video específico |

### 5.6 Compras Pendientes (Admin)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/purchases/pending` | Admin | Compras con status `pending_payment` o `pending_verification`, ordenadas: `pending_verification` primero, luego por fecha |

**Response:** Array de `VideoPurchase` con `user_name`, `user_email`, `video_title`

### 5.7 Aprobar / Rechazar Compra (Admin)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/purchases/:purchaseId/approve` | Admin | Aprueba compra → transacción: actualiza status + inserta payment |
| `POST` | `/purchases/:purchaseId/reject` | Admin | Rechaza compra, guarda `admin_notes` |

**Approve — transacción SQL:**
```sql
BEGIN;
UPDATE video_purchases SET status='approved', has_access=true, approved_at=NOW(), reviewed_by=:adminId, reviewed_at=NOW(), admin_notes=:notes WHERE id=:purchaseId;
INSERT INTO payments (user_id, amount, currency, payment_method, status, description, reference_number)
    VALUES (:userId, :amount, :currency, 'transfer', 'completed', 'Compra de video: :title', :reference);
COMMIT;
```

**Body (ambos):**
```json
{ "admin_notes": "Transferencia verificada en estado de cuenta" }
```

### 5.8 Crear Compra (Cliente)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/:id/purchase` | Sí | Crea solicitud de compra para un video con `sales_unlocks_video = true` |

**Validaciones:**
- Video debe tener `sales_enabled`, `sales_unlocks_video`, `sales_price_mxn > 0`
- No debe existir compra previa con status `pending_payment`, `pending_verification` o `approved`

**Crea registro con:**
- `amount` = `sales_price_mxn` del video
- `payment_method` = `'transfer'`
- `status` = `'pending_payment'`
- `expires_at` = NOW() + 48 horas

### 5.9 Enviar Comprobante (Cliente)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `PUT` | `/:id/purchase/proof` | Sí | Envía referencia de transferencia, fecha y archivo comprobante |

**Body:**
```json
{
    "transfer_reference": "SPEI123456",
    "transfer_date": "2024-01-15",
    "notes": "Transferí desde BBVA",
    "file_data": "data:image/jpeg;base64,...",
    "file_name": "comprobante.jpg",
    "file_type": "image/jpeg"
}
```

**Lógica:**
- Si `status === 'pending_payment'` o `'rejected'` → actualiza a `pending_verification`
- Almacena `file_data` (base64) directo en `proof_file_url` de la BD
- Guarda `transfer_reference`, `transfer_date`, `customer_notes`, `proof_file_name`, `proof_file_type`

### 5.10 Detalle de Video

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/:id` | Sí | Detalle completo con categoría, liked status, historial de reproducción |

**Response adicional:** `liked: boolean`, `watch_history: { last_position, completed }`

### 5.11 Stream de Video

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/:id/stream` | Sí | Devuelve URL firmada o embed URL + incrementa `views_count` |

**⚠️ Control de acceso (orden de prioridad):**

```
1. Si sales_unlocks_video && sales_enabled && price > 0:
   → Busca compra aprobada del usuario
   → Si no tiene → 403 { code: 'VIDEO_PURCHASE_REQUIRED' }

2. Si access_type === 'miembros' && !tiene_compra_aprobada:
   → Busca membresía activa del usuario
   → Si no tiene → 403 { code: 'MEMBERSHIP_REQUIRED' }

3. Acceso permitido → genera URL:
   - Cloudinary: generateSignedVideoUrl(cloudinary_id) → { url, proxy_url }
   - Google Drive: embed URL con preview → { embed_url }
```

**Response (Cloudinary):**
```json
{
    "url": "https://res.cloudinary.com/...signed...",
    "proxy_url": "/api/videos/:id/proxy-stream"
}
```

**Response (Drive):**
```json
{
    "embed_url": "https://drive.google.com/file/d/xxx/preview"
}
```

### 5.12 Progreso / Historial

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/:id/progress` | Sí | Upsert en `video_history`: posición actual y si completó |

**Body:**
```json
{ "position": 125.5, "completed": false }
```

### 5.13 Likes

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/:id/like` | Sí | Toggle: si ya existe → DELETE, si no → INSERT. Actualiza `likes_count` en videos |

**Response:**
```json
{ "liked": true, "likes_count": 42 }
```

### 5.14 Comentarios

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/:id/comments` | Sí | Lista comentarios aprobados (sin parent_id), con user_name y avatar |
| `POST` | `/:id/comments` | Sí | Agrega comentario. **Requiere membresía activa** (valida en `user_memberships`) |

**GET Response:**
```json
[{
    "id": "uuid",
    "content": "Excelente clase!",
    "user_name": "María López",
    "user_avatar": "https://...",
    "created_at": "2024-01-15T...",
    "reply_count": 0
}]
```

**POST Body:**
```json
{ "content": "Me encantó esta rutina" }
```

### 5.15 CRUD Admin

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/` | Admin | Crear video (todos los campos del schema) |
| `PUT` | `/:id` | Admin | Actualizar video (campos parciales) |
| `DELETE` | `/:id` | Admin | Eliminar video por ID |

**POST Body (crear):**
```json
{
    "title": "Pilates Mat Avanzado",
    "description": "Rutina de 45 minutos...",
    "cloudinary_id": "videos/pilates-mat-avanzado",
    "category_id": "uuid-de-categoria",
    "level": "avanzado",
    "access_type": "miembros",
    "is_published": true,
    "sales_enabled": true,
    "sales_unlocks_video": true,
    "sales_price_mxn": 299,
    "sales_class_credits": 5,
    "sales_cta_text": "Comprar acceso"
}
```

El slug se genera automáticamente del título con la función `toSlug()`.

---

## 6. Validación con Zod (Schemas)

```typescript
// Schema base con todos los campos de un video
const BaseVideoSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    cloudinary_id: z.string().optional(),
    drive_file_id: z.string().optional(),
    thumbnail_url: z.string().optional(),
    thumbnail_drive_id: z.string().optional(),
    category_id: z.string().uuid().optional().nullable(),
    level: z.enum(['principiante', 'intermedio', 'avanzado', 'todos']).default('todos'),
    access_type: z.enum(['gratuito', 'miembros']).default('gratuito'),
    is_published: z.boolean().default(false),
    duration_seconds: z.number().int().min(0).default(0),
    sort_order: z.number().int().default(0),
    subtitle: z.string().max(255).optional().nullable(),
    tagline: z.string().max(255).optional().nullable(),
    days: z.string().max(255).optional().nullable(),
    brand_color: z.string().max(7).optional().nullable(),
    is_featured: z.boolean().default(false),
    sales_enabled: z.boolean().default(false),
    sales_price_mxn: z.number().min(0).optional().nullable(),
    sales_class_credits: z.number().int().min(0).optional().nullable(),
    sales_cta_text: z.string().max(255).optional().nullable(),
    sales_unlocks_video: z.boolean().default(false),
});

// Para crear: requiere al menos cloudinary_id o drive_file_id
const CreateVideoSchema = BaseVideoSchema.refine(
    (data) => data.cloudinary_id || data.drive_file_id,
    { message: 'Se requiere cloudinary_id o drive_file_id' }
).refine(
    (data) => !data.sales_enabled || (data.sales_price_mxn && data.sales_price_mxn > 0),
    { message: 'El precio debe ser mayor a 0 cuando las ventas están habilitadas' }
);

// Para actualizar: todos opcionales
const UpdateVideoSchema = BaseVideoSchema.partial();

// Para crear una compra
const CreateVideoPurchaseSchema = z.object({
    notes: z.string().max(500).optional(),
});

// Para enviar comprobante
const SubmitVideoPurchaseProofSchema = z.object({
    transfer_reference: z.string().max(255).optional().nullable(),
    transfer_date: z.string().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    file_data: z.string().optional().nullable(),  // base64
    file_name: z.string().optional().nullable(),
    file_type: z.string().optional().nullable(),
});

// Para revisión admin
const ReviewVideoPurchaseSchema = z.object({
    admin_notes: z.string().max(500).optional(),
});
```

---

## 7. Helpers del Backend

### Upload a Cloudinary

```typescript
async function uploadBufferToCloudinary(
    buffer: Buffer,
    options: { resource_type: string; folder?: string; type?: string }
): Promise<any> {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
        const Readable = require('stream').Readable;
        const readable = new Readable();
        readable.push(buffer);
        readable.push(null);
        readable.pipe(stream);
    });
}
```

### Upload a Google Drive

```typescript
async function getGoogleDriveAccessToken(): Promise<string> {
    // Usa OAuth2 con refresh_token para obtener access_token fresco
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
            refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
            grant_type: 'refresh_token',
        }),
    });
    return (await response.json()).access_token;
}

async function uploadBufferToGoogleDrive(
    buffer: Buffer, fileName: string, mimeType: string, folderId: string
): Promise<string> {
    const accessToken = await getGoogleDriveAccessToken();
    // Multipart upload a Drive API v3
    // Retorna fileId
}

async function makeGoogleDriveFilePublic(fileId: string): Promise<void> {
    // POST /drive/v3/files/:fileId/permissions → { role: 'reader', type: 'anyone' }
}
```

### Mapeo de compra

```typescript
function mapVideoPurchase(row: any) {
    return {
        id: row.id,
        user_id: row.user_id,
        user_name: row.user_name,
        user_email: row.user_email,
        video_id: row.video_id,
        video_title: row.video_title,
        amount: parseFloat(row.amount),
        currency: row.currency,
        status: row.status,
        payment_reference: row.payment_reference,
        transfer_date: row.transfer_date,
        has_proof: Boolean(row.proof_file_url),
        proof_file_url: row.proof_file_url,
        proof_file_name: row.proof_file_name,
        proof_file_type: row.proof_file_type,
        customer_notes: row.customer_notes,
        admin_notes: row.admin_notes,
        created_at: row.created_at,
        expires_at: row.expires_at,
    };
}
```

### Generación de slug

```typescript
function toSlug(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}
```

### Seguridad en generación de URLs

```typescript
function safeGenerateSignedVideoUrl(cloudinaryId: string): string | null {
    try { return generateSignedVideoUrl(cloudinaryId); }
    catch (e) { console.error('Error generating signed URL:', e); return null; }
}

function safeGenerateThumbnailUrl(cloudinaryId: string): string | null {
    try { return generateThumbnailUrl(cloudinaryId); }
    catch (e) { console.error('Error generating thumbnail URL:', e); return null; }
}
```

---

## 8. Frontend Admin — Componentes

### 8.1 VideoList.tsx (246 líneas)

**Ruta:** `/admin/videos`
**Archivo:** `src/pages/admin/videos/VideoList.tsx`

**Funcionalidad:**
- Tabla con columnas: Thumbnail, Título (+ precio si `sales_enabled`), Categoría, Acceso, Estado, Vistas, Acciones
- Búsqueda por título con `search` param en query
- Paginación: 20 videos por página
- Botones: "Nuevo Video" → navega a `/admin/videos/new`, "Editar" → `/admin/videos/:id/edit`, "Eliminar" con confirmación AlertDialog

**Badges de acceso (`getAccessBadge`):**
```
sales_unlocks_video = true → Badge amber "Compra"
access_type = 'miembros'   → Badge purple "Miembros"
default                    → Badge blue "Gratuito"
```

**Queries:**
- `GET /videos?search=...&page=...&limit=20`

**Mutations:**
- `DELETE /videos/:id` → invalida query `['admin-videos']`

### 8.2 VideoUpload.tsx (644 líneas)

**Ruta:** `/admin/videos/new` y `/admin/videos/:id/edit`
**Archivo:** `src/pages/admin/videos/VideoUpload.tsx`

**Funcionalidad:**
- Formulario completo de creación/edición de video
- Upload de archivo de video con XHR y barra de progreso (no usa Axios para poder trackear %)
- Upload de thumbnail opcional (mismo XHR)
- Envía a `POST /videos/upload` como FormData (multipart)
- Al guardar: `POST /videos` (crear) o `PUT /videos/:id` (editar)

**Campos del formulario:**
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `title` | text | Título del video (requerido) |
| `description` | textarea | Descripción |
| `category_id` | select | Categoría (de GET /categories) |
| `level` | select | principiante / intermedio / avanzado / todos |
| `access_type` | select | gratuito / miembros |
| `is_published` | switch | Publicar video |
| `subtitle` | text | Subtítulo para galería |
| `tagline` | text | Tagline para galería |
| `days` | text | Días de la semana |
| `brand_color` | color picker | Color de marca |
| **Sección de ventas** | | |
| `sales_enabled` | switch | Habilitar ventas |
| `sales_unlocks_video` | switch | Bloquear video hasta compra |
| `sales_price_mxn` | number | Precio en MXN |
| `sales_class_credits` | number | Créditos de clases |
| `sales_cta_text` | text | Texto del botón CTA |

**Validación frontend:**
- Si `sales_enabled` → `sales_price_mxn` debe ser > 0
- Si `sales_unlocks_video` → `sales_enabled` debe ser true + `sales_price_mxn` > 0

**Upload con XHR:**
```typescript
const xhr = new XMLHttpRequest();
xhr.open('POST', `${API_URL}/videos/upload`);
xhr.setRequestHeader('Authorization', `Bearer ${token}`);
xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
};
xhr.send(formData); // FormData con campos 'video' y 'thumbnail'
```

### 8.3 VideoSalesVerification.tsx (361 líneas)

**Ruta:** `/admin/video-sales`
**Archivo:** `src/pages/admin/videos/VideoSalesVerification.tsx`

**Funcionalidad:**
- Panel de verificación de pagos por transferencia para compras de video
- Tarjetas resumen: "Por verificar" (pending_verification) + "Esperando pago" (pending_payment)
- Tabla con columnas: Cliente, Video, Monto, Estado, Fecha, Acciones
- Botón "Revisar" abre Dialog con:
  - Info del cliente (nombre, email)
  - Video y monto
  - Referencia de transferencia y fecha
  - Notas del cliente
  - Visor de comprobante (imagen inline o link a PDF)
  - Campo de notas del admin (opcional)
  - Botones: "Rechazar" (destructive) y "Aprobar y desbloquear"

**Status badges:**
| Status | Label | Variante |
|--------|-------|----------|
| `pending_payment` | Pendiente de pago | warning |
| `pending_verification` | En verificación | default |
| `approved` | Aprobada | default (green) |
| `rejected` | Rechazada | destructive |
| `cancelled` | Cancelada | secondary |
| `expired` | Expirada | outline |

**Queries:**
- `GET /videos/purchases/pending`

**Mutations:**
- `POST /videos/purchases/:id/approve` con `{ admin_notes }`
- `POST /videos/purchases/:id/reject` con `{ admin_notes }`

---

## 9. Frontend Cliente — Componentes

### 9.1 VideoLibrary.tsx (233 líneas)

**Ruta:** `/app/videos`
**Archivo:** `src/pages/client/VideoLibrary.tsx`

**Funcionalidad:**
- Biblioteca de videos on-demand para clientes autenticados
- Header con título "Biblioteca de Videos" y contador
- Barra de búsqueda + filtros por categoría (botones pill con color de categoría)
- Grid responsivo: 1/2/3 columnas según viewport
- Skeleton loading (6 placeholders)
- Empty state con botón "Limpiar filtros"

**Card de cada video:**
- Thumbnail con overlay gradient y botón play on hover
- Badge de duración (esquina inferior derecha)
- Badge "Miembros" (si `access_type === 'miembros'`, esquina superior derecha con ícono Lock)
- Badge "Compra requerida" (si `sales_unlocks_video && price > 0`, esquina superior izquierda, amber)
- Categoría badge + nivel
- Título + descripción (truncados a 2 líneas)
- Línea de precio si `sales_enabled`:
  - `sales_unlocks_video` → `"Acceso por compra: $299 MXN"`
  - else → `"Desde $299 MXN en clases"` (es cross-sell de paquetes)

**Navega a:** `/app/videos/:id` al hacer click

### 9.2 VideoPlayer.tsx (651 líneas)

**Ruta:** `/app/videos/:videoId`
**Archivo:** `src/pages/client/VideoPlayer.tsx`

**Funcionalidad completa:**

#### a) Reproductor de video
- Intenta reproducir con `<video>` usando URL firmada (proxy_url + token)
- Si falla `<video>` → fallback a `<iframe>` con embed_url
- Skeleton mientras carga

#### b) Control de acceso en player
El endpoint `GET /videos/:id/stream` puede devolver 2 errores que el player maneja:

**Pantalla `MEMBERSHIP_REQUIRED`:**
- Ícono Lock morado
- Título "Contenido Exclusivo"
- Texto: "disponible solo para miembros activos"
- Botón → `/app/checkout` (Ver Planes)

**Pantalla `VIDEO_PURCHASE_REQUIRED`:**
- Ícono Lock amber
- Título "Video de Pago"
- Texto: "necesitas una compra aprobada por transferencia"
- Botón "Iniciar compra" (si no tiene compra existente) → `POST /videos/:id/purchase`

#### c) Sección de compra (debajo del video)
Se muestra cuando `sales_enabled && price > 0`:

**Si `sales_unlocks_video`:**
- Texto: "Acceso por compra: $XXX MXN"
- Sub-texto: "Disponible para cualquier usuario registrado con pago por transferencia"
- Si no tiene compra → botón "Comprar video por transferencia"
- Si `purchase.status === 'approved'` → banner verde "Pago aprobado — Tu acceso ya está desbloqueado"
- Si `purchase.status === 'pending_verification'` → banner amber "Pago en verificación"
- Si `purchase.status === 'rejected'` → banner rojo "Pago rechazado" con `admin_notes`

**Si NO `sales_unlocks_video` (cross-sell):**
- Texto: "Desde $XXX MXN"
- Sub-texto con créditos de clase sugeridos
- Botón → `/app/checkout` con texto personalizado (`sales_cta_text` o "Comprar clases")

#### d) Formulario de comprobante (`showProofForm`)
Se muestra cuando `requiresPurchase && purchase && (status === 'pending_payment' || status === 'rejected')`:

1. **Datos bancarios** (de `GET /settings/bank-info`):
   - Banco, Titular, Cuenta, CLABE — cada uno con botón copiar al portapapeles
   - Instrucciones de referencia (si existen)

2. **Formulario:**
   - Referencia de transferencia (text)
   - Fecha de transferencia (date)
   - Comprobante: drag/click upload de imagen (JPG, PNG, WebP) o PDF, máximo 5MB
     - Preview de imagen inline, o nombre del archivo para PDF
     - Botón X para remover
   - Notas adicionales (textarea)
   - Botón "Enviar comprobante" (disabled si no hay referencia ni archivo)

3. **Submit** → `PUT /videos/:id/purchase/proof` (convierte archivo a base64 con FileReader)

#### e) Sección de comentarios
- Renderiza `<CommentSection videoId={video.id} />`

#### f) Metadata del video
- Badges: categoría (con color), nivel, "Miembros" (si aplica), "Compra requerida" (si aplica), status de compra
- Título grande, descripción, fecha de publicación

### 9.3 Flujo de auto-refresh al aprobar
Cuando `purchase.status` cambia a `'approved'`:
```typescript
useEffect(() => {
    if (purchase?.status === 'approved') {
        setError(null);
        refetchStream(); // Vuelve a pedir GET /videos/:id/stream → ahora devuelve URL
    }
}, [purchase?.status, refetchStream]);
```

---

## 10. Componentes Compartidos

### 10.1 VideoGallery.tsx (409 líneas)

**Archivo:** `src/components/VideoGallery.tsx`
**Uso:** Landing page pública (sección "Experiencia Visual")

**Funcionalidad:**
- Fetch videos publicados con `GET /videos/public` (fetch nativo, no Axios)
- Si la API no responde → usa array `fallbackVideos` (4 videos estáticos: Barré, Pilates Mat, Yoga Sculpt, Sculpt)
- Mapea respuesta API a `VideoItem`: `{ id, title, subtitle, tagline, thumbnail, videoUrl, embedUrl, color, days }`
- Grid responsivo: 1 col (mobile) → 2/3/4 cols según cantidad de videos
- Cards con aspect-ratio 3:4, overlay gradient, play button on hover, accent line animada
- Click en card → abre **Fullscreen Modal** con:
  - Backdrop blur negro
  - Botón close (Escape key)
  - Flechas navegación prev/next (si > 1 video)
  - Title bar con color de marca
  - `<iframe>` si embedUrl existe, `<video>` si videoUrl existe
  - Dot indicators de navegación

### 10.2 CommentSection.tsx (~120 líneas)

**Archivo:** `src/components/videos/CommentSection.tsx`
**Uso:** Dentro de `VideoPlayer.tsx`

**Funcionalidad:**
- Muestra avatar del usuario actual + textarea para escribir comentario
- Lista de comentarios aprobados con avatar, nombre, tiempo relativo (date-fns en español)
- `POST /videos/:id/comments` → requiere membresía activa (validado en backend)
- Invalidación de query al publicar

---

## 11. Matriz de Acceso a Videos

| `access_type` | `sales_enabled` | `sales_unlocks_video` | ¿Quién puede VER? | ¿Qué muestra? |
|---------------|------------------|-----------------------|--------------------|----------------|
| `gratuito` | `false` | `false` | Todos los autenticados | Solo video |
| `gratuito` | `true` | `false` | Todos los autenticados | Video + cross-sell de clases |
| `gratuito` | `true` | `true` | Solo con compra aprobada | Video bloqueado + flujo de compra |
| `miembros` | `false` | `false` | Solo miembros activos | Video + paywall membresía |
| `miembros` | `true` | `false` | Solo miembros activos | Video + cross-sell de clases |
| `miembros` | `true` | `true` | Compra aprobada (o miembro) | Compra tiene prioridad sobre membresía |

**Prioridad en stream:** `sales_unlocks_video` se evalúa ANTES que `access_type`, por lo que si un video tiene `sales_unlocks_video = true`, la compra tiene precedencia.

---

## 12. Flujo Completo de Compra por Transferencia

```
┌──────────────────────────────────────────────────────────────┐
│ PASO 1: Cliente abre VideoPlayer → GET /videos/:id/stream   │
│         → 403 VIDEO_PURCHASE_REQUIRED                        │
│         → Pantalla "Video de Pago" con botón "Iniciar compra"│
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ PASO 2: POST /videos/:id/purchase                            │
│         → Crea video_purchases con status='pending_payment'  │
│         → expires_at = NOW() + 48h                           │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ PASO 3: Se muestran datos bancarios (GET /settings/bank-info)│
│         → Banco, Titular, Cuenta, CLABE                      │
│         → El cliente realiza transferencia en su banco        │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ PASO 4: PUT /videos/:id/purchase/proof                       │
│         → Envía: referencia SPEI, fecha, comprobante (base64)│
│         → Status cambia a 'pending_verification'             │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│ PASO 5: Admin ve en VideoSalesVerification                   │
│         → GET /videos/purchases/pending                      │
│         → Revisa datos, comprobante, referencia              │
└────────┬──────────────────────────────────┬──────────────────┘
         │                                  │
┌────────▼───────────┐           ┌──────────▼──────────────────┐
│ PASO 6a: APROBAR   │           │ PASO 6b: RECHAZAR           │
│ POST /.../approve  │           │ POST /.../reject            │
│ → has_access=true  │           │ → admin_notes = razón       │
│ → approved_at=NOW  │           │ → rejected_at=NOW           │
│ → Inserta payment  │           │ → Cliente puede reenviar    │
│   en tabla payments│           │   comprobante (vuelve paso 4│
└────────┬───────────┘           └─────────────────────────────┘
         │
┌────────▼─────────────────────────────────────────────────────┐
│ PASO 7: VideoPlayer detecta purchase.status === 'approved'   │
│         → refetchStream() → ahora devuelve URL firmada       │
│         → Video se reproduce automáticamente                 │
└──────────────────────────────────────────────────────────────┘
```

**Tiempos:**
- Compra expira en **48 horas** si no se envía comprobante
- URL firmada de Cloudinary expira en **2 horas** (120 minutos)
- Si rechazada, el cliente puede reenviar (el status vuelve a `pending_verification`)

---

## 13. TypeScript — Interfaces Principales

### Frontend: VideoDetail (VideoPlayer)
```typescript
interface VideoDetail {
    id: string;
    title: string;
    description: string;
    category_name: string;
    category_color?: string;
    level: string;
    access_type: 'gratuito' | 'miembros';
    published_at: string;
    duration_seconds?: number;
    sales_enabled?: boolean;
    sales_unlocks_video?: boolean;
    sales_price_mxn?: number | null;
    sales_class_credits?: number | null;
    sales_cta_text?: string | null;
}
```

### Frontend: VideoPurchase
```typescript
interface VideoPurchase {
    id: string;
    amount: number;
    currency: string;
    status: 'pending_payment' | 'pending_verification' | 'approved' | 'rejected' | 'cancelled' | 'expired';
    payment_reference?: string | null;
    transfer_date?: string | null;
    has_proof: boolean;
    proof_file_name?: string | null;
    proof_file_url?: string | null;
    admin_notes?: string | null;
    created_at?: string;
    updated_at?: string;
    expires_at?: string | null;
}
```

### Frontend: Video (VideoLibrary)
```typescript
interface Video {
    id: string;
    title: string;
    description: string;
    duration_seconds: number;
    thumbnail_url: string;
    category_name: string;
    category_color?: string;
    level: string;
    access_type: 'gratuito' | 'miembros';
    views_count: number;
    sales_enabled?: boolean;
    sales_unlocks_video?: boolean;
    sales_price_mxn?: number | null;
}
```

### Frontend: BankInfo
```typescript
interface BankInfo {
    bank_name: string;
    account_holder: string;
    account_number: string;
    clabe: string;
    reference_instructions?: string;
}
```

### Frontend: Comment
```typescript
interface Comment {
    id: string;
    content: string;
    user_name: string;
    user_avatar: string | null;
    created_at: string;
    reply_count: number;
}
```

### Frontend: VideoItem (Gallery/Landing)
```typescript
interface VideoItem {
    id: string;
    title: string;
    subtitle: string;
    tagline: string;
    thumbnail: string;
    videoUrl: string;
    embedUrl: string;
    color: string;
    days: string;
}
```

### Admin: VideoPurchase (VideoSalesVerification)
```typescript
interface VideoPurchase {
    id: string;
    user_id: string;
    user_name: string;
    user_email: string;
    video_id: string;
    video_title: string;
    amount: number;
    currency: string;
    status: VideoPurchaseStatus;
    payment_reference?: string | null;
    transfer_date?: string | null;
    has_proof: boolean;
    proof_file_url?: string | null;
    proof_file_name?: string | null;
    proof_file_type?: string | null;
    customer_notes?: string | null;
    admin_notes?: string | null;
    created_at: string;
    expires_at?: string | null;
}

type VideoPurchaseStatus = 'pending_payment' | 'pending_verification' | 'approved' | 'rejected' | 'cancelled' | 'expired';
```

---

## Resumen de Archivos del Módulo

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `server/src/routes/videos.ts` | 1369 | API completa de videos |
| `server/src/lib/cloudinary.ts` | 37 | Config Cloudinary + signed URLs |
| `src/pages/admin/videos/VideoList.tsx` | 246 | Lista admin de videos |
| `src/pages/admin/videos/VideoUpload.tsx` | 644 | Formulario crear/editar video |
| `src/pages/admin/videos/VideoSalesVerification.tsx` | 361 | Panel de verificación de compras |
| `src/pages/client/VideoLibrary.tsx` | 233 | Biblioteca de videos cliente |
| `src/pages/client/VideoPlayer.tsx` | 651 | Reproductor + flujo de compra |
| `src/components/VideoGallery.tsx` | 409 | Galería landing (público) |
| `src/components/videos/CommentSection.tsx` | ~120 | Comentarios en videos |

**Total:** ~4,070 líneas de código dedicadas al módulo de videos.
