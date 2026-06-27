import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Pencil, Save, X, Minus, Plus, MoreHorizontal, Loader2, CalendarDays,
  Mail, Phone, User2, Cake, HeartPulse, ShieldAlert, ArrowRight,
  CreditCard, Banknote, Smartphone, Store, BadgeCheck, CalendarClock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BulkMonthBookingDialog } from "@/components/admin/BulkMonthBookingDialog";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────
   Helpers — defensive parsing + es-MX formatting + brand labels
   ────────────────────────────────────────────────────────────── */

// Always pull an array out of `{ data: [...] }` or a bare `[...]`.
const asArray = (raw: any): any[] => (Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : []);

// First non-null value across camel/snake variants.
const pick = (obj: any, ...keys: string[]) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const fmtDateTime = (v: any) =>
  v
    ? new Date(v).toLocaleString("es-MX", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const fmtDate = (v: any) =>
  v ? new Date(v).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" }) : "—";

// Booking status → label + on-brand tone.
const bookingStatus = (s?: string): { label: string; cls: string } => {
  switch ((s ?? "").toLowerCase()) {
    case "confirmed":  return { label: "Confirmada",      cls: "bg-tep-lilacSoft text-valiance-plum border-tep-lavender/40" };
    case "checked_in": return { label: "Asistió",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "no_show":    return { label: "No asistió",      cls: "bg-amber-50 text-amber-800 border-amber-200" };
    case "cancelled":  return { label: "Cancelada",       cls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "waitlist":   return { label: "Lista de espera", cls: "bg-tep-gray/50 text-valiance-mauve border-border" };
    default:           return { label: s ?? "—",          cls: "bg-tep-gray/50 text-valiance-mauve border-border" };
  }
};

// Who cancelled a booking.
const cancelAuthor = (by?: string): string => {
  switch ((by ?? "").toLowerCase()) {
    case "user":   return "Por la alumna";
    case "admin":  return "Por el estudio";
    case "system": return "Sistema";
    default:       return "Sistema";
  }
};

// Payment origin/method → friendly label + icon + tone.
const paymentOrigin = (p: any): { label: string; icon: LucideIcon; cls: string } => {
  const source = (pick(p, "source") ?? "").toLowerCase();
  const method = (pick(p, "method", "payment_method", "paymentMethod") ?? "").toLowerCase();
  const provider = (pick(p, "provider") ?? "").toLowerCase();

  if (source === "membership")
    return { label: "Asignada por admin", icon: BadgeCheck, cls: "bg-tep-lilacSoft text-valiance-plum border-tep-lavender/40" };
  if (source === "walkin" || source === "pos")
    return { label: "POS / mostrador", icon: Store, cls: "bg-tep-gray/50 text-valiance-mauve border-border" };
  if (source === "order") {
    if (method === "card" || provider === "mercadopago")
      return { label: "Tarjeta · MercadoPago (app)", icon: CreditCard, cls: "bg-tep-rose/60 text-valiance-plum border-tep-blush/40" };
    if (method === "transfer")
      return { label: "Transferencia (app cliente)", icon: Smartphone, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (method === "cash")
      return { label: "Efectivo", icon: Banknote, cls: "bg-amber-50 text-amber-800 border-amber-200" };
  }
  // Fallbacks when source is missing.
  if (method === "card" || provider === "mercadopago")
    return { label: "Tarjeta · MercadoPago", icon: CreditCard, cls: "bg-tep-rose/60 text-valiance-plum border-tep-blush/40" };
  if (method === "transfer")
    return { label: "Transferencia", icon: Smartphone, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (method === "cash")
    return { label: "Efectivo", icon: Banknote, cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "Otro", icon: CreditCard, cls: "bg-tep-gray/50 text-valiance-mauve border-border" };
};

const paymentStatus = (s?: string): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
  switch ((s ?? "").toLowerCase()) {
    case "active":
    case "approved":  return { label: s?.toLowerCase() === "active" ? "Activa" : "Aprobada", variant: "default" };
    case "pending":   return { label: "Pendiente", variant: "secondary" };
    case "cancelled":
    case "rejected":  return { label: s?.toLowerCase() === "rejected" ? "Rechazada" : "Cancelada", variant: "destructive" };
    default:          return { label: s ?? "—", variant: "secondary" };
  }
};

const initials = (name?: string) =>
  (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "·";

/* ── Small presentational primitives ─────────────────────────── */

const SectionCard = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card shadow-valiance-card overflow-hidden">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
      <h2 className="font-display text-lg text-valiance-plum">{title}</h2>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const EmptyState = ({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-tep-nude text-valiance-blush">
      <Icon size={20} />
    </div>
    <p className="text-sm text-valiance-mauve">{children}</p>
  </div>
);

const StatusPill = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", className)}>
    {children}
  </span>
);

const methodLabel: Record<string, string> = {
  cash: "Efectivo",
  efectivo: "Efectivo",
  transfer: "Transferencia",
  transferencia: "Transferencia",
  card: "Tarjeta",
  tarjeta: "Tarjeta",
};

/* ──────────────────────────────────────────────────────────────
   Membresías tab — restyled + purchase info (createdAt / origin)
   ────────────────────────────────────────────────────────────── */

const MembershipsTab = ({ userId }: { userId: string }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingMem, setEditingMem] = useState<any>(null);
  const [credits, setCredits] = useState(0);

  const { data: memberships } = useQuery({
    queryKey: ["client-memberships", userId],
    queryFn: async () => (await api.get(`/memberships?userId=${userId}`)).data,
    enabled: !!userId,
  });

  const updateMem = useMutation({
    mutationFn: ({ memId, classesRemaining }: { memId: string; classesRemaining: number }) =>
      api.put(`/memberships/${memId}`, { classesRemaining }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-memberships", userId] });
      toast({ title: "Créditos actualizados" });
      setEditingMem(null);
    },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const cancelMem = useMutation({
    mutationFn: (memId: string) => api.put(`/memberships/${memId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-memberships", userId] });
      toast({ title: "Membresía cancelada" });
    },
  });

  const reactivateMem = useMutation({
    mutationFn: (memId: string) => api.put(`/memberships/${memId}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-memberships", userId] });
      toast({ title: "Membresía reactivada" });
    },
    onError: () => toast({ title: "Error al reactivar", variant: "destructive" }),
  });

  const openEdit = (m: any) => {
    setCredits(m.classesRemaining ?? 0);
    setEditingMem(m);
  };

  const mems = asArray(memberships).filter((m: any) => m.status !== "cancelled");

  if (mems.length === 0)
    return <EmptyState icon={BadgeCheck}>Sin membresías activas</EmptyState>;

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border/70">
        <Table>
          <TableHeader>
            <TableRow className="bg-tep-nude/60 hover:bg-tep-nude/60">
              <TableHead className="text-valiance-mauve">Plan</TableHead>
              <TableHead className="text-valiance-mauve">Estado</TableHead>
              <TableHead className="text-valiance-mauve">Origen / compra</TableHead>
              <TableHead className="text-valiance-mauve">Vence</TableHead>
              <TableHead className="text-valiance-mauve text-center">Clases</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {mems.map((m: any) => {
              const purchased = pick(m, "createdAt", "created_at");
              const orderId = pick(m, "orderId", "order_id");
              const method = (pick(m, "paymentMethod", "payment_method") ?? "").toString().toLowerCase();
              const assignedByAdmin = !orderId;
              const isActive = m.status === "active";
              return (
                <TableRow key={m.id} className="align-top">
                  <TableCell className="font-medium text-valiance-charcoal">{m.planName ?? m.planId}</TableCell>
                  <TableCell>
                    <Badge variant={isActive ? "default" : m.status === "cancelled" ? "destructive" : "secondary"}>
                      {isActive ? "Activa" : m.status === "expired" ? "Expirada" : m.status === "cancelled" ? "Cancelada" : m.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <StatusPill
                        className={assignedByAdmin
                          ? "bg-tep-lilacSoft text-valiance-plum border-tep-lavender/40"
                          : "bg-tep-rose/60 text-valiance-plum border-tep-blush/40"}
                      >
                        {assignedByAdmin ? <BadgeCheck size={12} /> : <Smartphone size={12} />}
                        {assignedByAdmin ? "Asignada por admin" : "Comprada en app"}
                      </StatusPill>
                      <div className="text-xs text-valiance-mauve">
                        {fmtDateTime(purchased)}
                        {method && !assignedByAdmin ? ` · ${methodLabel[method] ?? method}` : ""}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-valiance-charcoal">{m.endDate ? fmtDate(m.endDate) : "—"}</TableCell>
                  <TableCell className="text-center font-semibold text-valiance-charcoal">{m.classesRemaining ?? "∞"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(m)}>Ajustar créditos</DropdownMenuItem>
                        {m.status === "cancelled" && (
                          <DropdownMenuItem
                            className="text-emerald-600"
                            onClick={() => { if (window.confirm("¿Reactivar esta membresía?")) reactivateMem.mutate(m.id); }}
                          >
                            Reactivar membresía
                          </DropdownMenuItem>
                        )}
                        {m.status === "active" && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => { if (window.confirm("¿Cancelar esta membresía? Esta acción es difícil de revertir.")) cancelMem.mutate(m.id); }}
                          >
                            Cancelar membresía
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editingMem} onOpenChange={(v) => !v && setEditingMem(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Corregir créditos</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium">{editingMem?.planName}</p>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            ⚠️ Solo usar para corregir errores. Para registrar asistencia usa la vista de clase → Asignar reserva → Check-in.
          </div>
          <div className="text-center text-xs text-muted-foreground">
            Clases disponibles (actualmente: <strong>{editingMem?.classesRemaining ?? "?"}</strong> de <strong>{editingMem?.classLimit ?? "?"}</strong>)
          </div>
          <div className="flex items-center justify-center gap-4 py-2">
            <Button variant="outline" size="icon" onClick={() => setCredits((c) => Math.max(0, c - 1))}>
              <Minus size={16} />
            </Button>
            <Input
              type="number"
              className="w-20 text-center text-lg font-bold"
              value={credits}
              onChange={(e) => setCredits(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <Button variant="outline" size="icon" onClick={() => setCredits((c) => c + 1)}>
              <Plus size={16} />
            </Button>
          </div>
          {credits !== (editingMem?.classesRemaining ?? 0) && (
            <p className="text-center text-xs text-muted-foreground">
              Cambio: {editingMem?.classesRemaining ?? "?"} → <strong className={credits < (editingMem?.classesRemaining ?? 0) ? "text-destructive" : "text-emerald-600"}>{credits}</strong>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMem(null)}>Cancelar</Button>
            <Button
              onClick={() => editingMem && updateMem.mutate({ memId: editingMem.id, classesRemaining: credits })}
              disabled={updateMem.isPending}
            >
              {updateMem.isPending ? <Loader2 className="animate-spin mr-1" size={14} /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/* ──────────────────────────────────────────────────────────────
   Client Detail page
   ────────────────────────────────────────────────────────────── */

const ClientDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<"all" | "cancelled">("all");

  const { data: user, isLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => (await api.get(`/users/${id}`)).data,
    enabled: !!id,
  });

  const { data: bookings } = useQuery({
    queryKey: ["client-bookings", id],
    queryFn: async () => (await api.get(`/bookings?userId=${id}`)).data,
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ["client-payments", id],
    queryFn: async () => (await api.get(`/payments?userId=${id}`)).data,
    enabled: !!id,
  });

  const { data: reschedules } = useQuery({
    queryKey: ["client-reschedules", id],
    queryFn: async () => (await api.get(`/admin/clients/${id}/reschedules`)).data,
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.put(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", id] });
      toast({ title: "Perfil actualizado" });
      setEditing(false);
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al guardar", variant: "destructive" }),
  });

  const u = user?.data ?? user;

  const { data: walkinMatches } = useQuery({
    queryKey: ["walkin-matches", u?.phone],
    queryFn: async () => (await api.get(`/admin/walkins/by-phone?phone=${encodeURIComponent(u?.phone ?? "")}`)).data,
    enabled: !!u?.phone,
  });
  const walkinList: any[] = asArray(walkinMatches);

  const linkWalkinsMutation = useMutation({
    mutationFn: () => api.post("/admin/walkins/link", { userId: id, phone: u?.phone }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["walkin-matches", u?.phone] });
      qc.invalidateQueries({ queryKey: ["client-payments", id] });
      qc.invalidateQueries({ queryKey: ["client-bookings", id] });
      toast({ title: res?.data?.message ?? "Compras vinculadas" });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al vincular", variant: "destructive" }),
  });

  const startEditing = () => {
    setForm({
      displayName: u?.displayName ?? "",
      phone: u?.phone ?? "",
      dateOfBirth: u?.dateOfBirth ?? "",
      emergencyContactName: u?.emergencyContactName ?? "",
      emergencyContactPhone: u?.emergencyContactPhone ?? "",
      healthNotes: u?.healthNotes ?? "",
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(form);
  };

  /* ── Derived / sorted history datasets ── */
  const bookingDate = (b: any) => pick(b, "startTime", "start_time", "classDate", "class_date") ?? pick(b, "created_at", "createdAt");

  const allBookings = asArray(bookings)
    .slice()
    .sort((a, b) => new Date(bookingDate(b) ?? 0).getTime() - new Date(bookingDate(a) ?? 0).getTime());

  const cancelledBookings = allBookings.filter((b) => (b.status ?? "").toLowerCase() === "cancelled");
  const visibleBookings = bookingFilter === "cancelled" ? cancelledBookings : allBookings;

  const reschedulesArr = asArray(reschedules)
    .slice()
    .sort((a, b) => new Date(pick(b, "created_at", "createdAt") ?? 0).getTime() - new Date(pick(a, "created_at", "createdAt") ?? 0).getTime());

  const paymentsArr = asArray(payments)
    .slice()
    .sort((a, b) => new Date(pick(b, "created_at", "createdAt") ?? 0).getTime() - new Date(pick(a, "created_at", "createdAt") ?? 0).getTime());

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          {/* ── Header ── */}
          {isLoading ? (
            <div className="mb-6 flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-52" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-border bg-gradient-to-br from-card to-tep-nude/70 p-6 shadow-valiance-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-tep-rose font-display text-2xl text-valiance-plum shadow-valiance-soft ring-1 ring-tep-blush/40">
                  {initials(u?.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-3xl leading-tight text-valiance-charcoal">{u?.displayName ?? "Alumna"}</h1>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-valiance-mauve">
                    {u?.email && (
                      <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-valiance-blush" />{u.email}</span>
                    )}
                    {u?.phone && (
                      <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-valiance-blush" />{u.phone}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {walkinList.length > 0 && (
            <div className="mb-4 rounded-xl border border-tep-gold/40 bg-tep-gold/10 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-valiance-charcoal">
                  {walkinList.length} compra(s) previa(s) como invitada con este teléfono
                </p>
                <p className="text-xs text-valiance-mauve">
                  Total: ${walkinList.reduce((s, w) => s + parseFloat(w.totalAmount ?? w.total_amount ?? 0), 0).toFixed(2)}
                </p>
              </div>
              <Button size="sm" onClick={() => linkWalkinsMutation.mutate()} disabled={linkWalkinsMutation.isPending}>
                {linkWalkinsMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Vincular a esta cuenta
              </Button>
            </div>
          )}

          <Tabs defaultValue="profile">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-tep-nude p-1">
              <TabsTrigger value="profile">Perfil</TabsTrigger>
              <TabsTrigger value="memberships">Membresías</TabsTrigger>
              <TabsTrigger value="bookings">Reservas</TabsTrigger>
              <TabsTrigger value="reschedules">Reagendas</TabsTrigger>
              <TabsTrigger value="payments">Pagos</TabsTrigger>
            </TabsList>

            {/* ── Perfil ── */}
            <TabsContent value="profile" className="mt-4">
              <SectionCard
                title="Perfil de la alumna"
                action={!editing && !isLoading ? (
                  <Button size="sm" variant="outline" onClick={startEditing}>
                    <Pencil size={14} className="mr-1" /> Editar
                  </Button>
                ) : undefined}
              >
                {isLoading ? <Skeleton className="h-40 w-full" /> : editing ? (
                  <div className="space-y-4 max-w-lg">
                    <div className="space-y-1">
                      <Label>Nombre</Label>
                      <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Teléfono</Label>
                      <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Fecha de nacimiento</Label>
                      <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Contacto de emergencia</Label>
                        <Input placeholder="Nombre" value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label>Tel. emergencia</Label>
                        <Input placeholder="Teléfono" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Notas de salud</Label>
                      <Textarea rows={3} value={form.healthNotes} onChange={(e) => setForm({ ...form, healthNotes: e.target.value })} />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                        <Save size={14} className="mr-1" /> Guardar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                        <X size={14} className="mr-1" /> Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    {[
                      { icon: User2, label: "Nombre", value: u?.displayName ?? "—" },
                      { icon: Mail, label: "Email", value: u?.email ?? "—" },
                      { icon: Phone, label: "Teléfono", value: u?.phone ?? "—" },
                      { icon: Cake, label: "Fecha de nacimiento", value: u?.dateOfBirth ? fmtDate(u.dateOfBirth) : "—" },
                      {
                        icon: ShieldAlert,
                        label: "Contacto de emergencia",
                        value: [u?.emergencyContactName, u?.emergencyContactPhone].filter(Boolean).join(" · ") || "—",
                      },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tep-nude text-valiance-blush">
                          <Icon size={15} />
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-valiance-mauve">{label}</dt>
                          <dd className="text-sm text-valiance-charcoal break-words">{value}</dd>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-start gap-3 sm:col-span-2">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tep-nude text-valiance-blush">
                        <HeartPulse size={15} />
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs uppercase tracking-wide text-valiance-mauve">Notas de salud</dt>
                        <dd className="text-sm text-valiance-charcoal">{u?.healthNotes ?? "—"}</dd>
                      </div>
                    </div>
                  </dl>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── Membresías ── */}
            <TabsContent value="memberships" className="mt-4">
              <SectionCard title="Membresías">
                <MembershipsTab userId={id!} />
              </SectionCard>
            </TabsContent>

            {/* ── Reservas (con filtro de canceladas) ── */}
            <TabsContent value="bookings" className="mt-4">
              <SectionCard
                title="Historial de reservas"
                action={
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-border bg-tep-nude p-0.5">
                      {(["all", "cancelled"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setBookingFilter(f)}
                          className={cn(
                            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                            bookingFilter === f
                              ? "bg-card text-valiance-charcoal shadow-sm"
                              : "text-valiance-mauve hover:text-valiance-charcoal",
                          )}
                        >
                          {f === "all" ? "Todas" : `Cancelaciones${cancelledBookings.length ? ` (${cancelledBookings.length})` : ""}`}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={!id}>
                      <CalendarDays size={14} className="mr-1" />
                      Agendar mes
                    </Button>
                  </div>
                }
              >
                {visibleBookings.length === 0 ? (
                  <EmptyState icon={CalendarDays}>
                    {bookingFilter === "cancelled" ? "Sin cancelaciones registradas" : "Sin reservas registradas"}
                  </EmptyState>
                ) : (
                  <ul className="space-y-2.5">
                    {visibleBookings.map((b: any) => {
                      const st = bookingStatus(b.status);
                      const className = pick(b, "className", "class_name") ?? b.classId ?? "Clase";
                      const when = bookingDate(b);
                      const bookedAt = pick(b, "created_at", "createdAt");
                      const cancelledAt = pick(b, "cancelled_at", "cancelledAt");
                      const cancelledBy = pick(b, "cancelled_by", "cancelledBy");
                      const isCancelled = (b.status ?? "").toLowerCase() === "cancelled";
                      return (
                        <li
                          key={b.id}
                          className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-4 py-3 transition-colors hover:border-tep-blush/50 hover:bg-tep-nude/40 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-valiance-charcoal">{className}</p>
                            <p className="mt-0.5 text-xs text-valiance-mauve">
                              {fmtDateTime(when)}
                              {bookedAt ? <span className="text-valiance-mauve/70"> · Reservada {fmtDateTime(bookedAt)}</span> : null}
                            </p>
                            {isCancelled && (
                              <p className="mt-0.5 text-xs text-rose-600">
                                Cancelada {fmtDateTime(cancelledAt)} · {cancelAuthor(cancelledBy)}
                              </p>
                            )}
                          </div>
                          <StatusPill className={cn("shrink-0", st.cls)}>{st.label}</StatusPill>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
              {id && (
                <BulkMonthBookingDialog
                  open={bulkOpen}
                  onOpenChange={setBulkOpen}
                  userId={id}
                  userName={u?.displayName}
                />
              )}
            </TabsContent>

            {/* ── Reagendas ── */}
            <TabsContent value="reschedules" className="mt-4">
              <SectionCard title="Historial de reagendas">
                {reschedulesArr.length === 0 ? (
                  <EmptyState icon={CalendarClock}>Sin reagendas registradas</EmptyState>
                ) : (
                  <ul className="space-y-2.5">
                    {reschedulesArr.map((r: any) => {
                      const when = pick(r, "created_at", "createdAt");
                      const fromClass = pick(r, "from_class", "fromClass") ?? "Clase";
                      const toClass = pick(r, "to_class", "toClass") ?? "Clase";
                      const fromDate = pick(r, "from_date", "fromDate");
                      const fromTime = pick(r, "from_time", "fromTime");
                      const toDate = pick(r, "to_date", "toDate");
                      const toTime = pick(r, "to_time", "toTime");
                      return (
                        <li key={r.id} className="rounded-xl border border-border/70 bg-card px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="flex-1 rounded-lg bg-rose-50/70 px-3 py-2">
                              <p className="text-xs uppercase tracking-wide text-rose-500">De</p>
                              <p className="text-sm font-medium text-valiance-charcoal">{fromClass}</p>
                              <p className="text-xs text-valiance-mauve">{fmtDate(fromDate)} · {fromTime ?? "—"}</p>
                            </div>
                            <ArrowRight size={18} className="mx-auto shrink-0 rotate-90 text-valiance-blush sm:rotate-0" />
                            <div className="flex-1 rounded-lg bg-emerald-50/70 px-3 py-2">
                              <p className="text-xs uppercase tracking-wide text-emerald-600">A</p>
                              <p className="text-sm font-medium text-valiance-charcoal">{toClass}</p>
                              <p className="text-xs text-valiance-mauve">{fmtDate(toDate)} · {toTime ?? "—"}</p>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-valiance-mauve">Reagendada {fmtDateTime(when)}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── Pagos ── */}
            <TabsContent value="payments" className="mt-4">
              <SectionCard title="Historial de pagos">
                {paymentsArr.length === 0 ? (
                  <EmptyState icon={CreditCard}>Sin pagos registrados</EmptyState>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-tep-nude/60 hover:bg-tep-nude/60">
                          <TableHead className="text-valiance-mauve">Origen / método</TableHead>
                          <TableHead className="text-valiance-mauve text-right">Monto</TableHead>
                          <TableHead className="text-valiance-mauve">Estado</TableHead>
                          <TableHead className="text-valiance-mauve">Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentsArr.map((p: any) => {
                          const origin = paymentOrigin(p);
                          const OriginIcon = origin.icon;
                          const st = paymentStatus(p.status);
                          const amount = parseFloat(pick(p, "total_amount", "totalAmount", "amount") ?? 0);
                          const date = pick(p, "created_at", "createdAt");
                          return (
                            <TableRow key={p.id}>
                              <TableCell>
                                <StatusPill className={origin.cls}>
                                  <OriginIcon size={12} />
                                  {origin.label}
                                </StatusPill>
                              </TableCell>
                              <TableCell className="text-right font-semibold text-valiance-charcoal">${amount.toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </TableCell>
                              <TableCell className="text-valiance-mauve">{fmtDateTime(date)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SectionCard>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default ClientDetail;
