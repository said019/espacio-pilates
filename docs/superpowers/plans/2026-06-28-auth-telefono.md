# Registro/Login del cliente por teléfono — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cliente se registra e inicia sesión con su **número de teléfono** (contraseña), el correo pasa a opcional, y el admin mantiene su login por correo.

**Architecture:** Cambio en la capa de autenticación de un backend Express/Postgres (ESM, un solo `server/index.js`) + frontend React/Vite/TS. La identidad del cliente pasa de `email` (UNIQUE NOT NULL) a `phone` (único entre `role='client'`); el correo queda nullable y único-cuando-exista. El JWT ya identifica por `id`, así que no cambia. El login usa un campo unificado "Teléfono o correo": si contiene `@` busca por correo (admin), si no, normaliza y busca por teléfono (cliente).

**Tech Stack:** Node ESM, Express, Postgres (pg), bcryptjs, jsonwebtoken; React + Vite + TypeScript, react-hook-form + zod, zustand, @tanstack/react-query, vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-auth-telefono-design.md`

## Global Constraints

- **Módulos ESM** (`package.json` `"type": "module"`): los archivos en `server/lib/` usan `export function …`; se importan con extensión `.js` (`import { x } from "./lib/x.js"`).
- **Normalización de teléfono SIEMPRE** vía `normalizePhoneForStorage()` (ya existe en `server/index.js:9065`): MX de 10 dígitos → `+52XXXXXXXXXX`; si ya trae `+`, se respeta.
- **bcrypt rounds = 12** (igual que registro/login actuales).
- **JWT por `id`** (`signToken(userId)` → `{ sub: userId }`); NO cambiar `signToken`, `authMiddleware`, `adminMiddleware`, ni `/api/auth/me`.
- **Admin se queda con correo**: el seed admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, `server/index.js:1934`) NO cambia.
- **Correo opcional**: `users.email` nullable, único cuando exista. **Teléfono único entre `role='client'`**.
- **Base de producción vacía** (solo admin + seed) → migración sin backfill de duplicados.
- **Test runner:** `npm run test` (vitest). **Build:** `npm run build`. **Lint:** `npm run lint`. **Sintaxis backend:** `node --check server/index.js`.
- **Copy en español**; reusar clases tailwind `valiance-*` existentes.
- **Commits locales por tarea. NO hacer `git push` hasta la Tarea 11** (un push a `main` redespliega Railway en vivo). Ejecutar en rama `feat/auth-telefono`.

---

## File Structure

- **Create** `server/lib/authIdentity.js` — helper puro `isEmailIdentifier`.
- **Create** `server/lib/__tests__/authIdentity.test.js` — tests vitest.
- **Modify** `server/index.js` — migración (`ensureSchema`, ~657), registro (~2947), login (~2992), forgot-password (~3028), nuevo endpoint admin reset-password (~10075), create-user admin con correo opcional (~10056).
- **Modify** `src/types/auth.ts` — `LoginCredentials` con `identifier`, `RegisterData.email` opcional, `User.email` nullable.
- **Modify** `src/stores/authStore.ts` — `login()` envía `identifier`.
- **Modify** `src/pages/auth/Login.tsx` — campo "Teléfono o correo".
- **Modify** `src/pages/auth/Register.tsx` — correo opcional, teléfono requerido.
- **Modify** `src/pages/auth/ForgotPassword.tsx` — acepta teléfono o correo + copy.
- **Modify** `src/pages/admin/clients/ClientDetail.tsx` — botón "Restablecer contraseña" + mutación.

---

## Task 0: Rama de trabajo

- [ ] **Step 1: Crear la rama**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git checkout -b feat/auth-telefono
```

- [ ] **Step 2: Confirmar árbol limpio**

Run: `git status --short`
Expected: sin cambios pendientes (vacío).

---

## Task 1: Helper `isEmailIdentifier` (TDD)

**Files:**
- Create: `server/lib/authIdentity.js`
- Test: `server/lib/__tests__/authIdentity.test.js`

**Interfaces:**
- Produces: `isEmailIdentifier(value: string): boolean` — `true` si el valor (string) contiene `@` (es un correo); `false` para teléfonos o no-strings. El login usa esto para decidir entre búsqueda por correo (admin) o por teléfono (cliente).

- [ ] **Step 1: Escribir el test que falla**

