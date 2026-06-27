# Pagos con tarjeta (MercadoPago Checkout Pro) — Diseño

**Fecha:** 2026-06-27
**Proyecto:** Tu Espacio Pilates · Villa Magna (rebrand de la plataforma Valiance)
**Base:** `MERCADOPAGO-IMPLEMENTATION-GUIDE.md` (integración portada desde Balance Room), adaptada
a este código: backend de **un solo archivo** `server/index.js` (ESM, JS) + frontend React/Vite/TS.

---

## 1. Objetivo y alcance

Agregar **Tarjeta** como tercer método de pago junto a **Transferencia** y **Efectivo**, usando
**MercadoPago Checkout Pro** (redirección a la página de MercadoPago, NO Bricks en el sitio).

**Regla de oro:** la redirección de vuelta (`back_urls`) es **solo UX**. La membresía se activa
**únicamente** por el webhook server-to-server (o por un sync manual contra `/v1/payments`). El
navegador puede cerrarse o manipularse; el webhook es la fuente de verdad.

### Decisiones de negocio (bloqueadas)
- **Precio con tarjeta = precio base del plan, sin recargo.** La tarjeta NO recibe el descuento de
  efectivo/transferencia (ya es el comportamiento actual: `isCashOrTransfer` es falso para tarjeta).
  Los **códigos de descuento sí** siguen aplicando. La comisión de MercadoPago (~3.5%) la absorbe el estudio.
- **Cobro de contado:** `installments: 1` (sin meses ni parcialidades).
- **Credenciales de producción** ya disponibles; se configuran por variables de entorno en Railway
  (servicio `web`), nunca en git ni en el chat.

### Fuera de alcance
- Pagos con saldo MercadoPago / OXXO / otros métodos distintos a tarjeta no se excluyen
  explícitamente, pero el flujo y los textos se centran en tarjeta. (Checkout Pro los puede ofrecer.)
- Reembolsos automáticos. Manejo de `rejected` se limita a registrar el estado en la orden.
- No se modifica el flujo existente de transferencia/efectivo ni la ruta admin `verify`.

---

## 2. Flujo

```
Cliente elige plan + "Tarjeta"  →  POST /api/orders { paymentMethod: 'card' }
   1. Crea orden (status=pending_payment, payment_method=card, precio base)
   2. createPreference() → MercadoPago /checkout/preferences
   3. Guarda payment_provider + payment_intent_id (preference_id) + mp_checkout_url (init_point)
   4. Devuelve { data: { ...order, mp_checkout_url } }
        │
        ▼  window.location.href = mp_checkout_url
Cliente paga en MercadoPago
   ┌────┴───────────────────────────────────────────────┐
   ▼                                                     ▼
back_urls (navegador, SOLO UX)              notification_url (webhook, FUENTE DE VERDAD)
/app/orders?checkout=success&order=:id      POST /webhooks/mercadopago
   → banner + polling de la orden              1. 200 inmediato
                                               2. verifica firma HMAC
                                               3. idempotencia (payment_webhook_events)
                                               4. GET /v1/payments/:id → estado real
                                               5. si approved → approveOrderFromMP():
                                                  crea membresía, marca orden approved,
                                                  registra payment, notifica (email+WhatsApp+wallet)
```

---

## 3. Variables de entorno

Se agregan a `.env.example` y se configuran en el servicio **`web`** (backend) de Railway:

| Variable | Descripción | Valor |
|---|---|---|
| `MP_ACCESS_TOKEN` | Access Token de producción (`APP_USR-…`). Si está vacío, la opción Tarjeta se oculta. | (secreto) |
| `MP_WEBHOOK_SECRET` | Clave secreta del webhook (panel MP → Webhooks). Si está vacía, se omite la verificación de firma (legacy). | (secreto) |
| `BACKEND_URL` | URL pública del backend, para `notification_url`. | `https://web-production-b1a1d.up.railway.app` |
| `FRONTEND_URL` | URL pública del frontend, para `back_urls`. | `https://frontend-production-dcb15.up.railway.app` |

