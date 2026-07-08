# Notificaciones — Referencia técnica

Cómo funcionan los 3 canales de notificación (Email, WhatsApp, Web Push) y los pases de Wallet, con foco en la pregunta que más se presta a confusión: **¿le llega algo a la alumna si tiene la app cerrada?**

---

## Estado actual

| Canal | ¿Depende de que la app esté abierta? | Config en producción |
|---|---|---|
| **Web Push** (notificación nativa del celular) | **No** — una vez suscrita, llega aunque la app esté completamente cerrada. Ver mecánica abajo. | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Railway, servicio `web`. Confirmadas ✅ |
| **WhatsApp** (Evolution API) | No — es otra app en el celular, ajena al estado de Tu Espacio Pilates. | Ver [EVOLUTION-API-SETUP.md](EVOLUTION-API-SETUP.md) |
| **Email** | No — llega a la bandeja de entrada igual. | `emailService.js`, envío directo, sin dependencia del estado de la app |
| **Apple/Google Wallet** (actualización de pase) | No — el sistema operativo actualiza el pase en segundo plano. Pero **siempre es silencioso**, nunca suena ni interrumpe (ver nota abajo). | Operativo, ver contexto en memoria del proyecto |

**En corto: ningún canal necesita que la app esté abierta para llegar.** La diferencia real entre canales no es "app abierta vs. cerrada" — es **qué eventos están conectados a cada canal** (ver la tabla completa más abajo), porque no todos los eventos disparan los 3 canales.

---

## Cómo funciona Web Push con la app cerrada (la mecánica real)

Esto es lo que genera más dudas, así que vale explicarlo una vez bien.

```
Alumna activa "Notificaciones" en Perfil (usePushNotifications.ts)
        │
        ▼
Notification.requestPermission() → concedido
        │
        ▼
reg.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
        │         (esto lo negocia el NAVEGADOR/SISTEMA OPERATIVO directo con
        │          el servicio de push de Apple/Google — FCM en Android,
        │          APNs en iOS vía Safari — NO con nuestro servidor)
        ▼
POST /push/subscribe → guardamos endpoint+llaves en `push_subscriptions`
        │
        ═══════════ la alumna cierra la app por completo ═══════════
        │
Ocurre un evento (reserva confirmada, etc.)
        │
        ▼
sendPushToUser() → webpush.sendNotification() (server/lib/push.js)
        │         (nuestro servidor NUNCA habla directo con el celular —
        │          le entrega el mensaje cifrado al servicio de push de
        │          Apple/Google, que lo entrega él mismo al dispositivo)
        ▼
El Service Worker (public/sw.js) se despierta SOLO por el sistema operativo,
aunque la app/pestaña esté cerrada — no es JS de la página, vive a nivel
navegador/SO — y muestra la notificación (`showNotification`).
```

**Por qué sí funciona con la app cerrada:** el Service Worker no es parte de "la app abierta" — se instala una vez y el sistema operativo lo despierta bajo demanda cuando llega un push, sin importar si hay una pestaña/app abierta. Es exactamente el mismo mecanismo que usan apps nativas para notificarte con la app cerrada; Web Push está diseñado para eso desde el principio (RFC 8030).

**Requisitos para que le llegue a una alumna con la app cerrada:**
1. Dio permiso de notificaciones (`Notification.requestPermission()` → `granted`).
2. Su suscripción sigue viva en `push_subscriptions` (no fue podada — ver Troubleshooting).
3. **En iPhone:** debe haber instalado la app a su pantalla de inicio (Compartir → Agregar a pantalla de inicio). Safari **no** entrega Web Push a pestañas normales, solo a PWAs instaladas — esto es una limitación de Apple (iOS ≥16.4), no de nuestro código. El manifest (`public/site.webmanifest`) ya está configurado correctamente (`display: standalone`) para que esto funcione una vez instalada.
4. En Android/Chrome no hace falta instalar nada — funciona incluso solo con haber dado el permiso en el navegador.
5. `VAPID_*` configuradas en el backend — ✅ confirmado en producción.

**Qué la rompe silenciosamente:** si el servicio de push responde 404/410 (suscripción expirada/inválida — pasa si la alumna desinstaló la PWA, cambió de celular, o borró datos del navegador), `shouldPruneSubscription()` la borra de la base de datos (`server/lib/push.js:32-34`) y esa alumna deja de recibir push **sin aviso** hasta que vuelva a activar notificaciones manualmente. No hay reintento ni notificación de "se te desconectó el push".

