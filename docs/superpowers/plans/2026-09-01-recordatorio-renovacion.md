# Recordatorio de renovación de membresía (push) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push automático los días 28 y 1ro de cada mes (~12pm México) a las alumnas pendientes de renovar, con el copy de la dueña, editable desde el panel.

**Architecture:** Capa pura nueva (`server/lib/renewalReminder.js`) para el "cuándo" y la clave de dedup (testeable); plantilla `renewal_reminder` (editable); cron `runMonthlyRenewalReminders()` en `server/index.js` que consulta pendientes, deduplica y envía push; agendado en `scheduleEmailCrons`.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), Web Push (ya existente), React (panel), vitest.

Diseño: `docs/superpowers/specs/2026-09-01-recordatorio-renovacion-design.md`.

---

### Task 1: Capa pura `renewalReminder.js` (TDD)

**Files:**
- Create: `server/lib/renewalReminder.js`
- Test: `server/lib/__tests__/renewalReminder.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `server/lib/__tests__/renewalReminder.test.js`:

```js
import { describe, it, expect } from "vitest";
import { mexicoDateParts, isRenewalReminderTime, renewalReminderDedupKey } from "../renewalReminder.js";

// Construye un Date en UTC para (year, month 1-12, day, hour).
const utc = (y, mo, d, h) => new Date(Date.UTC(y, mo - 1, d, h, 0, 0));

describe("mexicoDateParts", () => {
  it("resta 6 horas (UTC-6): 18:00 UTC = 12:00 México mismo día", () => {
    expect(mexicoDateParts(utc(2026, 9, 28, 18))).toEqual({ year: 2026, month: 9, day: 28, hour: 12 });
  });
  it("cruza al día anterior antes de las 6:00 UTC", () => {
    // 03:00 UTC del día 1 = 21:00 del día anterior en México
    expect(mexicoDateParts(utc(2026, 9, 1, 3))).toEqual({ year: 2026, month: 8, day: 31, hour: 21 });
  });
});

describe("isRenewalReminderTime", () => {
  it("true el 28 a las 12pm México (18:00 UTC)", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 28, 18))).toBe(true);
  });
  it("true el 1ro a las 12pm México", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 1, 18))).toBe(true);
  });
  it("false otro día a las 12pm México", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 15, 18))).toBe(false);
  });
  it("false el 28 a otra hora (14:00 México)", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 28, 20))).toBe(false);
  });
});

