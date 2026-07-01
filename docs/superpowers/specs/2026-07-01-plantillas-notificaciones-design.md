# Plantillas de mensajes honestas y completas (Configuración → Notificaciones) — Diseño

**Fecha:** 2026-07-01
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Motivo:** La dueña pidió agregar a esta pantalla los mensajes que el estudio ya está usando y que sean "100% configurables". Al auditar el código se encontró que de las 8 plantillas mostradas hoy, solo 4 controlan un mensaje real; las otras 4 son controles decorativos (editar su texto no le llega a ninguna alumna). Además faltan 4 plantillas reales que sí se envían todos los días.

> **Errata (post-aprobación, antes de implementar):** la primera versión de este documento decía "faltan 5 plantillas" e incluía `last_class_reminder` como una de ellas, y mantenía `class_reminder` como plantilla real ("Push"). Al re-verificar antes de escribir el plan de implementación se encontró, con evidencia de `git log` (commit `7b7ae55`, 2026-06-28, mensaje: *"Scheduler: retira renovación y los recordatorios viejos (9pm/8am)"*), que **ambas fueron retiradas deliberadamente hace 3 días**: sus funciones (`runClassReminderCron`, `runRenewalReminderCron`) siguen en el archivo pero ya no están agendadas en ningún `setInterval`/cron — son código muerto, igual que `welcome`/`password_reset`/`renewal_reminder`. Corregido abajo: ambas pasan a "Quitar del listado"; no se reactivan (fue una decisión de negocio reciente, no un bug).

---

## 1. Objetivo y alcance

Que la lista de "Plantillas de mensajes" sea un **mapa 1:1 honesto**: cada entrada editable controla un mensaje real que efectivamente le llega a una alumna por **WhatsApp y/o Push**, con una etiqueta visible de a qué canal(es) llega.

**Alcance:** solo WhatsApp y Push (el mecanismo `notification_templates` ya lee/escribe ahí de verdad). **Fuera de alcance** (decisión explícita del negocio, confirmada con el usuario): el contenido de los **correos de marca** (HTML con logo/diseño — bienvenida, recuperación de contraseña, recordatorio semanal, y el cuerpo largo de reserva/membresía/cancelación) sigue fijo en `emailService.js`, sin conectarse a esta pantalla. Tampoco se toca la lista blanca `WHATSAPP_ALLOWED_TEMPLATES` (decisión de negocio para no arriesgar el número por volumen).

### Diagnóstico verificado (estado actual)

| Clave | ¿En la lista hoy? | Canal real hoy | Acción |
|---|---|---|---|
| `booking_confirmed` | Sí | Push (WA intentado, bloqueado por whitelist) | Mantener + etiquetar canal |
| `booking_cancelled` | Sí | Push (WA bloqueado) | Mantener + etiquetar canal |
| `membership_activated` | Sí | Push (WA bloqueado) | Mantener + etiquetar canal |
| `transfer_rejected` | Sí | **Ninguno** (WA bloqueado, sin push, email fijo aparte) | Arreglar: agregar envío push |
| `class_reminder` | Sí | **Ninguno** — cron `runClassReminderCron` retirado del scheduler el 2026-06-28 (commit `7b7ae55`), reemplazado por `class_reminder_12h`/`class_reminder_30m` | Quitar del listado |
| `welcome` | Sí | **Ninguno** (correo real es HTML fijo, ignora esta clave) | Quitar del listado |
| `password_reset` | Sí | **Ninguno** (correo real es HTML fijo, ignora esta clave) | Quitar del listado |
| `renewal_reminder` | Sí | **Ninguno** (clave huérfana, ningún call site la usa) | Quitar del listado |
| `class_reminder_12h` | No | WhatsApp (en whitelist) + Push | Agregar |
| `class_reminder_30m` | No | WhatsApp (en whitelist) + Push | Agregar |
| `booking_waitlist` | No | Push (WA bloqueado) | Agregar |
| `booking_waitlist_promoted` | No | WhatsApp (en whitelist) + Push | Agregar |
| `last_class_reminder` | No — y **tampoco se agrega** | **Ninguno** — cron `runRenewalReminderCron` retirado del scheduler el mismo commit `7b7ae55`. No es "falta agregarla", es una plantilla sin ningún envío activo hoy. | No agregar (documentar como pendiente si se reactiva a futuro) |

Resultado: **8 plantillas** editables en total (8 actuales − 4 quitadas [`class_reminder`, `welcome`, `password_reset`, `renewal_reminder`] + 4 agregadas [`class_reminder_12h`, `class_reminder_30m`, `booking_waitlist`, `booking_waitlist_promoted`]), todas con efecto real verificado end-to-end (código + `git log` del scheduler).

---

## 2. Backend (`server/index.js`)

