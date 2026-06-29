# Pago con tarjeta DENTRO de la app (MercadoPago Payment Brick) — Diseño

**Fecha:** 2026-06-28
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Reemplaza el flujo de:** `2026-06-27-mercadopago-card-payments-design.md` (Checkout Pro / redirección).
**Motivo:** la app es una **PWA `display:standalone`**. Con Checkout Pro, en iPhone instalado iOS abre el pago en Safari (rompe el contexto de la app) y al volver deja al usuario en el navegador, no en la app. El requisito del negocio es **pagar sin salir de la app, sin abrir navegador**.

---

## 1. Objetivo y alcance

Sustituir la **redirección a mercadopago.com** por el **Card Payment Brick** de MercadoPago: el formulario de tarjeta se renderiza dentro de la PWA (iframe seguro de MP). El cliente paga sin salir. Los datos de tarjeta los tokeniza MP en el navegador → **nunca pasan por nuestro servidor** (PCI SAQ-A).

En el mismo paquete se corrigen 3 defectos de UX de órdenes reportados:
- **#1** La insignia de estado `pending_payment` dice "Subir comprobante" incluso en tarjeta.
- **#2** No se puede **cancelar** una orden pendiente.
- **#3** Un pago **rechazado** se ve idéntico a "pendiente".

### Reglas de negocio (heredadas, bloqueadas)
- Contado: `installments: 1` (sin MSI). El backend **fuerza** 1, no confía en el cliente.
- Precio = base del plan (sin descuento efectivo/transferencia); los códigos de descuento sí aplican.
- Solo tarjeta (crédito/débito). El monto lo pone el **backend** desde la orden, nunca el cliente.

### Fuera de alcance
- No se toca el flujo de efectivo/transferencia (comprobante) ni la ruta admin `verify`.
- No se elimina el webhook ni `approveOrderFromMP` ni `sync-mp`: siguen como **fuente de verdad / respaldo idempotente**.

---

## 2. Flujo nuevo

```
Cliente elige plan + Tarjeta  →  POST /api/orders { paymentMethod:'card' }  (crea orden pending_payment)
   ▼  navega a /app/pay/:orderId  (DENTRO de la app, sin redirección externa)
Se monta el Card Payment Brick (SDK MP v2 + VITE_MP_PUBLIC_KEY)
   → cliente captura tarjeta; MP tokeniza en el navegador
   ▼ onSubmit(formData)
POST /api/orders/:id/pay-card-token { token, payment_method_id, issuer_id, payer{email,identification} }
   → backend: MP POST /v1/payments  (amount = order.total del server, installments=1)  [respuesta SÍNCRONA]
        approved   → approveOrderFromMP() → membresía activa → pantalla de éxito EN la app
        in_process → guarda estado → "pago en revisión"
        rejected   → guarda estado + detalle → la app muestra el motivo, permite otro intento
   ▼ (en paralelo) webhook /webhooks/mercadopago → respaldo idempotente (no duplica)
```

---

## 3. Variables de entorno

| Variable | Servicio | Valor | Estado |
|---|---|---|---|
| `VITE_MP_PUBLIC_KEY` | `frontend` (build-time, Vite) | `APP_USR-…` (Public Key, NO secreta) | staged ✅ |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `BACKEND_URL`, `FRONTEND_URL` | `web` | ya configurados | ✅ |

`FRONTEND_URL` ya no se usa para redirección de pago (los `back_urls` desaparecen del flujo tarjeta), pero se conserva para emails/links.

---

## 4. Backend (`server/`)

### 4.1 `server/lib/mercadopago.js` — nueva función
`createCardPayment({ amount, token, paymentMethodId, issuerId, installments=1, payer, description, orderId, orderNumber }, { backendUrl })` → `POST /v1/payments`:
- Body: `transaction_amount` (= amount del server), `token`, `payment_method_id`, `issuer_id`, `installments:1`,
  `description`, `external_reference: orderId`, `notification_url: ${backendUrl}/webhooks/mercadopago`,
  `statement_descriptor:'ESPACIO PILATES'`, `metadata:{order_id, order_number}`,
  `payer:{ email, identification }`.
- Header `X-Idempotency-Key: paytoken-${token.slice(0,24)}` (evita doble cargo del mismo token; un reintento usa token nuevo).
- Devuelve `{ id, status, status_detail }`. Lanza `Error` si `!res.ok`.

### 4.2 `POST /api/orders/:id/pay-card-token` (nuevo, authMiddleware)
1. `SELECT` la orden; valida `user_id === req.user.id` y `status==='pending_payment'` y `payment_method==='card'`.
2. `createCardPayment({ amount: order.total_amount, ... , installments:1 })`.
3. `UPDATE orders SET mp_payment_id, mp_payment_status, mp_status_detail, provider_synced_at`.
4. Según `status`:
   - `approved` → `await approveOrderFromMP(order.id, payment.id)`; responde `{ status:'approved' }`.
   - `in_process`/`pending` → `{ status:'pending' }`.
   - `rejected` → guarda `rejection_reason = mapeoDetalle(status_detail)`; responde `{ status:'rejected', detail, message }`.
