# MercadoPago — Referencia técnica

Integración de pagos con tarjeta de Tu Espacio Pilates. Cubre **dos flujos** distintos (Checkout Pro por redirección y Card Payment Brick dentro de la app), el webhook que confirma los pagos, y cómo reconciliar manualmente cuando algo no llega.

---

## Estado actual

| | |
|---|---|
| **Modo** | Producción (`APP_USR-...`, no sandbox) |
| **Access Token** | `MP_ACCESS_TOKEN` — Railway, servicio **`web`** (backend) |
| **Secreto del webhook** | `MP_WEBHOOK_SECRET` — Railway, servicio **`web`** |
| **Llave pública (frontend)** | `VITE_MP_PUBLIC_KEY` — Railway, servicio **`frontend`** (build-time, la necesita Vite al compilar) |
| **Capa pura** | `server/lib/mercadopago.js` (sin SDK — `fetch` directo contra la API REST de MP), con tests en `server/lib/__tests__/mercadopago.test.js` |
| **Orquestación** | `server/index.js` (endpoints, webhook, aprobación de orden) |
| **Comisión al cliente** | 4% ("uso de plataforma") **solo** en tarjeta; efectivo/transferencia no la llevan |

> Las 3 variables ya están configuradas en Railway (verificado). Si `MP_ACCESS_TOKEN` faltara, `GET /api/payments/config` devuelve `cardEnabled: false` y el checkout oculta la opción "Tarjeta" — no revienta, se degrada limpio.

---

## Los DOS flujos de pago con tarjeta

Esto es lo más importante de entender: **no es un solo camino**. Son dos integraciones distintas de MercadoPago, con comportamiento distinto ante fallos.

### 1. Card Payment Brick — dentro de la app (el que usan las alumnas hoy)

**Pantalla:** `src/pages/client/CardPayment.tsx`. Carga el SDK JS de MP v2 (`https://sdk.mercadopago.com/js/v2`) bajo demanda y monta el Brick de tarjeta en un `<div id="cardPaymentBrick_container">`. La tarjeta se **tokeniza en el navegador** (el número de tarjeta nunca toca nuestro backend) y solo el `token` viaja al servidor.

```
Alumna llena la tarjeta en el Brick
        │
        ▼
MP tokeniza en el navegador (token, payment_method_id, issuer_id)
        │
        ▼
POST /api/orders/:id/pay-card-token   { token, payment_method_id, issuer_id, payer }
        │                              (el MONTO sale de la orden en BD, nunca del cliente)
        ▼
createCardPayment() → POST https://api.mercadopago.com/v1/payments   (síncrono)
        │
        ├─ approved   → approveOrderFromMP() se llama DE INMEDIATO (no espera webhook)
        ├─ in_process/pending → la orden queda pending_verification, se resuelve después
        └─ rejected   → mpRejectionMessage() traduce el status_detail a español
```

**Es síncrono y NO depende del webhook para el camino feliz.** Si el pago se aprueba, `pay-card-token` llama `approveOrderFromMP` en la misma request. El webhook, si llega, solo re-confirma un estado que ya se procesó (es idempotente — ver más abajo).

Endpoint: `POST /api/orders/:id/pay-card-token` (`server/index.js:5127`).

### 2. Checkout Pro — redirección al hospedado de MercadoPago (código vivo, no se usa desde la UI actual)

Genera una "preferencia" y manda a la alumna a pagar en una página de MercadoPago fuera de la app.

```
POST /api/orders  (paymentMethod: "card")   o   POST /api/orders/:id/pay-with-card
        │
        ▼
createPreference() → POST https://api.mercadopago.com/checkout/preferences
        │
        ▼
Alumna es redirigida a pref.checkout_url (fuera de la app)
        │
        ▼
Paga en MercadoPago → MP redirige de vuelta a back_urls (success/failure/pending)
        │                (solo cambia la URL visible — NO aprueba nada por sí sola)
        ▼
MP llama BACKEND-A-BACKEND a notification_url = POST /webhooks/mercadopago
        │
        ▼
handlePaymentWebhook() → syncPayment() (nunca confía en el body del webhook, siempre
                          re-consulta el estado real a MP) → approveOrderFromMP()
```

