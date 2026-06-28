import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format, addDays, startOfWeek, isSameDay, parseISO,
  isToday, addWeeks, differenceInMinutes, getDay,
} from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import api from "@/lib/api";
import { BookingDialog, type ClassItem } from "@/components/BookingDialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiClass {
  id: string;
  date: string;
  class_date: string;
  start_time: string;
  end_time: string;
  class_type_name: string;
  class_type_color: string;
  capacity: number;
  max_capacity?: number;
  current_bookings: number;
  apparatus?: string;
  status: string;
}

interface ScheduleClass {
  id: string;
  name: string;
  time: string;        // 'yyyy-MM-ddTHH:mm'
  endTime: string;     // 'HH:mm'
  duration: number;    // minutos
  apparatus: "reformer" | "tower";
  spots: number;       // solo para detectar "lleno" — no se muestra
  maxSpots: number;
  color: string;
}

// Enfoque del día — index = getDay() (0=Dom … 6=Sáb)
const DAY_THEMES = [
  "",            // Domingo — sin clases
  "Lower body",  // Lunes — pierna & glúteo
  "Full body",   // Martes
  "Upper body",  // Miércoles — tren superior
  "Lower body",  // Jueves — pierna & glúteo
  "Full body",   // Viernes
  "Core",        // Sábado
] as const;

const DEFAULT_COLOR = "#716D64";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  try { return format(parseISO(iso), "HH:mm"); } catch { return iso.slice(11, 16); }
}

