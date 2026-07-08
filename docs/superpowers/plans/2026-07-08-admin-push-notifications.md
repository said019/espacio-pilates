# Notificaciones push para admin — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las cuentas admin/super_admin reciban Web Push cuando se completa una venta o cuando queda una orden pendiente por revisar, con un toggle nuevo en el panel para activarlo, reutilizando toda la infraestructura de push ya existente.

**Architecture:** Dos funciones puras nuevas en `server/lib/push.js` (mensajes de venta/pendiente), un helper de fan-out `sendPushToAdmins()` en `server/index.js` (mismo patrón que `sendPushToUser`), 5 puntos de disparo (2 de venta, 3 de pendiente) y un botón-campana nuevo en `AdminLayout.tsx` que reutiliza el hook `usePushNotifications` ya existente sin modificarlo.

**Tech Stack:** Node/Express, `web-push` (VAPID), PostgreSQL (`pg`), React, vitest.

Diseño completo: `docs/superpowers/specs/2026-07-08-admin-push-notifications-design.md`.

---

### Task 1: Mensajes puros de push admin (TDD)

**Files:**
- Modify: `server/lib/push.js`
- Test: `server/lib/__tests__/push.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Añade al final de `server/lib/__tests__/push.test.js` (después del último `describe("sendWebPush", ...)`, respetando el import existente en la línea 12-18):

Primero actualiza el bloque de import (líneas 12-18) para incluir las dos funciones nuevas:

```js
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
  buildAdminSaleMessage,
  buildAdminPendingMessage,
} from "../push.js";
```

Luego añade al final del archivo:

```js

describe("buildAdminSaleMessage", () => {
  it("arma título y cuerpo con nombre y plan", () => {
    const msg = buildAdminSaleMessage({ clientName: "Ana López", planName: "Paquete 9 clases" });
    expect(msg).toEqual({
      title: "🎉 Nueva venta",
      body: "Ana López compró Paquete 9 clases",
    });
  });
});

