# Guía de Integración: Evolution API (WhatsApp Baileys)

Esta guía documenta cómo integrar Evolution API como alternativa gratuita a Twilio para enviar mensajes de WhatsApp usando el número del negocio.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (React)              │     BACKEND (Express)          │
│                                │                                 │
│  WhatsAppManager.tsx           │    whatsapp.ts (Facade)        │
│  - Muestra QR code             │    - Switch WHATSAPP_PROVIDER  │
│  - Estado de conexión          │    - evolution / twilio        │
│  - Botón desvincular           │                                 │
└────────────────────────────────┴─────────────────────────────────┘
                                          │
                                          ▼ HTTP REST
┌─────────────────────────────────────────────────────────────────┐
│              RAILWAY: Evolution API (Puerto 8080)               │
│                                                                 │
│   Baileys ──► Evolution API ──► Webhook al backend             │
│   (Core)      (REST Server)     POST /api/webhook/evolution    │
│                                                                 │
│   Base de datos: PostgreSQL (persistencia de sesiones)         │
└─────────────────────────────────────────────────────────────────┘
```

## Ventajas sobre Twilio

| Característica | Twilio | Evolution API |
|----------------|--------|---------------|
| Costo | ~$0.005-0.05 por mensaje | Gratis |
| Número | Número de Twilio | Tu número personal/negocio |
| Templates | Requiere aprobación de Meta | No necesita |
| Botones | Limitado a templates | Botones nativos de WhatsApp |
| Sesión | Siempre conectado | Requiere QR inicial |

## Paso 1: Desplegar Evolution API en Railway

### 1.1 Clonar el repositorio oficial

```bash
# Opción A: Clonar desde GitHub oficial
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api

# Opción B: Usar imagen Docker (NO RECOMENDADO - versión 2.2.3 tiene bugs)
# La imagen atendai/evolution-api:latest está desactualizada
```

### 1.2 Crear archivo `railway.json`

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 1.3 Variables de entorno en Railway (Evolution API)

```env
# Base de datos (crear servicio PostgreSQL en Railway primero)
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://user:pass@host:port/dbname
DATABASE_CONNECTION_CLIENT_NAME=evolution

# Autenticación (SIN caracteres especiales como ! @ # $)
AUTHENTICATION_API_KEY=tu-api-key-seguro-2026
AUTHENTICATION_TYPE=apikey

# Webhook (apunta a tu backend)
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=https://tu-backend.railway.app/api/webhook/evolution
WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false

# Eventos de webhook importantes
WEBHOOK_EVENTS_QRCODE_UPDATED=true
WEBHOOK_EVENTS_CONNECTION_UPDATE=true
WEBHOOK_EVENTS_MESSAGES_UPSERT=true
WEBHOOK_EVENTS_SEND_MESSAGE=true

# QR Code
QRCODE_LIMIT=30

# Desactivar servicios no usados
CACHE_REDIS_ENABLED=false
RABBITMQ_ENABLED=false
SQS_ENABLED=false
WEBSOCKET_ENABLED=false
```

### 1.4 Subir a Railway

```bash
# Inicializar git si no existe
git init
git add .
git commit -m "Evolution API configurado"

# Crear repo en GitHub
gh repo create mi-evolution-api --private --source=. --push

# En Railway: conectar el repo de GitHub al servicio
```

## Paso 2: Configurar Backend (Express)

### 2.1 Variables de entorno del backend

```env
# Proveedor de WhatsApp
WHATSAPP_PROVIDER=evolution

# Evolution API
EVOLUTION_API_URL=https://tu-evolution-api.railway.app
EVOLUTION_API_KEY=tu-api-key-seguro-2026
EVOLUTION_INSTANCE_NAME=mi-instancia
```

### 2.2 Cliente Evolution API (`server/src/lib/whatsapp-evolution.ts`)

```typescript
import axios, { AxiosInstance } from 'axios';