// "07:00" → "7:00 am" — formato cálido y legible
function prettyHHmm(hhmm: string) {
  const [hRaw, mRaw] = hhmm.split(":");
  let h = Number(hRaw); const m = Number(mRaw ?? 0);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h < 12 ? "am" : "pm";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Schedule() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekStart, setWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [now, setNow] = useState(new Date());
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const startDate = format(weekStart, "yyyy-MM-dd");
  const endDate   = format(addDays(weekStart, 13), "yyyy-MM-dd");

  const { data: rawClasses, isLoading } = useQuery<ApiClass[]>({
    queryKey: ["public-classes", startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get(`/classes?start=${startDate}&end=${endDate}`);
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    staleTime: 1000 * 60 * 2,
  });

  // ── Transform ──────────────────────────────────────────────────────────────
  const allClasses: ScheduleClass[] = useMemo(() => {
    if (!rawClasses) return [];
    return rawClasses
      .filter((c) => c.status !== "cancelled")
      .map((c) => {
        const dateStr = (c.date || c.class_date || (c.start_time?.split("T")[0]) || "").split("T")[0];
        const startTimePart = c.start_time?.includes("T")
          ? c.start_time.split("T")[1].slice(0, 5)
          : (c.start_time ?? "00:00").slice(0, 5);
        const endTimePart = c.end_time?.includes("T")
          ? c.end_time.split("T")[1].slice(0, 5)
          : (c.end_time ?? "").slice(0, 5);
        const available = (c.capacity ?? c.max_capacity ?? 0) - (c.current_bookings ?? 0);
        const computedDuration = (() => {
          if (!startTimePart || !endTimePart) return 55;
          const [sh, sm] = startTimePart.split(":").map(Number);
          const [eh, em] = endTimePart.split(":").map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm);
          return mins > 0 ? mins : 55;
        })();
        const apparatus: "reformer" | "tower" =
          (typeof c.apparatus === "string" && c.apparatus.toLowerCase() === "tower")
            ? "tower" : "reformer";
        return {
          id:         c.id,
          name:       c.class_type_name ?? "Pilates",
          time:       `${dateStr}T${startTimePart}`,
          endTime:    endTimePart,
          duration:   computedDuration,
          apparatus,
          spots:      Math.max(0, available),
          maxSpots:   c.capacity ?? (c as any).max_capacity ?? 8,
          color:      c.class_type_color || DEFAULT_COLOR,
        };
      });
  }, [rawClasses]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const dayClasses = useMemo(
    () => allClasses.filter((c) => {
      try { return isSameDay(parseISO(c.time), selectedDate); } catch { return false; }
    }).sort((a, b) => a.time.localeCompare(b.time)),
    [allClasses, selectedDate]
  );

  const classCountByDay = useMemo(() => {
    const map: Record<string, number> = {};
    allClasses.forEach((c) => {
      const key = c.time.split("T")[0];
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [allClasses]);

  const selectedTheme = DAY_THEMES[selectedDate.getDay()];

  // Estado temporal (solo para clases de hoy) — detalle cálido, no obligatorio
  const getTimeStatus = (cls: ScheduleClass) => {
    try {
      const classStart = parseISO(cls.time);
      if (!isToday(classStart)) return null;
      const dateStr     = cls.time.split("T")[0];
      const endDateTime = cls.endTime
        ? parseISO(`${dateStr}T${cls.endTime.slice(0, 5)}`)
        : new Date(classStart.getTime() + cls.duration * 60_000);
      if (now >= endDateTime) return { status: "past" as const, label: "Finalizada" };
      if (now >= classStart) {
        const minsLeft = differenceInMinutes(endDateTime, now);
        return { status: "in-progress" as const, label: `En curso · ${minsLeft} min` };
      }
      const minsUntil = differenceInMinutes(classStart, now);
      if (minsUntil < 60) return { status: "upcoming" as const, label: `En ${minsUntil} min` };
      const hours = Math.floor(minsUntil / 60);
      const mins  = minsUntil % 60;
      return { status: "upcoming" as const, label: mins === 0 ? `En ${hours}h` : `En ${hours}h ${mins}m` };
    } catch { return null; }
  };

  // Cambiar de semana arrastra el día seleccionado al mismo día de la nueva
  // semana, para que la tira y las tarjetas no queden desincronizadas.
  const shiftWeek = (delta: number) => {
    setWeekStart((prev) => {
      const nw = addWeeks(prev, delta);
      setSelectedDate((sd) => addDays(nw, (getDay(sd) + 6) % 7));
      return nw;
    });
  };

  const handleBook = (cls: ScheduleClass) => {
    setSelectedClass({
      id:         cls.id,
      time:       formatTime(cls.time),
      type:       cls.name,
      spots:      cls.spots,
      duration:   `${cls.duration} min`,
      date:       parseISO(cls.time),
      color:      cls.color,
    });
    setDialogOpen(true);
  };

  const isPastDay = (d: Date) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const check = new Date(d);  check.setHours(0, 0, 0, 0);
    return check < today;
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <section
      id="horario"
      className="scroll-mt-20 py-28 lg:py-40 px-6 sm:px-10 border-t border-valiance-charcoal/8"
    >
      <div className="max-w-[1200px] mx-auto">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-10">
          <div className="text-[0.7rem] tracking-[0.2em] uppercase text-valiance-mauve font-medium mb-5 flex items-center gap-3">
            <span className="w-8 h-px bg-valiance-gold/50 inline-block" />
            Horario semanal
          </div>
          <h2
            className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
            style={{ textWrap: "balance" } as React.CSSProperties}
          >
            Cada día, un enfoque distinto.
          </h2>
          <span className="block h-px w-16 bg-valiance-gold/50 mt-6 mb-6" />
          <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
            Trabajamos el cuerpo completo a lo largo de la semana. Tú eliges cuándo,
            nosotras marcamos el tema. Elige un día y reserva tu lugar — cupo de 8 por clase.
          </p>
        </div>

        {/* ── Semana nav ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 mb-5">
          <button
            onClick={() => shiftWeek(-1)}
            className="w-10 h-10 rounded-full border border-valiance-charcoal/12 bg-valiance-nude flex items-center justify-center text-valiance-mauve hover:border-valiance-mauve/40 hover:text-valiance-charcoal transition-all cursor-pointer"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
          <h3 className="flex-1 font-display text-[1.5rem] text-valiance-charcoal capitalize">
            {format(weekStart, "MMMM", { locale: es })}{" "}
            <span className="text-valiance-mauve/70">{format(weekStart, "yyyy")}</span>
          </h3>
          <button
            onClick={() => shiftWeek(1)}
            className="w-10 h-10 rounded-full border border-valiance-charcoal/12 bg-valiance-nude flex items-center justify-center text-valiance-mauve hover:border-valiance-mauve/40 hover:text-valiance-charcoal transition-all cursor-pointer"
            aria-label="Semana siguiente"
          >
            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* ── Tira de días (con tema muscular) ─────────────────────────────── */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5 mb-9">
          {weekDays.map((day) => {
            const past     = isPastDay(day);
            const selected = isSameDay(day, selectedDate);
            const todayDay = isToday(day);
            const dayKey   = format(day, "yyyy-MM-dd");
            const count    = classCountByDay[dayKey] ?? 0;
            const theme    = DAY_THEMES[day.getDay()];

            return (
              <button
                key={dayKey}
                disabled={past}
                onClick={() => setSelectedDate(day)}
                className={[
                  "flex flex-col items-center gap-1 px-1 sm:px-2 py-3.5 rounded-2xl select-none transition-all duration-200 border text-center",
                  past ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
                  selected
                    ? "bg-valiance-mauve border-valiance-mauve text-valiance-cream shadow-valiance-soft -translate-y-0.5"
                    : "bg-valiance-nude border-valiance-charcoal/8 text-valiance-charcoal hover:border-valiance-mauve/30 hover:-translate-y-0.5",
                ].join(" ")}
              >
                <span className={[
                  "text-[0.6rem] font-medium tracking-[0.12em] uppercase",
                  selected ? "text-valiance-cream/80" : "text-valiance-mauve",
                ].join(" ")}>
                  {format(day, "EEE", { locale: es })}
                </span>
                <span className={[
                  "font-display text-[1.5rem] leading-none",
                  selected ? "text-valiance-cream" : todayDay ? "text-valiance-mauve" : "text-valiance-charcoal",
                ].join(" ")}>
                  {format(day, "d")}
                </span>
                {theme && (
                  <span className={[
                    "hidden sm:block text-[0.56rem] leading-tight tracking-[0.02em] mt-0.5",
                    selected ? "text-valiance-cream/90" : "text-valiance-charcoal/70",
                  ].join(" ")}>
                    {theme}
                  </span>
                )}
                <span className={[
                  "mt-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[0.58rem] font-medium tabular-nums",
                  count === 0
                    ? (selected ? "text-valiance-cream/40" : "text-valiance-mauve/30")
                    : selected
                      ? "bg-valiance-surface2/20 text-valiance-cream"
                      : "bg-valiance-charcoal/[0.06] text-valiance-mauve",
                ].join(" ")}>
                  {count === 0 ? "·" : count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Encabezado del día seleccionado ──────────────────────────────── */}
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h3 className="font-display text-[1.7rem] leading-none text-valiance-charcoal capitalize">
              {format(selectedDate, "EEEE d", { locale: es })}
              <span className="text-valiance-mauve/60"> · {format(selectedDate, "MMMM", { locale: es })}</span>
            </h3>
            {selectedTheme && (
              <p className="font-body text-[0.85rem] text-valiance-mauve mt-2 tracking-wide">
                Enfoque del día — <span className="text-valiance-charcoal/80">{selectedTheme}</span>
              </p>
            )}
          </div>
          <span className="font-body text-[0.82rem] text-valiance-mauve tabular-nums">
            {dayClasses.length} clase{dayClasses.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── CARDS ───────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-valiance-mauve/40 gap-2">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm tracking-wide font-body">Cargando clases…</span>
          </div>
        ) : dayClasses.length === 0 ? (
          <div className="text-center py-24 rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8">
            <p className="font-display text-[1.3rem] text-valiance-charcoal/70">No hay clases este día.</p>
            <p className="text-sm font-body text-valiance-mauve/60 mt-1">Elige otro día de la semana.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {dayClasses.map((cls, idx) => {
              const ts       = getTimeStatus(cls);
              const isPast   = ts?.status === "past";
              const inProg   = ts?.status === "in-progress";
              const upcoming = ts?.status === "upcoming";
              const full     = cls.spots === 0;
              const isTower  = cls.apparatus === "tower";
              const bookable = !isPast && !full;

              const statusBadge = (() => {
                if (isPast) return { label: "Finalizada", cls: "bg-valiance-charcoal/[0.06] text-valiance-mauve", dot: false };
                if (inProg) return { label: ts!.label, cls: "bg-valiance-gold/20 text-valiance-charcoal/90", dot: "pulse" as const };
                if (upcoming) return { label: ts!.label, cls: "bg-valiance-blush/25 text-valiance-charcoal/80", dot: true };
                return null;
              })();

              return (
                <div
                  key={cls.id}
                  style={{ animationDelay: `${idx * 0.05}s` }}
                  className={[
                    "group relative rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8 border-t-2 p-7 flex flex-col gap-4",
                    "animate-[fadeSlideUp_0.4s_both] transition-all duration-300",
                    isTower ? "border-valiance-gold/45" : "border-valiance-gold/25",
                    isPast
                      ? "opacity-50"
                      : bookable
                        ? "hover:ring-valiance-blush/40 hover:-translate-y-1 hover:shadow-valiance-card"
                        : "",
                  ].join(" ")}
                >
                  {/* Hora + estado */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-[2.1rem] leading-none text-valiance-charcoal tabular-nums">
                        {prettyHHmm(formatTime(cls.time))}
                      </div>
                      <div className="font-body text-[0.8rem] text-valiance-mauve/80 mt-2 tabular-nums">
                        {cls.endTime ? `Hasta ${prettyHHmm(cls.endTime.slice(0, 5))}` : ""}
                        {cls.endTime ? " · " : ""}{cls.duration} min
                      </div>
                    </div>
                    {statusBadge && (
                      <span className={[
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.62rem] font-medium tracking-[0.08em] uppercase shrink-0",
                        statusBadge.cls,
                      ].join(" ")}>
                        {statusBadge.dot && (
                          <span className={["w-1.5 h-1.5 rounded-full bg-current", statusBadge.dot === "pulse" ? "animate-pulse" : ""].join(" ")} />
                        )}
                        {statusBadge.label}
                      </span>
                    )}
                  </div>

                  {/* Clase + aparato */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-display text-[1.2rem] text-valiance-charcoal/85">{cls.name}</span>
                    <span
                      className={[
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.58rem] tracking-[0.12em] uppercase font-medium",
                        isTower
                          ? "bg-valiance-lavender/50 text-valiance-plum ring-1 ring-valiance-gold/45"
                          : "bg-valiance-charcoal/[0.06] text-valiance-charcoal/80 ring-1 ring-valiance-charcoal/10",
                      ].join(" ")}
                    >
                      <span className={["w-1 h-1 rounded-full", isTower ? "bg-valiance-gold" : "bg-valiance-mauve/60"].join(" ")} />
                      {isTower ? "Tower" : (selectedTheme || "Pilates")}
                    </span>
                  </div>

                  {/* CTA */}
                  <div className="mt-1">
                    {isPast ? (
                      <span className="block text-center w-full py-2.5 rounded-full text-[0.78rem] font-medium tracking-wide text-valiance-mauve/50 bg-valiance-charcoal/[0.04]">
                        Finalizada
                      </span>
                    ) : full ? (
                      <span className="block text-center w-full py-2.5 rounded-full text-[0.78rem] font-medium tracking-wide text-valiance-mauve/60 bg-valiance-lavender/30">
                        Clase llena
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleBook(cls); }}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-valiance-mauve text-valiance-cream text-[0.78rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-charcoal transition-all cursor-pointer"
                      >
                        Reservar
                        <ArrowUpRight size={14} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Nota aparato */}
        <p className="text-[0.84rem] text-valiance-mauve mt-7 font-body">
          Todas las clases en Reformer · Viernes 8:30 pm en Tower.
        </p>

      </div>

      {/* Booking dialog */}
      <BookingDialog
        classData={selectedClass}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {}}
      />

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </section>
  );
}
