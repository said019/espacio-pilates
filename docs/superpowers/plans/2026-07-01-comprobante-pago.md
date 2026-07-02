# Comprobante de pago al aprobar un paquete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al aprobarse el pago de una orden (verificación admin o MercadoPago), la clienta recibe un comprobante de pago por email de marca, y puede verlo/imprimirlo desde "Mis órdenes".

**Architecture:** Sin tablas nuevas — la fila de `orders` ya es el snapshot (folio, montos congelados, renglones en `order_plan_items`). Un helper puro testeable (`server/lib/receipt.js`) arma el modelo del desglose; `emailService.js` lo renderiza con el layout de marca; `server/index.js` lo dispara en los 2 puntos de aprobación con claim atómico anti-duplicado (`orders.receipt_sent_at`); `MyOrders.tsx` renderiza el mismo desglose en un diálogo imprimible (los datos ya vienen en `GET /api/orders`).

**Tech Stack:** Node/Express + PostgreSQL (`server/index.js`), Resend vía `server/emailService.js`, Vitest (`server/lib/__tests__/`), React + shadcn/ui (`src/pages/client/MyOrders.tsx`).

**Spec:** `docs/superpowers/specs/2026-07-01-comprobante-pago-design.md`

**Entorno local para reproducciones:** backend `node server/index.js` (puerto 8090, BD `postgresql://localhost:5432/tep_vm` — está en `.env`), admin `espaciopilatesvm@gmail.com` / `EspacioVM2026!`. Sin `RESEND_API_KEY` en local, `sendEmail` es un no-op logueado — se verifica el intento por log y por la columna `receipt_sent_at`, no la entrega real.

---

### Task 1: Helper puro `buildReceiptModel` (TDD)

**Files:**
- Create: `server/lib/receipt.js`
- Test: `server/lib/__tests__/receipt.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `server/lib/__tests__/receipt.test.js` (mismo estilo que `cartPricing.test.js`):

```js
import { describe, it, expect } from "vitest";
import { buildReceiptModel, PAYMENT_METHOD_LABELS } from "../receipt.js";

