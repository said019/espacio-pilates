# Implementacion Completa: Apple Wallet + Google Wallet

## Descripcion General

El proyecto Xolobitos implementa un sistema completo de **Tarjetas de Lealtad Digitales** para **Apple Wallet (iOS)** y **Google Wallet (Android)**. El sistema integra certificados digitales, generacion de passes (.pkpass), notificaciones push (APNs) y APIs de sincronizacion en tiempo real.

---

## 1. Arquitectura de Archivos

```
server/
├── wallet-assets/
│   └── apple.pass/
│       ├── Certificados y Claves:
│       │   ├── pass.pem (certificado de firma)
│       │   ├── pass.key (llave privada)
│       │   ├── pass.p12 (p12 combinado)
│       │   ├── pass.cer (certificado CER)
│       │   ├── wwdr.pem (certificado WWDR Apple)
│       │   ├── wwdr_rsa.pem (WWDR RSA)
│       │   ├── AppleWWDRCAG4.cer (CA G4)
│       │   ├── AppleWWDRCAG6.cer (CA G6)
│       │   └── google_private.pem (para Google Wallet)
│       ├── Imagenes Base:
│       │   ├── icon.png / icon@2x.png / icon@3x.png
│       │   ├── logo.png / logo@2x.png / logo@3x.png
│       │   └── strip.png / strip@2x.png / strip@3x.png
│       ├── Strips Dinamicos (por tipo y numero de sellos):
│       │   └── strips/
│       │       ├── strip-basico-{0..6}@{1x,2x,3x}.png
│       │       ├── strip-descuento-{0..6}@{1x,2x,3x}.png
│       │       └── strip-multiperro-{0..6}@{1x,2x,3x}.png
│       └── pass.json (configuracion base)
│
├── src/
│   ├── lib/
│   │   ├── apple-wallet.ts (1061 lineas)
│   │   │   └── Generacion de .pkpass, APNs, registro de dispositivos
│   │   ├── google-wallet.ts (578 lineas)
│   │   │   └── OAuth2, Loyalty Class/Object, mensajes
│   │   ├── notifications.ts (235 lineas)
│   │   │   └── Orquestacion de notificaciones Apple + Google
│   │   └── prisma.ts
│   │
│   └── routes/
│       ├── wallet.ts (539 lineas)
│       │   ├── Apple Web Service endpoints (/v1/*)
│       │   ├── Public endpoints (/apple/:cardId, /google/:cardId)
│       │   └── Debug endpoints (/debug/*)
│       ├── loyalty.ts (632 lineas)
│       │   ├── Gestion de tarjetas
│       │   ├── Canjes de recompensas
│       │   └── Cambio de tipos de tarjeta
│       └── notifications.ts (68 lineas)
│           └── Envio de notificaciones push
│
├── prisma/
│   └── schema.prisma (536 lineas)
│       ├── Models: LoyaltyCard, AppleWalletDevice, AppleWalletUpdate
│       ├── Models: LoyaltyStamp, RewardRedemption
│       └── Models: NotificationLog
│
└── .env.wallet.example (179 lineas)
    └── Configuracion de variables de entorno
```

---

## 2. Modelo de Datos (Prisma)

### 2.1 Modelos Principales

