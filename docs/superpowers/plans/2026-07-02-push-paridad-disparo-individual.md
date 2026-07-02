# Plan A — Paridad push + disparo individual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los recordatorios de clase 12h/30m y las reservas (reagenda/asignación admin) también salgan por notificación push, y que la admin pueda enviar un push manual a UNA alumna desde su expediente.

**Architecture:** Todo el sistema de push ya existe y está activo en producción (VAPID en Railway). Este plan solo AGREGA llamadas `sendConfiguredPushTemplate`/`sendPushToUser` en los call sites que hoy solo hacen WhatsApp/email, relaja un filtro de teléfono, agrega un endpoint admin per-clienta y su botón. Cambios aditivos, bajo riesgo.

**Tech Stack:** Node/Express + PostgreSQL (`server/index.js`), React + TanStack Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-02-notificaciones-push-y-wallet-design.md` (§3).

**Contexto crítico de ejecución:**
- Ubicar SIEMPRE por contenido (grep), no por número de línea — `server/index.js` (~15.6k líneas) se corre con cada edición.
- En LOCAL el push es no-op (no hay VAPID en `.env`): `sendConfiguredPushTemplate`/`sendPushToUser` retornan `{sent:0}` sin lanzar. La verificación local es "el call site se ejecuta y no lanza" + el endpoint responde bien; la entrega real se prueba en producción tras desplegar.
- Entorno local: backend `node server/index.js` (8090, BD `postgresql://localhost:5432/tep_vm` en `.env`), front `npx vite --port 5173` (8080 ocupado por otro proyecto, CORS solo permite 5173), admin `espaciopilatesvm@gmail.com` / `EspacioVM2026!`. BD base: 9 users / 4 orders / 2 memberships — dejarla igual.
- No hacer push a git al final; preguntar a Said.

---

### Task 1: Recordatorios 12h/30m también por push (+ incluir alumnas sin teléfono)

**Files:**
- Modify: `server/index.js` — función `runClassReminders` (grep `async function runClassReminders`, ~15479) y `PUSH_TEMPLATE_URLS` (grep `const PUSH_TEMPLATE_URLS`, ~9936).

- [ ] **Step 1: Agregar URLs de click para los recordatorios en `PUSH_TEMPLATE_URLS`**

Localizar el objeto (grep `const PUSH_TEMPLATE_URLS`) y agregar dos entradas antes del cierre `};`:

```js
const PUSH_TEMPLATE_URLS = {
  booking_confirmed: "/app/bookings",
  booking_waitlist: "/app/bookings",
  booking_waitlist_promoted: "/app/bookings",
  booking_cancelled: "/app/bookings",
  membership_activated: "/app",
  transfer_rejected: "/app/orders",
  last_class_reminder: "/app",
  class_reminder_12h: "/app/bookings",
  class_reminder_30m: "/app/bookings",
};
```

- [ ] **Step 2: En `runClassReminders`, traer `user_id`, permitir alumnas sin teléfono, y no cortar todo si WhatsApp está apagado**

En la función `runClassReminders` (grep `async function runClassReminders`):

(a) El gate de arriba hoy es `if (ns?.whatsapp_reminders === false || ns?.class_reminder_enabled === false) return;`. Cambiarlo para que solo el toggle de recordatorios de clase detenga TODO (el push no debe depender del toggle de WhatsApp; `sendConfiguredWhatsAppTemplate` ya se auto-gatea internamente con `whatsapp_reminders`):

```js
    if (ns?.class_reminder_enabled === false) return;
```

(b) El SELECT debe traer `user_id` y ya no exigir teléfono. Reemplazar el bloque `const res = await pool.query(\`...\`);` por:

```js
    const res = await pool.query(`
      SELECT b.id AS booking_id, b.user_id, u.phone, COALESCE(u.display_name,'Alumna') AS name,
             EXTRACT(EPOCH FROM (
               ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') - now()
             )) / 60 AS mins_until
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN users u   ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND c.status = 'scheduled'
        AND u.receive_reminders IS NOT FALSE
        AND c.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
        AND ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') > now()
    `);
```

(Se eliminó `AND u.phone IS NOT NULL`; se agregó `b.user_id`. Ahora entran también alumnas sin teléfono, que recibirán push aunque no WhatsApp.)

- [ ] **Step 3: Agregar el envío push junto al de WhatsApp dentro del loop**

