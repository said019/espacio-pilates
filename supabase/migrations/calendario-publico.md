# Calendario Público de Clases — Documentación Completa

> **Componente:** `src/components/Schedule.tsx` (524 líneas)
> **Visible en:** Landing page (`/`), sección `#horarios`
> **Propósito:** Permite a cualquier visitante (autenticado o no) ver las clases de la semana y reservar un lugar.

---

## Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Interfaces y Tipos](#2-interfaces-y-tipos)
3. [Estado del Componente](#3-estado-del-componente)
4. [Fetch de Datos — API](#4-fetch-de-datos--api)
5. [Transformación de Datos](#5-transformación-de-datos)
6. [Lógica de Navegación Semanal](#6-lógica-de-navegación-semanal)
7. [Lógica de Tiempo en Tiempo Real](#7-lógica-de-tiempo-en-tiempo-real)
8. [Filtros por Tipo de Clase](#8-filtros-por-tipo-de-clase)
9. [Estructura Visual — Render](#9-estructura-visual--render)
10. [Cards de Clases](#10-cards-de-clases)
11. [Diálogo de Reserva — BookingDialog](#11-diálogo-de-reserva--bookingdialog)
12. [CTA Final](#12-cta-final)
13. [Resumen de Dependencias](#13-resumen-de-dependencias)

---

## 1. Arquitectura General

```
Landing Page (/)
└── <Schedule />                    src/components/Schedule.tsx
    ├── Header oscuro
    │   ├── Título "Horario de clases"
    │   ├── Navegación ← semana →
    │   └── 7 pills de días (Dom–Sáb)
    │
    ├── Área de contenido
    │   ├── Resumen "N clases · fecha"
    │   ├── Filter pills (Todas | tipo1 | tipo2 ...)
    │   └── Grid de cards de clases (1→2→3 columnas)
    │       └── <BookingDialog />    src/components/BookingDialog.tsx
    │
    └── CTA "¿Primera vez en Catarsis?"
```

**No requiere autenticación para ver** — el endpoint `GET /classes` es público.
**Sí requiere autenticación para reservar** — `<BookingDialog>` redirige a login si el usuario no está autenticado.

---

## 2. Interfaces y Tipos

### `ApiClass` — Respuesta del backend

```typescript
interface ApiClass {
  id: string;
  date: string;           // 'YYYY-MM-DDTHH:MM...' (campo alternativo)
  class_date: string;     // 'YYYY-MM-DDTHH:MM...' (campo principal)
  start_time: string;     // 'HH:MM:SS'
  end_time: string;       // 'HH:MM:SS'
  class_type_name: string;
  class_type_color: string;   // hex, ej: '#8C8475'
  instructor_name: string;
  capacity: number;
  current_bookings: number;
  status: string;             // 'active' | 'cancelled' | ...
}
```

### `ScheduleClass` — Modelo interno (post-transformación)

```typescript
interface ScheduleClass {
  id: string;
  name: string;         // = class_type_name
  time: string;         // ISO: 'YYYY-MM-DDTHH:MM' (date + start_time)
  endTime: string;      // 'HH:MM:SS' raw del backend
  duration: number;     // fijo: 50 (minutos) — no viene del API
  instructor: string;
  spots: number;        // capacity - current_bookings (mín 0)
  maxSpots: number;     // = capacity
  color: string;        // class_type_color o fallback
}
```

### `ClassItem` — Lo que recibe `<BookingDialog>`

```typescript
interface ClassItem {
  id: string;
  time: string;       // formateado 'HH:MM'
  type: string;       // nombre del tipo de clase
  instructor: string;
  spots: number;
  duration: string;   // '50 min' (string fijo)
  date?: Date;        // objeto Date para mostrar la fecha completa
}
```

### Colores de fallback (si el backend no devuelve `class_type_color`)

```typescript
const fallbackColors: Record<string, string> = {
  'Barré':       '#8C8475',
  'Pilates Mat': '#A2A88B',
  'Yoga Sculpt': '#B7AE9B',
  'Sculpt':      '#C4A882',
};
// Si el nombre no coincide → '#A48550' (dorado Catarsis)
```

---

## 3. Estado del Componente

| Variable | Tipo | Valor inicial | Descripción |
|----------|------|---------------|-------------|
| `selectedDate` | `Date` | `new Date()` (hoy) | Día que el usuario tiene seleccionado para ver clases |
| `weekStart` | `Date` | `startOfWeek(hoy, { weekStartsOn: 1 })` | Primer día (lunes) de la semana visible |
| `selectedClass` | `ClassItem \| null` | `null` | Clase pasada a `<BookingDialog>` al hacer click en "Reservar" |
| `dialogOpen` | `boolean` | `false` | Controla si el diálogo de reserva está abierto |
| `filter` | `string` | `'all'` | Tipo de clase activo en los filter pills |
| `now` | `Date` | `new Date()` | Hora actual; se actualiza cada **30 segundos** con `setInterval` |

### Actualización automática de `now`

```typescript
useEffect(() => {
  const interval = setInterval(() => setNow(new Date()), 30_000);
  return () => clearInterval(interval);
}, []);
```

Esto hace que los badges "En curso · 12 min restantes" y "En 45 min" se actualicen solos cada 30 segundos sin que el usuario recargue la página.

---

## 4. Fetch de Datos — API

```typescript
const startDate = format(weekStart, 'yyyy-MM-dd');
const endDate   = format(addDays(weekStart, 13), 'yyyy-MM-dd');  // +13 días = 2 semanas

const { data: apiClasses, isLoading } = useQuery<ApiClass[]>({
  queryKey: ['public-classes', startDate, endDate],
  queryFn: async () => {
    const { data } = await api.get(`/classes?start_date=${startDate}&end_date=${endDate}`);
    return data;
  },
  staleTime: 1000 * 60 * 2,  // 2 minutos de caché
});
```

**Endpoint:** `GET /api/classes?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

**Rango:** Carga **2 semanas completas** de una sola vez. Esto permite que al navegar a la semana siguiente con el botón `→`, las clases ya estén en caché y no haya un nuevo fetch.

**Cache key:** Cambia cuando cambia `weekStart` (al avanzar 2 semanas o más), forzando un nuevo fetch.

---

## 5. Transformación de Datos

```typescript
const allClasses: ScheduleClass[] = useMemo(() => {
  if (!apiClasses) return [];
  return apiClasses
    .filter((cls) => cls.status !== 'cancelled')   // excluye clases canceladas
    .map((cls) => {
      const dateStr  = (cls.date || cls.class_date || '').split('T')[0];  // toma solo 'YYYY-MM-DD'
      const available = cls.capacity - (cls.current_bookings || 0);
      return {
        id:         cls.id,
        name:       cls.class_type_name,
        time:       `${dateStr}T${cls.start_time}`,  // ISO combinado: '2026-02-26T09:00'
        endTime:    cls.end_time || '',
        duration:   50,                              // hardcoded
        instructor: cls.instructor_name || 'Por confirmar',
        spots:      Math.max(0, available),          // nunca negativo
        maxSpots:   cls.capacity,
        color:      cls.class_type_color || fallbackColors[cls.class_type_name] || '#A48550',
      };
    });
}, [apiClasses]);
```

---

## 6. Lógica de Navegación Semanal

### Botones ← →

```typescript
// Retroceder 1 semana
onClick={() => setWeekStart((prev) => subWeeks(prev, 1))

// Avanzar 1 semana
onClick={() => setWeekStart((prev) => addWeeks(prev, 1))
```

### Los 7 días de la semana (pills)

```typescript
const weekDays = useMemo(
  () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
  [weekStart]
);
```

Genera un array `[lunes, martes, ..., domingo]` a partir del `weekStart`.

### Reglas de los pills

| Condición | Estilo | Clickeable |
|-----------|--------|------------|
| Día seleccionado | Fondo `catarsis-gold`, texto blanco, escala 1.03 | Sí |
| Hoy (no seleccionado) | Borde `catarsis-gold/30`, número dorado | Sí |
| Día futuro | Fondo translúcido blanco/5 | Sí |
| Día pasado | Opacidad 30%, `cursor-not-allowed` | **No** — `disabled` |

### Dots debajo del número de día

Muestra puntos (●) según cuántas clases hay ese día:
- Máximo 4 dots visibles
- Si hay más de 4 → muestra `+` al final
- Color: blanco si seleccionado, dorado si hoy, arena/30 si futuro
- **No aparecen en días pasados**

---

## 7. Lógica de Tiempo en Tiempo Real

`getTimeStatus(cls)` — solo se ejecuta para clases del día de **hoy**:

```typescript
const getTimeStatus = (cls: ScheduleClass) => {
  const classStart = parseISO(cls.time);
  if (!isToday(classStart)) return null;          // días que no son hoy → sin badge

  const dateStr     = cls.time.split('T')[0];
  const endDateTime = cls.endTime
    ? parseISO(`${dateStr}T${cls.endTime}`)
    : new Date(classStart.getTime() + cls.duration * 60_000);  // fallback: +50 min

  if (now >= endDateTime)   return { status: 'past',        label: 'Finalizada' };
  if (now >= classStart)    return { status: 'in-progress', label: `En curso · ${minsLeft} min restantes` };

  // Próxima: calcula tiempo restante
  const minsUntil = differenceInMinutes(classStart, now);
  if (minsUntil < 60)  return { status: 'upcoming', label: `En ${minsUntil} min` };
  if (mins === 0)      return { status: 'upcoming', label: `En ${hours}h` };
                       return { status: 'upcoming', label: `En ${hours}h ${mins}m` };
};
```

### Badges visuales resultantes

| Status | Color de badge | Ejemplo |
|--------|---------------|---------|
| `past` | Gris (`bg-muted`) | `Finalizada` |
| `in-progress` | Dorado con `animate-pulse` + punto dorado | `En curso · 23 min restantes` |
| `upcoming` | Verde (`bg-emerald-50`) + punto verde | `En 45 min` / `En 1h 30m` |
| `null` (días != hoy) | No se muestra | — |

---

## 8. Filtros por Tipo de Clase

```typescript
// Tipos únicos disponibles para el día seleccionado
const uniqueTypes = useMemo(
  () => [...new Set(dayClasses.map((c) => c.name))],
  [dayClasses]
);

// Clases filtradas para mostrar en el grid
const filteredClasses = useMemo(() => {
  if (filter === 'all') return dayClasses;
  return dayClasses.filter((c) => c.name === filter);
}, [dayClasses, filter]);
```

- Solo aparecen los tipos que existen en el día seleccionado
- Al cambiar de día, el filter se resetea a `'all'`
- Si se filtra por tipo y no hay clases → muestra botón "Ver todas" para quitar el filtro

---

## 9. Estructura Visual — Render

### Sección del header (fondo oscuro)

```
┌────────────────────────────────────────────────────────────┐
│  bg-gradient-to-br from-catarsis-dark via-[#3D3229]        │
│                                                            │
│  Decoradores: 3 blobs de luz difusa (absolute)             │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [label pequeño] CATARSIS STUDIO                     │  │
│  │  [h2] Horario de clases                              │  │
│  │  [separador] ────────                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ← [Mes Año] →                                             │
│                                                            │
│  [Lun 23] [Mar 24] [Mié 25] [Jue 26] [Vie 27] [Sáb 28] [Dom 1]  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Sección de contenido (fondo claro)

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  3 clases  · jue 26 feb                                    │
│                                                            │
│  [Todas]  [Barré]  [Pilates Mat]                           │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  card 1  │  │  card 2  │  │  card 3  │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  ¿Primera vez en Catarsis?                         │    │
│  │  Prueba una clase sin compromiso                   │    │
│  │  [Reservar clase de prueba  $150]                  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 10. Cards de Clases

Layout de cada card (grid 1 col en mobile, 2 en sm, 3 en xl):

```
┌──────────────────────────────────────────────────────────┐
│ ████████████████████████████████████  ← barra de color   │
│                                          (1px, color del  │
│ [badge de tiempo — solo hoy]              tipo de clase)  │
│                                                           │
│  Pilates Mat              [Reservar]  ← botón o badge     │
│  🕐 09:00 — 10:00 · Ana García                           │
│                                                           │
│  ████████████░░░░░░   4 / 12          ← barra capacidad   │
└──────────────────────────────────────────────────────────┘
```

### Estados de la card

| Condición | Efecto visual | Botón |
|-----------|--------------|-------|
| Normal | Sombra `shadow-sm`, borde `border/80` | `[Reservar]` dorado |
| Hover | `shadow-md`, `-translate-y-0.5`, borde `catarsis-gold/30` | — |
| En curso (hoy) | `ring-2 ring-catarsis-gold/40` | `[Reservar]` |
| Sin lugares (`spots = 0`) | `opacity-55` | `[Llena]` gris |
| Finalizada (hoy) | `opacity-55`, barra gris | `[Finalizada]` gris |

### Barra de capacidad

```typescript
const spotsPercent = ((cls.maxSpots - cls.spots) / cls.maxSpots) * 100;
// spotsPercent = % de ocupación (0 = vacío, 100 = lleno)
```

| Condición | Color de la barra | Texto del contador |
|-----------|------------------|--------------------|
| `spots = 0` | Rojo `#E57373` | `"Sin lugares"` en rojo |
| `spots <= 2` | Naranja `#F0A050` | número naranja + `/ max` |
| `spots > 2` | Color del tipo de clase | número con color del tipo + `/ max` |

---

## 11. Diálogo de Reserva — BookingDialog

Cuando se hace click en "Reservar":

```typescript
const handleBook = (cls: ScheduleClass) => {
  setSelectedClass({
    id:         cls.id,
    time:       formatTime(cls.time),   // 'HH:MM'
    type:       cls.name,
    instructor: cls.instructor,
    spots:      cls.spots,
    duration:   `${cls.duration} min`, // '50 min'
    date:       parseISO(cls.time),    // Date object
  });
  setDialogOpen(true);
};
```

`<BookingDialog classData={selectedClass} open={dialogOpen} onOpenChange={setDialogOpen} />`

El `BookingDialog` maneja internamente:
- Verificar si el usuario está autenticado (si no → redirige a login)
- Llamada a `POST /bookings`
- Toast de confirmación

---

## 12. CTA Final

Al final de la sección, fuera del grid de clases:

```
bg-gradient-to-br from-catarsis-cream to-catarsis-sand/20
border border-catarsis-sand/30

¿Primera vez en Catarsis?
Prueba una clase sin compromiso

[Reservar clase de prueba  $150]
   ↓ enlace a:
/auth/register?returnUrl=/app/book
```

Lleva al usuario a registrarse y luego lo redirige directamente a la pantalla de reserva de clases (`/app/book`).

---

## 13. Resumen de Dependencias

### Librerías externas

| Librería | Uso |
|----------|-----|
| `date-fns` | `format`, `addDays`, `startOfWeek`, `isSameDay`, `parseISO`, `isToday`, `isPast`, `addWeeks`, `subWeeks`, `differenceInMinutes` |
| `date-fns/locale/es` | Formato de fechas en español |
| `@tanstack/react-query` | `useQuery` para fetch de clases |
| `react-router-dom` | `<Link>` para el CTA final |
| `lucide-react` | `Loader2`, `ChevronLeft`, `ChevronRight`, `Clock`, `User` |

### Componentes internos usados

| Componente | Descripción |
|------------|-------------|
| `BookingDialog` | `src/components/BookingDialog.tsx` — Modal de reserva |
| `api` | `src/lib/api.ts` — Axios con base URL configurada |

### Estilos (clases Tailwind personalizadas)

| Token | Color aproximado |
|-------|-----------------|
| `catarsis-dark` | Oscuro café-negro |
| `catarsis-gold` | Dorado (#A48550 aprox.) |
| `catarsis-sand` | Arena cálida |
| `catarsis-olive` | Oliva suave |
| `catarsis-cream` | Crema claro |
| `font-heading` | Fuente de títulos |
| `font-body` | Fuente de cuerpo |

---

## Flujo Completo del Usuario

```
Usuario visita  /
       │
       ▼
Carga Schedule.tsx
       │
       ├─ Muestra semana actual (Lunes–Domingo)
       ├─ Día de hoy seleccionado por defecto
       └─ Fetch: GET /classes?start_date=...&end_date=... (2 semanas)
                │
                ▼
       Muestra cards de clases del día seleccionado
                │
       ┌────────┼────────────────────────────┐
       │        │                            │
       ▼        ▼                            ▼
  Cambia día  Filtra tipo             Click "Reservar"
  (pill)      (filter chip)                  │
       │        │                            ▼
       └────────┘                   <BookingDialog>
                                            │
                                    ¿Autenticado?
                                    Sí → POST /bookings
                                    No → redirect /auth/login
```