```typescript
// TARJETA DE LEALTAD
model LoyaltyCard {
  id             String          @id @default(uuid())
  clientId       String          @unique
  cardNumber     String          @unique         // Ej: "XOL-000001"
  cardType       LoyaltyCardType @default(basico) // basico|descuento|multiperro
  totalStamps    Int             @default(0)
  stampsRedeemed Int             @default(0)    // Sellos canjeados
  isActive       Boolean         @default(true)
  latestMessage  String?         // Mensaje personalizado para el pase
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  client         Client               @relation(...)
  stamps         LoyaltyStamp[]
  redemptions    RewardRedemption[]
  walletDevices  AppleWalletDevice[]  // Dispositivos iOS
  walletUpdates  AppleWalletUpdate[]
  notifications  NotificationLog[]
}

// DISPOSITIVOS APPLE WALLET REGISTRADOS
model AppleWalletDevice {
  id            String   @id @default(uuid())
  deviceId      String   // Device Library Identifier (unico por dispositivo)
  pushToken     String   // APNs Push Token
  passTypeId    String   // Pass Type Identifier (com.xolobitos.loyalty)
  loyaltyCardId String   // Serial Number = LoyaltyCard.id
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  loyaltyCard LoyaltyCard @relation(...)

  @@unique([deviceId, passTypeId, loyaltyCardId])
}

// HISTORIAL DE ACTUALIZACIONES APPLE WALLET
model AppleWalletUpdate {
  id            String   @id @default(uuid())
  loyaltyCardId String
  stampsOld     Int?
  stampsNew     Int?
  updatedAt     DateTime @default(now())

  loyaltyCard LoyaltyCard @relation(...)
}

// SELLOS (VISITAS)
model LoyaltyStamp {
  id            String   @id @default(uuid())
  loyaltyCardId String
  appointmentId String?
  notes         String?  // Descripcion (ej: "Bano Basico - Firulais")
  createdAt     DateTime @default(now())

  loyaltyCard LoyaltyCard  @relation(...)
  appointment Appointment? @relation(...)
}

// CANJES DE RECOMPENSAS
model RewardRedemption {
  id            String        @id @default(uuid())
  loyaltyCardId String
  rewardId      String?
  appointmentId String?
  stampsUsed    Int
  status        PaymentStatus @default(completed)
  redeemedAt    DateTime      @default(now())

  loyaltyCard LoyaltyCard    @relation(...)
  reward      LoyaltyReward? @relation(...)
  appointment Appointment?   @relation(...)
}

// HISTORIAL DE NOTIFICACIONES
model NotificationLog {
  id            String             @id @default(uuid())
  loyaltyCardId String
  title         String?
  message       String
  channel       NotificationChannel // 'apple' | 'google'
  status        NotificationStatus  // 'pending' | 'sent' | 'failed'
  error         String?
  createdAt     DateTime           @default(now())

  loyaltyCard LoyaltyCard @relation(...)

  @@index([loyaltyCardId, createdAt])
}
```

---

## 3. Apple Wallet - Implementacion Completa

### 3.1 Generacion de Pases (.pkpass)

**Archivo:** `server/src/lib/apple-wallet.ts`

**Funcion principal:**
```typescript
buildApplePassBuffer(loyaltyCard) → Buffer
```

**Proceso de generacion:**

1. **Lectura de Datos:**
   - LoyaltyCard con cliente, mascotas, tipo de tarjeta
   - Calcula: `currentStamps = totalStamps - stampsRedeemed`
   - Obtiene tipo de tarjeta (`basico` | `descuento` | `multiperro`)

2. **Construccion Dinamica del `pass.json`:**
   ```typescript
   {
     formatVersion: 1,
     passTypeIdentifier: "pass.com.xolobitos.loyalty",
     teamIdentifier: APPLE_TEAM_ID,
     serialNumber: cardId,
     organizationName: "Xolobitos Grooming",
     webServiceURL: "https://...",
     authenticationToken: APPLE_AUTH_TOKEN,

     storeCard: {
       headerFields: [...],
       primaryFields: [...],
       secondaryFields: [...],
       auxiliaryFields: [...],
       backFields: [...]
     },

     // Colores dinamicos por tipo
     backgroundColor: "rgb(245, 200, 210)",    // Rosa para basico
     foregroundColor: "rgb(51, 51, 51)",
     labelColor: "rgb(217, 94, 136)",

     barcodes: [{ format: "PKBarcodeFormatQR", message: cardId }],
     locations: [{ latitude, longitude }],
     expirationDate: "2026-01-19T...",
     relevantDate: "2025-01-19T..."
   }
   ```

3. **Seleccion de Imagenes Dinamicas:**
   - Copia `icon`, `logo` (estandar)
   - Selecciona `strip` segun:
     - Tipo de tarjeta: `strip-{cardType}-{stampCount}`
     - Resoluciones: `@1x`, `@2x`, `@3x`
   - Ejemplo: `strip-basico-3@2x.png` para 3 sellos acumulados

4. **Firma y Compresion:**
   - Lee certificados:
     - `pass.pem` (certificado de firma)
     - `pass.key` (llave privada)
     - `wwdr_rsa.pem` (WWDR Apple)
   - Usa `PKPass` (libreria `passkit-generator`)
   - Retorna buffer `.pkpass` (ZIP firmado)

### 3.2 Web Service Endpoints (Protocolo Apple)

**Archivo:** `server/src/routes/wallet.ts`

```typescript
POST   /v1/devices/:deviceId/registrations/:passTypeId/:serial
GET    /v1/devices/:deviceId/registrations/:passTypeId
GET    /v1/passes/:passTypeId/:serial
DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial
POST   /v1/log
```

