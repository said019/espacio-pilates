# Pagos con tarjeta (MercadoPago Checkout Pro) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar pago con tarjeta vía MercadoPago Checkout Pro al checkout de Tu Espacio Pilates; la membresía se activa solo por webhook server-to-server.

**Architecture:** Backend Express de un solo archivo (`server/index.js`, ESM) + nuevo módulo `server/lib/mercadopago.js`. La orden se crea con `payment_method='card'`, se genera una preferencia de MP, el cliente paga en MP y un webhook idempotente activa la membresía replicando la lógica de la ruta admin `verify`. Frontend React/Vite/TS: nuevo método "Tarjeta" en `Checkout.tsx` que redirige a MP, y `MyOrders.tsx` maneja el retorno (banner + polling + reintento).

**Tech Stack:** Node 25 (ESM, `fetch` global), Express, PostgreSQL (`pg`), React 18, Vite, TypeScript, TanStack Query, Vitest.

## Global Constraints

- Backend es **ESM** (`"type":"module"`): nuevos módulos usan `import`/`export`, extensión `.js` en imports relativos.
- Precio con tarjeta = **precio base del plan, sin recargo** (la tarjeta NO recibe el descuento efectivo/transferencia; los códigos de descuento sí aplican). Esto ya ocurre porque `isCashOrTransfer` es falso para `card`.
- Cobro **de contado**: `payment_methods: { installments: 1 }`.
- **La membresía se activa SOLO por el webhook / sync manual. El frontend nunca cambia estados.**
- Migraciones DB: idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`), dentro de `ensureSchema()`.
- UUID por defecto en tablas nuevas: `uuid_generate_v4()` (consistencia con el schema).
- `statement_descriptor: 'ESPACIO PILATES'`, `currency_id: 'MXN'`.
- Webhook montado en `/webhooks/mercadopago` (**fuera de `/api`**), antes del catch-all `app.get("*")`.
- Secretos (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) solo por variables de entorno; nunca en git.
- `main` auto-despliega a Railway: trabajar en la rama `feat/mercadopago-card-payments`, no pushear a `main` hasta validar.
- Commits en español, con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `server/lib/mercadopago.js` | **Nuevo.** Cliente MP puro+fetch: builders de preferencia/firma, `createPreference`, `syncPayment`, `verifyWebhookSignature`. |
| `server/lib/__tests__/mercadopago.test.js` | **Nuevo.** Unit tests de los builders, parsers y verificación de firma. |
| `server/index.js` | **Modificar.** Migración en `ensureSchema`; `POST /api/orders` (rama card); `POST /api/orders/:id/pay-with-card`; `GET /api/payments/config`; `POST /webhooks/mercadopago` + `handlePaymentWebhook` + `approveOrderFromMP`; `POST /api/admin/orders/:id/sync-mp`. |
| `.env.example` | **Modificar.** 4 variables MP. |
| `src/types/order.ts` | **Modificar.** Campos MP + `card` en request. |
| `src/pages/client/Checkout.tsx` | **Modificar.** Método "Tarjeta" + redirección + query de config. |
| `src/pages/client/MyOrders.tsx` | **Modificar.** Banner de retorno, polling, botón reintentar. |

---

## Task 1: Cliente MercadoPago (`server/lib/mercadopago.js`) + tests

**Files:**
- Create: `server/lib/mercadopago.js`
- Test: `server/lib/__tests__/mercadopago.test.js`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `buildPreferenceBody({ orderId, orderNumber, planName, amount, userEmail }, { backendUrl, frontendUrl }) → object`
  - `createPreference({ orderId, orderNumber, planName, amount, userEmail }) → Promise<{ preference_id, checkout_url, sandbox_checkout_url }>`
  - `syncPayment(mpPaymentId) → Promise<{ status, status_detail, external_reference, transaction_amount, payer_email }>`
  - `parseSignatureHeader(header) → { ts?, v1? }`
  - `buildSignatureManifest({ dataId, requestId, ts }) → string`
  - `verifyWebhookSignature({ signatureHeader, requestId, dataId, secret }) → boolean`

- [ ] **Step 1: Escribir el test (falla)**

Crear `server/lib/__tests__/mercadopago.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildPreferenceBody,
  createPreference,
  syncPayment,
  parseSignatureHeader,
  buildSignatureManifest,
  verifyWebhookSignature,
} from "../mercadopago.js";
import crypto from "crypto";

describe("buildPreferenceBody", () => {
  const params = { orderId: "ord-1", orderNumber: "ORD-001000", planName: "9 clases", amount: 1050, userEmail: "a@b.com" };
  const urls = { backendUrl: "https://api.test", frontendUrl: "https://app.test" };

  it("arma item con precio, MXN y external_reference", () => {
    const body = buildPreferenceBody(params, urls);
    expect(body.items[0].unit_price).toBe(1050);
    expect(body.items[0].currency_id).toBe("MXN");
    expect(body.external_reference).toBe("ord-1");
  });

  it("cobra de contado (installments 1)", () => {
    expect(buildPreferenceBody(params, urls).payment_methods.installments).toBe(1);
  });

  it("back_urls apuntan al frontend con order id; notification_url al backend", () => {
    const body = buildPreferenceBody(params, urls);
    expect(body.back_urls.success).toBe("https://app.test/app/orders?checkout=success&order=ord-1");
    expect(body.notification_url).toBe("https://api.test/webhooks/mercadopago");
    expect(body.auto_return).toBe("approved");
  });
});

