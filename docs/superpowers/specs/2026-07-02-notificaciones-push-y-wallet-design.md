# Notificaciones push (paridad + disparo manual) y Wallet passes operativos — Diseño

**Fecha:** 2026-07-02
**Proyecto:** Tu Espacio Pilates · Villa Magna
**Motivo:** La dueña quiere que las notificaciones que hoy salen por WhatsApp también lleguen como **notificación push** a las alumnas que tengan la app guardada (PWA, Android o iPhone), que la admin pueda **disparar push manualmente** (a una alumna y a todas), y que existan **pases de Apple/Google Wallet** guardables que reciban esas actualizaciones/notificaciones.

> **NOTA DE PLANNING:** Este documento y sus dos planes (`docs/superpowers/plans/2026-07-02-push-paridad-disparo-individual.md` y `.../2026-07-02-wallet-passes-operativos.md`) están escritos para ejecutarse con **otro modelo**. Números de línea = referencia al estado del repo el 2026-07-02; **ubicar SIEMPRE por contenido (grep de los anclas citados), no por número**, porque el archivo `server/index.js` (~15.6k líneas) se corre con cada edición.

---

## 1. Estado actual (verificado en código + contra el API de producción)

**El sistema de Web Push ya está construido y ACTIVO en producción.** Verificado el 2026-07-02: `GET https://web-production-b1a1d.up.railway.app/api/push/config` → `{"enabled":true,"publicKey":"BNOt-..."}`. Las llaves VAPID están en Railway (no en `.env` local, por eso en local el push está apagado).

