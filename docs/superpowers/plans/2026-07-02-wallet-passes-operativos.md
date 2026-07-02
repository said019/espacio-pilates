# Plan B — Wallet passes operativos (Apple + Google) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar operativos los pases de Apple Wallet (.pkpass firmado) y Google Wallet (save-url) —hoy 100% construidos en backend pero 0% usables— cargando las credenciales en Railway (runbook para la dueña), exponiendo su disponibilidad al cliente, agregando botones "Guardar en Wallet" en la app de la alumna, y arreglando los enlaces internos del pase. Las notificaciones/actualizaciones del pase ya están cableadas a ~35 eventos y se encienden solas al configurar credenciales.

**Architecture:** El backend ya tiene `generateApplePkpass` (PKCS#7), `buildGoogleWalletSaveUrl` (JWT RS256), sync server-side de Google y push APNs de Apple, todo cortocircuitado por `isAppleWalletConfigured()`/`isGoogleWalletConfigured()` que devuelven `false` por falta de env vars. Este plan (a) carga esas env vars, (b) agrega un endpoint de disponibilidad para el cliente, (c) agrega la UI de guardado, (d) corrige los `linksModuleData` que apuntan a rutas inexistentes. Cambios de código pequeños y aislados; el grueso es el runbook manual de credenciales.

**Tech Stack:** Node/Express + PostgreSQL (`server/index.js`), React + TanStack Query + Axios (`src/`), OpenSSL (certs Apple), Google Wallet API.

**Spec:** `docs/superpowers/specs/2026-07-02-notificaciones-push-y-wallet-design.md` (§4).

**Contexto crítico de ejecución:**
- Ubicar SIEMPRE por contenido (grep de los anclas citados), no por número de línea — `server/index.js` (~15.6k líneas) se corre con cada edición.
- **Orden obligatorio:** Task 1 (código: availability + botones + links) se puede hacer en LOCAL de una vez; el runbook (Task 0) lo ejecuta la dueña y es prerequisito SOLO para la verificación e2e real (Task 5). En local sin credenciales, `availability` devuelve `{apple:false, google:false}` y los botones se ocultan — eso es correcto y así se verifica el código.
- **NO tocar** `JWT_SECRET` (grep `puntoneutro_secret_2026`, ~42) — cambiarlo cierra TODAS las sesiones.
- **`APPLE_AUTH_TOKEN` (bomba de tiempo):** hoy es `crypto.randomBytes(32)` por arranque (grep `const APPLE_AUTH_TOKEN`). DEBE fijarse como env var FIJA en Railway **antes** de emitir el primer pase Apple, o cada redeploy invalida los pases ya instalados (401). Cubierto en Task 0.
- Entorno local: backend `node server/index.js` (8090), front `npx vite --port 5173`, admin `espaciopilatesvm@gmail.com` / `EspacioVM2026!`.
- No hacer push a git al final; preguntar a Said.

---

### Task 0: Runbook de credenciales (MANUAL — lo ejecuta la dueña en Railway; prerequisito de la verificación e2e)

> Esta tarea NO es de código. Es la guía que la persona con las cuentas (la dueña ya tiene Apple Developer + Google Wallet) sigue una sola vez. El modelo ejecutor **no puede** hacer esto (requiere cuentas y descarga de certificados); su trabajo aquí es dejar la guía escrita/validada y correr los checks de verificación cuando la dueña avise que ya cargó las vars. Referencias existentes en el repo: `wallet-assets/README.md`, `wallet-assets/APPLE_WALLET_DOCUMENTATION.md`.

- [ ] **Step 1: Apple Wallet — generar credenciales**
  1. En Apple Developer → Identifiers → crear/identificar el **Pass Type ID** (`pass.com.tuespaciopilates.loyalty` o el que exista). Anotar el **Team ID** (10 chars).
  2. Generar el **certificado del Pass Type ID**: crear un CSR desde Keychain, subirlo, descargar el `.cer`, importarlo a Keychain, exportar a `.p12`.
  3. Convertir a PEM con OpenSSL:
     ```bash
     openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signerCert.pem -passin pass:LAPASS
     openssl pkcs12 -in pass.p12 -nocerts -nodes -out signerKey.pem -passin pass:LAPASS
     ```
  4. Descargar **Apple WWDR G4** (`AppleWWDRCAG4.cer`) y convertir: `openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem`.
  5. Crear la **llave APNs .p8** (Keys → nueva key con Apple Push Notifications habilitado). Anotar el **Key ID**.

- [ ] **Step 2: Apple Wallet — cargar env vars en Railway** (usar variantes `_BASE64` para los PEM multilinea: `base64 -i signerCert.pem | pbcopy`):
  - `APPLE_TEAM_ID` = el Team ID
  - `APPLE_PASS_TYPE_ID` = `pass.com.tuespaciopilates.loyalty`
  - `APPLE_SIGNER_CERT_BASE64` = base64 de `signerCert.pem`
  - `APPLE_SIGNER_KEY_BASE64` = base64 de `signerKey.pem`
  - `APPLE_WWDR_CERT_BASE64` = base64 de `wwdr.pem`
  - `APPLE_CERT_PASSWORD` = LAPASS (si la key quedó con password; si usaste `-nodes`, omitir)
  - `APPLE_KEY_ID` = el Key ID de la .p8
  - `APPLE_APNS_KEY_BASE64` = base64 del archivo `.p8`
  - **`APPLE_AUTH_TOKEN` = `openssl rand -hex 32` (generar UNA vez y NUNCA cambiar)** ← crítico
  - (El código acepta tanto `APPLE_*_PEM` como `APPLE_*_BASE64`; usar `_BASE64` es lo cómodo en Railway.)

- [ ] **Step 3: Google Wallet — cargar env vars en Railway**
  - En Google Pay & Wallet Console → anotar el **Issuer ID**.
  - En Google Cloud → crear service account con rol de emisor de Wallet Objects; descargar el JSON de la key.
  - Vars: `GOOGLE_ISSUER_ID` (= `GW_ISSUER_ID`), `GOOGLE_SA_EMAIL` (= `GW_SA_EMAIL`, el `client_email` del JSON), `GOOGLE_SA_PRIVATE_KEY` (= `GW_SA_PRIVATE_KEY`, el `private_key` del JSON con los `\n` literales tal cual). *(Confirmar los nombres exactos que lee el código: grep `GW_ISSUER_ID =`, `GW_SA_EMAIL =`, `GW_SA_PRIVATE_KEY =` en `server/index.js` y usar EXACTAMENTE las env vars que ahí se leen con `process.env.*`.)*

- [ ] **Step 4: Verificación (esto SÍ lo corre el modelo ejecutor, contra producción, cuando la dueña avise)**
  - `GET /api/wallet/apple/status` (admin) → `nativePkpass: true`, `apnsConfigured: true`, y todos los PEM en `✅ loaded`.
  - `GET /api/wallet/google/diagnostics` (admin) → `configured: true` y firma OK.
  - Si alguno sigue en `❌`, revisar el base64 (saltos de línea perdidos) antes de seguir. **No avanzar a Task 5 hasta que ambos reporten OK.**

---

### Task 1: Endpoint de disponibilidad de wallet para el cliente

**Files:**
- Modify: `server/index.js` — agregar `GET /api/wallet/availability` junto al endpoint `GET /api/wallet/google/save-url` (grep `app.get("/api/wallet/google/save-url"`).

**Por qué:** `GET /api/wallet/apple/status` existe pero es `adminMiddleware` — la alumna no puede consultarlo. Se necesita un endpoint liviano `authMiddleware` que diga si cada wallet está operativo, para mostrar/ocultar los botones. Sólo reporta modo NATIVO (Apple `isAppleWalletConfigured()`); el fallback web (HTML con QR) no se ofrece como "pase" en la UI.

- [ ] **Step 1: Agregar el endpoint**

Inmediatamente ANTES de `app.get("/api/wallet/google/save-url", ...)` (o después de su cierre `});`), agregar:

```js
// GET /api/wallet/availability — ¿qué wallets están operativos? (cliente autenticado)
app.get("/api/wallet/availability", authMiddleware, async (_req, res) => {
  return res.json({
    apple: isAppleWalletConfigured(),   // true solo con certs nativos (.pkpass firmado)
    google: isGoogleWalletConfigured(), // true solo con issuer + service account
  });
});
```

- [ ] **Step 2: Verificar sintaxis + respuesta local**

Run: `node --check server/index.js`. Levantar server local, login de alumna (o admin), `GET /api/wallet/availability` → 200 con `{"apple":false,"google":false}` (local sin credenciales — correcto). Documentar el status en el reporte.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(wallet): endpoint de disponibilidad de wallet para el cliente

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 2: Botones "Guardar en Wallet" en el perfil de la alumna

**Files:**
- Create: `src/components/WalletButtons.tsx`
- Modify: `src/pages/client/Profile.tsx` (grep la sección `{/* ── Mi cuenta ── */}`).

**Nota de wiring (importante):** `GET /api/wallet/apple/pkpass` y `GET /api/wallet/google/save-url` son `authMiddleware` (Bearer). Un `<a href>` normal NO manda el token → daría 401. Por eso Apple se descarga con `api.get(..., { responseType: "blob" })` y se dispara la descarga con un object URL (en iOS Safari eso abre la hoja "Agregar a Apple Wallet"; el endpoint ya manda `Content-Type: application/vnd.apple.pkpass` + `Content-Disposition: attachment`). Google devuelve `{ data: { saveUrl } }` y se navega a esa URL.

- [ ] **Step 1: Crear el componente `WalletButtons`**

```tsx
// src/components/WalletButtons.tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Detección simple de plataforma para priorizar el botón correcto.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isIOS = /iPad|iPhone|iPod/.test(ua);
const isAndroid = /Android/.test(ua);

export const WalletButtons = () => {
  const { toast } = useToast();
  const { data: availability } = useQuery({
    queryKey: ["wallet-availability"],
    queryFn: async () => (await api.get("/wallet/availability")).data as { apple: boolean; google: boolean },
  });

  const appleMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/wallet/apple/pkpass", { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tu-espacio-pilates-pass.pkpass";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    onError: () => toast({ title: "No se pudo generar el pase de Apple Wallet", variant: "destructive" }),
  });

  const googleMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/wallet/google/save-url");
      const saveUrl = (res.data as any)?.data?.saveUrl;
      if (!saveUrl) throw new Error("sin saveUrl");
      window.location.href = saveUrl;
    },
    onError: () => toast({ title: "No se pudo generar el pase de Google Wallet", variant: "destructive" }),
  });

  // Si el backend no tiene ninguna wallet operativa, no renderizar nada.
  if (!availability?.apple && !availability?.google) return null;

  // Orden por plataforma: iOS → Apple primero; Android → Google primero.
  const showApple = availability?.apple;
  const showGoogle = availability?.google;
  const appleFirst = isIOS || !isAndroid;

  const AppleBtn = showApple ? (
    <button
      key="apple"
      type="button"
      onClick={() => appleMutation.mutate()}
      disabled={appleMutation.isPending}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Wallet size={16} />
      {appleMutation.isPending ? "Generando…" : "Agregar a Apple Wallet"}
    </button>
  ) : null;

  const GoogleBtn = showGoogle ? (
    <button
      key="google"
      type="button"
      onClick={() => googleMutation.mutate()}
      disabled={googleMutation.isPending}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#8C6B6F]/25 bg-white px-4 py-3 text-sm font-semibold text-[#3D3A3A] transition-colors hover:bg-[#8C6B6F]/[0.05] disabled:opacity-60"
    >
      <Wallet size={16} />
      {googleMutation.isPending ? "Abriendo…" : "Guardar en Google Wallet"}
    </button>
  ) : null;

  const buttons = appleFirst ? [AppleBtn, GoogleBtn] : [GoogleBtn, AppleBtn];

  return (
    <div className="space-y-2">
      <p className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
        Mi pase
      </p>
      {buttons}
    </div>
  );
};
```

*(Verificar el path del hook de toast: en este repo es `@/hooks/use-toast` — confirmar con grep `use-toast` en `src/`. Ajustar el import si difiere.)*

- [ ] **Step 2: Insertar `<WalletButtons />` en `Profile.tsx`**

Agregar el import junto a los demás:

```tsx
import { WalletButtons } from "@/components/WalletButtons";
```

Y colocar el componente entre la sección "Mi cuenta" y la sección "Sesión" (después del `</div>` que cierra el bloque `{/* ── Mi cuenta ── */}` y antes del `{/* ── Sesión ── */}`):

```tsx
          {/* ── Mi pase (Wallet) ── */}
          <WalletButtons />
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`. `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "WalletButtons|Profile"` sin salida.

- [ ] **Step 4: Reproducción local (código, no pase real)**

Levantar front + back local; entrar como alumna → Perfil. Como `availability` = `{apple:false,google:false}`, la sección "Mi pase" NO aparece (correcto: sin credenciales no se ofrece). Confirmar en la consola de red que `GET /api/wallet/availability` respondió 200. La verificación de un pase REAL es en Task 5 tras el runbook.

- [ ] **Step 5: Commit**

```bash
git add src/components/WalletButtons.tsx src/pages/client/Profile.tsx
git commit -m "feat(wallet): botones 'Guardar en Wallet' (Apple/Google) en el perfil de la alumna

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 3: Corregir los enlaces internos del pase (rutas inexistentes → existentes)

**Files:**
- Modify: `server/index.js` — `linksModuleData` (grep `description: "Mi Wallet"`).

**Por qué:** El pase de Google enlaza a `${SITE_URL}/app/wallet` y (si evento) `${SITE_URL}/app/events`, rutas que no existen en `App.tsx` → caen en NotFound. Apuntarlas a rutas reales.

- [ ] **Step 1: Cambiar las URIs**

Localizar (grep `description: "Mi Wallet"`) el bloque:

```js
    linksModuleData: {
      uris: [
        { uri: `${SITE_URL}/app/wallet`, description: "Mi Wallet", id: "wallet_link" },
        {
          uri: hasEventPass ? `${SITE_URL}/app/events` : `${SITE_URL}/app/bookings`,
          description: hasEventPass ? "Mis Eventos" : "Reservar Clase",
          id: hasEventPass ? "events_link" : "book_link",
        },
      ],
    },
```

y reemplazarlo por (ambas URIs a rutas que SÍ existen — `/app` es el dashboard de la alumna, `/app/bookings` sus reservas):

```js
    linksModuleData: {
      uris: [
        { uri: `${SITE_URL}/app`, description: "Mi cuenta", id: "account_link" },
        {
          uri: `${SITE_URL}/app/bookings`,
          description: hasEventPass ? "Mis Eventos" : "Reservar Clase",
          id: hasEventPass ? "events_link" : "book_link",
        },
      ],
    },
```

*(Confirmar con grep en `src/App.tsx` que `/app` y `/app/bookings` son rutas montadas. Si `/app/bookings` no existe con ese path exacto, usar el que exista para reservas.)*

- [ ] **Step 2: Verificar + commit**

Run: `node --check server/index.js`.

```bash
git add server/index.js
git commit -m "fix(wallet): enlaces del pase apuntan a rutas existentes (/app, /app/bookings)

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 4 (OPCIONAL — solo si NO se ha emitido ningún pase todavía): Renombrar naming legacy `puntoneutro`/`pn_` → `tep_`

**Files:**
- Modify: `server/index.js` — 4 sitios que DEBEN cambiar juntos y quedar consistentes.

> **⚠️ GATE:** Ejecutar esta tarea SÓLO si aún no existe NINGÚN pase emitido en producción (ni Apple ni Google). Renombrar el `GW_CLASS_ID` o el prefijo de serial rompe la correspondencia con pases ya instalados (Google no encontraría el objeto; Apple no parsearía el serial). Si ya hay pases → **omitir esta tarea entera**; el naming viejo funciona perfectamente, solo es cosmético. **NO tocar** `JWT_SECRET` (grep `puntoneutro_secret_2026`), ni `pn_vid_`/`pn_boundary_` (subida de archivos, no wallet), ni los correos `@puntoneutro.local`.

- [ ] **Step 1: `GW_CLASS_ID`** (grep `puntoneutro_loyalty_v1`):

```js
const GW_CLASS_ID = GW_ISSUER_ID ? `${GW_ISSUER_ID}.tep_loyalty_v1` : "";
```

- [ ] **Step 2: Object id de Google** (grep `.pn_event_`):

```js
  const objectId = isEventPass
    ? `${GW_ISSUER_ID}.tep_event_${String(activeEventPass?.eventId || "event").replace(/-/g, "")}_${userId.replace(/-/g, "")}`
    : `${GW_ISSUER_ID}.tep_${userId.replace(/-/g, "")}`;
```

- [ ] **Step 3: Serial Apple — generación** (grep `function buildAppleWalletSerialFromUserId`):

```js
function buildAppleWalletSerialFromUserId(userId) {
  const cleaned = String(userId || "").trim();
  if (!cleaned) return "";
  return `tep_${cleaned.replace(/-/g, "")}`;
}
```

- [ ] **Step 4: Serial Apple — parseo inverso** (grep `function parseUserIdFromAppleWalletSerial`):

```js
function parseUserIdFromAppleWalletSerial(serial) {
  const raw = String(serial || "").replace(/^tep_/, "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(raw)) return null;
  return raw.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5").toLowerCase();
}
```

- [ ] **Step 5: Verificar que no quedó ningún `pn_`/`puntoneutro` de wallet suelto**

Run: `grep -n 'puntoneutro_loyalty\|\.pn_\|\^pn_\|`pn_\|"pn_' server/index.js`
Expected: solo aparecen los NO-wallet permitidos (`pn_vid_`, `pn_boundary_`). Si aparece otro de wallet, cambiarlo también. Luego `node --check server/index.js`.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "refactor(wallet): renombrar naming legacy puntoneutro/pn_ a tep_ (sin pases emitidos)

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 5: Documentar env vars + verificación e2e (tras el runbook)

**Files:**
- Create/Modify: `.env.example` (documentar las vars, sin valores reales).

- [ ] **Step 1: Documentar las env vars de wallet y push en `.env.example`**

Agregar (o crear el archivo si no existe) una sección — usar los NOMBRES EXACTOS que lee `server/index.js` (confirmar con grep `process.env.APPLE_`, `process.env.GOOGLE_`, `process.env.GW_`, `process.env.VAPID_`):

```bash
# ── Web Push (VAPID) — ya configurado en producción ──
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:espaciopilatesvm@gmail.com

# ── Apple Wallet (.pkpass nativo) ──
APPLE_TEAM_ID=
APPLE_PASS_TYPE_ID=pass.com.tuespaciopilates.loyalty
APPLE_SIGNER_CERT_BASE64=
APPLE_SIGNER_KEY_BASE64=
APPLE_WWDR_CERT_BASE64=
APPLE_CERT_PASSWORD=
APPLE_KEY_ID=
APPLE_APNS_KEY_BASE64=
APPLE_AUTH_TOKEN=   # FIJO: openssl rand -hex 32 una sola vez; NUNCA cambiar

# ── Google Wallet ──
GOOGLE_ISSUER_ID=
GOOGLE_SA_EMAIL=
GOOGLE_SA_PRIVATE_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(wallet): documentar env vars de Apple/Google Wallet y VAPID en .env.example

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

- [ ] **Step 3: Verificación e2e (con credenciales cargadas por la dueña — Task 0 completo)**
  1. `GET /api/wallet/apple/status` y `/api/wallet/google/diagnostics` → OK (ya validado en Task 0.4).
  2. En un **iPhone real**: abrir la app → Perfil → "Agregar a Apple Wallet" → confirmar que se instala el pase (no el HTML de fallback).
  3. En un **Android real**: Perfil → "Guardar en Google Wallet" → confirmar que se guarda.
  4. Disparar un cambio de "clases restantes" (reservar/aprobar un pago que descuente/agregue clases) y confirmar que el pase se actualiza: Google server-side (PUT `loyaltyObject`), Apple por push APNs en background.
  5. Confirmar que `GET /api/admin/wallet/notifications` ya registra envíos con conteos reales (no puro cero), y que `POST /api/admin/wallet/notify/:userId` (ya existe) re-dispara manualmente.

- [ ] **Step 4:** `git status` limpio, `git log --oneline`. **NO hacer push** — preguntar a Said.

---

## Self-Review
- **Cobertura del spec §4:** B0 runbook → Task 0 + Task 5.1. B1 rename legacy (opcional) → Task 4. B2 botones wallet → Task 2 (+ endpoint availability en Task 1, que el spec pide como "endpoint combinado nuevo `GET /api/wallet/availability`"). B3 fix links → Task 3. B4 verificación e2e → Task 5.3. Documentación `.env.example` (tabla §6) → Task 5.1. Sin huecos.
- **Placeholders:** ninguno — cada paso trae el bloque exacto. `<MODELO>` en commits es intencional. Los tres puntos donde se pide "confirmar con grep el nombre exacto de la env var / hook / ruta" NO son placeholders: son verificaciones de robustez porque esos nombres viven fuera de los anclas que ya verifiqué (los env readers de Google, el path de `use-toast`, y las rutas de `App.tsx`); el ejecutor confirma y usa el valor real.
- **Consistencia de tipos:** `availability` = `{apple:boolean, google:boolean}` idéntico entre el endpoint (Task 1) y el consumidor (Task 2). Apple usa `responseType:"blob"` porque el endpoint manda binario `application/vnd.apple.pkpass` (verificado ~7649-7651). Google lee `res.data.data.saveUrl` porque el endpoint devuelve `{data:{saveUrl}}` (verificado ~6234). En Task 4, `tep_` como prefijo de serialización y `^tep_` en el parseo inverso coinciden.
- **Riesgo controlado:** Task 4 tiene gate explícito (no ejecutar si hay pases emitidos); `APPLE_AUTH_TOKEN` fijo y `JWT_SECRET` intocable están advertidos en 3 lugares.
