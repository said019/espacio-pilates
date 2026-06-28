# Tu Espacio Pilates VM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reutilizar la plataforma Valiance Pilates como base y rediseñarla por completo para convertirla en el sistema de **Tu Espacio Pilates VM**, corriendo localmente con datos y reglas reales.

**Architecture:** Copia limpia del repo Valiance (sin historial) en `/Users/saidromero/Tu Espacio Pilates`. Frontend React+Vite+TS+shadcn, backend Express, Postgres local. El rebrand es de bajo riesgo porque el theming ya está centralizado (tokens Tailwind + CSS variables + fuentes). La lógica nueva (cancelación 12 h / reagenda 3 h, vigencia fin de mes) se extrae a un módulo puro y testeable `server/lib/bookingPolicy.js`.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind + shadcn/ui, Express, Postgres (pg), Vitest, Evolution API (WhatsApp), Resend (correo).

## Global Constraints

- Nombre de marca exacto: **Tu Espacio Pilates** (variantes: "Tu Espacio Pilates VM", "Villa Magna"). Nunca "Valiance" ni "Punto Neutro".
- Paleta exacta: primario `#C9ADA3`, acento lila `#C0AAD6`, neutro frío `#E3E7E9`, tinta `#1A1A1A`, dorado `#B8915A`.
- Cupo por clase: **8**.
- Paquetes (no acumulables, vencen fin del mes de compra): 7×$860, 9×$1,050, 14×$1,400. Inscripción $500. Clase extra $130. Clase suelta/visita $250.
- Horarios: L/X/V 07:00,08:00,09:00 y 17:30,18:30,19:30,20:30 · Ma/Ju 17:30,18:30,19:30 · Sáb 09:00.
- Cancelación: ventana 12 h (devuelve crédito). Reagenda: ventana 3 h. <3 h pierde lugar. Reagendar es operación nueva.
- Pagos: **solo transferencia** + validación admin. Moneda MXN.
- Todo el copy de cara al cliente en **español**.
- No agregar dependencias pesadas nuevas sin justificación.
- Contacto: Av. Villa Magna Nte. 600 A, 78183 SLP · WhatsApp 444 548 0352 · IG @_espaciopilatesvm · Maps https://g.co/kgs/AyHBK5d.

---

### Task 1: Setup del proyecto (correr local)

**Files:**
- Crear: copia del árbol de trabajo de Valiance en `/Users/saidromero/Tu Espacio Pilates/` (excluyendo `.git`, `node_modules`).
- Crear: `/Users/saidromero/Tu Espacio Pilates/.env`
- Origen: `/private/tmp/claude-501/-Users-saidromero-Tu-Espacio-Pilates-/ee9e7c48-30ea-4eaa-8d6a-806110696325/scratchpad/valiance-github`

**Interfaces:**
- Produces: proyecto instalado y corriendo local (frontend Vite + backend Express + Postgres con schema cargado).

- [ ] **Step 1: Copiar el árbol del repo (sin .git ni node_modules) preservando docs/ y .git nuevos**

```bash
SRC="/private/tmp/claude-501/-Users-saidromero-Tu-Espacio-Pilates-/ee9e7c48-30ea-4eaa-8d6a-806110696325/scratchpad/valiance-github"
DST="/Users/saidromero/Tu Espacio Pilates"
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'docs/superpowers' "$SRC"/ "$DST"/
```

