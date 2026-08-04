import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LogOut,
  RefreshCw,
  UserRound,
  UsersRound,
} from "lucide-react";
import { AuthGuard } from "@/components/admin/AuthGuard";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import brandMark from "@/assets/tep-mark-ink.png";

type BookingStatus = "confirmed" | "checked_in" | "waitlist" | "no_show" | string;

interface CoachReservation {
  id: string;
  clientName: string;
  status: BookingStatus;
  checkedInAt: string | null;
}

interface CoachClass {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  status: string;
  classTypeName: string;
  category: string | null;
  focus: string | null;
  apparatus: string | null;
  instructorName: string;
  reservedCount: number;
  waitlistCount: number;
  reservations: CoachReservation[];
}

interface CoachSchedule {
  coach: { displayName: string; email: string | null };
  today: string;
  generatedAt: string;
  summary: {
    todayClasses: number;
    todayReservations: number;
    futureClasses: number;
    totalReservations: number;
  };
  classes: CoachClass[];
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  checked_in: "Presente",
  waitlist: "En espera",
  no_show: "No asistió",
};

const STATUS_STYLES: Record<string, string> = {
  confirmed: "border-[#D9C9C3] bg-[#F1E8E3] text-[#725763]",
  checked_in: "border-[#BFCAB3] bg-[#EEF2E9] text-[#536346]",
  waitlist: "border-[#E3D1A9] bg-[#F7F0DE] text-[#8A692E]",
  no_show: "border-[#DFC1C1] bg-[#F5E7E7] text-[#8A4C4C]",
};

const COACH_ROLES = ["instructor"];