---

## Nota rápida: pases de Wallet nunca suenan (recordatorio)

Ya documentado en detalle en la conversación de soporte, pero para que quede en un solo lugar: cuando actualizamos un pase (nueva estampa, saldo, etc.) vía APNs/Google, el sistema SÍ actualiza el pase con la app cerrada — pero es una actualización **pasiva y silenciosa**, sin sonido ni alerta interactiva. Esto es una limitación de plataforma (Apple/Google no exponen ningún control de sonido para actualizaciones de pase), no algo que dependa de nuestro código.

---

## Qué evento dispara qué canal (tabla completa, verificada línea por línea)

Todas las líneas son de `server/index.js` salvo que se indique lo contrario.

| Evento | Disparador | Email | WhatsApp | Push |
|---|---|:---:|:---:|:---:|
| Reserva confirmada (autoservicio) | `POST /api/bookings` (`:3665`) | ✅ | ❌ | ✅ |
| Entra a lista de espera (autoservicio) | mismo endpoint, rama waitlist | ✅ | ❌ | ✅ |
| Reserva cancelada (autoservicio) | `DELETE /api/bookings/:id` (`:3872`) | ✅ | ❌ | ✅ |
| Reserva reagendada | `PUT /api/bookings/:id/reschedule` (`:4087`) | ✅ | ❌ | ✅ |
| **Promovida de lista de espera** | `notifyWaitlistPromotion()` (`:10129`), disparada al cancelar otra alumna | ✅ | **✅** | ✅ |
| Reserva/lista de espera creada por admin | `POST /api/admin/bookings/assign` (`:12121`) | ✅ | ❌ | ✅ |
| Membresía activada (tarjeta / webhook MP) | `approveOrderFromMP()` (`:5429`) | ✅¹ | ❌ | ✅¹ |
| Membresía activada (alta manual admin) | `POST /api/memberships` (`:11245`) | ✅ | ❌ | ✅ |
| Membresía activada (activar pendiente) | `PUT /api/memberships/:id/activate` (`:11500`) | ✅ | ❌ | ✅ |
| Membresía activada (aprobar transferencia) | `PUT /api/admin/orders/:id/verify` (`:13142`) | ✅¹ | ❌ | ✅¹ |
| Comprobante de pago (recibo) | `sendReceiptForApprovedOrder()` (`:5379`) | ✅ | ❌ | ❌ |
| Transferencia rechazada | `PUT /api/admin/orders/:id/reject` (`:13420`) | ✅ | ❌ | ✅ |
| Bienvenida con credenciales (alta manual) | `POST /api/admin/clients/manual` (`:12956`) | ✅ | ❌ | ❌ |
| Recuperar contraseña | `POST /api/auth/forgot-password` (`:3210`) | ✅ | ❌ | ❌ |
| **Recordatorio de clase 12h antes** | `runClassReminders()` (`:15640`), cron activo cada 5 min | ❌ | **✅** | ✅ |
| **Recordatorio de clase 30min antes** | mismo cron, rama 30m | ❌ | **✅** | ✅ |
| Resumen semanal (domingos 8am) | `runWeeklyReminderCron()` (`:15356`), cron activo | ✅ | ❌ | ❌ |
| "Te queda 1 clase" | — | ❌ | ❌ | ❌ |
| Membresía por vencer (por fecha) | — | ❌ | ❌ | ❌ |

¹ Solo si la orden tiene un `plan_id` único. Las órdenes de carrito con varios planes (`order_plan_items`) no disparan este bloque — sí llega el recibo, pero no la notificación de "membresía activada" por ningún canal.

✅ = sí se envía · ❌ = no se envía (ver por qué en la sección de huecos)

---

## Huecos activos — por qué tantos "❌"

### 1. WhatsApp está limitado a propósito a solo 3 eventos

Es diseño intencional, documentado en el propio código (`server/index.js:10021-10029`):

```js
// ── Anti-bloqueo de Evolution: SOLO estos eventos salen por WhatsApp ──────────
// Evolution es WhatsApp NO oficial y banea por volumen. Mantener la lista mínima
// protege el número. El resto de notificaciones sigue saliendo por email/push,
// pero NO por WhatsApp.
const WHATSAPP_ALLOWED_TEMPLATES = new Set([
  "class_reminder_12h",
  "class_reminder_30m",
  "booking_waitlist_promoted",
]);
```

