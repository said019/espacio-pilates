# Pagos → Historial: filtros + comprobante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En Admin → Pagos → Historial, la dueña puede filtrar (nombre, método, fechas) y abrir/imprimir el comprobante de cualquier pago que venga de una orden aprobada — reusando el mismo diálogo que ven las clientas.

**Architecture:** Tres piezas: (1) `GET /api/payments` se extiende para que las filas de órdenes traigan el desglose completo + items (las de membresía llevan NULLs espejo — el UNION ALL exige columnas idénticas); (2) el diálogo imprimible se EXTRAE de `MyOrders.tsx` a `src/components/ReceiptDialog.tsx` (componente compartido, cero cambio visual para la clienta); (3) `PaymentsHistory` gana filtros (nombre/método client-side, fechas server-side) y el botón Comprobante por fila.

**Tech Stack:** Node/Express + PostgreSQL (`server/index.js`), React + TS + TanStack Query + shadcn/ui, `DatePicker` propio (`@/components/ui/date-picker`, API `value`/`onChange` "YYYY-MM-DD").

**Spec:** `docs/superpowers/specs/2026-07-02-pagos-historial-filtros-comprobante-design.md`

**Entorno local:** backend `node server/index.js` (8090, BD en `.env`), front `npx vite --port 5173` (el 8080 está ocupado por otro proyecto y CORS solo permite 5173), admin `espaciopilatesvm@gmail.com` / `EspacioVM2026!`. BD local en línea base: 9 users / 4 orders / 2 memberships — dejarla igual al terminar.

---

### Task 1: Backend — extender `GET /api/payments` con el desglose

**Files:**
- Modify: `server/index.js` (~línea 13390, ubicar por `app.get("/api/payments"` — NO por número)

- [ ] **Step 1: Extender la rama de ÓRDENES del UNION**

En el SELECT de órdenes (el que empieza `let q = \`` y contiene `CASE WHEN o.user_id IS NULL THEN 'walkin' ELSE 'order' END AS source`), reemplazar la lista de columnas para agregar el desglose y los items. Queda así (solo cambia la lista SELECT; los FROM/JOIN/WHERE y los `if (startIdx)...` quedan idénticos):

```js
    let q = `
      SELECT
        o.id,
        o.user_id,
        COALESCE(u.display_name, o.guest_name) AS user_name,
        COALESCE(p.name, 'Clase suelta') AS plan_name,
        o.total_amount,
        o.payment_method AS method,
        o.payment_provider AS provider,
        o.status::text AS status,
        o.created_at,
        CASE WHEN o.user_id IS NULL THEN 'walkin' ELSE 'order' END AS source,
        o.order_number,
        o.subtotal,
        o.inscription_amount,
        o.discount_amount,
        o.platform_fee,
        o.paid_at,
        o.payment_method,
        COALESCE((
          SELECT json_agg(json_build_object(
                   'plan_id', i.plan_id, 'plan_name', ip.name,
                   'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
                 ) ORDER BY i.created_at)
          FROM order_plan_items i JOIN plans ip ON ip.id = i.plan_id
          WHERE i.order_id = o.id
        ), '[]'::json) AS items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN plans p ON o.plan_id = p.id
      WHERE o.status = 'approved'`;
```

(Nota: `o.payment_method` aparece dos veces a propósito — una aliased `method` como hoy, otra sin alias porque el `ReceiptDialog` espera el campo `payment_method` literal.)

- [ ] **Step 2: Columnas espejo en NULL en la rama de MEMBRESÍAS**

En el SELECT de membresías (`let mq = \``), agregar después de `'membership' AS source` (el UNION ALL exige mismas columnas, en el mismo orden):

```js
        'membership' AS source,
        NULL::text AS order_number,
        NULL::numeric AS subtotal,
        NULL::numeric AS inscription_amount,
        NULL::numeric AS discount_amount,
        NULL::numeric AS platform_fee,
        NULL::timestamptz AS paid_at,
        m.payment_method,
        '[]'::json AS items
```

- [ ] **Step 3: Verificar sintaxis + probar el UNION contra la BD real**

