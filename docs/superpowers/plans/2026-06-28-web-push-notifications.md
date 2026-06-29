# Notificaciones Web Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las alumnas reciban notificaciones en su dispositivo aunque no tengan la PWA abierta, vía Web Push (Push API + Service Worker + VAPID), como canal aditivo junto a WhatsApp/correo.

**Architecture:** Una capa pura y testeable en `server/lib/push.js` (config VAPID, armado de payload, clasificación de errores, envío a una suscripción). El acceso a BD, la poda de suscripciones muertas y el fan-out por usuario viven en `server/index.js`. El frontend (PWA ya existente) suscribe vía un hook y un toggle en preferencias; el Service Worker (`public/sw.js`) muestra la notificación y maneja el click. Degradación limpia: sin llaves VAPID el push se apaga y nada más se rompe (mismo patrón que MercadoPago/Evolution).

**Tech Stack:** Node + Express (ESM), Postgres (`pg`), paquete `web-push`. Frontend React + Vite + TS, axios (`src/lib/api.ts`), `@tanstack/react-query`, shadcn (`Switch`, `Button`, `Tabs`). Tests con Vitest.

## Global Constraints

- Módulos ESM en backend (`import`/`export`), igual que `server/lib/mercadopago.js`.
- `users.id` es **UUID** → toda FK a usuarios usa UUID.
- Degradación limpia: si faltan `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `GET /api/push/config` devuelve `enabled:false` y los envíos de push se omiten sin lanzar.
- Push es **aditivo**: no se elimina ni condiciona ningún envío de WhatsApp/correo existente.
- Auth: `authMiddleware` setea `req.userId`; endpoints de admin usan `adminMiddleware`.
- Helpers existentes reutilizables: `getSettingsValue(key, fallback)`, `renderTemplateVars(body, vars)`, `DEFAULT_NOTIFICATION_SETTINGS`, `DEFAULT_NOTIFICATION_TEMPLATES`, `pool`.
- Rutas cliente para los `url` del push: reservas → `/app/bookings`; dashboard → `/app`.
- Tests sólo de lógica pura en `server/lib/__tests__/` (el monolito `server/index.js` no se importa en tests; el wiring y el frontend se verifican manualmente), siguiendo el patrón de `mercadopago.test.js`.
- Marca: ícono de notificación `/icon-192.png` (ya existe en `public/`).
- Idioma: español. Sin media ni botones de acción en la notificación.

---

### Task 1: Capa pura de Web Push (`server/lib/push.js`) + tests

**Files:**
- Modify: `package.json` (dependencia `web-push`)
- Create: `server/lib/push.js`
- Test: `server/lib/__tests__/push.test.js`

**Interfaces:**
- Consumes: nada (módulo base).
- Produces:
  - `isPushConfigured(): boolean`
  - `getVapidPublicKey(): string | null`
  - `ensureVapidConfigured(): boolean`
  - `buildPushPayload({ title, body, url?, tag? }): string` (JSON string)
  - `shouldPruneSubscription(error): boolean`
  - `sendWebPush(subscription, payload): Promise<{ sent: boolean, reason?: string }>`

- [ ] **Step 1: Instalar la dependencia**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && npm install web-push
```
Expected: `web-push` aparece en `dependencies` de `package.json` y en `package-lock.json`.

- [ ] **Step 2: Escribir el test que falla**

Create `server/lib/__tests__/push.test.js`:
```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock del paquete web-push (default export con los métodos que usamos).
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
  },
}));

import webpush from "web-push";
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
} from "../push.js";

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("isPushConfigured / getVapidPublicKey", () => {
  it("false cuando faltan llaves", () => {
    expect(isPushConfigured()).toBe(false);
    expect(getVapidPublicKey()).toBe(null);
  });
  it("true cuando ambas llaves están presentes", () => {
    process.env.VAPID_PUBLIC_KEY = "PUB";
    process.env.VAPID_PRIVATE_KEY = "PRIV";
    expect(isPushConfigured()).toBe(true);
    expect(getVapidPublicKey()).toBe("PUB");
  });
});

describe("buildPushPayload", () => {
  it("incluye title/body/url y usa defaults", () => {
    const obj = JSON.parse(buildPushPayload({ title: "Hola", body: "Cuerpo" }));
    expect(obj).toEqual({ title: "Hola", body: "Cuerpo", url: "/" });
  });
  it("incluye tag cuando se pasa", () => {
    const obj = JSON.parse(buildPushPayload({ title: "T", body: "B", url: "/app/bookings", tag: "class_reminder" }));
    expect(obj.url).toBe("/app/bookings");
    expect(obj.tag).toBe("class_reminder");
  });
});

describe("shouldPruneSubscription", () => {
  it("poda en 404 y 410", () => {
    expect(shouldPruneSubscription({ statusCode: 404 })).toBe(true);
    expect(shouldPruneSubscription({ statusCode: 410 })).toBe(true);
  });
  it("no poda en otros errores", () => {
    expect(shouldPruneSubscription({ statusCode: 500 })).toBe(false);
    expect(shouldPruneSubscription({})).toBe(false);
    expect(shouldPruneSubscription(null)).toBe(false);
  });
});

describe("sendWebPush", () => {
  it("no envía si no está configurado", async () => {
    const r = await sendWebPush(SUB, "{}");
    expect(r).toEqual({ sent: false, reason: "not_configured" });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
  it("configura VAPID y envía cuando hay llaves", async () => {
    process.env.VAPID_PUBLIC_KEY = "PUB";
    process.env.VAPID_PRIVATE_KEY = "PRIV";
    const r = await sendWebPush(SUB, "{\"title\":\"x\"}");
    expect(r).toEqual({ sent: true });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "mailto:espaciopilatesvm@gmail.com", "PUB", "PRIV"
    );
    expect(webpush.sendNotification).toHaveBeenCalledWith(SUB, "{\"title\":\"x\"}");
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `npm test -- server/lib/__tests__/push.test.js`
Expected: FAIL con "Failed to resolve import '../push.js'" (el módulo aún no existe).

- [ ] **Step 4: Implementar `server/lib/push.js`**

Create `server/lib/push.js`:
```js
// Web Push (notificaciones de navegador) — capa pura y testeable.
// El envío real a una suscripción vive aquí; el acceso a BD, el fan-out por
// usuario y la poda viven en server/index.js.
import webpush from "web-push";