**Esta ruta SÍ depende 100% del webhook.** Si el webhook no llega o se rechaza por firma inválida, la orden se queda pegada en `pending_payment`/`pending_verification` hasta que un admin la reconcilie a mano (`sync-mp`, ver abajo). Endpoints: `POST /api/orders` con `paymentMethod: "card"` y `POST /api/orders/:id/pay-with-card` (`server/index.js:5066`) — ambos existen en el backend pero **la UI actual usa el Brick (flujo 1)**, no este redirect.

---

## El webhook — `POST /webhooks/mercadopago`

`server/index.js:5233`. Fuera de `/api` a propósito — debe coincidir exactamente con `notification_url`.

1. **Responde `200` de inmediato**, antes de procesar — MP reintenta agresivamente si tarda o si no le regresas 200.
2. **Verifica la firma** (`verifyWebhookSignature` en `server/lib/mercadopago.js:154`): headers `x-signature` (`ts=...,v1=...`) y `x-request-id`, arma el manifest `id:{dataId};request-id:{requestId};ts:{ts};` y compara HMAC-SHA256 con `MP_WEBHOOK_SECRET` (comparación en tiempo constante, `crypto.timingSafeEqual`). **Si `MP_WEBHOOK_SECRET` está vacío, la verificación se omite** (modo legacy) — nunca debe estar vacío en producción.
3. **Idempotencia real de base de datos**: `INSERT INTO payment_webhook_events (provider, event_key, ...)` con `UNIQUE (provider, event_key)`. Si MP reenvía el mismo evento (lo hace seguido), el segundo `INSERT` truena con `23505` y se ignora sin reprocesar.
4. **Nunca confía en el body del webhook para el monto/estado** — siempre llama `syncPayment(mpPaymentId)` que consulta `GET /v1/payments/:id` directo a MP. El webhook es solo el disparador ("algo cambió, ve a revisar"), no la fuente de verdad.
5. Actualiza `orders.mp_payment_status`/`mp_status_detail` siempre; si `approved` → `approveOrderFromMP`; si `rejected`/`cancelled` → marca `rejected_at`.

---

## `approveOrderFromMP` — qué pasa cuando se aprueba un pago

`server/index.js:5429`. Es **idempotente** (`if (order.status === "approved") return;` con `SELECT ... FOR UPDATE` para evitar carreras) — se puede llamar de más sin duplicar nada. En una transacción:

1. Revisa conflicto de "plan no repetible" (por si la alumna ya activó ese plan por otro lado mientras pagaba).
2. Marca la orden `approved`.
3. `createMembershipsForOrder` — crea 1 membresía por línea del carrito (o 1 si es plan suelto). También idempotente: si la orden ya tiene membresías, solo las reactiva.
4. Inserta **un solo registro contable** en `payments` por orden, referenciando la membresía principal, con `reference = mpPaymentId`.
5. Si había un complemento (consulta), crea la fila en `consultations`.
6. Si había código de descuento, incrementa su uso — **sin abortar la activación** si el código ya llegó a su límite entre la compra y la aprobación (el dinero ya se cobró, no tiene sentido revertir por esto).
7. Post-commit: notificaciones (email/WhatsApp/push) — fire-and-forget, fuera de la transacción.

---

## Reconciliación manual — cuando un pago no se refleja

**Síntoma:** la alumna pagó en MercadoPago (Checkout Pro) pero la orden sigue `pending_payment`/`pending_verification` en el admin.

```
POST /api/admin/wallet/... (no, este es de wallet)
```

El endpoint correcto:

```
POST /api/admin/orders/:id/sync-mp
```

(`server/index.js:13494`, admin). Toma el `mp_payment_id` ya guardado en la orden y vuelve a correr exactamente `handlePaymentWebhook` — como si el webhook acabara de llegar. Si la orden **no tiene** `mp_payment_id` todavía (nunca se generó el pago del lado de MP), responde 400 — no hay nada que reconciliar.