describe("createPreference", () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-test";
    process.env.BACKEND_URL = "https://api.test/";
    process.env.FRONTEND_URL = "https://app.test/";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mapea init_point/sandbox_init_point/id de la respuesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "pref-9", init_point: "https://mp/checkout", sandbox_init_point: "https://mp/sandbox" }),
    })));
    const r = await createPreference({ orderId: "ord-1", orderNumber: "ORD-1", planName: "P", amount: 100, userEmail: "a@b.com" });
    expect(r).toEqual({ preference_id: "pref-9", checkout_url: "https://mp/checkout", sandbox_checkout_url: "https://mp/sandbox" });
  });

  it("lanza error si la respuesta no es ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, text: async () => "bad" })));
    await expect(createPreference({ orderId: "x", orderNumber: "x", planName: "P", amount: 1, userEmail: "" }))
      .rejects.toThrow(/MercadoPago preference error: 400/);
  });

  it("lanza si falta MP_ACCESS_TOKEN", async () => {
    process.env.MP_ACCESS_TOKEN = "";
    await expect(createPreference({ orderId: "x", orderNumber: "x", planName: "P", amount: 1, userEmail: "" }))
      .rejects.toThrow(/MP_ACCESS_TOKEN/);
  });
});

describe("syncPayment", () => {
  beforeEach(() => { process.env.MP_ACCESS_TOKEN = "APP_USR-test"; });
  afterEach(() => vi.unstubAllGlobals());

  it("extrae status, external_reference y payer_email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "approved", status_detail: "accredited", external_reference: "ord-1", transaction_amount: 1050, payer: { email: "a@b.com" } }),
    })));
    const r = await syncPayment("pay-1");
    expect(r.status).toBe("approved");
    expect(r.external_reference).toBe("ord-1");
    expect(r.payer_email).toBe("a@b.com");
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "s3cr3t";
  const dataId = "pay-1";
  const requestId = "req-1";
  const ts = "1700000000";
  const goodV1 = crypto.createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");

  it("manifest tiene el formato exacto de MP", () => {
    expect(buildSignatureManifest({ dataId, requestId, ts })).toBe("id:pay-1;request-id:req-1;ts:1700000000;");
  });

  it("parsea ts y v1 del header", () => {
    expect(parseSignatureHeader(`ts=${ts}, v1=${goodV1}`)).toEqual({ ts, v1: goodV1 });
  });

  it("acepta firma válida", () => {
    expect(verifyWebhookSignature({ signatureHeader: `ts=${ts},v1=${goodV1}`, requestId, dataId, secret })).toBe(true);
  });

  it("rechaza firma inválida", () => {
    expect(verifyWebhookSignature({ signatureHeader: `ts=${ts},v1=deadbeef`, requestId, dataId, secret })).toBe(false);
  });

  it("sin secret configurado, omite verificación (legacy → true)", () => {
    expect(verifyWebhookSignature({ signatureHeader: "", requestId, dataId, secret: "" })).toBe(true);
  });

  it("con secret pero sin header, rechaza", () => {
    expect(verifyWebhookSignature({ signatureHeader: "", requestId, dataId, secret })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npx vitest run server/lib/__tests__/mercadopago.test.js`
Expected: FAIL — `Failed to resolve import "../mercadopago.js"`.

- [ ] **Step 3: Implementar `server/lib/mercadopago.js`**

```javascript
// Cliente de MercadoPago (Checkout Pro). Sin SDK — fetch contra la API REST.
import crypto from "crypto";

const MP_API = "https://api.mercadopago.com";

function stripTrailingSlash(u) {
  return String(u || "").replace(/\/+$/, "");
}

// ── Body de la preferencia (puro, testeable sin red) ──
export function buildPreferenceBody({ orderId, orderNumber, planName, amount, userEmail }, { backendUrl, frontendUrl }) {
  return {
    items: [{
      id: orderId,
      title: planName,
      description: `Tu Espacio Pilates — ${planName}`,
      quantity: 1,
      currency_id: "MXN",
      unit_price: Number(amount),
    }],
    payer: { email: userEmail || undefined },
    external_reference: orderId,
    back_urls: {
      success: `${frontendUrl}/app/orders?checkout=success&order=${orderId}`,
      failure: `${frontendUrl}/app/orders?checkout=failure&order=${orderId}`,
      pending: `${frontendUrl}/app/orders?checkout=pending&order=${orderId}`,
    },
    auto_return: "approved",
    notification_url: `${backendUrl}/webhooks/mercadopago`,
    statement_descriptor: "ESPACIO PILATES",
    metadata: { order_id: orderId, order_number: orderNumber },
    payment_methods: { installments: 1 },
  };
}

// ── Crear preferencia de Checkout Pro ──
export async function createPreference(params) {
  const accessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no configurado");
  const backendUrl = stripTrailingSlash(process.env.BACKEND_URL);
  const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL);
  const body = buildPreferenceBody(params, { backendUrl, frontendUrl });

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `order-${params.orderId}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MercadoPago preference error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    preference_id: data.id,
    checkout_url: data.init_point,
    sandbox_checkout_url: data.sandbox_init_point,
  };
}

// ── Consultar estado real de un pago ──
export async function syncPayment(mpPaymentId) {
  const accessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no configurado");
  const res = await fetch(`${MP_API}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MercadoPago sync error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    status: data.status,
    status_detail: data.status_detail,
    external_reference: data.external_reference,
    transaction_amount: data.transaction_amount,
    payer_email: data.payer?.email || "",
  };
}

// ── Verificación de firma del webhook ──
export function parseSignatureHeader(header) {
  const parts = {};
  String(header || "").split(",").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) parts[k] = v;
  });
  return parts;
}

