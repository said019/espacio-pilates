# Plantillas de mensajes honestas y completas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que "Plantillas de mensajes" (Configuración → Notificaciones) sea un mapa 1:1 honesto: cada entrada editable controla un mensaje real (WhatsApp y/o Push) que efectivamente le llega a una alumna, con badge visible del canal.

**Architecture:** Sin nueva infraestructura. El mecanismo `notification_templates` (settings JSON) + `sendConfiguredWhatsAppTemplate`/`sendConfiguredPushTemplate` ya funciona de verdad — el trabajo es (a) completar/depurar las claves en backend y frontend para que coincidan con la realidad de envío, y (b) hacer visible en la UI a qué canal llega cada una.

**Tech Stack:** Node/Express (`server/index.js`), React + TanStack Query (`src/pages/admin/settings/SettingsPage.tsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-plantillas-notificaciones-design.md`

---

### Task 1: Backend — plantillas honestas (quitar 4 muertas, arreglar `transfer_rejected`)

> **Nota de la corrección post-aprobación:** `class_reminder` se agregó a la lista de "quitar" (no estaba en la versión original de este plan). Verificado con `git log -S` (commit `7b7ae55`, 2026-06-28): su cron `runClassReminderCron` fue retirado del scheduler a propósito, junto con `runRenewalReminderCron` (que envía `last_class_reminder`). Por eso `last_class_reminder` tampoco se agrega en la Task 2 — ver spec actualizado.

**Files:**
- Modify: `server/index.js:182-236` (`DEFAULT_NOTIFICATION_TEMPLATES`)
- Modify: `server/index.js:9873-9882` (`PUSH_TEMPLATE_URLS`)
- Modify: `server/index.js:13249-13262` (rechazo de comprobante — agregar push)

- [ ] **Step 1: Quitar las 4 claves muertas de `DEFAULT_NOTIFICATION_TEMPLATES`**

Verificado por grep exhaustivo de `templateKey:` en todo el archivo, más `git log -S` del scheduler: `class_reminder` y `renewal_reminder` (crons retirados el 2026-06-28, commit `7b7ae55`), `welcome` y `password_reset` (los correos reales son HTML fijo en `emailService.js`, ignoran esta clave) — ninguna de las 4 tiene hoy un call site activo que la lea.

En `server/index.js`, reemplazar el bloque completo (líneas 182-236):

```js
const DEFAULT_NOTIFICATION_TEMPLATES = {
  // Recordatorios de clase (12 h y 30 min antes). Texto fijo, sin variables.
  class_reminder_12h: {
    subject: "Recordatorio de clase",
    body: "Recordatorio de clase.\nHola 🌞🌙\n\nRecuerda que tienes una clase programada en las próximas 12 hrs, no te la pierdas 🩷",
  },
  class_reminder_30m: {
    subject: "Tu clase comienza pronto",
    body: "Tu clase comienza en 30 minutos, no te la pierdas 🩷",
  },
  booking_confirmed: {
    subject: "Reserva confirmada",
    body: "Hola {name}, tu reserva para {class} el {date} a las {time} está confirmada.",
  },
  booking_waitlist: {
    subject: "Estás en lista de espera",
    body: "Hola {name} 💜 Quedaste en *lista de espera* para {class} el {date} a las {time}.\n\nTu lugar todavía NO está confirmado. Si alguien cancela, entras automáticamente por orden de llegada y te avisamos por aquí. 🤍",
  },
  booking_waitlist_promoted: {
    subject: "¡Se liberó tu lugar!",
    body: "¡Buenas noticias, {name}! 💜 Se liberó un lugar y tu clase *{class}* del {date} a las {time} quedó *confirmada*.\n\n¡Te esperamos! 🤍",
  },
  booking_cancelled: {
    subject: "Reserva cancelada",
    body: "Hola {name}, tu reserva de {class} del {date} fue cancelada. Crédito devuelto: {creditRestored}.",
  },
  membership_activated: {
    subject: "Membresía activada",
    body: "Hola {name}, tu membresía {plan} ya está activa. Vigencia: {startDate} al {endDate}.",
  },
  transfer_rejected: {
    subject: "Transferencia rechazada",
    body: "Hola {name}, no pudimos aprobar tu comprobante. Motivo: {reason}.",
  },
  last_class_reminder: {
    subject: "Te queda 1 clase",
    body: "Hola {name} 💜 Te queda *1 clase* en tu plan {plan}. Renueva para seguir entrenando sin parar. 🤍",
  },
};
```

(Se quitaron las entradas `class_reminder`, `renewal_reminder`, `welcome`, `password_reset`. `last_class_reminder` queda intacta — sin uso activo hoy, pero no se limpia porque nunca se mostró engañosamente en la UI; ver spec §2.2. El resto queda idéntico.)

- [ ] **Step 2: Quitar `class_reminder`/`renewal_reminder` y agregar `transfer_rejected` en `PUSH_TEMPLATE_URLS`**

Reemplazar el bloque (líneas 9873-9882):

```js
const PUSH_TEMPLATE_URLS = {
  booking_confirmed: "/app/bookings",
  booking_waitlist: "/app/bookings",
  booking_waitlist_promoted: "/app/bookings",
  booking_cancelled: "/app/bookings",
  membership_activated: "/app",
  transfer_rejected: "/app/orders",
  last_class_reminder: "/app",
};
```

- [ ] **Step 3: Agregar el envío push que le falta a `transfer_rejected`**

Ubicar el bloque de rechazo de comprobante (~línea 13249-13262):

```js
        // WhatsApp notification
        if (u.phone) {
          try {
            await sendConfiguredWhatsAppTemplate({
              templateKey: "transfer_rejected",
              phone: u.phone,
              vars: {
                name: userName,
                reason: rejectionReason,
              },
              fallbackMessage: rejMsg,
            });
          } catch (waErr) {
            console.error("[Reject WhatsApp]", waErr.response?.data || waErr.message);
          }
        }
```

Agregar inmediatamente después (antes del comentario `// Email notification`):

```js

        // Push notification
        sendConfiguredPushTemplate({
          templateKey: "transfer_rejected",
          userId: order.user_id,
          vars: { name: userName, reason: rejectionReason },
        }).catch((e) => console.error("[Push] transfer rejected:", e.message));
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (sin errores).

- [ ] **Step 5: Correr la suite de tests (regresión)**

Run: `npm test`
Expected: `48 passed` (mismo conteo que antes del cambio — este cambio no toca `server/lib/*`, solo `server/index.js`).

- [ ] **Step 6: Reproducción local — confirmar que el push ya no es un no-op silencioso por falta de código**

Levantar el servidor local (`node server/index.js`, puerto 8090, BD `tep_vm`) y disparar un rechazo de orden real vía HTTP (login admin → crear una orden de prueba en `pending_verification` → `PUT /api/admin/orders/:id/reject` con un `reason`) contra un usuario de prueba. Confirmar en el log del servidor que **no hay stack trace ni excepción no capturada** proveniente de la nueva llamada `sendConfiguredPushTemplate` (en local, sin VAPID configurado, `isPushConfigured()` devuelve `false` y la función retorna `{sent:0}` de inmediato — eso es el comportamiento esperado y correcto; no se puede verificar entrega real sin credenciales de producción). Limpiar el usuario/orden de prueba de la BD al terminar. Detener el servidor.

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "fix(notificaciones): quitar 4 plantillas muertas + agregar push a transferencia rechazada

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — completar el array `NOTIFICATION_TEMPLATES` (quitar 4, agregar 4, campo `channels`)

**Files:**
- Modify: `src/pages/admin/settings/SettingsPage.tsx:224-233`

- [ ] **Step 1: Reemplazar el array completo**

Reemplazar (líneas 224-233):

```tsx
// channels: canal(es) por los que ESTE mensaje realmente le llega a la alumna hoy.
// Mantener sincronizado con WHATSAPP_ALLOWED_TEMPLATES en server/index.js si esa
// lista cambia (protege el número de WhatsApp de baneo por volumen — no todo lo
// que "intenta" WhatsApp en el backend efectivamente sale por ese canal).
const NOTIFICATION_TEMPLATES: { key: string; label: string; icon: string; hint: string; channels: ("whatsapp" | "push")[] }[] = [
  { key: "booking_confirmed",        label: "✅ Reserva confirmada",           icon: "📅", hint: "Se envía al confirmar una reserva. Vars: {name}, {class}, {date}, {time}", channels: ["push"] },
  { key: "booking_waitlist",         label: "🕐 Entraste a lista de espera",   icon: "📋", hint: "Se envía al quedar en lista de espera. Vars: {name}, {class}, {date}, {time}", channels: ["push"] },
  { key: "booking_waitlist_promoted",label: "🎉 Se liberó tu lugar",           icon: "🎊", hint: "Se envía cuando se libera un lugar y pasas a confirmada. Vars: {name}, {class}, {date}, {time}", channels: ["whatsapp", "push"] },
  { key: "booking_cancelled",        label: "❌ Reserva cancelada",            icon: "🚫", hint: "Se envía al cancelar. Vars: {name}, {class}, {date}, {creditRestored}", channels: ["push"] },
  { key: "membership_activated",     label: "🎉 Membresía activada",           icon: "🏋️", hint: "Se envía al activar membresía. Vars: {name}, {plan}, {startDate}, {endDate}", channels: ["push"] },
  { key: "transfer_rejected",        label: "⚠️ Transferencia rechazada",      icon: "💳", hint: "Se envía cuando se rechaza un comprobante. Vars: {name}, {reason}", channels: ["push"] },
  { key: "class_reminder_12h",       label: "⏰ Recordatorio 12h antes",        icon: "🔔", hint: "Se envía 12 horas antes de la clase. Vars: {name}", channels: ["whatsapp", "push"] },
  { key: "class_reminder_30m",       label: "⏰ Recordatorio 30 min antes",     icon: "🔔", hint: "Se envía 30 minutos antes de la clase. Vars: {name}", channels: ["whatsapp", "push"] },
];
```

(Se quitaron `class_reminder`, `renewal_reminder`, `welcome`, `password_reset` — no controlan ningún mensaje real hoy [`class_reminder` y `renewal_reminder`/`last_class_reminder` corresponden a crons retirados el 2026-06-28, commit `7b7ae55` — ver Errata en el spec]. Se agregaron `booking_waitlist`, `booking_waitlist_promoted`, `class_reminder_12h`, `class_reminder_30m`. `last_class_reminder` NO se agrega — sin cron activo hoy. Los `hint` de las nuevas usan las variables reales de `DEFAULT_NOTIFICATION_TEMPLATES` en `server/index.js`.)

- [ ] **Step 2: Commit**

```bash
git add src/pages/admin/settings/SettingsPage.tsx
git commit -m "feat(notificaciones): completar plantillas con los 4 mensajes reales que faltaban

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — badge de canal por plantilla

**Files:**
- Modify: `src/pages/admin/settings/SettingsPage.tsx` (cerca de `NOTIFICATION_TEMPLATES`, y la fila de la lista ~línea 373-388 tras el Task 2)

- [ ] **Step 1: Agregar el lookup de metadata de canal**

Inmediatamente después del array `NOTIFICATION_TEMPLATES` (agregado en Task 2), agregar:

```tsx
const CHANNEL_META: Record<"whatsapp" | "push", { label: string; icon: typeof MessageSquare; className: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageSquare, className: "bg-[#ECEEDF] text-[#6E7F4F] border-[#CFD4B6]" },
  push:     { label: "Push",     icon: BellDot,        className: "bg-[#F4EAD6] text-[#B5832F] border-[#E5CF9F]" },
};
```

(`MessageSquare` y `BellDot` ya están importados de `lucide-react` en este archivo — línea 20. Colores reutilizados del mismo archivo: `whatsapp` toma la paleta ya usada para el estado "OK" de wallet logs (línea 349); `push` toma la paleta ya usada para "Parcial" (línea 351). Sin colores nuevos.)

- [ ] **Step 2: Renderizar los badges en cada fila de la lista**

Ubicar el render de cada plantilla (dentro de `NOTIFICATION_TEMPLATES.map`, dentro del `<div className="flex-1 min-w-0">`):

```tsx
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {tpl?.body ? tpl.body.slice(0, 80) + (tpl.body.length > 80 ? "…" : "") : <span className="italic opacity-60">Sin personalizar (usa plantilla por defecto)</span>}
                </p>
                <div className="flex gap-1 mt-1.5">
                  {t.channels.map((c) => {
                    const meta = CHANNEL_META[c];
                    const Icon = meta.icon;
                    return (
                      <Badge key={c} variant="secondary" className={cn("text-[10px] gap-1 font-normal", meta.className)}>
                        <Icon size={10} />
                        {meta.label}
                      </Badge>
                    );
                  })}
                </div>
              </div>
```

`cn` **no está importado hoy** en este archivo (verificado). Agregar el import junto a los demás (después de la línea `import { Badge } from "@/components/ui/badge";`):

```tsx
import { cn } from "@/lib/utils";
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/settings/SettingsPage.tsx
git commit -m "feat(notificaciones): badge de canal (WhatsApp/Push) por plantilla

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — corregir etiquetas engañosas del diálogo de edición

**Files:**
- Modify: `src/pages/admin/settings/SettingsPage.tsx:400-405`

- [ ] **Step 1: Relabel "Asunto (email)" y "Cuerpo del mensaje (WhatsApp / Email)"**

El campo `subject` en realidad alimenta el **título de la notificación push** (`sendConfiguredPushTemplate` usa `tpl.subject` como `title`); ningún correo real lo lee (los correos son HTML fijo en `emailService.js`). Reemplazar (líneas 400-405):

```tsx
            <div className="space-y-1">
              <Label>Título (notificación push)</Label>
              <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder="Título de la notificación..." />
            </div>
            <div className="space-y-1">
              <Label>Cuerpo del mensaje (WhatsApp / Push)</Label>
              <Textarea rows={6} value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="Escribe el mensaje aquí..." />
              <p className="text-xs text-muted-foreground">{editText.length} caracteres</p>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/admin/settings/SettingsPage.tsx
git commit -m "fix(notificaciones): corregir etiquetas del diálogo (el asunto es el título del push, no de un email)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Verificación final e integración

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Build de producción del frontend**

Run: `npm run build`
Expected: `✓ built in Xs`, sin errores de TypeScript en `SettingsPage`.

- [ ] **Step 2: Confirmar que no quedan referencias muertas**

Run: `grep -nE "welcome|password_reset|renewal_reminder|\"class_reminder\"|'class_reminder'|key: .class_reminder." src/pages/admin/settings/SettingsPage.tsx server/index.js`
Expected: `password_reset` puede seguir apareciendo en contextos NO relacionados a plantillas (p. ej. `password_reset_tokens`, la tabla de tokens de recuperación — eso es una feature distinta y no se toca). `class_reminder` puede seguir apareciendo como PREFIJO de `class_reminder_12h`/`class_reminder_30m`/`class_reminder_enabled`/`class_reminder_sent` (tabla) — eso es esperado, son claves distintas. Confirmar visualmente que ninguna coincidencia exacta de `class_reminder` (sin sufijo) ni `renewal_reminder`/`welcome`/`password_reset` queda dentro de `DEFAULT_NOTIFICATION_TEMPLATES`, `PUSH_TEMPLATE_URLS` ni `NOTIFICATION_TEMPLATES`.

- [ ] **Step 3: Reproducción local — pantalla completa**

Levantar backend local (`node server/index.js`) y frontend (`npm run dev`), entrar como admin a Configuración → Notificaciones → pestaña Notificaciones, y confirmar visualmente:
- Aparecen **8 plantillas** (no 8 iguales a las de antes — son 4 distintas de las originales: se fueron `class_reminder`/`welcome`/`password_reset`/`renewal_reminder`, llegaron `booking_waitlist`/`booking_waitlist_promoted`/`class_reminder_12h`/`class_reminder_30m`).
- Cada una tiene al menos un badge de canal (Push, o WhatsApp + Push).
- El diálogo de edición de cualquiera dice "Título (notificación push)" y "Cuerpo del mensaje (WhatsApp / Push)".
- Guardar una edición de prueba sigue funcionando (`PUT /api/settings/notification_templates` → 200, toast "✅ Plantilla guardada").

Detener ambos servidores al terminar.

- [ ] **Step 4: Confirmar estado de git**

Run: `git log --oneline -6 && git status --short`
Expected: 4 commits nuevos de esta sesión (backend, array, badges, relabel) sobre el commit del spec; working tree limpio (sin cambios sin commitear, sin archivos de prueba sueltos).

**No hacer push** — dejar los commits listos localmente y preguntar al usuario antes de subir, igual que el resto de cambios de esta sesión.

---

## Self-Review

- **Cobertura del spec:** §2.1 (push a transfer_rejected) → Task 1. §2.2 (quitar 4 claves backend) → Task 1. §3.1 (array frontend +4/−4/channels) → Task 2. §3.2 (badges) → Task 3. §3.3 (relabel) → Task 4. §5 (pruebas) → Task 1 Step 4-6, Task 5. Sin huecos.
- **Placeholders:** ninguno — todo paso de código trae el bloque completo a pegar, no descripciones sueltas. El paso de `cn` (Task 3) se corrigió de condicional ("si no está, agregar") a definitivo, tras verificar que en efecto no está importado hoy.
- **Consistencia de tipos/nombres:** `channels` se define en Task 2 como `("whatsapp" | "push")[]` y se consume igual en Task 3 (`CHANNEL_META[c]` con `c` tipado). Las claves (`booking_waitlist`, `class_reminder_12h`, etc.) coinciden exactas entre backend (Task 1) y frontend (Task 2) — mismo string en ambos lados, verificado contra `DEFAULT_NOTIFICATION_TEMPLATES` real.
- **Corrección post-aprobación (importante):** la primera pasada de este plan incluía `class_reminder` como plantilla real a conservar y `last_class_reminder` como una de las "faltantes a agregar". Al re-verificar con `git log -S` antes de ejecutar, se confirmó que ambos crons fueron retirados a propósito el 2026-06-28 (commit `7b7ae55`). Se corrigió: `class_reminder` pasa a "quitar" (Task 1 y 2), `last_class_reminder` no se agrega (Task 2). El spec (`docs/superpowers/specs/2026-07-01-plantillas-notificaciones-design.md`) tiene el detalle completo en su sección "Errata".