let vapidConfigured = false;

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Configura VAPID una sola vez (idempotente). Devuelve false si faltan llaves.
export function ensureVapidConfigured() {
  if (vapidConfigured) return true;
  if (!isPushConfigured()) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:espaciopilatesvm@gmail.com";
  webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export function buildPushPayload({ title, body, url = "/", tag } = {}) {
  return JSON.stringify({
    title: String(title || "Tu Espacio Pilates"),
    body: String(body || ""),
    url: String(url || "/"),
    ...(tag ? { tag: String(tag) } : {}),
  });
}

// 404 = endpoint inexistente, 410 = suscripción expirada/cancelada → podar.
export function shouldPruneSubscription(error) {
  const code = error?.statusCode;
  return code === 404 || code === 410;
}

// Envía a UNA suscripción. Lanza el error de web-push (con statusCode) si falla,
// para que el caller decida podar o reintentar.
export async function sendWebPush(subscription, payload) {
  if (!isPushConfigured()) return { sent: false, reason: "not_configured" };
  ensureVapidConfigured();
  await webpush.sendNotification(subscription, payload);
  return { sent: true };
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test -- server/lib/__tests__/push.test.js`
Expected: PASS (todos los `describe`).

- [ ] **Step 6: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add package.json package-lock.json server/lib/push.js server/lib/__tests__/push.test.js
git commit -m "feat(push): capa pura de Web Push (config, payload, envío) + tests"
```

---

### Task 2: Migración de BD + preferencia por usuario

**Files:**
- Modify: `server/index.js` (función `ensureSchema()`, ~línea 660; `mapUser()` ~2955; `PUT /api/users/:id` ~7690)

**Interfaces:**
- Consumes: `pool`, `ensureSchema`, `mapUser`.
- Produces:
  - Tabla `push_subscriptions(id, user_id UUID, endpoint UNIQUE, p256dh, auth, user_agent, created_at, last_used_at)`.
  - Columna `users.push_reminders BOOLEAN DEFAULT true`.
  - `mapUser(u)` ahora incluye `pushReminders`.
  - `PUT /api/users/:id` acepta `pushReminders` en el body.

- [ ] **Step 1: Agregar columna y tabla en `ensureSchema()`**

En `server/index.js`, justo después de la línea:
```js
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_weekly_summary BOOLEAN DEFAULT false`).catch(() => { });
```
agregar:
```js
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_reminders BOOLEAN DEFAULT true`).catch(() => { });
    // ── Web Push: suscripciones por dispositivo ──────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint     TEXT NOT NULL UNIQUE,
        p256dh       TEXT NOT NULL,
        auth         TEXT NOT NULL,
        user_agent   TEXT,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE
      );
    `).catch((e) => console.error("[schema] push_subscriptions:", e.message));
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`).catch(() => { });
```

- [ ] **Step 2: Exponer la preferencia en `mapUser()`**

En `mapUser()` (~2955), después de:
```js
    receiveWeeklySummary: u.receive_weekly_summary ?? false,
```
agregar:
```js
    pushReminders: u.push_reminders ?? true,
```

- [ ] **Step 3: Aceptar `pushReminders` en `PUT /api/users/:id`**

En el handler `PUT /api/users/:id` (~7690):

3a. En el destructuring del body, agregar `pushReminders`:
```js
      receiveReminders, receivePromotions, receiveWeeklySummary,
      acceptsCommunications,
      pushReminders,
      role,
```