export function buildSignatureManifest({ dataId, requestId, ts }) {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

export function verifyWebhookSignature({ signatureHeader, requestId, dataId, secret }) {
  if (!secret) return true; // legacy: sin secret se omite
  if (!signatureHeader) return false;
  const { ts, v1 } = parseSignatureHeader(signatureHeader);
  if (!ts || !v1) return false;
  const manifest = buildSignatureManifest({ dataId, requestId, ts });
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npx vitest run server/lib/__tests__/mercadopago.test.js`
Expected: PASS (todos los `describe`).

- [ ] **Step 5: Agregar variables a `.env.example`**

Añadir al final de `.env.example`:

```bash
# ============================================================
# MercadoPago (Checkout Pro) — pagos con tarjeta
# ============================================================
# Access Token de PRODUCCIÓN (APP_USR-...). Si se deja vacío, la opción
# "Tarjeta" se oculta en el checkout y no se generan preferencias.
MP_ACCESS_TOKEN=
# Clave secreta del webhook (panel MP → Webhooks). Si se deja vacía, se omite
# la verificación de firma (NO recomendado en producción).
MP_WEBHOOK_SECRET=
# URL pública del backend (para notification_url del webhook).
BACKEND_URL=https://web-production-b1a1d.up.railway.app
# URL pública del frontend (para back_urls de retorno).
FRONTEND_URL=https://frontend-production-dcb15.up.railway.app
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/lib/mercadopago.js server/lib/__tests__/mercadopago.test.js .env.example
git commit -m "feat(pagos): cliente MercadoPago (preferencia, sync, firma webhook) + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migración DB — columnas MP en `orders` + tabla `payment_webhook_events`

**Files:**
- Modify: `server/index.js` (dentro de `ensureSchema()`, junto a los otros `CREATE TABLE IF NOT EXISTS`, p. ej. después del bloque de `events`/`event_passes` ~línea 1634)

**Interfaces:**
- Produces: columnas `orders.payment_provider, payment_intent_id, mp_checkout_url, mp_payment_id, mp_payment_status, mp_status_detail, provider_synced_at`; tabla `payment_webhook_events`.

- [ ] **Step 1: Agregar el bloque de migración**

Dentro de `ensureSchema()`, agregar (después de cualquier `await pool.query(\`CREATE TABLE IF NOT EXISTS event_passes ...\`)` o el último bloque de tablas embebidas):

```javascript
    // ── MercadoPago: columnas de pago en orders + idempotencia de webhooks ──
    await pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS payment_provider   VARCHAR(50),
        ADD COLUMN IF NOT EXISTS payment_intent_id  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mp_checkout_url    TEXT,
        ADD COLUMN IF NOT EXISTS mp_payment_id      VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mp_payment_status  VARCHAR(50),
        ADD COLUMN IF NOT EXISTS mp_status_detail   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS provider_synced_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider     VARCHAR(50) NOT NULL,
        event_key    VARCHAR(255) NOT NULL,
        event_type   VARCHAR(50),
        payload      JSONB DEFAULT '{}'::jsonb,
        processed_at TIMESTAMP WITH TIME ZONE,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (provider, event_key)
      );
    `);
    console.log("✅ MercadoPago: columnas orders + payment_webhook_events listas");
```

- [ ] **Step 2: Arrancar el server y verificar que el schema aplica sin error**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && PORT=8090 node server/index.js`
Expected: el log incluye `✅ MercadoPago: columnas orders + payment_webhook_events listas` y el server queda escuchando (sin excepción). Detener con Ctrl-C.

> Requiere una Postgres local accesible vía `DATABASE_URL` (la del proyecto, DB `tep_vm`). Si no hay DB local, validar en el deploy de Railway tras el push.

- [ ] **Step 3: Verificar columnas en la DB (si hay psql local)**

Run: `psql "$DATABASE_URL" -c "\d orders" | grep -E "mp_|payment_provider|payment_intent_id|provider_synced_at"`
Expected: aparecen las 7 columnas nuevas.
Run: `psql "$DATABASE_URL" -c "\d payment_webhook_events"`
Expected: la tabla existe con la restricción `UNIQUE (provider, event_key)`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(pagos): migración MP — columnas en orders + tabla payment_webhook_events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Crear orden con tarjeta + `pay-with-card` + `payments/config`

**Files:**
- Modify: `server/index.js` — `POST /api/orders` (~línea 4226, justo después de `await client.query("COMMIT")` y el armado de `order`); agregar rutas nuevas tras `POST /api/orders/:id/proof` (~línea 4243+).

**Interfaces:**
- Consumes: `createPreference` de `server/lib/mercadopago.js`.
- Produces: respuesta de `POST /api/orders` incluye `mp_checkout_url` para tarjeta; `POST /api/orders/:id/pay-with-card → { data: { mp_checkout_url } }`; `GET /api/payments/config → { data: { cardEnabled } }`.

- [ ] **Step 1: Importar el cliente MP**

En el bloque de imports de `server/lib/...` arriba de `server/index.js` (después de `import { endOfPurchaseMonth, canCancel, canReschedule } from "./lib/bookingPolicy.js";`):

```javascript
import { createPreference, syncPayment, verifyWebhookSignature } from "./lib/mercadopago.js";
```

- [ ] **Step 2: Generar la preferencia en `POST /api/orders` para tarjeta**

En `POST /api/orders`, reemplazar el bloque final que arma y devuelve la respuesta:

```javascript
    await client.query("COMMIT");

    const order = orderRes.rows[0];
    return res.status(201).json({
      data: {
        ...order,
        plan_name: plan.name,
        bank_details: { ...bankInfo, amount: total, currency: "MXN" },
      }
    });
```

por:

```javascript
    await client.query("COMMIT");

    const order = orderRes.rows[0];

    // ── Tarjeta: generar checkout de MercadoPago (fuera de la transacción) ──
    let mp_checkout_url = null;
    if (paymentMethod === "card") {
      try {
        const u = await pool.query("SELECT email FROM users WHERE id = $1", [req.userId]);
        const pref = await createPreference({
          orderId: order.id,
          orderNumber: order.order_number,
          planName: plan.name,
          amount: Number(order.total_amount),
          userEmail: u.rows[0]?.email || "",
        });
        mp_checkout_url = pref.checkout_url;
        await pool.query(
          `UPDATE orders SET payment_provider = 'mercadopago',
                             payment_intent_id = $1, mp_checkout_url = $2, updated_at = NOW()
             WHERE id = $3`,
          [pref.preference_id, pref.checkout_url, order.id]
        );
      } catch (mpErr) {
        console.error("MercadoPago preference error:", mpErr.message);
        // La orden ya existe (pending_payment); el cliente reintenta con pay-with-card.
      }
    }

    return res.status(201).json({
      data: {
        ...order,
        plan_name: plan.name,
        mp_checkout_url,
        bank_details: { ...bankInfo, amount: total, currency: "MXN" },
      }
    });
```

- [ ] **Step 3: Agregar `pay-with-card` y `payments/config`**

Inmediatamente después de la ruta `POST /api/orders/:id/proof` (su `});` de cierre, ~línea 4243+ tras Step 2), agregar:

```javascript
// POST /api/orders/:id/pay-with-card — generar/reutilizar checkout de MP para una orden pendiente
app.post("/api/orders/:id/pay-with-card", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, p.name AS plan_name, u.email AS user_email
         FROM orders o
         JOIN plans p ON o.plan_id = p.id
         JOIN users u ON o.user_id = u.id
        WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    const order = r.rows[0];
    if (order.status !== "pending_payment") {
      return res.status(400).json({ message: "Esta orden ya no acepta pagos" });
    }
    if (order.mp_checkout_url) {
      return res.json({ data: { mp_checkout_url: order.mp_checkout_url } });
    }
    const pref = await createPreference({
      orderId: order.id,
      orderNumber: order.order_number,
      planName: order.plan_name,
      amount: Number(order.total_amount),
      userEmail: order.user_email || "",
    });
    await pool.query(
      `UPDATE orders SET payment_method = 'card'::payment_method,
                         payment_provider = 'mercadopago',
                         payment_intent_id = $1, mp_checkout_url = $2, updated_at = NOW()
         WHERE id = $3`,
      [pref.preference_id, pref.checkout_url, order.id]
    );
    return res.json({ data: { mp_checkout_url: pref.checkout_url } });
  } catch (err) {
    console.error("pay-with-card error:", err.message);
    return res.status(500).json({ message: "No se pudo generar el checkout" });
  }
});

// GET /api/payments/config — el frontend decide si muestra "Tarjeta"
app.get("/api/payments/config", (req, res) => {
  return res.json({ data: { cardEnabled: Boolean(process.env.MP_ACCESS_TOKEN) } });
});
```

- [ ] **Step 4: Verificar que el server arranca y `payments/config` responde**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && PORT=8090 node server/index.js &` (esperar arranque) luego
`curl -s http://localhost:8090/api/payments/config`
Expected: `{"data":{"cardEnabled":false}}` (sin `MP_ACCESS_TOKEN`) o `true` si está seteado. Detener el server.

> Sin DB local, al menos verificar que `node -c` no aplica (es ESM); usar `node --check server/index.js` para validar sintaxis: Expected sin salida (OK).

- [ ] **Step 5: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(pagos): crear orden con tarjeta + pay-with-card + payments/config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Webhook de MercadoPago + activación de membresía + sync admin

**Files:**
- Modify: `server/index.js` — agregar webhook + helpers tras las rutas de órdenes (después de `payments/config` del Task 3); agregar `POST /api/admin/orders/:id/sync-mp` tras `PUT /api/admin/orders/:id/reject` (~línea 11800).

**Interfaces:**
- Consumes: `syncPayment`, `verifyWebhookSignature` (Task 1); helpers existentes `calcMembershipEndDate`, `findNonRepeatablePlanConflict`, `incrementDiscountUsage`, `sendMembershipActivated`, `sendConfiguredWhatsAppTemplate`, `areEmailNotificationsEnabled`, `triggerWalletPassSync`.
- Produces: ruta `POST /webhooks/mercadopago`; funciones `handlePaymentWebhook(mpPaymentId)` y `approveOrderFromMP(orderId, mpPaymentId)`; ruta `POST /api/admin/orders/:id/sync-mp`.

- [ ] **Step 1: Agregar el webhook y los helpers de activación**

Después de `GET /api/payments/config` (Task 3), agregar:

```javascript
// POST /webhooks/mercadopago — fuente de verdad de los pagos con tarjeta (server-to-server)
// OJO: fuera de /api, debe coincidir con notification_url. El catch-all app.get("*") es GET, no lo intercepta.
app.post("/webhooks/mercadopago", express.json({ limit: "1mb" }), async (req, res) => {
  // 1) Responder 200 de inmediato (MP reintenta si tardamos)
  res.status(200).end();

  try {
    const body = req.body || {};
    const type = body.type || body.topic || null;
    const action = body.action || "";
    const mpPaymentId = (body.data?.id || req.query["data.id"] || req.query.id || "").toString();
    if (!mpPaymentId) return;

    // 2) Verificar firma
    const ok = verifyWebhookSignature({
      signatureHeader: req.headers["x-signature"] || "",
      requestId: req.headers["x-request-id"] || "",
      dataId: mpPaymentId,
      secret: process.env.MP_WEBHOOK_SECRET || "",
    });
    if (!ok) {
      console.warn(`[MP webhook] firma inválida para pago ${mpPaymentId}`);
      return;
    }

    const eventType = type || (action.includes("payment") ? "payment" : null);
    const eventKey = `${eventType || "payment"}:${mpPaymentId}`;

    // 3) Idempotencia: insertar el evento; si ya existe (23505), salir
    try {
      await pool.query(
        `INSERT INTO payment_webhook_events (provider, event_key, event_type, payload)
         VALUES ('mercadopago', $1, $2, $3)`,
        [eventKey, eventType || "payment", JSON.stringify(body)]
      );
    } catch (e) {
      if (e.code === "23505") return; // ya procesado
      console.error("[MP webhook] idempotency insert error:", e.message);
      return;
    }

    // 4) Procesar
    if (eventType === "payment") {
      await handlePaymentWebhook(mpPaymentId);
    }
    await pool.query(
      `UPDATE payment_webhook_events SET processed_at = NOW()
        WHERE provider = 'mercadopago' AND event_key = $1`,
      [eventKey]
    );
  } catch (err) {
    console.error("[MP webhook] processing error:", err.message);
    // El evento queda sin processed_at → se puede reprocesar manualmente (sync-mp).
  }
});

async function handlePaymentWebhook(mpPaymentId) {
  const payment = await syncPayment(mpPaymentId);
  const { status, status_detail, external_reference } = payment;
  if (!external_reference) {
    console.warn("[MP webhook] pago sin external_reference:", mpPaymentId);
    return;
  }
  // Guardar el estado del pago en la orden (sea cual sea)
  await pool.query(
    `UPDATE orders SET mp_payment_id = $1, mp_payment_status = $2, mp_status_detail = $3,
                       provider_synced_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
    [mpPaymentId, status, status_detail, external_reference]
  );
  if (status === "approved") {
    await approveOrderFromMP(external_reference, mpPaymentId);
  } else if (status === "rejected" || status === "cancelled") {
    await pool.query(
      `UPDATE orders SET rejected_at = COALESCE(rejected_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND status = 'pending_payment'`,
      [external_reference]
    );
  }
}

