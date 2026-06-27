import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, startOfWeek, addDays, parseISO, eachDayOfInterval } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Palette, Zap, MoreHorizontal, Loader2, UserCheck, Sparkles, Calendar, Users, X, CheckCircle2, UserX, Ban, Search } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useDebounce } from "@/hooks/use-debounce";

/* ── Palette ── */
const PALETTE_COLORS = [
  { label: "Olive", value: "#716D64" },
  { label: "Dusk", value: "#D1B9B4" },
  { label: "Fern", value: "#9B997B" },
  { label: "Oat", value: "#DFD1C9" },
  { label: "Pebble", value: "#444444" },
  { label: "Ivory", value: "#FAF8F6" },
];

/* ── Types ── */
interface ClassInstance {
  id: string;
  classTypeId: string;
  classTypeName?: string;
  classTypeColor?: string;
  instructorId: string;
  instructorName?: string;
  instructorPhoto?: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  capacity?: number;
  bookedCount?: number;
  currentBookings?: number;
  isCancelled: boolean;
  notes?: string;
}

interface ClassType {
  id: string;
  name: string;
  color: string;
  category?: "reformer" | "barre" | "pilates" | "bienestar";
  defaultDuration?: number;
  durationMin?: number;
  maxCapacity?: number;
  capacity?: number;
  isActive?: boolean;
}

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const GENERATE_DAYS = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mié", value: 3 },
  { label: "Jue", value: 4 },
  { label: "Vie", value: 5 },
  { label: "Sáb", value: 6 },
  { label: "Dom", value: 0 },
];