- [ ] **Step 2: Instalar dependencias**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && npm i`
Expected: instala sin errores fatales (warnings de peerdeps OK).

- [ ] **Step 3: Crear Postgres local y cargar schema + seed actual (temporal)**

```bash
createdb tep_vm 2>/dev/null || true
psql tep_vm -f "/Users/saidromero/Tu Espacio Pilates/supabase/migrations/schema_complete.sql"
```
Expected: tablas creadas sin error. (Si `createdb` no existe, instalar Postgres con `brew install postgresql@16 && brew services start postgresql@16`.)

- [ ] **Step 4: Crear `.env` mínimo para local**

Copiar `.env.example` a `.env` y fijar al menos:
```
DATABASE_URL=postgresql://localhost:5432/tep_vm
JWT_SECRET=dev-secret-cambiar
PORT=8080
SITE_URL=http://localhost:5173
APP_URL=http://localhost:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:8080/api
```
(Integraciones Evolution/Resend/Wallet quedan vacías en local; el código debe degradar sin romper.)

- [ ] **Step 5: Correr backend y frontend, verificar que cargan**

Run: `cd "/Users/saidromero/Tu Espacio Pilates" && node server/index.js` (en background) y en otra terminal `npm run dev`.
Expected: backend escucha en :8080, Vite en :5173, el landing abre sin errores de consola fatales.

- [ ] **Step 6: Verificar lint y tests base**

Run: `npm run lint && npm test`
Expected: pasan (o documentar fallos preexistentes para no romperlos más).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: importar plataforma base y correr local"
```

---

### Task 2: Tokens de marca (paleta + CSS variables + fuentes)

**Files:**
- Modify: `tailwind.config.ts` (bloque `colors` de marca, sombras, `fontFamily`)
- Modify: `src/index.css` (o el CSS global con `:root { --primary ... }`)

**Interfaces:**
- Produces: clases utilitarias y variables CSS con la paleta VM; el resto del código las consume por nombre.

- [ ] **Step 1: Reemplazar la paleta nombrada en `tailwind.config.ts`**

Sustituir el objeto `valiance` por uno `tep` con los hex exactos y mantener un alias `valiance` apuntando a `tep` para no romper referencias existentes durante la migración:

```ts
tep: {
  blush:    "#C9ADA3",
  nude:     "#FBF6F4",
  rose:     "#E8D3CE",
  lavender: "#C0AAD6",
  lilacSoft:"#E7DEF1",
  gray:     "#E3E7E9",
  ink:      "#1A1A1A",
  gold:     "#B8915A",
},
valiance: { /* alias temporal → mismos valores que tep */ },
```

- [ ] **Step 2: Actualizar las CSS variables HSL en el CSS global**

Mapear `--primary` al blush, `--accent`/`--secondary` a lila, `--background` a nude, `--foreground` a tinta. Usar valores HSL equivalentes a los hex de arriba.

- [ ] **Step 3: Verificar fuentes**

Confirmar que `display` = serif elegante (Cormorant Garamond/Playfair) y `body` = Inter, y que el `<link>` de Google Fonts en `index.html` las carga. Ajustar si falta el peso de display.

- [ ] **Step 4: Verificar visualmente**