**Flujo de Sincronizacion:**

1. **Registro (POST /v1/devices/.../registrations):**
   - Cliente iOS envia `{ pushToken }`
   - Server guarda en `AppleWalletDevice`
   - Autenticacion: Header `ApplePass {APPLE_AUTH_TOKEN}`

2. **Consulta de Actualizables (GET /v1/devices/.../registrations):**
   - iOS pregunta: "Hay pases actualizados desde X fecha?"
   - Server revisa `AppleWalletUpdate` table
   - Retorna array de `serialNumbers` a actualizar

3. **Descargar Pase (GET /v1/passes/:passTypeId/:serial):**
   - iOS solicita version mas reciente del pase
   - Server llama `buildApplePassBuffer()`
   - Retorna `.pkpass` binario

4. **Desregistro (DELETE):**
   - iOS notifica que usuario removio el pase
   - Server limpia `AppleWalletDevice`

### 3.3 Notificaciones APNs (Push)

**Configuracion requerida:**
```typescript
APPLE_KEY_ID          // Key ID del APNs Auth Key
APPLE_TEAM_ID         // Team ID (10 chars)
APPLE_APNS_KEY_BASE64 // Clave P8 en Base64
APPLE_PASS_TYPE_ID    // com.xolobitos.loyalty
```

**Funcion de envio:**
```typescript
sendAPNsAlertNotification(pushToken, title, body) → Promise<boolean>
```

**Proceso:**

1. **Generacion de JWT:**
   ```typescript
   jwt.sign(
     { iss: teamId, iat: nowSeconds },
     key,
     { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } }
   )
   ```

2. **Conexion HTTP/2:**
   - Host: `api.push.apple.com:443`
   - Path: `/3/device/{pushToken}`
   - Headers:
     - `authorization: bearer {JWT_TOKEN}`
     - `apns-topic: {PASS_TYPE_ID}`
     - `apns-push-type: alert`
     - `apns-priority: 10`

3. **Payload APNS:**
   ```json
   {
     "aps": {
       "alert": {
         "title": "Nuevo sello!",
         "body": "Tienes 3 sellos acumulados"
       },
       "sound": "default",
       "badge": 1,
       "mutable-content": 1
     }
   }
   ```

4. **Limpieza Automatica:**
   - Si APNs retorna `410 (Gone)`, elimina token automaticamente
   - Evita "pases zombie"

---

## 4. Google Wallet - Implementacion Completa

### 4.1 Configuracion OAuth2

**Archivo:** `server/src/lib/google-wallet.ts`

**Variables requeridas:**
```typescript
GOOGLE_ISSUER_ID            // ID de emisor en Google Wallet
GOOGLE_SA_EMAIL             // Email del Service Account
GOOGLE_SA_PRIVATE_KEY       // Clave privada RSA (formato PEM)
BASE_URL                    // URL base del servidor
FRONTEND_URL                // URL del frontend (para origins)
```

**Obtencion de Token:**
```typescript
getGoogleWalletAccessToken() → Promise<string>
```

1. Carga credenciales Service Account
2. Genera JWT de asercion:
   ```typescript
   {
     iss: serviceAccountEmail,
     scope: "https://www.googleapis.com/auth/wallet_object.issuer",
     aud: "https://oauth2.googleapis.com/token",
     iat: nowSeconds,
     exp: nowSeconds + 3600
   }
   ```
3. Intercambia por token OAuth2 via POST a `https://oauth2.googleapis.com/token`

### 4.2 Creacion de Loyalty Class

```typescript
createGoogleLoyaltyClass(cardType?: 'basico' | 'descuento' | 'multiperro')
```

**Clase por Tipo de Tarjeta:**
```typescript
{
  id: "{issuerId}.xolobitos_loyalty_{cardType}_v2",
  issuerName: "Xolobitos Estetica Canina",
  programName: "Lealtad Xolobitos - {type}",
  hexBackgroundColor: "#F5C6D3" | "#B4DCDC" | "#B4C8E6",

  programLogo: { sourceUri: { uri: "{BASE_URL}/assets/logo.png" } },
  title: { defaultValue: { language: "es", value: "..." } },
  welcomeMessage: { ... },
  details: { ... },
  termsAndConditions: { ... },

  locations: [{ latitude, longitude }],
  multipleDevicesAndHoldersAllowedStatus: "MULTIPLE_HOLDERS"
}
```