---

## ⚠️ Problema activo observado en producción

En los logs de producción aparece repetido:

```
[MP webhook] firma inválida para pago <id>
```

Esto significa que **`MP_WEBHOOK_SECRET` en Railway no coincide** con el secreto real configurado en el panel de MercadoPago (Developers → Tus integraciones → Webhooks → Firma secreta) — cada webhook entrante se **rechaza y se descarta silenciosamente** (nunca llega a `handlePaymentWebhook`, ver Step 2 arriba).

**Impacto real, distinto según el flujo:**
- **Card Payment Brick (el que usa la app hoy):** bajo — la aprobación ya ocurre de forma síncrona en `pay-card-token`, el webhook es redundante para el camino feliz.
- **Checkout Pro (redirect, código vivo pero sin botón en la UI actual):** alto — si alguna vez se reactiva ese flujo, los pagos se quedarían pegados sin el webhook.
- **Reintentos/reembolsos/contracargos que MP notifica después** (fuera del flujo inicial de aprobación): se pierden silenciosamente en cualquiera de los dos flujos, ya que esos eventos SÍ dependen exclusivamente del webhook.

**Cómo corregirlo:** en el panel de MercadoPago (cuenta de producción), copiar la "Firma secreta" del webhook configurado para `https://web-production-b1a1d.up.railway.app/webhooks/mercadopago`, y pegarla exacta en `MP_WEBHOOK_SECRET` en Railway (servicio `web`).

**Cómo verificarlo ya corregido:** provocar un pago de prueba (o esperar el siguiente pago real) y confirmar que el log deja de repetir "firma inválida" para eventos nuevos.

---

## Variables de entorno

```bash
# Backend (servicio "web" en Railway)
MP_ACCESS_TOKEN=APP_USR-...       # producción. Vacío → "Tarjeta" se oculta, sin crashear.
MP_WEBHOOK_SECRET=...              # firma secreta del webhook (panel MP → Webhooks). Vacío → verificación omitida (inseguro).
BACKEND_URL=https://web-production-b1a1d.up.railway.app   # arma notification_url
FRONTEND_URL=https://frontend-production-dcb15.up.railway.app  # arma back_urls de Checkout Pro

# Frontend (servicio "frontend" en Railway — build-time, Vite)
VITE_MP_PUBLIC_KEY=APP_USR-...    # llave pública, para inicializar el SDK del Brick en el navegador
```

Ya documentadas en `.env.example` (sección MercadoPago).

---

## Otras reglas de negocio que tocan el pago (no son de MP en sí, pero afectan el monto)

Todas viven en `POST /api/orders` (`server/index.js:4783`), antes de crear la preferencia/orden:

- **Inscripción automática ($500):** se suma sola al comprar un paquete de clases (`class_limit >= 2`) si la alumna aún no está inscrita. El descuento aplicado (si hay código) **nunca** toca la inscripción, solo el plan base.
- **Clase Extra ($130):** solo comprable por quien ya está inscrita o tiene un paquete pendiente de pago. Si no, `403`.
- **Recargo de plataforma (4%):** solo en `paymentMethod === "card"`, se calcula sobre el total ya con descuento/inscripción incluidos, y se suma al total a cobrar (lo paga la alumna, no el estudio).
- **Orden pendiente duplicada:** no se puede crear una segunda orden `pending_payment`/`pending_verification` para el mismo plan mientras haya una viva.

---

## Referencias

- Specs de diseño originales: `docs/superpowers/specs/2026-06-27-mercadopago-card-payments-design.md`, `docs/superpowers/specs/2026-06-28-mercadopago-in-app-brick-design.md`.
- Plan de implementación: `docs/superpowers/plans/2026-06-27-mercadopago-card-payments.md`.
- Tests de la capa pura: `server/lib/__tests__/mercadopago.test.js` (19 casos — body de preferencia, body de pago con tarjeta, verificación de firma).