function toDate(date: string) {
  return new Date(`${date}T12:00:00`);
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatDate(date: string) {
  return capitalize(new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(toDate(date)));
}

function formatTime(time: string) {
  const [hours = "0", minutes = "00"] = time.split(":");
  return new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "CO";
}

const LoadingState = () => (
  <div className="space-y-6" aria-label="Cargando agenda">
    <div className="h-56 animate-pulse rounded-[1.75rem] bg-[#8C6B6F]/20" />
    <div className="grid gap-3 sm:grid-cols-3">
      {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-white/75" />)}
    </div>
    {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-white/75" />)}
  </div>
);

const EmptyState = ({ mode }: { mode: "today" | "future" }) => (
  <div className="rounded-[1.75rem] border border-[#E2D8D1] bg-white/70 px-6 py-14 text-center">
    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEE3DE] text-[#8C6B6F]">
      <CalendarDays size={22} strokeWidth={1.7} />
    </span>
    <h2 className="mt-4 font-display text-2xl text-[#33282B]">
      {mode === "today" ? "Hoy no hay clases programadas" : "No hay clases futuras publicadas"}
    </h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#725F64]">
      {mode === "today"
        ? "Puedes revisar la agenda próxima desde la pestaña de futuras."
        : "Cuando el equipo publique nuevos horarios aparecerán aquí."}
    </p>
  </div>
);

const ClassCard = ({ classItem, isToday }: { classItem: CoachClass; isToday: boolean }) => {
  const [expanded, setExpanded] = useState(isToday);

  return (
    <details
      className="group overflow-hidden rounded-2xl border border-[#E2D8D1] bg-white/80 shadow-[0_12px_35px_rgba(74,53,59,0.06)]"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8C6B6F] sm:px-5">
      <div className="flex w-[5.75rem] shrink-0 flex-col border-r border-[#E5DAD4] pr-4">
        <span className="whitespace-nowrap font-display text-[1.15rem] leading-none text-[#3B2D31]">{formatTime(classItem.startTime)}</span>
        <span className="mt-1 whitespace-nowrap text-[0.62rem] uppercase tracking-[0.1em] text-[#8C777D]">{formatTime(classItem.endTime)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-sm font-semibold text-[#33282B] sm:text-base">{classItem.classTypeName}</h3>
          {classItem.focus && (
            <span className="rounded-md border border-[#DDD0CA] bg-[#F7F1EE] px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[#7B636A]">
              {classItem.focus}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-[#7C686E]">{classItem.instructorName}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-[#6E565E]">
        <span className="hidden text-xs tabular-nums sm:inline">
          {classItem.reservedCount}/{classItem.maxCapacity}
        </span>
        <UsersRound size={17} strokeWidth={1.8} />
        <ChevronDown size={17} className="transition-transform duration-200 group-open:rotate-180" />
      </div>
    </summary>

    <div className="border-t border-[#E8DED8] bg-[#FBF8F5] px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#77636A]">
        <span>{classItem.reservedCount} lugares ocupados de {classItem.maxCapacity}</span>
        {classItem.waitlistCount > 0 && <span>{classItem.waitlistCount} en lista de espera</span>}
      </div>

      {classItem.reservations.length > 0 ? (
        <ul className="divide-y divide-[#E9DFD9]" aria-label={`Reservas de ${classItem.classTypeName}`}>
          {classItem.reservations.map((reservation) => (
            <li key={reservation.id} className="flex min-h-12 items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#EEE3DE] text-[#7E626B]">
                {reservation.status === "checked_in"
                  ? <CheckCircle2 size={16} strokeWidth={1.9} />
                  : <UserRound size={16} strokeWidth={1.8} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#3B2D31]">{reservation.clientName}</span>
              <span className={`shrink-0 rounded-lg border px-2 py-1 text-[0.65rem] font-medium uppercase tracking-[0.08em] ${STATUS_STYLES[reservation.status] || STATUS_STYLES.confirmed}`}>
                {STATUS_LABELS[reservation.status] || reservation.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-[#DCCFC8] px-4 py-5 text-center text-sm text-[#806C72]">
          Aún no hay alumnas reservadas.
        </p>
      )}
    </div>
    </details>
  );
};

const CoachPortalContent = () => {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const [mode, setMode] = useState<"today" | "future">("today");
  const scheduleQuery = useQuery<CoachSchedule>({
    queryKey: ["coach-schedule"],
    queryFn: async () => (await api.get("/coach/schedule")).data.data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const schedule = scheduleQuery.data;
  const visibleClasses = useMemo(() => {
    if (!schedule) return [];
    return schedule.classes.filter((classItem) => mode === "today"
      ? classItem.date === schedule.today
      : classItem.date > schedule.today);
  }, [mode, schedule]);

  const groups = useMemo(() => {
    const grouped = new Map<string, CoachClass[]>();
    for (const classItem of visibleClasses) {
      const current = grouped.get(classItem.date) || [];
      current.push(classItem);
      grouped.set(classItem.date, current);
    }
    return Array.from(grouped.entries());
  }, [visibleClasses]);

  const handleLogout = () => {
    logout();
    navigate("/auth/login", { replace: true });
  };

  return (
    <div className="min-h-[100dvh] bg-[#F5F0EB] text-[#33282B]">
      <header className="sticky top-0 z-30 border-b border-[#E5DAD4]/90 bg-[#F9F5F1]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={brandMark} alt="Tu Espacio Pilates" className="h-10 w-10 object-contain" />
            <div className="min-w-0 border-l border-[#D9CBC4] pl-3">
              <p className="text-[0.62rem] font-medium uppercase tracking-[0.2em] text-[#8C6B6F]">Portal de coaches</p>
              <p className="mt-0.5 truncate text-xs text-[#766268]">Agenda del estudio</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="max-w-44 truncate text-sm font-medium">{schedule?.coach.displayName || "Coach"}</p>
              <p className="max-w-44 truncate text-[0.68rem] text-[#826E74]">{schedule?.coach.email || "Cuenta del estudio"}</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6A4E59] text-xs font-semibold text-white">
              {initials(schedule?.coach.displayName || "Coach")}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCCFC8] bg-white/70 text-[#725B63] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C6B6F]"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        {scheduleQuery.isLoading ? (
          <LoadingState />
        ) : scheduleQuery.isError || !schedule ? (
          <div className="rounded-[1.75rem] border border-[#E2C4C4] bg-white/75 px-6 py-14 text-center">
            <AlertCircle className="mx-auto text-[#9A5D63]" size={30} strokeWidth={1.7} />
            <h1 className="mt-4 font-display text-3xl">No pudimos abrir la agenda</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#725F64]">Revisa tu conexión e inténtalo otra vez.</p>
            <button
              type="button"
              onClick={() => scheduleQuery.refetch()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#5E4651] px-4 py-3 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C6B6F] focus-visible:ring-offset-2"
            >
              <RefreshCw size={15} />
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <section className="relative overflow-hidden rounded-[1.75rem] bg-[#5E4651] px-5 py-7 text-white shadow-[0_24px_60px_rgba(66,43,51,0.18)] sm:px-8 sm:py-9">
              <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border border-white/10" aria-hidden />
              <div className="absolute -bottom-24 right-8 h-48 w-48 rounded-full bg-[#A8828D]/30 blur-2xl" aria-hidden />
              <div className="relative max-w-2xl">
                <p className="flex items-center text-[0.65rem] font-medium uppercase tracking-[0.22em] text-[#E7D6D3]">
                  <span className="mr-3 h-px w-7 bg-[#D4B777]" />
                  {formatDate(schedule.today)}
                </p>
                <h1 className="mt-4 font-display text-[clamp(2.35rem,7vw,4.4rem)] leading-[0.98] tracking-[-0.02em]">
                  Hola, {schedule.coach.displayName.split(/\s+/)[0]}.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/72 sm:text-base">
                  Revisa las clases del estudio y confirma quiénes tienen lugar antes de comenzar cada sesión.
                </p>
              </div>
            </section>

            <section className="relative z-10 -mt-3 grid grid-cols-3 gap-2 px-2 sm:-mt-5 sm:gap-3 sm:px-5" aria-label="Resumen de agenda">
              {[
                { label: "Clases hoy", value: schedule.summary.todayClasses, icon: CalendarDays },
                { label: "Reservas hoy", value: schedule.summary.todayReservations, icon: UsersRound },
                { label: "Clases futuras", value: schedule.summary.futureClasses, icon: Clock3 },
              ].map((metric) => (
                <div key={metric.label} className="min-w-0 rounded-2xl border border-[#E2D8D1] bg-[#FFFDFC] px-3 py-4 shadow-[0_10px_30px_rgba(74,53,59,0.08)] sm:px-5">
                  <metric.icon size={16} className="mb-3 text-[#8C6B6F]" strokeWidth={1.8} />
                  <p className="font-display text-3xl leading-none tabular-nums text-[#3B2D31]">{metric.value}</p>
                  <p className="mt-1 truncate text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#806C72] sm:text-[0.68rem]">{metric.label}</p>
                </div>
              ))}
            </section>

            <section className="mt-7 sm:mt-9">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.64rem] font-medium uppercase tracking-[0.2em] text-[#8C6B6F]">Reservaciones</p>
                  <h2 className="mt-1 font-display text-3xl text-[#33282B]">Agenda de clases</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className="grid flex-1 grid-cols-2 rounded-2xl border border-[#DDD0CA] bg-[#ECE3DE] p-1 sm:flex-none">
                    <button
                      type="button"
                      onClick={() => setMode("today")}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${mode === "today" ? "bg-white text-[#4A373E] shadow-sm" : "text-[#7B676D] hover:text-[#4A373E]"}`}
                    >
                      Hoy
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("future")}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${mode === "future" ? "bg-white text-[#4A373E] shadow-sm" : "text-[#7B676D] hover:text-[#4A373E]"}`}
                    >
                      Próximas
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => scheduleQuery.refetch()}
                    disabled={scheduleQuery.isFetching}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#DCCFC8] bg-white/70 text-[#725B63] transition-colors hover:bg-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C6B6F]"
                    aria-label="Actualizar agenda"
                    title="Actualizar agenda"
                  >
                    <RefreshCw size={16} className={scheduleQuery.isFetching ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {groups.length === 0 ? (
                <EmptyState mode={mode} />
              ) : (
                <div className="space-y-7">
                  {groups.map(([date, classes]) => (
                    <section key={date} aria-labelledby={`date-${date}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 id={`date-${date}`} className="text-sm font-semibold text-[#4A373E]">
                          {date === schedule.today ? "Hoy" : formatDate(date)}
                        </h3>
                        <span className="text-xs text-[#806C72]">{classes.length} {classes.length === 1 ? "clase" : "clases"}</span>
                      </div>
                      <div className="space-y-3">
                        {classes.map((classItem) => (
                          <ClassCard key={classItem.id} classItem={classItem} isToday={date === schedule.today} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>

            <footer className="mt-10 border-t border-[#DED2CB] py-6 text-center text-xs leading-5 text-[#806C72]">
              Información de uso interno. La agenda se actualiza automáticamente cada minuto.
            </footer>
          </>
        )}
      </main>
    </div>
  );
};

const CoachPortal = () => (
  <AuthGuard requiredRoles={COACH_ROLES}>
    <CoachPortalContent />
  </AuthGuard>
);

export default CoachPortal;
