# Carrito multi-ítem en el checkout (varios planes/clases en una compra) — Diseño

**Fecha:** 2026-06-28
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Motivo:** Hoy una orden = un plan. Una clienta que quería "1 paquete + 2 clases extra" tuvo que hacer 3 compras separadas. Se quiere un **carrito**: varios planes/clases con cantidad, en una sola orden y un solo pago.

---

## 1. Objetivo y alcance

Permitir que la clienta arme un **carrito** (varios renglones: plan + cantidad) y pague todo junto, con transferencia o tarjeta (Brick). En la aprobación se crean **todas** las membresías correspondientes.

**Alcance v1:** solo la **app de clientas** (`/app/checkout`). El POS de admin (venta en recepción) sigue 1×1. Pero la **aprobación** (webhook de tarjeta y verificación de transferencia por admin) **debe** soportar órdenes con renglones, porque las órdenes-carrito de transferencia las aprueba el admin.

**Fuera de alcance:** carrito en POS admin; mezclar productos (retail) con planes; suscripciones recurrentes.

### Reglas de negocio (confirmadas)
- **Cantidad por renglón** ≥ 1 (ej. 2 clases extra).
- **Descuento (código):** un solo código por orden, aplicado al **subtotal del carrito** (suma de renglones, antes de inscripción).
- **Inscripción:** se cobra **una sola vez** por orden, si la clienta la necesita y el carrito incluye un **paquete** (class_limit ≥ 2). Nunca por ítem.
- **Recargo tarjeta 4%** ("uso de plataforma"): sobre el **total final** (subtotal − descuento + inscripción). Igual que hoy.
- **Clase extra:** permitida si el carrito incluye un paquete (que inscribe) **o** la clienta ya está inscrita. Si no, se bloquea con mensaje.
- **Planes "no repetibles":** cantidad máx **1** en el carrito, y se bloquea si la clienta ya tiene ese plan activo (regla actual `findNonRepeatablePlanConflict`).

---

## 2. Modelo de datos

Nueva tabla (migración idempotente en `ensureSchema`):

```sql
CREATE TABLE IF NOT EXISTS order_plan_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price  DECIMAL(10,2) NOT NULL,   -- precio base del plan al momento de la compra
  line_total  DECIMAL(10,2) NOT NULL,   -- unit_price * quantity
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_plan_items_order ON order_plan_items(order_id);
```

Nota: es una tabla **separada** de `order_items` (que es para productos/retail del POS, FK a `products`). No se toca esa.

`orders` no cambia de columnas: `plan_id` se conserva como **plan principal** (el primer paquete del carrito, o el primer ítem) para compatibilidad/listados; `subtotal`, `discount_amount`, `inscription_amount`, `platform_fee`, `total_amount` siguen igual (totales de la orden completa). `memberships.order_id` ya existe (varias membresías pueden apuntar a la misma orden).

---

## 3. Backend

### 3.1 `POST /api/orders` (modificar, compatible hacia atrás)
- Acepta **`items: [{ planId, quantity }]`**. Si llega el viejo `planId` suelto (sin `items`), se trata como `items:[{planId, quantity:1}]`.
- Validaciones por ítem: plan existe y activo; cantidad ≥ 1; **no repetible → cantidad = 1** y sin conflicto activo (`findNonRepeatablePlanConflict` por cada plan no repetible); **clase extra** permitida solo si hay un paquete en el carrito o la clienta ya está inscrita.
- Precios: `unit_price = plan.price` (base; tarjeta no recibe el descuento efectivo/transferencia). `subtotal = Σ line_total`. Descuento sobre `subtotal`. Inscripción una vez (si aplica y hay paquete). 4% si tarjeta. `total = subtotal − descuento + inscripción + platformFee`.
- Inserta `orders` (con `plan_id` = plan principal) + N filas en `order_plan_items` dentro de la misma transacción.
- Respuesta: igual que hoy + `items` para el frontend. `mp_*`/Brick sin cambios (cobra `order.total_amount`).