### 4.3 Crear/Actualizar Loyalty Object

```typescript
upsertGoogleLoyaltyObject(input: {
  cardId: string;
  name: string;
  stamps: number;
  max: number;
  cardType?: 'basico' | 'descuento' | 'multiperro';
})
```

**Objeto Dinamico:**
```typescript
{
  id: "{issuerId}.{cardId}_v2",
  classId: "{issuerId}.xolobitos_loyalty_{cardType}_v2",
  state: "active",
  accountId: cardId,
  accountName: clientName,
  hexBackgroundColor: "{dynamicByType}",

  barcode: { type: "QR_CODE", value: cardId },
  loyaltyPoints: { balance: { int: stamps }, label: "SELLOS" },
  secondaryLoyaltyPoints: { balance: { string: badge }, label: "TARJETA" },

  textModulesData: [
    { id: "customer_name", header: "CLIENTE", body: name },
    { id: "reward", header: "PREMIO", body: "{dynamicByType}" },
    { id: "remaining", header: "TE FALTAN", body: `${max - stamps} visitas` },
    { id: "pets", header: "PERRITOS", body: "{dynamicByType}" }
  ],

  imageModulesData: [{
    id: "stamp_progress",
    mainImage: {
      sourceUri: { uri: "{BASE_URL}/assets/strips/strip-{cardType}-{stamps}@3x.png" }
    }
  }],

  linksModuleData: {
    uris: [{ uri: "{FRONTEND_URL}/loyalty?phone=", description: "Ver mi tarjeta" }]
  }
}
```

### 4.4 Envio de Mensajes

```typescript
sendGoogleWalletMessage(params: { cardId, title, body })
```

**Payload:**
```typescript
{
  message: {
    header: title,
    body: body,
    id: `msg_{timestamp}_{random}`,
    messageType: "TEXT",
    displayInterval: {
      start: { date: nowISO },
      end: { date: nowISO + 24h }
    }
  }
}
```

### 4.5 Generacion de Save URL

```typescript
buildGoogleSaveUrl(input) → string
```

1. Construye JWT firmado con el objeto loyalty
2. Retorna: `https://pay.google.com/gp/v/save/{JWT_FIRMADO}`
3. Cliente abre URL → Google Wallet muestra "Agregar a Wallet"

---

## 5. Tipos de Tarjeta

### 5.1 BASICO (Rosa)
```typescript
{
  badge: "BASICA",
  backgroundColor: "rgb(245, 200, 210)",  // Rosa pastel
  hexBackgroundColor: "#F5C6D3",
  reward: "Servicio Basico Gratis",
  frequency: "1 visita al mes",
  target: "Clientes con 1-2 perritos",
  petsLabel: "1-2"
}
```

### 5.2 DESCUENTO (Turquesa)
```typescript
{
  badge: "50% OFF",
  backgroundColor: "rgb(180, 225, 230)",  // Turquesa pastel
  hexBackgroundColor: "#B4DCDC",
  reward: "50% de Descuento",
  frequency: "1 visita cada 2 meses",
  target: "Pelo corto o semicorto"
}
```

### 5.3 MULTIPERRO (Azul)
```typescript
{
  badge: "MULTIPERRO",
  backgroundColor: "rgb(185, 205, 230)",  // Azul pastel
  hexBackgroundColor: "#B4C8E6",
  reward: "30% + 2 servicios",
  frequency: "Cada 6 semanas",
  target: "Mas de 2 perritos",
  extraServices: ["Limpieza dental", "Tratamiento antipulgas", "Corte de unas", "Limpieza de oidos"]
}
```

---

## 6. Endpoints Publicos

### 6.1 Descargar Pases Iniciales
```
GET  /api/wallet/apple/:cardId          → .pkpass (descarga)
GET  /api/wallet/google/:cardId         → JSON con saveUrl
```

### 6.2 Configuracion Google Wallet
```
GET  /api/wallet/google/diagnostics     → Estado de configuracion
GET  /api/wallet/google/test            → Generar URL de prueba
POST /api/wallet/google/class           → Crear LoyaltyClass
POST /api/wallet/google/class/all       → Crear 3 clases (basico, descuento, multiperro)
POST /api/wallet/google/object/:cardId  → Crear/Actualizar LoyaltyObject
```

