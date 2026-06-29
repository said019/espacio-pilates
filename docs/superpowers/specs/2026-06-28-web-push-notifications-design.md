# Notificaciones Web Push — Tu Espacio Pilates VM

**Fecha:** 2026-06-28
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Objetivo

Que las alumnas reciban notificaciones **en su dispositivo aunque no tengan la app
abierta**. La plataforma es una web app (PWA) con scaffold ya existente
(`site.webmanifest` en `display: standalone`, `public/sw.js` registrado en
`index.html`, íconos 192/512). La solución es **Web Push** (Push API + Service
Worker + llaves VAPID), sin app nativa ni tiendas de aplicaciones.

El push entra como **un canal nuevo y aditivo** junto a los canales ya existentes
(WhatsApp vía Evolution API y correo vía Resend), reutilizando el sistema de
plantillas de notificación actual.

## Decisiones tomadas (brainstorming)

1. **Eventos:** automáticos (los que ya disparan WhatsApp/correo) **+** una
   herramienta de avisos manuales (broadcast) en el panel admin.
2. **iPhone:** se agrega un aviso que guía a "Agregar a inicio" (instalar la PWA),
   porque iOS solo permite Web Push si la app está instalada en pantalla de inicio
   (iOS 16.4+). En Android y computadora el push funciona desde el navegador.
3. **Relación con WhatsApp/correo:** el push **se suma**, no reemplaza. Cada alumna
   controla push, correo y WhatsApp por separado (sin lógica de dedup entre canales).
4. **Ubicación del toggle:** en `src/pages/client/ProfilePreferences.tsx`, junto a
   las preferencias de correo/WhatsApp.

## Alternativas consideradas

- **Web Push (elegida):** funciona sobre la PWA actual, gratis, sin tiendas, se
  integra como canal más.
- **App nativa (FCM/APNs):** descartada — implicaría construir y publicar apps
  iOS/Android; fuera de alcance.
- **Seguir solo con WhatsApp/correo:** ya existe; no cumple "notificación de app"
  en el dispositivo.

## Restricción clave: iOS

- Android (Chrome/Firefox/Edge) y escritorio: push directo desde el navegador.
- iPhone/iPad: Web Push **solo** funciona si la PWA está instalada en la pantalla
  de inicio (Safari 16.4+). En una pestaña normal de Safari no hay API de push.
- Por eso el frontend detecta `display-mode: standalone` + iOS y, si no está
  instalada, muestra el `InstallAppPrompt` en lugar del toggle de activación.

## Arquitectura

```
Cliente (PWA)                       Backend (Express)              Push Service
  │  activar push                       │                          (FCM/Mozilla/…)
  ├─ permiso + subscribe ──────────────►│  POST /api/push/subscribe
  │                                     │   guarda en push_subscriptions
  │                                     │
Evento (reserva, recordatorio, …)       │
  │                                     ├─ sendPushTemplate(...) ──► entrega ──► SW
  │                                     │   (+ WhatsApp + correo, según prefs)     │
  │                                     │                                          ▼
  │  notificación visible aunque app cerrada ◄───── 'push' event ──────────────────┘
  │  click → 'notificationclick' → abre/enfoca la app en la URL relevante
```

Degradación limpia: sin llaves VAPID, `GET /api/push/config` devuelve
`enabled:false`, el frontend oculta el toggle y los envíos de push se omiten
(mismo patrón que MercadoPago/Evolution cuando faltan credenciales).

## Componentes

### 1. Backend — dependencia y llaves
- Paquete npm `web-push`.
- Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`mailto:espaciopilatesvm@gmail.com`). Generadas para `.env` local; en Railway
  (servicio `web`) las configura el usuario en go-live.
- Helper `isPushConfigured()` análogo a `isEvolutionConfigured()`.

### 2. Base de datos (migración idempotente en `ensureSchema()`)
- Tabla `push_subscriptions`:
  - `id` SERIAL PK
  - `user_id` INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  - `endpoint` TEXT NOT NULL UNIQUE
  - `p256dh` TEXT NOT NULL
  - `auth` TEXT NOT NULL
  - `user_agent` TEXT
  - `created_at` TIMESTAMPTZ DEFAULT now()
  - `last_used_at` TIMESTAMPTZ
  - índice por `user_id`.
- Columna `users.push_reminders BOOLEAN DEFAULT true` (`ADD COLUMN IF NOT EXISTS`).

### 3. Endpoints
- `GET /api/push/config` → `{ enabled: boolean, publicKey: string|null }`.
- `POST /api/push/subscribe` (auth): body `{ endpoint, keys: {p256dh, auth} }`.
  Upsert por `endpoint` (ON CONFLICT actualiza `user_id`, `last_used_at`).
- `POST /api/push/unsubscribe` (auth): body `{ endpoint }` → borra esa fila.
- `GET /api/admin/push/stats` (admin): `{ subscribers, devices }` (alumnas únicas y
  dispositivos suscritos; opcional desglose por segmento).