**Degradación limpia:** sin `MP_ACCESS_TOKEN`, `GET /api/payments/config` devuelve `cardEnabled:false`
y el frontend no muestra Tarjeta; cualquier intento de crear preferencia falla con mensaje claro.

---

## 4. Migración de base de datos (idempotente, dentro de `ensureSchema()`)

Se agrega junto a los otros `CREATE TABLE IF NOT EXISTS` embebidos en `server/index.js`.

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_provider   VARCHAR(50),   -- 'mercadopago'
  ADD COLUMN IF NOT EXISTS payment_intent_id  VARCHAR(255),  -- preference_id
  ADD COLUMN IF NOT EXISTS mp_checkout_url    TEXT,          -- init_point
  ADD COLUMN IF NOT EXISTS mp_payment_id      VARCHAR(255),  -- id del pago (llega por webhook)
  ADD COLUMN IF NOT EXISTS mp_payment_status  VARCHAR(50),   -- approved | rejected | pending | ...
  ADD COLUMN IF NOT EXISTS mp_status_detail   VARCHAR(100),  -- accredited | cc_rejected_... | ...
  ADD COLUMN IF NOT EXISTS provider_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     VARCHAR(50) NOT NULL,
  event_key    VARCHAR(255) NOT NULL,   -- "payment:<mp_payment_id>"
  event_type   VARCHAR(50),
  payload      JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, event_key)
);
```

Notas:
- Las columnas `approved_at`, `paid_at`, `rejected_at`, `admin_notes`, `rejection_reason` ya existen en `orders`.
- `memberships.order_id` ya existe. No se agregan `membership_id` ni otras columnas de la guía que no se usan aquí.
- Enums sin cambios: `payment_method` ya incluye `'card'`; `order_status` ya incluye `approved/rejected/cancelled`.
- Se usa `uuid_generate_v4()` (no `gen_random_uuid()`) para consistencia con el resto del schema.

---

## 5. Backend

### 5.1 `server/lib/mercadopago.js` (nuevo, ESM)

Sin SDK, usa `fetch` global (Node 18+; aquí Node 25). Dos funciones:

- `createPreference({ orderId, orderNumber, planName, amount, userEmail })` → `{ preference_id, checkout_url, sandbox_checkout_url }`.
  Body: `items` (currency `MXN`, `unit_price = amount`), `payer.email`, `external_reference = orderId`,
  `back_urls` (success/failure/pending → `${FRONTEND_URL}/app/orders?checkout=...&order=${orderId}`),
  `auto_return:'approved'`, `notification_url:${BACKEND_URL}/webhooks/mercadopago`,
  `statement_descriptor:'ESPACIO PILATES'`, `metadata:{order_id, order_number}`,
  `payment_methods:{ installments: 1 }`. Header `X-Idempotency-Key: order-${orderId}`.
- `syncPayment(mpPaymentId)` → `{ status, status_detail, external_reference, transaction_amount, payer_email }`
  (GET `/v1/payments/:id`).

Ambas lanzan `Error` con el cuerpo de la respuesta si `!res.ok`.

### 5.2 `POST /api/orders` (modificar)

Tras `COMMIT` de la orden, si `paymentMethod === 'card'`:
- Obtener email del usuario.
- `createPreference(...)` con `amount = total` (precio base − descuento de código; sin descuento efectivo/transferencia).
- `UPDATE orders SET payment_provider='mercadopago', payment_intent_id=$pref, mp_checkout_url=$url`.
- Incluir `mp_checkout_url` en la respuesta `data`.
- Si MP falla: log, NO romper — la orden queda `pending_payment` y se reintenta con `pay-with-card`.

(El precio ya es correcto: para `card`, `isCashOrTransfer=false` → `subtotal = plan.price`/`combo.price`.)

### 5.3 `POST /api/orders/:id/pay-with-card` (nuevo, `authMiddleware`)

Para reintentos. Valida que la orden sea del usuario y esté `pending_payment`. Si ya tiene
`mp_checkout_url`, lo reutiliza (no duplica preferencias). Si no, crea una y la guarda. Devuelve `{ data: { mp_checkout_url } }`.

### 5.4 `POST /webhooks/mercadopago` (nuevo)

Montado **antes** de `app.get("*")` (SPA fallback) y **fuera de `/api`** — debe coincidir con `notification_url`.
(El catch-all es solo `GET`, así que un POST no se lo tragaría, pero se monta junto a las rutas de órdenes por claridad.)
Asegurar que el body JSON se parsea (reutilizar `express.json()`; el esquema HMAC de MP usa `data.id`, no el raw body).

Orden estricto:
1. `res.status(200).end()` inmediato.
2. Extraer `mpPaymentId` de `req.body.data.id` (fallback a query `data.id`/`id`).
3. `verifyMpSignature(req, mpPaymentId)` — header `x-signature` = `ts=…,v1=…`; manifest
   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`; HMAC-SHA256 con `MP_WEBHOOK_SECRET`; comparar `v1`
   con `timingSafeEqual`. Sin secret → `true` (legacy).
