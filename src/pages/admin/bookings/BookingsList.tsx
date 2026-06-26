import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, Users, CheckCircle2,
  Clock, ArrowLeft, UserCheck, UserX, Calendar, Plus, Search, Ban,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

// ── Types ──────────────────────────────────────────────────────────────────────
interface RosterEntry {
  bookingId: string;
  status: string;
  checkedInAt: string | null;
  userId: string | null;
  displayName: string | null;
  guestName: string | null;
  email: string | null;
  phone: string | null;
  planName: string | null;
  classesRemaining: number | null;
}

interface ClientOption {
  id: string;
  displayName: string;
  email?: string;
  phone?: string | null;
}

// ── Status config ──────────────────────────────────────────────────────────────
const statusConfig: Record<string, { label: string; className: string }> = {
  confirmed:  { label: "Confirmada",   className: "text-[#8C6B6F] border-[#8C6B6F]/30 bg-[#8C6B6F]/10" },
  checked_in: { label: "Asistió ✓",   className: "text-[#4ade80] border-[#4ade80]/30 bg-[#4ade80]/5" },
  waitlist:   { label: "Lista espera", className: "text-[#D9B5BA] border-[#D9B5BA]/30 bg-[#D9B5BA]/5" },
  no_show:    { label: "No asistió",   className: "text-[#f87171] border-[#f87171]/30 bg-[#f87171]/5" },
  cancelled:  { label: "Cancelada",    className: "text-[#1A1A1A]/30 border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04]" },
};