3b. En el `UPDATE`, agregar la asignación. Cambiar el bloque de columnas para incluir `push_reminders` antes de `role`:
```js
         accepts_communications    = COALESCE($10, accepts_communications),
         push_reminders            = COALESCE($11, push_reminders),
         role                      = COALESCE($12, role),
         gender                    = COALESCE($13, gender),
         updated_at                = NOW()
       WHERE id = $14
       RETURNING *`,
```

3c. Actualizar el array de parámetros (insertar `pushReminders ?? null` y correr los índices):
```js
      [
        displayName || null, normalizePhoneForStorage(phone), dateOfBirth || null,
        emergencyContactName || null, emergencyContactPhone || null, healthNotes || null,
        receiveReminders ?? null, receivePromotions ?? null, receiveWeeklySummary ?? null,
        acceptsCommunications ?? null,
        pushReminders ?? null,
        newRole,
        gender || null,
        targetId,
      ]
```

- [ ] **Step 4: Verificar arranque + migración**

Run (BD local debe estar corriendo):
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && (node server/index.js &) ; sleep 4 ; \
psql "$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '\"')" -c "\d push_subscriptions" ; \
psql "$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '\"')" -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='push_reminders';" ; \
pkill -f "node server/index.js"
```
Expected: la descripción de la tabla `push_subscriptions` (con `endpoint` UNIQUE) y una fila `push_reminders`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(push): tabla push_subscriptions + preferencia users.push_reminders"
```

---

### Task 3: Endpoints de suscripción (`config`, `subscribe`, `unsubscribe`)

**Files:**
- Modify: `server/index.js` (imports ~17; nuevas rutas — colocarlas junto a otras rutas `/api`, p.ej. después del handler `PUT /api/users/:id`)

**Interfaces:**
- Consumes: `isPushConfigured`, `getVapidPublicKey` (de `./lib/push.js`), `authMiddleware`, `pool`.
- Produces:
  - `GET /api/push/config` → `{ enabled: boolean, publicKey: string|null }`
  - `POST /api/push/subscribe` (auth) → `{ ok: true }`
  - `POST /api/push/unsubscribe` (auth) → `{ ok: true }`

- [ ] **Step 1: Importar helpers de push**

En `server/index.js`, después de:
```js
import { createPreference, syncPayment, verifyWebhookSignature } from "./lib/mercadopago.js";
```
agregar:
```js
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
} from "./lib/push.js";
```

- [ ] **Step 2: Agregar los 3 endpoints**

Colocar este bloque junto a las rutas de usuarios (p.ej. inmediatamente después del cierre del handler `PUT /api/users/:id`):
```js
// ─── Web Push: configuración y suscripciones ─────────────────────────────────
app.get("/api/push/config", (req, res) => {
  res.json({ enabled: isPushConfigured(), publicKey: getVapidPublicKey() });
});

app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ message: "Suscripción inválida" });
    }
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             last_used_at = NOW()`,
      [req.userId, endpoint, p256dh, auth, userAgent]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/subscribe:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.post("/api/push/unsubscribe", authMiddleware, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: "Falta endpoint" });
    await pool.query(
      "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
      [endpoint, req.userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/unsubscribe:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});
```

- [ ] **Step 3: Verificar `config` (sin auth) y degradación**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && (node server/index.js &) ; sleep 4 ; \
curl -s localhost:8090/api/push/config ; echo ; \
pkill -f "node server/index.js"
```
Expected (sin VAPID en `.env` local): `{"enabled":false,"publicKey":null}`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(push): endpoints config/subscribe/unsubscribe"
```

---

### Task 4: Helpers de envío + wiring en eventos automáticos

**Files:**
- Modify: `server/index.js` (nuevos helpers cerca de `sendConfiguredWhatsAppTemplate` ~9230; wiring en los sitios de eventos)

**Interfaces:**
- Consumes: `buildPushPayload`, `shouldPruneSubscription`, `sendWebPush`, `isPushConfigured`, `pool`, `getSettingsValue`, `renderTemplateVars`, `DEFAULT_NOTIFICATION_TEMPLATES`.
- Produces:
  - `sendPushToUser(userId, { title, body, url?, tag?, respectPrefs? }): Promise<{sent,failed,pruned}>`
  - `sendConfiguredPushTemplate({ templateKey, userId, vars?, urlPath? }): Promise<{sent,...}>`

- [ ] **Step 1: Agregar los helpers de envío**