4. Idempotencia: `INSERT INTO payment_webhook_events`; si código `23505` → salir (ya procesado).
5. Si es evento de pago → `handlePaymentWebhook(mpPaymentId)`; al terminar, `UPDATE ... processed_at=NOW()`.

`handlePaymentWebhook`: `syncPayment()` → guarda `mp_payment_id/status/status_detail/provider_synced_at`
en la orden (por `external_reference`); si `status==='approved'` → `approveOrderFromMP(orderId, mpPaymentId)`.

### 5.5 `approveOrderFromMP(orderId, mpPaymentId)` (nuevo)

Replica la lógica de `PUT /api/admin/orders/:id/verify`, reutilizando los helpers existentes
(`calcMembershipEndDate`, `findNonRepeatablePlanConflict`, `incrementDiscountUsage`,
`sendMembershipActivated`, `sendConfiguredWhatsAppTemplate`, `areEmailNotificationsEnabled`,
`triggerWalletPassSync`). Transacción propia:

1. `SELECT ... FOR UPDATE` la orden (join plan + user). Si no existe → log y salir.
2. Guard idempotente: `if (order.status === 'approved') return;`.
3. `findNonRepeatablePlanConflict` (excluyendo la orden actual).
4. `UPDATE orders SET status='approved', approved_at, paid_at, mp_payment_id`.
5. Si no hay membresía para la orden: cancelar otras órdenes pendientes del mismo plan/usuario;
   `INSERT INTO memberships (... status='active', payment_method='card', start_date, end_date, classes_remaining, order_id)`
   con `end_date = calcMembershipEndDate(today, plan)` y `classes_remaining = plan.class_limit` (0 → NULL).
6. `INSERT INTO payments (user_id, membership_id, amount, currency, payment_method='card', status='completed', reference=mpPaymentId, notes='MercadoPago <payment_id>')`.
   (La tabla `payments` no tiene columna `provider`; se usa `reference` + `notes`.)
7. Consultas de complemento si `order.complement_type` (igual que `verify`).
8. `incrementDiscountUsage` si `discount_code_id`.
9. `COMMIT`. Post-commit (fire-and-forget): email de membresía activada + WhatsApp + wallet sync.

**Nota de diseño:** se duplica la *orquestación* de `verify` (no se extrae a un helper compartido) para
no tocar la transacción de la ruta `verify` existente dentro del archivo de 600KB; la *lógica de negocio*
sí se comparte vía los helpers. Riesgo de divergencia mitigado documentando ambos caminos.

### 5.6 `GET /api/payments/config` (nuevo)

Devuelve `{ data: { cardEnabled: Boolean(process.env.MP_ACCESS_TOKEN) } }`. El frontend lo usa para mostrar/ocultar Tarjeta.

### 5.7 `POST /api/admin/orders/:id/sync-mp` (nuevo, `adminMiddleware`)