// Activa la membresía cuando MP aprueba el pago. Mirror de PUT /api/admin/orders/:id/verify.
async function approveOrderFromMP(orderId, mpPaymentId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!orderRes.rows.length) { await client.query("ROLLBACK"); console.warn("[MP] orden no encontrada", orderId); return; }
    let order = orderRes.rows[0];
    if (order.status === "approved") { await client.query("ROLLBACK"); return; } // idempotente

    let plan = null;
    if (order.plan_id) {
      const planRes = await client.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
      if (planRes.rows.length) {
        plan = planRes.rows[0];
        const conflict = await findNonRepeatablePlanConflict({ userId: order.user_id, plan, excludeOrderId: order.id, client });
        if (conflict) { await client.query("ROLLBACK"); console.warn("[MP] conflicto plan no repetible:", conflict.message); return; }
      }
    }

    const approvedRes = await client.query(
      `UPDATE orders SET status = 'approved',
                         approved_at = COALESCE(approved_at, NOW()),
                         paid_at     = COALESCE(paid_at, NOW()),
                         mp_payment_id = $2, mp_payment_status = 'approved', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
      [orderId, mpPaymentId]
    );
    order = approvedRes.rows[0];

    if (order.plan_id && plan && order.user_id) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const endStr = calcMembershipEndDate(todayStr, plan);
      const existingMem = await client.query("SELECT id FROM memberships WHERE order_id = $1", [order.id]);
      let membershipId;
      if (existingMem.rows.length) {
        membershipId = existingMem.rows[0].id;
        await client.query("UPDATE memberships SET status = 'active' WHERE order_id = $1", [order.id]);
      } else {
        await client.query(
          `UPDATE orders SET status = 'cancelled', notes = COALESCE(notes,'') || ' [auto-cancelada: otra orden del mismo plan fue aprobada]'
             WHERE user_id = $1 AND plan_id = $2 AND id != $3 AND status IN ('pending_payment','pending_verification')`,
          [order.user_id, order.plan_id, order.id]
        );
        const memRes = await client.query(
          `INSERT INTO memberships (user_id, plan_id, status, payment_method, start_date, end_date, classes_remaining, order_id)
           VALUES ($1,$2,'active','card',$3,$4,$5,$6) RETURNING id`,
          [order.user_id, order.plan_id, todayStr, endStr, plan.class_limit === 0 ? null : (plan.class_limit ?? null), order.id]
        );
        membershipId = memRes.rows[0].id;
      }

      // Registro contable
      await client.query(
        `INSERT INTO payments (user_id, membership_id, amount, currency, payment_method, reference, notes, status)
         VALUES ($1,$2,$3,$4,'card',$5,$6,'completed')`,
        [order.user_id, membershipId, order.total_amount, order.currency || "MXN", mpPaymentId, `MercadoPago ${mpPaymentId}`]
      );

      // Consulta de complemento (igual que verify)
      const compType = order.complement_type || null;
      if (compType) {
        const compInfo = COMPLEMENT_MAP[compType] || null;
        if (compInfo) {
          try {
            await client.query(
              `INSERT INTO consultations (membership_id, user_id, complement_type, complement_name, specialist, status)
               VALUES ($1,$2,$3,$4,$5,'pending')`,
              [membershipId, order.user_id, compType, compInfo.name, compInfo.specialist]
            );
          } catch (compErr) { console.error("[MP] consultations insert:", compErr.message); }
        }
      }
    }

    if (order.discount_code_id) {
      await incrementDiscountUsage(order.discount_code_id, client);
    }

    await client.query("COMMIT");

    // Post-commit: notificaciones fire-and-forget
    try {
      if (order.plan_id) {
        const planRes = await pool.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
        const planRow = planRes.rows[0];
        const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [order.user_id]);
        const u = uRes.rows[0];
        if (planRow && u) {
          const emailEndStr = calcMembershipEndDate(new Date().toISOString().slice(0, 10), planRow);
          if (await areEmailNotificationsEnabled()) {
            sendMembershipActivated({
              to: u.email, name: u.display_name || "Alumna", planName: planRow.name,
              startDate: new Date().toISOString().slice(0, 10), endDate: emailEndStr,
              classLimit: planRow.class_limit ?? null,
            }).catch((e) => console.error("[Email] MP approve:", e.message));
          }
          sendConfiguredWhatsAppTemplate({
            templateKey: "membership_activated", phone: u.phone,
            vars: {
              name: u.display_name || "Alumna", plan: planRow.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
            fallbackMessage: `Hola ${u.display_name || "Alumna"}, tu membresía ${planRow.name || ""} ya está activa.`,
          }).catch((e) => console.error("[WA] MP approve:", e.message));
        }
      }
      if (order.user_id) triggerWalletPassSync(order.user_id, "mp_payment_approved");
    } catch (notifyErr) {
      console.error("[MP] post-commit notify error:", notifyErr.message);
    }

    console.log(`[MP] pago ${mpPaymentId} aprobado → orden ${orderId}`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[MP] approveOrderFromMP error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Agregar el sync manual admin**

Después de `PUT /api/admin/orders/:id/reject` (su cierre, ~línea 11800), agregar:

```javascript
// POST /api/admin/orders/:id/sync-mp — forzar reconciliación contra MercadoPago si el webhook no llegó
app.post("/api/admin/orders/:id/sync-mp", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT id, mp_payment_id FROM orders WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    const mpPaymentId = r.rows[0].mp_payment_id;
    if (!mpPaymentId) {
      return res.status(400).json({ message: "La orden no tiene un pago de MercadoPago asociado todavía" });
    }
    await handlePaymentWebhook(mpPaymentId);
    const after = await pool.query("SELECT status, mp_payment_status FROM orders WHERE id = $1", [req.params.id]);
    return res.json({ data: after.rows[0] });
  } catch (err) {
    console.error("sync-mp error:", err.message);
    return res.status(500).json({ message: "No se pudo sincronizar con MercadoPago" });
  }
});
```

- [ ] **Step 3: Validar sintaxis**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && node --check server/index.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 4: Verificar idempotencia del webhook (firma desactivada, DB local)**

Con el server corriendo (`PORT=8090 node server/index.js`, sin `MP_WEBHOOK_SECRET` para omitir firma) y `MP_ACCESS_TOKEN` de prueba, simular dos veces el mismo evento con un payment id real de sandbox:

Run:
```bash
curl -s -X POST http://localhost:8090/webhooks/mercadopago \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"<MP_PAYMENT_ID_SANDBOX>"}}'
curl -s -X POST http://localhost:8090/webhooks/mercadopago \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","data":{"id":"<MP_PAYMENT_ID_SANDBOX>"}}'
```
Expected: ambas responden `200`. En la DB, `SELECT count(*) FROM memberships WHERE order_id = '<ord>'` = **1** (no se duplica). `SELECT count(*) FROM payment_webhook_events` con ese `event_key` = 1.

> Sin DB/credenciales locales: diferir esta verificación al smoke test en Railway (Task 7) usando el simulador de webhooks del panel MP.

- [ ] **Step 5: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add server/index.js
git commit -m "feat(pagos): webhook MercadoPago + activación de membresía + sync admin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — método "Tarjeta" en Checkout + tipos

**Files:**
- Modify: `src/types/order.ts`
- Modify: `src/pages/client/Checkout.tsx`

**Interfaces:**
- Consumes: `GET /api/payments/config`, `POST /api/orders` (con `paymentMethod:'card'` y respuesta `data.mp_checkout_url`).

- [ ] **Step 1: Extender los tipos**

En `src/types/order.ts`, agregar campos a `Order` (después de `admin_notes?: string;`):

```typescript
  rejection_reason?: string;
  payment_provider?: string | null;
  mp_checkout_url?: string | null;
  mp_payment_id?: string | null;
  mp_payment_status?: string | null;