export class EvolutionAPIClient {
  private client: AxiosInstance;
  private instanceName: string;

  constructor() {
    const baseURL = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    this.instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'default';

    if (!baseURL || !apiKey) {
      throw new Error('EVOLUTION_API_URL y EVOLUTION_API_KEY son requeridos');
    }

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      timeout: 30000,
    });
  }

  // Crear instancia
  async createInstance(): Promise<any> {
    const response = await this.client.post('/instance/create', {
      instanceName: this.instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
    return response.data;
  }

  // Conectar y obtener QR
  async connectInstance(): Promise<any> {
    const response = await this.client.get(`/instance/connect/${this.instanceName}`);
    return response.data;
  }

  // Obtener estado
  async getStatus(): Promise<{ connected: boolean; qrCode?: string; state: string }> {
    try {
      const response = await this.client.get('/instance/fetchInstances');
      const instance = response.data.find((i: any) => i.name === this.instanceName);

      if (!instance) {
        return { connected: false, state: 'close' };
      }

      return {
        connected: instance.connectionStatus === 'open',
        state: instance.connectionStatus,
      };
    } catch (error) {
      return { connected: false, state: 'error' };
    }
  }

  // Enviar mensaje de texto
  async sendText(to: string, message: string): Promise<any> {
    const phone = this.formatPhone(to);
    const response = await this.client.post(`/message/sendText/${this.instanceName}`, {
      number: phone,
      text: message,
    });
    return response.data;
  }

  // Enviar mensaje con botones
  async sendButtons(to: string, message: string, buttons: Array<{ id: string; title: string }>): Promise<any> {
    const phone = this.formatPhone(to);
    const response = await this.client.post(`/message/sendButtons/${this.instanceName}`, {
      number: phone,
      title: 'Opciones',
      description: message,
      buttons: buttons.map(b => ({
        type: 'reply',
        buttonId: b.id,
        buttonText: { displayText: b.title },
      })),
    });
    return response.data;
  }

  // Cerrar sesión
  async logout(): Promise<any> {
    const response = await this.client.delete(`/instance/logout/${this.instanceName}`);
    return response.data;
  }

  // Eliminar instancia
  async deleteInstance(): Promise<any> {
    const response = await this.client.delete(`/instance/delete/${this.instanceName}`);
    return response.data;
  }

  // Formatear número mexicano
  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('52') && cleaned.length === 12) {
      return cleaned;
    }
    if (cleaned.length === 10) {
      return `52${cleaned}`;
    }
    return cleaned;
  }
}

// Singleton
let client: EvolutionAPIClient | null = null;

export function getEvolutionClient(): EvolutionAPIClient {
  if (!client) {
    client = new EvolutionAPIClient();
  }
  return client;
}
```

### 2.3 Facade de WhatsApp (`server/src/lib/whatsapp.ts`)

```typescript
import { getEvolutionClient } from './whatsapp-evolution';
// import { sendTwilioMessage } from './whatsapp-twilio'; // Legacy

const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || 'twilio';

export async function sendWhatsAppMessage(to: string, message: string) {
  if (WHATSAPP_PROVIDER === 'evolution') {
    const client = getEvolutionClient();
    return client.sendText(to, message);
  } else {
    // Código Twilio legacy
    // return sendTwilioMessage(to, message);
  }
}

export async function sendWhatsAppButtons(
  to: string,
  message: string,
  buttons: Array<{ id: string; title: string }>
) {
  if (WHATSAPP_PROVIDER === 'evolution') {
    const client = getEvolutionClient();
    return client.sendButtons(to, message, buttons);
  }
  // Twilio no soporta botones nativos fácilmente
}
```

### 2.4 Rutas de administración (`server/src/routes/evolution.ts`)

```typescript
import { Router, Response } from 'express';
import { getEvolutionClient } from '../lib/whatsapp-evolution';

const router = Router();