Run: `npm run dev` → el landing y el panel admin muestran la nueva paleta (blush/lila/dorado).
Expected: sin colores Valiance residuales en componentes principales.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts src/index.css && git commit -m "feat: paleta y tokens de marca Tu Espacio Pilates VM"
```

---

### Task 3: Logo, favicons, meta y manifest

**Files:**
- Reemplazar: `public/valiance-logo.png`, `src/assets/valiance-pilates-logo.png`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Modify: `index.html` (title, meta description, OG/Twitter, apple-mobile-web-app-title)
- Modify: `public/site.webmanifest` (`name`, `short_name`, iconos)

**Interfaces:**
- Produces: identidad en pestaña/instalación PWA = Tu Espacio Pilates VM.

- [ ] **Step 1: Colocar el logo VM**

Extraer el logo del PDF (o usar el SVG/PNG limpio cuando el cliente lo envíe) y guardarlo como `public/tep-logo.png`. Actualizar referencias o sobrescribir los archivos `valiance-logo.png` para no romper rutas.

- [ ] **Step 2: Reemplazar `index.html`**

`<title>Tu Espacio Pilates VM</title>`, `apple-mobile-web-app-title` = "Tu Espacio Pilates", description = "Studio de Pilates en Villa Magna, San Luis Potosí. Reformer, tower, mat y silla. Cupo de 8.", y OG/Twitter acordes.

- [ ] **Step 3: Reemplazar `public/site.webmanifest`**

`"name": "Tu Espacio Pilates VM"`, `"short_name": "Tu Espacio"`, apuntar iconos a los nuevos.

- [ ] **Step 4: Verificar**

Run: `npm run dev` → pestaña del navegador muestra "Tu Espacio Pilates VM" y el favicon nuevo.

- [ ] **Step 5: Commit**

```bash
git add index.html public/ src/assets/ && git commit -m "feat: logo, favicons, meta y manifest VM"
```

---

### Task 4: Rebrand del landing (`src/pages/Index.tsx`)

**Files:**
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: tokens de Task 2.
- Produces: landing público con contenido real de VM.

- [ ] **Step 1: Reemplazar hero, nombre y subcopy**

Nombre "Tu Espacio Pilates · Villa Magna", tagline alineado a "explora el método pilates, con resultados" y vibra exclusiva/comunidad.

- [ ] **Step 2: Reemplazar paquetes/precios (fallback hardcoded)**

7 clases $860 · 9 clases $1,050 · 14 clases $1,400 · Inscripción $500 · Clase extra $130 · Clase suelta/visita $250.

- [ ] **Step 3: Reemplazar horarios y temas por día**

Bloque de horarios (L/X/V, Ma/Ju, Sáb) + temas: Lun pierna&glúteo, Mar full body, Mié tren superior, Jue pierna&glúteo, Vie full body, Sáb core.

- [ ] **Step 4: Reemplazar contacto, mapa, redes y reglamento**

Dirección Av. Villa Magna Nte. 600 A, 78183 SLP; WhatsApp 444 548 0352 (con link `https://wa.me/524445480352`); IG @_espaciopilatesvm; Maps embed `https://g.co/kgs/AyHBK5d`. Sección de reglamento (calcetín, silencio, limpiar equipo, etc.). Sección informativa de eventos cumpleaños/brunch (sin reservar).

- [ ] **Step 5: Quitar nombres de coaches/clases de Valiance**

Eliminar Maca/Jean/Idaid/Tania/Vane/Andy y la grilla Reformer/Barre/HIIT; dejar "Pilates" como disciplina única (con menciones a reformer, tower, mat, silla como aparatos).

- [ ] **Step 6: Verificar y commit**

Run: `npm run dev` → landing 100% VM, sin texto Valiance. Buscar `grep -ri valiance src/pages/Index.tsx` = vacío.
```bash
git add src/pages/Index.tsx && git commit -m "feat: rebrand de landing a Tu Espacio Pilates VM"
```

---

### Task 5: Branding de correos (`server/emailService.js`)

**Files:**
- Modify: `server/emailService.js`

- [ ] **Step 1: Cambiar `FROM_EMAIL` y nombre**

`Tu Espacio Pilates <noreply@...>` (o `onboarding@resend.dev` en dev).

- [ ] **Step 2: Cambiar paleta y logo en plantillas HTML**

Fondo nude `#FBF6F4`, acento blush `#C9ADA3`, CTA tinta `#1A1A1A`, logo `${SITE_URL}/tep-logo.png`, footer con datos VM.

- [ ] **Step 3: Verificar**

Run: `grep -ri "valiance" server/emailService.js` = vacío.

- [ ] **Step 4: Commit**

```bash
git add server/emailService.js && git commit -m "feat: plantillas de correo con marca VM"
```

---

### Task 6: Seed de datos reales VM

**Files:**
- Crear: `seed-tep-vm.sql` (basado en la estructura de `seed-valiance-full.sql`)

**Interfaces:**
- Consumes: schema de Task 1.
- Produces: clase única, horarios con temas, paquetes, settings y banco placeholder.

- [ ] **Step 1: Class type único**

`Pilates` — duración 60 min, `max_capacity = 8`, color blush, activo. (Sin Barre/HIIT/Mat como tipos separados.)

- [ ] **Step 2: Schedules con tema por día**

Insertar los horarios exactos (Global Constraints) con un campo de tema/`focus` por día (Lun pierna&glúteo … Sáb core). Si la tabla `schedules` no tiene columna de tema, agregar `focus TEXT` vía migración y mostrarlo en el calendario.