```

y cambiar `CreateOrderRequest`:

```typescript
export interface CreateOrderRequest {
  planId: string;
  discountCode?: string;
  paymentMethod: "transfer" | "cash" | "card";
}
```

- [ ] **Step 2: Checkout — tipo de método, query de config, icono**

En `src/pages/client/Checkout.tsx`:

Cambiar el alias de tipo (línea 17):
```typescript
type PaymentMethod = "transfer" | "cash" | "card";
```

Tras `const { data: plansData, isLoading: loadingPlans } = useQuery(...)` (~línea 221), agregar:
```typescript
  const { data: paymentsConfig } = useQuery({
    queryKey: ["payments-config"],
    queryFn: async () => (await api.get("/payments/config")).data,
  });
  const cardEnabled: boolean = Boolean(paymentsConfig?.data?.cardEnabled);
```

- [ ] **Step 3: Checkout — precio efectivo no aplica a tarjeta**

Reemplazar el cálculo de `effectivePrice` (~línea 235):
```typescript
  const effectivePrice = (paymentMethod === "transfer" || paymentMethod === "cash") && individualDiscount
    ? individualDiscount : basePrice;
```
(ya excluye `card` correctamente — sin cambios funcionales, confirmar que queda así).

- [ ] **Step 4: Checkout — redirigir a MP en `onSuccess`**

Reemplazar el `onSuccess` de `createOrderMutation` (~línea 252):
```typescript
    onSuccess: (res) => {
      const data = res.data?.data ?? res.data;
      setOrderUuid(data.id);
      setOrderId(data.order_number ?? data.orderNumber ?? data.orderId ?? data.id);
      setBankDetails(data.bankDetails ?? data.bank_details);
      if (paymentMethod === "transfer") setStep("bank");
      else setStep("cash");
    },
