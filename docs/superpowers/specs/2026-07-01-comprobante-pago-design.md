# Comprobante de pago al aprobar un paquete — Diseño

**Fecha:** 2026-07-01
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Motivo:** La dueña quiere que cada clienta reciba un comprobante de pago cuando compra un paquete nuevo. Hoy el email de "Membresía activada" es solo de bienvenida (plan, vigencia) — no incluye ningún desglose de dinero, y en la app MyOrders solo se ve el total. No existe comprobante formal en ningún canal.

---

## 1. Objetivo y alcance

Al **aprobarse el pago** de una orden (cualquier origen), la clienta recibe un **comprobante de pago informal** por **email de marca**, y puede **verlo/imprimirlo** desde "Mis órdenes" en la app.

**Decisiones confirmadas con la dueña (2026-07-01):**
- **Canal:** email (Resend, ya operativo) + vista en la app. **NO WhatsApp** — el número está con envíos atascados en `PENDING` (ver [[notification-channels-gotcha]] / sesión 2026-07-01) y los comprobantes automatizados elevan el riesgo de baneo. **NO push** (no transporta documentos).
- **Formato:** HTML de marca en el correo + diálogo imprimible en la app (la clienta guarda PDF con la impresión del navegador). **Sin librería de PDF** — cero dependencias nuevas.
- **Fiscal:** comprobante **informal** (constancia de pago). NO es CFDI; el documento lo dice explícitamente.
- **Disparador:** aprobación del pago desde **cualquier origen**: verificación manual del admin (transferencia/efectivo) y aprobación de MercadoPago (tarjeta — webhook y Brick).

**Enfoque elegido (A):** renderizar el comprobante **desde la fila de `orders`** — que ya es el snapshot perfecto (montos congelados al comprar, folio = `order_number`, renglones en `order_plan_items`). Se descartó una tabla `receipts` (duplicaría datos, YAGNI) y el PDF adjunto (dependencia innecesaria).

**Fuera de alcance:** CFDI/facturación fiscal, WhatsApp, reenvío retroactivo a órdenes históricas (las viejas aprobadas SÍ pueden ver su comprobante en la app, porque se renderiza de datos existentes), membresías asignadas manualmente por admin sin orden (no hay pago/monto que comprobar — si la dueña lo quiere después, es un diseño aparte).

---

## 2. Backend (`server/index.js` + `server/emailService.js`)

### 2.1 Email `sendPaymentReceipt` (nuevo, en `emailService.js`)
Nueva función con el mismo `baseLayout` de marca que los demás correos. Recibe `{ to, name, orderNumber, paidAt, items, subtotal, inscriptionAmount, discountAmount, platformFee, total, paymentMethod }` y renderiza:
- Encabezado "Comprobante de pago" + folio (`order_number`) + fecha de pago.
- Tabla de renglones: nombre del plan × cantidad → importe (`line_total`). Para órdenes viejas sin `order_plan_items`, un solo renglón con el plan principal y el subtotal.
- Desglose condicional: subtotal; "Inscripción (pago único)" solo si `inscription_amount > 0`; "Descuento" (negativo) solo si `discount_amount > 0`; "Uso de plataforma (4% tarjeta)" solo si `platform_fee > 0`; **Total pagado** destacado.
- Método de pago en español: transferencia / efectivo / tarjeta.
- Nota fija: *"Este comprobante es una constancia de pago emitida por Tu Espacio Pilates. No es un comprobante fiscal (CFDI)."*
- CTA a `/app/orders`.

### 2.2 Disparo en los 2 puntos de aprobación
- `PUT /api/admin/orders/:id/verify` — dentro del bloque `justApproved` donde ya se envían las notificaciones (~línea 13020).
- `approveOrderFromMP` — junto al `sendMembershipActivated` existente (~línea 5441).

En ambos: se consulta `order_plan_items` de la orden (fallback: plan principal ×1) y se llama `sendPaymentReceipt` **fire-and-forget** (`.catch(console.error)`) — un fallo del email nunca rompe la aprobación.

**El comprobante se envía SIEMPRE que hay email** — es transaccional, NO se apaga con el switch "Recordatorios por email" (`areEmailNotificationsEnabled()` no lo gatea, a diferencia del correo de bienvenida de membresía).

**Sin destinatario → no se envía ni se reclama:** si la orden no tiene `user_id` (walk-in POS) o la clienta no tiene email (el registro solo con teléfono es válido), se omite el envío **sin** tomar el claim de `receipt_sent_at` — así, si después se le agrega email a la cuenta, un futuro re-disparo manual podría enviarlo. La clienta sin email igual puede ver/imprimir su comprobante en la app (§3).

### 2.3 Anti-duplicado: `orders.receipt_sent_at`
Migración idempotente: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ`.
Patrón claim-then-send (race-safe, mismo espíritu que `class_reminder_sent`):
```sql
UPDATE orders SET receipt_sent_at = NOW() WHERE id = $1 AND receipt_sent_at IS NULL RETURNING id
```
Si no devuelve fila → ya se envió → no reenviar. Esto cubre que `verify` es re-ejecutable (re-aprobar no duplica el comprobante) y que webhook + Brick pueden aprobar la misma orden.

---

## 3. Frontend (`src/pages/client/MyOrders.tsx`)

En cada orden con `status === "approved"`, botón **"Ver comprobante"** que abre un `Dialog` con:
- Logo/nombre del estudio, folio, fecha de pago, nombre de la clienta.
- El mismo desglose del email (renglones de `o.items`, subtotal, inscripción/descuento/4% condicionales, total, método). **Todos los datos ya vienen** en `GET /api/orders` (`o.*` + `items`) — no se toca el backend para esta vista.
- Botón **"Imprimir / Guardar PDF"** → `window.print()` con CSS `@media print` que oculta todo excepto el contenido del comprobante.
- La misma nota "no es CFDI".

---

## 4. Pruebas
- Unit (`server/lib/__tests__/`): helper puro de armado del desglose del comprobante (renglones + condicionales de inscripción/descuento/fee + etiquetas de método) — extraer a `server/lib/receipt.js` para testearlo sin red, siguiendo el patrón de `cartPricing.js`.
- Reproducción local end-to-end: crear orden (transfer) → aprobar → confirmar 1 intento de envío y `receipt_sent_at` poblado → **re-aprobar → confirmar que NO reintenta** (claim ya tomado). En local sin `RESEND_API_KEY` el email es no-op logueado — se verifica el log y la columna, no la entrega.
- `npm run build` + `npm test` verdes; verificación visual del diálogo en navegador (orden aprobada → Ver comprobante → desglose correcto → vista de impresión).

## 5. Archivos tocados
| Archivo | Cambio |
|---|---|
| `server/emailService.js` | nueva función `sendPaymentReceipt` (HTML de marca) |
| `server/lib/receipt.js` (nuevo) + `__tests__/receipt.test.js` | helper puro del desglose, testeado |
| `server/index.js` | migración `receipt_sent_at`; hook en `verify` y en `approveOrderFromMP` con claim anti-duplicado |
| `src/pages/client/MyOrders.tsx` | botón "Ver comprobante" + diálogo imprimible |