```bash
node --check server/index.js
psql "postgresql://localhost:5432/tep_vm" -c "
(SELECT o.id, o.order_number, o.subtotal, o.inscription_amount, o.paid_at,
        CASE WHEN o.user_id IS NULL THEN 'walkin' ELSE 'order' END AS source,
        COALESCE((SELECT json_agg(json_build_object('plan_name', ip.name, 'quantity', i.quantity, 'line_total', i.line_total))
                  FROM order_plan_items i JOIN plans ip ON ip.id = i.plan_id WHERE i.order_id = o.id), '[]'::json) AS items
 FROM orders o WHERE o.status = 'approved')
UNION ALL
(SELECT m.id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz, 'membership',
        '[]'::json
 FROM memberships m WHERE m.order_id IS NULL)
LIMIT 5;"
```
Expected: el UNION ejecuta sin error de tipos y las filas de orden traen items JSON. Luego `npm test` → **54 passed**.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(pagos): GET /api/payments devuelve el desglose completo de las órdenes (para el comprobante admin)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extraer `ReceiptDialog` compartido y usarlo en Mis órdenes

**Files:**
- Create: `src/components/ReceiptDialog.tsx`
- Modify: `src/pages/client/MyOrders.tsx`

- [ ] **Step 1: Crear el componente compartido**

Crear `src/components/ReceiptDialog.tsx` con este esqueleto EXACTO, moviendo adentro (verbatim, sin retocar ni una clase) TODO el contenido actual del `<Dialog>...</Dialog>` de `MyOrders.tsx` (el bloque que empieza con el comentario `{/* ── Comprobante de pago (vista imprimible) ── */}` — incluye el `<style>` de impresión con la neutralización `[role="dialog"]`, el desglose completo y el botón Imprimir). Solo se renombran las referencias de estado: `receiptOrder` → `order`, y el cierre usa `onClose`:

```tsx
/**
 * Diálogo imprimible del comprobante de pago (constancia informal, NO CFDI).
 * Compartido por: Mis órdenes (clienta) y Pagos → Historial (admin).
 * Espera la fila de la orden con campos snake_case: order_number, paid_at,
 * created_at, items, plan_name, subtotal, inscription_amount, discount_amount,
 * platform_fee, total_amount, payment_method.
 */
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const ReceiptDialog = ({ order, onClose }: { order: any | null; onClose: () => void }) => (
  <Dialog open={!!order} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="max-w-md">
      {/* AQUÍ VA, VERBATIM, todo el contenido interno actual del DialogContent de
          MyOrders (style de impresión + bloque receipt-print completo), con
          `receiptOrder` renombrado a `order` en TODAS sus apariciones. */}
    </DialogContent>
  </Dialog>
);
```

(El `{order && (...)}` interno y el `<style>` van tal cual estaban; el único cambio de identificadores es `receiptOrder` → `order`.)

- [ ] **Step 2: Usarlo en MyOrders**

En `src/pages/client/MyOrders.tsx`:
- Eliminar el bloque inline completo `{/* ── Comprobante de pago (vista imprimible) ── */} <Dialog ...>...</Dialog>` y reemplazarlo por:

```tsx
          <ReceiptDialog order={receiptOrder} onClose={() => setReceiptOrder(null)} />
```

- Agregar `import { ReceiptDialog } from "@/components/ReceiptDialog";` junto a los demás imports.
- Limpiar imports que queden sin uso tras la extracción: `Dialog, DialogContent, DialogHeader, DialogTitle` (de ui/dialog) y `Printer` (lucide) salen de MyOrders SI ya nada más los usa en el archivo — verificar con grep antes de quitar. `FileText` y `useState` SE QUEDAN (el botón y el estado siguen en MyOrders).

- [ ] **Step 3: Verificar que la clienta no perdió nada**

```bash
npm run build
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "MyOrders|ReceiptDialog" || echo "sin errores TS en los 2 archivos"
```
Expected: build ✓ y sin errores TS en esos archivos.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReceiptDialog.tsx src/pages/client/MyOrders.tsx
git commit -m "refactor(comprobante): extraer ReceiptDialog compartido (sin cambio visual para la clienta)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Filtros + botón Comprobante en el Historial de Pagos