// GET /api/evolution/status
router.get('/status', async (req, res) => {
  try {
    const client = getEvolutionClient();
    const status = await client.getStatus();
    res.json({
      provider: 'evolution',
      connected: status.connected,
      state: status.state,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo estado' });
  }
});

// POST /api/evolution/connect
router.post('/connect', async (req, res) => {
  try {
    const client = getEvolutionClient();

    // Intentar crear instancia si no existe
    try {
      await client.createInstance();
    } catch (e) {
      // Ya existe, continuar
    }

    const result = await client.connectInstance();
    res.json({
      success: true,
      qrCode: result.base64 || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error conectando' });
  }
});

// POST /api/evolution/logout
router.post('/logout', async (req, res) => {
  try {
    const client = getEvolutionClient();
    await client.logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error desvinculando' });
  }
});

// POST /api/evolution/test
router.post('/test', async (req, res) => {
  const { phone } = req.body;
  try {
    const client = getEvolutionClient();
    await client.sendText(phone, 'Mensaje de prueba desde Evolution API');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error enviando mensaje' });
  }
});

export default router;
```

### 2.5 Webhook para recibir mensajes (`server/src/routes/webhook-evolution.ts`)

```typescript
import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  const { event, data, instance } = req.body;

  console.log(`[Webhook Evolution] Evento: ${event}`);

  switch (event) {
    case 'qrcode.updated':
      // Guardar QR code para mostrar en frontend
      // updateEvolutionQRCode(data.qrcode?.base64);
      break;

    case 'connection.update':
      // Actualizar estado de conexión
      // updateEvolutionConnectionState(data.state);
      break;

    case 'messages.upsert':
      // Mensaje recibido
      const message = data.messages?.[0];
      if (message && !message.key.fromMe) {
        const from = message.key.remoteJid?.replace('@s.whatsapp.net', '');
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text || '';

        console.log(`[Webhook] Mensaje de ${from}: ${text}`);

        // Procesar respuestas de botones
        const buttonResponse = message.message?.buttonsResponseMessage;
        if (buttonResponse) {
          const buttonId = buttonResponse.selectedButtonId;
          // handleButtonResponse(from, buttonId);
        }
      }
      break;
  }

  res.status(200).json({ received: true });
});

export default router;
```

## Paso 3: Frontend - Componente WhatsAppManager

```tsx
// src/components/admin/WhatsAppManager.tsx
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const API_URL = import.meta.env.VITE_API_URL;

export const WhatsAppManager = () => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/evolution/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch(`${API_URL}/evolution/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.qrCode) {
        setStatus({ ...status, qrCode: data.qrCode });
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleLogout = async () => {
    if (!confirm('¿Desvincular WhatsApp?')) return;
    try {
      await fetch(`${API_URL}/evolution/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      fetchStatus();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Polling cada 5 segundos si hay QR visible
    const interval = setInterval(() => {
      if (status?.qrCode && !status?.connected) {
        fetchStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [status?.qrCode]);

  if (loading) return <div>Cargando...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp Business</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Estado */}
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{status?.connected ? 'Conectado' : 'Desconectado'}</span>
        </div>

        {/* QR Code */}
        {status?.qrCode && !status?.connected && (
          <div className="p-4 bg-white rounded-lg">
            <img src={status.qrCode} alt="QR Code" className="mx-auto" />
            <p className="text-center text-sm mt-2">
              Escanea con WhatsApp
            </p>
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-2">
          {!status?.connected && (
            <Button onClick={handleConnect}>
              Generar QR para vincular
            </Button>
          )}
          {status?.connected && (
            <Button variant="destructive" onClick={handleLogout}>
              Desvincular
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
```

## Troubleshooting

### Error: "Unauthorized" al llamar a la API

**Causa:** El API key tiene caracteres especiales (`!`, `@`, `#`, etc.)

**Solución:** Usar un API key alfanumérico simple:
```env
# MAL
AUTHENTICATION_API_KEY=xoL0b!t0s-2026

# BIEN
AUTHENTICATION_API_KEY=xoL0b1t0s2026
```

### Error: QR no se genera (versión 2.2.3)

**Causa:** La imagen Docker `atendai/evolution-api:latest` está en versión 2.2.3 que tiene un bug conocido.

**Solución:** Desplegar desde el repositorio oficial de GitHub que tiene versión 2.3.7+

### Error: "Instance already exists"

**Causa:** La instancia ya fue creada previamente.

**Solución:** Llamar a `/instance/connect/{instanceName}` en lugar de `/instance/create`

### Webhook no recibe eventos

**Verificar:**
1. `WEBHOOK_GLOBAL_ENABLED=true`
2. `WEBHOOK_GLOBAL_URL` apunta a URL pública accesible
3. Los eventos específicos están habilitados (`WEBHOOK_EVENTS_*=true`)

## Endpoints de Evolution API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Health check (versión) |
| POST | `/instance/create` | Crear instancia |
| GET | `/instance/connect/{name}` | Conectar y obtener QR |
| GET | `/instance/fetchInstances` | Listar instancias |
| DELETE | `/instance/logout/{name}` | Cerrar sesión |
| DELETE | `/instance/delete/{name}` | Eliminar instancia |
| POST | `/message/sendText/{name}` | Enviar texto |
| POST | `/message/sendButtons/{name}` | Enviar botones |
| POST | `/message/sendMedia/{name}` | Enviar imagen/video |
| POST | `/message/sendPoll/{name}` | Enviar encuesta (Poll) |

---

## Polls (Encuestas) - Alternativa a Botones

Los **botones interactivos no funcionan en iPhones**. La solución es usar **Polls** que funcionan en iOS y Android.

### Enviar un Poll

```bash
curl -X POST "https://evolution-api-production-c1cb.up.railway.app/message/sendPoll/xolobitos" \
  -H "apikey: xoL0b1t0s-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5214271234567",
    "pollMessage": {
      "name": "📅 Cita mañana 10:00 AM\n¿Qué deseas hacer?",
      "selectableCount": 1,
      "values": [
        "✅ Confirmar Asistencia",
        "🔄 Solicitar Cambio de Horario",
        "❌ Cancelar Cita"
      ]
    }
  }'
```

### Webhook: Procesar respuestas de Polls

Cuando un usuario responde a un Poll, Evolution API envía un webhook con el evento `messages.upsert` y un `pollUpdateMessage`.

**Archivo:** `server/src/routes/webhook-evolution.ts`

```typescript
// Detectar respuesta de Poll en el mensaje entrante
if (message?.pollUpdateMessage) {
  console.log(`[Evolution] Respuesta de Poll recibida`);
  await handlePollResponse(phone, message.pollUpdateMessage, profileName, payload);
}

// Función para procesar la respuesta
async function handlePollResponse(
  phone: string,
  pollUpdate: any,
  profileName: string,
  fullPayload: any
): Promise<void> {
  let selectedOption: string | null = null;

  // Evolution envía la opción en diferentes formatos según versión
  // Formato 1: votes array
  if (fullPayload?.data?.pollUpdate?.votes) {
    const votes = fullPayload.data.pollUpdate.votes;
    if (Array.isArray(votes) && votes.length > 0) {
      selectedOption = votes[0]?.optionName || votes[0]?.name;
    }
  }

  // Formato 2: body con texto de opción
  if (!selectedOption && fullPayload?.data?.body) {
    selectedOption = fullPayload.data.body;
  }

  console.log(`[Evolution] Poll - Opción detectada: "${selectedOption}"`);

  // Mapear opción a acción
  const optionLower = selectedOption?.toLowerCase() || '';

  if (optionLower.includes('confirmar')) {
    // Lógica para confirmar cita
  } else if (optionLower.includes('cambio') || optionLower.includes('reprogramar')) {
    // Lógica para reprogramar
  } else if (optionLower.includes('cancelar')) {
    // Lógica para cancelar
  }
}
```

### Ejemplo de payload de Poll recibido

```json
{
  "event": "messages.upsert",
  "instance": "xolobitos",
  "data": {
    "key": {
      "remoteJid": "5214271234567@s.whatsapp.net",
      "fromMe": false,
      "id": "ABC123"
    },
    "pushName": "Cliente",
    "message": {
      "pollUpdateMessage": {
        "pollCreationMessageKey": { "id": "POLL123" },
        "vote": {
          "selectedOptions": ["hash-de-opcion"]
        }
      }
    },
    "pollUpdate": {
      "votes": [
        { "optionName": "✅ Confirmar Asistencia" }
      ]
    }
  }
}
```

### Comparación: Botones vs Polls

| Característica | Botones | Polls |
|---------------|---------|-------|
| iOS (iPhone) | ❌ No funciona | ✅ Funciona |
| Android | ✅ Funciona | ✅ Funciona |
| Máximo opciones | 3 | 12 |
| Selección múltiple | No | Sí (configurable) |
| Uso recomendado | Evitar | ✅ Preferido |

---

## Configuración de Producción

### Variables Railway - Evolution API
```env
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://...
AUTHENTICATION_API_KEY=tu-key-seguro
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=https://tu-backend/api/webhook/evolution
WEBHOOK_EVENTS_QRCODE_UPDATED=true
WEBHOOK_EVENTS_CONNECTION_UPDATE=true
WEBHOOK_EVENTS_MESSAGES_UPSERT=true
```

### Variables Railway - Backend
```env
WHATSAPP_PROVIDER=evolution
EVOLUTION_API_URL=https://tu-evolution-api.railway.app
EVOLUTION_API_KEY=tu-key-seguro
EVOLUTION_INSTANCE_NAME=produccion
```

## Rollback a Twilio

Si necesitas volver a Twilio:

```env
WHATSAPP_PROVIDER=twilio
```

El código de Twilio sigue funcionando, solo cambia la variable de entorno.

---

## Agregar Nuevo Proyecto (Reutilizar Evolution API existente)

Si ya tienes un servicio Evolution API desplegado, puedes reutilizarlo para múltiples proyectos. Solo necesitas crear una **instancia diferente** para cada negocio/WhatsApp.

### Arquitectura Multi-Proyecto

```
┌─────────────────────────────────────────────────────────────────┐
│          EVOLUTION API COMPARTIDA (Railway)                     │
│          evolution-api-production-c1cb.up.railway.app           │
│                                                                 │
│   Instancia: xolobitos       ──► WhatsApp Grooming             │
│   Instancia: restaurante-xyz ──► WhatsApp Restaurante          │
│   Instancia: tienda-abc      ──► WhatsApp Tienda               │
│   Instancia: clinica-123     ──► WhatsApp Clínica              │
└─────────────────────────────────────────────────────────────────┘
         │                │               │              │
         ▼                ▼               ▼              ▼
    Backend 1        Backend 2       Backend 3      Backend 4
    (Grooming)      (Restaurante)    (Tienda)       (Clínica)
```

### Paso 1: Crear instancia para el nuevo proyecto

```bash
# Crear nueva instancia con webhook específico para el nuevo backend
curl -X POST "https://evolution-api-production-c1cb.up.railway.app/instance/create" \
  -H "apikey: xoL0b1t0s-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "nombre-nuevo-proyecto",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS",
    "webhook": {
      "url": "https://NUEVO-BACKEND.railway.app/api/webhook/evolution",
      "enabled": true,
      "webhookByEvents": false,
      "events": [
        "QRCODE_UPDATED",
        "CONNECTION_UPDATE",
        "MESSAGES_UPSERT",
        "SEND_MESSAGE"
      ]
    }
  }'
```

### Paso 2: Configurar el nuevo backend

En el `.env` del nuevo proyecto backend:

```env
# Proveedor de WhatsApp
WHATSAPP_PROVIDER=evolution

# Misma URL de Evolution API (la que ya tienes)
EVOLUTION_API_URL=https://evolution-api-production-c1cb.up.railway.app

# Misma API Key
EVOLUTION_API_KEY=xoL0b1t0s-2026

# DIFERENTE nombre de instancia (único por proyecto)
EVOLUTION_INSTANCE_NAME=nombre-nuevo-proyecto
```

### Paso 3: Copiar archivos necesarios al nuevo proyecto

Copia estos archivos del proyecto actual al nuevo:

```
server/src/lib/
├── whatsapp-evolution.ts    # Cliente Evolution API
├── whatsapp-types.ts        # Tipos TypeScript
├── whatsapp.ts              # Facade principal
└── evolution-state.ts       # Cache de estado QR

server/src/routes/
├── evolution.ts             # Rutas admin (/status, /connect, /logout)
└── webhook-evolution.ts     # Webhook para recibir mensajes

src/components/admin/
└── WhatsAppManager.tsx      # Componente React para admin
```

### Paso 4: Registrar rutas en el nuevo backend

En `server/src/index.ts`:

```typescript
import evolutionRoutes from './routes/evolution';
import webhookEvolutionRoutes from './routes/webhook-evolution';

// Rutas de Evolution API (admin)
app.use('/api/evolution', evolutionRoutes);

// Webhook de Evolution (público, sin auth)
app.use('/api/webhook/evolution', webhookEvolutionRoutes);
```

### Paso 5: Generar QR y vincular WhatsApp

1. Ve al panel admin del nuevo proyecto
2. Sección WhatsApp → "Generar QR para vincular"
3. Escanea con el teléfono del nuevo negocio
4. ¡Listo! El nuevo WhatsApp está conectado

### Verificar instancias existentes

```bash
# Ver todas las instancias en tu Evolution API
curl -X GET "https://evolution-api-production-c1cb.up.railway.app/instance/fetchInstances" \
  -H "apikey: xoL0b1t0s-2026"
```

Respuesta:
```json
[
  {
    "name": "xolobitos",
    "connectionStatus": "open",
    "number": "5214272995796"
  },
  {
    "name": "nombre-nuevo-proyecto",
    "connectionStatus": "close",
    "number": null
  }
]
```

### Eliminar instancia de un proyecto

```bash
# Si necesitas eliminar una instancia
curl -X DELETE "https://evolution-api-production-c1cb.up.railway.app/instance/delete/nombre-instancia" \
  -H "apikey: xoL0b1t0s-2026"
```

### Resumen: Qué necesitas para cada nuevo proyecto

| Componente | ¿Nuevo? | Descripción |
|------------|---------|-------------|
| Evolution API (Railway) | NO | Reutilizar el existente |
| PostgreSQL (Railway) | NO | Compartido con Evolution API |
| Instancia en Evolution | SÍ | Nombre único por proyecto |
| Backend del proyecto | SÍ | Con los archivos copiados |
| Webhook URL | SÍ | Apunta al nuevo backend |
| WhatsApp vinculado | SÍ | Escanear QR con nuevo teléfono |

### Costos

- **Evolution API compartida:** ~$5/mes en Railway (1 servicio)
- **PostgreSQL compartido:** ~$5/mes en Railway
- **Nuevos proyectos:** Solo costo del backend de cada proyecto

**Ventaja:** Un solo servicio Evolution API para todos tus proyectos = menos costo, menos mantenimiento.

---

## Datos de la instalación actual

| Componente | Valor |
|------------|-------|
| Evolution API URL | `https://evolution-api-production-c1cb.up.railway.app` |
| GitHub Repo | `github.com/said019/xolobitos-evolution-api` |
| API Key | `xoL0b1t0s-2026` |
| Instancia Grooming | `xolobitos` |
| Versión | 2.3.7 |

---

**Última actualización:** Enero 2026
**Evolution API Version:** 2.3.7
**Probado en:** Railway, Node.js 20+