En `server/index.js`, inmediatamente después de la función `sendConfiguredWhatsAppTemplate` (~9243), agregar:
```js
// URL a abrir al tocar la notificación, por tipo de evento.
const PUSH_TEMPLATE_URLS = {
  booking_confirmed: "/app/bookings",
  booking_waitlist: "/app/bookings",
  booking_waitlist_promoted: "/app/bookings",
  booking_cancelled: "/app/bookings",
  class_reminder: "/app/bookings",
  membership_activated: "/app",
  renewal_reminder: "/app",
  last_class_reminder: "/app",
};

// Fan-out a todas las suscripciones de una alumna. Best-effort: poda muertas,
// nunca lanza (no debe romper reserva/pago/cron).
async function sendPushToUser(userId, { title, body, url = "/", tag, respectPrefs = true } = {}) {
  if (!isPushConfigured() || !userId) return { sent: 0, failed: 0, pruned: 0 };
  try {
    if (respectPrefs) {
      const pref = await pool.query("SELECT push_reminders FROM users WHERE id = $1", [userId]);
      if (pref.rows[0] && pref.rows[0].push_reminders === false) {
        return { sent: 0, failed: 0, pruned: 0, reason: "push_disabled" };
      }
    }
    const subs = await pool.query(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
      [userId]
    );
    if (!subs.rows.length) return { sent: 0, failed: 0, pruned: 0 };
    const payload = buildPushPayload({ title, body, url, tag });
    let sent = 0, failed = 0, pruned = 0;
    for (const row of subs.rows) {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await sendWebPush(subscription, payload);
        sent++;
        pool.query("UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1", [row.id]).catch(() => { });
      } catch (err) {
        if (shouldPruneSubscription(err)) {
          pruned++;
          pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]).catch(() => { });
        } else {
          failed++;
          console.error("[Push] send error:", err?.statusCode || err?.message);
        }
      }
    }
    return { sent, failed, pruned };
  } catch (e) {
    console.error("[sendPushToUser]", e.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}

// Versión que reutiliza las plantillas de notificación (subject→title, body→body).
async function sendConfiguredPushTemplate({ templateKey, userId, vars = {}, urlPath } = {}) {
  if (!isPushConfigured() || !userId) return { sent: 0 };
  const templates = await getSettingsValue("notification_templates", DEFAULT_NOTIFICATION_TEMPLATES);
  const tpl = templates?.[templateKey] || DEFAULT_NOTIFICATION_TEMPLATES[templateKey];
  if (!tpl) return { sent: 0 };
  const title = renderTemplateVars(tpl.subject || "Tu Espacio Pilates", vars).trim();
  // Quitar asteriscos de markdown de WhatsApp para texto plano de notificación.
  const body = renderTemplateVars(tpl.body || "", vars).replace(/\*/g, "").trim();
  const url = urlPath || PUSH_TEMPLATE_URLS[templateKey] || "/app";
  return sendPushToUser(userId, { title, body, url, tag: templateKey });
}
```

- [ ] **Step 2: Wiring — reserva confirmada / lista de espera (POST /api/bookings)**

En el sitio ~3709 (justo después del bloque `sendConfiguredWhatsAppTemplate({ templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed", ... })`), agregar:
```js
        sendConfiguredPushTemplate({
          templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed",
          userId: req.userId,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
        }).catch((e) => console.error("[Push] booking confirmed:", e.message));
```

- [ ] **Step 3: Wiring — reserva cancelada (POST cancel)**

En el sitio ~3907 (después del bloque `sendConfiguredWhatsAppTemplate({ templateKey: "booking_cancelled", ... })`), agregar:
```js
        sendConfiguredPushTemplate({
          templateKey: "booking_cancelled",
          userId: req.userId,
          vars: {
            name: u.display_name || "Alumna",
            class: booking.class_type_name || "tu clase",
            date: booking.date ? new Date(booking.date).toLocaleDateString("es-MX") : "",
            time: booking.start_time ? String(booking.start_time).slice(0, 5) : "",
            creditRestored: shouldRefund ? "Sí" : "No",
          },
        }).catch((e) => console.error("[Push] booking cancelled:", e.message));
```

- [ ] **Step 4: Wiring — promoción de lista de espera (`notifyWaitlistPromotion`)**

En `notifyWaitlistPromotion` (~9287), después del bloque `sendConfiguredWhatsAppTemplate({ templateKey: "booking_waitlist_promoted", ... })`, agregar (la función ya recibe `userId`):
```js
    sendConfiguredPushTemplate({
      templateKey: "booking_waitlist_promoted",
      userId,
      vars: { name, class: className, date: dateStr, time: timeStr },
    }).catch((e) => console.error("[Push] waitlist promoted:", e.message));
```

- [ ] **Step 5: Wiring — recordatorio de "última clase"/renovación (cron)**

En `runRenewalReminderCron` (~14512), después del bloque `sendConfiguredWhatsAppTemplate({ templateKey: "last_class_reminder", ... })`, agregar (usa `row.user_id`; ver Step 7 si el SELECT no lo trae):
```js
      sendConfiguredPushTemplate({
        templateKey: "last_class_reminder",
        userId: row.user_id,
        vars: { name: row.name, plan: row.plan_name, classesRemaining: row.classes_remaining ?? "" },
      }).catch((e) => console.error("[Push] last-class reminder:", e.message));
```

