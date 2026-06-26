# Evolution API — Setup Valiance Pilates

Conectar el WhatsApp del estudio (`+52 55 2317 3402`) reusando el servicio **Xolobitos Evolution API** ya desplegado en Railway. Solo creamos una **nueva instancia** llamada `valiance-pilates` dentro de ese mismo servicio.

---

## Estado actual

| | |
|---|---|
| **Servicio Evolution API** | `https://evolution-api-production-c1cb.up.railway.app` (xolobitos, ya corriendo) |
| **API key del servicio** | `xoL0b1t0s-2026` |
| **Instancia Valiance** | `valiance-pilates` (nueva, hay que crearla) |
| **Número del estudio** | `525523173402` |
| **Backend Valiance** | `https://valiancepilates.com.mx` |

> **Una sola Evolution API puede hostear N instancias.** Cada instancia es una sesión de WhatsApp independiente con su propio número/QR. Valiance será una instancia más, separada de Punto Neutro (`punto-neutro-studio`).

---

## Paso 1 · Variables de entorno en el backend de Valiance

En Railway → proyecto Valiance → servicio backend → **Variables**, agrega:

```env
EVOLUTION_API_URL=https://evolution-api-production-c1cb.up.railway.app
EVOLUTION_API_KEY=xoL0b1t0s-2026
EVOLUTION_INSTANCE_NAME=valiance-pilates
```

Railway redespliega automáticamente.

---

## Paso 2 · Crear la instancia Valiance en Evolution API

El backend ya sabe crear instancias por sí solo. Lo único que tienes que hacer es:

1. Inicia sesión como admin en https://valiancepilates.com.mx/auth/login
2. Ve a **Configuración** → pestaña **WhatsApp**
3. Toca **"Conectar WhatsApp"**

Esto dispara `POST /instance/create` automáticamente al servicio Xolobitos con:

```json
{
  "instanceName": "valiance-pilates",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS"
}
```

Y devuelve un QR para escanear.

> Si la instancia ya existe, simplemente devuelve el QR existente en lugar de crear una nueva. El endpoint es idempotente.

---

## Paso 3 · Vincular el WhatsApp del estudio

Con el QR en pantalla:

1. En el celular del estudio (`+52 55 2317 3402`):
   - WhatsApp → ⋮ → **Dispositivos vinculados** → **Vincular un dispositivo**
   - Escanea el QR
2. La página debe cambiar a **Conectado** automáticamente

> El QR expira en 30 segundos. Si tarda, dale **"Refrescar QR"**.

---

## Paso 4 · Probar

Desde **Configuración** → **WhatsApp** → **Probar templates**, prueba:

| Template | Activo en Valiance |
|---|---|
| Membresía activada | ✅ |
| Reserva confirmada | ✅ |
| Reserva cancelada | ✅ |
| Recordatorio 2h antes | ❌ apagado |
| Recordatorio semanal | ✅ |
| Renovación próxima (3 y 1 día) | ✅ |
| Renovación última clase | ✅ |

Toca **Enviar prueba** y verifica que llegue a tu número.

---

## Verificación rápida

Desde tu terminal local puedes verificar las instancias del servicio Xolobitos:

```bash
curl -H "apikey: xoL0b1t0s-2026" \
  https://evolution-api-production-c1cb.up.railway.app/instance/fetchInstances
```

Deberías ver las instancias existentes:
- `punto-neutro-studio` (Punto Neutro — ya conectada)
- `valiance-pilates` (Valiance — después del paso 2)

Y el estado de la instancia Valiance:

```bash
curl -H "apikey: xoL0b1t0s-2026" \
  https://evolution-api-production-c1cb.up.railway.app/instance/connectionState/valiance-pilates
```

Estados posibles:
- `close` → no conectada (falta escanear QR)
- `connecting` → QR escaneado, sincronizando
- `open` → conectada, lista para enviar

---

## Troubleshooting

### El backend dice "Evolution API not configured"
→ Faltan `EVOLUTION_API_URL` o `EVOLUTION_API_KEY` en Railway. Revisa el paso 1.

### El QR no aparece
→ Revisa logs del servicio Xolobitos en Railway. Si el dominio no responde, el servicio se cayó — revisa restart.

### Mensajes salen del backend pero no llegan al usuario
→ La instancia Valiance se desvinculó del WhatsApp. Vuelve al paso 2-3 para reconectar.

### Apagar TODOS los WhatsApp temporalmente
```sql
UPDATE system_settings
SET value = jsonb_set(value, '{whatsapp_reminders}', 'false')
WHERE key = 'notification_settings';
```

### Borrar la instancia Valiance (empezar de cero)
```bash
curl -X DELETE -H "apikey: xoL0b1t0s-2026" \
  https://evolution-api-production-c1cb.up.railway.app/instance/logout/valiance-pilates

curl -X DELETE -H "apikey: xoL0b1t0s-2026" \
  https://evolution-api-production-c1cb.up.railway.app/instance/delete/valiance-pilates
```

Después repite el paso 2.

---

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│  Backend Punto Neutro                            │
│  EVOLUTION_INSTANCE_NAME=punto-neutro-studio     │
└──────┬───────────────────────────────────────────┘
       │
       │ apikey: xoL0b1t0s-2026
       ▼
┌──────────────────────────────────────────────────┐
│  RAILWAY · evolution-api-production-c1cb         │
│  (servicio Xolobitos compartido)                 │
│                                                   │
│  ┌─────────────────────────────┐                 │
│  │ Instancia: punto-neutro     │ ◄── PN          │
│  │   sesión WA #1              │                 │
│  └─────────────────────────────┘                 │
│  ┌─────────────────────────────┐                 │
│  │ Instancia: valiance-pilates │ ◄── Valiance    │
│  │   sesión WA #2 (NUEVA)      │                 │
│  └─────────────────────────────┘                 │
└──────────────────────────────────────────────────┘
       ▲
       │ apikey: xoL0b1t0s-2026
       │
┌──────┴───────────────────────────────────────────┐
│  Backend Valiance (valiancepilates.com.mx)       │
│  EVOLUTION_INSTANCE_NAME=valiance-pilates        │
└──────────────────────────────────────────────────┘
```

Ambos backends comparten el mismo servicio Evolution pero apuntan a instancias distintas — los WhatsApp salen por números independientes.
