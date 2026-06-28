# Diseño: Registro y login del cliente por NÚMERO DE TELÉFONO

**Fecha:** 2026-06-27
**Proyecto:** Tu Espacio Pilates · Villa Magna (VM)
**Estado:** Aprobado (pendiente plan de implementación)

## Contexto

Decisión de negocio (Edith, 2026-06-27): **el cliente se registra e inicia sesión con su número de teléfono, no con correo.** El correo deja de ser obligatorio y pasa a ser un dato **opcional** (para recibos/recordatorios por correo además de WhatsApp).

La plataforma v1 ya construida usa el **correo** como identidad: `users.email` es `UNIQUE NOT NULL` y los endpoints de registro/login/recuperación buscan por correo. El JWT ya identifica por `id` de usuario (`{ sub: userId }`), no por correo, lo cual facilita el cambio.

### Estado actual (mapa de código)

- **Tabla `users`** (`supabase/migrations/schema_complete.sql:215-245`): `email VARCHAR(255) UNIQUE NOT NULL`, `phone VARCHAR(20) NOT NULL` (indexado pero **no único**), `password_hash` (se añade dinámico en `server/index.js:644`), `role` (enum: client/instructor/admin/super_admin/reception).
- **Registro** `POST /api/auth/register` (`server/index.js:2946-2989`): exige `email`+`password`+`displayName`; `phone` ya se acepta y se normaliza con `normalizePhoneForStorage()` (`server/index.js:9065-9073`, agrega `+52` a números MX de 10 dígitos). Chequeo de duplicado por correo en `:2953`. bcrypt rounds=12. Devuelve `{ user, token }`.
- **Login** `POST /api/auth/login` (`server/index.js:2991-3013`): busca por correo en `:2996`. Mismo endpoint para admin (se distingue por `role`).
- **Admin seed** (`server/index.js:1934-1945`): `ADMIN_EMAIL`/`ADMIN_PASSWORD`, phone placeholder `'0000000000'`, `ON CONFLICT (email)`.
- **JWT** `signToken` (`server/index.js:2887-2889`): `{ sub: userId }`, 30d. `authMiddleware` (`:2900-2910`) pone `req.userId`. `adminMiddleware` (`:2912-2922`) consulta `role`.
- **Recuperación**: `POST /api/auth/forgot-password` (`:3027-3068`) busca por correo, genera token, envía link con Resend (`sendPasswordResetEmail`); `POST /api/auth/reset-password` (`:3070-3128`); tabla `password_reset_tokens` (`:659-672`).
- **Frontend**: `src/pages/auth/Register.tsx` (zod `:14-33`, ya tiene selector de lada +52), `Login.tsx` (zod `:13-16`, ruteo por rol `:71-86`), `ForgotPassword.tsx`, `ResetPassword.tsx`, `src/stores/authStore.ts` (login/register/checkAuth, persist "auth-storage"), `src/types/auth.ts` (`User`, `LoginCredentials`, `RegisterData`).
- **Admin usuarios**: `server/index.js:10031-10060` (listar/buscar — ya soporta búsqueda por dígitos de teléfono — y crear usuario).

## Decisiones tomadas

1. **Método de acceso del cliente:** teléfono + **contraseña** (no OTP). No depende de WhatsApp conectado; funciona desde el día 1.
2. **Correo:** opcional. El cliente puede agregarlo para recibir recibos/recordatorios por correo además de WhatsApp.
3. **Admin:** se mantiene con **correo** (sin cambios en su login).
4. **Recuperación de contraseña:** el estudio la restablece desde el panel admin; quien tenga correo además puede usar el link por correo de siempre. (OTP por WhatsApp queda como mejora futura.)
5. **Datos actuales:** la base de producción está esencialmente vacía (solo admin + seed) → migración limpia, sin backfill de duplicados.
6. **Login (UX):** **Opción A** — un solo campo "Teléfono o correo". Si el valor contiene `@` → búsqueda por correo (admin); si no → normaliza y busca por teléfono (cliente).

## Diseño

### 1. Base de datos (migración idempotente en `ensureSchema()`)