- [ ] **Step 6: Wiring — recordatorio de clase (cron)**

En `runClassReminderCron` (~14540), localizar el bloque `sendConfiguredWhatsAppTemplate({ templateKey: "class_reminder", ... })` y agregar inmediatamente después un `sendConfiguredPushTemplate` análogo, usando el `userId` de la fila del recordatorio (ver Step 7) y las mismas `vars` (`{ name, class, time }`) que usa el WhatsApp de ese bloque:
```js
        sendConfiguredPushTemplate({
          templateKey: "class_reminder",
          userId: row.user_id,
          vars: { name: row.name, class: row.class_type_name, time: classTimeStr },
        }).catch((e) => console.error("[Push] class reminder:", e.message));
```
(Usa los mismos identificadores de variable que ya existen en ese bloque para `name`, `class` y `time`; si difieren, ajústalos a los del bloque WhatsApp adyacente.)

- [ ] **Step 7: Asegurar `user_id` en los SELECT de los crons**

Verificar que los `SELECT` que alimentan `runRenewalReminderCron` y `runClassReminderCron` incluyan la columna de id del usuario y que la fila la exponga como `row.user_id`. Si el SELECT trae el id con otro alias (p.ej. `u.id AS user_id`), úsalo; si no incluye el id del usuario, agregar `u.id AS user_id` (o el join correspondiente) a la lista de columnas. Confirmar leyendo cada query antes de los pasos 5 y 6.

- [ ] **Step 8: Wiring — membresía activada**

Para cada sitio que llama `sendConfiguredWhatsAppTemplate({ templateKey: "membership_activated", ... })` (hay varios: ~4927, ~10474, ~10633, ~12337), agregar inmediatamente después un `sendConfiguredPushTemplate` con el id de la alumna en alcance en ese punto (p.ej. `membership.user_id`, `userId`, o `targetUserId` según el handler) y las mismas `vars` que el WhatsApp:
```js
        sendConfiguredPushTemplate({
          templateKey: "membership_activated",
          userId: /* id de la alumna en alcance: membership.user_id | userId | targetUserId */ membership.user_id,
          vars: { name: /* mismo name */ "", plan: /* mismo plan */ "", startDate: "", endDate: "" },
        }).catch((e) => console.error("[Push] membership activated:", e.message));
```
Copiar las `vars` exactas del bloque WhatsApp adyacente de cada sitio (no inventar claves). Si en algún sitio no hay un id de usuario claramente en alcance, omitir ese sitio y anotarlo.

- [ ] **Step 9: Verificar que el servidor arranca sin errores**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && node -e "require('child_process')" ; \
(node server/index.js &) ; sleep 4 ; curl -s localhost:8090/api/push/config ; echo ; pkill -f "node server/index.js"
```
Expected: arranca sin stack traces; `config` responde JSON. (El push no envía en local sin VAPID; el wiring degrada a no-op.)

- [ ] **Step 10: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(push): helpers de envío + wiring en eventos automáticos"
```

---

### Task 5: Service Worker — handlers `push` y `notificationclick`

**Files:**
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: payload JSON `{ title, body, url, tag }` (de `buildPushPayload`).
- Produces: notificación visible + foco/abrir ventana en `data.url`.

- [ ] **Step 1: Subir versión de caché y agregar handlers**

En `public/sw.js`:

1a. Cambiar la primera línea:
```js
const CACHE_NAME = "tep-v2";
```

1b. Al final del archivo, agregar:
```js
// ─── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Tu Espacio Pilates";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => { });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
```

- [ ] **Step 2: Verificar sintaxis del SW**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && node --check public/sw.js && echo "sw.js OK"
```
Expected: `sw.js OK`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add public/sw.js
git commit -m "feat(push): handlers push/notificationclick en el service worker"
```

---

### Task 6: Frontend — hook, toggle e InstallAppPrompt

**Files:**
- Create: `src/hooks/usePushNotifications.ts`
- Create: `src/components/InstallAppPrompt.tsx`
- Modify: `src/pages/client/ProfilePreferences.tsx`

**Interfaces:**
- Consumes: `GET /api/push/config`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `api` (axios).
- Produces:
  - `usePushNotifications()` → `{ status, isBusy, enable(): Promise<void>, disable(): Promise<void> }` con `status: "loading" | "unsupported" | "needs-install-ios" | "denied" | "inactive" | "active"`.
  - `<InstallAppPrompt />` (componente visual).

- [ ] **Step 1: Crear el hook `usePushNotifications`**

