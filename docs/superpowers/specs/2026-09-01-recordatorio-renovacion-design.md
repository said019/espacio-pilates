# Recordatorio de renovación de membresía (push) — Diseño

## Resumen

La dueña (Edith) pidió un recordatorio automático para que las alumnas renueven su membresía, con su propio copy, los días **28 y 1ro** de cada mes, dirigido **solo a las pendientes de renovar**, y **solo por push** (decisión confirmada: sin WhatsApp ni email → cero riesgo de baneo).

Hoy no existe: la función `runRenewalReminderCron` fue vaciada (solo cubre "última clase" y además **no está agendada** — código muerto). El aviso por fecha de vencimiento se retiró en jun 2026. Esto se construye desde cero, reutilizando infraestructura existente (plantillas editables, tabla de dedup, envío push).

## Decisiones confirmadas con la dueña

- **Canal:** solo push en la app (`sendConfiguredPushTemplate`). Respeta `push_reminders`/suscripción de cada alumna.
- **Cuándo:** días 28 y 1ro de cada mes, ~12 pm hora de México (UTC-6, mismo criterio que el cron semanal existente).
- **A quién ("pendiente de renovar"):** alumna cuya membresía ya venció o vence en los próximos días, y que NO tiene otra membresía vigente más adelante (no ha comprado su mes nuevo). Con piso de recencia para no molestar a quien se fue hace meses. NO le llega a quien ya renovó.
- **Copy (editable después en Configuración → Notificaciones):**
  - Título: `🩷 ¡No dejes que tu progreso se detenga!`
  - Cuerpo: `Cada clase te acerca a tu objetivo. Renueva tu membresía y sigue construyendo la mejor versión de ti. 📲 ¡Te esperamos en clase!`
  - Al tocar la notificación abre `/app/checkout`.

## Definición precisa de "pendiente de renovar"

Un usuario es destinatario si su **membresía más reciente** (por `end_date`, excluyendo canceladas) cumple:
- `end_date <= CURRENT_DATE + 3 días` (ya venció o vence en los próximos días), **y**
- `end_date >= CURRENT_DATE - 40 días` (piso de recencia: fue alumna hace poco).

Como se toma la membresía **más reciente**, la condición "no tiene otra membresía vigente más adelante" queda implícita: si hubiera renovado (una membresía con `end_date` más lejano), esa sería la más reciente y quedaría fuera del rango (`> CURRENT_DATE + 3`).

Comportamiento por fecha (una sola query sirve para ambas):
- **28:** captura membresías que vencen a fin de este mes (`end_date` entre hoy y ~fin de mes) sin renovación posterior → "por vencer".
- **1ro:** captura membresías que vencieron a fin del mes pasado sin renovación → "vencida". A quien renovó para el mes nuevo (end_date = fin del mes nuevo) NO le llega (su end_date > hoy+3).

## Arquitectura

### Capa pura nueva — `server/lib/renewalReminder.js` (testeable)
- `mexicoDateParts(date)` → `{ year, month, day, hour }` en hora de México (UTC-6).
- `isRenewalReminderTime(date)` → `true` si es día 28 o 1 y la hora (México) es 12.
- `renewalReminderDedupKey(date)` → `renew_YYYY_MM_DD` (DD = `28` o `01`), para dedup por fecha.

Estas 3 son puras (sin I/O) → tests unitarios. La orquestación (query + envío) vive en `server/index.js`, igual que el resto de crons.

### Plantilla `renewal_reminder`
- Agregar a `DEFAULT_NOTIFICATION_TEMPLATES` (server/index.js ~203) con el copy de arriba.
- Agregar a `PUSH_TEMPLATE_URLS` (~10777): `renewal_reminder: "/app/checkout"`.
- Agregar al array `NOTIFICATION_TEMPLATES` del panel (`SettingsPage.tsx` ~229, `channels: ["push"]`) para que Edith lo edite en Configuración → Notificaciones.
- NO se agrega a `WHATSAPP_ALLOWED_TEMPLATES` (es push-only, a propósito).

### Cron nuevo — `runMonthlyRenewalReminders()` en `server/index.js`
Nombre distinto del muerto `runRenewalReminderCron` (que es de "última clase") para evitar la trampa de nombres gemelos. Lógica:
1. Asegura la tabla `renewal_reminders_sent` (ya existe; reutilizar).
2. Calcula `dedupKey = renewalReminderDedupKey(now)`.
3. Query de pendientes (CTE con la membresía más reciente por usuario, filtro de rango de fechas + `receive_reminders IS NOT FALSE`).
4. Filtra los que ya tienen `(membership_id, dedupKey)` en `renewal_reminders_sent`.
5. Por cada pendiente: `sendConfiguredPushTemplate({ templateKey: "renewal_reminder", userId, vars: { name } })`, luego inserta el dedup. Delay 200ms entre envíos.
Best-effort, nunca lanza (patrón de los otros crons).

### Agendado — `scheduleEmailCrons()` (server/index.js ~16834)
Nuevo `setInterval` horario que llama `runMonthlyRenewalReminders()` solo cuando `isRenewalReminderTime(new Date())` es true. La dedup evita doble envío si el intervalo cae dos veces en la misma hora.

## Fuera de alcance
- Sin WhatsApp ni email.
- No se reactiva ni se toca el cron muerto de "última clase" (`runRenewalReminderCron`).
- No se personaliza más allá de `{name}` (el copy de Edith no lo requiere; la var queda disponible por si luego lo edita).
- No se agrega configuración de días/hora en el panel (28/1 y 12pm quedan fijos en código; ajustable después si lo piden).

## Testing
- Unit (vitest) para la capa pura: `isRenewalReminderTime` (28/1 a las 12 = true; otros días/horas = false; frontera de medianoche/zona horaria) y `renewalReminderDedupKey` (formato correcto, DD con cero a la izquierda).
- El cron (query + envío) sigue el patrón sin test dedicado del resto de crons; se valida manualmente.