describe("buildReceiptModel", () => {
  it("orden simple por transferencia: solo Subtotal en el desglose", () => {
    const m = buildReceiptModel({
      orderNumber: "ORD-001",
      items: [{ planName: "Paquete 9 Clases", quantity: 1, lineTotal: 1050 }],
      total: 1050,
      paymentMethod: "transfer",
    });
    expect(m.lines).toEqual([{ planName: "Paquete 9 Clases", quantity: 1, amount: 1050 }]);
    expect(m.breakdown).toEqual([{ label: "Subtotal", amount: 1050 }]);
    expect(m.total).toBe(1050);
    expect(m.methodLabel).toBe("Transferencia");
    expect(m.orderNumber).toBe("ORD-001");
  });

  it("carrito con inscripción, descuento y 4% tarjeta: filas condicionales en orden", () => {
    const m = buildReceiptModel({
      items: [
        { planName: "Paquete 9 Clases", quantity: 1, lineTotal: 1050 },
        { planName: "Clase Extra", quantity: 3, lineTotal: 390 },
      ],
      inscriptionAmount: 500,
      discountAmount: 100,
      platformFee: 73.6,
      total: 1913.6,
      paymentMethod: "card",
    });
    expect(m.breakdown.map((b) => b.label)).toEqual([
      "Subtotal",
      "Inscripción (pago único)",
      "Descuento",
      "Uso de plataforma (4% tarjeta)",
    ]);
    expect(m.breakdown[0].amount).toBe(1440); // 1050 + 390
    expect(m.breakdown[2].negative).toBe(true); // el descuento resta
    expect(m.methodLabel).toBe("Tarjeta");
    // Consistencia: subtotal + inscripción − descuento + fee = total
    expect(1440 + 500 - 100 + 73.6).toBeCloseTo(m.total, 2);
  });

  it("montos en cero NO agregan filas al desglose", () => {
    const m = buildReceiptModel({
      items: [{ planName: "Clase Suelta / Visita", quantity: 1, lineTotal: 250 }],
      total: 250,
      paymentMethod: "cash",
    });
    expect(m.breakdown).toHaveLength(1);
    expect(m.methodLabel).toBe("Efectivo");
  });

  it("método desconocido cae al string crudo; items vacíos no truenan", () => {
    const m = buildReceiptModel({ items: [], total: 0, paymentMethod: "oxxo" });
    expect(m.methodLabel).toBe("oxxo");
    expect(m.lines).toEqual([]);
    expect(m.breakdown[0]).toEqual({ label: "Subtotal", amount: 0 });
  });

  it("quantity y line_total llegan como strings de la BD y se normalizan a número", () => {
    const m = buildReceiptModel({
      items: [{ planName: "Clase Extra", quantity: "3", lineTotal: "390.00" }],
      total: 390,
      paymentMethod: "transfer",
    });
    expect(m.lines[0]).toEqual({ planName: "Clase Extra", quantity: 3, amount: 390 });
  });

  it("expone la nota de 'no es CFDI' y las etiquetas de método", () => {
    const m = buildReceiptModel({ items: [], total: 0, paymentMethod: "card" });
    expect(m.note).toMatch(/No es un comprobante fiscal \(CFDI\)/);
    expect(PAYMENT_METHOD_LABELS.transfer).toBe("Transferencia");
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run server/lib/__tests__/receipt.test.js`
Expected: FAIL — `Cannot find module '../receipt.js'` (o equivalente).

- [ ] **Step 3: Implementación mínima**

Crear `server/lib/receipt.js`:

```js
// Armado puro del comprobante de pago (sin red/DB) — testeable.
// items: [{ planName, quantity, lineTotal }]. El caller resuelve el fallback de
// órdenes viejas sin order_plan_items (1 renglón con el plan principal).
import { round2 } from "./cartPricing.js";

export const PAYMENT_METHOD_LABELS = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
};

export function buildReceiptModel({
  orderNumber = null,
  paidAt = null,
  items = [],
  inscriptionAmount = 0,
  discountAmount = 0,
  platformFee = 0,
  total = 0,
  paymentMethod = "",
} = {}) {
  const lines = items.map((it) => ({
    planName: String(it.planName || "Plan"),
    quantity: Math.max(1, Number(it.quantity) || 1),
    amount: round2(it.lineTotal),
  }));
  const itemsSubtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const breakdown = [{ label: "Subtotal", amount: itemsSubtotal }];
  if (Number(inscriptionAmount) > 0) breakdown.push({ label: "Inscripción (pago único)", amount: round2(inscriptionAmount) });
  if (Number(discountAmount) > 0) breakdown.push({ label: "Descuento", amount: round2(discountAmount), negative: true });
  if (Number(platformFee) > 0) breakdown.push({ label: "Uso de plataforma (4% tarjeta)", amount: round2(platformFee) });
  return {
    orderNumber,
    paidAt,
    lines,
    breakdown,
    total: round2(total),
    methodLabel: PAYMENT_METHOD_LABELS[paymentMethod] || String(paymentMethod || "—"),
    note: "Este comprobante es una constancia de pago emitida por Tu Espacio Pilates. No es un comprobante fiscal (CFDI).",
  };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run server/lib/__tests__/receipt.test.js`
Expected: 6 passed. Después `npm test` completo → **54 passed** (48 existentes + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add server/lib/receipt.js server/lib/__tests__/receipt.test.js
git commit -m "feat(comprobante): helper puro del desglose del recibo + tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Email de marca `sendPaymentReceipt`

**Files:**
- Modify: `server/emailService.js` (nueva función + export; el bloque de exports está al final del archivo)

- [ ] **Step 1: Agregar el import del helper**

Al inicio de `server/emailService.js`, después de las constantes existentes (`FROM_EMAIL`/`SITE_URL`/`LOGO_URL`, ~línea 16-18), agregar:

```js
import { buildReceiptModel } from "./lib/receipt.js";
```

(Nota: los imports en este archivo pueden ir arriba del todo, junto al bloque de Resend — colocarlo como primera línea de import del archivo es igualmente válido; lo importante es que sea top-level.)

- [ ] **Step 2: Agregar la función**

Antes del bloque `// ─── Exports ───` al final del archivo, agregar (usa los helpers existentes `h1`, `p`, `small`, `infoRow`, `infoTable`, `fmtDate`, `baseLayout`, `sendEmail` — todos definidos arriba en el mismo archivo):

```js
// ═══════════════════════════════════════════════════════════════════════════════
// ── COMPROBANTE DE PAGO (constancia informal, NO CFDI) ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function sendPaymentReceipt(opts) {
  const { to, name } = opts;
  const m = buildReceiptModel(opts);
  const fmtMoney = (n) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
  const lineRows = m.lines.map((l) =>
    infoRow(`${l.planName}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`, fmtMoney(l.amount))
  );
  const breakdownRows = m.breakdown.map((b) =>
    infoRow(b.label, `${b.negative ? "−" : ""}${fmtMoney(b.amount)}`)
  );
  const content = `
    ${h1("Comprobante de pago")}
    ${p(`Hola ${String(name || "Alumna").split(" ")[0]}, gracias por tu pago. Aquí tienes tu comprobante.`)}
    ${infoTable([
      infoRow("Folio", m.orderNumber || "—"),
      infoRow("Fecha de pago", fmtDate(m.paidAt)),
      infoRow("Método de pago", m.methodLabel),
    ])}
    ${infoTable([...lineRows, ...breakdownRows, infoRow("Total pagado", fmtMoney(m.total))])}
    ${small(m.note)}
  `;
  const html = baseLayout({
    preheader: `Comprobante de pago ${m.orderNumber || ""} — Tu Espacio Pilates`.trim(),
    content,
    ctaUrl: `${SITE_URL}/app/orders`,
    ctaText: "Ver mis órdenes",
  });
  await sendEmail({ to, subject: `Comprobante de pago ${m.orderNumber || ""} — Tu Espacio Pilates`.replace("  ", " "), html });
}
```

- [ ] **Step 3: Exportarla**

En el bloque `// ─── Exports ───` al final, agregar `sendPaymentReceipt,` a la lista de exports.

- [ ] **Step 4: Smoke test del render (sin enviar)**

Run:
```bash
node --input-type=module -e "
import { buildReceiptModel } from './server/lib/receipt.js';
const m = buildReceiptModel({ orderNumber: 'ORD-1', paidAt: new Date().toISOString(), items: [{ planName: 'Paquete 9 Clases', quantity: 1, lineTotal: 1050 }], inscriptionAmount: 500, total: 1550, paymentMethod: 'transfer' });
console.log('model ok:', m.breakdown.length === 2 && m.methodLabel === 'Transferencia');
"
node --check server/emailService.js && echo "emailService sintaxis OK"
```
Expected: `model ok: true` y `emailService sintaxis OK`. (En local sin `RESEND_API_KEY` no se puede enviar de verdad; la verificación de disparo real es de la Task 3.)

- [ ] **Step 5: Commit**

```bash
git add server/emailService.js
git commit -m "feat(comprobante): email de marca 'Comprobante de pago' (sendPaymentReceipt)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Disparo en los 2 puntos de aprobación + anti-duplicado

**Files:**
- Modify: `server/index.js` — 4 zonas: (a) import de emailService (~línea 28-36), (b) migración junto a `inscription_amount` (~línea 1423), (c) helper nuevo cerca de `createMembershipsForOrder`/`approveOrderFromMP` (~línea 5320-5375), (d) hooks en `approveOrderFromMP` (post-commit, ~línea 5468) y en `PUT /api/admin/orders/:id/verify` (bloque `justApproved`, ~línea 13058-13062).

Los números de línea pueden haber corrido — ubicar por contenido (grep de las anclas citadas), no por número.

- [ ] **Step 1: Import**

En el bloque de import de `./emailService.js` (busca `from "./emailService.js"`), agregar `sendPaymentReceipt,` a la lista.

- [ ] **Step 2: Migración idempotente**

Inmediatamente después de la línea de migración de `inscription_amount` (busca `ADD COLUMN IF NOT EXISTS inscription_amount`), agregar:

```js
    // ── orders: marca de comprobante de pago enviado (anti-duplicado del recibo) ──
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ`).catch(() => { });
```

- [ ] **Step 3: Helper de envío con claim atómico**

Inmediatamente después del cierre de la función `createMembershipsForOrder` (busca `async function createMembershipsForOrder` y su `}` final, justo antes del comentario de `approveOrderFromMP`), agregar:

```js
// ─── Comprobante de pago (constancia informal) ───────────────────────────────
// Envía el comprobante de una orden APROBADA exactamente una vez, desde cualquier
// camino de aprobación (verify admin o MercadoPago). Claim atómico sobre
// orders.receipt_sent_at: si otro proceso ya lo tomó, no reenvía. Sin user_id
// (walk-in POS) o sin email (registro solo con teléfono) NO se envía NI se
// reclama — así un futuro re-disparo manual sigue siendo posible. Es
// transaccional: NO lo gatea areEmailNotificationsEnabled(). Fire-and-forget:
// nunca rompe la aprobación.
async function sendReceiptForApprovedOrder(order) {
  try {
    if (!order?.id || !order.user_id) return;
    const uRes = await pool.query("SELECT email, display_name FROM users WHERE id = $1", [order.user_id]);
    const u = uRes.rows[0];
    if (!u?.email) return;
    const claim = await pool.query(
      "UPDATE orders SET receipt_sent_at = NOW() WHERE id = $1 AND receipt_sent_at IS NULL RETURNING id",
      [order.id]
    );
    if (!claim.rows.length) return; // ya se envió antes
    const itemsRes = await pool.query(
      `SELECT i.quantity, i.line_total, p.name AS plan_name
         FROM order_plan_items i JOIN plans p ON p.id = i.plan_id
        WHERE i.order_id = $1 ORDER BY i.created_at`,
      [order.id]
    );
    let items = itemsRes.rows.map((r) => ({ planName: r.plan_name, quantity: r.quantity, lineTotal: r.line_total }));
    if (!items.length && order.plan_id) {
      // Orden vieja de 1 plan (sin renglones): el subtotal incluye la inscripción,
      // así que el renglón del plan es subtotal − inscripción.
      const pRes = await pool.query("SELECT name FROM plans WHERE id = $1", [order.plan_id]);
      items = [{
        planName: pRes.rows[0]?.name || "Plan",
        quantity: 1,
        lineTotal: Number(order.subtotal || 0) - Number(order.inscription_amount || 0),
      }];
    }
    await sendPaymentReceipt({
      to: u.email,
      name: u.display_name || "Alumna",
      orderNumber: order.order_number,
      paidAt: order.paid_at || new Date().toISOString(),
      items,
      inscriptionAmount: Number(order.inscription_amount || 0),
      discountAmount: Number(order.discount_amount || 0),
      platformFee: Number(order.platform_fee || 0),
      total: Number(order.total_amount || 0),
      paymentMethod: order.payment_method,
    });
  } catch (e) {
    console.error("[Receipt] comprobante de pago:", e.message);
  }
}
```

- [ ] **Step 4: Hook en `approveOrderFromMP`**

En el bloque post-commit de `approveOrderFromMP` (busca `if (order.user_id) triggerWalletPassSync(order.user_id, "mp_payment_approved");`), agregar **una línea antes** de esa línea:

```js
      sendReceiptForApprovedOrder(order).catch(() => { });
```

- [ ] **Step 5: Hook en el verify del admin**

En `PUT /api/admin/orders/:id/verify`, localizar el bloque de puntos de lealtad (busca el comentario `// Award loyalty points for purchase`, que está gated por `if (justApproved && order.user_id ...)`). Agregar **inmediatamente antes** de ese comentario:

```js
    // Comprobante de pago (una sola vez; re-verificar no lo duplica)
    if (justApproved) sendReceiptForApprovedOrder(order).catch(() => { });
```

- [ ] **Step 6: Verificar sintaxis + regresión**

Run: `node --check server/index.js && npm test`
Expected: sintaxis OK y **54 passed** (48 previos + 6 de la Task 1; esta task no toca `server/lib/*`).

- [ ] **Step 7: Reproducción local end-to-end (incluye anti-duplicado)**

Levantar el server local (`node server/index.js`, espera el log `🚀`). Vía HTTP + psql:
1. Registrar clienta de prueba **con email** (`POST /api/auth/register`: `displayName`, `phone` de 10 dígitos único, `password`, `email`, `acceptsTerms: true`).
2. Login admin (`POST /api/auth/login`, `{"identifier":"espaciopilatesvm@gmail.com","password":"EspacioVM2026!"}`).
3. Crear orden de la clienta (`POST /api/orders` con `{planId, paymentMethod: "transfer"}` — un plan activo de `GET /api/plans`).
4. Aprobar como admin: `PUT /api/admin/orders/:id/verify` → 200.
5. `psql "postgresql://localhost:5432/tep_vm" -c "SELECT receipt_sent_at FROM orders WHERE id='<id>'"` → **NOT NULL**, y en el log del server aparece el intento de email (en local: línea de skip por `RESEND_API_KEY` vacío) **sin** stack trace de `[Receipt]`.
6. **Anti-duplicado:** guardar el valor de `receipt_sent_at`, re-llamar `verify` (→ 200), y confirmar que `receipt_sent_at` **no cambió** (mismo timestamp = no se reclamó de nuevo → no se reenvió).
7. Limpiar los datos de prueba (orden, membresías de la orden, referral_codes, loyalty_transactions, usuaria — en orden FK-safe) y matar el server.

- [ ] **Step 8: Commit**

```bash
git add server/index.js
git commit -m "feat(comprobante): enviarlo al aprobar el pago (verify + MercadoPago) con anti-duplicado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: "Ver comprobante" imprimible en Mis órdenes

**Files:**
- Modify: `src/pages/client/MyOrders.tsx` (archivo completo tiene ~190 líneas; anclas por contenido)

- [ ] **Step 1: Imports y estado**

En la línea 1, agregar `useState`:

```tsx
import { useState } from "react";
```

En el import de lucide-react (busca `from "lucide-react"`), agregar `FileText, Printer` a la lista. Después del import de `Button`, agregar:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
```

Dentro del componente `MyOrders`, junto a los otros hooks (después de `const checkoutResult = ...`), agregar:

```tsx
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);
```

- [ ] **Step 2: Botón en órdenes aprobadas**

Dentro del `orders.map((o) => ...)`, después del bloque `{o.status === "pending_payment" && (...)}` y antes de `{o.status === "pending_verification" && (...)}`, agregar:

```tsx
                    {o.status === "approved" && (
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={() => setReceiptOrder(o)}>
                          <FileText size={14} className="mr-2" />Ver comprobante
                        </Button>
                      </div>
                    )}
```

- [ ] **Step 3: Diálogo imprimible**

Justo antes del cierre `</div>` del contenedor `className="space-y-4"` (después del cierre del bloque de la lista de órdenes), agregar:

```tsx
          {/* ── Comprobante de pago (vista imprimible) ── */}
          <Dialog open={!!receiptOrder} onOpenChange={(v) => !v && setReceiptOrder(null)}>
            <DialogContent className="max-w-md">
              <style>{`@media print { body * { visibility: hidden; } .receipt-print, .receipt-print * { visibility: visible; } .receipt-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
              {receiptOrder && (
                <div className="receipt-print space-y-4">
                  <DialogHeader>
                    <DialogTitle>Comprobante de pago</DialogTitle>
                  </DialogHeader>
                  <div className="text-center space-y-0.5">
                    <p className="font-semibold text-[#1A1A1A]">Tu Espacio Pilates · Villa Magna</p>
                    {receiptOrder.order_number && (
                      <p className="text-xs font-mono text-[#8C6B6F]">Folio {receiptOrder.order_number}</p>
                    )}
                    <p className="text-xs text-[#3D3A3A]">
                      {format(new Date(receiptOrder.paid_at || receiptOrder.updated_at || receiptOrder.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#F0D0D5] divide-y divide-[#F0D0D5] text-sm">
                    {(Array.isArray(receiptOrder.items) && receiptOrder.items.length
                      ? receiptOrder.items.map((it: any) => ({
                          label: `${it.plan_name}${Number(it.quantity) > 1 ? ` × ${it.quantity}` : ""}`,
                          amount: Number(it.line_total),
                        }))
                      : [{
                          label: receiptOrder.plan_name,
                          amount: Number(receiptOrder.subtotal) - Number(receiptOrder.inscription_amount || 0),
                        }]
                    ).map((l, i) => (
                      <div key={i} className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">{l.label}</span>
                        <span className="tabular-nums">${l.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    {Number(receiptOrder.inscription_amount) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Inscripción (pago único)</span>
                        <span className="tabular-nums">${Number(receiptOrder.inscription_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {Number(receiptOrder.discount_amount) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Descuento</span>
                        <span className="tabular-nums">−${Number(receiptOrder.discount_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {Number(receiptOrder.platform_fee) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Uso de plataforma (4% tarjeta)</span>
                        <span className="tabular-nums">${Number(receiptOrder.platform_fee).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between px-3 py-2 font-semibold">
                      <span>
                        Total pagado ({receiptOrder.payment_method === "cash" ? "Efectivo" : receiptOrder.payment_method === "transfer" ? "Transferencia" : "Tarjeta"})
                      </span>
                      <span className="tabular-nums">${Number(receiptOrder.total_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-[#8C6B6F] leading-snug">
                    Este comprobante es una constancia de pago emitida por Tu Espacio Pilates. No es un comprobante fiscal (CFDI).
                  </p>
                  <Button size="sm" className="w-full print:hidden" onClick={() => window.print()}>
                    <Printer size={14} className="mr-2" />Imprimir / Guardar PDF
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
```

(Notas: el CSS de impresión usa `visibility` para que al imprimir solo se vea el contenido del comprobante — el diálogo de Radix vive en un portal sobre `body`, así que la regla `body * { visibility: hidden }` + `.receipt-print` visible funciona. El botón usa la variante `print:hidden` de Tailwind. El renglón fallback para órdenes viejas sin `items` replica la misma resta subtotal−inscripción que el backend.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`, sin errores nuevos atribuibles a `MyOrders.tsx` (hay errores TS pre-existentes en `supabase/client.ts`/`Index.tsx`/`Auth.tsx` — fuera de alcance; el build de Vite no corre tsc y debe salir limpio).

- [ ] **Step 5: Commit**

```bash
git add src/pages/client/MyOrders.tsx
git commit -m "feat(comprobante): 'Ver comprobante' imprimible en Mis órdenes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Verificación final e integración

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Suite completa + build**

Run: `npm test && npm run build`
Expected: **54 passed**, build `✓`.

- [ ] **Step 2: Verificación visual en navegador**

Levantar backend (`node server/index.js`) y front (`npx vite --port 5173` — el 8080 puede estar ocupado por otro proyecto y el CORS del backend solo permite 5173). Con una clienta de prueba que tenga una orden aprobada (crear + aprobar como en la Task 3 Step 7):
- Login como la clienta → "Mis órdenes" → la orden aprobada muestra **"Ver comprobante"**.
- Abrirlo: folio, fecha, renglones, desglose condicional y total correctos; nota "No es un comprobante fiscal (CFDI)" visible.
- Botón "Imprimir / Guardar PDF" presente (no hace falta imprimir de verdad — basta confirmar que el diálogo abre y el contenido es correcto).
- Limpiar datos de prueba y matar ambos servers al terminar.

- [ ] **Step 3: Estado de git**

Run: `git log --oneline -8 && git status --short`
Expected: 4 commits nuevos de este plan sobre el spec commit (`658a2de`); working tree limpio, sin archivos de prueba sueltos.

**No hacer push** — dejar los commits locales y preguntar a Said antes de subir (hay además 2 commits previos sin subir: quitar wallet `8520d00` y el spec `658a2de`).

---

## Self-Review

- **Cobertura del spec:** §2.1 (email) → Task 2. §2.2 (2 puntos de disparo + siempre-que-hay-email + sin destinatario no reclama) → Task 3 Steps 3-5 (el helper implementa exactamente esas reglas). §2.3 (migración + claim) → Task 3 Steps 2-3. §3 (vista app + imprimir) → Task 4. §4 (unit del helper puro, e2e con re-aprobación, build/test, visual) → Tasks 1, 3 Step 7, 5. Sin huecos.
- **Placeholders:** ninguno — cada paso de código trae el bloque completo.
- **Consistencia de tipos/nombres:** `buildReceiptModel` (Task 1) se consume con la misma firma en Task 2 (`sendPaymentReceipt` le pasa `opts` con `items/inscriptionAmount/discountAmount/platformFee/total/paymentMethod/orderNumber/paidAt`) y el caller de Task 3 arma exactamente ese objeto. Los campos snake_case de la BD (`line_total`, `plan_name`) se mapean a camelCase en el caller (Task 3 Step 3) antes de entrar al helper. La resta `subtotal − inscription_amount` del fallback legacy es idéntica en backend (Task 3) y frontend (Task 4).
- **Conteo de tests:** 48 actuales + 6 nuevos = 54 — usado consistentemente en Tasks 1, 3 y 5.