describe("buildAdminPendingMessage", () => {
  it("mensaje de comprobante subido (reason: proof)", () => {
    const msg = buildAdminPendingMessage({ clientName: "Ana López", reason: "proof" });
    expect(msg).toEqual({
      title: "📋 Pendiente por revisar",
      body: "Ana López subió su comprobante — pendiente de revisar",
    });
  });
  it("mensaje de pago en efectivo (reason: cash)", () => {
    const msg = buildAdminPendingMessage({ clientName: "Ana López", reason: "cash" });
    expect(msg).toEqual({
      title: "📋 Pendiente por revisar",
      body: "Ana López eligió pagar en efectivo — pendiente de confirmar",
    });
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run server/lib/__tests__/push.test.js`
Expected: FAIL — `buildAdminSaleMessage is not a function` / `buildAdminPendingMessage is not a function`

- [ ] **Step 3: Implementar las funciones**

Añade al final de `server/lib/push.js` (después de `sendWebPush`, línea 45):

```js

// Mensajes fijos para push del lado admin — no pasan por notification_templates
// (ese sistema es editable desde Configuración y es solo para clientas).
// server/index.js decide desde dónde y cuándo llamarlos.
export function buildAdminSaleMessage({ clientName, planName }) {
  return {
    title: "🎉 Nueva venta",
    body: `${clientName} compró ${planName}`,
  };
}

export function buildAdminPendingMessage({ clientName, reason }) {
  const body = reason === "cash"
    ? `${clientName} eligió pagar en efectivo — pendiente de confirmar`
    : `${clientName} subió su comprobante — pendiente de revisar`;
  return { title: "📋 Pendiente por revisar", body };
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run server/lib/__tests__/push.test.js`
Expected: PASS — todos los tests del archivo, incluidos los 3 nuevos.

- [ ] **Step 5: Commit**

```bash
git add server/lib/push.js server/lib/__tests__/push.test.js
git commit -m "feat(push): mensajes puros de venta/pendiente para notificaciones admin"
```

---

### Task 2: Helper `sendPushToAdmins` (fan-out a admin/super_admin)

**Files:**
- Modify: `server/index.js:20-26` (import), y añadir la función nueva junto a `sendPushToUser` (después de la línea 10102, que hoy es el cierre de `sendPushToUser`).

- [ ] **Step 1: Ampliar el import de `./lib/push.js`**

En `server/index.js`, el import actual (líneas 20-26) es:

```js
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
} from "./lib/push.js";
```

Reemplázalo por:

```js
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
  buildAdminSaleMessage,
  buildAdminPendingMessage,
} from "./lib/push.js";
```

- [ ] **Step 2: Añadir `sendPushToAdmins` después de `sendPushToUser`**

Localiza el cierre de `sendPushToUser` en `server/index.js` (termina así, alrededor de la línea 10102):

```js
    return { sent, failed, pruned };
  } catch (e) {
    console.error("[sendPushToUser]", e.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}
```

Justo después de esa función (antes del comentario `// Versión que reutiliza las plantillas de notificación...` que precede a `sendConfiguredPushTemplate`), inserta:

```js

// Fan-out a TODAS las cuentas admin/super_admin suscritas (no filtra por
// preferencia individual — el propio toggle en el panel admin ES la
// preferencia). Best-effort, igual que sendPushToUser: nunca lanza, nunca
// bloquea al caller.
async function sendPushToAdmins({ title, body, url = "/admin/dashboard", tag } = {}) {
  if (!isPushConfigured()) return { sent: 0, failed: 0, pruned: 0 };
  try {
    const subs = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN users u ON u.id = ps.user_id
        WHERE u.role IN ('admin', 'super_admin')`
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
          console.error("[Push admin] send error:", err?.statusCode || err?.message);
        }
      }
    }
    return { sent, failed, pruned };
  } catch (e) {
    console.error("[sendPushToAdmins]", e.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}
```

No lleva test dedicado — sigue el mismo patrón que `sendPushToUser` (que tampoco lo tiene), documentado así en el spec de diseño. Se verifica indirectamente en la Task 6 (verificación manual end-to-end).

- [ ] **Step 3: Verificar que el server arranca sin errores**

Run: `node --check server/index.js`
Expected: sin salida (sintaxis válida). Si tienes el server corriendo localmente, reinícialo y confirma que no hay errores en el log de arranque.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(push): helper sendPushToAdmins para fan-out a cuentas admin/super_admin"
```

---

### Task 3: Disparar "venta completada" en los 2 puntos de aprobación

**Files:**
- Modify: `server/index.js:5524` (dentro de `approveOrderFromMP`) y `server/index.js:13257` (dentro de `PUT /api/admin/orders/:id/verify`)

- [ ] **Step 1: Insertar en `approveOrderFromMP`**

Localiza este bloque (ya existente, dentro de `approveOrderFromMP`, alrededor de la línea 5524):

```js
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna", plan: planRow.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] MP approve:", e.message));
        }
      }
      sendReceiptForApprovedOrder(order).catch(() => { });
```

Reemplázalo por (agrega el push admin justo después del push de la clienta, todavía dentro del `if (planRow && u) { ... }`):

```js
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna", plan: planRow.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] MP approve:", e.message));
          sendPushToAdmins({
            ...buildAdminSaleMessage({ clientName: u.display_name || "Alumna", planName: planRow.name || "un plan" }),
            url: "/admin/dashboard",
            tag: `admin_sale_${order.id}`,
          }).catch((e) => console.error("[Push admin] MP approve:", e.message));
        }
      }
      sendReceiptForApprovedOrder(order).catch(() => { });
```

- [ ] **Step 2: Insertar en `PUT /api/admin/orders/:id/verify`**

Localiza este bloque (ya existente, alrededor de la línea 13257):

```js
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna",
              plan: plan.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] admin order verify:", e.message));
        }
      } catch (emailErr) {
```

Reemplázalo por:

```js
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna",
              plan: plan.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] admin order verify:", e.message));
          sendPushToAdmins({
            ...buildAdminSaleMessage({ clientName: u.display_name || "Alumna", planName: plan.name || "un plan" }),
            url: "/admin/dashboard",
            tag: `admin_sale_${order.id}`,
          }).catch((e) => console.error("[Push admin] order verify:", e.message));
        }
      } catch (emailErr) {
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(push): avisar a admin cuando se completa una venta (tarjeta/webhook y verificación manual)"
```

---

### Task 4: Disparar "pendiente por revisar" en los 3 puntos de origen

**Files:**
- Modify: `server/index.js:5057` (dentro de `POST /api/orders/:id/proof`), `server/index.js:4756` (dentro de `createCartOrder`), `server/index.js:4963` (dentro de `POST /api/orders`, camino de 1 plan)

- [ ] **Step 1: Insertar en `POST /api/orders/:id/proof` (comprobante de transferencia)**

Localiza este bloque (ya existente, alrededor de la línea 5054):

```js
    await pool.query(
      "UPDATE orders SET status = 'pending_verification', paid_at = COALESCE(paid_at, NOW()) WHERE id = $1",
      [req.params.id]
    );
    return res.json({ message: "Comprobante recibido — estamos verificando tu pago" });
```

Reemplázalo por:

```js
    await pool.query(
      "UPDATE orders SET status = 'pending_verification', paid_at = COALESCE(paid_at, NOW()) WHERE id = $1",
      [req.params.id]
    );
    pool.query("SELECT display_name FROM users WHERE id = $1", [req.userId])
      .then((r) => sendPushToAdmins({
        ...buildAdminPendingMessage({ clientName: r.rows[0]?.display_name || "Alumna", reason: "proof" }),
        url: "/admin/payments?tab=pending",
        tag: `admin_pending_${req.params.id}`,
      }))
      .catch((e) => console.error("[Push admin] proof uploaded:", e.message));
    return res.json({ message: "Comprobante recibido — estamos verificando tu pago" });
```

- [ ] **Step 2: Insertar en `createCartOrder` (efectivo, carrito multi-plan)**

Localiza este bloque (ya existente, alrededor de la línea 4754):

```js
    await client.query("COMMIT");

    // Tarjeta: preferencia de MP (por compatibilidad) — el Brick usa total_amount
    let mp_checkout_url = null;
```

Reemplázalo por:

```js
    await client.query("COMMIT");

    if (paymentMethod === "cash") {
      pool.query("SELECT display_name FROM users WHERE id = $1", [req.userId])
        .then((r) => sendPushToAdmins({
          ...buildAdminPendingMessage({ clientName: r.rows[0]?.display_name || "Alumna", reason: "cash" }),
          url: "/admin/payments?tab=pending",
          tag: `admin_pending_${order.id}`,
        }))
        .catch((e) => console.error("[Push admin] cash order (cart):", e.message));
    }

    // Tarjeta: preferencia de MP (por compatibilidad) — el Brick usa total_amount
    let mp_checkout_url = null;
```

- [ ] **Step 3: Insertar en `POST /api/orders` (efectivo, 1 plan)**

Localiza este bloque (ya existente, alrededor de la línea 4963):

```js
    await client.query("COMMIT");

    const order = orderRes.rows[0];

    // ── Tarjeta: generar checkout de MercadoPago (fuera de la transacción) ──
    let mp_checkout_url = null;
```

Reemplázalo por:

```js
    await client.query("COMMIT");

    const order = orderRes.rows[0];

    if (paymentMethod === "cash") {
      pool.query("SELECT display_name FROM users WHERE id = $1", [req.userId])
        .then((r) => sendPushToAdmins({
          ...buildAdminPendingMessage({ clientName: r.rows[0]?.display_name || "Alumna", reason: "cash" }),
          url: "/admin/payments?tab=pending",
          tag: `admin_pending_${order.id}`,
        }))
        .catch((e) => console.error("[Push admin] cash order:", e.message));
    }

    // ── Tarjeta: generar checkout de MercadoPago (fuera de la transacción) ──
    let mp_checkout_url = null;
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(push): avisar a admin cuando una orden queda pendiente por revisar (comprobante o efectivo)"
```

---

### Task 5: Botón de notificaciones en el panel admin

**Files:**
- Modify: `src/components/admin/AdminLayout.tsx`

- [ ] **Step 1: Añadir imports**

En `src/components/admin/AdminLayout.tsx`, el import de iconos actual (líneas 7-11) es:

```tsx
import {
  LayoutDashboard, Package, CreditCard, Users, CalendarDays,
  BookOpen, DollarSign, BarChart3, Ticket,
  Settings, ChevronLeft, ChevronRight, ChevronDown, LogOut, Globe, Menu, X, UserSquare2,
} from "lucide-react";
```

Reemplázalo por:

```tsx
import {
  LayoutDashboard, Package, CreditCard, Users, CalendarDays,
  BookOpen, DollarSign, BarChart3, Ticket,
  Settings, ChevronLeft, ChevronRight, ChevronDown, LogOut, Globe, Menu, X, UserSquare2,
  Bell, BellOff,
} from "lucide-react";
```

Justo después del import de iconos, añade el import del hook:

```tsx
import { usePushNotifications } from "@/hooks/usePushNotifications";
```

- [ ] **Step 2: Usar el hook dentro del componente**

Localiza esta línea (ya existente, alrededor de la línea 68):

```tsx
  const user = useAuthStore((s) => s.user as any);
```

Reemplázalo por:

```tsx
  const user = useAuthStore((s) => s.user as any);
  const isAdminRole = user?.role === "admin" || user?.role === "super_admin";
  const { status: pushStatus, isBusy: pushIsBusy, enable: enablePush, disable: disablePush } = usePushNotifications();
  const showPushToggle = isAdminRole && !["unsupported", "needs-install-ios", "loading"].includes(pushStatus);
```

- [ ] **Step 3: Renderizar el botón en el header**

Localiza este bloque (ya existente, alrededor de la línea 265-271):

```tsx
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 font-body text-[0.74rem] text-valiance-charcoal/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6E7F4F] animate-pulse-dot" />
              En línea
            </span>
            <div className="hidden sm:block w-px h-4 bg-valiance-blush" />
            <div className="flex items-center gap-2.5 min-w-0">
```

Reemplázalo por:

```tsx
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 font-body text-[0.74rem] text-valiance-charcoal/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6E7F4F] animate-pulse-dot" />
              En línea
            </span>
            <div className="hidden sm:block w-px h-4 bg-valiance-blush" />
            {showPushToggle && (
              <button
                type="button"
                onClick={pushStatus === "active" ? disablePush : enablePush}
                disabled={pushIsBusy}
                title={pushStatus === "active" ? "Notificaciones activas — clic para desactivar" : "Activar notificaciones de venta y pendientes"}
                aria-label={pushStatus === "active" ? "Desactivar notificaciones" : "Activar notificaciones"}
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  pushStatus === "active"
                    ? "text-valiance-mauve bg-valiance-blush/40"
                    : "text-valiance-charcoal/55 hover:text-valiance-charcoal hover:bg-valiance-blush/40",
                )}
              >
                {pushStatus === "active" ? <Bell size={16} strokeWidth={1.6} /> : <BellOff size={16} strokeWidth={1.6} />}
              </button>
            )}
            <div className="flex items-center gap-2.5 min-w-0">
```

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `AdminLayout.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminLayout.tsx
git commit -m "feat(push): botón para activar/desactivar notificaciones admin en el panel"
```

---

### Task 6: Verificación manual end-to-end

**Files:** ninguno (solo verificación, sin código).

- [ ] **Step 1: Activar notificaciones en una cuenta admin**

Con el deploy ya en producción (o local con VAPID configurado), entra al panel admin, toca la campana en el header, acepta el permiso del navegador. Confirma que el ícono cambia a estado "activo".

- [ ] **Step 2: Probar "pendiente por revisar" — comprobante**

Desde una cuenta de clienta de prueba, crea una orden con `paymentMethod: "transfer"` y sube un comprobante (`POST /api/orders/:id/proof`). Confirma que llega el push "📋 Pendiente por revisar" con el nombre correcto, y que tocarlo abre `/admin/payments?tab=pending`.

- [ ] **Step 3: Probar "pendiente por revisar" — efectivo**

Desde la misma cuenta de prueba, crea una orden con `paymentMethod: "cash"` (un solo plan). Confirma que llega el push con el texto "eligió pagar en efectivo". Repite con una compra de carrito (2+ planes, `paymentMethod: "cash"`) para cubrir el segundo call site.

- [ ] **Step 4: Probar "venta completada" — verificación manual**

Desde el panel admin, aprueba (`PUT /api/admin/orders/:id/verify`) una de las órdenes de transferencia creadas en el Step 2. Confirma que llega el push "🎉 Nueva venta" con nombre de clienta y plan correctos, y que tocarlo abre `/admin/dashboard`.

- [ ] **Step 5: Probar "venta completada" — tarjeta**

Completa una compra de prueba con tarjeta (Brick). Confirma que llega el mismo tipo de push "🎉 Nueva venta" vía `approveOrderFromMP`.

- [ ] **Step 6: Confirmar que desactivar funciona**

Toca la campana de nuevo para desactivar. Repite el Step 2 o 3 y confirma que YA NO llega push a esa cuenta.

- [ ] **Step 7: Correr la suite completa antes de cerrar**

Run: `npm test`
Expected: todos los tests pasan, incluidos los 3 nuevos de Task 1.
