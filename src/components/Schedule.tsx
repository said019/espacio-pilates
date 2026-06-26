import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  format, addDays, startOfWeek, isSameDay, parseISO,
  isToday, addWeeks, subWeeks, differenceInMinutes,
} from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, ChevronLeft, ChevronRight, Clock, ArrowUpRight } from "lucide-react";
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
  instructor_name: string;
  instructor_photo?: string;
  capacity: number;
  max_capacity?: number;
  current_bookings: number;
  status: string;
}

interface ScheduleClass {
  id: string;
  name: string;
  time: string;
  endTime: string;
  duration: number;
  instructor: string;
  instructorPhoto?: string | null;
  spots: number;
  maxSpots: number;
  color: string;
}

// ─── Fallback colors ──────────────────────────────────────────────────────────

const fallbackColors: Record<string, string> = {
  "Pilates Matt Clásico": "#D9B5BA",
  "Pilates Terapéutico":  "#8C6B6F",
  "Flex & Flow":          "#D9B5BA",
  "Body Strong":          "#8C6B6F",
  "Pilates Clásico":      "#D9B5BA",
  "Flow Pilates":         "#D9B5BA",
  "Pilates Mat":          "#D9B5BA",
};
const DEFAULT_COLOR = "#8C6B6F";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  try { return format(parseISO(iso), "HH:mm"); } catch { return iso.slice(11, 16); }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Schedule() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekStart, setWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(new Date());
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setFilter("all"); }, [selectedDate]);

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
        // Compute real duration from start/end times (e.g. 07:00 → 07:55 = 55 min)
        const computedDuration = (() => {
          if (!startTimePart || !endTimePart) return 55;
          const [sh, sm] = startTimePart.split(":").map(Number);
          const [eh, em] = endTimePart.split(":").map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm);
          return mins > 0 ? mins : 55;
        })();
        return {
          id:         c.id,
          name:       c.class_type_name ?? "Clase",
          time:       `${dateStr}T${startTimePart}`,
          endTime:    endTimePart,
          duration:   computedDuration,
          instructor: c.instructor_name ?? "Por confirmar",
          instructorPhoto: (c as any).instructor_photo ?? null,
          spots:      Math.max(0, available),
          maxSpots:   c.capacity ?? (c as any).max_capacity ?? 1,
          color:      c.class_type_color || fallbackColors[c.class_type_name] || DEFAULT_COLOR,
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

  const uniqueTypes = useMemo(
    () => [...new Set(dayClasses.map((c) => c.name))],
    [dayClasses]
  );

  const filteredClasses = useMemo(
    () => filter === "all" ? dayClasses : dayClasses.filter((c) => c.name === filter),
    [dayClasses, filter]
  );

  const getTimeStatus = (cls: ScheduleClass) => {
    try {
      const classStart = parseISO(cls.time);
      if (!isToday(classStart)) return null;

      const dateStr     = cls.time.split("T")[0];
      const endDateTime = cls.endTime
        ? parseISO(`${dateStr}T${cls.endTime.slice(0, 5)}`)
        : new Date(classStart.getTime() + cls.duration * 60_000);

      if (now >= endDateTime) return { status: "past", label: "Finalizada" };
      if (now >= classStart) {
        const minsLeft = differenceInMinutes(endDateTime, now);
        return { status: "in-progress", label: `En curso · ${minsLeft} min` };
      }
      const minsUntil = differenceInMinutes(classStart, now);
      if (minsUntil < 60) return { status: "upcoming", label: `En ${minsUntil} min` };
      const hours = Math.floor(minsUntil / 60);
      const mins  = minsUntil % 60;
      return { status: "upcoming", label: mins === 0 ? `En ${hours}h` : `En ${hours}h ${mins}m` };
    } catch { return null; }
  };

  const classCountByDay = useMemo(() => {
    const map: Record<string, number> = {};
    allClasses.forEach((c) => {
      const key = c.time.split("T")[0];
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [allClasses]);

  const handleBook = (cls: ScheduleClass) => {
    setSelectedClass({
      id:         cls.id,
      time:       formatTime(cls.time),
      type:       cls.name,
      instructor: cls.instructor,
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
    <section id="horario" className="scroll-mt-16 py-20 lg:py-28 px-5 sm:px-8 bg-white">
      <div className="max-w-7xl mx-auto">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="reveal opacity-0 translate-y-10 transition-all duration-700">
          <div className="text-[0.72rem] tracking-[0.18em] uppercase text-[#8C6B6F] font-semibold mb-4 flex items-center gap-3">
            <span className="w-8 h-[1px] bg-[#8C6B6F]/40 inline-block" />
            Horario semanal
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-10">
            <h2 className="font-bebas text-[clamp(2.8rem,4.5vw,4.5rem)] leading-[0.95] text-[#1A1A1A]">
              RESERVA TU CLASE
            </h2>
            <p className="text-[0.9rem] text-[#3D3A3A] max-w-[380px] leading-[1.7] font-alilato">
              Consulta el horario y reserva tu lugar. Los espacios son limitados.
            </p>
          </div>
        </div>

        {/* ── Month nav ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setWeekStart((p) => subWeeks(p, 1))}
            className="w-10 h-10 rounded-full border border-[#F0D0D5] bg-[#FAE5E7] flex items-center justify-center text-[#3D3A3A] hover:border-[#8C6B6F] hover:text-[#8C6B6F] transition-all cursor-pointer"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <h3 className="flex-1 font-alilato text-[1.3rem] font-semibold text-[#1A1A1A]">
            <span className="capitalize">{format(weekStart, "MMMM", { locale: es })}</span>{" "}
            <span className="text-[#8C6B6F]">{format(weekStart, "yyyy")}</span>
          </h3>
          <button
            onClick={() => setWeekStart((p) => addWeeks(p, 1))}
            className="w-10 h-10 rounded-full border border-[#F0D0D5] bg-[#FAE5E7] flex items-center justify-center text-[#3D3A3A] hover:border-[#8C6B6F] hover:text-[#8C6B6F] transition-all cursor-pointer"
            aria-label="Semana siguiente"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* ── Week strip ────────────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8" style={{ scrollbarWidth: "none" }}>
          {weekDays.map((day) => {
            const past     = isPastDay(day);
            const selected = isSameDay(day, selectedDate);
            const todayDay = isToday(day);
            const dayKey   = format(day, "yyyy-MM-dd");
            const count    = classCountByDay[dayKey] ?? 0;
            const dotCount = Math.min(count, 4);

            return (
              <button
                key={dayKey}
                disabled={past}
                onClick={() => setSelectedDate(day)}
                className={[
                  "flex flex-col items-center gap-1.5 px-5 py-3.5 rounded-2xl min-w-[72px] select-none transition-all duration-200 border cursor-pointer",
                  past ? "opacity-30 cursor-not-allowed" : "",
                  selected
                    ? "bg-[#8C6B6F] border-[#8C6B6F] text-white shadow-[0_4px_20px_rgba(148,134,122,0.3)] -translate-y-0.5"
                    : todayDay
                      ? "bg-[#FAE5E7] border-[#D9B5BA]/40 text-[#1A1A1A]"
                      : "bg-[#FAE5E7] border-[#F0D0D5] text-[#1A1A1A] hover:border-[#8C6B6F]/30 hover:-translate-y-0.5",
                ].join(" ")}
              >
                <span className={[
                  "text-[10px] font-semibold tracking-[0.12em] uppercase",
                  selected ? "text-white/70" : "text-[#3D3A3A]/60",
                ].join(" ")}>
                  {format(day, "EEE", { locale: es })}
                </span>
                <span className={[
                  "font-bebas text-[1.5rem] leading-none",
                  selected ? "text-white" : todayDay ? "text-[#8C6B6F]" : "text-[#1A1A1A]",
                ].join(" ")}>
                  {format(day, "d")}
                </span>
                <div className="flex gap-[3px] h-[6px] items-center justify-center">
                  {Array.from({ length: dotCount }).map((_, i) => (
                    <span
                      key={i}
                      className="w-1 h-1 rounded-full"
                      style={{
                        background: selected ? "rgba(255,255,255,0.6)"
                          : todayDay ? "#D9B5BA"
                          : "#8C6B6F40",
                      }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── FILTERS ROW ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 flex-wrap">
          <div className="font-alilato text-[1.1rem] font-semibold text-[#1A1A1A]">
            {filteredClasses.length} clase{filteredClasses.length !== 1 ? "s" : ""}{" "}
            <span className="text-[#3D3A3A]/50 text-[0.88rem] font-normal">
              · {format(selectedDate, "EEE d 'de' MMMM", { locale: es })}
            </span>
          </div>

          {uniqueTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilter("all")}
                className={[
                  "px-4 py-2 rounded-full text-[0.75rem] font-semibold transition-all border cursor-pointer",
                  filter === "all"
                    ? "bg-[#8C6B6F] border-[#8C6B6F] text-white shadow-[0_2px_12px_rgba(148,134,122,0.25)]"
                    : "bg-[#FAE5E7] border-[#F0D0D5] text-[#3D3A3A] hover:border-[#8C6B6F]/40 hover:text-[#8C6B6F]",
                ].join(" ")}
              >
                Todas
              </button>
              {uniqueTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={[
                    "px-4 py-2 rounded-full text-[0.75rem] font-semibold transition-all border cursor-pointer",
                    filter === t
                      ? "bg-[#8C6B6F] border-[#8C6B6F] text-white shadow-[0_2px_12px_rgba(148,134,122,0.25)]"
                      : "bg-[#FAE5E7] border-[#F0D0D5] text-[#3D3A3A] hover:border-[#8C6B6F]/40 hover:text-[#8C6B6F]",
                  ].join(" ")}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── CARDS ───────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-[#3D3A3A]/40 gap-2">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm tracking-wide font-alilato">Cargando clases...</span>
          </div>
        ) : filteredClasses.length === 0 ? (
          <div className="text-center py-20 text-[#3D3A3A]/50">
            <p className="text-sm font-alilato">No hay clases para este día.</p>
            {filter !== "all" && (
              <button onClick={() => setFilter("all")} className="mt-3 text-[#8C6B6F] text-sm underline underline-offset-2 cursor-pointer bg-transparent border-none">
                Ver todas
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredClasses.map((cls, idx) => {
              const ts           = getTimeStatus(cls);
              const isPast       = ts?.status === "past";
              const inProg       = ts?.status === "in-progress";
              const upcoming     = ts?.status === "upcoming";
              const full         = cls.spots === 0;
              const spotsPercent = ((cls.maxSpots - cls.spots) / cls.maxSpots) * 100;
              const accent       = cls.color || DEFAULT_COLOR;
              const initials     = cls.instructor.split(" ").map((w: string) => w[0]).slice(0, 2).join("");

              const badgeCfg = (() => {
                if (isPast)   return { label: "Finalizada", bg: "#F0D0D5", color: "#3D3A3A", dot: false };
                if (inProg)   return { label: ts!.label, bg: `${accent}18`, color: accent, dot: "pulse" };
                if (upcoming) return { label: ts!.label, bg: `${accent}12`, color: accent, dot: true };
                return null;
              })();

              return (
                <div
                  key={cls.id}
                  style={{ animationDelay: `${idx * 0.06}s` }}
                  className={[
                    "relative bg-[#FAE5E7] border border-[#F0D0D5] rounded-2xl p-6 overflow-hidden",
                    "transition-all duration-300 group",
                    isPast ? "opacity-50" : "hover:border-[#D9B5BA]/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:-translate-y-1 cursor-pointer",
                    "animate-[fadeSlideUp_0.4s_both]",
                  ].join(" ")}
                  onClick={() => !isPast && !full && handleBook(cls)}
                >
                  {/* Accent top line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
                    style={{ background: isPast ? "#E3B8BE" : accent }}
                  />

                  {/* ── Card top row ── */}
                  <div className="flex items-start justify-between mb-4 mt-1">
                    {badgeCfg ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[0.68rem] font-semibold tracking-wide uppercase"
                        style={{ background: badgeCfg.bg, color: badgeCfg.color }}
                      >
                        {badgeCfg.dot && (
                          <span
                            className={["w-1.5 h-1.5 rounded-full", badgeCfg.dot === "pulse" ? "animate-pulse" : ""].join(" ")}
                            style={{ background: badgeCfg.color }}
                          />
                        )}
                        {badgeCfg.label}
                      </span>
                    ) : (
                      <span />
                    )}

                    {!isPast && (
                      <button
                        disabled={full}
                        onClick={(e) => { e.stopPropagation(); !full && handleBook(cls); }}
                        className={[
                          "px-4 py-2 rounded-full text-[0.72rem] font-semibold tracking-wide transition-all cursor-pointer",
                          full
                            ? "bg-[#F0D0D5] text-[#3D3A3A]/40 cursor-not-allowed"
                            : "text-white hover:scale-105 hover:shadow-lg",
                        ].join(" ")}
                        style={!full ? {
                          background: accent,
                          boxShadow: `0 4px 16px ${accent}40`,
                        } : {}}
                      >
                        {full ? "Llena" : "Reservar"}
                      </button>
                    )}
                  </div>

                  {/* ── Class name ── */}
                  <h3 className="font-alilato font-bold text-[1.2rem] leading-tight text-[#1A1A1A] mb-3 group-hover:text-[#8C6B6F] transition-colors">
                    {cls.name}
                  </h3>

                  {/* ── Time row ── */}
                  <div className="flex items-center gap-2 mb-3 text-[0.82rem]">
                    <Clock size={14} className="text-[#8C6B6F] shrink-0" />
                    <span className="text-[#1A1A1A] font-medium">
                      {formatTime(cls.time)}{cls.endTime ? ` — ${cls.endTime.slice(0, 5)}` : ""}
                    </span>
                    <span className="ml-auto bg-white text-[#3D3A3A] text-[0.7rem] px-2.5 py-0.5 rounded-full font-medium">
                      {cls.duration} min
                    </span>
                  </div>

                  {/* ── Instructor ── */}
                  <div className="flex items-center gap-2.5 mb-4">
                    {cls.instructorPhoto ? (
                      <img
                        src={cls.instructorPhoto}
                        alt={cls.instructor}
                        className="w-7 h-7 rounded-full object-cover ring-2 ring-white shrink-0"
                      />
                    ) : (
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[0.65rem] font-bold text-white shrink-0"
                        style={{ background: accent }}
                      >
                        {initials}
                      </span>
                    )}
                    <span className="text-[0.82rem] text-[#3D3A3A] font-medium font-alilato">{cls.instructor}</span>
                  </div>

                  {/* ── Divider ── */}
                  <div className="h-px bg-[#F0D0D5] mb-3" />

                  {/* ── Capacity bar ── */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[0.68rem] font-semibold tracking-[0.08em] uppercase text-[#3D3A3A]/40">Lugares</span>
                      <span
                        className="text-[0.75rem] font-semibold"
                        style={{ color: full ? "#d97706" : "#1A1A1A" }}
                      >
                        {full
                          ? `${cls.maxSpots} / ${cls.maxSpots} — Lleno`
                          : `${cls.spots} disponibles`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#F0D0D5] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${spotsPercent}%`,
                          background: full
                            ? "#d97706"
                            : spotsPercent > 70
                              ? `linear-gradient(90deg, #d97706, ${accent})`
                              : accent,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── CTA ─────────────────────────────────────────────────────── */}
        <div className="mt-14 rounded-2xl border border-[#D9B5BA]/25 bg-[#FAE5E7] p-8 sm:p-10 text-center">
          <p className="text-[0.72rem] tracking-[0.18em] uppercase text-[#8C6B6F] font-semibold mb-2">
            ¿Primera vez en Valiance Pilates?
          </p>
          <h3 className="font-bebas text-[clamp(1.8rem,3vw,2.5rem)] leading-none text-[#1A1A1A] mb-3">
            Prueba una clase sin compromiso
          </h3>
          <p className="text-[0.88rem] text-[#3D3A3A] mb-7 max-w-sm mx-auto font-alilato">
            Reserva tu sesión muestra y descubre por qué cientos de mujeres eligen Valiance Pilates.
          </p>
          <Link
            to="/auth/register?returnUrl=/app/book"
            className="inline-flex items-center gap-2 bg-[#8C6B6F] text-white px-8 py-3.5 rounded-full text-[0.82rem] font-semibold tracking-wider uppercase hover:bg-[#6B4F53] hover:shadow-[0_12px_40px_rgba(148,134,122,0.3)] transition-all no-underline"
          >
            Reservar mi primera clase
            <ArrowUpRight size={15} strokeWidth={2.5} />
          </Link>
        </div>
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
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </section>
  );
}