Create `src/hooks/usePushNotifications.ts`:
```ts
import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

type PushStatus =
  | "loading"
  | "unsupported"
  | "needs-install-ios"
  | "denied"
  | "inactive"
  | "active";

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus(isIOS() && !isStandalone() ? "needs-install-ios" : "unsupported");
      return;
    }
    try {
      const cfg = (await api.get("/push/config")).data;
      if (!cfg?.enabled || !cfg?.publicKey) {
        setStatus("unsupported");
        return;
      }
      setPublicKey(cfg.publicKey);
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "active" : "inactive");
    } catch {
      setStatus("unsupported");
    }
  }, [supported]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported || !publicKey) return;
    setIsBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "inactive");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.post("/push/subscribe", sub.toJSON());
      setStatus("active");
    } catch {
      setStatus("inactive");
    } finally {
      setIsBusy(false);
    }
  }, [supported, publicKey]);

  const disable = useCallback(async () => {
    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => { });
        await sub.unsubscribe().catch(() => { });
      }
      setStatus("inactive");
    } finally {
      setIsBusy(false);
    }
  }, []);

  return { status, isBusy, enable, disable };
}
```

- [ ] **Step 2: Crear `InstallAppPrompt`**

Create `src/components/InstallAppPrompt.tsx`:
```tsx
import { Share, PlusSquare } from "lucide-react";

const InstallAppPrompt = () => (
  <div className="rounded-xl border border-[#8C6B6F]/15 bg-[#FBF6F4] p-4 space-y-2">
    <p className="text-sm font-medium">Activa las notificaciones en tu iPhone</p>
    <p className="text-xs text-muted-foreground">
      En iPhone, las notificaciones solo funcionan si agregas la app a tu pantalla de inicio:
    </p>
    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
      <li className="flex items-center gap-1">
        Toca <Share size={14} className="inline" /> (Compartir) en la barra de Safari
      </li>
      <li className="flex items-center gap-1">
        Elige <PlusSquare size={14} className="inline" /> “Agregar a inicio”
      </li>
      <li>Abre la app desde el ícono y vuelve aquí para activarlas</li>
    </ol>
  </div>
);

export default InstallAppPrompt;
```

- [ ] **Step 3: Integrar el toggle de push en `ProfilePreferences.tsx`**

3a. Agregar imports al inicio de `src/pages/client/ProfilePreferences.tsx`:
```tsx
import { usePushNotifications } from "@/hooks/usePushNotifications";
import InstallAppPrompt from "@/components/InstallAppPrompt";
```

3b. Dentro del componente, antes del `return`, obtener el hook:
```tsx
  const push = usePushNotifications();
```

3c. Justo después del `<div className="space-y-4">` que contiene los `items.map(...)` (es decir, después de su `</div>` de cierre, en la línea ~65), insertar el bloque de push:
```tsx
          <div className="rounded-xl border border-[#8C6B6F]/15 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Notificaciones en este dispositivo</Label>
                <p className="text-xs text-muted-foreground">
                  Recibe avisos aunque no tengas la app abierta.
                </p>
              </div>
              {(push.status === "active" || push.status === "inactive") && (
                <Switch
                  checked={push.status === "active"}
                  disabled={push.isBusy}
                  onCheckedChange={(v) => (v ? push.enable() : push.disable())}
                />
              )}
            </div>
            {push.status === "needs-install-ios" && <InstallAppPrompt />}
            {push.status === "denied" && (
              <p className="text-xs text-muted-foreground">
                Bloqueaste las notificaciones. Actívalas desde los ajustes de tu navegador para este sitio.
              </p>
            )}
            {push.status === "unsupported" && (
              <p className="text-xs text-muted-foreground">
                Este dispositivo o navegador no permite notificaciones.
              </p>
            )}
          </div>
```

- [ ] **Step 4: Verificar build de TypeScript**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && npm run build
```
Expected: build exitoso (0 errores de tipos).

- [ ] **Step 5: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add src/hooks/usePushNotifications.ts src/components/InstallAppPrompt.tsx src/pages/client/ProfilePreferences.tsx
git commit -m "feat(push): hook usePushNotifications + toggle + InstallAppPrompt"
```

---

### Task 7: Avisos del admin (broadcast) — backend + UI

**Files:**
- Modify: `server/index.js` (2 endpoints admin, junto a otras rutas `/api/admin`)
- Modify: `src/pages/admin/settings/SettingsPage.tsx` (nuevo tab "Avisos")

**Interfaces:**
- Consumes: `adminMiddleware`, `pool`, `sendPushToUser`, `isPushConfigured`.
- Produces:
  - `GET /api/admin/push/stats` → `{ subscribers: number, devices: number }`
  - `POST /api/admin/push/broadcast` → `{ sent, failed, pruned, recipients }`

- [ ] **Step 1: Endpoints de stats y broadcast (backend)**