**Files:**
- Modify: `src/pages/admin/payments/PaymentsPage.tsx` (componente `PaymentsHistory`, ~línea 594)

- [ ] **Step 1: Estado, query con fechas y filtrado**

Reemplazar el inicio del componente `PaymentsHistory` (desde `const PaymentsHistory = () => {` hasta la línea del `const total = ...` inclusive) por:

```tsx
const PaymentsHistory = () => {
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<"all" | "cash" | "transfer" | "card">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);
  const filtersActive = Boolean(search || method !== "all" || from || to);

  const { data } = useQuery<{ data: any[]; total?: number }>({
    // Fechas server-side: re-consulta al cambiar el rango (endDate con T23:59:59
    // para incluir el día completo — el <= del server cortaría a medianoche).
    queryKey: ["payments", from, to],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (from) params.startDate = from;
      if (to) params.endDate = `${to}T23:59:59`;
      return (await api.get("/payments", { params })).data;
    },
  });
  const payments = Array.isArray(data?.data) ? data.data : [];

  // Nombre y método se filtran client-side sobre lo cargado.
  const filtered = payments.filter((p: any) => {
    const name = String(p.userName ?? p.user_name ?? "").toLowerCase();
    if (search && !name.includes(search.trim().toLowerCase())) return false;
    if (method !== "all" && String(p.method) !== method) return false;
    return true;
  });
```

y donde el componente calculaba `const total = payments.reduce(...)`, cambiar a calcularlo sobre `filtered`:

```tsx
  const total = filtered.reduce((s: number, p: any) => s + Number(p.total_amount ?? p.amount ?? 0), 0);
```

(`methodStyles`/`methodLabels`/`methodIcons`/`statusMeta`/`fmtDate` quedan igual.)

- [ ] **Step 2: UI de filtros + estados vacíos**

Reemplazar el early-return de vacío y el bloque `{/* Resumen */}` por (el `payments.map` pasa a ser `filtered.map`):

```tsx
  return (
    <div className="space-y-3">
      {/* ── Filtros ── */}
      <div className="rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C6B6F]/50" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre..." className="pl-9" />
          </div>
          <div className="flex gap-2">
            <DatePicker value={from} onChange={setFrom} placeholder="Desde" className="w-full sm:w-36" />
            <DatePicker value={to} onChange={setTo} placeholder="Hasta" className="w-full sm:w-36" min={from || undefined} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {([["all", "Todos"], ["cash", "Efectivo"], ["transfer", "Transferencia"], ["card", "Tarjeta"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMethod(key)}
              className={cn(
                "text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
                method === key
                  ? "text-white bg-[#8C6B6F] border-[#8C6B6F]"
                  : "text-[#8C6B6F] border-[#8C6B6F]/25 bg-white hover:bg-[#8C6B6F]/10"
              )}
            >
              {label}
            </button>
          ))}
          {filtersActive && (
            <button
              type="button"
              onClick={() => { setSearch(""); setMethod("all"); setFrom(""); setTo(""); }}
              className="text-[11px] text-[#A8473F] underline underline-offset-2 ml-auto"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <History size={32} className="text-[#1A1A1A]/10 mb-3" />
          <p className="text-[#1A1A1A]/30 text-sm">Sin pagos registrados aún</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <History size={28} className="text-[#1A1A1A]/10 mb-3" />
          <p className="text-[#1A1A1A]/30 text-sm">Sin pagos que coincidan con el filtro</p>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-[#1A1A1A]/40">{filtered.length} {filtered.length === 1 ? "pago" : "pagos"}</p>
            <p className="text-xs text-[#1A1A1A]/40">
              Total: <span className="font-bold text-[#8C6B6F]">${total.toLocaleString("es-MX")} MXN</span>
            </p>
          </div>
          {/* ... aquí sigue el filtered.map(...) existente ... */}
        </>
      )}
    </div>
  );
```

