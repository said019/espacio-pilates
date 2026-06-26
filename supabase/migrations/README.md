# 🧠 PROMPT MAESTRO — Sistema de Studio / Gimnasio / Academia
> **Cómo usar este documento:** Pégalo completo en cualquier IA (ChatGPT, Claude, Copilot, Gemini) y dile: *"Implementa este sistema para [nombre de tu proyecto]"*. La IA tendrá todo el contexto necesario para replicar la arquitectura, los módulos, los flujos y el stack tecnológico exacto.

---

## ¿Qué es este sistema?

Una **plataforma web completa para studios de bienestar / gimnasios / academias** con dos portales diferenciados:

1. **Panel de Administración** (`/admin`) — gestión total del negocio
2. **Portal del Cliente** (`/app`) — experiencia self-service del alumno

Incluye: reservas de clases, membresías, pagos, videos on-demand con cobro individual por transferencia bancaria, lealtad, referidos, POS, reportes y notificaciones por WhatsApp.

---

## Stack tecnológico (usar exactamente este stack al replicar)

| Capa | Tecnología |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **UI Components** | Shadcn/ui + Tailwind CSS |
| **Estado global (auth)** | Zustand con `persist` en `localStorage` |
| **Estado servidor** | TanStack Query v5 (`useQuery` + `useMutation`) |
| **Formularios** | React Hook Form + Zod resolver |
| **HTTP** | Axios con interceptor de `Authorization: Bearer <token>` |
| **Router** | React Router v6 |
| **Fechas** | date-fns con `locale: es` |
| **Backend** | Express.js + PostgreSQL |
| **Almacenamiento video** | Cloudinary (upload directo via backend) |
| **Mensajería** | Evolution API (WhatsApp) |
| **Deploy** | Railway (backend) + Vercel (frontend) |

---

## Arquitectura de carpetas

```
src/
  pages/
    auth/           → Login, Register, ForgotPassword, ResetPassword
    admin/          → todos los módulos del panel de administración
    client/         → portal del cliente (área privada)
    coach/          → portal del instructor
  components/
    layout/
      AdminLayout.tsx     → sidebar + header del admin
      ClientLayout.tsx    → navbar/sidebar del cliente
      AuthGuard.tsx       → protección de rutas por rol
    ui/                   → componentes Shadcn/ui
  stores/
    authStore.ts          → Zustand, persiste en localStorage
  types/
    auth.ts               → User, Plan, Membership, AuthResponse
    booking.ts            → BookingClient
    membership.ts         → ClientMembership
    order.ts              → Order, OrderStatus
  lib/
    api.ts                → instancia Axios + interceptor de token
    memberships.ts        → helper fetchMyMembership()
```

---

## Roles del sistema

| Rol | Acceso |
|---|---|
| `admin` | Todo el panel `/admin` |
| `instructor` | Panel `/admin` (solo clases y videos propios) |
| `client` | Portal `/app` |
| `coach` | Portal `/coach` |
| `super_admin` | Mismo que admin + configuración avanzada |
| `reception` | Acceso limitado al POS y reservas |

---

## Variables de entorno necesarias

```env
VITE_API_URL=https://tubackend.railway.app/api
```

```env
# Backend
DATABASE_URL=postgresql://...
JWT_SECRET=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

---

## Documentación completa por área

| Archivo | Contenido |
|---|---|
| [admin.md](./admin.md) | Panel de administración — 18 módulos completos con campos, endpoints, UI y lógica de negocio. **Incluye flujo completo de videos con cobro por transferencia bancaria.** |
| [usuario.md](./usuario.md) | Portal del cliente — 20 módulos con tipos TypeScript, rutas, flujos de usuario y **flujo completo de compra de video individual por transferencia.** |

---

## Patrón de desarrollo que aplica a TODOS los módulos

Cada módulo sigue este patrón idéntico sin excepción:

```tsx
// 1. Zod schema para validación
const schema = z.object({ ... });

// 2. useQuery para leer datos
const { data, isLoading } = useQuery({
  queryKey: ['clave-unica', filtros],
  queryFn: async () => (await api.get('/endpoint')).data,
});

// 3. useMutation para crear/editar/eliminar
const mutation = useMutation({
  mutationFn: (data) => api.post('/endpoint', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['clave-unica'] });
    toast({ title: 'Éxito' });
  },
});

// 4. useState para UI local (dialogs, filtros)
const [open, setOpen] = useState(false);

// 5. JSX
return (
  <AuthGuard requiredRoles={['admin']}>
    <AdminLayout>
      {/* tabla / grid + dialog de formulario */}
    </AdminLayout>
  </AuthGuard>
);
```

---

## Instrucción para IA al replicar

Cuando uses esta documentación como prompt, añade al inicio:

> *"Eres un experto en React + TypeScript + Vite + Shadcn/ui + TanStack Query + React Hook Form + Zod + Axios + Zustand + React Router v6. Implementa el siguiente sistema siguiendo EXACTAMENTE el stack, la arquitectura de carpetas, los patrones de código y los flujos descritos. El nombre del proyecto es [TU_PROYECTO]. El dominio es [studios/gimnasio/academia/etc]. Mantén todos los nombres de endpoints, tipos TypeScript e interfaces tal como se describen."*