En `server/index.js`, junto a otras rutas `/api/admin`, agregar:
```js
// ─── Web Push: avisos del admin ──────────────────────────────────────────────
app.get("/api/admin/push/stats", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(DISTINCT user_id)::int AS subscribers, COUNT(*)::int AS devices FROM push_subscriptions"
    );
    return res.json({
      enabled: isPushConfigured(),
      subscribers: r.rows[0]?.subscribers ?? 0,
      devices: r.rows[0]?.devices ?? 0,
    });
  } catch (err) {
    console.error("GET /api/admin/push/stats:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.post("/api/admin/push/broadcast", adminMiddleware, async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(400).json({ message: "Push no configurado" });
    const { title, body, url, segment } = req.body || {};
    if (!title || !body) return res.status(400).json({ message: "Falta título o mensaje" });
    const seg = segment === "active_membership" ? "active_membership" : "all";
    let userQuery;
    if (seg === "active_membership") {
      userQuery = `
        SELECT DISTINCT ps.user_id
          FROM push_subscriptions ps
         WHERE EXISTS (
           SELECT 1 FROM memberships m
            WHERE m.user_id = ps.user_id
              AND m.status = 'active'
              AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
         )`;
    } else {
      userQuery = "SELECT DISTINCT user_id FROM push_subscriptions";
    }
    const users = await pool.query(userQuery);
    let sent = 0, failed = 0, pruned = 0;
    for (const row of users.rows) {
      const r = await sendPushToUser(row.user_id, {
        title: String(title).slice(0, 80),
        body: String(body).slice(0, 240),
        url: url || "/app",
        tag: "admin_broadcast",
        respectPrefs: true,
      });
      sent += r.sent; failed += r.failed; pruned += r.pruned;
    }
    return res.json({ recipients: users.rows.length, sent, failed, pruned });
  } catch (err) {
    console.error("POST /api/admin/push/broadcast:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});
```
(Verificar que `memberships` tenga columnas `status` y `end_date`; si el nombre difiere en este repo, ajustar el `EXISTS`. Confirmar con `\d memberships` antes de implementar.)

- [ ] **Step 2: Verificar `stats` (con auth de admin)**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && (node server/index.js &) ; sleep 4 ; \
TOKEN=$(curl -s -X POST localhost:8090/api/auth/login -H "Content-Type: application/json" \
  -d "{\"identifier\":\"espaciopilatesvm@gmail.com\",\"password\":\"$(grep ADMIN_PASSWORD .env | cut -d= -f2-)\"}" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})") ; \
curl -s localhost:8090/api/admin/push/stats -H "Authorization: Bearer $TOKEN" ; echo ; \
pkill -f "node server/index.js"
```
Expected: `{"enabled":false,"subscribers":0,"devices":0}` (sin VAPID/suscripciones en local). Si el login usa otro campo que `identifier`, ajustar el body al que use `/api/auth/login`.

- [ ] **Step 3: Tab "Avisos" en SettingsPage (UI)**

3a. En `src/pages/admin/settings/SettingsPage.tsx`, agregar el trigger del tab. Después de:
```tsx
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
```
agregar:
```tsx
            <TabsTrigger value="avisos">Avisos</TabsTrigger>
```

3b. Después del `</TabsContent>` del tab `whatsapp`, agregar:
```tsx
          <TabsContent value="avisos">
            <PushBroadcastSection />
          </TabsContent>
```

3c. Antes del componente principal de la página (al nivel de `SettingsSection`), agregar el componente:
```tsx
const PushBroadcastSection = () => {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [segment, setSegment] = useState<"all" | "active_membership">("all");

  const { data: stats } = useQuery({
    queryKey: ["push-stats"],
    queryFn: async () => (await api.get("/admin/push/stats")).data,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/admin/push/broadcast", { title, body: message, url: url || undefined, segment }),
    onSuccess: (res) => {
      const d = res.data || {};
      toast({ title: "Aviso enviado", description: `Entregado a ${d.sent} dispositivo(s) de ${d.recipients} alumna(s).` });
      setTitle(""); setMessage(""); setUrl("");
    },
    onError: (e: any) =>
      toast({ title: "No se pudo enviar", description: e?.response?.data?.message || "Error", variant: "destructive" }),
  });

  if (stats && stats.enabled === false) {
    return <p className="text-sm text-muted-foreground">Las notificaciones push no están configuradas en el servidor (falta VAPID).</p>;
  }

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-muted-foreground">
        {stats ? `${stats.subscribers} alumna(s) suscrita(s) · ${stats.devices} dispositivo(s)` : "Cargando…"}
      </p>
      <div className="space-y-1">
        <Label>Título</Label>
        <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Clases especiales este sábado" />
      </div>
      <div className="space-y-1">
        <Label>Mensaje</Label>
        <Textarea rows={4} value={message} maxLength={240} onChange={(e) => setMessage(e.target.value)} placeholder="Escribe el aviso…" />
      </div>
      <div className="space-y-1">
        <Label>Enlace al tocar (opcional)</Label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/app/classes" />
      </div>
      <div className="space-y-1">
        <Label>Destinatarias</Label>
        <select className="w-full border rounded-md h-10 px-3 text-sm" value={segment} onChange={(e) => setSegment(e.target.value as any)}>
          <option value="all">Todas las suscritas</option>
          <option value="active_membership">Solo con membresía activa</option>
        </select>
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !title || !message}
        className="bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] text-white"
      >
        {mutation.isPending ? "Enviando…" : "Enviar aviso"}
      </Button>
    </div>
  );
};
```
(`useState`, `useQuery`, `useMutation`, `api`, `Button`, `Input`, `Label`, `Textarea`, `useToast` ya están importados en este archivo.)

- [ ] **Step 4: Verificar build**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && npm run build
```
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js src/pages/admin/settings/SettingsPage.tsx
git commit -m "feat(push): avisos del admin (stats + broadcast) + UI"
```

---

### Task 8: Privacidad + verificación end-to-end

**Files:**
- Modify: `src/pages/legal/Privacidad.tsx`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: copia legal actualizada + verificación manual.

- [ ] **Step 1: Mencionar push en Privacidad**

En `src/pages/legal/Privacidad.tsx`, agregar una frase en la sección de comunicaciones/datos indicando que, si la alumna lo activa, se usan notificaciones push para avisos operativos (recordatorios, reservas, anuncios) y que puede desactivarlas desde sus preferencias o los ajustes del navegador. Mantener el tono y formato existentes del archivo (leerlo antes para encajar el copy en la estructura actual).

- [ ] **Step 2: Correr toda la suite de tests**

Run:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && npm test
```
Expected: PASS, incluida `push.test.js`, sin regresiones.