Estructura final: el `filtered.map((p: any) => {...})` existente (antes `payments.map`) queda dentro del fragmento `<>...</>` después del Resumen. El `if (!payments.length) return (...)` original se ELIMINA (lo sustituyen los dos estados vacíos de arriba).

- [ ] **Step 3: Botón Comprobante por fila + diálogo**

Dentro del `filtered.map`, en el `<div className="text-right shrink-0 flex flex-col items-end gap-1.5">` (donde están el monto y el badge de método), agregar DESPUÉS del badge de método:

```tsx
              {p.source === "order" && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setReceiptOrder(p)}>
                  <FileText size={12} className="mr-1.5" />Comprobante
                </Button>
              )}
```

Y justo antes del cierre del `</div>` raíz del componente (el `<div className="space-y-3">`), agregar:

```tsx
      <ReceiptDialog order={receiptOrder} onClose={() => setReceiptOrder(null)} />
```

- [ ] **Step 4: Imports**

Agregar a los imports de `PaymentsPage.tsx` (verificar cuáles ya existen antes de duplicar — `useState`, `cn`, `Input` y varios lucide ya están importados en este archivo para las otras pestañas):
- `Search, FileText` a la lista de lucide-react (si no están).
- `import { DatePicker } from "@/components/ui/date-picker";`
- `import { ReceiptDialog } from "@/components/ReceiptDialog";`

- [ ] **Step 5: Build + commit**

```bash
npm run build
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep PaymentsPage || echo "sin errores TS"
git add src/pages/admin/payments/PaymentsPage.tsx
git commit -m "feat(pagos): filtros (nombre/método/fechas) y comprobante imprimible en el Historial

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Verificación integral en navegador

**Files:** ninguno (solo verificación)

- [ ] **Step 1:** `npm test` (54/54) + `npm run build` (✓) + `node --check server/index.js`.
- [ ] **Step 2:** Levantar backend (8090) y front (5173). Preparar datos demo por HTTP: registrar clienta con email, crear orden de carrito (Paquete 9 + Clase Extra ×2, transfer) y aprobarla como admin (queda con inscripción → desglose completo).
- [ ] **Step 3 (admin):** Login admin → Pagos → Historial. Verificar: filtros visibles; buscar el nombre demo filtra a 1 y el Total cambia; chip "Transferencia" mantiene la fila, chip "Tarjeta" la oculta; poner rango de fechas de hoy la mantiene, rango pasado la oculta (re-consulta); "Limpiar filtros" restaura; la fila demo (source order) muestra "Comprobante" → diálogo con folio/desglose/total correctos; una fila de membresía manual (las hay en la BD base) NO muestra botón.
- [ ] **Step 4 (clienta):** Login como la clienta demo → Mis órdenes → "Ver comprobante" abre idéntico que antes (regresión de la extracción).
- [ ] **Step 5:** Limpiar datos demo (orden→order_plan_items→wallet_notification_logs→memberships→loyalty→referral→user; conteos de vuelta a 9/4/2), matar servers, `git status` limpio.

**No hacer push** — preguntar a Said al final (junto con lo que haya pendiente).

---

## Self-Review

- **Cobertura del spec:** §2 (endpoint) → Task 1. §3 (componente compartido + MyOrders) → Task 2. §4 (filtros + botón + vacíos) → Task 3. §5 (pruebas SQL/build/navegador ambos lados) → Tasks 1.3, 2.3, 4. Sin huecos.
- **Placeholders:** el único bloque no-verbatim es el traslado del diálogo (Task 2 Step 1), que es una instrucción determinista de MOVER código existente con un renombre único (`receiptOrder`→`order`) — no una invitación a improvisar; el esqueleto receptor está completo.
- **Consistencia:** `ReceiptDialog` espera snake_case; Task 1 agrega exactamente esos campos (incl. `payment_method` sin alias) y `GET /api/orders` ya los devuelve para la clienta. El gating del botón es `source === 'order'` (excluye `walkin` y `membership`), igual que el spec §1/§4.