### 3.2 Aprobación → crear membresías (multi-ítem)
Refactor: extraer un helper `createMembershipsForOrder(order, client)` usado por **ambos** caminos:
- `approveOrderFromMP(orderId, mpPaymentId)` (tarjeta/webhook).
- `PUT /api/admin/orders/:id/verify` (transferencia/efectivo).

Lógica del helper:
1. Lee `order_plan_items` de la orden. Si **no hay** renglones → comportamiento actual (1 membresía desde `order.plan_id`).
2. Si hay renglones → por cada renglón, por cada **unidad** (quantity), crea una membresía (`status='active'`, `start_date`, `end_date = calcMembershipEndDate(plan)`, `classes_remaining = plan.class_limit` (0→NULL), `order_id`).
3. Registra **un** `payments` por el total de la orden (como hoy), no por ítem.
4. Idempotencia: si la orden ya está `approved` o ya tiene membresías para esa orden, no duplica.

(La lógica de inscripción/descuento ya quedó en la orden; la aprobación solo materializa membresías.)

### 3.3 Sin cambios
Webhook, firma, `sync-mp`, `pay-card-token`, `cancel`, recargo 4%, columnas `mp_*`/`platform_fee`.

---

## 4. Frontend (app de clientas)

### 4.1 `Checkout.tsx` — carrito
- Estado `cart: { plan, quantity }[]` en vez de un solo `selectedPlan`.
- En el paso de selección: cada `PlanCard` permite **agregar al carrito** y ajustar **cantidad** (+/−). Resumen del carrito con renglones, subtotal, descuento, inscripción, 4% (si tarjeta) y total.
- Validaciones de UI espejo del backend (no repetible máx 1; aviso de clase extra). El backend es la fuente de verdad.
- `POST /orders` envía `items`. Resto del flujo igual: transferencia → datos bancarios + comprobante; tarjeta → `/app/pay/:id` (Brick).

### 4.2 `MyOrders.tsx`
- Mostrar los renglones de cada orden (plan × cantidad). El total ya viene en `total_amount`.

---

## 5. Admin
`PaymentsPage` / detalle de orden al **verificar transferencia**: mostrar los renglones (`order_plan_items`) para que el admin sepa qué está aprobando. Sin cambios al POS de venta.

---

## 6. Compatibilidad y migración
- Órdenes viejas (sin `order_plan_items`) siguen funcionando: la aprobación usa el camino de 1 plan.
- No se migran órdenes históricas.
- `plan_id` en `orders` se mantiene poblado (plan principal) para no romper listados/consultas existentes.

---

## 7. Pruebas
- Unit (backend, sin red): cálculo de totales del carrito (subtotal, descuento sobre subtotal, inscripción una vez, 4% tarjeta) y reglas (no repetible máx 1; clase extra requiere paquete/inscrita).
- `createMembershipsForOrder`: 1 paquete + 2 clases extra → 3 membresías (7 clases + 1 + 1); idempotente; orden sin items → 1 membresía.
- `npm run build` + `npm test` verdes.
- E2E prod: carrito (1 paquete + 2 clases extra) con tarjeta → Brick cobra el total → se crean 3 membresías; mismo con transferencia (admin verifica) → 3 membresías.

## 8. Archivos tocados
| Archivo | Cambio |
|---|---|
| `server/index.js` | tabla `order_plan_items`; `POST /orders` con `items` + validaciones; helper `createMembershipsForOrder`; usarlo en `approveOrderFromMP` y en `verify` |
| `server/lib/*` + `__tests__` | (opcional) extraer cálculo de totales a un helper puro testeable |
| `src/pages/client/Checkout.tsx` | carrito (estado, UI, cantidades, resumen, envío `items`) |
| `src/pages/client/MyOrders.tsx` | mostrar renglones |
| `src/pages/admin/payments/PaymentsPage.tsx` | mostrar renglones al verificar |
| `src/types/order.ts` | tipos de `items` |