### 6.3 Debug
```
GET  /api/wallet/debug/devices/:cardId  → Dispositivos registrados para tarjeta
GET  /api/wallet/debug/all-devices      → Todos los dispositivos
```

---

## 7. APIs de Lealtad

### 7.1 Consultas de Tarjetas
```
GET  /api/loyalty/cards                 → Todas las tarjetas (admin)
GET  /api/loyalty/cards/:cardNumber     → Por numero
GET  /api/loyalty/client/:clientId      → Por cliente
GET  /api/loyalty/phone/:phone          → Por telefono
```

### 7.2 Gestion de Recompensas
```
GET  /api/loyalty/rewards               → Catalogo
POST /api/loyalty/rewards               → Crear recompensa
PUT  /api/loyalty/rewards/:id           → Actualizar
DELETE /api/loyalty/rewards/:id         → Eliminar (soft)
```

### 7.3 Sellos y Canjes
```
POST /api/loyalty/stamps/manual         → Agregar sello manualmente
POST /api/loyalty/redeem                → Canjear recompensa
POST /api/loyalty/appointments/:id/mark-redemption → Marcar cita como canje
```

### 7.4 Cambio de Tipo de Tarjeta
```
PUT  /api/loyalty/cards/:id/type        → Cambiar tipo (basico/descuento/multiperro)
```

---

## 8. Notificaciones Push

### 8.1 Historial
```
GET  /api/notifications                 → Ultimas notificaciones (200)
DELETE /api/notifications/clear         → Limpiar historial
```

### 8.2 Envio
```
POST /api/notifications/push-one
Body: {
  loyaltyCardId: string;
  title?: string;
  message: string;
  sendApple?: boolean;        // default: true
  sendGoogle?: boolean;       // default: true
}
```

---

## 9. Flujo Completo: De Cita a Pase Actualizado

```
1. CITA COMPLETADA
   ├─ Appointment.status = "completed"
   ├─ Se crea LoyaltyStamp
   └─ LoyaltyCard.totalStamps++

2. NOTIFICACION A WALLETS
   ├─ notifyStampAdded(cardId, oldStamps, newStamps)
   │
   ├─ APPLE WALLET:
   │  ├─ updatePassAndNotify()
   │  ├─ Envia APNs a todos los AppleWalletDevice registrados
   │  ├─ iOS pregunta que pases se actualizaron
   │  ├─ iOS descarga nuevo .pkpass via GET /v1/passes/:passTypeId/:serial
   │  └─ Pase se actualiza en Wallet con nuevo numero de sellos
   │
   └─ GOOGLE WALLET:
      ├─ upsertGoogleLoyaltyObject() (actualiza objeto en Google)
      ├─ sendGoogleWalletMessage() (envia mensaje)
      └─ Google Wallet se actualiza en tiempo real

3. PASE MOSTRADO
   ├─ Apple: Muestra strip actualizado con nuevos sellos
   ├─ Google: Muestra balance de sellos + mensaje
   └─ Ambos con barcode QR: cardId
```

---

## 10. Certificados y Configuracion

### 10.1 Certificados Apple

