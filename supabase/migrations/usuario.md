# 👤 PROMPT — Portal del Cliente
> **Cómo usar:** Pega este archivo en una IA y dile: *"Implementa el portal del cliente descrito aquí para [nombre de tu proyecto]. Usa exactamente el stack y los patrones indicados."*

**Stack:** React + TypeScript + Vite · TanStack Query · React Hook Form + Zod · Shadcn/ui · Axios · React Router v6 · Zustand

---

## Índice de módulos

1. [Autenticación](#1-autenticación)
2. [Dashboard del cliente](#2-dashboard-del-cliente)
3. [Reservar clases](#3-reservar-clases)
4. [Mis reservas](#4-mis-reservas)
5. [Checkout / Compra de membresía](#5-checkout--compra-de-membresía)
6. [Mis órdenes](#6-mis-órdenes)
7. [Wallet / Club](#7-wallet--club)
8. [Historial de puntos](#8-historial-de-puntos)
9. [Recompensas](#9-recompensas)
10. [Perfil](#10-perfil)
11. [Editar perfil](#11-editar-perfil)
12. [Mi membresía](#12-mi-membresía)
13. [Preferencias de notificación](#13-preferencias-de-notificación)
14. [Referir amigos](#14-referir-amigos)
15. [Biblioteca de videos](#15-biblioteca-de-videos)
16. [Reproductor de video y compra individual](#16-reproductor-de-video-y-compra-individual)
17. [Notificaciones](#17-notificaciones)
18. [AuthStore — Gestión de estado](#18-authstore--gestión-de-estado)
19. [Tipos TypeScript del sistema](#19-tipos-typescript-del-sistema)
20. [Rutas del portal cliente](#20-rutas-del-portal-cliente)
21. [Arquitectura del portal cliente](#21-arquitectura-del-portal-cliente)

---

## 1. Autenticación

**Archivos:** `src/pages/auth/`
- `Login.tsx`, `Register.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`
- `CoachLogin.tsx` — login exclusivo para instructores/coaches

### Login

**Campos del formulario:**
```ts
{ email: string; password: string }
```

**API:**
```
POST /auth/login
Body: { email, password }
Response: { message, user: User, token: string }
```

**Comportamiento:**
- Token se guarda en `localStorage` via `setStoredToken(token)`
- Estado global actualizado con `useAuthStore`
- Redirección según rol: `admin|instructor` → `/admin`, `client` → `/app`, `coach` → `/coach`
- Soporta `?returnUrl=` para redirigir después del login

---

### Registro

**Campos (Zod validation):**
```ts
{
  displayName: string           // mín. 2 caracteres
  email: string
  phone: string                 // regex: /^\+52[0-9]{10}$/ → "+521234567890"
  password: string              // mín. 8 chars, 1 mayúscula, 1 número
  confirmPassword: string       // debe coincidir
  acceptsTerms: boolean         // requerido true
  acceptsCommunications: boolean // default false
}
```

**API:**
```
POST /auth/register
Body: { email, password, displayName, phone, acceptsTerms, acceptsCommunications }
Response: { message, user: User, token: string }
```

**Comportamiento:**
- Soporta `?ref=CODIGO` en URL → aplica referido automáticamente
- Redirige a `/app` tras registro

---

### Recuperar contraseña

```
POST /auth/forgot-password   Body: { email }        → envía email con link
POST /auth/reset-password    Body: { token, password } → leer token de ?token= en URL
```

**Zod en ResetPassword:**
```ts
password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/)
```

---

## 2. Dashboard del cliente

**Archivo:** `src/pages/client/Dashboard.tsx`

| Sección | Datos | API |
|---|---|---|
| Estado de membresía | Plan, vencimiento, clases restantes, barra progreso | `GET /memberships/my` |
| Próximas clases | 2 siguientes reservas confirmadas | `GET /bookings/my-bookings` |
| Puntos de lealtad | Balance, barra hacia siguiente recompensa | `GET /wallet/pass` |
| Videos recientes | Últimos 4 publicados | `GET /videos?limit=4` |

**Lógica días restantes:**
```ts
const daysRemaining = membership?.end_date
  ? Math.max(differenceInCalendarDays(parseISO(membership.end_date), new Date()), 0)
  : null;
```

**Lógica clases restantes:**
```ts
const classesProgress = classLimit && classesRemaining !== null
  ? (classesRemaining / classLimit) * 100
  : null;
// classLimit null = plan ilimitado → no muestra barra
```

**Botones de acción rápida:**
- "Reservar clase" → `/app/classes`
- "Ver mis reservas" → `/app/bookings`
- "Explorar videos" → `/app/videos`

---

## 3. Reservar clases

**Archivos:**
- `src/pages/client/BookClasses.tsx`
- `src/pages/client/BookClassConfirm.tsx`
- `src/pages/client/ClassBookingDetail.tsx`

### BookClasses.tsx — Calendario semanal

- Navega semana a semana (botones anterior / siguiente)
- Semana inicia en domingo (`weekStartsOn: 0`)
- 7 columnas (DOM–SÁB), clases ordenadas por hora
- Clases ya reservadas: badge "✓ Reservado"
- Clases pasadas: deshabilitadas

**API:**
```
GET /classes?start=YYYY-MM-DD&end=YYYY-MM-DD   → Class[]
GET /bookings/my-bookings                        → BookingClient[]
```

**Flujo de reserva:**
1. Click en clase → navega a `/app/classes/:classId`
2. `BookClassConfirm.tsx` muestra detalle (instructor, hora, cupo)
3. Click "Confirmar" → `POST /bookings { classId }`
4. Sin cupo → se ofrece entrar a lista de espera

**Respuestas del POST /bookings:**
```ts
{ message: "Reserva confirmada", booking: {...} }
{ message: "Añadido a lista de espera", booking: { status: "waitlist" } }
// Errores: "No tienes membresía activa" | "Ya tienes una reserva" | "Sin créditos"
```

---

## 4. Mis reservas

**Archivo:** `src/pages/client/MyBookings.tsx`

- Lista de reservas del cliente (futuras y pasadas)
- Tabs: Próximas / Pasadas / Canceladas
- Acción: cancelar reserva (confirmación requerida)
- Badge de estado por reserva
- Después de cada clase: botón para dejar reseña (1-5 estrellas + tags)

**API:**
```
GET /bookings/my-bookings                 → BookingClient[]
DELETE /bookings/:id                      → cancelar
POST /reviews { bookingId, rating, tagIds, comment }  → dejar reseña
```

---

## 5. Checkout / Compra de membresía

**Archivo:** `src/pages/client/Checkout.tsx`

### Flujo completo de compra de membresía

```
1. Seleccionar plan (cards con precio, duración, features)
2. Opcionalmente ingresar código de descuento
   → POST /discount-codes/validate { code, planId }
   → muestra precio con descuento aplicado
3. Seleccionar método de pago:
   - "Transferencia bancaria" → crea orden, muestra datos bancarios (CLABE)
4. POST /orders { planId, discountCode? }
   → Response: { orderId, bankDetails: { clabe, bank, accountHolder, amount } }
5. Cliente realiza transferencia en su banco
6. Cliente sube comprobante:
   POST /orders/:id/proof (multipart: archivo imagen/PDF)
   → Response: { message: "Comprobante recibido" }
7. Admin aprueba en /admin/orders → membresía se activa automáticamente
```

**Tipo de Orden:**
```ts
interface CreateOrderRequest {
  planId: string
  discountCode?: string
  paymentMethod: "transfer"
}

interface Order {
  id: string
  plan_name: string
  amount: number
  currency: string
  status: "pending_payment" | "pending_verification" | "verified" | "rejected" | "cancelled"
  bank_clabe?: string
  bank_name?: string
  bank_account_holder?: string
  created_at: string
}
```

---

## 6. Mis órdenes

**Archivos:** `src/pages/client/Orders.tsx`, `OrderDetail.tsx`

- Lista de todas las órdenes del cliente (membresías y videos)
- Click en orden → `OrderDetail.tsx`
- En `OrderDetail.tsx`: subir comprobante si `status === "pending_payment"`
- Mostrar estado actual con badge y mensaje explicativo

**API:**
```
GET /orders           → Order[]
GET /orders/:id       → Order (con detalle)
POST /orders/:id/proof (multipart) → sube comprobante
```

**Rutas:**
- `/app/orders` → lista
- `/app/orders/:orderId` → detalle + subir comprobante

---

## 7. Wallet / Club

**Archivo:** `src/pages/client/Wallet.tsx`

- Balance actual de puntos de lealtad
- Código QR para check-in en clases
- Botones: Ver historial, Canjear recompensas

**API:**
```
GET /wallet/pass   → { points: number, qr_code: string, level?: string }
```

---

## 8. Historial de puntos

**Archivo:** `src/pages/client/WalletHistory.tsx`

Lista de movimientos de puntos: ganados (clase, referido, bienvenida) y canjeados.

**API:**
```
GET /loyalty/my-history  → { type: "earned"|"redeemed", points, reason, created_at }[]
```

---

## 9. Recompensas

**Archivo:** `src/pages/client/WalletRewards.tsx`

Grid de recompensas disponibles para canjear. Botón "Canjear" si tiene puntos suficientes.

**API:**
```
GET /loyalty/rewards         → Reward[]
POST /loyalty/redeem         Body: { rewardId }
```

---

## 10. Perfil

**Archivo:** `src/pages/client/Profile.tsx`

- Avatar con foto o iniciales
- Info: nombre, email, teléfono, fecha de nacimiento
- Links a: Editar perfil, Mi membresía, Preferencias, Referir amigos

---

## 11. Editar perfil

**Archivo:** `src/pages/client/ProfileEdit.tsx`

**Campos editables:**
```ts
{
  displayName: string
  phone: string
  dateOfBirth: string       // "YYYY-MM-DD"
  emergencyContactName: string
  emergencyContactPhone: string
  healthNotes: string
}
```

**API:**
```
PUT /users/:id  Body: UpdateProfileData
```

Tras guardar: actualiza `authStore` con `updateUser()`

---

## 12. Mi membresía

**Archivo:** `src/pages/client/ProfileMembership.tsx`

- Estado actual de la membresía activa
- Fecha de inicio / vencimiento
- Clases restantes (si aplica)
- Historial de membresías anteriores
- Botón "Renovar" → `/app/checkout`

**API:**
```
GET /memberships/my   → ClientMembership | null
```

**Tipo ClientMembership:**
```ts
interface ClientMembership {
  id: string
  plan_name: string
  status: "active" | "expired" | "pending_payment" | "pending_activation" | "cancelled"
  start_date: string
  end_date: string
  classes_remaining: number | null
  class_limit: number | null
}
```

---

## 13. Preferencias de notificación

**Archivo:** `src/pages/client/ProfilePreferences.tsx`

**Switches:**
```ts
receiveReminders: boolean       // recordatorio antes de clase
receivePromotions: boolean      // ofertas y promociones
receiveWeeklySummary: boolean   // resumen semanal
```

**API:**
```
GET /users/:id    → leer valores actuales
PUT /users/:id    Body: { receiveReminders, receivePromotions, receiveWeeklySummary }
```

---

## 14. Referir amigos

**Archivo:** `src/pages/client/ReferFriends.tsx`

**API:**
```
GET /referrals/code   → { code: string, uses_count: number, reward_points: number }
```

**UI:**
- Input de solo lectura con el código
- Botón "Copiar" → `navigator.clipboard.writeText(code)`
- Explicación: "Cuando tu amigo active su membresía recibes X puntos"

---

## 15. Biblioteca de videos

**Archivo:** `src/pages/client/VideoLibrary.tsx`

**API:**
```
GET /videos/categories     → VideoCategory[]
GET /videos?search=&category=  → Video[]
```

**Tipo Video (vista cliente):**
```ts
interface Video {
  id: string
  title: string
  description: string
  duration_seconds: number
  thumbnail_url: string
  category_name: string
  category_color?: string
  level: string
  access_type: "gratuito" | "miembros"
  views_count: number
  sales_enabled?: boolean
  sales_unlocks_video?: boolean
  sales_price_mxn?: number | null
}
```

**UI:**
- Grid de cards con thumbnail, título, duración, categoría badge
- `access_type === "miembros"` sin membresía → badge 🔒 "Miembros"
- `sales_unlocks_video === true` + precio → badge 🟡 "Compra requerida"
- `sales_enabled === true` + `sales_unlocks_video === false` → texto de precio debajo del título (venta cruzada de clases, el video sigue siendo libre)
- Filtros por categoría (pills) + buscador con debounce
- Duración: `Math.floor(duration_seconds / 60)` min

---

## 16. Reproductor de video y compra individual

**Archivo:** `src/pages/client/VideoPlayer.tsx`
**Ruta:** `/app/videos/:videoId`

**API:**
```
GET /videos/:id
Response: {
  id, title, description, video_url, thumbnail_url,
  instructor_name?, duration_seconds,
  has_access: boolean,       // false si requiere compra y no ha pagado
  sales_enabled, sales_unlocks_video, sales_price_mxn,
  sales_cta_text
}
```

### Lógica de acceso

```ts
// El video se puede reproducir si:
const canWatch = video.has_access || 
                 (!video.sales_unlocks_video && video.access_type === 'gratuito');
```

### Flujo de compra individual por transferencia bancaria

Este es el flujo completo que ocurre cuando `sales_unlocks_video === true` y `has_access === false`:

```
1. VideoPlayer muestra paywall con precio y botón "Comprar"

2. Cliente hace clic → POST /videos/:id/purchase
   Response: {
     purchase_id: string,
     bank_details: {
       clabe: string,
       bank: string,
       account_holder: string,
       amount: number
     }
   }

3. Se muestra pantalla de instrucciones de transferencia:
   "Transfiere $XXX MXN a CLABE XXXXXXXXXXXXXXXX
    Banco: [nombre]
    Titular: [nombre del studio]"

4. Cliente realiza transferencia en su app bancaria

5. Cliente sube comprobante (foto o PDF):
   POST /videos/purchases/:purchase_id/proof
   Body: FormData { file: File, payment_reference?: string, transfer_date?: string, notes?: string }
   Response: { message: "Comprobante recibido. Verificaremos en breve." }

6. Status cambia a: pending_verification

7. Admin revisa en /admin/videos/ventas → aprueba
   POST /videos/purchases/:id/approve

8. Status cambia a: approved
   → has_access = true para este usuario en este video

9. Cliente recarga la página o recibe notificación
   → VideoPlayer muestra el reproductor
   → POST /videos/:id/view al iniciar reproducción
```

### Componentes del VideoPlayer

```tsx
// Estado del reproductor
if (!video.has_access && video.sales_unlocks_video) {
  return <VideoPaywall video={video} onPurchase={handlePurchase} />;
}

if (!video.has_access && video.access_type === 'miembros') {
  return <MembershipPaywall />;  // CTA para comprar membresía
}

// Reproductor normal
return <VideoEmbed url={video.video_url} />;
```

### Tipos para la compra de video

```ts
interface VideoPurchaseInitResponse {
  purchase_id: string
  bank_details: {
    clabe: string
    bank: string
    account_holder: string
    amount: number
    currency: string
  }
}

interface VideoPurchaseProofPayload {
  file: File
  payment_reference?: string
  transfer_date?: string
  notes?: string
}
```

---

## 17. Notificaciones

**Archivo:** `src/pages/client/Notifications.tsx`

Lista de notificaciones del cliente.

```ts
interface Notification {
  id: string
  title: string
  body: string
  time: string     // "Hace 2h" | "Ayer"
  unread: boolean
}
```

> Para producción: `GET /notifications` del backend. En desarrollo: datos estáticos.

---

## 18. AuthStore — Gestión de estado

**Archivo:** `src/stores/authStore.ts`

Zustand + persist en `localStorage`.

### Estado
```ts
{
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}
```

### Acciones
```ts
login(credentials: LoginCredentials): Promise<void>
register(data: RegisterData): Promise<void>
logout(): void                  // limpia token de localStorage + estado
checkAuth(): Promise<void>      // GET /auth/me → valida token al recargar
clearError(): void
updateUser(user: User): void    // actualiza perfil sin nuevo login
setAuth(user, token): void      // usado por magic link
```

### Token
- Key en localStorage: `auth_token`
- Inyectado automáticamente en Axios como `Authorization: Bearer <token>`
- `checkAuth()` se ejecuta al montar la app

### Código del store
```ts
useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({ ... }),
    { name: 'auth-storage' }
  )
)
```

---

## 19. Tipos TypeScript del sistema

**Archivo:** `src/types/auth.ts`

### User
```ts
interface User {
  id: string
  email: string
  phone: string
  display_name: string
  full_name?: string
  photo_url: string | null
  avatar_url?: string | null
  role: "client" | "instructor" | "admin" | "super_admin" | "reception" | "coach"
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  health_notes: string | null
  accepts_communications: boolean
  date_of_birth: string | null    // "YYYY-MM-DD"
  receive_reminders: boolean
  receive_promotions: boolean
  receive_weekly_summary: boolean
  created_at: string
  updated_at: string
  is_instructor?: boolean
  instructor_id?: string
  coach_number?: string
}
```

### UpdateProfileData
```ts
interface UpdateProfileData {
  displayName?: string
  phone?: string
  dateOfBirth?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  healthNotes?: string
  receiveReminders?: boolean
  receivePromotions?: boolean
  receiveWeeklySummary?: boolean
}
```

### RegisterData
```ts
interface RegisterData {
  email: string
  password: string
  displayName: string
  phone: string
  acceptsTerms: boolean
  acceptsCommunications: boolean
}
```

### AuthResponse
```ts
interface AuthResponse {
  message: string
  user: User
  token: string       // JWT — incluir en todas las requests como Bearer
}
```

### BookingClient (archivo: `src/types/booking.ts`)
```ts
interface BookingClient {
  id: string
  class_id: string
  class_type_name: string
  instructor_name: string
  start_time: string
  end_time: string
  status: "confirmed" | "waitlist" | "checked_in" | "no_show" | "cancelled"
  booked_at: string
}
```

### ClientMembership (archivo: `src/types/membership.ts`)
```ts
interface ClientMembership {
  id: string
  plan_id: string
  plan_name: string
  status: "active" | "expired" | "pending_payment" | "pending_activation" | "cancelled"
  start_date: string
  end_date: string
  classes_remaining: number | null
  class_limit: number | null
  payment_method?: string
}
```

### Order (archivo: `src/types/order.ts`)
```ts
type OrderStatus = "pending_payment" | "pending_verification" | "verified" | "rejected" | "cancelled"

interface Order {
  id: string
  user_id: string
  plan_id: string
  plan_name: string
  amount: number
  currency: string
  status: OrderStatus
  payment_method: string
  bank_clabe?: string
  bank_name?: string
  bank_account_holder?: string
  proof_url?: string
  admin_notes?: string
  created_at: string
  updated_at: string
}

interface CreateOrderRequest {
  planId: string
  discountCode?: string
  paymentMethod: "transfer"
}
```

---

## 20. Rutas del portal cliente

| Ruta | Componente | Descripción |
|---|---|---|
| `/` | `Index.tsx` | Landing page pública |
| `/auth/login` | `Login.tsx` | Login |
| `/auth/register` | `Register.tsx` | Registro |
| `/auth/forgot-password` | `ForgotPassword.tsx` | Recuperar contraseña |
| `/auth/reset-password` | `ResetPassword.tsx` | Nueva contraseña con token |
| `/app` | `Dashboard.tsx` | Dashboard cliente |
| `/app/classes` | `BookClasses.tsx` | Calendario para reservar |
| `/app/classes/:classId` | `BookClassConfirm.tsx` | Confirmación de reserva |
| `/app/bookings` | `MyBookings.tsx` | Mis reservas |
| `/app/checkout` | `Checkout.tsx` | Compra de membresía |
| `/app/orders` | `Orders.tsx` | Mis órdenes |
| `/app/orders/:orderId` | `OrderDetail.tsx` | Detalle + subir comprobante |
| `/app/wallet` | `Wallet.tsx` | Wallet / puntos / QR |
| `/app/wallet/history` | `WalletHistory.tsx` | Historial de puntos |
| `/app/wallet/rewards` | `WalletRewards.tsx` | Canjear recompensas |
| `/app/videos` | `VideoLibrary.tsx` | Biblioteca de videos |
| `/app/videos/:videoId` | `VideoPlayer.tsx` | Reproductor + paywall de compra |
| `/app/profile` | `Profile.tsx` | Ver perfil |
| `/app/profile/edit` | `ProfileEdit.tsx` | Editar perfil |
| `/app/profile/membership` | `ProfileMembership.tsx` | Mi membresía |
| `/app/profile/preferences` | `ProfilePreferences.tsx` | Preferencias notificaciones |
| `/app/profile/refer` | `ReferFriends.tsx` | Referir amigos |
| `/app/notifications` | `Notifications.tsx` | Notificaciones |

### Guard de autenticación
Todas las rutas `/app/*` usan:
```tsx
<AuthGuard requiredRoles={['client']}>
  <ClientLayout>
    {/* contenido */}
  </ClientLayout>
</AuthGuard>
```

`AuthGuard` redirige a `/auth/login?returnUrl=<ruta>` si no está autenticado o si el rol no coincide.

---

## 21. Arquitectura del portal cliente

```
src/
  pages/
    auth/          → Login, Register, ForgotPassword, ResetPassword
    client/        → todas las páginas del área privada del cliente
  stores/
    authStore.ts   → Zustand + persist en localStorage
  types/
    auth.ts        → User, Plan, Membership, AuthResponse, RegisterData
    booking.ts     → BookingClient
    membership.ts  → ClientMembership
    order.ts       → Order, OrderStatus, CreateOrderRequest
  lib/
    api.ts         → instancia Axios + interceptor Bearer token
    memberships.ts → helper fetchMyMembership()
  components/
    layout/
      ClientLayout.tsx   → sidebar/navbar del área cliente
      AuthGuard.tsx      → protección de rutas por rol
```

### Convenciones (aplicar en TODOS los módulos)

| Patrón | Uso |
|---|---|
| `useQuery` | Todo fetch de datos |
| `useMutation` | Todo write (crear, editar, eliminar) |
| `React Hook Form + Zod resolver` | Todos los formularios |
| `useToast()` | Todas las notificaciones al usuario |
| `date-fns` con `locale: es` | Todas las fechas |
| Teléfono MX | Regex `/^\+52[0-9]{10}$/` |
| TanStack Query invalidation | `queryClient.invalidateQueries` tras cada mutation |

### Configuración de Axios (`src/lib/api.ts`)

```ts
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://tubackend.railway.app/api',
});

// Interceptor: inyecta token automáticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor: redirige a login si token expiró (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);
```