```
por:
```typescript
    onSuccess: (res) => {
      const data = res.data?.data ?? res.data;
      setOrderUuid(data.id);
      setOrderId(data.order_number ?? data.orderNumber ?? data.orderId ?? data.id);
      setBankDetails(data.bankDetails ?? data.bank_details);
      if (paymentMethod === "card") {
        if (data.mp_checkout_url) {
          window.location.href = data.mp_checkout_url;
        } else {
          toast({ title: "No se pudo iniciar el pago con tarjeta", description: "Reintenta desde Mis órdenes.", variant: "destructive" });
          window.location.assign("/app/orders");
        }
        return;
      }
      if (paymentMethod === "transfer") setStep("bank");
      else setStep("cash");
    },
```

- [ ] **Step 5: Checkout — tercer botón "Tarjeta"**

En el grid de métodos (`step === "method"`), tras el botón de Efectivo (cierre `</button>` ~línea 517, antes del `</div>` que cierra el grid), agregar el botón de tarjeta (solo si `cardEnabled`):

```tsx
                {cardEnabled && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={cn(
                      "flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all",
                      paymentMethod === "card"
                        ? "border-[#B8915A]/50 bg-[#B8915A]/10 shadow-[0_0_16px_rgba(184,145,90,0.15)]"
                        : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/25"
                    )}
                  >
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", paymentMethod === "card" ? "bg-[#B8915A]/20 text-[#B8915A]" : "bg-[#8C6B6F]/[0.06] text-[#1A1A1A]/40")}>
                      <CreditCard size={22} />
                    </div>
                    <div className="text-center">
                      <p className={cn("text-sm font-semibold", paymentMethod === "card" ? "text-[#B8915A]" : "text-[#1A1A1A]/60")}>Tarjeta</p>
                      <p className="text-[10px] text-[#1A1A1A]/30 mt-0.5">Débito / crédito</p>
                    </div>
                    {paymentMethod === "card" && (
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#B8915A] to-[#D9B5BA] flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </span>
                    )}
                  </button>
                )}
