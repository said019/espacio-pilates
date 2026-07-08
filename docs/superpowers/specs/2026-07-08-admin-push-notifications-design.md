# Notificaciones push para admin — Diseño

## Resumen

Hoy solo las alumnas reciben Web Push (`usePushNotifications` conectado únicamente en `src/pages/client/ProfilePreferences.tsx`). El panel admin no tiene ninguna señal en tiempo real cuando ocurre una venta o cuando hay algo esperando revisión manual — el admin tiene que entrar al Dashboard y fijarse. Este feature agrega Web Push del lado admin para dos categorías de evento, reutilizando toda la infraestructura ya existente (`server/lib/push.js`, tabla `push_subscriptions`, hook `usePushNotifications`).

## Alcance

**Quién recibe:** únicamente cuentas con `role IN ('admin', 'super_admin')` que hayan activado notificaciones. Recepción/instructoras quedan fuera de este alcance (decisión explícita — no se filtra por permisos finos, solo por esos dos roles).

**Eventos que notifican — "venta completada" (4 disparadores, decisión explícita: TODA venta, incluidas las que el propio admin aprueba a mano):**
1. Pago con tarjeta aprobado automáticamente (síncrono, Brick) o vía webhook de MercadoPago → dentro de `approveOrderFromMP()` (`server/index.js:5429`).
2. Transferencia/efectivo aprobados manualmente por un admin → dentro de `PUT /api/admin/orders/:id/verify` (`server/index.js:13142`).

**Eventos que notifican — "pendiente por revisar" (una orden quedó en `pending_verification` sin que ningún admin haya actuado todavía):**
3. Clienta sube comprobante de transferencia → dentro de `POST /api/orders/:id/proof` (`server/index.js:5011`), justo después del `UPDATE orders SET status = 'pending_verification'` (línea `5055`).
4. Clienta crea una orden pagando en efectivo (queda pendiente de confirmar en el estudio, sin comprobante) → esto tiene **dos** call sites porque `POST /api/orders` (`server/index.js:4783`) se bifurca en dos caminos que calculan el `initialStatus` de forma independiente:
   - Carrito multi-plan → dentro de `createCartOrder()` (`server/index.js:4729`).
   - Un solo plan + complementos → dentro del cuerpo principal de `POST /api/orders` (`server/index.js:4921`).

**Explícitamente fuera de alcance** (para no ampliar el pedido original):
- `POST /api/memberships` (alta manual de membresía sin orden) y `PUT /api/memberships/:id/activate` — son acciones que el admin ya está ejecutando él mismo en ese momento, no representan una "venta" que llega de fuera.
- No se agregan estos eventos al sistema de `notification_templates` editable en Configuración → Notificaciones (ese sistema es para plantillas dirigidas a clientas). Los mensajes de admin quedan como texto fijo en el código, igual que el resto de notificaciones administrativas existentes (p. ej. el broadcast manual).
- No se filtra por preferencia individual tipo `push_reminders` — el propio acto de activar/desactivar el toggle en el panel ES la preferencia (ver Frontend).

## Arquitectura

### Backend — un helper nuevo + 4 call sites

**Nuevo:** `sendPushToAdmins({ title, body, url, tag })` en `server/index.js`, junto a `sendPushToUser` (mismo archivo, mismo patrón — no requiere cambios en `server/lib/push.js`, que ya es completamente genérico por suscripción). Hace fan-out a esta consulta:

```sql
SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
  FROM push_subscriptions ps
  JOIN users u ON u.id = ps.user_id
 WHERE u.role IN ('admin', 'super_admin')
```

Reutiliza exactamente `buildPushPayload`, `sendWebPush`, `shouldPruneSubscription` de `server/lib/push.js` — la poda de suscripciones muertas (404/410) funciona igual que para clientas. No respeta ningún flag `respectPrefs` (no aplica aquí — ver "Explícitamente fuera de alcance").

Los 4 call sites llaman a este helper de forma **best-effort** (con `.catch()`, nunca `await` bloqueante de la respuesta HTTP), exactamente como ya hacen hoy los `sendConfiguredPushTemplate(...)` existentes junto a cada uno de estos mismos bloques — no se bloquea ni se arriesga la respuesta al cliente/admin que disparó la acción original.

