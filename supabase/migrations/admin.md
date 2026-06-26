# 🛠️ PROMPT — Panel de Administración
> **Cómo usar:** Pega este archivo en una IA y dile: *"Implementa el panel de administración descrito aquí para [nombre de tu proyecto]. Usa exactamente el stack y los patrones indicados."*

**Stack:** React + TypeScript + Vite · TanStack Query · React Hook Form + Zod · Shadcn/ui · Axios · React Router v6

---

## Índice de módulos

1. [Dashboard](#1-dashboard)
2. [Planes](#2-planes)
3. [Membresías](#3-membresías)
4. [Clientes](#4-clientes)
5. [Clases](#5-clases)
6. [Horarios (Schedule)](#6-horarios-schedule)
7. [Reservas (Bookings)](#7-reservas-bookings)
8. [Instructores / Staff](#8-instructores--staff)
9. [Pagos](#9-pagos)
10. [Órdenes](#10-órdenes)
11. [POS — Punto de Venta](#11-pos--punto-de-venta)
12. [Códigos de Descuento](#12-códigos-de-descuento)
13. [Programa de Lealtad](#13-programa-de-lealtad)
14. [Referidos](#14-referidos)
15. [Videos y Cobro Individual](#15-videos-y-cobro-individual)
16. [Reportes](#16-reportes)
17. [Reseñas](#17-reseñas)
18. [Configuración](#18-configuración)
19. [Arquitectura y patrones comunes](#19-arquitectura-y-patrones-comunes)

---

## 1. Dashboard

**Archivo:** `src/pages/admin/Dashboard.tsx`

### ¿Qué hace?
Pantalla de inicio del admin. Resumen en tiempo real del estado del studio.

### Métricas
| Métrica | Endpoint |
|---|---|
| Clases de hoy | `GET /admin/stats` |
| Membresías activas | `GET /admin/stats` |
| Ingresos del mes | `GET /admin/stats` |
| Alertas pendientes | `GET /admin/stats` |
| Últimas membresías | `GET /memberships` (slice 5) |
| Órdenes pendientes | `GET /orders/pending` |

### Roles permitidos
`admin` · `instructor`

---

## 2. Planes

**Archivo:** `src/pages/admin/plans/PlansList.tsx`

### Campos de un Plan
```ts
{
  name: string                   // "Mensual Ilimitado"
  description?: string
  price: number                  // en MXN
  currency: string               // default "MXN"
  durationDays: number           // 30, 90, 365
  classLimit: number | null      // null = ilimitado
  features: string               // lista separada por comas
  isActive: boolean
  sortOrder: number
}
```

### API
| Acción | Endpoint |
|---|---|
| Listar | `GET /plans` |
| Crear | `POST /plans` |
| Editar | `PUT /plans/:id` |
| Eliminar | `DELETE /plans/:id` |

### UI
- Tabla: Nombre · Precio · Duración · Límite clases · Estado
- Dialog modal crear/editar con Zod validation
- DropdownMenu por fila: Editar · Eliminar
- Badge activo/inactivo

---

## 3. Membresías

**Archivos:** `src/pages/admin/memberships/`
- `MembershipsList.tsx`, `MembershipsAll.tsx`, `MembershipsActive.tsx`
- `MembershipsExpiring.tsx` (próximos 7 días), `PendingMemberships.tsx`

### Estados
```
active              → en uso
pending_payment     → esperando pago
pending_activation  → pagado, no activado
expired             → venció
cancelled           → cancelada manualmente
```

### Campos
```ts
{
  userId: string
  planId: string
  status: enum
  paymentMethod?: "efectivo" | "tarjeta" | "transferencia"
  startDate: Date
  endDate: Date              // calculado con durationDays del plan
  classesRemaining: number
}
```

### API
| Acción | Endpoint |
|---|---|
| Listar | `GET /memberships` |
| Asignar | `POST /memberships` |
| Activar | `PUT /memberships/:id/activate` |
| Cancelar | `PUT /memberships/:id/cancel` |
| Activas | `GET /memberships/active` |

---

## 4. Clientes

**Archivos:** `src/pages/admin/clients/ClientsList.tsx`, `ClientDetail.tsx`

### Campos
```ts
{
  email: string
  phone?: string
  displayName: string
  role: "client"
  dateOfBirth?: Date
  emergencyContactName?: string
  emergencyContactPhone?: string
  healthNotes?: string
  acceptsCommunications: boolean
}
```

### API
| Acción | Endpoint |
|---|---|
| Listar | `GET /users?role=client&search=...` |
| Detalle | `GET /users/:id` |
| Crear | `POST /users` |
| Actualizar | `PUT /users/:id` |
| Eliminar | `DELETE /users/:id` |
| Historial reservas | `GET /bookings?userId=:id` |
| Membresías | `GET /memberships?userId=:id` |

### UI
- Búsqueda debounce 300ms
- DropdownMenu: Ver detalle · Asignar membresía · Eliminar
- `ClientDetail.tsx`: tabs Perfil / Membresías / Reservas / Pagos / Lealtad

---

## 5. Clases

**Archivos:** `src/pages/admin/classes/`
- `ClassesCalendar.tsx`, `ClassTypesList.tsx`, `GenerateClasses.tsx`, `WorkoutTemplates.tsx`

### Clase (instancia)
```ts
{
  classTypeId: string
  instructorId: string
  facilityId?: string
  startTime: DateTime          // "2026-02-24T09:00:00"
  endTime: DateTime
  maxCapacity: number
  notes?: string
  isCancelled: boolean
}
```

### Tipo de Clase
```ts
{
  name: string                 // "Yoga Flow"
  color: string                // hex "#8B5CF6"
  defaultDuration: number      // minutos
  maxCapacity: number
  isActive: boolean
}
```

### API
| Acción | Endpoint |
|---|---|
| Clases por rango | `GET /classes?start=ISO&end=ISO` |
| Crear | `POST /classes` |
| Editar | `PUT /classes/:id` |
| Cancelar | `PUT /classes/:id/cancel` |
| Tipos | `GET /class-types` · `POST /class-types` |
| Generar masivo | `POST /classes/generate` |

### UI
- Vista 7 columnas (lun–dom), cada clase como card de color
- Click en clase → Sheet con detalle y acciones
- Click en celda vacía → Dialog de crear clase
- Indicador de cupo (reservados / máximo)

---

## 6. Horarios (Schedule)

**Archivo:** `src/pages/admin/schedules/WeeklySchedule.tsx`

### Campos
```ts
{
  dayOfWeek: 0-6              // 0=Domingo…6=Sábado
  classTypeId: string
  instructorId: string
  startTime: string           // "09:00" HH:MM 24h
  endTime: string
  maxCapacity: number
  isActive: boolean
}
```

### API
`GET|POST /schedules` · `PUT|DELETE /schedules/:id`

---

## 7. Reservas (Bookings)

**Archivos:** `src/pages/admin/bookings/BookingsList.tsx`, `Waitlist.tsx`

### Estados
```
confirmed · waitlist · checked_in · no_show · cancelled
```

### API
| Acción | Endpoint |
|---|---|
| Listar | `GET /bookings` |
| Por clase | `GET /bookings?classId=:id` |
| Check-in | `PUT /bookings/:id/check-in` |
| Cancelar | `DELETE /bookings/:id` |
| Lista espera | `GET /bookings?status=waitlist` |

### Props del componente reutilizable
```ts
interface BookingsListProps {
  title?: string
  initialStatus?: string
  statusLocked?: boolean
}
```

---

## 8. Instructores / Staff

**Archivo:** `src/pages/admin/staff/InstructorsList.tsx`

### Campos
```ts
{
  userId?: string
  displayName: string
  email: string
  bio?: string
  specialties: string[]
  isActive: boolean
  photoUrl?: string
}
```

### API
| Acción | Endpoint |
|---|---|
| CRUD | `GET|POST /instructors` · `PUT|DELETE /instructors/:id` |
| Subir foto | `POST /instructors/:id/photo` (multipart) |
| Magic link | `POST /instructors/:id/magic-link` |

---

## 9. Pagos

**Archivos:** `src/pages/admin/payments/`
- `CashAssignment.tsx` — wizard: buscar cliente → plan → pago → activar membresía
- `PaymentsRegister.tsx`, `PaymentsPending.tsx`, `PaymentsTransactions.tsx`, `PaymentsReports.tsx`

### Métodos de pago
`cash` · `card` · `transfer`

### API
| Acción | Endpoint |
|---|---|
| Registrar | `POST /payments` |
| Historial | `GET /payments` |
| Pendientes | `GET /payments/pending` |
| Reporte | `GET /payments/reports` |

---

## 10. Órdenes

**Archivo:** `src/pages/admin/orders/OrdersVerification.tsx`

El cliente sube comprobante de transferencia → admin revisa → aprueba o rechaza.

### Estados
```
pending_payment · pending_verification · verified · rejected · cancelled
```

### API
| Acción | Endpoint |
|---|---|
| Pendientes | `GET /orders/pending` |
| Todas | `GET /orders` |
| Detalle | `GET /orders/:id` |
| Aprobar | `PUT /orders/:id/verify` |
| Rechazar | `PUT /orders/:id/reject` |

### UI
- Tabla con badge de estado
- Dialog → muestra imagen del comprobante
- Botones Aprobar / Rechazar con campo de notas

---

## 11. POS — Punto de Venta

**Archivos:** `src/pages/admin/pos/POSPage.tsx`, `ProductsPage.tsx`

### Producto
```ts
{
  name: string
  price: number
  category: "suplementos" | "ropa" | "accesorios"
  stock: number
  sku?: string
  isActive: boolean
}
```

### API
| Acción | Endpoint |
|---|---|
| Productos | `GET /products?search=&category=&active=true` |
| CRUD productos | `POST /products` · `PUT|DELETE /products/:id` |
| Procesar venta | `POST /pos/checkout` |
| Historial | `GET /pos/orders` |

### Flujo
1. Búsqueda de producto → agregar al carrito
2. Asignar cliente (opcional)
3. Seleccionar método de pago
4. Confirmar → crea order + descuenta stock

---

## 12. Códigos de Descuento

**Archivo:** `src/pages/admin/discount-codes/DiscountCodes.tsx`

### Campos
```ts
{
  code: string               // "VERANO2026"
  discountType: "percentage" | "fixed"
  discountValue: number
  minPurchaseAmount?: number
  maxUses?: number           // null = ilimitado
  usesCount: number          // solo lectura
  expiresAt?: DateTime
  isActive: boolean
  applicablePlans?: string[]
}
```

### API
`GET|POST /discount-codes` · `PUT|DELETE /discount-codes/:id`
`POST /discount-codes/validate` `{ code, planId }` (cliente)

---

## 13. Programa de Lealtad

**Archivos:** `src/pages/admin/loyalty/`

### Configuración global
```ts
{
  enabled: boolean
  points_per_class: number
  points_per_peso: number
  welcome_bonus: number
  birthday_bonus: number
  referral_bonus: number
}
```

### Recompensa
```ts
{
  name: string
  points_cost: number
  reward_type: "discount" | "free_class" | "product" | "custom"
  reward_value: string
  is_active: boolean
  stock: number | null
}
```

### API
| Acción | Endpoint |
|---|---|
| Config | `GET|PUT /loyalty/config` |
| Rewards CRUD | `GET|POST /loyalty/rewards` · `PUT|DELETE /loyalty/rewards/:id` |
| Ajustar puntos | `POST /loyalty/points/:userId/adjust` |
| Historial | `GET /loyalty/my-history` |
| Canjes | `GET /loyalty/redemptions` |

---

## 14. Referidos

**Archivo:** `src/pages/admin/referrals/Referrals.tsx`

### Entidades
```ts
// Código de referido
{
  code: string
  user_id: number
  uses_count: number
  max_uses: number | null
  reward_points: number
  is_active: boolean
}

// Referral (relación)
{
  referrer_name: string
  referred_name: string
  status: "pending" | "completed"
  points_awarded: number
  completed_at: Date | null
}
```

### API
`GET /referrals` · `/referrals/codes` · `/referrals/stats` · `/referrals/code` · `/referrals/my-referrals`

---

## 15. Videos y Cobro Individual

**Archivos:** `src/pages/admin/videos/`
- `VideoList.tsx` — listado con paginación y búsqueda
- `VideoUpload.tsx` — crear/editar video
- `VideoSalesVerification.tsx` — verificar comprobantes de pago

---

### 15.1 Por qué un video muestra "Gratuito" Y un precio al mismo tiempo

Son **dos capas independientes**:

| Campo | Controla |
|---|---|
| `access_type` | Quién puede **ver** el video sin pagar: `"gratuito"` o `"miembros"` |
| `sales_enabled` + `sales_price_mxn` | Si hay un **botón de compra** (para clases o para desbloquear el video) |

**Tabla de combinaciones:**

| `access_type` | `sales_enabled` | `sales_unlocks_video` | Comportamiento |
|---|---|---|---|
| `gratuito` | `false` | — | Badge "Gratuito" · todos ven el video sin pagar |
| `gratuito` | `true` | `false` | Badge "Gratuito" + precio en pantalla · el video es libre pero hay CTA para comprar un paquete de clases (venta cruzada) — **este es el caso del screenshot** |
| `gratuito` | `true` | `true` | Badge "Compra requerida" · aunque `access_type=gratuito`, el switch `sales_unlocks_video` bloquea el video hasta que se pague |
| `miembros` | `false` | — | Badge "Miembros" · solo miembros activos |
| `miembros` | `true` | `true` | Badge "Compra requerida" · membresía O compra individual |

**Regla de oro:** `access_type` y `sales_enabled/sales_unlocks_video` son ortogonales. La vista en admin muestra el precio debajo del título **siempre que `sales_enabled=true` y `sales_price_mxn > 0`**, independientemente del tipo de acceso. No hay error, es intencional.

---

### 15.2 Campos completos de un Video

```ts
{
  // Metadatos
  title: string
  description?: string
  subtitle?: string
  tagline?: string
  days?: string
  brand_color?: string         // hex ej. "#8F9A8A"
  level: "principiante" | "intermedio" | "avanzado" | "todos"
  category_id: string

  // Acceso y publicación
  access_type: "gratuito" | "miembros"
  is_published: boolean        // false = borrador

  // Archivo (Cloudinary o Drive)
  cloudinary_id?: string
  drive_file_id?: string
  thumbnail_url?: string
  thumbnail_drive_id?: string
  duration_seconds: number

  // Venta individual
  sales_enabled: boolean               // activa el botón de compra
  sales_unlocks_video: boolean         // si true → bloquea hasta que se pague
  sales_price_mxn: number | null       // precio en MXN
  sales_class_credits: number          // créditos de clase incluidos
  sales_cta_text: string               // texto del botón
}
```

---

### 15.3 Flujo completo de cobro por transferencia bancaria

```
CLIENTE                            SISTEMA                         ADMIN
  │                                   │                               │
  ├─ Ve video con "Compra requerida" ─►                               │
  ├─ Clic "Comprar" ($XXX MXN) ───────► POST /videos/:id/purchase     │
  │                                   │  status: pending_payment      │
  ├─ Ve instrucciones de CLABE ───────◄                               │
  ├─ Realiza transferencia en banco                                    │
  ├─ Sube comprobante (foto/PDF) ─────► POST /videos/purchases/:id/proof
  │                                   │  status: pending_verification │
  │                                   │─────── notificación ─────────►│
  │                                   │                               │
  │                                   │◄── GET /videos/purchases/pending
  │                                   │◄── Revisa imagen/PDF ─────────┤
  │                                   │◄── POST .../approve ──────────┤
  │                                   │  status: approved             │
  ├◄─ Video desbloqueado ─────────────┤  has_access: true             │
  ├─ Reproduce el video ──────────────► POST /videos/:id/view         │
```

---

### 15.4 API de videos completa

| Acción | Endpoint |
|---|---|
| Listar | `GET /videos?search=&limit=20&offset=0` |
| Crear | `POST /videos` |
| Editar | `PUT /videos/:id` |
| Eliminar | `DELETE /videos/:id` |
| Detalle (con `has_access`) | `GET /videos/:id` |
| Upload archivo | `POST /videos/upload` (multipart: `video` + `thumbnail?`) |
| Categorías | `GET /videos/categories` |
| Compras pendientes | `GET /videos/purchases/pending` |
| Aprobar compra | `POST /videos/purchases/:id/approve` `{ admin_notes? }` |
| Rechazar compra | `POST /videos/purchases/:id/reject` `{ admin_notes? }` |
| Iniciar compra (cliente) | `POST /videos/:id/purchase` |
| Subir comprobante (cliente) | `POST /videos/purchases/:id/proof` (multipart) |
| Registrar vista | `POST /videos/:id/view` |

---

### 15.5 Tipo `VideoPurchase`

```ts
interface VideoPurchase {
  id: string
  user_id: string
  user_name?: string
  user_email?: string
  video_id: string
  video_title?: string
  video_thumbnail_url?: string
  amount: number
  currency: string
  payment_method: string       // "transfer"
  status: "pending_payment" | "pending_verification" | "approved" | "rejected" | "cancelled" | "expired"
  payment_reference?: string | null
  transfer_date?: string | null
  has_proof: boolean
  proof_file_url?: string | null
  proof_file_name?: string | null
  proof_file_type?: string | null
  customer_notes?: string | null
  admin_notes?: string | null
  created_at: string
  updated_at: string
  expires_at?: string | null
}
```

---

### 15.6 UI VideoSalesVerification (admin)

- **Tab "Por verificar"** → compras `pending_verification`
- **Tab "Esperando pago"** → compras `pending_payment`
- Por orden: cliente, video, monto, fecha, método, badge de estado
- Botón "Ver detalle" → Dialog:
  - Imagen/PDF del comprobante
  - Campo de notas del admin
  - **Botón Aprobar** → desbloquea el video automáticamente
  - **Botón Rechazar** → notifica al cliente

---

### 15.7 Guía paso a paso: configurar un video de cobro individual

1. Ir a `/admin/videos/upload` (o editar existente)
2. Llenar título, categoría, nivel
3. En **Acceso**: `"gratuito"` (todos ven la miniatura) o `"miembros"` (solo miembros)
4. En **Venta de clases**: activar **"Activar precio promocional"**
5. Activar **"Requiere compra para ver"** si el video debe estar bloqueado hasta pago
6. Ingresar **Precio en MXN**
7. Opcionalmente: créditos de clase incluidos, texto del botón
8. Guardar
9. Cuando el cliente paga: `/admin/videos/ventas` → buscar orden → **Aprobar** → video desbloqueado

---

## 16. Reportes

**Archivos:** `src/pages/admin/reports/`
- `ReportsOverview.tsx`, `ReportsRevenue.tsx`, `ReportsClasses.tsx`
- `ReportsRetention.tsx`, `ReportsInstructors.tsx`, `InstructorDetail.tsx`

### API
| Reporte | Endpoint |
|---|---|
| Overview | `GET /reports/overview` |
| Ingresos | `GET /reports/revenue?start=&end=` |
| Clases | `GET /reports/classes` |
| Retención | `GET /reports/retention` |
| Instructores | `GET /reports/instructors` |
| Detalle instructor | `GET /reports/instructors/:id` |

### Campos overview
```ts
{
  activeMembers: number
  monthlyRevenue: number
  monthlyBookings: number
  classOccupancyRate: number    // 0–100%
  newMembersThisMonth: number
  churnRate: number
}
```

---

## 17. Reseñas

**Archivos:** `src/pages/admin/reviews/AdminReviewsDashboard.tsx`, `ReviewTagsManager.tsx`

### API
| Acción | Endpoint |
|---|---|
| Stats | `GET /reviews/stats?start=&end=&instructorId=` |
| Listado | `GET /reviews?page=&limit=&instructorId=&rating=` |
| Tags CRUD | `GET|POST /review-tags` · `PUT|DELETE /review-tags/:id` |

---

## 18. Configuración

**Archivos:** `src/pages/admin/settings/`

### API (patrón key-value)
```
GET  /settings/:key          → { key, value: {...} }
PUT  /settings/:key          Body: { value: {...} }
GET  /evolution/status
POST /evolution/connect|disconnect|send-test
```

### Keys
```
general_settings      → timezone, currency, date_format, language, maintenance_mode
studio_settings       → name, logo, address, phone, social_links
notification_settings → email_reminders, whatsapp_reminders, reminder_hours_before
policies_settings     → cancellation_policy, terms_of_service
```

### WhatsApp (Evolution API)
```ts
{
  provider: "evolution"
  connected: boolean
  state: "connected" | "disconnected" | "not_configured" | "qr_pending"
  number?: string
}
```
- Polling cada 3s cuando `state === "qr_pending"` hasta mostrar QR para escanear

---

## 19. Arquitectura y patrones comunes

### Estructura interna de cada página

```tsx
// 1. Zod schema
const schema = z.object({ ... });

// 2. useQuery — leer datos
const { data, isLoading } = useQuery({
  queryKey: ['clave', filtros],
  queryFn: async () => (await api.get('/endpoint')).data,
});

// 3. useMutation — escribir datos
const mutation = useMutation({
  mutationFn: (data) => api.post('/endpoint', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['clave'] });
    toast({ title: 'Éxito' });
  },
});

// 4. useState — UI local
const [open, setOpen] = useState(false);

// 5. JSX
return (
  <AuthGuard requiredRoles={['admin']}>
    <AdminLayout>
      {/* Header + Filtros + Tabla + Dialog de formulario */}
    </AdminLayout>
  </AuthGuard>
);
```

### Componentes Shadcn/ui usados
```
Button, Input, Label, Badge, Skeleton, Switch, Progress
Table / TableBody / TableRow / TableCell / TableHead / TableHeader
Dialog / DialogContent / DialogHeader / DialogFooter
AlertDialog / AlertDialogAction / AlertDialogCancel
DropdownMenu / DropdownMenuItem
Select / SelectItem
Tabs / TabsList / TabsTrigger / TabsContent
useToast
```

### Roles y guard
```tsx
<AuthGuard requiredRoles={['admin']}>
  <AdminLayout>{/* módulo */}</AdminLayout>
</AuthGuard>
// Roles: admin · instructor · client · coach · super_admin · reception
```

### Todos los endpoints del backend

```
BASE URL: /api

Auth:         POST /auth/login · /auth/register · /auth/forgot-password
              POST /auth/reset-password · GET /auth/me
Users:        GET|PUT /users · GET|PUT|DELETE /users/:id
Plans:        CRUD /plans
Memberships:  CRUD /memberships · PUT /memberships/:id/activate|cancel
Classes:      GET /classes?start=&end= · POST|PUT|DELETE /classes/:id
              PUT /classes/:id/cancel · POST /classes/generate
ClassTypes:   CRUD /class-types
Schedules:    CRUD /schedules
Bookings:     CRUD /bookings · PUT /bookings/:id/check-in
Instructors:  CRUD /instructors · POST /instructors/:id/photo
              POST /instructors/:id/magic-link
Payments:     POST /payments · GET /payments/reports|pending
Orders:       GET /orders/pending · GET /orders · GET /orders/:id
              PUT /orders/:id/verify|reject
Products:     CRUD /products
POS:          POST /pos/checkout · GET /pos/orders
DiscountCodes:CRUD /discount-codes · POST /discount-codes/validate
Loyalty:      GET|PUT /loyalty/config · CRUD /loyalty/rewards
              POST /loyalty/points/:userId/adjust
Referrals:    GET /referrals · /referrals/codes · /referrals/stats
              GET /referrals/code · /referrals/my-referrals
Videos:       CRUD /videos · POST /videos/upload
              GET /videos/categories · GET /videos/purchases/pending
              POST /videos/purchases/:id/approve|reject
              POST /videos/:id/purchase · POST /videos/:id/view
              POST /videos/purchases/:id/proof
Reports:      GET /reports/overview|revenue|classes|retention
              GET /reports/instructors · /reports/instructors/:id
Reviews:      GET|POST /reviews · GET /reviews/stats
              CRUD /review-tags
Settings:     GET|PUT /settings/:key
Evolution:    GET /evolution/status
              POST /evolution/connect|disconnect|send-test
Admin:        GET /admin/stats
```