Red de seguridad: si un webhook no llegó, el admin fuerza un sync. Toma `mp_payment_id` (o `payment_intent_id`
→ buscar pagos de la preferencia vía `/v1/payments/search`), llama `syncPayment()` y, si `approved`,
`approveOrderFromMP()`. Devuelve el estado resultante. (MVP: requiere `mp_payment_id` ya presente en la orden.)

---

## 6. Frontend

### 6.1 `src/types/order.ts`
Agregar a `Order`: `mp_checkout_url?`, `mp_payment_id?`, `mp_payment_status?`, `payment_provider?`,
`rejection_reason?`. Cambiar `CreateOrderRequest.paymentMethod` a `"transfer" | "cash" | "card"`.

### 6.2 `src/pages/client/Checkout.tsx`
- Query `GET /api/payments/config` → `cardEnabled`.
- `PaymentMethod` incluye `"card"`. Tercer botón **Tarjeta** (icono `CreditCard`), visible solo si `cardEnabled`.
- Para tarjeta no se muestra el aviso "Efectivo/transferencia: $…" (precio base).
- `createOrderMutation onSuccess`: si `paymentMethod==='card'` y `data.mp_checkout_url`,
  `window.location.href = data.mp_checkout_url`; si no hay URL, ir a `/app/orders` (reintentar).
- El stepper refleja tarjeta (no pasa por `bank`/`cash`/`upload`).

### 6.3 `src/pages/client/MyOrders.tsx`
- `useSearchParams` → `checkout` (`success|failure|pending`) y `order`.
- Banner según `checkout`: success → "Estamos confirmando tu pago…"; failure → "El pago no se completó"; pending → "Pago en proceso".
- **Polling:** `refetchInterval` = 3000 mientras `checkout==='success'` y exista una orden tarjeta en `pending_payment`; se detiene al pasar a `approved`/`rejected`.
- Botón **"Reintentar pago"** en órdenes `pending_payment` con `payment_method==='card'`:
  si hay `mp_checkout_url` → redirige; si no → `POST /orders/:id/pay-with-card` y redirige.
- **El frontend nunca activa membresías** ni cambia estados.

---

## 7. Pruebas

- `npm run build` (0 errores TS) y `npm test` (suite existente) deben pasar.
- Sandbox (opcional, con credenciales TEST en local): tarjeta `5031 7557 3453 0604`, CVV `123`, titular `APRO`
  (aprobada) / `OTHE` (rechazada). Webhook local vía **simulador del panel MP** (localhost no recibe webhooks).
- **Idempotencia:** reenviar el mismo webhook NO debe crear una segunda membresía (guard + UNIQUE).
- Verificar que sin `MP_ACCESS_TOKEN` la opción Tarjeta no aparece y el resto del checkout sigue igual.

## 8. Despliegue

- Configurar en panel MercadoPago → Webhooks → URL `https://web-production-b1a1d.up.railway.app/webhooks/mercadopago`,
  evento **Pagos** → copiar clave secreta a `MP_WEBHOOK_SECRET`.
- Setear las 4 env vars en el servicio `web` de Railway.
- Deploy: push a `main` (auto-deploy). Verificar `GET /api/payments/config` → `cardEnabled:true` en vivo.
- Smoke test con un cobro real pequeño (o sandbox) y confirmar activación de membresía vía webhook.

## 9. Archivos tocados

| Archivo | Cambio |
|---|---|
| `server/lib/mercadopago.js` | **Nuevo** — `createPreference`, `syncPayment`. |
| `server/index.js` | Migración en `ensureSchema`; modificar `POST /api/orders`; nuevos `pay-with-card`, webhook, `approveOrderFromMP`, `payments/config`, `admin .../sync-mp`. |
| `.env.example` | 4 variables MP. |
| `src/types/order.ts` | Campos MP + `card` en request. |
| `src/pages/client/Checkout.tsx` | Método Tarjeta + redirección. |
| `src/pages/client/MyOrders.tsx` | Return UX, polling, reintento. |
