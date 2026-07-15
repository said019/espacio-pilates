import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  startOfWeek, endOfWeek, addWeeks, subWeeks, format,
  isBefore, isSameDay,
} from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { safeParse } from "@/lib/utils";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Check, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingClient } from "@/types/booking";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

// Enfoque del día (índice = getDay(): 0=Dom … 6=Sáb). Disciplina única.
const DAY_THEMES = [
  "",            // Domingo — sin clases
  "Lower body",  // Lunes — pierna & glúteo
  "Full body",   // Martes
  "Upper body",  // Miércoles — tren superior
  "Lower body",  // Jueves — pierna & glúteo
  "Full body",   // Viernes
  "Core",        // Sábado
] as const;

// "07:00" → "7:00 am" — formato cálido y legible.
const prettyTime = (date: Date): string => {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
};

const DEFAULT_CAPACITY = 8;

// ── Membership banner (rebranded VM: blush + ink + gold hairlines) ────────────
const MembershipBanner = ({ membership }: { membership: Record<string, unknown> }) => {
  const planName = (membership.planName ?? membership.plan_name) as string | undefined;
  const remaining = (membership.classesRemaining ?? membership.classes_remaining) as number | null | undefined;
  const isUnlimited = remaining === null || remaining === undefined || remaining === 9999;
  const endDate = (membership.endDate ?? membership.end_date) as string | undefined;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-valiance-charcoal/8 bg-valiance-nude px-5 py-3.5 ring-1 ring-valiance-gold/15 shadow-[0_12px_40px_-22px_rgba(184,145,90,0.30)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="inline-block w-6 h-px bg-valiance-gold shrink-0" />
        <span className="font-display text-[1.25rem] leading-none text-valiance-charcoal truncate">
          {planName ?? "Tu plan"}
        </span>
      </div>
      <div className="flex items-center gap-6 shrink-0">
        <div className="text-right">
          {isUnlimited ? (
            <div className="font-display text-[1.4rem] leading-none text-valiance-charcoal">Ilimitado</div>
          ) : (
            <div className="font-display text-[1.6rem] leading-none text-valiance-charcoal tabular-nums">{remaining}</div>
          )}
          <div className="text-[0.6rem] tracking-[0.18em] uppercase text-valiance-mauve mt-1">
            {isUnlimited ? "acceso" : remaining === 1 ? "clase restante" : "clases restantes"}
          </div>
        </div>
        {endDate && (
          <div className="text-right border-l border-valiance-lavender/30 pl-6">
            <div className="text-[0.82rem] font-medium text-valiance-charcoal/80 tabular-nums">
              {new Date(endDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
            </div>
            <div className="text-[0.6rem] tracking-[0.18em] uppercase text-valiance-mauve mt-1">vence</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const BookClasses = () => {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const navigate = useNavigate();

  const { data: classesData, isLoading: loadingClasses } = useQuery({
    queryKey: ["public-classes", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () =>
      (await api.get(`/classes?start=${format(weekStart, "yyyy-MM-dd")}&end=${format(weekEnd, "yyyy-MM-dd")}`)).data,
  });

  const { data: bookingsData } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => (await api.get("/bookings/my-bookings")).data,
  });

  const { data: membershipData } = useQuery({
    queryKey: ["my-membership"],
    queryFn: async () => (await api.get("/memberships/my")).data,
  });

  const classes: Record<string, unknown>[] = Array.isArray(classesData?.data)
    ? classesData.data
    : Array.isArray(classesData) ? classesData : [];
  const myBookings: BookingClient[] = Array.isArray(bookingsData?.data)
    ? bookingsData.data
    : Array.isArray(bookingsData) ? bookingsData : [];
  const rawMem = membershipData?.data !== undefined ? membershipData.data : membershipData;
  const membership = rawMem && typeof rawMem === "object" && "id" in rawMem
    ? (rawMem as Record<string, unknown>)
    : null;
  const hasActive = membership?.status === "active";

  const myBookedClassIds = new Set(myBookings.map((b) => b.class_id));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const classesForDay = (day: Date) =>
    classes
      .filter((c) => {
        const st = c.start_time as string | undefined;
        if (!st) return false;
        return isSameDay(safeParse(st), day);
      })
      .sort((a, b) =>
        ((a.start_time as string) ?? "").localeCompare((b.start_time as string) ?? "")
      );

  const now = new Date();
  const today = new Date();

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="space-y-6">
          {/* ── Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="flex items-center text-[0.62rem] tracking-[0.24em] uppercase text-valiance-mauve font-body mb-2">
                <span className="inline-block w-6 h-px bg-valiance-gold mr-2.5" />
                Tu Espacio Pilates
              </p>
              <h1 className="font-display text-[2.2rem] sm:text-[2.6rem] leading-[1] tracking-[-0.015em] text-valiance-charcoal">
                Reserva tu clase
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Semana anterior"
                onClick={() => setWeekStart((w) => subWeeks(w, 1))}
                className="rounded-full border-valiance-charcoal/15 text-valiance-charcoal hover:bg-valiance-lavender/15 hover:border-valiance-charcoal/25"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="font-body text-[0.82rem] font-medium min-w-[140px] sm:min-w-[160px] text-center text-valiance-charcoal/80 tabular-nums">
                {format(weekStart, "d MMM", { locale: es })} – {format(weekEnd, "d MMM yyyy", { locale: es })}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Semana siguiente"
                onClick={() => setWeekStart((w) => addWeeks(w, 1))}
                className="rounded-full border-valiance-charcoal/15 text-valiance-charcoal hover:bg-valiance-lavender/15 hover:border-valiance-charcoal/25"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>

          {/* ── Membership status ── */}
          {hasActive && membership ? (
            <MembershipBanner membership={membership} />
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-valiance-gold/25 bg-valiance-lavender/12 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-block w-6 h-px bg-valiance-gold shrink-0" />
                <span className="font-body text-[0.88rem] text-valiance-charcoal/80">
                  Aún no tienes una membresía activa.
                </span>
              </div>
              <button
                onClick={() => navigate("/app/checkout")}
                className="group inline-flex items-center gap-2 self-start sm:self-auto rounded-full bg-valiance-charcoal text-valiance-nude pl-5 pr-4 py-2.5 font-body text-[0.74rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-plum transition-colors active:scale-[0.98]"
              >
                Adquiere un plan
                <ArrowUpRight size={14} strokeWidth={2} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          )}

          {/* ── Week grid ── */}
          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <div className="grid grid-cols-7 gap-2 sm:gap-2.5 min-w-[680px]">
              {days.map((day, i) => {
                const isToday = isSameDay(day, today);
                const theme = DAY_THEMES[day.getDay()];
                const dayClasses = classesForDay(day);

                return (
                  <div key={i} className="flex flex-col">
                    {/* Day header */}
                    <div
                      className={cn(
                        "text-center pb-3 mb-2 border-b",
                        isToday ? "border-valiance-gold/40" : "border-valiance-lavender/25"
                      )}
                    >
                      <div className={cn(
                        "text-[0.6rem] tracking-[0.16em] uppercase font-medium",
                        isToday ? "text-valiance-gold" : "text-valiance-mauve"
                      )}>
                        {DAYS[i]}
                      </div>
                      <div className={cn(
                        "font-display text-[1.5rem] leading-none mt-1",
                        isToday ? "text-valiance-charcoal" : "text-valiance-charcoal/85"
                      )}>
                        {format(day, "d")}
                      </div>
                      {theme && (
                        <div className="text-[0.58rem] tracking-[0.04em] text-valiance-mauve/90 mt-1.5 leading-tight px-0.5">
                          {theme}
                        </div>
                      )}
                    </div>

                    {/* Classes */}
                    {loadingClasses ? (
                      <div className="space-y-2">
                        <Skeleton className="h-[58px] w-full rounded-xl" />
                        <Skeleton className="h-[58px] w-full rounded-xl" />
                      </div>
                    ) : dayClasses.length === 0 ? (
                      <div className="flex items-center justify-center py-6">
                        <span className="text-valiance-mauve/40 text-lg leading-none">·</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {dayClasses.map((cls) => {
                          const startTime = cls.start_time as string | undefined;
                          const start = startTime ? safeParse(startTime) : null;
                          const isPast = start ? isBefore(start, now) : true;
                          const isBooked = myBookedClassIds.has(cls.id as string);
                          const className = typeof cls.class_type_name === "string" && cls.class_type_name
                            ? cls.class_type_name
                            : "Pilates";
                          const classCategory = String(cls.class_category ?? "all").toLowerCase();
                          const membershipCategoriesRaw = membership?.classCategories ?? membership?.class_categories;
                          const membershipCategories = Array.isArray(membershipCategoriesRaw)
                            ? membershipCategoriesRaw.map((value) => String(value).toLowerCase())
                            : [String(membership?.classCategory ?? membership?.class_category ?? "all").toLowerCase()];
                          const isPrenatalClass = classCategory === "prenatal" || className.toLowerCase() === "prenatal";
                          const hasPrenatalAccess = membershipCategories.includes("prenatal");
                          const hasRegularAccess = membershipCategories.some((category) => category !== "prenatal");
                          const prenatalAccessMismatch = hasActive
                            && (isPrenatalClass ? !hasPrenatalAccess : !hasRegularAccess);

                          // Availability — disciplina única, cupo 8.
                          const rawCurrent = cls.current_bookings;
                          const rawMax = cls.max_capacity;
                          const hasAvailability =
                            (typeof rawCurrent === "number") || (typeof rawMax === "number");
                          const maxCap = typeof rawMax === "number" ? rawMax : DEFAULT_CAPACITY;
                          const current = typeof rawCurrent === "number" ? rawCurrent : 0;
                          const remaining = Math.max(0, maxCap - current);
                          const isFull = hasAvailability && remaining === 0;

                          // Bookable only when not past, not full (unless already booked).
                          const disabled = !isBooked && (isPast || isFull || prenatalAccessMismatch);

                          // Apparatus — 'reformer' | 'tower'; default reformer.
                          const rawApparatus =
                            typeof cls.apparatus === "string" ? cls.apparatus.toLowerCase() : "reformer";
                          const isTower = rawApparatus === "tower";
                          // Badge: el enfoque guardado en la clase si existe; si no,
                          // cae al enfoque del día (Lower/Upper/Full body/Core).
                          // Tower se conserva como excepción de aparato.
                          const classFocus =
                            typeof cls.focus === "string" && cls.focus ? cls.focus : theme;
                          const apparatusLabel = isTower
                            ? "Tower"
                            : isPrenatalClass ? "Reformer" : (classFocus || "Pilates");

                          return (
                            <button
                              key={cls.id as string}
                              disabled={disabled}
                              onClick={() => navigate(`/app/classes/${cls.id}`)}
                              className={cn(
                                "group w-full text-left rounded-xl border p-2.5 transition-all duration-200 relative",
                                // Booked — clear "reservada" state (gold-ringed nude card)
                                isBooked &&
                                  "border-valiance-gold/40 bg-valiance-nude ring-1 ring-valiance-gold/30 cursor-pointer hover:ring-valiance-gold/50",
                                // Available — blush warmth, lifts on hover
                                !isBooked && !disabled &&
                                  "border-valiance-charcoal/8 bg-valiance-nude ring-1 ring-valiance-charcoal/5 cursor-pointer hover:ring-valiance-blush/50 hover:border-valiance-blush/40 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-14px_rgba(201,173,163,0.45)]",
                                // Past — faded, inert
                                !isBooked && isPast &&
                                  "border-valiance-lavender/15 bg-transparent opacity-40 cursor-not-allowed",
                                // Full (future) — quiet, waitlist note
                                !isBooked && !isPast && isFull &&
                                  "border-valiance-lavender/20 bg-valiance-lavender/[0.07] opacity-70 cursor-not-allowed"
                              )}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p className={cn(
                                  "font-body text-[0.82rem] font-semibold leading-none tabular-nums",
                                  isBooked ? "text-valiance-charcoal" : "text-valiance-charcoal/90"
                                )}>
                                  {start ? prettyTime(start) : "—"}
                                </p>
                                {isBooked && (
                                  <span className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-valiance-gold/15 text-valiance-gold">
                                    <Check size={10} strokeWidth={2.5} />
                                  </span>
                                )}
                              </div>

                              <p className="font-display text-[0.95rem] leading-tight text-valiance-charcoal/80 mt-1.5">
                                {className}
                              </p>

                              {/* Apparatus — Reformer (default) / Tower (lavender·gold accent) */}
                              <span
                                className={cn(
                                  "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.56rem] tracking-[0.12em] uppercase font-medium",
                                  isTower || isPrenatalClass
                                    ? "bg-valiance-lavender/25 text-valiance-plum ring-1 ring-valiance-gold/30"
                                    : "bg-valiance-charcoal/[0.05] text-valiance-mauve ring-1 ring-valiance-charcoal/8"
                                )}
                              >
                                <span
                                  className={cn(
                                    "w-1 h-1 rounded-full",
                                    isTower || isPrenatalClass ? "bg-valiance-gold" : "bg-valiance-mauve/60"
                                  )}
                                />
                                {apparatusLabel}
                              </span>

                              {/* Status line: booked / availability / waitlist */}
                              {isBooked ? (
                                <p className="text-[0.6rem] tracking-[0.1em] uppercase text-valiance-gold font-medium mt-1.5">
                                  Reservada
                                </p>
                              ) : prenatalAccessMismatch ? (
                                <p className="text-[0.6rem] text-valiance-mauve mt-1.5 leading-tight">
                                  {isPrenatalClass ? "Requiere membresía Prenatal" : "Tu membresía es solo Prenatal"}
                                </p>
                              ) : isFull ? (
                                <p className="text-[0.6rem] text-valiance-mauve mt-1.5 leading-tight">
                                  Lleno · lista de espera
                                </p>
                              ) : hasAvailability && !isPast ? (
                                <p className="text-[0.62rem] text-valiance-mauve mt-1.5 tabular-nums">
                                  {remaining === 1 ? "1 lugar" : `${remaining} lugares`}
                                </p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Legend ── single, calm ── */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-[0.7rem] text-valiance-mauve">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-valiance-gold/15 text-valiance-gold">
                <Check size={8} strokeWidth={3} />
              </span>
              Reservada
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full ring-1 ring-valiance-blush/50 bg-valiance-nude" />
              Disponible
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-valiance-lavender/30" />
              Lleno · lista de espera
            </span>
            <span className="ml-auto text-valiance-mauve/70 hidden sm:inline">Cupo de 8 por clase</span>
          </div>
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default BookClasses;
