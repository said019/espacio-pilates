# 🍎 Apple Wallet - Guía de Implementación

> Documentación completa para implementar tarjetas de lealtad en Apple Wallet con notificaciones push (APNs).

**Proyecto de referencia:** Xolobitos Grooming  
**Fecha:** Enero 2026  
**Stack:** Express + TypeScript + Prisma + PostgreSQL + Railway

---

## 📋 Índice

1. [Requisitos Previos](#1-requisitos-previos)
2. [Configuración en Apple Developer](#2-configuración-en-apple-developer)
3. [Certificados y Archivos Necesarios](#3-certificados-y-archivos-necesarios)
4. [Variables de Entorno](#4-variables-de-entorno)
5. [Estructura de Archivos](#5-estructura-de-archivos)
6. [Base de Datos](#6-base-de-datos)
7. [Código Principal](#7-código-principal)
8. [Endpoints de la API](#8-endpoints-de-la-api)
9. [Troubleshooting](#9-troubleshooting)
10. [Checklist de Deployment](#10-checklist-de-deployment)

---

## 1. Requisitos Previos

### Cuenta de Apple Developer
- **Membresía activa** ($99 USD/año)
- Acceso a [developer.apple.com](https://developer.apple.com)

### Dependencias NPM
```json
{
  "passkit-generator": "^3.5.7",
  "jsonwebtoken": "^9.0.2"
}
```

### Herramientas
- OpenSSL (para manejo de certificados)
- Node.js 18+

---

## 2. Configuración en Apple Developer

### 2.1 Crear Pass Type ID

1. Ir a [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list/passTypeId)
2. Click en **"+"** → **Pass Type IDs**
3. Descripción: `Loyalty Card - Tu Proyecto`
4. Identifier: `pass.com.tudominio.loyalty`
5. **Registrar**

### 2.2 Crear Certificado de Pass

1. Seleccionar el Pass Type ID recién creado
2. Click en **"Create Certificate"**
3. Seguir instrucciones para generar CSR desde Keychain Access:
   - Abrir **Keychain Access** → **Certificate Assistant** → **Request a Certificate from CA**
   - User Email: tu email
   - Common Name: `Pass Type ID: pass.com.tudominio.loyalty`
   - Guardar CSR a disco
4. Subir CSR a Apple Developer
5. Descargar certificado `.cer`

### 2.3 Exportar Certificado y Clave Privada

```bash
# 1. Importar .cer a Keychain Access (doble click)

# 2. Exportar como .p12 desde Keychain:
#    - Click derecho en certificado → Export → .p12
#    - Crear contraseña temporal

# 3. Convertir .p12 a .pem y .key:
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass.pem
openssl pkcs12 -in pass.p12 -nocerts -nodes -out pass.key

# 4. Verificar certificado:
openssl x509 -in pass.pem -noout -subject -dates
# Debe mostrar: subject=UID=pass.com.tudominio.loyalty
```

### 2.4 Obtener WWDR Certificate

```bash
# Descargar WWDR G4 de Apple (formato PEM)
curl -o wwdr.pem https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer

# Si descargaste .cer, convertir a PEM:
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr_rsa.pem
```

### 2.5 Crear APNs Key (para notificaciones)

1. Ir a **Keys** en Apple Developer
2. Click **"+"** → Nombre: `APNs Key`
3. Habilitar **Apple Push Notifications service (APNs)**
4. Descargar archivo `.p8`
5. **¡GUARDAR KEY ID!** (se muestra solo una vez)

---

## 3. Certificados y Archivos Necesarios

### Estructura de Carpeta `wallet-assets/apple.pass/`

```
wallet-assets/
└── apple.pass/
    ├── pass.pem          # Certificado de firma
    ├── pass.key          # Clave privada (sin contraseña)
    ├── wwdr_rsa.pem      # WWDR Certificate de Apple
    ├── icon.png          # 29x29 px
    ├── icon@2x.png       # 58x58 px
    ├── icon@3x.png       # 87x87 px
    ├── logo.png          # 160x50 px
    ├── logo@2x.png       # 320x100 px
    ├── logo@3x.png       # 480x150 px
    ├── strip.png         # 375x123 px (opcional)
    ├── strip@2x.png      # 750x246 px
    └── strip@3x.png      # 1125x369 px
```

### Requisitos de Imágenes

| Imagen | 1x | 2x | 3x | Notas |
|--------|-----|-----|-----|-------|
| icon | 29x29 | 58x58 | 87x87 | Requerido |
| logo | 160x50 | 320x100 | 480x150 | Requerido |
| strip | 375x123 | 750x246 | 1125x369 | Opcional, header visual |

**⚠️ IMPORTANTE:** Las imágenes DEBEN ser PNG válidos. Si usas base64 o imágenes corruptas, el pase fallará silenciosamente.

---

## 4. Variables de Entorno

### Variables Requeridas en Railway/Producción

```bash
# === IDENTIFICADORES ===
APPLE_TEAM_ID=UC97J4YGP3              # Tu Team ID de Apple Developer
APPLE_PASS_TYPE_ID=pass.com.tudominio.loyalty  # DEBE coincidir con pass.pem

# === AUTH TOKEN (para Web Service API) ===
APPLE_AUTH_TOKEN=tu-token-seguro-aleatorio-aqui

# === APNs (Notificaciones Push) ===
APPLE_KEY_ID=ABC123DEFG               # Key ID del .p8
APPLE_APNS_KEY_BASE64=LS0tLS1CRUd...  # Contenido del .p8 en Base64

# === OPCIONAL ===
APPLE_ORG_NAME=Tu Empresa             # Nombre de la organización
SERVER_URL=https://tu-servidor.up.railway.app  # URL del servidor

# === UBICACIÓN (opcional) ===
BUSINESS_LATITUDE=20.123456
BUSINESS_LONGITUDE=-100.123456

# === CONFIGURACIÓN DE LEALTAD ===
LOYALTY_STAMPS_FOR_REWARD=6           # Número de sellos para recompensa (default: 6)
```

### Generar APPLE_APNS_KEY_BASE64

```bash
# Desde el archivo .p8 descargado de Apple
base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'

# Copiar el resultado completo a APPLE_APNS_KEY_BASE64
```

### Verificar que Pass Type ID coincide con Certificado

```bash
# Ver el Pass Type ID del certificado
openssl x509 -in wallet-assets/apple.pass/pass.pem -noout -subject

# Resultado esperado:
# subject=UID=pass.com.tudominio.loyalty, CN=Pass Type ID: pass.com.tudominio.loyalty, OU=TU_TEAM_ID, O=Tu Empresa, C=US
```

**⚠️ CRÍTICO:** El `APPLE_PASS_TYPE_ID` en Railway DEBE coincidir exactamente con el UID del certificado.

---

## 5. Estructura de Archivos

```
server/
├── src/
│   ├── index.ts                    # Servidor Express principal
│   ├── routes/
│   │   └── loyalty.ts              # Rutas de lealtad + Apple Wallet
│   └── lib/
│       ├── apple-wallet.ts         # Lógica de Apple Wallet + APNs
│       └── prisma.ts               # Cliente Prisma
├── wallet-assets/
│   └── apple.pass/                 # Certificados e imágenes
├── prisma/
│   └── schema.prisma               # Esquema de base de datos
└── package.json
```

---

## 6. Base de Datos

### Tablas Requeridas (PostgreSQL)

```sql
-- Tarjetas de lealtad
CREATE TABLE loyalty_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number VARCHAR(20) UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  total_stamps INT DEFAULT 0,
  stamps_redeemed INT DEFAULT 0,
  latest_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Dispositivos registrados en Apple Wallet
CREATE TABLE apple_wallet_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(255) NOT NULL,
  push_token TEXT NOT NULL,
  pass_type_id VARCHAR(255) NOT NULL,
  loyalty_card_id UUID NOT NULL REFERENCES loyalty_cards(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(device_id, pass_type_id, loyalty_card_id)
);

-- Log de actualizaciones
CREATE TABLE apple_wallet_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loyalty_card_id UUID NOT NULL REFERENCES loyalty_cards(id),
  stamps_old INT NOT NULL,
  stamps_new INT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Log de notificaciones
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  target VARCHAR(255),
  message TEXT,
  status VARCHAR(50),
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Schema Prisma

```prisma
model LoyaltyCard {
  id             String   @id @default(uuid())
  cardNumber     String   @unique @map("card_number")
  clientId       String   @map("client_id")
  totalStamps    Int      @default(0) @map("total_stamps")
  stampsRedeemed Int      @default(0) @map("stamps_redeemed")
  latestMessage  String?  @map("latest_message")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  client              Client              @relation(fields: [clientId], references: [id])
  stamps              Stamp[]
  appleWalletDevices  AppleWalletDevice[]
  appleWalletUpdates  AppleWalletUpdate[]

  @@map("loyalty_cards")
}

model AppleWalletDevice {
  id            String   @id @default(uuid())
  deviceId      String   @map("device_id")
  pushToken     String   @map("push_token")
  passTypeId    String   @map("pass_type_id")
  loyaltyCardId String   @map("loyalty_card_id")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  loyaltyCard LoyaltyCard @relation(fields: [loyaltyCardId], references: [id])

  @@unique([deviceId, passTypeId, loyaltyCardId])
  @@map("apple_wallet_devices")
}

model AppleWalletUpdate {
  id            String   @id @default(uuid())
  loyaltyCardId String   @map("loyalty_card_id")
  stampsOld     Int      @map("stamps_old")
  stampsNew     Int      @map("stamps_new")
  updatedAt     DateTime @default(now()) @map("updated_at")

  loyaltyCard LoyaltyCard @relation(fields: [loyaltyCardId], references: [id])

  @@map("apple_wallet_updates")
}
```

---

## 7. Código Principal

### 7.1 Archivo `apple-wallet.ts`

El archivo principal contiene:

1. **Configuración de APNs** - Decodifica credenciales y genera JWT
2. **Helpers de BD** - CRUD para dispositivos y tarjetas
3. **Generación de .pkpass** - Crea el archivo del pase
4. **Notificaciones** - Envía push notifications vía APNs

#### Función Principal: `buildApplePassBuffer`

```typescript
export async function buildApplePassBuffer(loyaltyCard: any): Promise<Buffer> {
  // 1. Leer certificados
  const signerCert = readPemFile(certPath, 'APPLE_PASS_CERT');
  const signerKey = fs.readFileSync(keyPath, 'utf8');
  const wwdr = readPemFile(wwdrPath, 'APPLE_WWDR');

  // 2. Crear modelo temporal con pass.json dinámico
  const modelDir = buildTempModelDir({
    orgName: ORG_NAME,
    passTypeId: PASS_TYPE_ID,
    teamId: TEAM_ID,
    cardId: loyaltyCard.id,
    clientName: loyaltyCard.client?.name,
    currentStamps,
    totalStamps,
    maxStamps: MAX_STAMPS
  });

  // 3. Leer archivos como buffers
  const buffers: { [key: string]: Buffer } = {};
  for (const file of fs.readdirSync(modelDir)) {
    buffers[file] = fs.readFileSync(path.join(modelDir, file));
  }

  // 4. Crear PKPass
  const pass = new PKPass(
    buffers,
    { wwdr, signerCert, signerKey },
    {
      serialNumber: loyaltyCard.id,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      // ... más props
    }
  );

  // 5. Si el tipo no se detecta, establecerlo manualmente
  if (!pass.type) {
    pass.type = 'storeCard';
    // Agregar fields...
  }

  // 6. Exportar buffer
  return pass.getAsBuffer();
}
```

#### Función de Notificaciones: `sendAPNsAlertNotification`

```typescript
export async function sendAPNsAlertNotification(
  pushToken: string,
  title: string,
  body: string
): Promise<boolean> {
  const token = generateAPNsToken(); // JWT con ES256
  
  const apnsPayload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1
    }
  };

  // Conexión HTTP/2 a api.push.apple.com
  const client = http2.connect('https://api.push.apple.com:443');
  
  const req = client.request({
    ':method': 'POST',
    ':path': `/3/device/${pushToken}`,
    'authorization': `bearer ${token}`,
    'apns-topic': APPLE_PASS_TYPE_ID,
    'apns-push-type': 'alert'
  });
  
  // ... manejar respuesta
}
```

### 7.2 pass.json Dinámico

El `pass.json` se genera dinámicamente para cada tarjeta:

```typescript
const passJson = {
  formatVersion: 1,
  passTypeIdentifier: passTypeId,    // DEBE coincidir con certificado
  teamIdentifier: teamId,
  serialNumber: cardId,              // Único por tarjeta
  
  webServiceURL: 'https://tu-servidor.com',
  authenticationToken: AUTH_TOKEN,
  
  organizationName: orgName,
  description: 'Tarjeta de Lealtad',
  logoText: 'TU MARCA',

  storeCard: {
    headerFields: [/* ... */],
    primaryFields: [/* ... */],
    secondaryFields: [/* ... */],
    auxiliaryFields: [/* ... */],
    backFields: [/* ... */]
  },

  backgroundColor: 'rgb(30, 58, 138)',
  foregroundColor: 'rgb(255, 255, 255)',
  labelColor: 'rgb(148, 163, 184)',

  barcodes: [{
    format: 'PKBarcodeFormatQR',
    message: cardId,
    messageEncoding: 'iso-8859-1'
  }]
};
```

---

## 8. Endpoints de la API

### Endpoints Requeridos por Apple

Apple Wallet espera estos endpoints exactos:

```typescript
// ===== Descargar .pkpass =====
GET /api/loyalty/:phone/apple-wallet
// Genera y devuelve el archivo .pkpass

// ===== Web Service API (requerido por Apple) =====

// 1. Registrar dispositivo
POST /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
// Body: { pushToken: "..." }

// 2. Desregistrar dispositivo
DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber

// 3. Obtener serials actualizados
GET /v1/devices/:deviceId/registrations/:passTypeId
// Query: ?passesUpdatedSince=timestamp

// 4. Obtener pase actualizado
GET /v1/passes/:passTypeId/:serialNumber
// Devuelve .pkpass actualizado

// 5. Log de errores (opcional)
POST /v1/log
```

### Implementación de Rutas

```typescript
// loyalty.ts
const router = express.Router();

// Descargar pase inicial
router.get('/:phone/apple-wallet', async (req, res) => {
  const card = await getLoyaltyCardByPhone(req.params.phone);
  const buffer = await buildApplePassBuffer(card);
  
  res.set({
    'Content-Type': 'application/vnd.apple.pkpass',
    'Content-Disposition': `attachment; filename="${card.cardNumber}.pkpass"`
  });
  res.send(buffer);
});

// Registro de dispositivo
router.post('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', 
  async (req, res) => {
    if (!checkAuth(req, res)) return;
    
    await registerWalletDevice(
      req.params.deviceId,
      req.body.pushToken,
      req.params.passTypeId,
      req.params.serialNumber
    );
    
    res.status(201).send();
  }
);

// ... más endpoints
```

---

## 9. Troubleshooting

### Error: "type is missing"

**Problema:** `passkit-generator` no detecta el tipo de pase automáticamente.

**Solución:**
```typescript
if (!pass.type) {
  pass.type = 'storeCard';
  // Re-agregar los fields manualmente
  if (storeCardData.primaryFields) pass.primaryFields.push(...storeCardData.primaryFields);
  // ...
}
```

### Error: "latitude must be number"

**Problema:** Se pasan ubicaciones inválidas.

**Solución:**
```typescript
// Solo agregar locations si son válidas
const lat = parseFloat(process.env.BUSINESS_LATITUDE || '');
const lng = parseFloat(process.env.BUSINESS_LONGITUDE || '');

if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
  passJson.locations = [{ latitude: lat, longitude: lng }];
}
```

### Error: "Invalid signature" / Pase no se instala

**Causas comunes:**
1. `APPLE_PASS_TYPE_ID` no coincide con el certificado
2. Certificado expirado
3. WWDR incorrecto

**Diagnóstico:**
```bash
# Ver Pass Type ID del certificado
openssl x509 -in pass.pem -noout -subject

# Ver fecha de expiración
openssl x509 -in pass.pem -noout -dates

# El UID debe coincidir EXACTAMENTE con APPLE_PASS_TYPE_ID
```

### Error 500 en `/api/loyalty/phone/XXX`

**Causas comunes:**
1. Tablas de BD no existen
2. Certificados no encontrados
3. Variables de entorno faltantes

**Diagnóstico:**
```bash
# Ver logs en Railway
railway logs

# Verificar que los archivos existen
ls -la wallet-assets/apple.pass/
```

### Imágenes no válidas

**Síntomas:** El pase se genera pero no se puede agregar a Wallet.

**Solución:** Asegurar que las imágenes son PNG válidos:
```python
from PIL import Image

# Crear imagen válida
img = Image.new('RGBA', (58, 58), (30, 58, 138, 255))
img.save('icon@2x.png', 'PNG')
```

### APNs no envía notificaciones

**Verificar:**
1. `APPLE_KEY_ID` correcto
2. `APPLE_APNS_KEY_BASE64` es el contenido completo del .p8 en base64
3. El topic (`apns-topic`) es el Pass Type ID

**Códigos de error comunes:**
- `400`: Payload inválido
- `403`: Certificado/topic incorrecto
- `410`: Token de dispositivo inválido (eliminar registro)

---

## 10. Checklist de Deployment

### Antes de deployar:

- [ ] Certificado `pass.pem` válido y no expirado
- [ ] `pass.key` sin contraseña
- [ ] `wwdr_rsa.pem` descargado de Apple (G4)
- [ ] Imágenes PNG válidas (icon, logo)
- [ ] `APPLE_TEAM_ID` configurado
- [ ] `APPLE_PASS_TYPE_ID` coincide con certificado
- [ ] `APPLE_AUTH_TOKEN` generado (token aleatorio seguro)
- [ ] `APPLE_KEY_ID` del archivo .p8
- [ ] `APPLE_APNS_KEY_BASE64` con contenido del .p8
- [ ] Tablas de BD creadas
- [ ] `SERVER_URL` apuntando al servidor de producción

### Verificación post-deploy:

```bash
# 1. Probar endpoint de descarga
curl -I https://tu-servidor.com/api/loyalty/PHONE/apple-wallet

# 2. Verificar que devuelve .pkpass
# Content-Type: application/vnd.apple.pkpass

# 3. Descargar y probar en iPhone
# Abrir el archivo .pkpass debe mostrar "Agregar a Wallet"
```

---

## 📚 Referencias

- [Apple PassKit Documentation](https://developer.apple.com/documentation/passkit)
- [Pass Design Guide](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/)
- [APNs HTTP/2](https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server/sending_notification_requests_to_apns)
- [passkit-generator npm](https://www.npmjs.com/package/passkit-generator)

---

## 🔄 Migrar a Nuevo Proyecto

Para usar esta implementación en otro proyecto:

1. **Copiar archivos:**
   - `server/src/lib/apple-wallet.ts`
   - `server/wallet-assets/apple.pass/` (estructura)

2. **Generar nuevos certificados** en Apple Developer con nuevo Pass Type ID

3. **Configurar variables de entorno** en el nuevo servidor

4. **Crear tablas de BD** (ver sección 6)

5. **Adaptar rutas** según la estructura del nuevo proyecto

6. **Cambiar branding:**
   - Colores en `backgroundColor`, `foregroundColor`, `labelColor`
   - Textos en `logoText`, `organizationName`, `description`
   - Imágenes en `wallet-assets/apple.pass/`

---

*Documentación generada para el proyecto Xolobitos Grooming - Enero 2026*