| Archivo | Proposito | Obtencion |
|---------|-----------|-----------|
| `pass.pem` | Certificado de firma del pase | Apple Developer |
| `pass.key` | Llave privada del certificado | Apple Developer |
| `pass.p12` | Certificado + llave (PKCS#12) | Exportado de Keychain |
| `wwdr_rsa.pem` | Certificado intermedio Apple | Descargado de Apple |
| `AppleWWDRCAG4.cer` | CA raiz G4 | Descargado de Apple |
| `AppleWWDRCAG6.cer` | CA raiz G6 | Descargado de Apple |

### 10.2 Credenciales Google

| Variable | Proposito |
|----------|-----------|
| `GOOGLE_ISSUER_ID` | ID unico del emisor en Google Wallet |
| `GOOGLE_SA_EMAIL` | Email del Service Account |
| `GOOGLE_SA_PRIVATE_KEY` | Clave privada RSA (formato PEM) |

---

## 11. Variables de Entorno Requeridas

```bash
# APPLE WALLET
APPLE_TEAM_ID=XXXXXXXXXX                          # 10 chars
APPLE_PASS_TYPE_ID=pass.com.xolobitos.loyalty
APPLE_KEY_ID=XXXXXXXXXX                           # Key ID de APNs
APPLE_AUTH_TOKEN=<64-byte-hex>
APPLE_APNS_KEY_BASE64=LS0tLS1CRUdJTi...
APPLE_CERT_PASSWORD=                              # Si usaste contrasena en p12

# GOOGLE WALLET
GOOGLE_ISSUER_ID=<numeric-issuer-id>
GOOGLE_SA_EMAIL=<service-account-email>
GOOGLE_SA_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
GOOGLE_SA_JSON=./secrets/google-sa.json           # Alternativa a env vars
GOOGLE_LOYALTY_CLASS_ID=                          # Opcional: custom classId

# UBICACION
BUSINESS_LATITUDE=17.0732
BUSINESS_LONGITUDE=-96.7267

# SERVIDOR
SERVER_URL=https://gromming-production.up.railway.app
BASE_URL=https://gromming-production.up.railway.app
FRONTEND_URL=https://xolobitos-production.up.railway.app
```

---

## 12. Flujos de Actualizacion

### 12.1 Cuando se Agrega un Sello
1. POST `/api/loyalty/stamps/manual` o automatico tras cita
2. `LoyaltyStamp` creado → `LoyaltyCard.totalStamps++`
3. `notifyStampAdded(cardId, oldStamps, newStamps)`:
   - Apple: Registra en `AppleWalletUpdate`, envia APNs
   - Google: Actualiza objeto + envia mensaje
   - Ambos: `NotificationLog` creado

### 12.2 Cuando se Canjea
1. POST `/api/loyalty/redeem` con `rewardId`
2. Verifica sellos disponibles
3. Transaccion:
   - `RewardRedemption` creado
   - `LoyaltyCard.stampsRedeemed = totalStamps` (reset)
   - `currentStamps = 0`
4. `notifyStampAdded(cardId, oldStamps, 0)`

### 12.3 Cambio de Tipo de Tarjeta
1. PUT `/api/loyalty/cards/{id}/type` con `cardType`
2. `LoyaltyCard.cardType` actualizado
3. Proximo `.pkpass` generado tendra nuevo:
   - Color de fondo
   - Imagenes de strips
   - Informacion de rewards

---

## 13. Caracteristicas Especiales

### 13.1 Geofencing (Apple + Google)
- Ubicacion configurada via `BUSINESS_LATITUDE` / `BUSINESS_LONGITUDE`
- iOS: Muestra alerta cuando cliente esta a <100m del negocio
- Google: Muestra tarjeta cuando esta cerca

### 13.2 Mensajes Personalizados
- `LoyaltyCard.latestMessage` → se guarda en el pase
- Permite mostrar ofertas, avisos, etc. en tiempo real

### 13.3 Multiples Dispositivos
- Un cliente puede tener el pase en varios iPhones
- Todos reciben notificaciones (APNs a cada uno)
- Google Wallet: usuario sincroniza automaticamente en sus dispositivos

---

## 14. Archivos Clave

| Archivo | Lineas | Funcion |
|---------|--------|---------|
| `server/src/lib/apple-wallet.ts` | 1061 | Generacion .pkpass, APNs, firma |
| `server/src/lib/google-wallet.ts` | 578 | OAuth2, Loyalty Class/Object |
| `server/src/lib/notifications.ts` | 235 | Orquestacion de notificaciones |
| `server/src/routes/wallet.ts` | 539 | Endpoints Apple Web Service |
| `server/src/routes/loyalty.ts` | 632 | Gestion de tarjetas y canjes |
| `server/prisma/schema.prisma` | 536 | Modelos de base de datos |

---

## 15. Resumen de Funciones Principales

### Apple Wallet
- `buildApplePassBuffer()` - Genera .pkpass firmado
- `sendAPNsAlertNotification()` - Envia push notification
- `sendAlertToCardDevices()` - Notifica a multiples dispositivos
- `updatePassAndNotify()` - Registra actualizacion + notifica

### Google Wallet
- `getGoogleWalletAccessToken()` - Obtiene token OAuth2
- `createGoogleLoyaltyClass()` - Crea clase de lealtad
- `upsertGoogleLoyaltyObject()` - Crea/actualiza objeto
- `buildGoogleSaveUrl()` - Genera URL de guardado
- `sendGoogleWalletMessage()` - Envia mensaje al pase

### Notificaciones
- `notifyStampAdded()` - Notifica nuevo sello (ambas plataformas)
- `notifyRewardRedeemed()` - Notifica canje de recompensa

---

Este sistema esta completamente implementado y en produccion con soporte dual para Apple Wallet y Google Wallet.