En el mismo loop `for (const d of pending) { ... }`, localizar el `sendConfiguredWhatsAppTemplate({ templateKey: is12h ? "class_reminder_12h" : "class_reminder_30m", ... }).catch((e) => console.error("[WA] recordatorio clase:", e.message));` y agregar INMEDIATAMENTE DESPUÉS:

```js
      sendConfiguredPushTemplate({
        templateKey: is12h ? "class_reminder_12h" : "class_reminder_30m",
        userId: d.user_id,
        vars: { name: d.name },
      }).catch((e) => console.error("[Push] recordatorio clase:", e.message));
```

(El `sendConfiguredWhatsAppTemplate` con `phone: d.phone` = null es un no-op seguro — su primera línea es `if (!phone) return { sent:false, reason:'no_phone' }` — así que las alumnas sin teléfono solo reciben push, sin error.)

- [ ] **Step 4: Verificar sintaxis + tests**

Run: `node --check server/index.js && npm test`
Expected: sintaxis OK y `Tests 54 passed (54)` (no se toca `server/lib/*`).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(push): recordatorios de clase 12h/30m también por push + incluir alumnas sin teléfono

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 2: Push en reagenda y en asignación admin de reservas

**Files:**
- Modify: `server/index.js` — reagenda (grep el `sendConfiguredWhatsAppTemplate` con `fallbackMessage: \`Hola ${waName}, reagendaste`, ~4298) y admin-assign (grep `[WA] booking confirmed (admin)`, ~12145).

- [ ] **Step 1: Push en la reagenda de reserva**

Localizar (grep `reagendaste tu reserva`) el `sendConfiguredWhatsAppTemplate({ templateKey: "booking_confirmed", phone: u.phone, ... }).catch((e) => console.error("[WA] booking rescheduled:", e.message));` y agregar INMEDIATAMENTE DESPUÉS:

```js
        sendConfiguredPushTemplate({
          templateKey: "booking_confirmed",
          userId: req.userId,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
        }).catch((e) => console.error("[Push] booking rescheduled:", e.message));
```

(La reagenda la hace la propia alumna → `req.userId` es la destinataria.)

- [ ] **Step 2: Push en la asignación admin de reserva**

Localizar (grep `[WA] booking confirmed (admin)`) el `sendConfiguredWhatsAppTemplate({ templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed", phone: u.phone, ... }).catch((e) => console.error("[WA] booking confirmed (admin):", e.message));` y agregar INMEDIATAMENTE DESPUÉS:

```js
        sendConfiguredPushTemplate({
          templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed",
          userId,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
        }).catch((e) => console.error("[Push] booking confirmed (admin):", e.message));
```

(En ese endpoint la alumna destino es la variable `userId` — la misma con que se consulta `userRes` justo arriba: `SELECT ... FROM users WHERE id = $1, [userId]`. Verificar que `userId` está en scope; lo está.)

- [ ] **Step 3: Verificar + commit**

Run: `node --check server/index.js && npm test` → 54 passed.