- `POST /api/admin/push/broadcast` (admin): body
  `{ title, body, url?, segment: "all"|"active_membership" }` → envía a todos los
  suscriptores del segmento. Devuelve `{ sent, failed, pruned }`.

### 4. Helper de envío
- `sendPushToUser(userId, { title, body, url, tag })`:
  - Lee `push_subscriptions` del usuario.
  - Respeta `users.push_reminders` (los avisos del admin pueden ignorar esta
    preferencia solo si es un anuncio operativo; por defecto la respetan).
  - Envía con `web-push` (payload JSON `{ title, body, url, tag }`).
  - Poda suscripciones muertas: al recibir 404/410 borra la fila.
  - Best-effort: errores se loguean, nunca rompen el flujo que la invoca.
- `sendPushTemplate({ templateKey, userId, vars })`: reutiliza las plantillas
  existentes (`booking_confirmed`, `booking_waitlist`, etc.) para construir
  `title` (subject) y `body`, y deriva `url` por tipo de evento (ej. reservas →
  `/mis-reservas`). Internamente llama a `sendPushToUser`.

### 5. Service worker (`public/sw.js`)
- Mantener el caché actual (bump de `CACHE_NAME`).
- Agregar handler `push`: parsea el JSON, `showNotification(title, { body, icon:
  '/icon-192.png', badge, data: { url }, tag })`.
- Agregar handler `notificationclick`: cierra la notificación y enfoca una ventana
  existente de la app o abre una nueva en `data.url`.

### 6. Frontend
- Hook `src/hooks/usePushNotifications.ts`:
  - Detecta soporte (`'serviceWorker' in navigator && 'PushManager' in window`).
  - Detecta iOS y `display-mode: standalone`.
  - `subscribe()`: pide permiso, obtiene `registration` (`navigator.serviceWorker
    .ready`), `pushManager.subscribe({ userVisibleOnly: true,
    applicationServerKey })` usando la `publicKey` de `/api/push/config`, y envía
    la suscripción al backend.
  - `unsubscribe()`: `subscription.unsubscribe()` + `POST /api/push/unsubscribe`.
  - Estados expuestos: `unsupported | needs-install-ios | denied | inactive | active`.
- Toggle "Notificaciones en este dispositivo" en `ProfilePreferences.tsx`, junto a
  correo/WhatsApp, reflejando el estado del hook.
- Componente `src/components/InstallAppPrompt.tsx`: en iPhone+Safari sin instalar,
  explica los pasos de "Agregar a inicio".

### 7. Wire en eventos automáticos
En cada punto donde hoy se llaman los canales de correo/WhatsApp, agregar una
llamada paralela a `sendPushTemplate(...)` (best-effort). Eventos:
`booking_confirmed`, `booking_waitlist`, `booking_waitlist_promoted`,
`booking_cancelled`, `membership_activated`, `renewal_reminder`, `class_reminder`,
`last_class_reminder`.

### 8. Avisos del admin (broadcast)
- Sección "Avisos" en `src/pages/admin/settings/SettingsPage.tsx`: campos título,
  mensaje, URL opcional, segmento (todas / con membresía activa); muestra el conteo
  de suscriptores (`/api/admin/push/stats`) y el resultado del envío
  (`/api/admin/push/broadcast`).

## Flujo de datos

1. Alumna → ProfilePreferences → activa el toggle → permiso → subscribe → backend
   guarda en `push_subscriptions`.
2. Ocurre un evento (ej. reserva confirmada) → backend dispara push + WhatsApp +
   correo (cada uno según preferencia) → el SW muestra la notificación aunque la
   app esté cerrada → click abre/enfoca la app en la URL del evento.
3. Admin → Ajustes → Avisos → escribe y envía → broadcast a los suscriptores del
   segmento.

## Manejo de errores

- Falta VAPID → `enabled:false`, UI oculta el toggle, envíos de push omitidos.
- Suscripción muerta (404/410 al enviar) → se borra automáticamente.
- Permiso denegado → la UI lo indica; no reintenta de forma agresiva.
- `web-push` falla por otra causa → log best-effort, no rompe reserva/pago/cron.

## Seguridad y privacidad

- `subscribe`/`unsubscribe` requieren auth; la suscripción queda ligada al `user_id`.
- `broadcast` y `stats` solo para admin.
- Actualizar `src/pages/legal/Privacidad.tsx` mencionando notificaciones push.

## Pruebas

- **Unit:** `sendPushToUser` (mock `web-push`, verifica poda en 410/404),
  `sendPushTemplate` (mapeo plantilla→title/body/url), endpoints subscribe/
  unsubscribe (validación de payload, auth).
- **Manual:** suscribir en Chrome escritorio → enviar broadcast → ver notificación
  con la app cerrada → click abre la app. Verificar degradación sin VAPID
  (toggle oculto, sin errores).

## Fuera de alcance (YAGNI)

- Sin media ni botones de acción en la notificación (solo título + cuerpo + click).
- Sin segmentación avanzada (solo "todas" y "con membresía activa").
- Solo español.
- Sin lógica de dedup entre canales (push se suma).
