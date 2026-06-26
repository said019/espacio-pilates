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
import { Pencil, Save, X, Minus, Plus, MoreHorizontal, Loader2, CalendarDays } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BulkMonthBookingDialog } from "@/components/admin/BulkMonthBookingDialog";

const methodLabel: Record<string, string> = {
  cash: "Efectivo",
  efectivo: "Efectivo",
  transfer: "Transferencia",
  transferencia: "Transferencia",
  card: "Tarjeta",
  tarjeta: "Tarjeta",
};

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

  const mems = (Array.isArray(memberships?.data) ? memberships.data : []).filter((m: any) => m.status !== "cancelled");

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Vence</TableHead>
            <TableHead>Clases</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {mems.map((m: any) => (
            <TableRow key={m.id}>
              <TableCell>{m.planName ?? m.planId}</TableCell>
              <TableCell>
                <Badge variant={m.status === "active" ? "default" : m.status === "cancelled" ? "destructive" : "secondary"}>
                  {m.status === "active" ? "Activa" : m.status === "expired" ? "Expirada" : m.status === "cancelled" ? "Cancelada" : m.status}
                </Badge>
              </TableCell>
              <TableCell>{m.endDate ? new Date(m.endDate).toLocaleDateString("es-MX") : "—"}</TableCell>
              <TableCell>{m.classesRemaining ?? "∞"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
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
          ))}
        </TableBody>
      </Table>

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

const ClientDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [bulkOpen, setBulkOpen] = useState(false);

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

  const { data: memberships } = useQuery({
    queryKey: ["client-memberships", id],
    queryFn: async () => (await api.get(`/memberships?userId=${id}`)).data,
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ["client-payments", id],
    queryFn: async () => (await api.get(`/payments?userId=${id}`)).data,
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
  const walkinList: any[] = Array.isArray(walkinMatches?.data) ? walkinMatches.data : [];

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

  const paymentsArr = Array.isArray(payments?.data) ? payments.data : [];

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-5xl">
          {isLoading ? (
            <Skeleton className="h-10 w-60 mb-4" />
          ) : (
            <div className="mb-6">
              <h1 className="text-2xl font-bold">{u?.displayName}</h1>
              <p className="text-muted-foreground text-sm">{u?.email} · {u?.phone}</p>
            </div>
          )}

          {walkinList.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {walkinList.length} compra(s) previa(s) como invitada con este teléfono
                </p>
                <p className="text-xs text-amber-800">
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
            <TabsList>
              <TabsTrigger value="profile">Perfil</TabsTrigger>
              <TabsTrigger value="memberships">Membresías</TabsTrigger>
              <TabsTrigger value="bookings">Reservas</TabsTrigger>
              <TabsTrigger value="payments">Pagos</TabsTrigger>
            </TabsList>

            {/* ── Perfil ── */}
            <TabsContent value="profile" className="mt-4">
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
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div><span className="font-medium">Nombre:</span> {u?.displayName ?? "—"}</div>
                    <div><span className="font-medium">Email:</span> {u?.email ?? "—"}</div>
                    <div><span className="font-medium">Teléfono:</span> {u?.phone ?? "—"}</div>
                    <div><span className="font-medium">Fecha de nacimiento:</span> {u?.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString("es-MX") : "—"}</div>
                    <div><span className="font-medium">Contacto de emergencia:</span> {u?.emergencyContactName ?? "—"} {u?.emergencyContactPhone ?? ""}</div>
                    <div className="col-span-2"><span className="font-medium">Notas de salud:</span> {u?.healthNotes ?? "—"}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={startEditing}>
                    <Pencil size={14} className="mr-1" /> Editar perfil
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Membresías ── */}
            <TabsContent value="memberships" className="mt-4">
              <MembershipsTab userId={id!} />
            </TabsContent>

            {/* ── Reservas ── */}
            <TabsContent value="bookings" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={!id}>
                  <CalendarDays size={14} className="mr-1" />
                  Agendar mes completo
                </Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Clase</TableHead><TableHead>Fecha</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(Array.isArray(bookings?.data) ? bookings.data : []).map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.className ?? b.classId}</TableCell>
                      <TableCell>{b.startTime ? new Date(b.startTime).toLocaleString("es-MX", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{b.status === "confirmed" ? "Confirmada" : b.status === "cancelled" ? "Cancelada" : b.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {id && (
                <BulkMonthBookingDialog
                  open={bulkOpen}
                  onOpenChange={setBulkOpen}
                  userId={id}
                  userName={u?.displayName}
                />
              )}
            </TabsContent>

            {/* ── Pagos ── */}
            <TabsContent value="payments" className="mt-4">
              {paymentsArr.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Sin pagos registrados</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Monto</TableHead><TableHead>Método</TableHead><TableHead>Estado</TableHead><TableHead>Fecha</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {paymentsArr.map((p: any) => {
                      const date = p.createdAt || p.created_at;
                      const method = p.method || p.payment_method || "";
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.planName ?? p.plan_name ?? "—"}</TableCell>
                          <TableCell>${parseFloat(p.total_amount ?? p.totalAmount ?? p.amount ?? 0).toFixed(2)}</TableCell>
                          <TableCell>{methodLabel[method.toLowerCase()] ?? method}</TableCell>
                          <TableCell><Badge variant={p.status === "active" || p.status === "approved" ? "default" : "secondary"}>{p.status === "active" ? "Activa" : p.status === "approved" ? "Aprobada" : p.status === "cancelled" ? "Cancelada" : p.status}</Badge></TableCell>
                          <TableCell>{date ? new Date(date).toLocaleDateString("es-MX") : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default ClientDetail;