### 2.1 Arreglar `transfer_rejected` (agregar el push que le falta)
Junto al `sendConfiguredWhatsAppTemplate({ templateKey: "transfer_rejected", ... })` existente (~línea 13251, dentro del rechazo de comprobante), agregar una llamada a `sendConfiguredPushTemplate({ templateKey: "transfer_rejected", userId: order.user_id, vars: { name, reason } })`, mismo patrón que usan `booking_cancelled`, `membership_activated`, etc. Agregar también `transfer_rejected: "/app/orders"` a `PUSH_TEMPLATE_URLS` (~línea 9873).

### 2.2 Quitar claves muertas de `DEFAULT_NOTIFICATION_TEMPLATES` (~líneas 182-236)
Eliminar las entradas `class_reminder`, `renewal_reminder`, `welcome`, `password_reset` (ningún call site activo las lee — verificado por grep exhaustivo de `templateKey:` **y** por `git log` del scheduler para las dos basadas en cron). `last_class_reminder` **no se agrega** al frontend (§3.1) por el mismo motivo, pero su entrada en `DEFAULT_NOTIFICATION_TEMPLATES` se deja intacta (no forma parte de la limpieza — no está mostrándose engañosamente en ningún lado hoy). Eliminar también `class_reminder` y `renewal_reminder` de `PUSH_TEMPLATE_URLS` (~línea 9873-9882).

Sin cambios a `WHATSAPP_ALLOWED_TEMPLATES`, a la lógica de envío (`sendConfiguredWhatsAppTemplate`, `sendConfiguredPushTemplate`, `renderTemplateVars`), ni a `emailService.js`.

---

## 3. Frontend (`src/pages/admin/settings/SettingsPage.tsx`)

### 3.1 `NOTIFICATION_TEMPLATES` (~líneas 224-233)
- Quitar las entradas `class_reminder`, `welcome`, `password_reset`, `renewal_reminder`.
- Agregar 4 entradas nuevas: `class_reminder_12h`, `class_reminder_30m`, `booking_waitlist`, `booking_waitlist_promoted` (label, icon, hint con variables reales tomadas de `DEFAULT_NOTIFICATION_TEMPLATES`/call sites). `last_class_reminder` **no se agrega** (ver Errata / tabla §1 — cron retirado, no hay envío que configurar).
- Agregar campo nuevo `channels: ("whatsapp" | "push")[]` a **cada** entrada (existentes + nuevas), reflejando la tabla del §1. Comentario en el código: mantener sincronizado con `WHATSAPP_ALLOWED_TEMPLATES` en `server/index.js` si esa lista cambia.

### 3.2 Badge de canal por plantilla
En cada fila de la lista (~línea 373-388), renderizar un `Badge` (componente ya importado/usado en este archivo) por cada canal en `t.channels`: "WhatsApp" (ícono `MessageSquare`, ya importado) y "Push" (ícono `BellDot`, ya importado). Estilo consistente con los `Badge` ya existentes en el archivo (línea 345).

### 3.3 Diálogo de edición — relabel
Cambiar el label "Asunto (email)" (~línea 400) por **"Título (notificación push)"**, porque ese campo (`subject`) hoy alimenta el título de la notificación push (`sendConfiguredPushTemplate`), no un asunto de correo — el correo es HTML fijo y no lee este campo. Placeholder acorde ("Título de la notificación...").

---

## 4. Fuera de alcance (explícito)
- Conectar el cuerpo de los correos de marca (`emailService.js`) a estas plantillas.
- Agregar un mensaje/plantilla para el recordatorio semanal (hoy es 100% correo, sin equivalente WhatsApp/push).
- Tocar `WHATSAPP_ALLOWED_TEMPLATES` (agregar `transfer_rejected` u otras claves a WhatsApp).
- **Reactivar `runClassReminderCron`/`runRenewalReminderCron`** (recordatorio genérico y "te queda 1 clase"). Fueron retirados a propósito hace 3 días (commit `7b7ae55`); reactivarlos es una decisión de negocio aparte, no parte de este cambio.

---

## 5. Pruebas
- `node --check server/index.js` + `npm test` (suite existente) tras el cambio backend.
- `npm run build` tras el cambio frontend (type-check + bundle).
- Reproducción local (servidor + BD local, sin credenciales reales de WhatsApp/Resend por lo que los envíos quedan como no-op logueado): disparar un rechazo de comprobante de prueba y confirmar en logs que ahora intenta push además de WhatsApp.
- Verificación visual: las 8 plantillas se ven con su badge de canal correcto; las 4 quitadas ya no aparecen.

## 6. Archivos tocados
| Archivo | Cambio |
|---|---|
| `server/index.js` | push a `transfer_rejected`; quitar 4 claves muertas (`class_reminder`, `renewal_reminder`, `welcome`, `password_reset`) de `DEFAULT_NOTIFICATION_TEMPLATES`; quitar 2 de `PUSH_TEMPLATE_URLS` |
| `src/pages/admin/settings/SettingsPage.tsx` | `NOTIFICATION_TEMPLATES` (+4/−4, campo `channels`); badges de canal; relabel del campo "Asunto" |