5. Errores de MP → 502 con mensaje claro; la orden queda `pending_payment` (reintentable).

`mapeoDetalle(status_detail)`: tabla de `cc_rejected_*` → textos en español (fondos insuficientes, CVV inválido, etc.).

### 4.3 `POST /api/orders/:id/cancel` (nuevo, authMiddleware)
Valida `user_id === req.user.id` y `status==='pending_payment'`; `UPDATE orders SET status='cancelled', updated_at=NOW()`. Devuelve la orden. (No toca MP; una preferencia/intento abandonado no requiere acción.)

### 4.4 Sin cambios
Webhook, `approveOrderFromMP`, `syncPayment`, `sync-mp`, migraciones `mp_*`. El endpoint viejo `pay-with-card` (preferencia Checkout Pro) se **deja** por compatibilidad pero ya no se llama desde el frontend (se puede retirar después).

---

## 5. Frontend (`src/`)

### 5.1 SDK
Cargar `https://sdk.mercadopago.com/js/v2` bajo demanda (solo en la pantalla de pago). Init: `new MercadoPago(import.meta.env.VITE_MP_PUBLIC_KEY, { locale:'es-MX' })`.

### 5.2 Componente `CardPaymentBrick` + ruta `/app/pay/:orderId`
- Nueva página `src/pages/client/CardPayment.tsx` (ruta `/app/pay/:orderId`, bajo `ClientAuthGuard`).
- `GET /orders/:id`; si no es `card`/`pending_payment` → redirige a `/app/orders`.
- Monta el Brick `cardPayment` con `initialization:{ amount: order.total_amount }`.
- `callbacks.onSubmit({ formData })` → `POST /orders/:id/pay-card-token`; según respuesta:
  - approved → pantalla de éxito + `navigate('/app/orders?checkout=success')`.
  - pending → `navigate('/app/orders?checkout=pending')`.
  - rejected → muestra el motivo en la misma pantalla, permite reintentar (el Brick se mantiene).
- `onError` → toast.

### 5.3 `Checkout.tsx`
Flujo tarjeta: tras crear la orden (`onSuccess`), **en vez de** `window.location.href = mp_checkout_url` → `navigate('/app/pay/' + orderId)`. Se elimina el uso de `mp_checkout_url` en el cliente.

### 5.4 `MyOrders.tsx` (corrige #1, #2, #3)
- **#1** `STATUS_CONFIG.pending_payment.label` → **"Pendiente de pago"** (icono neutro). La acción la dan los botones.
- Reintentar pago (tarjeta) → `navigate('/app/pay/' + o.id)` (ya no usa `mp_checkout_url`).
- **#2** Botón **"Cancelar"** en órdenes `pending_payment` (cualquier método) → `POST /orders/:id/cancel` + invalidar `my-orders` + toast.
- **#3** En `rejected`, mostrar `rejection_reason` (ya existe el bloque; asegurar que se llena desde el backend).

### 5.5 `App.tsx`
Agregar ruta `/app/pay/:orderId` → `CardPayment`.

---

## 6. Pruebas
- `npm run build` (0 errores TS) + `npm test` verdes.
- Unit (backend): `createCardPayment` arma bien el body (amount del server, installments=1, external_reference, notification_url) — mock `fetch`. Cancel endpoint: transición y guardas de propiedad/estado.
- Sandbox opcional con tarjetas de prueba MP (APRO/OTHE) si se ponen credenciales TEST en local + un Public Key TEST.
- E2E producción: un cobro real pequeño desde la PWA → confirmar que NO abre navegador, que aprueba en-app y activa membresía; reintento tras rechazo; cancelar deja la orden `cancelled`.

## 7. Despliegue
- `VITE_MP_PUBLIC_KEY` en `frontend` (staged) entra en el próximo build.
- Push a `main` → rebuild de ambos servicios. Verificar la pantalla de pago en la PWA instalada (iOS + Android).

## 8. Archivos tocados
| Archivo | Cambio |
|---|---|
| `server/lib/mercadopago.js` | + `createCardPayment` |
| `server/index.js` | + `POST /orders/:id/pay-card-token`, + `POST /orders/:id/cancel`, + `mapeoDetalle` |
| `src/pages/client/CardPayment.tsx` | **Nuevo** — Brick + manejo de resultado |
| `src/pages/client/Checkout.tsx` | tarjeta → `navigate('/app/pay/:id')` (sin redirección externa) |
| `src/pages/client/MyOrders.tsx` | insignia, cancelar, reintento a `/app/pay`, motivo de rechazo |
| `src/App.tsx` | ruta `/app/pay/:orderId` |
| `server/lib/__tests__/mercadopago.test.js` | tests de `createCardPayment` |