```bash
git add server/index.js
git commit -m "feat(push): agregar push al reagendar y al asignar reserva desde admin

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 3: Endpoint admin para enviar push a UNA alumna + info de dispositivos

**Files:**
- Modify: `server/index.js` — agregar 2 endpoints junto al broadcast (grep `app.post("/api/admin/push/broadcast"`, ~15095).

- [ ] **Step 1: Agregar `GET /api/admin/push/user/:userId/devices` y `POST /api/admin/push/user/:userId`**

Inmediatamente DESPUÉS del cierre `});` del handler `app.post("/api/admin/push/broadcast", ...)`, agregar:

```js
// GET /api/admin/push/user/:userId/devices — cuántos dispositivos suscritos + preferencia
app.get("/api/admin/push/user/:userId/devices", adminMiddleware, async (req, res) => {
  try {
    const dev = await pool.query(
      "SELECT COUNT(*)::int AS devices FROM push_subscriptions WHERE user_id = $1",
      [req.params.userId]
    );
    const pref = await pool.query("SELECT push_reminders FROM users WHERE id = $1", [req.params.userId]);
    return res.json({
      enabled: isPushConfigured(),
      devices: dev.rows[0]?.devices ?? 0,
      pushReminders: pref.rows[0]?.push_reminders !== false,
    });
  } catch (err) {
    console.error("GET /admin/push/user/:userId/devices:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/push/user/:userId — push manual a UNA alumna (texto libre)
app.post("/api/admin/push/user/:userId", adminMiddleware, async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(400).json({ message: "Push no configurado" });
    const { title, body, url } = req.body || {};
    if (!title || !body) return res.status(400).json({ message: "Falta título o mensaje" });
    const r = await sendPushToUser(req.params.userId, {
      title: String(title).slice(0, 80),
      body: String(body).slice(0, 240),
      url: url || "/app",
      tag: "admin_manual",
      respectPrefs: true,
    });
    return res.json(r); // { sent, failed, pruned }
  } catch (err) {
    console.error("POST /admin/push/user/:userId:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});
```

- [ ] **Step 2: Verificar sintaxis + reproducción local del endpoint**

Run: `node --check server/index.js`. Luego levantar el server local, login admin, y probar con una alumna existente (id de `GET /api/admin/clients` o de la BD):
- `GET /api/admin/push/user/<id>/devices` → 200 con `{enabled:false (local sin VAPID), devices:0, pushReminders:true}`.
- `POST /api/admin/push/user/<id>` con `{}` → 400 "Falta título o mensaje"; con `{title,body}` → 400 "Push no configurado" en local (correcto, sin VAPID). En producción respondería `{sent,failed,pruned}`.

Documentar en el reporte ambos status codes observados.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(push): endpoint admin para push manual a una alumna + conteo de dispositivos

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 4: Botón "Enviar notificación" en el expediente de la clienta

**Files:**
- Modify: `src/pages/admin/clients/ClientDetail.tsx` (el componente principal; grep `resetPasswordMutation` y el `SectionCard title="Perfil de la alumna"`).

- [ ] **Step 1: Estado + queries/mutations del push manual**

Junto a `resetPasswordMutation` (grep `const resetPasswordMutation = useMutation`), agregar el estado del diálogo y las llamadas. Requiere `useState` (ya importado en el archivo; si no, agregarlo a `import { ... } from "react"`), `Dialog*` de `@/components/ui/dialog`, `Input`, `Textarea`, `Label`, `Button` (verificar imports; agregar los que falten con el mismo estilo de imports del archivo):

```tsx
  const [pushOpen, setPushOpen] = useState(false);
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const { data: pushInfo } = useQuery({
    queryKey: ["push-user-devices", id],
    queryFn: async () => (await api.get(`/admin/push/user/${id}/devices`)).data,
    enabled: pushOpen,
  });
  const sendPushMutation = useMutation({
    mutationFn: () => api.post(`/admin/push/user/${id}`, { title: pushTitle, body: pushBody }),
    onSuccess: (res: any) => {
      toast({ title: "Notificación enviada", description: `Entregada a ${res?.data?.sent ?? 0} dispositivo(s).` });
      setPushOpen(false); setPushTitle(""); setPushBody("");
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "No se pudo enviar", variant: "destructive" }),
  });
```

- [ ] **Step 2: Botón en el action del SectionCard "Perfil de la alumna"**

Localizar el `action={!editing && !isLoading ? ( <div className="flex items-center gap-2"> ... botón "Restablecer contraseña" ... <Button ...>Editar</Button> </div> ) : undefined}` y agregar, ANTES del botón "Restablecer contraseña", un botón hermano con el mismo estilo pill:

```tsx
                    <button
                      type="button"
                      onClick={() => setPushOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-valiance-mauve/30 px-3.5 py-2 text-[0.78rem] font-medium text-valiance-mauve transition-colors hover:bg-valiance-mauve hover:text-valiance-nude"
                    >
                      Enviar notificación
                    </button>
```

- [ ] **Step 3: Diálogo de composición**

Antes del cierre del componente (junto al resto del JSX de retorno, por ejemplo justo antes del `</ClientLayout>`/`</AdminLayout>` de cierre — ubicar el cierre real del return), agregar:

```tsx
      <Dialog open={pushOpen} onOpenChange={setPushOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar notificación</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {pushInfo?.enabled === false
              ? "Las notificaciones push no están configuradas en el servidor."
              : `${pushInfo?.devices ?? 0} dispositivo(s) suscrito(s)${pushInfo?.pushReminders === false ? " · la alumna desactivó los recordatorios" : ""}.`}
          </p>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Título</Label>
              <Input value={pushTitle} maxLength={80} onChange={(e) => setPushTitle(e.target.value)} placeholder="Ej. Recordatorio" />
            </div>
            <div className="space-y-1">
              <Label>Mensaje</Label>
              <Textarea rows={4} value={pushBody} maxLength={240} onChange={(e) => setPushBody(e.target.value)} placeholder="Escribe el mensaje…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => sendPushMutation.mutate()}
              disabled={sendPushMutation.isPending || !pushTitle || !pushBody || pushInfo?.enabled === false || (pushInfo?.devices ?? 0) === 0}
            >
              {sendPushMutation.isPending ? "Enviando…" : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep ClientDetail` sin salida (los errores TS pre-existentes están en Index.tsx/supabase/Auth, fuera de alcance).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/clients/ClientDetail.tsx
git commit -m "feat(push): botón 'Enviar notificación' en el expediente de la alumna

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 5: Badges 12h/30m a WhatsApp+Push + confirmación en el aviso masivo

**Files:**
- Modify: `src/pages/admin/settings/SettingsPage.tsx` — `NOTIFICATION_TEMPLATES` (grep `const NOTIFICATION_TEMPLATES`) y `PushBroadcastSection` (grep `const PushBroadcastSection`).

- [ ] **Step 1: Actualizar los badges de canal de los recordatorios**

En `NOTIFICATION_TEMPLATES`, cambiar `channels` de las dos entradas de recordatorio de `["whatsapp"]` a `["whatsapp", "push"]`:

```tsx
  { key: "class_reminder_12h",       label: "⏰ Recordatorio 12h antes",        icon: "🔔", hint: "Se envía 12 horas antes de la clase. Vars: {name}", channels: ["whatsapp", "push"] },
  { key: "class_reminder_30m",       label: "⏰ Recordatorio 30 min antes",     icon: "🔔", hint: "Se envía 30 minutos antes de la clase. Vars: {name}", channels: ["whatsapp", "push"] },
```

- [ ] **Step 2: Confirmación previa en el envío masivo**

En `PushBroadcastSection`, envolver el disparo del botón "Enviar aviso" con una confirmación. Cambiar el `onClick={() => mutation.mutate()}` del `<Button>` final por:

```tsx
        onClick={() => {
          const n = stats?.subscribers ?? 0;
          if (window.confirm(`Enviar este aviso a ${n} alumna(s) suscrita(s)? No se puede deshacer.`)) {
            mutation.mutate();
          }
        }}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → OK; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep SettingsPage` sin salida.

```bash
git add src/pages/admin/settings/SettingsPage.tsx
git commit -m "feat(push): badges 12h/30m como WhatsApp+Push y confirmación antes del aviso masivo

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 6: Verificación final e integración

**Files:** ninguno (solo verificación)

- [ ] **Step 1:** `node --check server/index.js && npm test` (54/54) && `npm run build` (✓).
- [ ] **Step 2 (reproducción local — camino de código, no entrega real):** levantar backend (8090) + front (5173). Con admin: abrir el expediente de una alumna → botón "Enviar notificación" abre el diálogo, muestra "0 dispositivo(s)" (local sin VAPID) y el botón Enviar queda deshabilitado (correcto). En la pestaña Avisos: el botón ahora pide confirmación. En los recordatorios (SettingsPage → Notificaciones) los badges de 12h/30m muestran WhatsApp + Push.
- [ ] **Step 3 (opcional, prueba de que los crons no lanzan):** en el server local, forzar una corrida del cron: crear una reserva confirmada para dentro de ~20 min y esperar/loguear que `runClassReminders` intenta enviar sin lanzar (el push es no-op local). Alternativa mínima: confirmar por lectura que no hay error de referencia a `d.user_id`.
- [ ] **Step 4:** Limpiar cualquier dato de prueba, `git status` limpio, `git log --oneline -6`. **NO hacer push** — preguntar a Said (la entrega real de push se valida en producción tras desplegar, con un dispositivo suscrito).

---

## Self-Review
- **Cobertura del spec §3:** A1 (12h/30m push + filtro phone + URLs + badges) → Tasks 1, 5. A2 (reagenda + admin-assign) → Task 2. A3 (endpoint + botón + devices) → Tasks 3, 4. A4 (confirm broadcast) → Task 5. Sin huecos.
- **Placeholders:** ninguno — cada paso trae el bloque exacto. `<MODELO>` en los commits es intencional (el modelo ejecutor pone su co-author).
- **Consistencia:** `sendConfiguredPushTemplate({templateKey, userId, vars})` se usa igual que los call sites existentes (verificado contra ~3846, ~5518). El endpoint `POST /api/admin/push/user/:userId` espeja `sendPushToUser` (mismos campos que el broadcast ~15118). El botón usa `id` (el param de ruta del expediente) consistente con `resetPasswordMutation` (`/admin/users/${id}/...`).