describe("renewalReminderDedupKey", () => {
  it("formatea renew_YYYY_MM_DD con ceros a la izquierda (día 1)", () => {
    expect(renewalReminderDedupKey(utc(2026, 9, 1, 18))).toBe("renew_2026_09_01");
  });
  it("día 28", () => {
    expect(renewalReminderDedupKey(utc(2026, 12, 28, 18))).toBe("renew_2026_12_28");
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run server/lib/__tests__/renewalReminder.test.js`
Expected: FAIL — el módulo `../renewalReminder.js` no existe.

- [ ] **Step 3: Implementar la capa pura**

Crea `server/lib/renewalReminder.js`:

```js
// Capa pura del recordatorio de renovación (días 28 y 1ro, 12pm hora de
// México). La orquestación (query + envío push) vive en server/index.js.
// San Luis Potosí es UTC-6 todo el año (México no observa DST desde 2023),
// mismo criterio que el cron semanal existente.

const MEXICO_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC-6

// Partes de fecha/hora en horario de México.
export function mexicoDateParts(date) {
  const mx = new Date(date.getTime() - MEXICO_OFFSET_MS);
  return {
    year: mx.getUTCFullYear(),
    month: mx.getUTCMonth() + 1, // 1-12
    day: mx.getUTCDate(),
    hour: mx.getUTCHours(),
  };
}

// ¿Es momento de correr el recordatorio? Días 28 o 1, a las 12 (hora México).
export function isRenewalReminderTime(date) {
  const { day, hour } = mexicoDateParts(date);
  return (day === 28 || day === 1) && hour === 12;
}

// Clave de dedup por fecha: renew_YYYY_MM_DD (DD = 28 o 01).
export function renewalReminderDedupKey(date) {
  const { year, month, day } = mexicoDateParts(date);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `renew_${year}_${mm}_${dd}`;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run server/lib/__tests__/renewalReminder.test.js`
Expected: PASS — los 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/renewalReminder.js server/lib/__tests__/renewalReminder.test.js
git commit -m "feat(renovacion): capa pura del recordatorio de renovación (cuándo + dedup key)"
```

---

### Task 2: Plantilla `renewal_reminder` (editable)

**Files:**
- Modify: `server/index.js` (DEFAULT_NOTIFICATION_TEMPLATES ~203, PUSH_TEMPLATE_URLS ~10777)
- Modify: `src/pages/admin/settings/SettingsPage.tsx` (array NOTIFICATION_TEMPLATES ~229)

- [ ] **Step 1: Agregar la plantilla a DEFAULT_NOTIFICATION_TEMPLATES**

En `server/index.js`, localiza el objeto `DEFAULT_NOTIFICATION_TEMPLATES` y su entrada existente `last_class_reminder` (aprox. línea 237):

```js
  last_class_reminder: {
    subject: "Te queda 1 clase",
    body: "Hola {name} 💜 Te queda *1 clase* en tu plan {plan}. Renueva para seguir entrenando sin parar. 🤍",
  },
```

Justo después de esa entrada (dentro del mismo objeto), agrega:

```js
  renewal_reminder: {
    subject: "🩷 ¡No dejes que tu progreso se detenga!",
    body: "Cada clase te acerca a tu objetivo. Renueva tu membresía y sigue construyendo la mejor versión de ti. 📲 ¡Te esperamos en clase!",
  },
```

(Si la entrada `last_class_reminder` no es la última del objeto, igual agrega `renewal_reminder` como una entrada más; el orden no importa.)

- [ ] **Step 2: Agregar la URL de destino en PUSH_TEMPLATE_URLS**

En `server/index.js`, localiza el objeto `PUSH_TEMPLATE_URLS` (aprox. línea 10777, contiene `last_class_reminder: "/app",`). Agrega una entrada:

```js
  renewal_reminder: "/app/checkout",
```

- [ ] **Step 3: Agregar la plantilla al panel de admin (editable)**

En `src/pages/admin/settings/SettingsPage.tsx`, localiza el array `NOTIFICATION_TEMPLATES` (aprox. línea 229) y su última entrada `class_reminder_30m` (aprox. línea 237):

```jsx
  { key: "class_reminder_30m",       label: "⏰ Recordatorio 30 min antes",     icon: "🔔", hint: "Se envía 30 minutos antes de la clase. Vars: {name}", channels: ["push"] },
```

Justo después (dentro del mismo array), agrega:

```jsx
  { key: "renewal_reminder",         label: "🩷 Recordatorio de renovación",    icon: "🔄", hint: "Se envía los días 28 y 1ro a las alumnas pendientes de renovar. Vars: {name}", channels: ["push"] },
```

- [ ] **Step 4: Verificar sintaxis/compilación**

Run: `node --check server/index.js && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/index.js src/pages/admin/settings/SettingsPage.tsx
git commit -m "feat(renovacion): plantilla renewal_reminder (push, editable en el panel)"
```

---

### Task 3: Cron `runMonthlyRenewalReminders()`

**Files:**
- Modify: `server/index.js` (import de la capa pura al inicio; función nueva antes de `scheduleEmailCrons`)

- [ ] **Step 1: Importar la capa pura**

En `server/index.js`, cerca de los otros imports de `./lib/*.js` (p. ej. junto al import de `./lib/push.js`), agrega:

```js
import { isRenewalReminderTime, renewalReminderDedupKey } from "./lib/renewalReminder.js";
```

- [ ] **Step 2: Agregar la función del cron**

En `server/index.js`, localiza `function scheduleEmailCrons() {` (aprox. línea 16834). **Justo antes** de esa línea, inserta la función nueva:

```js
// Recordatorio de renovación (push) — días 28 y 1ro, ~12pm México. Distinto del
// muerto runRenewalReminderCron (que es de "última clase"). Solo push; a las
// pendientes de renovar = su membresía más reciente (no cancelada) vence en <=3
// días o venció hace <=40 días, y no tienen otra más reciente (no renovaron).
async function runMonthlyRenewalReminders() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS renewal_reminders_sent (
        membership_id UUID NOT NULL,
        dedup_key     TEXT NOT NULL,
        sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (membership_id, dedup_key)
      )
    `).catch(() => {});

    const dedupKey = renewalReminderDedupKey(new Date());

    const res = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (m.user_id)
               m.user_id, m.id AS membership_id, m.end_date
        FROM memberships m
        WHERE m.status IN ('active','expired')
          AND m.end_date IS NOT NULL
        ORDER BY m.user_id, m.end_date DESC
      )
      SELECT l.user_id, l.membership_id, COALESCE(u.display_name, 'Alumna') AS name
      FROM latest l
      JOIN users u ON u.id = l.user_id
      WHERE u.receive_reminders IS NOT FALSE
        AND l.end_date <= CURRENT_DATE + INTERVAL '3 days'
        AND l.end_date >= CURRENT_DATE - INTERVAL '40 days'
    `);
    console.log(`[Cron] Renovación — ${res.rows.length} pendientes de renovar`);

    const candidates = res.rows;
    let alreadySent = new Set();
    if (candidates.length) {
      const sentRes = await pool.query(
        `SELECT membership_id FROM renewal_reminders_sent
          WHERE dedup_key = $1 AND membership_id = ANY($2::uuid[])`,
        [dedupKey, candidates.map((c) => c.membership_id)]
      ).catch(() => ({ rows: [] }));
      alreadySent = new Set(sentRes.rows.map((r) => r.membership_id));
    }
    const pending = candidates.filter((c) => !alreadySent.has(c.membership_id));
    console.log(`[Cron] Renovación — enviando ${pending.length} (ya enviados: ${candidates.length - pending.length})`);

    for (const row of pending) {
      await sendConfiguredPushTemplate({
        templateKey: "renewal_reminder",
        userId: row.user_id,
        vars: { name: row.name },
      }).catch((e) => console.error("[Push] renovación:", e.message));

      await pool.query(
        `INSERT INTO renewal_reminders_sent (membership_id, dedup_key)
         VALUES ($1, $2) ON CONFLICT (membership_id, dedup_key) DO NOTHING`,
        [row.membership_id, dedupKey]
      ).catch((e) => console.error("[Cron] renovación dedup insert:", e.message));

      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.error("[Cron] Renovación error:", err.message);
  }
}

```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(renovacion): cron runMonthlyRenewalReminders (query pendientes + dedup + push)"
```

---

### Task 4: Agendar el cron

**Files:**
- Modify: `server/index.js` (`scheduleEmailCrons` ~16834)

- [ ] **Step 1: Agregar el setInterval en scheduleEmailCrons**

Localiza el bloque existente dentro de `scheduleEmailCrons()` (el del resumen semanal):

```js
  // Resumen semanal por EMAIL: domingos 8:00 AM hora de México.
  // (Renovación y los recordatorios viejos 9pm/8am quedaron retirados.)
  setInterval(() => {
    const now = new Date();
    const mexicoHour = (now.getUTCHours() - 6 + 24) % 24;
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek === 0 && mexicoHour === 8 && now.getUTCMinutes() < 60) {
      console.log("[Cron] Triggering weekly reminder...");
      runWeeklyReminderCron();
    }
  }, 60 * 60 * 1000);
}
```

Reemplázalo por (agrega el nuevo setInterval antes del cierre `}` de la función):

```js
  // Resumen semanal por EMAIL: domingos 8:00 AM hora de México.
  // (Los recordatorios viejos 9pm/8am quedaron retirados.)
  setInterval(() => {
    const now = new Date();
    const mexicoHour = (now.getUTCHours() - 6 + 24) % 24;
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek === 0 && mexicoHour === 8 && now.getUTCMinutes() < 60) {
      console.log("[Cron] Triggering weekly reminder...");
      runWeeklyReminderCron();
    }
  }, 60 * 60 * 1000);

  // Recordatorio de renovación (push): días 28 y 1ro a las 12pm hora de México.
  // La dedup por fecha evita doble envío si el intervalo cae dos veces en la hora.
  setInterval(() => {
    if (isRenewalReminderTime(new Date())) {
      console.log("[Cron] Triggering renovación reminder...");
      runMonthlyRenewalReminders();
    }
  }, 60 * 60 * 1000);
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(renovacion): agendar el recordatorio de renovación (28 y 1ro, 12pm México)"
```

---

### Task 5: Verificación

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: todo verde, incluidos los 8 tests nuevos de `renewalReminder.test.js`.

- [ ] **Step 2: Typecheck + sintaxis final**

Run: `node --check server/index.js && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Revisión manual (post-deploy, sin esperar al 28/1)**

En el panel, Configuración → Notificaciones: confirmar que aparece "🩷 Recordatorio de renovación" y que el copy es editable.
(Opcional, para probar el envío real sin esperar a la fecha: correr manualmente `runMonthlyRenewalReminders()` una vez — p. ej. vía un endpoint admin temporal o un `node -e` con la conexión — y confirmar que llega el push a una alumna de prueba con membresía vencida. Coordinar con el usuario; no dejar endpoint temporal en el código.)