Para cualquier evento fuera de esta lista, el código igual "llama" a `sendConfiguredWhatsAppTemplate(...)` — pero la función corta de inmediato y no manda nada (`reason: "not_in_whatsapp_whitelist"`). No es un bug: es la protección contra que Evolution (WhatsApp no oficial) banee el número por volumen. Si algún día se quiere ampliar la whitelist, hay que sopesarlo contra ese riesgo.

### 2. "Te queda 1 clase" no se envía por ningún canal — cron muerto

`runRenewalReminderCron()` (`server/index.js:15386-15486`) tiene toda la lógica lista (email, WhatsApp, push) pero **nunca está agendada**. `scheduleEmailCrons()` (`:15727-15742`) solo registra dos `setInterval`: recordatorios de clase y resumen semanal — el comentario ahí mismo dice explícitamente *"Renovación y los recordatorios viejos 9pm/8am quedaron retirados"*. El aviso por fecha de vencimiento ("tu plan vence el X") también fue retirado a propósito en junio 2026 a pedido del estudio, y ya ni la consulta SQL lo calcula.

**Si se quiere reactivar "te queda 1 clase"**, es agregar una línea a `scheduleEmailCrons()` llamando `runRenewalReminderCron()` en un intervalo — la lógica ya existe y no habría que reescribirla.

### 3. Cron con nombre gemelo — cuidado si se toca esta zona

`runClassReminderCron()` (`:15499-15635`, estrategia vieja 9pm/8am) sigue en el archivo pero también está muerto — fue reemplazado por `runClassReminders()` (sin "Cron" en el nombre), que es la que sí corre. Si alguna vez hay que tocar recordatorios de clase, verificar SIEMPRE cuál de las dos funciones está en el `setInterval` real antes de editar.

### 4. El opt-out de push (`push_reminders`) no tiene control en la app

La columna `users.push_reminders` existe, el backend la respeta (`sendPushToUser` no envía si es `false`), pero **ninguna pantalla del cliente permite cambiarla** — solo es visible de solo lectura para el admin en el detalle de cliente. Hoy la única forma real que tiene una alumna de "apagar" el push es desactivar el toggle "Notificaciones en este dispositivo" en Perfil, que borra su suscripción por completo (`usePushNotifications().disable()`) — funciona, pero es un mecanismo distinto (borra el dispositivo, no pone una preferencia). No es necesario arreglar esto salvo que se quiera ofrecer un opt-out más granular sin desuscribir el dispositivo entero.

---

## Troubleshooting

**"Le mandé/le llegó por WhatsApp pero no por Push" o viceversa** → normal para casi todos los eventos; solo *recordatorio de clase* y *promovida de lista de espera* salen por ambos. Revisa la tabla de arriba antes de asumir que algo falló.

**"La alumna dice que no le llega nada, ni con la app cerrada"** → en orden de probabilidad:
1. Nunca activó el toggle "Notificaciones en este dispositivo" en Perfil (opt-in explícito, no es automático).
2. iPhone sin la PWA instalada a pantalla de inicio (Safari no entrega push a pestañas sueltas).
3. Su suscripción fue podada (404/410) porque cambió de celular o borró datos del navegador — tiene que volver a activar el toggle para re-suscribirse.
4. El evento específico que espera es uno de los "❌" en la tabla (p. ej. "1 clase restante", que está apagado para todo mundo, no es un problema de su cuenta).

**Difusión manual a una alumna o a todas** → `POST /api/admin/push/user/:userId` y `POST /api/admin/push/broadcast` (`server/index.js:15276`, `:15217`), ambos solo push (no hay equivalente de difusión masiva por email/WhatsApp, por las mismas razones de anti-baneo/spam).

---

## Referencias

- Capa pura de Web Push: `server/lib/push.js` (VAPID, envío, poda de suscripciones vencidas), tests en `server/lib/__tests__/push.test.js`.
- Service Worker: `public/sw.js`.
- Manifest PWA (requisito de instalación en iOS): `public/site.webmanifest`.
- Hook de suscripción del cliente: `src/hooks/usePushNotifications.ts`.
- WhatsApp: [EVOLUTION-API-SETUP.md](EVOLUTION-API-SETUP.md).
- Memoria del proyecto: trampas de canales ya verificadas antes de este documento.