Mensajes (texto fijo, sin necesidad de plantilla editable):
- Venta: `"🎉 Nueva venta: {nombreClienta} compró {nombrePlan}"` → `url: "/admin/dashboard"`
- Pendiente (comprobante): `"📋 {nombreClienta} subió su comprobante — pendiente de revisar"` → `url: "/admin/payments?tab=pending"`
- Pendiente (efectivo): `"📋 {nombreClienta} eligió pagar en efectivo — pendiente de confirmar"` → `url: "/admin/payments?tab=pending"`

En los call sites 1 y 2 (venta completada), el nombre de la clienta y del plan ya están resueltos en variables locales para construir el push/email que ya se le manda a la clienta — se reutilizan, no se agregan queries nuevas. En el call site 3 (`POST /api/orders/:id/proof`), la consulta inicial (`server/index.js:5013`) solo trae la orden — hay que ampliarla con `JOIN users`/`JOIN plans` (mismo patrón usado en `pay-with-card`, `server/index.js:5071`) para tener nombre de clienta y plan disponibles. En el call site 4 (ambos caminos de creación con efectivo), la sesión ya tiene `req.userId` autenticado — se resuelve `display_name` con una query ligera si no está ya en scope (a confirmar/detallar en el plan de implementación).

`/admin/payments?tab=pending` ya es la ruta real que usa hoy la tarjeta "Órdenes pendientes" del Dashboard (`src/pages/admin/Dashboard.tsx:130`) — no es una ruta nueva.

### Frontend — reutilizar el hook existente, un botón nuevo

No se toca `src/hooks/usePushNotifications.ts` (ya es genérico, no tiene nada específico de clienta). Se agrega un control compacto tipo campana en `src/components/admin/AdminLayout.tsx`, en el header (`:265-279`, junto al indicador "En línea" y antes del avatar), visible solo si `user.role` es `admin` o `super_admin` (el objeto `user` de `useAuthStore` ya está disponible en ese componente, `:68`).

Estados del botón (reutilizando el `status` que ya expone el hook): `active` (campana llena, click desactiva), `inactive`/`denied`/`unsupported` (campana vacía, click intenta activar — mismo flujo de `Notification.requestPermission()` que ya usa la clienta). No hace falta UI para `needs-install-ios` en el panel admin — es un caso de borde raro para uso administrativo (normalmente desde escritorio), pero el hook ya lo maneja sin romper nada si ocurre.

## Manejo de errores / casos borde

- **Sin admins suscritos:** `sendPushToAdmins` no encuentra filas, no manda nada, no lanza — mismo comportamiento que `sendPushToUser` cuando el usuario no tiene suscripciones.
- **Falla de envío a un admin puntual:** se poda si es 404/410, se loguea si es otro error — nunca debe interrumpir la aprobación de la orden ni la respuesta al request original (todos los call sites son fire-and-forget con `.catch()`).
- **Multi-admin:** si hay más de una cuenta admin/super_admin suscrita, **todas** reciben el push — incluida la cuenta que acaba de realizar la acción (p. ej. quien aprobó la transferencia también recibe su propio "nueva venta"). Es la decisión explícita ya confirmada ("toda venta completada"), no un descuido.
- **Múltiples pestañas/dispositivos del mismo admin:** ya resuelto por el diseño existente de `push_subscriptions` (una fila por dispositivo/suscripción, todas reciben).

## Testing

Sigue el patrón ya establecido en el repo: `server/lib/push.js` ya tiene cobertura pura (`buildPushPayload`, `shouldPruneSubscription`, `sendWebPush`) que no cambia. `sendPushToAdmins` es código de orquestación (consulta a BD + loop de envío) en `server/index.js`, igual que `sendPushToUser` — que hoy tampoco tiene test dedicado (se prueba indirectamente vía los endpoints que lo usan). No se introduce una brecha de cobertura nueva respecto al patrón existente.

Verificación manual esperada en el plan de implementación: activar el toggle admin en dos cuentas de prueba, disparar cada uno de los 4 eventos, confirmar que llega el push correcto con el `url` correcto al tocarlo.

## Fuera de alcance (explícito, para revisión rápida)

- Recepción/instructoras no reciben estas notificaciones.
- No hay plantillas editables para estos mensajes desde Configuración.
- No se tocan `POST /api/memberships` ni `PUT /api/memberships/:id/activate`.
- No se agrega preferencia granular por tipo de evento (venta vs. pendiente) — es un solo toggle on/off, igual que el de la clienta.