- [ ] **Step 3: Plans/paquetes**

A 7×$860 (class_limit 7), B 9×$1,050 (9), C 14×$1,400 (14), Inscripción $500 (class_limit 0, no repetible salvo regla >3 meses), Clase extra $130 (1), Clase suelta/visita $250 (1). `duration_days` se ignora a favor de fin-de-mes (Task 7); dejar 30 por compat.

- [ ] **Step 4: system_settings**

`studio_info` (nombre, dirección, teléfono, maps, IG), `bank_info` (placeholder vacío para llenar en Ajustes), `booking_policies` (tolerancia 5 min), `cancellation_settings` `{enabled:true, min_hours:12, refund_credit_on_cancel:true, reschedule_hours:3}`. `loyalty_settings.enabled=false`.

- [ ] **Step 5: Cargar y verificar**

Run: `psql tep_vm -f "/Users/saidromero/Tu Espacio Pilates/seed-tep-vm.sql"` y luego `psql tep_vm -c "select name,price,class_limit from plans order by price;"`
Expected: 6 planes con los precios correctos.

- [ ] **Step 6: Commit**

```bash
git add seed-tep-vm.sql supabase/ && git commit -m "feat: seed de clases, horarios, paquetes y settings VM"
```

---

### Task 7: Vigencia fin de mes (módulo puro + wiring) — TDD

**Files:**
- Crear: `server/lib/bookingPolicy.js`
- Crear: `server/lib/__tests__/bookingPolicy.test.js`
- Modify: `server/index.js` (función `calcMembershipEndDate`, ~línea 8232)
- Modify: `vitest.config.ts` (asegurar que incluye `server/**/*.test.js` con entorno node si hace falta)

**Interfaces:**
- Produces: `endOfPurchaseMonth(startISO: string): string` (YYYY-MM-DD del último día del mes de compra).

- [ ] **Step 1: Escribir el test que falla**

```js
import { describe, it, expect } from 'vitest';
import { endOfPurchaseMonth } from '../bookingPolicy.js';

describe('endOfPurchaseMonth', () => {
  it('devuelve el último día del mes de compra', () => {
    expect(endOfPurchaseMonth('2026-06-15')).toBe('2026-06-30');
  });
  it('maneja febrero', () => {
    expect(endOfPurchaseMonth('2026-02-10')).toBe('2026-02-28');
  });
  it('maneja compra el último día', () => {
    expect(endOfPurchaseMonth('2026-01-31')).toBe('2026-01-31');
  });
});
```

- [ ] **Step 2: Correr y verque falle**

Run: `npx vitest run server/lib/__tests__/bookingPolicy.test.js`
Expected: FAIL ("endOfPurchaseMonth is not a function").

- [ ] **Step 3: Implementar**

```js
// server/lib/bookingPolicy.js
export function endOfPurchaseMonth(startISO) {
  const [y, m] = startISO.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // día 0 del mes siguiente
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run server/lib/__tests__/bookingPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Wire en `calcMembershipEndDate`**

En `server/index.js`, hacer que para paquetes mensuales `end_date = endOfPurchaseMonth(start_date)` en lugar de `addMonths`. Importar la función del módulo.

- [ ] **Step 6: Commit**

```bash
git add server/lib/ server/index.js vitest.config.ts && git commit -m "feat: vigencia de membresía hasta fin del mes de compra (TDD)"
```

---

### Task 8: Reglas de cancelación/reagenda (módulo puro) — TDD

**Files:**
- Modify: `server/lib/bookingPolicy.js`
- Modify: `server/lib/__tests__/bookingPolicy.test.js`

**Interfaces:**
- Produces:
  - `canCancel({ nowMs, classStartMs, cancelHours=12 }): { allowed: boolean, refundCredit: boolean }`
  - `canReschedule({ nowMs, classStartMs, rescheduleHours=3 }): { allowed: boolean }`

- [ ] **Step 1: Escribir tests que fallan**

```js
import { canCancel, canReschedule } from '../bookingPolicy.js';

