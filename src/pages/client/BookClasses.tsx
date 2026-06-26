import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  startOfWeek, endOfWeek, addWeeks, subWeeks, format,
  isBefore,
} from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { safeParse } from "@/lib/utils";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Lock, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingClient } from "@/types/booking";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// ── Category helpers ──────────────────────────────────────────────────────────
// Must mirror the union in PlansList.tsx and server/index.js (plans.class_category).
type ClassCat = "pilates" | "bienestar" | "reformer" | "barre" | "mixto" | "funcional" | "all";

const PILATES_PALETTE   = { bg: "bg-[#D9B5BA]/15",          text: "text-[#6B4F53]",     border: "border-[#D9B5BA]/40", dot: "bg-[#8C6B6F]"     };
const BIENESTAR_PALETTE = { bg: "bg-[#8C6B6F]/15",          text: "text-[#3D3A3A]",     border: "border-[#8C6B6F]/40", dot: "bg-[#6B4F53]"     };
const NEUTRAL_PALETTE   = { bg: "bg-[#8C6B6F]/[0.06]",      text: "text-[#1A1A1A]/70",  border: "border-[#8C6B6F]/20", dot: "bg-[#8C6B6F]/40"  };

const CAT_COLORS: Record<ClassCat, { bg: string; text: string; border: string; dot: string }> = {
  pilates:   PILATES_PALETTE,
  reformer:  PILATES_PALETTE,
  bienestar: BIENESTAR_PALETTE,
  barre:     BIENESTAR_PALETTE,
  funcional: BIENESTAR_PALETTE,
  mixto:     NEUTRAL_PALETTE,
  all:       NEUTRAL_PALETTE,
};

const CAT_LABELS: Record<ClassCat, string> = {
  pilates: "Pilates",
  reformer: "Reformer",
  bienestar: "Bienestar",
  barre: "Barre",
  funcional: "Funcional",
  mixto: "Mixto",
  all: "Todas",
};

// Safe lookups — guarantee we never crash if the server returns a category we
// haven't registered yet (e.g., a future plan type).
const colorsOf = (cat: string | null | undefined) =>
  (cat && CAT_COLORS[cat as ClassCat]) || NEUTRAL_PALETTE;
const labelOf = (cat: string | null | undefined) =>
  (cat && CAT_LABELS[cat as ClassCat]) || "Categoría";

function inferClassCat(name: string): ClassCat {
  const n = name?.toLowerCase() ?? "";
  if (n.includes("reformer")) return "reformer";
  if (n.includes("barre")) return "barre";
  if (n.includes("funcional") || n.includes("functional")) return "funcional";
  if (n.includes("pilates") || n.includes("mat") || n.includes("flow") || n.includes("clásico") || n.includes("terapéutico")) return "pilates";
  if (n.includes("flex") || n.includes("body") || n.includes("strong")) return "bienestar";
  return "pilates";
}

// Mirror server-side matching: `mixto` and `all` are wildcards; otherwise the
// class category must equal the membership category. `pilates` and `reformer`
// are treated as equivalent (reformer is pilates equipment); `bienestar`,
// `barre`, and `funcional` share the wellness bucket.
function canBook(classCat: ClassCat, membershipCat: ClassCat | null): boolean {
  if (!membershipCat || membershipCat === "all" || membershipCat === "mixto") return true;
  if (classCat === membershipCat) return true;
  const pilatesGroup = new Set<ClassCat>(["pilates", "reformer"]);
  const wellnessGroup = new Set<ClassCat>(["bienestar", "barre", "funcional"]);
  if (pilatesGroup.has(classCat) && pilatesGroup.has(membershipCat)) return true;
  if (wellnessGroup.has(classCat) && wellnessGroup.has(membershipCat)) return true;
  return false;
}

// ── Clase Muestra schedule restriction ───────────────────────────────────────
const TRIAL_ALLOWED_SCHEDULES = [
  { day: 1, time: "08:20" }, // Lunes 8:20 AM
  { day: 1, time: "19:20" }, // Lunes 7:20 PM
  { day: 2, time: "09:25" }, // Martes 9:25 AM
  { day: 4, time: "09:25" }, // Jueves 9:25 AM
];