- [ ] **Step 3: Verificación manual (requiere VAPID local)**

Generar llaves y ponerlas en `.env` local:
```bash
cd "/Users/saidromero/Tu Espacio Pilates" && npx web-push generate-vapid-keys
```
Agregar a `.env`:
```
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=mailto:espaciopilatesvm@gmail.com
```
Luego, en Chrome de escritorio (no Safari):
1. `npm run dev` + backend en `:8090`; entrar como alumna.
2. Perfil → Preferencias → activar "Notificaciones en este dispositivo" (aceptar permiso).
3. Como admin: Configuración → Avisos → enviar un aviso.
4. **Cerrar la pestaña de la alumna** y verificar que la notificación llega igual; al hacer click abre la app en la URL indicada.
5. Confirmar degradación: quitar las VAPID del `.env`, reiniciar, y verificar que `/api/push/config` da `enabled:false` y el toggle se oculta.

- [ ] **Step 4: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add src/pages/legal/Privacidad.tsx
git commit -m "docs(push): mención de notificaciones push en Privacidad"
```

- [ ] **Step 5: Nota de go-live (Railway)**

Para producción, configurar en el servicio `web` de Railway las variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (las mismas llaves generadas). Sin ellas, el push queda apagado en prod (degradación limpia). No requiere cambios de código adicionales.

---

## Self-Review

**Spec coverage:**
- Llaves VAPID + `web-push` → Task 1, Task 8 Step 5. ✓
- Tabla `push_subscriptions` + `users.push_reminders` → Task 2. ✓
- Endpoints config/subscribe/unsubscribe → Task 3. ✓
- Helper de envío + poda + reuso de plantillas → Task 4 (Steps 1). ✓
- Wiring en los 8 eventos automáticos → Task 4 (Steps 2-8). ✓
- Service worker push/notificationclick → Task 5. ✓
- Hook + toggle en ProfilePreferences + InstallAppPrompt (iPhone) → Task 6. ✓
- Avisos admin (stats + broadcast + UI) → Task 7. ✓
- Errores/degradación → Task 1 (`isPushConfigured`), Task 3 Step 3, Task 8 Step 3.5. ✓
- Seguridad (auth en subscribe/unsubscribe, admin en broadcast) → Tasks 3 y 7. ✓
- Privacidad → Task 8 Step 1. ✓
- Pruebas (unit de lógica pura + manual) → Task 1, Task 8. ✓
- Fuera de alcance (sin media/botones, segmentación simple, español) → respetado.

**Placeholder scan:** Los Steps 6, 7 (Step 1 nota) y 8 de Task 4 piden confirmar nombres de variable/columna leyendo el código adyacente; es verificación deliberada (los identificadores reales dependen de cada SELECT/handler), no un TODO de implementación. El resto lleva código completo.

**Type/nombre consistency:** `sendPushToUser` y `sendConfiguredPushTemplate` se definen en Task 4 y se consumen en Task 7. `usePushNotifications` devuelve `{ status, isBusy, enable, disable }`, consumido igual en Task 6. `GET /api/push/config` devuelve `{ enabled, publicKey }`, consumido en el hook. El payload `{ title, body, url, tag }` de `buildPushPayload` (Task 1) lo parsea el SW (Task 5). Consistente.