Create `server/lib/__tests__/authIdentity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isEmailIdentifier } from '../authIdentity.js';

describe('isEmailIdentifier', () => {
  it('detecta un correo', () => {
    expect(isEmailIdentifier('espaciopilatesvm@gmail.com')).toBe(true);
  });
  it('un teléfono no es correo', () => {
    expect(isEmailIdentifier('4445480352')).toBe(false);
    expect(isEmailIdentifier('+524445480352')).toBe(false);
  });
  it('maneja vacío y no-strings sin romper', () => {
    expect(isEmailIdentifier('')).toBe(false);
    expect(isEmailIdentifier(null)).toBe(false);
    expect(isEmailIdentifier(undefined)).toBe(false);
    expect(isEmailIdentifier(12345)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verque falle**

Run: `npm run test -- authIdentity`
Expected: FAIL — `Failed to resolve import "../authIdentity.js"` (el archivo aún no existe).

- [ ] **Step 3: Implementación mínima**

Create `server/lib/authIdentity.js`:

```js
// server/lib/authIdentity.js
// Decide si un identificador de login es un correo (admin) o un teléfono (cliente).
export function isEmailIdentifier(value) {
  return typeof value === "string" && value.includes("@");
}
```

- [ ] **Step 4: Correr el test y verque pase**

Run: `npm run test -- authIdentity`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/authIdentity.js server/lib/__tests__/authIdentity.test.js
git commit -m "feat(auth): helper isEmailIdentifier (correo vs teléfono)"
```

---

## Task 2: Migración de BD (correo opcional, teléfono único entre clientes)

**Files:**
- Modify: `server/index.js` (en `ensureSchema()`, junto a los `ALTER TABLE users` existentes, después de `server/index.js:657`)

**Interfaces:**
- Produces: esquema con `users.email` nullable (único cuando exista, ya garantizado por la restricción UNIQUE original de Postgres que permite múltiples NULL) y un índice único parcial `uq_users_phone_client` sobre `phone` donde `role='client'`.

- [ ] **Step 1: Añadir la migración**

En `server/index.js`, justo después de la línea 657 (`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10)`), insertar:

```js
    // ── Auth por teléfono: correo opcional, teléfono único entre clientes ──
    await pool.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`).catch(() => { });
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_client ON users (phone) WHERE role = 'client'`
    ).catch(() => { });
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (exit 0).

- [ ] **Step 3: Verificar contra la BD local**

Arrancar el backend una vez para que corra `ensureSchema()` (usa la BD local `tep_vm`):

```bash
PORT=8090 node server/index.js &
sleep 6 && kill %1
```

Luego inspeccionar el esquema:

```bash
psql tep_vm -c "\d users" | grep -iE "email|uq_users_phone_client"
```
Expected: la columna `email` ya **no** dice `not null`; aparece el índice `uq_users_phone_client ... WHERE (role = 'client')`.

> Si no hay BD local `tep_vm` disponible, omitir el Step 3 y confiar en la verificación e2e de la Tarea 11. Dejar registrado que se omitió.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(auth): migración email opcional + teléfono único entre clientes"
```

---

## Task 3: Endpoint de registro por teléfono (correo opcional)

**Files:**
- Modify: `server/index.js:2947-2989` (`POST /api/auth/register`)

**Interfaces:**
- Consumes: `normalizePhoneForStorage()` (ya existe).
- Produces: `POST /api/auth/register` que exige `{ phone, password, displayName }` y acepta `email` opcional; valida duplicado por teléfono (entre clientes) y por correo (si vino); devuelve `{ user, token }` igual que antes.

- [ ] **Step 1: Reemplazar el handler de registro**

Reemplazar el bloque actual (`server/index.js:2947-2989`) por:

```js
app.post("/api/auth/register", async (req, res) => {
  const { email, password, displayName, phone, gender, acceptsTerms, acceptsCommunications } = req.body;
  if (!password || !displayName || !phone) {
    return res.status(400).json({ message: "Nombre, teléfono y contraseña son requeridos" });
  }
  const normalizedPhone = normalizePhoneForStorage(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ message: "Teléfono inválido" });
  }
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  try {
    const phoneExists = await pool.query(
      "SELECT id FROM users WHERE phone = $1 AND role = 'client'",
      [normalizedPhone]
    );
    if (phoneExists.rows.length > 0) {
      return res.status(409).json({ message: "Este teléfono ya está registrado" });
    }
    if (normalizedEmail) {
      const emailExists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
      if (emailExists.rows.length > 0) {
        return res.status(409).json({ message: "Este email ya está registrado" });
      }
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (display_name, email, phone, gender, password_hash, accepts_terms, accepts_communications, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'client')
       RETURNING *`,
      [displayName.trim(), normalizedEmail, normalizedPhone, gender || null, passwordHash, acceptsTerms ?? false, acceptsCommunications ?? false]
    );
    const user = result.rows[0];
    // Auto-create referral code
    const code = "OPH" + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(
      "INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [user.id, code]
    );
    // Award welcome bonus loyalty points
    try {
      const cfgRes = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
      const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
      const pts = cfg.welcome_bonus ?? 50;
      if (cfg.enabled !== false && pts > 0) {
        await pool.query(
          "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, 'Bono de bienvenida')",
          [user.id, pts]
        );
      }
    } catch (e) { /* loyalty earn error shouldn't fail register */ }
    const token = signToken(user.id);
    return res.status(201).json({ user: mapUser(user), token });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (exit 0).

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(auth): registro por teléfono con correo opcional"
```

---

## Task 4: Endpoint de login por teléfono o correo

**Files:**
- Modify: `server/index.js` — import del helper (junto a los imports de `./lib/`, ~línea 18) y el handler `POST /api/auth/login` (`server/index.js:2992-3013`)

**Interfaces:**
- Consumes: `isEmailIdentifier()` (Task 1), `normalizePhoneForStorage()`.
- Produces: `POST /api/auth/login` que recibe `{ identifier, password }` (acepta `email` como alias por retrocompat); resuelve por correo si trae `@`, si no por teléfono normalizado.

- [ ] **Step 1: Importar el helper**

Después de `server/index.js:18` (`import { createPreference, … } from "./lib/mercadopago.js";`), añadir:

```js
import { isEmailIdentifier } from "./lib/authIdentity.js";
```

- [ ] **Step 2: Reemplazar el handler de login**

Reemplazar el bloque actual (`server/index.js:2992-3013`) por:

```js
app.post("/api/auth/login", async (req, res) => {
  const identifier = (req.body?.identifier ?? req.body?.email ?? "").toString().trim();
  const { password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: "Teléfono o email y contraseña son requeridos" });
  try {
    let result;
    if (isEmailIdentifier(identifier)) {
      result = await pool.query("SELECT * FROM users WHERE email = $1", [identifier.toLowerCase()]);
    } else {
      const normalizedPhone = normalizePhoneForStorage(identifier);
      result = await pool.query("SELECT * FROM users WHERE phone = $1 LIMIT 1", [normalizedPhone]);
    }
    if (result.rows.length === 0) return res.status(401).json({ message: "Credenciales incorrectas" });
    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ message: "Credenciales incorrectas" });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Credenciales incorrectas" });
    try {
      await awardBirthdayBonusIfEligible(user.id);
    } catch (bonusErr) {
      console.error("[Loyalty] birthday bonus login:", bonusErr?.message || bonusErr);
    }
    const token = signToken(user.id);
    return res.json({ user: mapUser(user), token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (exit 0).

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(auth): login por teléfono o correo (campo identifier)"
```

---

## Task 5: Recuperación por teléfono/correo + restablecer desde admin

**Files:**
- Modify: `server/index.js:3028-3068` (`POST /api/auth/forgot-password`)
- Modify: `server/index.js:10056-10075` (`POST /api/users`, admin crea cliente — correo opcional)
- Modify: `server/index.js` — nuevo `POST /api/admin/users/:id/reset-password` (insertar después del bloque `DELETE /api/users/:id`, ~`server/index.js:10086`)

**Interfaces:**
- Consumes: `isEmailIdentifier()`, `normalizePhoneForStorage()`, `adminMiddleware`, `sendPasswordResetEmail`, `APP_PUBLIC_URL`.
- Produces:
  - `forgot-password` acepta teléfono o correo; sólo envía link si el usuario tiene correo; siempre responde 200 genérico.
  - `POST /api/admin/users/:id/reset-password` → `{ tempPassword }` (admin restablece la contraseña de un cliente).
  - `POST /api/users` (admin) ya no exige correo; valida duplicado por teléfono entre clientes.

- [ ] **Step 1: Reemplazar `forgot-password`**

Reemplazar el bloque actual (`server/index.js:3028-3068`) por:

```js
app.post("/api/auth/forgot-password", async (req, res) => {
  const raw = (req.body?.email ?? req.body?.identifier ?? "").toString().trim();
  if (!raw) return res.status(400).json({ message: "Teléfono o email es requerido" });
  const genericOk = { message: "Si la cuenta existe y tiene correo, recibirás un enlace. Si no, contáctanos por WhatsApp." };

  try {
    let user;
    if (isEmailIdentifier(raw)) {
      user = await pool.query("SELECT id, display_name, email FROM users WHERE email = $1", [raw.toLowerCase()]);
    } else {
      const normalizedPhone = normalizePhoneForStorage(raw);
      user = await pool.query("SELECT id, display_name, email FROM users WHERE phone = $1 LIMIT 1", [normalizedPhone]);
    }
    // Sin usuario, o usuario sin correo: responder genérico (no se puede enviar link).
    if (user.rows.length === 0 || !user.rows[0].email) {
      return res.json(genericOk);
    }
    const target = user.rows[0];

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [target.id],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [target.id, token, expiresAt]
    );

    await sendPasswordResetEmail({
      to: target.email,
      name: target.display_name || "Clienta",
      token,
      resetUrl: `${APP_PUBLIC_URL}/auth/reset-password?token=${encodeURIComponent(token)}`,
    });

    return res.json(genericOk);
  } catch (err) {
    console.error("Auth /forgot-password error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});
```

- [ ] **Step 2: Hacer el correo opcional en `POST /api/users` (admin)**

Reemplazar el bloque actual (`server/index.js:10056-10075`) por:

```js
app.post("/api/users", adminMiddleware, async (req, res) => {
  try {
    const { email, displayName, phone, role = "client", dateOfBirth, emergencyContactName, emergencyContactPhone, healthNotes } = req.body;
    if (!displayName || !phone) return res.status(400).json({ message: "Nombre y teléfono requeridos" });
    const normalizedPhone = normalizePhoneForStorage(phone);
    const normalizedEmail = email ? email.toLowerCase().trim() : null;
    if (role === "client") {
      const phoneExists = await pool.query("SELECT id FROM users WHERE phone = $1 AND role = 'client'", [normalizedPhone]);
      if (phoneExists.rows.length) return res.status(409).json({ message: "Teléfono ya registrado" });
    }
    if (normalizedEmail) {
      const emailExists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
      if (emailExists.rows.length) return res.status(409).json({ message: "Email ya registrado" });
    }
    const tempPassword = Math.random().toString(36).slice(2, 10);
    const hash = await bcrypt.hash(tempPassword, 12);
    const r = await pool.query(
      `INSERT INTO users (display_name, email, phone, role, password_hash, date_of_birth, emergency_contact_name, emergency_contact_phone, health_notes, accepts_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
      [displayName, normalizedEmail, normalizedPhone, role, hash, dateOfBirth || null, emergencyContactName || null, emergencyContactPhone || null, healthNotes || null]
    );
    return res.status(201).json({ user: mapUser(r.rows[0]), tempPassword });
  } catch (err) {
    console.error("POST /api/users error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});
```

> Nota: el `import("bcryptjs")` dinámico anterior se elimina; se usa el `bcrypt` ya importado al inicio del archivo. bcrypt rounds=12 (constraint global).

- [ ] **Step 3: Añadir el endpoint admin de restablecer contraseña**

Insertar después del bloque `DELETE /api/users/:id` (`server/index.js:10086`):

```js
// POST /api/admin/users/:id/reset-password — admin restablece la contraseña de un cliente
app.post("/api/admin/users/:id/reset-password", adminMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    const newPassword = (password && String(password).length >= 8)
      ? String(password)
      : Math.random().toString(36).slice(2, 10) + "A1";
    const hash = await bcrypt.hash(newPassword, 12);
    const r = await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id",
      [hash, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
    // Invalidar links de recuperación pendientes
    await pool.query("UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false", [req.params.id]).catch(() => { });
    return res.json({ message: "Contraseña restablecida", tempPassword: newPassword });
  } catch (err) {
    console.error("POST /api/admin/users/:id/reset-password error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (exit 0).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(auth): forgot-password por teléfono/correo + reset admin + create-user correo opcional"
```

---

## Task 6: Tipos frontend + authStore

**Files:**
- Modify: `src/types/auth.ts`
- Modify: `src/stores/authStore.ts:30-41` (`login`)

**Interfaces:**
- Produces: `LoginCredentials = { identifier: string; password: string }`; `RegisterData.email?` opcional; `User.email` nullable. `authStore.login()` envía `{ identifier, password }`.

- [ ] **Step 1: Actualizar tipos**

En `src/types/auth.ts`:

Cambiar `email: string;` (línea 3, dentro de `User`) por:

```ts
  email: string | null;
```

Reemplazar `LoginCredentials` (líneas 44-47) por:

```ts
export interface LoginCredentials {
  identifier: string;
  password: string;
}
```

En `RegisterData` (líneas 49-57), cambiar `email: string;` por:

```ts
  email?: string;
```

- [ ] **Step 2: El authStore ya pasa el objeto tal cual**

`login: async (credentials) => { … api.post("/auth/login", credentials) … }` ya envía el objeto completo, así que al cambiar el tipo a `{ identifier, password }` el store envía `identifier`. No requiere cambio de lógica, pero verifica que `src/stores/authStore.ts:33` siga siendo:

```ts
          const res = await api.post<AuthResponse>("/auth/login", credentials);
```

(Si está así, no se edita.)

- [ ] **Step 3: Verificar tipos/build parcial**

Run: `npm run build`
Expected: puede fallar en `Login.tsx`/`Register.tsx` (aún no actualizados) — eso es esperado. Si el ÚNICO error es de esos archivos, continuar. Anota los errores para confirmarlos resueltos tras las Tareas 7-8.

- [ ] **Step 4: Commit**

```bash
git add src/types/auth.ts src/stores/authStore.ts
git commit -m "feat(auth): tipos identifier/email-opcional en frontend"
```

---

## Task 7: Login.tsx — campo "Teléfono o correo" + layout de una sola pantalla

**Files:**
- Modify: `src/pages/auth/Login.tsx` (schema/tipo, campo de identifier, y layout/responsive en todo el archivo)

**Interfaces:**
- Consumes: `login` de `useAuthStore` (envía `{ identifier, password }`).

**Requisito de diseño (NUEVO, pedido por el usuario):** la página debe **caber en una sola pantalla sin scroll vertical**, en desktop **y** móvil, con la **imagen adaptada**. Usar el skill `frontend-design` para esta tarea. Objetivos:
- Contenedor a `min-h-[100dvh]` y que el contenido del formulario quepa sin overflow en viewports comunes (desktop ~1280×800, móvil ~390×844). En móvil, **el aside de la imagen (`hidden lg:flex`) ya se oculta** — mantener eso; el formulario debe ocupar el alto disponible y centrarse sin desbordar.
- Compactar espaciados (paddings/`gap`) lo necesario para que todo (logo, encabezado, campos, botón Entrar, "Crear cuenta") sea visible de un vistazo. Los bloques de instalación PWA pueden quedar como están (aparecen condicionalmente y no en el flujo normal), pero no deben empujar el formulario fuera de vista cuando se muestran — limitarlos o hacerlos compactos.
- Conservar la estética VM (paleta `valiance-*`, serif display) y la imagen hero del aside; sólo ajustar tamaño/encaje (`object-cover`, escala) para que se vea bien sin forzar scroll.
- No romper accesibilidad: labels asociados, foco visible, targets táctiles cómodos.

- [ ] **Step 1: Cambiar schema y tipo**

Reemplazar `src/pages/auth/Login.tsx:13-17` por:

```tsx
const schema = z.object({
  identifier: z.string().min(1, "Requerido"),
  password: z.string().min(1, "Requerido"),
});
type FormValues = { identifier: string; password: string };
```

- [ ] **Step 2: Cambiar el campo de email por identifier**

Reemplazar el bloque del campo email (`src/pages/auth/Login.tsx:160-173`) por:

```tsx
            <div className="flex flex-col gap-1.5">
              <label htmlFor="identifier" className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium">
                Teléfono o correo
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                placeholder="Tu teléfono"
                {...register("identifier")}
                className="bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-3.5 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all"
              />
              {errors.identifier && <span className="text-[0.78rem] text-destructive font-body">{errors.identifier.message}</span>}
            </div>
```

> `onSubmit` ya llama `await login(data)` con `data` = `{ identifier, password }`, así que no cambia.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sin errores en `Login.tsx`.

- [ ] **Step 4: Verificar que cabe en una pantalla (desktop + móvil)**

Levantar `npm run dev` y, con Playwright (MCP disponible) o el navegador, abrir `/auth/login` en 1280×800 y 390×844. Confirmar que NO hay scroll vertical en el flujo normal (sin teclado abierto) y que el botón "Entrar" y el enlace "Crear cuenta" son visibles sin desplazarse. Tomar screenshot en ambos tamaños y adjuntar al reporte.
Expected: sin scroll vertical; todo el formulario visible en ambos tamaños.

- [ ] **Step 5: Commit**

```bash
git add src/pages/auth/Login.tsx
git commit -m "feat(auth): Login con campo Teléfono o correo + una sola pantalla responsive"
```

---

## Task 8: Register.tsx — correo opcional + layout de una sola pantalla

**Files:**
- Modify: `src/pages/auth/Register.tsx` (schema, onSubmit, campo email, y layout/responsive en todo el archivo)

**Interfaces:**
- Consumes: `registerUser` de `useAuthStore` (envía `email` sólo si se llenó).

**Requisito de diseño (NUEVO, pedido por el usuario):** la página de registro debe **caber en una sola pantalla sin tener que subir/bajar**, en desktop **y** móvil, con la **imagen adaptada**. Usar el skill `frontend-design`. Es la página más densa (nombre, teléfono, sexo, email opcional, contraseña, confirmar, 2 checkboxes, botón). Objetivos:
- Contenedor a `min-h-[100dvh]`; **quitar el `overflow-y-auto`** del `<main>` y, en su lugar, **compactar** para que quepa: agrupar campos en filas de 2 columnas donde tenga sentido (ya hay grids `sm:grid-cols-2` para Nombre/Teléfono y Contraseña/Confirmar — extender el patrón, p.ej. Sexo + Email en una fila), reducir paddings/`gap`, encoger el logo superior y márgenes del encabezado.
- Como el **correo ahora es opcional**, considerar que ocupe menos (campo más corto o en fila con Sexo). El objetivo es que en móvil (~390×844) el formulario completo y el botón "Crear mi cuenta" se vean con scroll mínimo o nulo; en desktop, sin scroll.
- Adaptar la imagen del aside (`hidden lg:flex` ya la oculta en móvil — mantener). En desktop, asegurar que el aside y el formulario llenen el alto sin desbordar.
- Conservar estética VM (paleta `valiance-*`, serif, lista de PERKS en el aside). No eliminar campos requeridos; sólo reorganizar/compactar. Reducir o quitar el footer "©" si estorba para que quepa.
- Mantener accesibilidad (labels, foco, targets táctiles).

- [ ] **Step 1: Hacer `email` opcional en el schema**

Reemplazar `src/pages/auth/Register.tsx:16` (`email: z.string().email("Email inválido"),`) por:

```tsx
  email: z.string().email("Email inválido").optional().or(z.literal("")),
```

- [ ] **Step 2: Enviar email sólo si se llenó**

Reemplazar el cuerpo de `onSubmit` (`src/pages/auth/Register.tsx:71-90`) por:

```tsx
  const onSubmit = async (data: FormValues) => {
    clearError();
    const rawPhone = data.phone.replace(/\D/g, "");
    const phone = rawPhone.startsWith(dialCode) ? `+${rawPhone}` : `+${dialCode}${rawPhone}`;
    try {
      await registerUser({
        ...(data.email ? { email: data.email } : {}),
        password: data.password,
        displayName: data.displayName,
        phone,
        gender: data.gender,
        acceptsTerms: data.acceptsTerms,
        acceptsCommunications: data.acceptsCommunications,
        ...(refCode ? { referralCode: refCode } : {}),
      } as any);
      navigate("/app");
    } catch {
      toast({ title: "No pudimos crear tu cuenta", description: error ?? "Inténtalo de nuevo", variant: "destructive" });
    }
  };
```

- [ ] **Step 3: Marcar el campo como opcional en la UI**

Reemplazar el bloque del campo email (`src/pages/auth/Register.tsx:225-230`) por:

```tsx
            {/* Email (opcional) */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls} htmlFor="reg-email">Email <span className="lowercase tracking-normal text-valiance-charcoal/45">— opcional</span></label>
              <input id="reg-email" type="email" autoComplete="email" placeholder="Para recibos por correo (opcional)" {...register("email")} className={inputCls} />
              {errors.email && <span className="text-[0.78rem] text-destructive font-body">{errors.email.message}</span>}
            </div>
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: sin errores. (Los errores de tipo de la Tarea 6 deben quedar resueltos aquí.)

- [ ] **Step 5: Verificar que cabe en una pantalla (desktop + móvil)**

Levantar `npm run dev` y abrir `/auth/register` en 1280×800 y 390×844 (Playwright MCP o navegador). Confirmar que el formulario completo y el botón "Crear mi cuenta" se ven con scroll mínimo o nulo. Tomar screenshot en ambos tamaños y adjuntar al reporte.
Expected: en desktop sin scroll; en móvil scroll mínimo o nulo, con el botón de envío alcanzable sin búsqueda.

- [ ] **Step 6: Commit**

```bash
git add src/pages/auth/Register.tsx
git commit -m "feat(auth): Registro con correo opcional, teléfono principal + una sola pantalla responsive"
```

---

## Task 9: ForgotPassword.tsx — teléfono o correo

**Files:**
- Modify: `src/pages/auth/ForgotPassword.tsx:11-12` (schema), `:23-37` (onSubmit), `:80-99` (copy + campo), `:55-59` (copy de éxito)

**Interfaces:**
- Consumes: `POST /auth/forgot-password` (acepta `{ identifier }`).

- [ ] **Step 1: Cambiar schema y tipo**

Reemplazar `src/pages/auth/ForgotPassword.tsx:11-12` por:

```tsx
const schema = z.object({ identifier: z.string().min(1, "Requerido") });
type FormValues = { identifier: string };
```

- [ ] **Step 2: Enviar identifier**

Reemplazar la llamada en `onSubmit` (`src/pages/auth/ForgotPassword.tsx:26`) `await api.post("/auth/forgot-password", data);` por:

```tsx
      await api.post("/auth/forgot-password", { identifier: data.identifier });
```

- [ ] **Step 3: Actualizar el campo y los textos**

Reemplazar el bloque del campo email (`src/pages/auth/ForgotPassword.tsx:86-99`) por:

```tsx
              <div className="flex flex-col gap-1.5">
                <label htmlFor="forgot-id" className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium">
                  Teléfono o correo
                </label>
                <input
                  id="forgot-id"
                  type="text"
                  autoComplete="username"
                  placeholder="Tu teléfono"
                  {...register("identifier")}
                  className="bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-3.5 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all"
                />
                {errors.identifier && <span className="text-[0.78rem] text-destructive font-body">{errors.identifier.message}</span>}
              </div>
```

Reemplazar el subtítulo (`src/pages/auth/ForgotPassword.tsx:80-82`) por:

```tsx
              <p className="font-body text-[0.95rem] text-valiance-charcoal/65 mt-2">
                Si tienes correo registrado te mandamos un enlace; si no, escríbenos por WhatsApp y te ayudamos.
              </p>
```

Reemplazar el texto de éxito (`src/pages/auth/ForgotPassword.tsx:57-59`) por:

```tsx
            <p className="font-body text-[0.95rem] text-valiance-charcoal/70 leading-relaxed mb-8 max-w-[340px] mx-auto">
              Si la cuenta existe y tiene correo, te enviamos un enlace para recuperar tu contraseña. Si te registraste solo con teléfono, escríbenos por WhatsApp y te ayudamos a entrar.
            </p>
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/auth/ForgotPassword.tsx
git commit -m "feat(auth): recuperación por teléfono o correo"
```

---

## Task 10: Admin ClientDetail — botón "Restablecer contraseña"

**Files:**
- Modify: `src/pages/admin/clients/ClientDetail.tsx` — añadir mutación (junto a `linkWalkinsMutation`, ~`:405`) y un botón en la zona de acciones del encabezado (junto al botón "Editar perfil").

**Interfaces:**
- Consumes: `POST /admin/users/:id/reset-password` → `{ tempPassword }`.

- [ ] **Step 1: Añadir la mutación**

Insertar después de `linkWalkinsMutation` (`src/pages/admin/clients/ClientDetail.tsx:405`):

```tsx
  const resetPasswordMutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/reset-password`, {}),
    onSuccess: (res: any) => {
      const temp = res?.data?.tempPassword;
      toast({
        title: "Contraseña restablecida",
        description: temp ? `Nueva contraseña temporal: ${temp}` : "Lista. Compártela con la alumna.",
      });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al restablecer", variant: "destructive" }),
  });
```

- [ ] **Step 2: Añadir el botón en el encabezado**

En el encabezado de la página (dentro del `div` de datos de la alumna, junto al botón existente "Editar perfil" / `startEditing`), añadir:

```tsx
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("¿Restablecer la contraseña de esta alumna? Se generará una contraseña temporal para compartirle.")) {
                        resetPasswordMutation.mutate();
                      }
                    }}
                    disabled={resetPasswordMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-full border border-valiance-mauve/30 px-3.5 py-2 text-[0.78rem] font-medium text-valiance-mauve transition-colors hover:bg-valiance-mauve hover:text-valiance-nude disabled:opacity-60"
                  >
                    Restablecer contraseña
                  </button>
```

> Ubicarlo junto al botón "Editar perfil" existente (buscar `startEditing` en el JSX del encabezado). Reusa el patrón de botón ya presente; ajusta el contenedor (`flex`/`gap`) si hace falta para que queden lado a lado.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/clients/ClientDetail.tsx
git commit -m "feat(auth): botón admin para restablecer contraseña de cliente"
```

---

## Task 11: Verificación end-to-end + merge a main

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite de tests y build**

```bash
npm run test
npm run build
npm run lint
```
Expected: tests verdes (incluye `authIdentity`), build sin errores, lint sin errores nuevos.

- [ ] **Step 2: Levantar backend + frontend local**

```bash
PORT=8090 node server/index.js   # en una terminal (corre ensureSchema → migración)
npm run dev                       # en otra (Vite 5173)
```

- [ ] **Step 3: Pruebas manuales (criterios de aceptación del spec)**

Verificar con curl al backend local (puerto 8090):

```bash
# Registro SOLO teléfono (sin correo) → 201 + token
curl -s -X POST localhost:8090/api/auth/register -H 'Content-Type: application/json' \
  -d '{"phone":"4441234567","password":"Prueba123","displayName":"Ana Test"}' | head -c 300; echo

# Login por teléfono (con y sin +52) → 200 + token
curl -s -X POST localhost:8090/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"4441234567","password":"Prueba123"}' | head -c 200; echo
curl -s -X POST localhost:8090/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"+524441234567","password":"Prueba123"}' | head -c 200; echo

# Teléfono duplicado → 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8090/api/auth/register -H 'Content-Type: application/json' \
  -d '{"phone":"4441234567","password":"Otra123","displayName":"Dup"}'

# Login admin por correo (mismo endpoint) → 200 (usar ADMIN_EMAIL/ADMIN_PASSWORD del entorno local)
curl -s -X POST localhost:8090/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"espaciopilatesvm@gmail.com","password":"EspacioVM2026!"}' | head -c 120; echo

# forgot-password solo-teléfono → 200 genérico (no envía link)
curl -s -X POST localhost:8090/api/auth/forgot-password -H 'Content-Type: application/json' \
  -d '{"identifier":"4441234567"}'; echo
```
Expected: registro 201; ambos logins de teléfono 200; duplicado 409; login admin 200; forgot 200 genérico.

- [ ] **Step 4: Prueba de UI en el navegador**

- Registro en `/auth/register` solo con teléfono (sin correo) → entra a `/app`.
- Logout y login en `/auth/login` con el teléfono → entra.
- Login con el correo del admin → entra a `/admin/dashboard`.
- En `/admin/clients/:id` (la alumna creada) → botón "Restablecer contraseña" muestra contraseña temporal; login con esa contraseña funciona.

- [ ] **Step 5: Limpiar usuario de prueba**

```bash
psql tep_vm -c "DELETE FROM users WHERE phone = '+524441234567' AND role = 'client'"
```

- [ ] **Step 6: Merge a main y push (deploy en vivo) — confirmar con el usuario antes**

```bash
git checkout main
git merge --no-ff feat/auth-telefono -m "feat(auth): registro/login del cliente por teléfono"
git push origin main
```
Expected: Railway redespliega; `ensureSchema()` corre la migración en producción. Verificar en la app en vivo: registrar una cuenta de prueba solo con teléfono y borrarla después.

---

## Self-Review (cobertura del spec)

- **Correo opcional / phone único** → Tareas 2, 3, 5. ✓
- **Registro por teléfono** → Tarea 3 (back) + Tarea 8 (front). ✓
- **Login identifier (Opción A)** → Tareas 1, 4 (back) + Tarea 7 (front). ✓
- **Admin se queda con correo** → cubierto por el branch `@` en Tarea 4; seed admin intacto (constraint global). ✓
- **Recuperación: admin restablece + link por correo para quien lo tenga** → Tarea 5 (forgot por teléfono/correo + endpoint admin) + Tarea 10 (botón). ✓
- **Normalización consistente** → `normalizePhoneForStorage()` en registro y login (constraint global). ✓
- **`event_registrations` fuera de alcance** → no se toca. ✓
- **Pruebas/criterios de aceptación** → Tarea 11. ✓
- **Migración idempotente / base vacía** → Tarea 2. ✓