```

> `CreditCard` ya está importado de `lucide-react` (línea 11). Si la grilla queda apretada con 3 botones, cambiar `grid-cols-1 sm:grid-cols-2` por `grid-cols-1 sm:grid-cols-3` en el contenedor de métodos (~línea 469).

- [ ] **Step 6: Checkout — texto del botón confirmar para tarjeta**

En el botón "Confirmar" (~línea 519-526), cambiar el label para que sea claro en tarjeta:
```tsx
                {createOrderMutation.isPending ? "Procesando…" : (paymentMethod === "card" ? "Pagar con tarjeta" : "Confirmar")}
```

- [ ] **Step 7: Build y lint**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npm run build`
Expected: build exitoso, 0 errores TypeScript.

- [ ] **Step 8: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add src/types/order.ts src/pages/client/Checkout.tsx
git commit -m "feat(pagos): método Tarjeta en checkout con redirección a MercadoPago

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — retorno de MP, polling y reintento en MyOrders

**Files:**
- Modify: `src/pages/client/MyOrders.tsx`

**Interfaces:**
- Consumes: `?checkout=success|failure|pending` en la URL, `GET /api/orders` (incluye `mp_checkout_url`, `payment_method`, `status`), `POST /api/orders/:id/pay-with-card`.

- [ ] **Step 1: Imports y hooks de retorno + polling**

Reemplazar el encabezado de imports y el inicio del componente. Imports (líneas 1-11):
```tsx
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Upload, Clock, CheckCircle, XCircle, AlertTriangle, ShoppingBag, CreditCard, Loader2 } from "lucide-react";
```

Reemplazar el cuerpo inicial (líneas 22-28):
```tsx
const MyOrders = () => {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const checkoutResult = params.get("checkout"); // 'success' | 'failure' | 'pending' | null

  const { data, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders")).data,
    refetchInterval: (query) => {
      const rows: any[] = Array.isArray((query.state.data as any)?.data) ? (query.state.data as any).data : [];
      const waitingCard = rows.some(
        (o) => o.payment_method === "card" && o.status === "pending_payment"
      );
      return checkoutResult === "success" && waitingCard ? 3000 : false;
    },
  });

  const orders: any[] = Array.isArray(data?.data) ? data.data : [];

  const retryMutation = useMutation({
    mutationFn: async (order: any) => {
      if (order.mp_checkout_url) return { mp_checkout_url: order.mp_checkout_url };
      const res = await api.post(`/orders/${order.id}/pay-with-card`);
      return res.data?.data ?? res.data;
    },
    onSuccess: (d: any) => {
      if (d?.mp_checkout_url) window.location.href = d.mp_checkout_url;
      else toast({ title: "No se pudo reiniciar el pago", variant: "destructive" });
    },
    onError: (err: any) =>
      toast({ title: "Error al reintentar el pago", description: err?.response?.data?.message, variant: "destructive" }),
  });
```

- [ ] **Step 2: Banner de retorno de MercadoPago**