function isTrialMembership(membership: any): boolean {
  const rk = String(membership?.repeatKey ?? membership?.repeat_key ?? "").toLowerCase();
  const name = String(membership?.planName ?? membership?.plan_name ?? "").toLowerCase();
  return rk.startsWith("trial_single_session") || name.includes("muestra");
}

function isClassAllowedForTrial(classDate: Date, startTimeStr: string): boolean {
  const day = classDate.getDay(); // 0=Sun … 6=Sat
  const time = startTimeStr.slice(0, 5); // "HH:MM"
  return TRIAL_ALLOWED_SCHEDULES.some((s) => s.day === day && s.time === time);
}

// ── Membership banner ─────────────────────────────────────────────────────────
const MembershipBanner = ({ membership }: { membership: any }) => {
  const rawCat = membership.classCategory ?? membership.class_category ?? "all";
  const colors = colorsOf(rawCat);
  const catLabel = labelOf(rawCat);
  const remaining = membership.classesRemaining ?? membership.classes_remaining;
  const isUnlimited = remaining === null || remaining === undefined || remaining === 9999;
  const endDate = membership.endDate ?? membership.end_date;

  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm", colors.bg, colors.border)}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", colors.dot)} />
        <span className={cn("font-semibold truncate", colors.text)}>{membership.planName ?? membership.plan_name}</span>
        <span className={cn("capitalize text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0", colors.bg, colors.text, colors.border)}>
          {catLabel}
        </span>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {!isUnlimited && (
          <div className="text-right">
            <div className={cn("text-base font-bold leading-none", colors.text)}>{remaining}</div>
            <div className="text-[10px] text-[#1A1A1A]/50">clases</div>
          </div>
        )}
        {isUnlimited && <span className={cn("text-xs font-bold", colors.text)}>∞ Ilimitado</span>}
        {endDate && (
          <div className="text-right">
            <div className="text-xs font-medium text-[#1A1A1A]/70">
              {new Date(endDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div className="text-[10px] text-[#1A1A1A]/50">vencimiento</div>
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

  const classes: any[] = Array.isArray(classesData?.data) ? classesData.data : Array.isArray(classesData) ? classesData : [];
  const myBookings: BookingClient[] = Array.isArray(bookingsData?.data) ? bookingsData.data : Array.isArray(bookingsData) ? bookingsData : [];
  const rawMem = membershipData?.data !== undefined ? membershipData.data : membershipData;
  const membership = rawMem && typeof rawMem === "object" && "id" in rawMem ? rawMem : null;
  const hasActive = membership?.status === "active";
  const membershipCat: ClassCat | null = hasActive
    ? ((membership.classCategory ?? membership.class_category ?? "all") as ClassCat)
    : null;
  const isTrial = hasActive && isTrialMembership(membership);

  const myBookedClassIds = new Set(myBookings.map((b) => b.class_id));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const classesForDay = (day: Date) =>
    classes
      .filter((c) => {
        if (!c.start_time) return false;
        const dt = safeParse(c.start_time);
        return format(dt, "yyyy-MM-dd") === format(day, "yyyy-MM-dd");
      })
      .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  const now = new Date();

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Reservar clase</h1>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => subWeeks(w, 1))}>
                <ChevronLeft size={16} />
              </Button>
              <span className="text-sm font-medium min-w-[96px] sm:min-w-[130px] text-center">
                {format(weekStart, "d MMM", { locale: es })} – {format(weekEnd, "d MMM yyyy", { locale: es })}
              </span>
              <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>

          {/* Membership status */}
          {hasActive ? (
            <MembershipBanner membership={membership} />
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-600/30 bg-amber-50 text-sm">
              <AlertCircle size={15} className="text-amber-600 shrink-0" />
              <span className="text-amber-800">
                No tienes membresía activa.{" "}
                <a href="/app/checkout" className="underline font-semibold text-amber-900">Adquiere un plan</a> para reservar.
              </span>
            </div>
          )}

          {/* Filter hint */}
          {membershipCat && membershipCat !== "all" && membershipCat !== "mixto" && (
            <div className="flex items-center gap-1.5 text-xs px-1">
              <CheckCircle2 size={11} className={colorsOf(membershipCat).text} />
              <span className="text-[#1A1A1A]/55">
                Tu membresía <span className={cn("font-semibold", colorsOf(membershipCat).text)}>{labelOf(membershipCat)}</span> solo permite reservar clases de esa categoría.
              </span>
            </div>
          )}

          {/* Trial schedule restriction banner */}
          {isTrial && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-blue-500/30 bg-blue-50 text-sm">
              <Clock size={15} className="text-blue-600 shrink-0 mt-0.5" />
              <div className="text-blue-800 text-xs leading-relaxed">
                <span className="font-semibold">Clase Muestra</span> — solo puedes reservar en estos horarios:
                <ul className="mt-1 ml-3 list-disc space-y-0.5">
                  <li>Lunes: 8:20 AM y 7:20 PM</li>
                  <li>Martes: 9:25 AM</li>
                  <li>Jueves: 9:25 AM</li>
                </ul>
              </div>
            </div>
          )}

          {/* Week grid */}
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-1 min-w-[520px] sm:min-w-[560px]">
              {days.map((day, i) => (
                <div key={i} className="text-center">
                  <div className="text-xs font-medium text-muted-foreground py-1">{DAYS[i]}</div>
                  <div className="text-sm font-bold pb-2">{format(day, "d")}</div>
                  {loadingClasses ? (
                    <Skeleton className="h-16 w-full rounded-lg" />
                  ) : (
                    <div className="space-y-1">
                      {classesForDay(day).map((cls) => {
                        const isPast = cls.start_time ? isBefore(safeParse(cls.start_time), now) : true;
                        const isBooked = myBookedClassIds.has(cls.id);
                        const classCat = inferClassCat(cls.class_type_name ?? "");
                        const c = colorsOf(classCat);
                        const allowed = canBook(classCat, membershipCat);
                        const trialBlocked = isTrial && !isClassAllowedForTrial(day, format(safeParse(cls.start_time), "HH:mm"));
                        const locked = !isBooked && !isPast && (!allowed || trialBlocked);
                        const disabled = isPast || locked;

                        return (
                          <button
                            key={cls.id}
                            disabled={disabled}
                            onClick={() => navigate(`/app/classes/${cls.id}`)}
                            className={cn(
                              "w-full text-left rounded-lg border p-1.5 text-xs transition-all relative",
                              isBooked  && "border-green-600/40 bg-green-50",
                              !isBooked && !disabled && cn(c.border, "hover:opacity-90 cursor-pointer", c.bg),
                              !isBooked && isPast  && "opacity-40 cursor-not-allowed border-[#8C6B6F]/12 bg-transparent",
                              !isBooked && locked  && "opacity-30 cursor-not-allowed border-[#8C6B6F]/10 bg-transparent",
                            )}
                          >
                            <div className="flex items-center gap-1 mb-0.5">
                              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", c.dot)} />
                              <p className={cn("font-semibold truncate text-[11px]", c.text)}>
                                {cls.class_type_name}
                              </p>
                            </div>
                            <p className="text-[#1A1A1A]/55 text-[10px]">
                              {cls.start_time ? format(safeParse(cls.start_time), "HH:mm") : "—"}
                            </p>
                            {isBooked && (
                              <span className="absolute top-1 right-1">
                                <CheckCircle2 size={10} className="text-green-600" />
                              </span>
                            )}
                            {locked && (
                              <span className="absolute top-1 right-1">
                                <Lock size={8} className="text-[#1A1A1A]/30" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 pt-1">
            {(["pilates", "bienestar"] as ClassCat[]).map(cat => (
              <div key={cat} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium", CAT_COLORS[cat].bg, CAT_COLORS[cat].text, CAT_COLORS[cat].border)}>
                <div className={cn("w-1.5 h-1.5 rounded-full", CAT_COLORS[cat].dot)} />
                {CAT_LABELS[cat]}
              </div>
            ))}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.06] text-[11px] font-medium text-[#1A1A1A]/50">
              <Lock size={9} /> Requiere otra membresía
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-green-600/30 bg-green-50 text-[11px] font-medium text-green-700">
              <CheckCircle2 size={9} /> Reservada
            </div>
          </div>
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default BookClasses;