Piezas existentes y funcionales:
- **Capa pura** `server/lib/push.js`: `isPushConfigured()` (VAPID_PUBLIC_KEY+VAPID_PRIVATE_KEY), `sendWebPush`, `buildPushPayload`, `shouldPruneSubscription` (404/410), con tests.
- **Tabla** `push_subscriptions` (multi-dispositivo por usuaria, UNIQUE por `endpoint`) + `users.push_reminders BOOLEAN DEFAULT true`. Migración por `ALTER TABLE` en `ensureSchema` (server/index.js ~666-680).
- **Endpoints** `GET /api/push/config`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe` (~8340-8384).
- **Fan-out** `sendPushToUser(userId, {title, body, url, tag, respectPrefs})` (~9948): respeta `users.push_reminders`, poda 404/410, nunca lanza. Y `sendConfiguredPushTemplate({templateKey, userId, vars, urlPath})` (~9988) que reusa `notification_templates` (subject→title, body sin `*`→body) con `PUSH_TEMPLATE_URLS` (~9936).
- **Service worker** en `public/` con handlers `push` y `notificationclick`; hook cliente `usePushNotifications` + Switch en `ProfilePreferences` con `InstallAppPrompt` para iPhone (detecta iOS no-standalone → guía "Agregar a inicio"; standalone iOS 16.4+ → pide permiso desde el tap).
- **Aviso masivo manual YA existe**: pestaña **Avisos** de `SettingsPage` = `PushBroadcastSection` (~597) → `POST /api/admin/push/broadcast` (~15095) con título/mensaje/enlace/segmento (`all` | `active_membership`); `GET /api/admin/push/stats` (~15079) muestra suscriptoras/dispositivos.

**Gaps reales (lo que falta):**
1. **Recordatorios de clase 12h/30m NO tienen push** — el cron ACTIVO `runClassReminders` (~15479, agendado en `scheduleEmailCrons` ~15559 cada 5 min) solo llama `sendConfiguredWhatsAppTemplate` (~15540). No hay `sendConfiguredPushTemplate`. **Este es el gap central de la petición.** Además el query filtra `u.phone IS NOT NULL` (~15505): alumnas sin teléfono no reciben NADA.
2. **Reagenda de reserva** (~4298) y **admin asigna reserva** (~12138): solo email, sin push (los call sites de `booking_confirmed`/`booking_waitlist` ahí no tienen `sendConfiguredPushTemplate`, a diferencia de la reserva propia ~3846 que sí).
3. **No hay disparo manual a UNA alumna**: `sendPushToUser` es interna, sin endpoint HTTP per-clienta; `ClientDetail`/`ClientsList` no tienen acción de notificación.
4. **`PUSH_TEMPLATE_URLS` no tiene** entradas para `class_reminder_12h`/`class_reminder_30m` (caerían al default `/app`).
5. **Broadcast sin confirmación** previa ni log de avisos enviados.
6. **`users.push_reminders` sin toggle de clienta** (el Switch de ProfilePreferences es per-dispositivo vía subscribe/unsubscribe; el gate real `push_reminders` nunca se apaga desde UI → siempre `true`). *No es objetivo de este proyecto pero se documenta.*

**Wallet passes: ~90% construido en backend, 0% operativo de cara al usuario.**
- Backend completo: `generateApplePkpass` (~6994, .pkpass firmado con openssl PKCS#7), `buildGoogleWalletSaveUrl` (~5953, JWT save-url RS256), sync Google server-side `syncGoogleWalletObjectForUser` (~6778), push APNs Apple `notifyApplePassUpdatedForUser` (~6818), Apple Web Service V1 (registro de dispositivos ~7957), `triggerWalletPassSync` (~6933) invocado desde **~35 eventos** de negocio, tabla `wallet_notification_logs`, endpoints admin `GET /api/admin/wallet/notifications` (~8086) y **`POST /api/admin/wallet/notify/:userId` (~8108, ya existe)**.
- **Bloqueadores:** (a) Apple en "web pass fallback mode" (un HTML con QR externo, NO un pase) por faltar `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_ID` y los 3 PEM (signer cert/key + WWDR); (b) Google responde 503 por faltar `GOOGLE_ISSUER_ID`/`GOOGLE_SA_EMAIL`/`GOOGLE_SA_PRIVATE_KEY`; (c) APNs sin `APPLE_KEY_ID`/`APPLE_APNS_KEY_BASE64`; (d) **el frontend no tiene NI UN botón** "Guardar en Wallet" (grep `wallet` en `src/` = 0); (e) los `wallet_notification_logs` hoy solo escriben ceros con `status='ok'` engañoso porque todo cortocircuita por falta de config.
- **Bomba de tiempo detectada:** `APPLE_AUTH_TOKEN` (~6329) usa `crypto.randomBytes(32)` por arranque → si se emiten pases reales SIN fijar esa env var, cada redeploy invalida el `authenticationToken` embebido y los pases instalados dan 401. **Debe fijarse ANTES del primer pase.**
- **Naming legacy** heredado de otro proyecto ("Punto Neutro"): `GW_CLASS_ID = ${issuer}.puntoneutro_loyalty_v1` (~5854), seriales `pn_<userId>` (~5957, 6481). Funcional pero confuso. (OJO: `JWT_SECRET` default `puntoneutro_secret_2026` en ~42 es OTRA cosa — **NO tocar**, cambiarlo cierra todas las sesiones.)
- Los pases enlazan a `/app/wallet` y `/app/events` (~6190) que **no existen** en `App.tsx` → caen en NotFound.

## 2. Objetivo y decisiones confirmadas (con la dueña, 2026-07-02)

- **Push ADITIVO a WhatsApp** (no reemplazo): todo lo que hoy sale por WhatsApp también por push; WhatsApp sigue igual.
- **Disparo manual: individual + masivo**, con **texto libre** (título + mensaje).
- **Cuentas de Apple Developer y Google Wallet: ya las tiene.** El plan de wallet cubre generar certificados/credenciales y configurarlos en Railway (runbook), NO crear cuentas.

**Se divide en 2 planes independientes** (cada uno produce software funcional por sí solo):
- **Plan A — Paridad push + disparo individual.** Solo código, ejecutable de inmediato (VAPID ya está en prod). No depende de credenciales nuevas.
- **Plan B — Wallet passes operativos.** Requiere un runbook manual de credenciales (la dueña) + código de UI/fixes. Ejecutable en paralelo o después de A.

---

## 3. Plan A — Paridad push + disparo individual

### A1. Recordatorios 12h/30m también por push
En `runClassReminders` (~15479, el cron VIVO), junto al `sendConfiguredWhatsAppTemplate` de ~15540, agregar `sendConfiguredPushTemplate({ templateKey: is12h ? "class_reminder_12h" : "class_reminder_30m", userId: <userId de la fila>, vars })`. Requiere que el SELECT del cron traiga el `user_id` (verificar; si no, agregarlo). Relajar el filtro `u.phone IS NOT NULL` (~15505) para que las alumnas sin teléfono **sí** reciban push: cambiar el gate para incluir filas sin phone pero con `receive_reminders IS NOT FALSE`, y saltar el WhatsApp cuando no haya phone (el push no depende del teléfono). Agregar `class_reminder_12h` y `class_reminder_30m` a `PUSH_TEMPLATE_URLS` (~9936) → `'/app/bookings'`. Actualizar los badges del admin (`NOTIFICATION_TEMPLATES` en `SettingsPage.tsx` ~229) a `['whatsapp','push']` para esos dos.

### A2. Push en reagenda y en asignación admin de reservas
- Reagenda (`PUT .../reschedule`, tras el WA ~4298): agregar `sendConfiguredPushTemplate({ templateKey: "booking_confirmed", userId, vars })`, espejando el patrón de la reserva propia (~3846).
- Admin asigna (`POST /api/admin/bookings/assign`, tras el WA ~12138): mismo `sendConfiguredPushTemplate` con `isWaitlist ? "booking_waitlist" : "booking_confirmed"`.

### A3. Disparo manual a UNA alumna (endpoint + UI)
- **Backend:** `POST /api/admin/push/user/:userId` (adminMiddleware): valida `title`/`body`; 400 si `!isPushConfigured()`; llama `sendPushToUser(userId, { title:slice(0,80), body:slice(0,240), url: url||'/app', tag: 'admin_manual', respectPrefs: true })`; devuelve `{sent, failed, pruned}`. Mismo estilo que el broadcast (~15095).
- **Backend (info para la admin):** exponer, en el payload de `ClientDetail` o vía un `GET /api/admin/push/user/:userId/devices` sencillo, cuántas suscripciones tiene la alumna (`SELECT count(*) FROM push_subscriptions WHERE user_id=$1`) y su `push_reminders`, para que la admin sepa si el push le llegaría.
- **Frontend:** botón **"Enviar notificación"** en el `SectionCard` "Perfil de la alumna" de `ClientDetail.tsx` (junto a "Restablecer contraseña" ~529-540 — mismo patrón `useMutation` + `toast` + confirm/diálogo). Abre un diálogo con Título + Mensaje (maxLength 80/240) y muestra "N dispositivo(s) suscrito(s)". Si la alumna tiene 0 dispositivos, deshabilitar con nota "no tiene la app instalada". Reusar/extraer el form del `PushBroadcastSection` si conviene.

### A4. Confirmación previa en el aviso masivo
En `PushBroadcastSection` (~597), agregar un `window.confirm`/diálogo antes de disparar ("Enviar a N alumnas suscritas — no se puede deshacer").

**Fuera de alcance de A (explícito):**
- Revivir `last_class_reminder` ("te queda 1 clase") — su cron `runRenewalReminderCron` fue retirado a propósito el 2026-06-28; se deja como opción futura documentada.
- Toggle de clienta para `users.push_reminders` a nivel cuenta.
- Log/historial de avisos, programación, segmentación avanzada, cola/batching del broadcast.
- Borrar el código muerto `runClassReminderCron` (~15338) — no molesta; opcional.

---

## 4. Plan B — Wallet passes operativos + sus notificaciones

### B0. Runbook de credenciales (manual, la dueña — prerequisito)
Guía paso a paso (la dueña ya tiene ambas cuentas):
- **Apple:** crear/identificar el **Pass Type ID** (identifier `pass.com.tuespaciopilates...`); generar el certificado del pase (.cer→.p12→PEM signer cert + key), descargar **WWDR G4**, crear la **llave APNs .p8** (Key ID). Env vars en Railway: `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_ID`, `APPLE_SIGNER_CERT_PEM`, `APPLE_SIGNER_KEY_PEM`, `APPLE_WWDR_CERT_PEM` (o sus variantes `_BASE64`), `APPLE_CERT_PASSWORD` (si aplica), `APPLE_KEY_ID`, `APPLE_APNS_KEY_BASE64`, y **`APPLE_AUTH_TOKEN` = un valor FIJO** (generar una vez, p.ej. `openssl rand -hex 32`, y NO cambiarlo jamás). Referencias en el repo: `wallet-assets/README.md`, `wallet-assets/APPLE_WALLET_DOCUMENTATION.md`.
- **Google:** issuer de Google Wallet (`GOOGLE_ISSUER_ID`), service account con rol Wallet Object Issuer (`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` o `GOOGLE_SA_KEY_JSON_BASE64`).
- **Verificación:** `GET /api/wallet/apple/status` y `GET /api/wallet/google/diagnostics` (ambos admin, ya existen) deben reportar configurado/firma OK antes de continuar.

### B1. (Opcional, solo AHORA que no hay pases emitidos) Renombrar naming legacy
Cambiar los identificadores de wallet `puntoneutro`→`tep` y prefijo serial `pn_`→`tep_`: `GW_CLASS_ID` (~5854), generación de serial/object id (~5957, ~6481) y el parseo inverso del serial (~6485) — **deben cambiar juntos y ser consistentes**. **NO tocar** `JWT_SECRET` (~42, cierra sesiones), ni los nombres de archivo de subida `pn_vid_`/`pn_boundary_` (~346, 375, no relacionados con wallet), ni los correos placeholder `@puntoneutro.local` (~12852). Tarea aislada y opcional; si se omite, todo funciona igual con el naming viejo.

### B2. Botones "Guardar en Wallet" en la app de la clienta
En el perfil/dashboard de la clienta, agregar botones **"Agregar a Apple Wallet"** (link a `GET /api/wallet/apple/pkpass`) y **"Guardar en Google Wallet"** (link a `GET /api/wallet/google/save-url` → abre `saveUrl`), con **detección de plataforma** (iOS→Apple, Android→Google, desktop→ambos o QR). Ocultar/deshabilitar cada botón si el backend no está configurado (consultar `/api/wallet/apple/status` y un flag de Google, o un endpoint combinado nuevo `GET /api/wallet/availability` que devuelva `{apple:bool, google:bool}`). Manejar el estado "web pass fallback" con copy claro si Apple aún no firma.

### B3. Rutas que el pase enlaza
Los pases enlazan a `/app/wallet` y `/app/events` (~6190) que no existen. Opción mínima: cambiar esos `linksModuleData`/`links` a rutas que SÍ existen (`/app` o `/app/bookings`). Opción completa (si se quiere): crear páginas reales. Para este plan: apuntar a rutas existentes.

### B4. Verificación e2e de las notificaciones del pase
Las notificaciones del pase ya están cableadas a ~35 eventos vía `triggerWalletPassSync`; **se encienden solas** al configurar credenciales. Verificar de punta a punta: emitir un pase (Apple en iPhone real / Google en Android real), reservar/aprobar algo que cambie "clases restantes", y confirmar que el pase se actualiza (Google server-side por PUT loyaltyObject; Apple por push APNs background). Confirmar que `wallet_notification_logs` ya no escribe puro cero. `POST /api/admin/wallet/notify/:userId` (ya existe) sirve para re-disparar manualmente.

**Fuera de alcance de B:** rediseño visual del pase; sincronizar pases de EVENTO server-side en Google (hoy solo membresía ~6785); assets de sellos para bienestar/funcional; quitar la dependencia del QR externo `api.qrserver.com` del fallback web.

---

## 5. Pruebas (ambos planes)
- **Plan A:** `node --check server/index.js`; `npm test` (suite existente, sin `server/lib/*` nuevo salvo que se agregue helper) sigue verde; `npm run build`. Reproducción local: como `.env` local NO tiene VAPID, el push es no-op logueado — verificar por LOG que los nuevos call sites se ejecutan sin lanzar (12h/30m, reagenda, admin-assign, disparo individual) y que el endpoint `POST /api/admin/push/user/:id` responde 200/400 correctamente. Verificación real de entrega: en producción (VAPID activo) con un dispositivo suscrito, tras desplegar.
- **Plan B:** validar `GET /api/wallet/apple/status` y `/api/wallet/google/diagnostics` = OK tras cargar credenciales; e2e en dispositivos reales (iPhone + Android). `npm run build` para los botones del front.

## 6. Archivos tocados (resumen)
| Plan | Archivo | Cambio |
|---|---|---|
| A | `server/index.js` | push en runClassReminders (+relajar filtro phone); push en reagenda y admin-assign; endpoint `POST /api/admin/push/user/:userId` (+devices count); `PUSH_TEMPLATE_URLS` 12h/30m |
| A | `src/pages/admin/clients/ClientDetail.tsx` | botón + diálogo "Enviar notificación" |
| A | `src/pages/admin/settings/SettingsPage.tsx` | badges 12h/30m a whatsapp+push; confirm en broadcast |
| B | Railway env + `wallet-assets/` | credenciales Apple/Google (runbook, manual) |
| B | `server/index.js` | (opcional) rename naming wallet; fix links del pase; (nuevo) `GET /api/wallet/availability` |
| B | `src/pages/client/*` (Profile/Dashboard) + posible `WalletButtons` | botones Guardar en Wallet |
| B | `.env.example` | documentar vars APPLE_*/GOOGLE_* |