Justo después del `<div className="flex items-center justify-between">...</div>` del encabezado (tras línea 39, antes del bloque `isLoading ?`), agregar:
```tsx
          {checkoutResult === "success" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
              <Loader2 size={15} className="animate-spin shrink-0" />
              Estamos confirmando tu pago con el banco. Tu membresía se activará en cuanto se acredite (puede tardar unos segundos).
            </div>
          )}
          {checkoutResult === "failure" && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              El pago no se completó. Puedes reintentar desde la orden pendiente.
            </div>
          )}
          {checkoutResult === "pending" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Tu pago quedó en proceso. Te avisaremos cuando se confirme.
            </div>
          )}
```

- [ ] **Step 3: Botón por método en órdenes `pending_payment`**

Reemplazar el bloque `{o.status === "pending_payment" && (...)}` (líneas 82-88) por uno que distinga tarjeta de transferencia:
```tsx
                    {o.status === "pending_payment" && o.payment_method === "card" && (
                      <Button
                        size="sm"
                        className="mt-3 w-full sm:w-auto"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(o)}
                      >
                        {retryMutation.isPending
                          ? <Loader2 size={14} className="mr-2 animate-spin" />
                          : <CreditCard size={14} className="mr-2" />}
                        Reintentar pago
                      </Button>
                    )}
                    {o.status === "pending_payment" && o.payment_method !== "card" && (
                      <Button asChild size="sm" className="mt-3 w-full sm:w-auto">
                        <Link to={`/app/checkout?orderId=${o.id}`}>
                          <Upload size={14} className="mr-2" />Subir comprobante
                        </Link>
                      </Button>
                    )}
```

- [ ] **Step 4: Etiqueta de método tarjeta en el detalle**

En la línea que muestra el método (línea 69), incluir tarjeta:
```tsx
                          {o.payment_method === "cash" ? "Efectivo" : o.payment_method === "transfer" ? "Transferencia" : o.payment_method === "card" ? "Tarjeta" : o.payment_method}
```

- [ ] **Step 5: Build**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npm run build`
Expected: build exitoso, 0 errores TypeScript.

- [ ] **Step 6: Commit**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git add src/pages/client/MyOrders.tsx
git commit -m "feat(pagos): retorno de MercadoPago, polling y reintento en Mis órdenes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Verificación integral + despliegue

**Files:** ninguno (configuración y validación).

- [ ] **Step 1: Suite completa + build**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npm test && npm run build`
Expected: tests en verde (incluye `mercadopago.test.js`), build sin errores.

- [ ] **Step 2: Configurar el webhook en el panel de MercadoPago**

En https://www.mercadopago.com.mx/developers/panel/app → app de producción → **Webhooks**:
- URL: `https://web-production-b1a1d.up.railway.app/webhooks/mercadopago`
- Evento: **Pagos**
- Copiar la **clave secreta** generada (para `MP_WEBHOOK_SECRET`).

- [ ] **Step 3: Setear variables en Railway (servicio `web`)**

Run (sustituyendo los valores reales; NO se versionan):
```bash
railway variables \
  --service web \
  --set "MP_ACCESS_TOKEN=APP_USR-..." \
  --set "MP_WEBHOOK_SECRET=..." \
  --set "BACKEND_URL=https://web-production-b1a1d.up.railway.app" \
  --set "FRONTEND_URL=https://frontend-production-dcb15.up.railway.app"
```
Expected: Railway confirma las variables; el servicio `web` redepliega.

> Alternativa: setearlas en el panel de Railway → servicio `web` → Variables.

- [ ] **Step 4: Merge a `main` y desplegar**

```bash
cd "/Users/saidromero/Tu Espacio Pilates"
git checkout main
git merge --no-ff feat/mercadopago-card-payments -m "feat: pagos con tarjeta (MercadoPago Checkout Pro)"
git push origin main
```
Expected: push dispara auto-deploy en Railway; build SUCCESS.

- [ ] **Step 5: Smoke test en vivo**

- `curl -s https://web-production-b1a1d.up.railway.app/api/payments/config` → `{"data":{"cardEnabled":true}}`.
- En el frontend en vivo: comprar un plan con **Tarjeta** → redirige a MercadoPago → pagar (cobro real pequeño o tarjeta de prueba si la app está en sandbox).
- Confirmar que al volver, `Mis órdenes` muestra el banner y, tras el webhook, la orden pasa a **Aprobada** y aparece la membresía activa en el panel.
- Reenviar el mismo evento desde el panel MP (simulador) y confirmar que NO se crea una segunda membresía (idempotencia).

- [ ] **Step 6: Verificación final**

Confirmar en el panel MP → Webhooks → **Historial de notificaciones** que el server respondió `200`. Si un pago quedó sin activar, usar `POST /api/admin/orders/:id/sync-mp` para reconciliar.

---

## Notas de verificación contra el spec

- **§3 env vars** → Task 1 (Step 5) + Task 7 (Steps 2-3).
- **§4 migración DB** → Task 2.
- **§5.1 mercadopago.js** → Task 1.
- **§5.2 POST /api/orders** → Task 3 (Step 2).
- **§5.3 pay-with-card** → Task 3 (Step 3).
- **§5.4 webhook** → Task 4 (Step 1).
- **§5.5 approveOrderFromMP** → Task 4 (Step 1).
- **§5.6 payments/config** → Task 3 (Step 3).
- **§5.7 admin sync-mp** → Task 4 (Step 2).
- **§6.1 tipos** → Task 5 (Step 1).
- **§6.2 Checkout** → Task 5 (Steps 2-6).
- **§6.3 MyOrders** → Task 6.
- **§7 pruebas** → Task 1, Task 4 (Step 4), Task 7 (Steps 1,5).
- **§8 despliegue** → Task 7 (Steps 2-6).