// ── Class Roster panel ─────────────────────────────────────────────────────────
const ClassRoster = ({ classId, onBack }: { classId: string; onBack: () => void }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const debouncedMemberSearch = useDebounce(memberSearch, 250);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["roster", classId],
    queryFn: async () => (await api.get(`/classes/${classId}/roster`)).data,
    refetchInterval: 15000,
  });

  const classInfo = data?.data?.class ?? null;
  const roster: RosterEntry[] = data?.data?.roster ?? [];
  const { data: usersData, isFetching: searchingUsers } = useQuery<{ data: ClientOption[] }>({
    queryKey: ["booking-assign-users", classId, debouncedMemberSearch],
    enabled: assignOpen,
    queryFn: async () => (
      await api.get(`/users?role=client${debouncedMemberSearch ? `&search=${encodeURIComponent(debouncedMemberSearch)}` : ""}`)
    ).data,
  });
  const userOptions = Array.isArray(usersData?.data) ? usersData.data : [];

  const checkinMutation = useMutation({
    mutationFn: (id: string) => api.put(`/bookings/${id}/check-in`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster", classId] });
      toast({ title: "✅ Check-in registrado" });
    },
    onError: () => toast({ title: "Error al hacer check-in", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.put(`/admin/bookings/${id}/cancel${force ? "?force=1" : ""}`),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["class-roster", classId] });
      const d = res?.data?.data ?? res?.data;
      const base = d?.message ?? "Reserva cancelada";
      toast({ title: d?.forced ? `${base} · Forzada como excepción` : base });
    },
    onError: (e: any, vars) => {
      const data = e?.response?.data;
      const code = data?.code;
      const overridable = code === "CANCELLATIONS_LIMIT_REACHED" || code === "CANCELLATIONS_DISABLED";
      if (overridable && !vars?.force) {
        const msg = data?.message ?? "No se pudo cancelar la reserva.";
        if (window.confirm(`${msg}\n\n¿Forzar la cancelación como excepción?`)) {
          cancelMutation.mutate({ id: vars.id, force: true });
          return;
        }
      }
      toast({ title: data?.message ?? "Error al cancelar", variant: "destructive" });
    },
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) => api.put(`/bookings/${id}/no-show`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster", classId] });
      toast({ title: "Marcado como no asistió" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (userId: string) => api.post("/admin/bookings/assign", { classId, userId }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["roster", classId] });
      const msg = res?.data?.message ?? "Reserva asignada";
      toast({ title: msg });
      setAssignOpen(false);
      setMemberSearch("");
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message ?? "Error al asignar reserva", variant: "destructive" });
    },
  });

  const checkedIn = roster.filter((r) => r.status === "checked_in").length;
  const confirmed = roster.filter((r) => r.status === "confirmed").length;
  const waitlist  = roster.filter((r) => r.status === "waitlist").length;
  const noShow    = roster.filter((r) => r.status === "no_show").length;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 transition-colors"
      >
        <ArrowLeft size={14} /> Volver al calendario
      </button>

      {/* Class header */}
      {isLoading ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : classInfo && (
        <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: classInfo.color || "#8C6B6F" }}
                />
                <h2 className="text-xl font-bold text-[#1A1A1A]">{classInfo.classTypeName}</h2>
              </div>
              <p className="text-sm text-[#1A1A1A]/50">
                {classInfo.startsAt
                  ? new Date(classInfo.startsAt).toLocaleString("es-MX", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: "America/Mexico_City",
                    })
                  : classInfo.date ?? "—"}
              </p>
              <p className="text-xs text-[#1A1A1A]/35 mt-0.5">Instructor: {classInfo.instructorName}</p>
            </div>
            <button
              onClick={() => refetch()}
              className="text-xs text-[#D9B5BA]/60 hover:text-[#D9B5BA] transition-colors flex items-center gap-1"
            >
              <Clock size={11} /> Actualizar
            </button>
          </div>

          <div className="mt-3">
            <Button
              size="sm"
              onClick={() => setAssignOpen(true)}
              className="bg-gradient-to-r from-[#D9B5BA] to-[#8C6B6F] text-white"
            >
              <Plus size={14} className="mr-1" /> Asignar miembro
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {[
              { label: "Confirmadas", value: confirmed, color: "#FDF7F8" },
              { label: "Asistieron",  value: checkedIn, color: "#4ade80" },
              { label: "Lista esp.",  value: waitlist,  color: "#D9B5BA" },
              { label: "No asistió",  value: noShow,    color: "#f87171" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.05] px-3 py-2 text-center">
                <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[10px] text-[#1A1A1A]/35 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roster list */}
      <div className="space-y-2">
        {isLoading
          ? Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          : roster.length === 0
            ? (
              <div className="text-center py-12 text-[#1A1A1A]/25 text-sm">
                <Users size={28} className="mx-auto mb-2 opacity-30" />
                No hay reservas para esta clase
              </div>
            )
            : roster.map((entry) => {
              const sc = statusConfig[entry.status] ?? statusConfig.confirmed;
              const canCheckin = entry.status === "confirmed" || entry.status === "waitlist";
              const canNoShow  = entry.status === "confirmed";
              const canCancel  = entry.status === "confirmed" || entry.status === "waitlist";
              const isGuest = !entry.userId;
              const name = entry.displayName || entry.guestName || "Invitada";
              return (
                <div
                  key={entry.bookingId}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all",
                    entry.status === "checked_in"
                      ? "border-[#4ade80]/20 bg-[#4ade80]/5"
                      : entry.status === "no_show"
                        ? "border-[#f87171]/15 bg-[#f87171]/3 opacity-60"
                        : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:bg-[#8C6B6F]/[0.06]"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                    entry.status === "checked_in"
                      ? "bg-[#4ade80]/20 text-[#4ade80] border border-[#4ade80]/30"
                      : "bg-gradient-to-br from-[#8C6B6F]/20 to-[#D9B5BA]/10 border border-[#8C6B6F]/20 text-[#8C6B6F]"
                  )}>
                    {entry.status === "checked_in"
                      ? <UserCheck size={16} />
                      : name[0]?.toUpperCase() ?? "?"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#1A1A1A]/90 truncate">
                      {name}
                      {isGuest && <span className="ml-2 text-[10px] font-medium text-[#8C6B6F]/70 align-middle">invitada</span>}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {isGuest ? (
                        <span className="text-xs text-[#1A1A1A]/35">Invitada · sin cuenta</span>
                      ) : (
                        <>
                          <span className="text-xs text-[#1A1A1A]/35 truncate">{entry.email}</span>
                          {entry.phone && <span className="text-xs text-[#1A1A1A]/25">{entry.phone}</span>}
                        </>
                      )}
                    </div>
                    {entry.planName && (
                      <p className="text-[10px] text-[#D9B5BA]/60 mt-0.5">
                        {entry.planName}
                        {entry.classesRemaining !== null
                          ? ` · ${entry.classesRemaining} clases restantes`
                          : " · Ilimitado"}
                      </p>
                    )}
                  </div>

                  {/* Status badge */}
                  <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0", sc.className)}>
                    {sc.label}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canCheckin && (
                      <button
                        onClick={() => checkinMutation.mutate(entry.bookingId)}
                        disabled={checkinMutation.isPending}
                        title="Check-in"
                        className="w-8 h-8 rounded-lg bg-[#4ade80]/10 border border-[#4ade80]/25 text-[#4ade80] hover:bg-[#4ade80]/20 flex items-center justify-center transition-all disabled:opacity-40"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    )}
                    {canNoShow && (
                      <button
                        onClick={() => noShowMutation.mutate(entry.bookingId)}
                        disabled={noShowMutation.isPending}
                        title="No asistió"
                        className="w-8 h-8 rounded-lg bg-[#f87171]/8 border border-[#f87171]/20 text-[#f87171]/70 hover:bg-[#f87171]/15 flex items-center justify-center transition-all disabled:opacity-40"
                      >
                        <UserX size={14} />
                      </button>
                    )}
                    {canCancel && (
                      <button
                        onClick={() => { if (window.confirm("¿Cancelar esta reserva y devolver crédito?")) cancelMutation.mutate({ id: entry.bookingId }); }}
                        disabled={cancelMutation.isPending}
                        title="Cancelar reserva"
                        className="w-8 h-8 rounded-lg bg-[#8C6B6F]/8 border border-[#8C6B6F]/20 text-[#8C6B6F]/70 hover:bg-[#8C6B6F]/15 flex items-center justify-center transition-all disabled:opacity-40"
                      >
                        <Ban size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
        }
      </div>

      <Dialog
        open={assignOpen}
        onOpenChange={(next) => {
          setAssignOpen(next);
          if (!next) setMemberSearch("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar reserva a miembro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/35" />
              <Input
                className="pl-8"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Buscar por nombre, email o teléfono"
              />
            </div>
            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              {searchingUsers ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>
              ) : userOptions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
              ) : (
                userOptions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={assignMutation.isPending}
                    onClick={() => assignMutation.mutate(u.id)}
                    className="w-full px-3 py-2.5 text-left hover:bg-[#8C6B6F]/[0.06] border-b last:border-b-0 border-border disabled:opacity-60"
                  >
                    <p className="text-sm font-medium">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email ?? "—"}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── Weekly class picker ────────────────────────────────────────────────────────
const ClassPicker = ({ onSelectClass }: { onSelectClass: (id: string) => void }) => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-classes-week", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () =>
      (await api.get(`/classes?start=${format(weekStart, "yyyy-MM-dd")}&end=${format(weekEnd, "yyyy-MM-dd")}`)).data,
  });
  const classes: any[] = Array.isArray(data?.data) ? data.data : [];

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const todayStr = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-5">
      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setWeekStart((w) => subWeeks(w, 1))}
          className="w-8 h-8 rounded-lg border border-[#8C6B6F]/15 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 hover:border-[#8C6B6F]/25 flex items-center justify-center transition-all"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-[#1A1A1A]/70 min-w-[200px] text-center">
          {format(weekStart, "d MMM", { locale: es })} – {format(weekEnd, "d MMM yyyy", { locale: es })}
        </span>
        <button
          onClick={() => setWeekStart((w) => addWeeks(w, 1))}
          className="w-8 h-8 rounded-lg border border-[#8C6B6F]/15 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 hover:border-[#8C6B6F]/25 flex items-center justify-center transition-all"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          className="ml-2 text-xs text-[#8C6B6F]/60 hover:text-[#8C6B6F] transition-colors"
        >
          Hoy
        </button>
      </div>

      {/* Days */}
      <div className="space-y-4">
        {days.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const dayClasses = classes
            .filter((c) => {
              // date field is always YYYY-MM-DD after server normalisation
              const d = (c.date as string)?.slice(0, 10)
                ?? (c.start_time as string)?.slice(0, 10);
              return d === dayStr;
            })
            .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

          if (!dayClasses.length && !isLoading) return null;

          const isToday = dayStr === todayStr;

          return (
            <div key={dayStr}>
              <div className="flex items-center gap-2 mb-2">
                <p className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  isToday ? "text-[#8C6B6F]" : "text-[#1A1A1A]/30"
                )}>
                  {format(day, "EEEE d", { locale: es })}
                </p>
                {isToday && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8C6B6F]/15 text-[#8C6B6F] border border-[#8C6B6F]/25 font-semibold">
                    Hoy
                  </span>
                )}
              </div>

              {isLoading ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : (
                <div className="space-y-2">
                  {dayClasses.map((cls) => {
                    const time = cls.start_time
                      ? new Date(cls.start_time).toLocaleTimeString("es-MX", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZone: "America/Mexico_City",
                        })
                      : cls.startTime ?? "—";
                    const capacity = cls.max_capacity ?? 0;
                    const booked   = cls.current_bookings ?? 0;
                    const full     = capacity > 0 && booked >= capacity;
                    const pct      = capacity > 0 ? Math.min(Math.round((booked / capacity) * 100), 100) : 0;

                    return (
                      <button
                        key={cls.id}
                        onClick={() => onSelectClass(cls.id)}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/30 hover:bg-[#8C6B6F]/5 transition-all group text-left"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cls.class_type_color ?? cls.color ?? "#8C6B6F" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A1A1A]/85 truncate">
                            {cls.class_type_name ?? cls.className ?? "Clase"}
                          </p>
                          <p className="text-xs text-[#1A1A1A]/35">{time} · {cls.instructor_name ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <p className={cn("text-sm font-bold", full ? "text-[#f87171]" : "text-[#1A1A1A]/70")}>
                              {booked}/{capacity}
                            </p>
                            <p className="text-[10px] text-[#1A1A1A]/25">lugares</p>
                          </div>
                          <div className="w-12 h-1.5 rounded-full bg-[#8C6B6F]/10 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", full ? "bg-[#f87171]" : "bg-[#8C6B6F]")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <ChevronRight size={14} className="text-[#1A1A1A]/20 group-hover:text-[#8C6B6F]/60 transition-colors" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && classes.length === 0 && (
          <div className="text-center py-16 text-[#1A1A1A]/25 text-sm">
            <Calendar size={28} className="mx-auto mb-2 opacity-30" />
            No hay clases programadas esta semana
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────────
const BookingsList = () => {
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-3xl">
          <div className="mb-7">
            <h1 className="text-3xl font-bold text-[#1A1A1A] mb-1">Reservas</h1>
            <p className="text-sm text-[#1A1A1A]/35">
              {selectedClassId
                ? "Lista de alumnos · check-in y asistencia"
                : "Selecciona una clase para ver su lista de alumnos"}
            </p>
          </div>

          {selectedClassId ? (
            <ClassRoster classId={selectedClassId} onBack={() => setSelectedClassId(null)} />
          ) : (
            <ClassPicker onSelectClass={setSelectedClassId} />
          )}
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default BookingsList;