- **`email` → opcional:** `ALTER TABLE users ALTER COLUMN email DROP NOT NULL`. En Postgres, una restricción `UNIQUE` ya permite múltiples filas con `NULL`, así que con solo quitar `NOT NULL` el correo queda "opcional y único cuando exista". (Idempotente; envolver en `DO/EXCEPTION` por compat.)
- **`phone` → único entre clientes:** `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_client ON users (phone) WHERE role = 'client'`. Índice **parcial** para no chocar con placeholders de admin/instructores (`role != 'client'`). El teléfono se almacena ya normalizado (`+52…`).
- Sin migración de datos (base vacía). La migración debe ser segura aunque corra varias veces.

### 2. Backend (`server/index.js`)

- **`POST /api/auth/register`**:
  - Requeridos: `phone`, `password`, `displayName`. `email` **opcional**.
  - Normalizar `phone` con `normalizePhoneForStorage()` **antes** de insertar y de verificar duplicado.
  - Duplicado: `SELECT id FROM users WHERE phone = $1 AND role = 'client'` → 409 si existe. Si mandaron `email`, además verificar correo no tomado.
  - Insertar con `email` = `NULL` si no vino. Resto (bcrypt, referral, loyalty, JWT por `id`) intacto.
- **`POST /api/auth/login`**:
  - Recibe `identifier` (+ `password`).
  - Si `identifier` incluye `@` → `SELECT * FROM users WHERE email = lower(trim(identifier))`.
  - Si no → normalizar como teléfono → `SELECT * FROM users WHERE phone = $1`.
  - Resto igual (bcrypt compare, birthday bonus, `{ user, token }`). El admin entra con su correo por esta misma ruta.
- **Recuperación**:
  - `POST /api/auth/forgot-password`: acepta teléfono o correo. Buscar usuario; si tiene correo → enviar link (flujo actual). Si es solo-teléfono o no existe → responder 200 genérico ("si la cuenta existe, te contactaremos / contacta al estudio por WhatsApp") para no filtrar existencia.
  - **Restablecer desde admin:** agregar `POST /api/admin/users/:id/reset-password` (admin asigna nueva contraseña; bcrypt 12). *(Verificar en el plan si ya existe un endpoint equivalente antes de crearlo.)*
- **Compat:** `signToken`, `authMiddleware`, `adminMiddleware`, `/api/auth/me` no cambian (identidad por `id`).

### 3. Frontend

- **`Register.tsx`**: teléfono como campo **principal y requerido** (mantiene selector de lada +52); **correo opcional** con ayuda "opcional, para recibir recibos por correo". Ajustar zod: `email` opcional, `phone` requerido. `registerUser()` envía `email` solo si se llenó.
- **`Login.tsx`**: el campo "correo" pasa a **"Teléfono o correo"** (un solo input `identifier`). Ruteo por rol intacto. Ajustar zod.
- **`ForgotPassword.tsx`**: acepta teléfono o correo; copy ajustado (si no hay correo, indicar pedir ayuda al estudio por WhatsApp).
- **`authStore.ts`**: `login()` envía `identifier` en vez de `email`. `register()` con `email` opcional.
- **`types/auth.ts`**: `LoginCredentials` → `{ identifier, password }`; `RegisterData.email?` opcional.
- **Panel admin (gestión de clientes):** acción "Restablecer contraseña" que llama al nuevo endpoint admin.

### 4. Casos borde y fuera de alcance

- **Normalización consistente:** login y registro usan el mismo `normalizePhoneForStorage()` para que `4445480352` y `+524445480352` sean el mismo usuario.
- **Degradación limpia:** sin correo, las notificaciones van solo por WhatsApp (ya es así). Resend sigue para quien tenga correo.
- **`event_registrations`** usa `UNIQUE(event_id, email)`, pero **eventos están fuera de v1** → no se toca.
- **Admin/instructores** mantienen identidad por correo; el índice parcial de teléfono no les aplica.

### 5. Pruebas / criterios de aceptación

- Registro **solo con teléfono** (sin correo) → crea cuenta y devuelve token.
- Registro con correo opcional → guarda ambos.
- Login del cliente por teléfono (con y sin `+52`) → entra.
- Login del admin por correo (mismo endpoint) → entra y rutea a panel admin.
- Teléfono duplicado de cliente → 409.
- `forgot-password`: con correo → envía link; solo-teléfono → respuesta genérica sin filtrar existencia.
- Admin restablece contraseña de un cliente → el cliente entra con la nueva.
- Migración corre dos veces sin error (idempotente).