const TABS = [
  { key: "calendar",     label: "Calendario",    icon: CalendarDays },
  { key: "types",        label: "Tipos de clase", icon: Palette },
  { key: "generate",     label: "Generar semana", icon: Zap },
  { key: "instructors",  label: "Instructoras",   icon: UserCheck },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* ── Schemas ── */
const classSchema = z.object({
  classTypeId: z.string().min(1),
  instructorId: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  maxCapacity: z.coerce.number().min(1),
  notes: z.string().optional(),
});
type ClassFormData = z.infer<typeof classSchema>;

const typeSchema = z.object({
  name: z.string().min(1),
  color: z.string().default("#D1B9B4"),
  category: z.enum(["reformer", "barre", "pilates", "bienestar"]).default("reformer"),
  defaultDuration: z.coerce.number().min(1),
  maxCapacity: z.coerce.number().min(1),
  isActive: z.boolean().default(true),
});
type TypeFormData = z.infer<typeof typeSchema>;

/* ── Instructor schemas ── */
const instructorSchema = z.object({
  displayName: z.string().trim().min(1, "Nombre requerido"),
  email: z.string().trim().email("Email inválido"),
  bio: z.string().optional(),
  specialties: z.string().optional(),
  isActive: z.boolean().default(true),
  photoFocusX: z.coerce.number().min(0).max(100).default(50),
  photoFocusY: z.coerce.number().min(0).max(100).default(50),
});
type InstructorFormData = z.infer<typeof instructorSchema>;
interface Instructor extends Omit<InstructorFormData, "specialties"> {
  id: string;
  specialties?: string[] | string | null;
  photoUrl?: string;
  photoFocusX?: number;
  photoFocusY?: number;
}

function clampFocus(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeSpecialties(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_) {
      // fallback parsing below
    }
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((item) => item.replace(/^"+|"+$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

function instructorPayload(d: InstructorFormData) {
  return {
    displayName: d.displayName.trim(),
    email: d.email.trim().toLowerCase(),
    bio: d.bio?.trim() || null,
    specialties: normalizeSpecialties(d.specialties),
    isActive: d.isActive,
    photoFocusX: clampFocus(d.photoFocusX),
    photoFocusY: clampFocus(d.photoFocusY),
  };
}

function getFocusFromPointerEvent(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const nextX = ((event.clientX - rect.left) / rect.width) * 100;
  const nextY = ((event.clientY - rect.top) / rect.height) * 100;
  return {
    x: clampFocus(nextX),
    y: clampFocus(nextY),
  };
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════ */
const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmada",
  checked_in: "Asistió",
  waitlist: "Lista espera",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  confirmed: "bg-[#716D64]/15 text-[#716D64]",
  checked_in: "bg-emerald-500/15 text-emerald-600",
  waitlist: "bg-amber-500/15 text-amber-600",
  no_show: "bg-red-500/15 text-red-600",
  cancelled: "bg-gray-500/15 text-gray-500",
};

const ClassAttendees = ({ classId }: { classId: string }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ name: "", phone: "", planId: "", paymentMethod: "cash", amount: "" });
  const [showAssign, setShowAssign] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const debouncedMemberSearch = useDebounce(memberSearch, 250);

  const invalidateRoster = () => {
    qc.invalidateQueries({ queryKey: ["class-roster-mini", classId] });
    qc.invalidateQueries({ queryKey: ["roster", classId] });
    qc.invalidateQueries({ queryKey: ["classes"] });
    qc.invalidateQueries({ queryKey: ["admin-classes"] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["class-roster-mini", classId],
    queryFn: async () => (await api.get(`/classes/${classId}/roster`)).data,
    enabled: !!classId,
  });

  const { data: plansData } = useQuery({
    queryKey: ["plans-walkin-admin"],
    queryFn: async () => {
      // Try admin-aware endpoint first (includes TotalPass and other admin-only
      // plans). Fall back to public /plans if not deployed yet.
      try {
        const r = await api.get("/admin/plans/walkin");
        return r.data;
      } catch {
        const r = await api.get("/plans");
        return r.data;
      }
    },
    enabled: showWalkIn,
  });
  const walkInPlans: any[] = (Array.isArray(plansData?.data) ? plansData.data : [])
    .filter((p: any) => (p.isActive ?? p.is_active) !== false);

  const { data: usersData, isFetching: searchingUsers } = useQuery<{ data: { id: string; displayName: string; email?: string; phone?: string | null }[] }>({
    queryKey: ["class-assign-users", classId, debouncedMemberSearch],
    enabled: showAssign,
    queryFn: async () => (
      await api.get(`/users?role=client${debouncedMemberSearch ? `&search=${encodeURIComponent(debouncedMemberSearch)}` : ""}`)
    ).data,
  });
  const userOptions = Array.isArray(usersData?.data) ? usersData.data : [];

  const walkInMutation = useMutation({
    mutationFn: (body: any) => api.post(`/admin/classes/${classId}/walkin`, body),
    onSuccess: () => {
      invalidateRoster();
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast({ title: "Lugar bloqueado y pago registrado" });
      setWalkInForm({ name: "", phone: "", planId: "", paymentMethod: "cash", amount: "" });
      setShowWalkIn(false);
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      toast({
        title: data?.message ?? "Error al bloquear",
        description: data?.detail || data?.code || undefined,
        variant: "destructive",
      });
    },
  });

  const cancelWalkInMutation = useMutation({
    mutationFn: (bookingId: string) => api.delete(`/admin/bookings/${bookingId}/walkin`),
    onSuccess: () => {
      invalidateRoster();
      toast({ title: "Lugar liberado" });
    },
    onError: () => toast({ title: "Error al liberar lugar", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (userId: string) => api.post("/admin/bookings/assign", { classId, userId }),
    onSuccess: (res: any) => {
      invalidateRoster();
      toast({ title: res?.data?.message ?? "Reserva asignada" });
      setShowAssign(false);
      setMemberSearch("");
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al asignar reserva", variant: "destructive" }),
  });

  const checkinMutation = useMutation({
    mutationFn: (bookingId: string) => api.put(`/bookings/${bookingId}/check-in`),
    onSuccess: () => {
      invalidateRoster();
      toast({ title: "Check-in registrado" });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al hacer check-in", variant: "destructive" }),
  });

  const noShowMutation = useMutation({
    mutationFn: (bookingId: string) => api.put(`/bookings/${bookingId}/no-show`),
    onSuccess: () => {
      invalidateRoster();
      toast({ title: "Marcado como no asistió" });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error", variant: "destructive" }),
  });

  const seedTotalPassMutation = useMutation({
    mutationFn: () => api.post("/admin/plans/seed-totalpass"),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["plans-walkin-admin"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast({ title: res?.data?.message ?? "TotalPass 154 listo" });
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      toast({
        title: "No se pudo crear TotalPass",
        description: data?.detail || data?.message || e?.message,
        variant: "destructive",
      });
    },
  });

  const cancelMemberMutation = useMutation({
    mutationFn: ({ bookingId, force }: { bookingId: string; force?: boolean }) =>
      api.put(`/admin/bookings/${bookingId}/cancel${force ? "?force=1" : ""}`),
    onSuccess: (res: any) => {
      invalidateRoster();
      const d = res?.data?.data ?? res?.data;
      const base = d?.message ?? "Reserva cancelada";
      toast({ title: d?.forced ? `${base} · Forzada como excepción` : (d?.promotedFromWaitlist ? `${base} · Promovida desde lista de espera` : base) });
    },
    onError: (e: any, vars) => {
      const data = e?.response?.data;
      const code = data?.code;
      const overridable = code === "CANCELLATIONS_LIMIT_REACHED" || code === "CANCELLATIONS_DISABLED";
      if (overridable && !vars?.force) {
        const msg = data?.message ?? "No se pudo cancelar la reserva.";
        if (window.confirm(`${msg}\n\n¿Forzar la cancelación como excepción?`)) {
          cancelMemberMutation.mutate({ bookingId: vars.bookingId, force: true });
          return;
        }
      }
      toast({ title: data?.message ?? "Error al cancelar reserva", variant: "destructive" });
    },
  });

  const roster: any[] = data?.data?.roster ?? data?.roster ?? [];

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users size={14} />
          Asistentes ({roster.length})
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAssign(true)}>
            <Plus size={12} className="mr-1" />Asignar miembro
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowWalkIn(true)}>
            <Plus size={12} className="mr-1" />Bloquear lugar
          </Button>
        </div>
      </div>

      <Dialog open={showAssign} onOpenChange={(v) => { setShowAssign(v); if (!v) setMemberSearch(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar reserva a miembro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Buscar por nombre, email o teléfono"
                autoFocus
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
                    className="w-full px-3 py-2.5 text-left hover:bg-[#716D64]/[0.06] border-b last:border-b-0 border-border disabled:opacity-60"
                  >
                    <p className="text-sm font-medium">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email ?? "—"}{u.phone ? ` · ${u.phone}` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showWalkIn} onOpenChange={(v) => { if (!v) setShowWalkIn(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bloquear lugar — Walk-in</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nombre *</Label>
              <Input value={walkInForm.name} onChange={(e) => setWalkInForm({ ...walkInForm, name: e.target.value })} autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Teléfono (opcional)</Label>
              <PhoneInput
                value={walkInForm.phone}
                onChange={(v) => setWalkInForm({ ...walkInForm, phone: v })}
              />
              <p className="text-[10px] text-muted-foreground">Si después se registra, se vincularán sus compras automáticamente.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select value={walkInForm.planId} onValueChange={(v) => {
                const plan = walkInPlans.find((p: any) => p.id === v);
                const price = plan?.discountPrice ?? plan?.discount_price ?? plan?.price ?? "";
                setWalkInForm({ ...walkInForm, planId: v, amount: price ? String(price) : walkInForm.amount });
              }}>
                <SelectTrigger><SelectValue placeholder="Selecciona un plan" /></SelectTrigger>
                <SelectContent>
                  {walkInPlans
                    .slice()
                    .sort((a: any, b: any) => Number(b.isAdminOnly ?? b.is_admin_only ?? 0) - Number(a.isAdminOnly ?? a.is_admin_only ?? 0))
                    .map((p: any) => {
                      const adminOnly = !!(p.isAdminOnly ?? p.is_admin_only);
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {adminOnly ? "🔒 " : ""}{p.name} — ${p.price}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              {!walkInPlans.some((p: any) => /totalpass/i.test(String(p.name))) && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
                  <p className="text-[10px] text-amber-700">⚠️ TotalPass 154 no detectado.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] border-amber-400 text-amber-700 hover:bg-amber-100"
                    disabled={seedTotalPassMutation.isPending}
                    onClick={() => seedTotalPassMutation.mutate()}
                  >
                    {seedTotalPassMutation.isPending ? "Creando…" : "Crear ahora"}
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Método de pago</Label>
                <Select value={walkInForm.paymentMethod} onValueChange={(v) => setWalkInForm({ ...walkInForm, paymentMethod: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Monto cobrado</Label>
                <Input type="number" placeholder="0" value={walkInForm.amount}
                  onChange={(e) => setWalkInForm({ ...walkInForm, amount: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWalkIn(false)}>Cancelar</Button>
            <Button
              disabled={!walkInForm.name.trim() || walkInMutation.isPending}
              onClick={() => walkInMutation.mutate({
                name: walkInForm.name.trim(),
                phone: walkInForm.phone.trim() || null,
                planId: walkInForm.planId || null,
                paymentMethod: walkInForm.paymentMethod,
                amount: walkInForm.amount ? Number(walkInForm.amount) : 0,
              })}
            >
              {walkInMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : roster.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin reservas</p>
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-auto">
          {roster.map((r: any) => {
            const isWalkIn = !r.userId && !r.user_id;
            const name = r.displayName ?? r.display_name ?? r.guestName ?? r.guest_name ?? "—";
            const bookingId = r.bookingId ?? r.booking_id;
            const status = r.status;
            const canCheckin = !isWalkIn && (status === "confirmed" || status === "waitlist");
            const canNoShow  = !isWalkIn && status === "confirmed";
            const canCancelMember = !isWalkIn && (status === "confirmed" || status === "waitlist");
            const anyMutating = checkinMutation.isPending || noShowMutation.isPending || cancelMemberMutation.isPending;
            return (
              <div key={bookingId} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                <div className="min-w-0 flex items-center gap-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {isWalkIn ? "Walk-in / Sin cuenta" : (r.planName ?? r.plan_name ?? "")}
                    </p>
                  </div>
                  {isWalkIn && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-400/60 text-amber-600">Invitado</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? ""}`}>
                    {STATUS_LABEL[status] ?? status}
                  </span>
                  {canCheckin && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600 hover:bg-emerald-500/10"
                      title="Check-in"
                      onClick={() => checkinMutation.mutate(bookingId)}
                      disabled={anyMutating}>
                      <CheckCircle2 size={12} />
                    </Button>
                  )}
                  {canNoShow && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:bg-red-500/10"
                      title="No asistió"
                      onClick={() => noShowMutation.mutate(bookingId)}
                      disabled={anyMutating}>
                      <UserX size={12} />
                    </Button>
                  )}
                  {canCancelMember && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-[#716D64] hover:bg-[#716D64]/10"
                      title="Cancelar reserva (devuelve crédito)"
                      onClick={() => {
                        if (window.confirm(`¿Cancelar la reserva de ${name}? Se devolverá el crédito y se promoverá la lista de espera si hay.`)) {
                          cancelMemberMutation.mutate({ bookingId });
                        }
                      }}
                      disabled={anyMutating}>
                      <Ban size={12} />
                    </Button>
                  )}
                  {isWalkIn && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      title="Liberar lugar"
                      onClick={() => cancelWalkInMutation.mutate(bookingId)}
                      disabled={cancelWalkInMutation.isPending}>
                      <X size={11} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ClassesCalendar = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<TabKey>("calendar");

  const { data: typesData } = useQuery<{ data: ClassType[] }>({
    queryKey: ["class-types"],
    queryFn: async () => (await api.get("/class-types")).data,
  });
  const types = Array.isArray(typesData?.data) ? typesData.data : [];

  const { data: instructorsData } = useQuery<{ data: { id: string; displayName: string }[] }>({
    queryKey: ["instructors"],
    queryFn: async () => (await api.get("/instructors")).data,
  });
  const instructors = Array.isArray(instructorsData?.data) ? instructorsData.data : [];

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-6xl">
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-valiance-oat bg-valiance-ivory p-4 shadow-valiance-soft sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-valiance-mauve/70">Calendario</p>
              <h1 className="admin-title font-display text-valiance-charcoal">Clases</h1>
              <p className="mt-1 text-xs text-valiance-charcoal/50 sm:text-sm">Gestiona calendario, tipos, generación semanal e instructoras.</p>
            </div>
            <div className="w-full sm:w-auto">
              <div className="grid grid-cols-2 gap-1 rounded-2xl border border-valiance-oat bg-valiance-oat/30 p-1 sm:flex">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={
                    "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap transition-all sm:px-4 sm:text-sm " +
                    (tab === key
                      ? "bg-valiance-charcoal text-valiance-nude shadow-valiance-soft"
                      : "text-valiance-mauve hover:bg-valiance-ivory hover:text-valiance-charcoal")
                  }
                >
                  <Icon size={15} />
                  {isMobile
                    ? key === "types"
                      ? "Tipos"
                      : key === "generate"
                        ? "Generar"
                        : key === "instructors"
                          ? "Equipo"
                          : label
                    : label}
                </button>
              ))}
              </div>
            </div>
          </div>

          {tab === "calendar" && <CalendarTab types={types} instructors={instructors} toast={toast} qc={qc} />}
          {tab === "types" && <TypesTab types={types} toast={toast} qc={qc} />}
          {tab === "generate" && <GenerateTab types={types} instructors={instructors} toast={toast} />}
          {tab === "instructors" && <InstructorsTab toast={toast} qc={qc} />}
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   TAB 1 – CALENDAR
   ═══════════════════════════════════════════════════════════════════ */
function CalendarTab({
  types,
  instructors,
  toast,
  qc,
}: {
  types: ClassType[];
  instructors: { id: string; displayName: string }[];
  toast: any;
  qc: any;
}) {
  const isMobile = useIsMobile();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedClass, setSelectedClass] = useState<ClassInstance | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mobileDay, setMobileDay] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const start = format(weekStart, "yyyy-MM-dd");
  const end = format(addDays(weekStart, 6), "yyyy-MM-dd");

  const { data } = useQuery<{ data: ClassInstance[] }>({
    queryKey: ["classes", start, end],
    queryFn: async () => {
      const res = await api.get("/classes?start=" + start + "&end=" + end);
      const raw: any[] = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
      // Normalise snake_case → camelCase expected by ClassInstance
      const mapped: ClassInstance[] = raw.map((c: any) => ({
        id:               c.id,
        classTypeId:      c.class_type_id,
        classTypeName:    c.class_type_name,
        classTypeColor:   c.class_type_color,
        instructorId:     c.instructor_id,
        instructorName:   c.instructor_name,
        instructorPhoto:  c.instructor_photo,
        startTime:        c.start_time,   // already full ISO from server normalisation
        endTime:          c.end_time,
        maxCapacity:      c.max_capacity ?? c.capacity ?? 10,
        capacity:         c.max_capacity ?? c.capacity ?? 10,
        bookedCount:      c.current_bookings ?? 0,
        currentBookings:  c.current_bookings ?? 0,
        isCancelled:      c.status === "cancelled" || c.is_cancelled === true,
        notes:            c.notes,
      }));
      return { data: mapped };
    },
  });
  const classes = Array.isArray(data?.data) ? data.data : [];

  const form = useForm<ClassFormData>({ resolver: zodResolver(classSchema) });

  const createMutation = useMutation({
    mutationFn: (d: ClassFormData) => api.post("/classes", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes"] });
      toast({ title: "Clase creada" });
      setCreateOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.put("/classes/" + id + "/cancel"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes"] });
      toast({ title: "Clase cancelada" });
      setSheetOpen(false);
    },
  });

  const clearWeekMutation = useMutation({
    mutationFn: () => api.delete("/classes/week", { data: { startDate: start, endDate: end } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["classes"] });
      const deleted = Number(res?.data?.deleted ?? 0);
      toast({
        title: deleted === 1 ? "1 clase eliminada de la semana" : `${deleted} clases eliminadas de la semana`,
      });
      setSheetOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? "No se pudo limpiar la semana";
      toast({ title: message, variant: "destructive" });
    },
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const classesForDay = (date: Date) =>
    classes.filter((c) => c.startTime?.startsWith(format(date, "yyyy-MM-dd")));

  useEffect(() => {
    const currentWeekDays = days.map((d) => format(d, "yyyy-MM-dd"));
    if (!currentWeekDays.includes(mobileDay)) {
      setMobileDay(currentWeekDays[0]);
    }
  }, [weekStart, mobileDay, days]);

  const openCreate = (date: string) => {
    setSelectedDate(date);
    form.reset({ startTime: date + "T09:00", endTime: date + "T10:00", maxCapacity: 5 });
    setCreateOpen(true);
  };

  const shiftWeek = (offset: number) => {
    const next = addDays(weekStart, offset);
    setWeekStart(next);
    if (isMobile) setMobileDay(format(next, "yyyy-MM-dd"));
  };

  const weekLabel = `${format(weekStart, "d MMM", { locale: es })} – ${format(addDays(weekStart, 6), "d MMM yyyy", { locale: es })}`;

  const handleClearWeek = () => {
    if (classes.length === 0 || clearWeekMutation.isPending) return;
    const confirmed = window.confirm(
      `Esto eliminará todas las clases de la semana (${weekLabel}). Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    clearWeekMutation.mutate();
  };

  const mobileDayDate = parseISO(mobileDay);
  const mobileClasses = classes.filter((c) => c.startTime?.startsWith(mobileDay));

  return (
    <>
      {/* Week nav */}
      <div className="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <Button variant="outline" size="icon" onClick={() => shiftWeek(-7)}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-center text-xs font-medium sm:text-sm">{weekLabel}</span>
          <Button variant="outline" size="icon" onClick={() => shiftWeek(7)}>
            <ChevronRight size={14} />
          </Button>
        </div>
        <div className="flex justify-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleClearWeek}
            disabled={clearWeekMutation.isPending || classes.length === 0}
            className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {clearWeekMutation.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
            Limpiar semana
          </Button>
        </div>
      </div>

      {isMobile ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-2">
            <div className="flex min-w-max gap-2">
              {days.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const isActive = dayKey === mobileDay;
                const count = classesForDay(day).length;
                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => setMobileDay(dayKey)}
                    className={cn(
                      "flex min-h-[52px] min-w-[76px] flex-col items-center justify-center rounded-xl border px-2 text-xs transition-colors",
                      isActive
                        ? "border-[#716D64]/60 bg-gradient-to-r from-[#716D64]/20 to-[#D1B9B4]/20 text-[#444444]"
                        : "border-[#716D64]/15 bg-[#716D64]/10 text-[#444444]/70",
                    )}
                  >
                    <span className="text-[10px] uppercase">{DAYS_ES[day.getDay()]}</span>
                    <span className="text-base font-bold leading-none">{format(day, "d")}</span>
                    <span className="mt-0.5 text-[10px] text-[#444444]/55">{count} cls</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#444444]/45">{DAYS_ES[mobileDayDate.getDay()]}</p>
                <p className="text-sm font-semibold text-[#444444]">{format(mobileDayDate, "d 'de' MMMM", { locale: es })}</p>
              </div>
              <Button size="sm" className="h-9" onClick={() => openCreate(mobileDay)}>
                <Plus size={14} className="mr-1" /> Nueva
              </Button>
            </div>

            {mobileClasses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#716D64]/15 p-6 text-center text-xs text-[#444444]/45">
                Sin clases programadas para este día.
              </div>
            ) : (
              <div className="space-y-2">
                {mobileClasses.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedClass(c); setSheetOpen(true); }}
                    className="w-full rounded-xl border border-[#716D64]/15 bg-[#716D64]/10 p-3 text-left"
                    style={{ borderLeftColor: c.classTypeColor ?? "#D1B9B4", borderLeftWidth: 3 }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#444444]">{c.classTypeName ?? "Clase"}</p>
                        <p className="text-xs text-[#444444]/60">
                          {c.startTime ? format(parseISO(c.startTime), "HH:mm") : "—"}
                          {" - "}
                          {c.endTime ? format(parseISO(c.endTime), "HH:mm") : "—"}
                        </p>
                      </div>
                      <Badge variant={c.isCancelled ? "destructive" : "secondary"} className="text-[10px]">
                        {c.isCancelled ? "Cancelada" : "Activa"}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {c.instructorPhoto ? (
                        <img
                          src={c.instructorPhoto}
                          alt={c.instructorName ?? ""}
                          className="h-6 w-6 rounded-full object-cover ring-1 ring-white/25"
                        />
                      ) : (
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-full text-[0.6rem] font-bold text-[#444444]"
                          style={{ background: c.classTypeColor ?? "#D1B9B4" }}
                        >
                          {(c.instructorName ?? "?")[0].toUpperCase()}
                        </span>
                      )}
                      <span className="truncate text-xs text-[#444444]/60">{c.instructorName ?? "—"}</span>
                      <span className="ml-auto text-xs text-[#444444]/55">
                        {(c.bookedCount ?? c.currentBookings ?? 0)}/{c.maxCapacity ?? c.capacity ?? "?"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-valiance-oat bg-valiance-ivory p-3 shadow-valiance-soft">
          <div className="grid min-w-[1060px] grid-cols-7 gap-3">
            {days.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayClasses = classesForDay(day).sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
              return (
                <div key={dayKey} className="min-h-[420px] rounded-2xl border border-valiance-oat bg-valiance-oat/18 p-3">
                  <button
                    type="button"
                    className="mb-3 flex w-full items-center justify-between rounded-xl px-1 py-1 text-left transition-colors hover:bg-valiance-ivory/70"
                    onClick={() => openCreate(dayKey)}
                  >
                    <div>
                      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-valiance-mauve/65">
                        {DAYS_ES[day.getDay()]}
                      </p>
                      <p className="font-display text-2xl leading-none text-valiance-charcoal">{format(day, "d")}</p>
                    </div>
                    <span className="rounded-full bg-valiance-ivory px-2.5 py-1 text-[0.65rem] font-medium text-valiance-mauve ring-1 ring-valiance-oat">
                      {dayClasses.length}
                    </span>
                  </button>

                  <div className="space-y-2">
                    {dayClasses.map((c) => {
                      const booked = c.bookedCount ?? c.currentBookings ?? 0;
                      const capacity = c.maxCapacity ?? c.capacity ?? 0;
                      const ratio = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
                      const accent = c.classTypeColor ?? "#716D64";
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSelectedClass(c); setSheetOpen(true); }}
                          className={cn(
                            "w-full rounded-2xl border bg-valiance-ivory p-3 text-left shadow-[0_10px_24px_-22px_rgba(68,68,68,0.4)] transition-all hover:-translate-y-0.5 hover:shadow-valiance-card",
                            c.isCancelled ? "border-destructive/25 opacity-60" : "border-valiance-oat hover:border-valiance-fern/45"
                          )}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-valiance-charcoal">{c.classTypeName ?? "Clase"}</p>
                              <p className="mt-0.5 text-xs font-medium tabular-nums text-valiance-mauve">
                                {c.startTime ? format(parseISO(c.startTime), "HH:mm") : "—"} - {c.endTime ? format(parseISO(c.endTime), "HH:mm") : "—"}
                              </p>
                            </div>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
                          </div>

                          <div className="flex items-center gap-2">
                            {c.instructorPhoto ? (
                              <img
                                src={c.instructorPhoto}
                                alt={c.instructorName ?? ""}
                                className="h-6 w-6 rounded-full object-cover ring-1 ring-valiance-oat"
                              />
                            ) : (
                              <span
                                className="flex h-6 w-6 items-center justify-center rounded-full text-[0.62rem] font-bold text-valiance-charcoal"
                                style={{ backgroundColor: `${accent}38` }}
                              >
                                {(c.instructorName ?? "?")[0].toUpperCase()}
                              </span>
                            )}
                            <span className="min-w-0 truncate text-xs text-valiance-charcoal/65">{c.instructorName ?? "—"}</span>
                          </div>

                          <div className="mt-3">
                            <div className="mb-1.5 flex items-center justify-between text-[0.66rem] font-medium text-valiance-mauve">
                              <span>Cupo</span>
                              <span className="tabular-nums">{booked}/{capacity || "?"}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-valiance-oat">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${ratio}%`, backgroundColor: ratio >= 90 ? "#D1B9B4" : accent }}
                              />
                            </div>
                          </div>

                          {c.isCancelled && <Badge variant="destructive" className="mt-3 rounded-full px-2 text-[0.6rem]">Cancelada</Badge>}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openCreate(dayKey)}
                      className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-dashed border-valiance-oat bg-valiance-ivory/50 text-valiance-mauve transition-colors hover:border-valiance-fern/45 hover:bg-valiance-ivory"
                      aria-label={`Crear clase para ${format(day, "d MMM", { locale: es })}`}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva clase</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1">
              <Label>Tipo de clase</Label>
              <Select onValueChange={(v) => form.setValue("classTypeId", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Instructor</Label>
              <Select onValueChange={(v) => form.setValue("instructorId", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar instructor" /></SelectTrigger>
                <SelectContent>
                  {instructors.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>{inst.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Inicio</Label><Input type="datetime-local" {...form.register("startTime")} /></div>
              <div className="space-y-1"><Label>Fin</Label><Input type="datetime-local" {...form.register("endTime")} /></div>
            </div>
            <div className="space-y-1"><Label>Capacidad máxima</Label><Input type="number" {...form.register("maxCapacity")} /></div>
            <div className="space-y-1"><Label>Notas</Label><Input {...form.register("notes")} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-gradient-to-r from-[#D1B9B4] to-[#716D64] text-white">Crear</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{selectedClass?.classTypeName ?? "Clase"}</SheetTitle></SheetHeader>
          {selectedClass && (
            <div className="mt-6 space-y-4 text-sm">
              {/* Instructor with avatar */}
              <div className="flex items-center gap-3">
                {selectedClass.instructorPhoto ? (
                  <img src={selectedClass.instructorPhoto} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-offset-1" style={{ outline: `2px solid ${selectedClass.classTypeColor ?? "#D1B9B4"}` }} />
                ) : (
                  <span className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[#444444] text-sm" style={{ background: selectedClass.classTypeColor ?? "#D1B9B4" }}>
                    {(selectedClass.instructorName ?? "?")[0].toUpperCase()}
                  </span>
                )}
                <div>
                  <div className="font-medium">{selectedClass.instructorName ?? selectedClass.instructorId}</div>
                  <div className="text-xs text-muted-foreground">Instructor</div>
                </div>
              </div>
              <div><span className="font-medium">Inicio:</span> {selectedClass.startTime ? new Date(selectedClass.startTime).toLocaleString("es-MX", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }) : "—"}</div>
              <div><span className="font-medium">Cupo:</span> {(selectedClass.bookedCount ?? selectedClass.currentBookings ?? 0) + " / " + (selectedClass.maxCapacity ?? selectedClass.capacity ?? "?")}</div>
              {selectedClass.notes && <div><span className="font-medium">Notas:</span> {selectedClass.notes}</div>}

              {/* ── Attendees list ── */}
              <ClassAttendees classId={selectedClass.id} />

              <div className="pt-2 flex flex-col gap-2">
                {!selectedClass.isCancelled && (
                  <Button variant="destructive" onClick={() => cancelMutation.mutate(selectedClass.id)} disabled={cancelMutation.isPending}>
                    Cancelar clase
                  </Button>
                )}
                {selectedClass.isCancelled && <Badge variant="destructive">Clase cancelada</Badge>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 2 – CLASS TYPES
   ═══════════════════════════════════════════════════════════════════ */
function TypesTab({ types, toast, qc }: { types: ClassType[]; toast: any; qc: any }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassType | null>(null);
  const form = useForm<TypeFormData>({
    resolver: zodResolver(typeSchema),
    defaultValues: { color: "#D1B9B4", category: "reformer", defaultDuration: 50, maxCapacity: 5, isActive: true },
  });

  const createMutation = useMutation({
    mutationFn: (d: TypeFormData) => api.post("/class-types", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-types"] });
      toast({ title: "Tipo creado" });
      setOpen(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: any) => api.put("/class-types/" + id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-types"] });
      toast({ title: "Tipo actualizado" });
      setOpen(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete("/class-types/" + id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-types"] });
      toast({ title: "Tipo eliminado" });
    },
  });

  const openEdit = (t: ClassType) => {
    form.reset({
      name: t.name,
      color: t.color,
      category: (["reformer", "barre", "pilates", "bienestar"].includes(String(t.category))
        ? (t.category as "reformer" | "barre" | "pilates" | "bienestar")
        : "reformer"),
      defaultDuration: t.defaultDuration ?? t.durationMin ?? 50,
      maxCapacity: t.maxCapacity ?? t.capacity ?? 10,
      isActive: t.isActive ?? true,
    });
    setEditing(t);
    setOpen(true);
  };
  const openCreate = () => {
    form.reset({ color: "#D1B9B4", category: "reformer", defaultDuration: 50, maxCapacity: 5, isActive: true });
    setEditing(null);
    setOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <p className="text-sm text-muted-foreground">{types.length} tipos registrados</p>
        <Button size="sm" onClick={openCreate} className="bg-gradient-to-r from-[#D1B9B4] to-[#716D64] text-white">
          <Plus size={14} className="mr-1" />Nuevo tipo
        </Button>
      </div>

      {isMobile ? (
        <div className="space-y-2">
          {types.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#716D64]/15 p-6 text-center text-xs text-[#444444]/45">
              Sin tipos registrados.
            </div>
          ) : (
            types.map((t) => (
              <div key={t.id} className="rounded-xl border border-[#716D64]/15 bg-[#716D64]/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: t.color }} />
                      <p className="truncate text-sm font-semibold text-[#444444]">{t.name}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.category === "reformer" && <Badge className="bg-[#D1B9B4]/20 text-[#716D64] border border-[#D1B9B4]/30">Reformer</Badge>}
                      {t.category === "barre" && <Badge className="bg-[#716D64]/15 text-[#716D64] border border-[#716D64]/25">Barre</Badge>}
                      {t.category === "bienestar" && <Badge className="bg-[#716D64]/20 text-[#716D64] border border-[#716D64]/30">Bienestar</Badge>}
                      {t.category === "pilates" && <Badge className="bg-[#D1B9B4]/20 text-[#716D64] border border-[#D1B9B4]/30">Pilates</Badge>}
                      {!t.category && <Badge variant="secondary">—</Badge>}
                      <Badge variant="outline">{(t.defaultDuration ?? t.durationMin ?? "—") + " min"}</Badge>
                      <Badge variant="outline">{(t.maxCapacity ?? t.capacity ?? "—") + " cupos"}</Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-11 w-11 min-h-[44px] min-w-[44px]">
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => openEdit(t)}>Editar</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar este tipo de clase?")) deleteMutation.mutate(t.id); }}>Eliminar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-2">
                  <Badge
                    variant={t.isActive !== false ? "default" : "secondary"}
                    className={t.isActive !== false ? "bg-[#D1B9B4]/20 text-[#D1B9B4] border border-[#D1B9B4]/30" : ""}
                  >
                    {t.isActive !== false ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Color</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead>Capacidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell><div className="w-6 h-6 rounded-full shadow-sm" style={{ backgroundColor: t.color }} /></TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    {t.category === "reformer" && <Badge className="bg-[#D1B9B4]/20 text-[#716D64] border border-[#D1B9B4]/30">Reformer</Badge>}
                    {t.category === "barre" && <Badge className="bg-[#716D64]/15 text-[#716D64] border border-[#716D64]/25">Barre</Badge>}
                    {t.category === "bienestar" && <Badge className="bg-[#716D64]/20 text-[#716D64] border border-[#716D64]/30">Bienestar</Badge>}
                    {t.category === "pilates" && <Badge className="bg-[#D1B9B4]/20 text-[#716D64] border border-[#D1B9B4]/30">Pilates</Badge>}
                    {!t.category && <Badge variant="secondary">—</Badge>}
                  </TableCell>
                  <TableCell>{(t.defaultDuration ?? t.durationMin ?? "—") + " min"}</TableCell>
                  <TableCell>{t.maxCapacity ?? t.capacity ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={t.isActive !== false ? "default" : "secondary"}
                      className={t.isActive !== false ? "bg-[#D1B9B4]/20 text-[#D1B9B4] border border-[#D1B9B4]/30" : ""}
                    >
                      {t.isActive !== false ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => openEdit(t)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar este tipo de clase?")) deleteMutation.mutate(t.id); }}>Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* CRUD dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Editar tipo" : "Nuevo tipo de clase"}</DialogTitle></DialogHeader>
          <form
            onSubmit={form.handleSubmit((d) =>
              editing ? updateMutation.mutate({ ...d, id: editing.id }) : createMutation.mutate(d)
            )}
            className="space-y-4"
          >
            <div className="space-y-1"><Label>Nombre</Label><Input {...form.register("name")} /></div>
            <div className="space-y-1">
              <Label>Categoría</Label>
              <Select
                value={form.watch("category")}
                onValueChange={(v) => form.setValue("category", v as "reformer" | "barre" | "pilates" | "bienestar")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reformer">Pilates Reformer</SelectItem>
                  <SelectItem value="barre">Barre</SelectItem>
                  <SelectItem value="bienestar">Bienestar</SelectItem>
                  <SelectItem value="pilates">Pilates (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {PALETTE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => form.setValue("color", c.value)}
                    className={
                      "w-8 h-8 rounded-full border-2 transition-all " +
                      (form.watch("color") === c.value
                        ? "border-foreground scale-110 ring-2 ring-offset-2 ring-offset-background ring-[#D1B9B4]"
                        : "border-transparent opacity-70 hover:opacity-100")
                    }
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
              <Input type="color" {...form.register("color")} className="h-8 w-16 cursor-pointer" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Duración (min)</Label><Input type="number" {...form.register("defaultDuration")} /></div>
              <div className="space-y-1"><Label>Capacidad máx.</Label><Input type="number" {...form.register("maxCapacity")} /></div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
              <Label>Activo</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" className="bg-gradient-to-r from-[#D1B9B4] to-[#716D64] text-white">
                {editing ? "Actualizar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 3 – GENERATE WEEK  (beautiful version)
   ═══════════════════════════════════════════════════════════════════ */
function GenerateTab({
  types,
  instructors,
  toast,
}: {
  types: ClassType[];
  instructors: { id: string; displayName: string }[];
  toast: any;
}) {
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [classTypeId, setClassTypeId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [maxCapacity, setMaxCapacity] = useState(10);

  const selectedType = types.find((t) => t.id === classTypeId);
  const selectedInstructor = instructors.find((i) => i.id === instructorId);

  // Preview: how many classes will be generated
  const preview = useMemo(() => {
    if (!startDate || !endDate || !selectedDays.length) return [];
    try {
      const days = eachDayOfInterval({
        start: parseISO(startDate),
        end: parseISO(endDate),
      });
      return days.filter((d) => selectedDays.includes(d.getDay()));
    } catch {
      return [];
    }
  }, [startDate, endDate, selectedDays]);

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post("/classes/generate", {
        classTypeId,
        instructorId,
        startDate,
        endDate,
        daysOfWeek: selectedDays,
        startTime,
        endTime,
        maxCapacity,
      }),
    onSuccess: (res: any) => toast({ title: `✨ ${res.data?.created ?? 0} clases generadas` }),
    onError: (error: any) =>
      toast({
        title: error?.response?.data?.message ?? "Error generando clases",
        variant: "destructive",
      }),
  });

  const toggleDay = (v: number) => {
    setSelectedDays((prev) =>
      prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]
    );
  };

  const canGenerate = classTypeId && instructorId && startDate && endDate && selectedDays.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center mb-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-[#D1B9B4]/10 to-[#716D64]/10 border border-[#D1B9B4]/20 mb-3">
          <Sparkles size={14} className="text-[#FAF8F6]" />
          <span className="text-xs font-semibold text-[#D1B9B4]">Generador de clases</span>
        </div>
        <h2 className="text-2xl font-bold text-[#444444]">Generar clases en bloque</h2>
        <p className="text-sm text-[#444444]/40 mt-1">Selecciona tipo, instructor, rango de fechas y días</p>
      </div>

      {/* ── Step 1: Class type + Instructor ── */}
      <div className="rounded-2xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#D1B9B4]/20 text-[#D1B9B4] text-xs font-bold">1</span>
          <span className="text-xs font-semibold text-[#D1B9B4]/70 uppercase tracking-wider">Clase e instructor</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Tipo de clase</Label>
            <Select onValueChange={setClassTypeId}>
              <SelectTrigger className="bg-[#716D64]/[0.06] border-[#716D64]/15 text-[#444444]">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Instructor</Label>
            <Select onValueChange={setInstructorId}>
              <SelectTrigger className="bg-[#716D64]/[0.06] border-[#716D64]/15 text-[#444444]">
                <SelectValue placeholder="Seleccionar instructor" />
              </SelectTrigger>
              <SelectContent>
                {instructors.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>{inst.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Step 2: Date range ── */}
      <div className="rounded-2xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#716D64]/20 text-[#716D64] text-xs font-bold">2</span>
          <span className="text-xs font-semibold text-[#716D64]/70 uppercase tracking-wider">Rango de fechas</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Fecha inicio</Label>
            <DatePicker value={startDate} onChange={setStartDate} placeholder="Desde" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Fecha fin</Label>
            <DatePicker value={endDate} onChange={setEndDate} placeholder="Hasta" min={startDate} />
          </div>
        </div>
      </div>

      {/* ── Step 3: Days of week ── */}
      <div className="rounded-2xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#FAF8F6]/20 text-[#FAF8F6] text-xs font-bold">3</span>
          <span className="text-xs font-semibold text-[#FAF8F6]/70 uppercase tracking-wider">Días de la semana</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {GENERATE_DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={
                "relative px-5 py-2.5 rounded-xl text-sm font-semibold transition-all " +
                (selectedDays.includes(d.value)
                  ? "bg-gradient-to-r from-[#716D64] to-[#D1B9B4] text-white shadow-[0_0_12px_rgba(148,134,122,0.3)]"
                  : "bg-[#716D64]/[0.06] border border-[#716D64]/15 text-[#444444]/45 hover:text-[#444444]/75 hover:border-[#716D64]/25")
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => setSelectedDays([1, 2, 3, 4, 5])}
            className="text-[10px] text-[#D1B9B4] font-medium hover:underline"
          >
            Lun–Vie
          </button>
          <button
            type="button"
            onClick={() => setSelectedDays([1, 2, 3, 4, 5, 6])}
            className="text-[10px] text-[#D1B9B4] font-medium hover:underline"
          >
            Lun–Sáb
          </button>
          <button
            type="button"
            onClick={() => setSelectedDays([0, 1, 2, 3, 4, 5, 6])}
            className="text-[10px] text-[#D1B9B4] font-medium hover:underline"
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setSelectedDays([])}
            className="text-[10px] text-[#444444]/30 font-medium hover:underline"
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* ── Step 4: Time + Capacity ── */}
      <div className="rounded-2xl border border-[#716D64]/15 bg-[#716D64]/[0.04] p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#716D64]/20 text-[#716D64] text-xs font-bold">4</span>
          <span className="text-xs font-semibold text-[#716D64]/70 uppercase tracking-wider">Horario y capacidad</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Hora inicio</Label>
            <TimePicker value={startTime} onChange={setStartTime} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Hora fin</Label>
            <TimePicker value={endTime} onChange={setEndTime} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#444444]/60 text-xs">Capacidad máx.</Label>
            <Input
              type="number"
              value={maxCapacity}
              onChange={(e) => setMaxCapacity(Number(e.target.value))}
              className="bg-[#716D64]/[0.06] border-[#716D64]/15 text-[#444444] text-center"
            />
          </div>
        </div>
      </div>

      {/* ── Preview ── */}
      {preview.length > 0 && (
        <div className="rounded-2xl border border-[#D1B9B4]/20 bg-gradient-to-br from-[#D1B9B4]/5 to-[#716D64]/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-[#FAF8F6]" />
              <span className="text-xs font-semibold text-[#444444]/60 uppercase tracking-wider">Vista previa</span>
            </div>
            <Badge variant="outline" className="border-[#D1B9B4]/30 text-[#D1B9B4] font-bold">
              {preview.length} {preview.length === 1 ? "clase" : "clases"}
            </Badge>
          </div>

          <div className="hidden grid-cols-7 gap-1.5 sm:grid">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
              <div key={d} className="text-center text-[10px] font-bold text-[#444444]/25 uppercase">{d}</div>
            ))}
          </div>

          <div className="grid max-h-[220px] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-7">
            {preview.map((d) => (
              <div
                key={d.toISOString()}
                className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg bg-[#716D64]/[0.05] border border-[#716D64]/12"
              >
                <span className="text-[10px] text-[#444444]/40">
                  {format(d, "MMM", { locale: es })}
                </span>
                <span className="text-sm font-bold text-[#444444]">
                  {format(d, "d")}
                </span>
                <span className="text-[9px] text-[#FAF8F6]/60 font-medium">
                  {startTime}
                </span>
                {selectedType && (
                  <span
                    className="w-2 h-2 rounded-full mt-0.5"
                    style={{ backgroundColor: selectedType.color }}
                  />
                )}
              </div>
            ))}
          </div>

          {selectedType && (
            <div className="flex items-center gap-3 pt-2 border-t border-[#716D64]/12">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedType.color }} />
              <span className="text-xs text-[#444444]/60">
                <strong className="text-[#444444]/80">{selectedType.name}</strong>
                {selectedInstructor && <> · {selectedInstructor.displayName}</>}
                {" · "}{startTime}–{endTime} · {maxCapacity} cupos
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Generate Button ── */}
      <button
        type="button"
        disabled={!canGenerate || generateMutation.isPending}
        onClick={() => generateMutation.mutate()}
        className={
          "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-semibold text-[#444444] transition-all " +
          (canGenerate
            ? "bg-gradient-to-r from-[#716D64] to-[#D1B9B4] hover:opacity-90 shadow-[0_4px_20px_rgba(148,134,122,0.25)]"
            : "bg-[#716D64]/[0.06] text-[#444444]/25 cursor-not-allowed")
        }
      >
        {generateMutation.isPending ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {generateMutation.isPending
          ? "Generando…"
          : preview.length > 0
          ? `Generar ${preview.length} clases`
          : "Generar clases"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 4 – INSTRUCTORAS
   ═══════════════════════════════════════════════════════════════════ */
function InstructorsTab({ toast, qc }: { toast: any; qc: any }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: Instructor[] }>({
    queryKey: ["instructors"],
    queryFn: async () => (await api.get("/instructors")).data,
  });
  const instructors = Array.isArray(data?.data) ? data.data : [];

  const form = useForm<InstructorFormData>({
    resolver: zodResolver(instructorSchema),
    defaultValues: { isActive: true, photoFocusX: 50, photoFocusY: 50 },
  });

  const createMutation = useMutation({
    mutationFn: (d: InstructorFormData) => api.post("/instructors", instructorPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructors"] });
      toast({ title: "Instructora creada" });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message ?? "Error al crear instructora", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: { id: string } & InstructorFormData) =>
      api.put(`/instructors/${id}`, instructorPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instructors"] });
      toast({ title: "Instructora actualizada" });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message ?? "Error al actualizar instructora", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/instructors/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["instructors"] }); toast({ title: "Instructora eliminada" }); },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message ?? "Error al eliminar instructora", variant: "destructive" });
    },
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("photo", file);
      return api.post(`/instructors/${id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["instructors"] }); toast({ title: "Foto actualizada" }); },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message ?? "Error al subir foto", variant: "destructive" });
    },
  });

  const openEdit = (i: Instructor) => {
    form.reset({
      displayName: i.displayName ?? "",
      email: i.email ?? "",
      bio: i.bio ?? "",
      specialties: normalizeSpecialties(i.specialties).join(", "),
      isActive: i.isActive ?? true,
      photoFocusX: clampFocus(i.photoFocusX),
      photoFocusY: clampFocus(i.photoFocusY),
    });
    setEditing(i);
    setOpen(true);
  };
  const openCreate = () => {
    form.reset({ displayName: "", email: "", bio: "", specialties: "", isActive: true, photoFocusX: 50, photoFocusY: 50 });
    setEditing(null);
    setOpen(true);
  };
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const focusX = clampFocus(form.watch("photoFocusX"));
  const focusY = clampFocus(form.watch("photoFocusY"));
  const applyPreviewFocus = (event: React.PointerEvent<HTMLElement>) => {
    const next = getFocusFromPointerEvent(event);
    form.setValue("photoFocusX", next.x, { shouldDirty: true, shouldTouch: true });
    form.setValue("photoFocusY", next.y, { shouldDirty: true, shouldTouch: true });
  };

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <p className="text-sm text-muted-foreground">{instructors.length} instructora{instructors.length !== 1 ? "s" : ""} registrada{instructors.length !== 1 ? "s" : ""}</p>
        <Button
          size="sm"
          onClick={openCreate}
          className="bg-gradient-to-r from-[#D1B9B4] to-[#716D64] text-white"
        >
          <Plus size={14} className="mr-1" />Nueva instructora
        </Button>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && uploadTarget) uploadPhotoMutation.mutate({ id: uploadTarget, file: f });
          e.target.value = "";
          setUploadTarget(null);
        }}
      />

      {isMobile ? (
        <div className="space-y-2">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
          ) : instructors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#716D64]/15 p-6 text-center text-xs text-[#444444]/45">
              Sin instructoras registradas.
            </div>
          ) : (
            instructors.map((ins) => (
              <div key={ins.id} className="rounded-xl border border-[#716D64]/15 bg-[#716D64]/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {ins.photoUrl ? (
                        <img
                          src={ins.photoUrl}
                          className="h-9 w-9 rounded-full object-cover ring-2 ring-[#D1B9B4]/30"
                          style={{ objectPosition: `${clampFocus(ins.photoFocusX)}% ${clampFocus(ins.photoFocusY)}%` }}
                          alt=""
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#D1B9B4] to-[#716D64] text-xs font-bold text-[#444444]">
                          {ins.displayName?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#444444]">{ins.displayName}</p>
                        <p className="truncate text-xs text-[#444444]/55">{ins.email}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-[#444444]/55">{normalizeSpecialties(ins.specialties).join(", ") || "Sin especialidades"}</p>
                    <div className="mt-2">
                      <Badge
                        variant={ins.isActive ? "default" : "secondary"}
                        className={ins.isActive ? "bg-[#D1B9B4]/20 text-[#D1B9B4] border border-[#D1B9B4]/30" : ""}
                      >
                        {ins.isActive ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-11 w-11 min-h-[44px] min-w-[44px]">
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => openEdit(ins)}>Editar</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setUploadTarget(ins.id); setTimeout(() => fileRef.current?.click(), 50); }}>
                        Subir foto
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar este instructor?")) deleteMutation.mutate(ins.id); }}>
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Especialidades</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(4).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(6).fill(0).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : instructors.map((ins) => (
                  <TableRow key={ins.id}>
                    <TableCell>
                      {ins.photoUrl ? (
                        <img
                          src={ins.photoUrl}
                          className="w-9 h-9 rounded-full object-cover ring-2 ring-[#D1B9B4]/30"
                          style={{ objectPosition: `${clampFocus(ins.photoFocusX)}% ${clampFocus(ins.photoFocusY)}%` }}
                          alt=""
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#D1B9B4] to-[#716D64] flex items-center justify-center text-xs font-bold text-[#444444]">
                          {ins.displayName?.[0]?.toUpperCase()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{ins.displayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{ins.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{normalizeSpecialties(ins.specialties).join(", ")}</TableCell>
                    <TableCell>
                      <Badge
                        variant={ins.isActive ? "default" : "secondary"}
                        className={ins.isActive ? "bg-[#D1B9B4]/20 text-[#D1B9B4] border border-[#D1B9B4]/30" : ""}
                      >
                        {ins.isActive ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => openEdit(ins)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setUploadTarget(ins.id); setTimeout(() => fileRef.current?.click(), 50); }}>
                            Subir foto
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("¿Eliminar este instructor?")) deleteMutation.mutate(ins.id); }}>
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </div>
      )}

      {/* CRUD dialog */}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setEditing(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar instructora" : "Nueva instructora"}</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            onSubmit={form.handleSubmit(
              (d) => {
                if (editing) {
                  updateMutation.mutate({ ...d, id: editing.id });
                  return;
                }
                createMutation.mutate(d);
              },
              (errors) => {
                const first = Object.values(errors)[0];
                toast({
                  title: first?.message ? String(first.message) : "Revisa los campos del formulario",
                  variant: "destructive",
                });
              },
            )}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input {...form.register("displayName")} />
              {form.formState.errors.displayName && (
                <p className="text-xs text-destructive">{String(form.formState.errors.displayName.message)}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{String(form.formState.errors.email.message)}</p>
              )}
            </div>
            <div className="space-y-1"><Label>Bio</Label><Input {...form.register("bio")} /></div>
            <div className="space-y-1">
              <Label>Especialidades (separadas por coma)</Label>
              <Input {...form.register("specialties")} placeholder="Ej: Pilates, Flex & Flow, Body Strong" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Enfoque horizontal</Label>
                <span className="text-xs text-muted-foreground">{focusX}%</span>
              </div>
              <Input
                type="range"
                min={0}
                max={100}
                step={1}
                value={focusX}
                onChange={(e) => form.setValue("photoFocusX", Number(e.target.value), { shouldDirty: true })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Enfoque vertical</Label>
                <span className="text-xs text-muted-foreground">{focusY}%</span>
              </div>
              <Input
                type="range"
                min={0}
                max={100}
                step={1}
                value={focusY}
                onChange={(e) => form.setValue("photoFocusY", Number(e.target.value), { shouldDirty: true })}
              />
            </div>
            {editing?.photoUrl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Vista previa y enfoque</Label>
                  <span className="text-[11px] text-muted-foreground">Haz clic o arrastra sobre la cara</span>
                </div>
                <button
                  type="button"
                  onPointerDown={applyPreviewFocus}
                  onPointerMove={(event) => {
                    if (event.buttons !== 1 && event.pointerType !== "touch") return;
                    applyPreviewFocus(event);
                  }}
                  className="group relative mx-auto block h-[360px] w-full max-w-[300px] touch-none overflow-hidden rounded-[28px] border border-[#716D64]/15 bg-[#716D64]/10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D1B9B4]"
                  aria-label="Seleccionar enfoque de la foto"
                >
                  <img
                    src={editing.photoUrl}
                    alt={editing.displayName}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    style={{ objectPosition: `${focusX}% ${focusY}%` }}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                  <div
                    className="pointer-events-none absolute h-8 w-8 rounded-full border border-[#716D64]/20 bg-[#716D64]/10 shadow-[0_0_0_1px_rgba(0,0,0,0.2)] backdrop-blur-sm"
                    style={{ left: `${focusX}%`, top: `${focusY}%`, transform: "translate(-50%, -50%)" }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-3 text-[11px] font-medium text-[#444444]/80">
                    <span>X {focusX}%</span>
                    <span>Y {focusY}%</span>
                  </div>
                </button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v, { shouldDirty: true })} />
              <Label>Activa</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSaving} className="bg-gradient-to-r from-[#D1B9B4] to-[#716D64] text-white">
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSaving ? "Guardando..." : editing ? "Actualizar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ClassesCalendar;