const H = 3600_000;
const start = 100 * H; // referencia

describe('canCancel', () => {
  it('≥12h: cancela y devuelve crédito', () => {
    expect(canCancel({ nowMs: start - 13*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: true });
  });
  it('entre 3 y 12h: si cancela, pierde crédito (no permitido sin penalización)', () => {
    expect(canCancel({ nowMs: start - 5*H, classStartMs: start })).toEqual({ allowed: false, refundCredit: false });
  });
  it('<3h: no cancela', () => {
    expect(canCancel({ nowMs: start - 1*H, classStartMs: start })).toEqual({ allowed: false, refundCredit: false });
  });
});

describe('canReschedule', () => {
  it('≥12h: reagenda', () => {
    expect(canReschedule({ nowMs: start - 13*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('entre 3 y 12h: sí reagenda', () => {
    expect(canReschedule({ nowMs: start - 5*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('<3h: no reagenda', () => {
    expect(canReschedule({ nowMs: start - 2*H, classStartMs: start })).toEqual({ allowed: false });
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run server/lib/__tests__/bookingPolicy.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
export function canCancel({ nowMs, classStartMs, cancelHours = 12 }) {
  const hoursLeft = (classStartMs - nowMs) / 3600_000;
  const allowed = hoursLeft >= cancelHours;
  return { allowed, refundCredit: allowed };
}

export function canReschedule({ nowMs, classStartMs, rescheduleHours = 3 }) {
  const hoursLeft = (classStartMs - nowMs) / 3600_000;
  return { allowed: hoursLeft >= rescheduleHours };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run server/lib/__tests__/bookingPolicy.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add server/lib/ && git commit -m "feat: políticas puras de cancelación 12h y reagenda 3h (TDD)"
```

---

### Task 9: Wire de cancelación + endpoint de reagenda (NUEVO)

**Files:**
- Modify: `server/index.js` (DELETE `/api/bookings/:id` ~3385-3591; agregar `PUT /api/bookings/:id/reschedule`)
- Modify: `src/pages/client/MyBookings.tsx` (botón Reagendar)
- Modify: `src/pages/client/BookClasses.tsx` o un modal para elegir nueva clase

**Interfaces:**
- Consumes: `canCancel`, `canReschedule` de Task 8.
- Produces: endpoint `PUT /api/bookings/:id/reschedule { newClassId }` que mueve la reserva si `canReschedule` y hay cupo, sin devolver/cobrar crédito.

- [ ] **Step 1: Sustituir la lógica de la ventana de cancelación**

Reemplazar el cálculo actual (`min_hours` 8) por `canCancel(...)` usando `cancellation_settings.min_hours` (12). Si no permitido, responder `CANCELLATION_WINDOW_EXCEEDED` con mensaje claro; el crédito no se devuelve.

- [ ] **Step 2: Agregar endpoint de reagenda**

Implementar `PUT /api/bookings/:id/reschedule`: validar dueño, cargar `class_start`, aplicar `canReschedule`; si permitido y la nueva clase tiene cupo, en transacción: liberar lugar viejo, ocupar el nuevo, mantener `membership_id` y crédito sin cambios; notificar (correo/WhatsApp) "reserva reagendada".

- [ ] **Step 3: Botón Reagendar en el cliente**

En `MyBookings.tsx`, mostrar "Reagendar" cuando `canReschedule` (calculado en el cliente con la hora de la clase) y abrir selector de clases disponibles → llamar al endpoint.

- [ ] **Step 4: Probar manualmente el flujo**

Run: reservar una clase futura, reagendarla a otro horario; verificar que el crédito no cambia y el cupo se mueve.

- [ ] **Step 5: Commit**

```bash
git add server/index.js src/pages/client/ && git commit -m "feat: reagenda de reservas (3h) y ventana de cancelación 12h"
```

---

### Task 10: Activar recordatorios automáticos

**Files:**
- Modify: `server/index.js` (cron/scheduler de recordatorios; activar el código existente)
- Modify: `src/pages/admin/settings/*` (toggles de notificaciones si aplica)

**Interfaces:**
- Consumes: Evolution API + Resend (degradan a no-op si faltan credenciales).

- [ ] **Step 1: Activar el job de recordatorio de clase**

Habilitar el envío "noche anterior" y "~3 h antes" por WhatsApp + correo (el código existe pero está deshabilitado). Hacer el horario configurable desde `notification_settings`.

- [ ] **Step 2: Verificar renovación y última clase**

Confirmar que los avisos de "renovación próxima" (antes del día 4) y "última clase" del paquete están activos.

- [ ] **Step 3: Probar en local con credenciales de prueba o modo dry-run**

Run: usar `/api/evolution/send-test` o logs en dry-run para confirmar que se construyen los mensajes sin credenciales reales.

- [ ] **Step 4: Commit**

```bash
git add server/index.js src/pages/admin/ && git commit -m "feat: recordatorios automáticos WhatsApp y correo"
```

---

### Task 11: Limpieza de módulos fuera de alcance

**Files:**
- Modify: `src/App.tsx` (rutas), `src/components/layout/*` (nav), `src/pages/Index.tsx`
- Modify/Remove: páginas y rutas de lealtad, videos, wallet, QR; combos Barre

**Interfaces:**
- Produces: app enfocada en v1 Esencial.

- [ ] **Step 1: Ocultar rutas y navegación fuera de alcance**

Quitar de `App.tsx` y de los menús: lealtad/puntos, videos, wallet, QR, y referencias a Barre/Combo. Preferir ocultar (feature flag) sobre borrar masivamente para reducir riesgo; borrar assets/strings de marca residuales.

- [ ] **Step 2: Desactivar lealtad en settings y backend**

`loyalty_settings.enabled = false`; que el portal cliente no muestre puntos.

- [ ] **Step 3: Verificar que no quedan enlaces rotos**

Run: `npm run dev` → navegar cliente y admin; sin rutas muertas ni 404 internos. `grep -ri valiance src/ server/ index.html` = vacío.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: limpiar módulos fuera de alcance (lealtad/videos/wallet/qr/barre)"
```

---

### Task 12: Verificación end-to-end

**Files:**
- Crear: `docs/superpowers/QA-checklist.md` (resultados)

- [ ] **Step 1: Flujos cliente**

Registrar usuario, comprar paquete (transferencia + subir comprobante), admin valida, reservar clase, ver crédito decrementar, cancelar ≥12 h (crédito vuelve), reagendar entre 3–12 h (crédito no vuelve, clase se mueve), intentar <3 h (bloqueado).

- [ ] **Step 2: Flujos admin**

Verificar dashboard, clientes, membresías, clases/horarios con temas, lista de espera (promoción), reportes, ajustes (banco, notificaciones, política 12h/3h).

- [ ] **Step 3: Branding**

Confirmar 0 ocurrencias de "valiance"/"punto" en `src/`, `server/`, `index.html`, `public/`, correos.

- [ ] **Step 4: Suite**

Run: `npm run lint && npm test`
Expected: pasan.

- [ ] **Step 5: Commit**

```bash
git add docs/ && git commit -m "test: checklist de verificación end-to-end VM"
```

---

## Self-Review

**Spec coverage:** Identidad visual (T2–T5), modelo clase única + temas + horarios (T4,T6), paquetes/precios/vigencia fin-de-mes (T6,T7), cancelación 12h/reagenda 3h (T8,T9), pagos transferencia (heredado + seed banco T6), recordatorios (T10), quitar lealtad/videos/wallet/qr/barre (T11), pantallas conservadas (heredadas), setup local (T1), verificación (T12). Cubierto.

**Placeholder scan:** Sin TBD/TODO. Datos bancarios y logo limpio son dependencias externas del cliente (se cargan en Ajustes/assets), no placeholders de código.

**Type consistency:** `endOfPurchaseMonth`, `canCancel({allowed,refundCredit})`, `canReschedule({allowed})` usados consistentemente entre Task 7–9.
