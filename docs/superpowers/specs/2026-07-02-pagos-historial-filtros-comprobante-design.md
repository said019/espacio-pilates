# Pagos → Historial: filtros + comprobante descargable — Diseño

**Fecha:** 2026-07-02
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Motivo:** La dueña pidió que el Historial de Pagos (admin) "me deje filtrar y descargar el comprobante". Hoy la pestaña carga hasta 200 pagos sin ningún filtro, y no hay forma de ver/descargar el comprobante de un pago desde el admin (solo la clienta lo ve en Mis órdenes, feature recién shipeado).

---

## 1. Objetivo y alcance

En **Admin → Pagos → Historial**:
1. **Filtros:** búsqueda por nombre de clienta (texto, client-side), método de pago (chips Todos/Efectivo/Transferencia/Tarjeta, client-side), y rango de fechas desde/hasta (server-side — `GET /api/payments` ya soporta `startDate`/`endDate`, nadie los usa desde el front). El contador de pagos y el **Total** se recalculan sobre lo filtrado.
2. **Comprobante:** botón "Comprobante" en cada pago proveniente de una **orden aprobada** (`source === 'order'`), que abre **el mismo diálogo imprimible** que ven las clientas (folio, desglose, total, nota CFDI, Imprimir/Guardar PDF).

**Reuso obligado (DRY):** el diálogo imprimible hoy vive inline en `MyOrders.tsx`. Se **extrae** a un componente compartido `src/components/ReceiptDialog.tsx` y lo consumen ambas pantallas — cualquier cambio futuro al comprobante se hace en un solo lugar.

**Fuera de alcance:** comprobante para membresías asignadas a mano (`source === 'membership'`, no hay orden/pago formal detrás — mismo límite del spec del comprobante 2026-07-01) y para ventas walk-in de invitadas (`source === 'walkin'`, sin clienta). Esas filas simplemente no llevan botón. Exportar CSV/Excel del historial: no pedido, no incluido.

---

## 2. Backend — `GET /api/payments` (`server/index.js` ~13390)

El UNION actual devuelve columnas mínimas (id, user_name, plan_name, total_amount, method, provider, status, created_at, source). El diálogo necesita el desglose completo. Se **extiende la rama de órdenes** con: `o.order_number`, `o.subtotal`, `o.inscription_amount`, `o.discount_amount`, `o.platform_fee`, `o.paid_at`, y el JSON de renglones (`items`) con el mismo patrón `COALESCE((SELECT json_agg(...) FROM order_plan_items ...), '[]'::json)` que ya usa `GET /api/orders`. La **rama de membresías** agrega las columnas espejo en NULL (`NULL::text AS order_number`, `NULL::numeric AS subtotal`, … , `'[]'::json AS items`) — el UNION ALL exige columnas idénticas.

Sin cambios de firma: `startDate`/`endDate`/`userId`/`limit` quedan igual. El front manda `endDate` como `YYYY-MM-DDT23:59:59` para incluir el día completo (el `<=` del server con fecha seca cortaría a medianoche).

---

## 3. Componente compartido — `src/components/ReceiptDialog.tsx` (nuevo)

Extracción 1:1 del diálogo actual de `MyOrders.tsx` (líneas del Dialog completo, incluido el `<style>` de impresión con la neutralización `[role="dialog"]`). Props: `{ order: any | null; onClose: () => void }` — `open={!!order}`, `onOpenChange={(v) => !v && onClose()}`. Espera los campos snake_case de la orden (`order_number`, `paid_at`, `created_at`, `items`, `plan_name`, `subtotal`, `inscription_amount`, `discount_amount`, `platform_fee`, `total_amount`, `payment_method`) — exactamente los que devuelven tanto `GET /api/orders` (clienta) como el `GET /api/payments` extendido (admin).

`MyOrders.tsx` reemplaza su diálogo inline por `<ReceiptDialog order={receiptOrder} onClose={() => setReceiptOrder(null)} />` (conserva su `useState`). Cero cambio visual/funcional para la clienta.

---

## 4. Frontend admin — `PaymentsHistory` en `PaymentsPage.tsx` (~594)

- Estado nuevo: `search` (texto), `method` (`"all" | "cash" | "transfer" | "card"`), `from`/`to` (strings `YYYY-MM-DD`), `receiptOrder` (fila seleccionada o null).
- Query: `queryKey: ["payments", from, to]`; `queryFn` agrega `startDate=from`/`endDate=${to}T23:59:59` cuando estén definidos.
- Filtrado client-side sobre lo cargado: nombre (`includes`, case-insensitive) y método. Contador y Total sobre `filtered`.
- UI de filtros arriba del resumen: input de búsqueda con ícono, chips de método (estilo de pills ya usado en la página), 2 `DatePicker` (componente propio `@/components/ui/date-picker`, API `value`/`onChange` con "YYYY-MM-DD" — mismo patrón que ReportsPage) + botón "Limpiar" cuando algún filtro esté activo.
- Botón "Comprobante" (ícono FileText, `variant="outline" size="sm"`) en cada fila con `p.source === 'order'` → `setReceiptOrder(p)`. Al final del componente, `<ReceiptDialog order={receiptOrder} onClose={...} />`.
- Estado vacío: si hay pagos cargados pero el filtro deja 0, mostrar "Sin pagos que coincidan con el filtro" (no el vacío global).

---

## 5. Pruebas
- `node --check server/index.js` + `npm test` (54/54, este cambio no toca `server/lib/*`) + `npm run build`.
- SQL del UNION extendido probado directo contra la BD local (psql) — columnas idénticas en ambas ramas, items JSON correcto.
- Navegador (admin): Historial muestra filtros; buscar nombre filtra; chip de método filtra; rango de fechas re-consulta; Total/contador reflejan el filtro; fila de orden aprobada → "Comprobante" → mismo diálogo con desglose correcto; fila de membresía manual → sin botón.
- Navegador (clienta): Mis órdenes → "Ver comprobante" sigue funcionando idéntico tras la extracción del componente.

## 6. Archivos tocados
| Archivo | Cambio |
|---|---|
| `server/index.js` | extender ambas ramas del UNION de `GET /api/payments` (desglose + items / NULLs espejo) |
| `src/components/ReceiptDialog.tsx` (nuevo) | diálogo imprimible extraído de MyOrders |
| `src/pages/client/MyOrders.tsx` | usar el componente compartido (sin cambio visual) |
| `src/pages/admin/payments/PaymentsPage.tsx` | filtros (nombre/método/fechas) + botón Comprobante + diálogo |
