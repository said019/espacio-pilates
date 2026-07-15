import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus, Search, X, Coins, CalendarClock } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { useDebounce } from "@/hooks/use-debounce";

const STATUS_OPTIONS = ["active", "pending_payment", "pending_activation", "expired", "cancelled"] as const;
type MembershipStatus = (typeof STATUS_OPTIONS)[number];

const STATUS_LABELS: Record<MembershipStatus, string> = {
  active: "Activa",
  pending_payment: "Pendiente pago",
  pending_activation: "Pendiente activación",
  expired: "Expirada",
  cancelled: "Cancelada",
};

const STATUS_VARIANTS: Record<MembershipStatus, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  pending_payment: "outline",
  pending_activation: "outline",
  expired: "secondary",
  cancelled: "destructive",
};

interface BundleComponent {
  planId: string;
  label?: string;
}

interface Membership {
  id: string;
  userId: string;
  userName?: string;
  planId: string;
  planName?: string;
  classCategory?: string;
  status: MembershipStatus;
  paymentMethod?: string;
  startDate?: string;
  endDate?: string;
  classesRemaining?: number | null;
  classLimit?: number | null;
  bundleParentId?: string | null;
  hasBundleComponents?: boolean;
  bundleComponents?: BundleComponent[] | null;
  disciplineCredits?: Record<string, number> | null;
  notes?: string | null;
}

// Parses a bundle label like "8 Reformer" → { count: 8, discipline: "reformer" }.
function parseBundleLabel(label?: string): { count: number; discipline: string } | null {
  if (!label) return null;
  const m = String(label).match(/(\d+)\s*(reformer|barre|pilates)/i);
  if (!m) return null;
  const disc = m[2].toLowerCase() === "pilates" ? "reformer" : m[2].toLowerCase();
  return { count: parseInt(m[1], 10), discipline: disc };
}

// Extracts the bundle name from notes like "Bundle: Combo 1 — 4 Reformer + 4 Barre — 4 Reformer"
function bundleLabel(notes?: string | null): string | null {
  if (!notes) return null;
  const m = String(notes).match(/^Bundle:\s*([^—]+?)(?:\s*—|$)/i);
  return m ? m[1].trim() : null;
}

// Format a YYYY-MM-DD string (or any date string we can slice) without going
// through new Date(), which would interpret "2026-06-06" as UTC midnight and
// shift to the previous day when rendered in CDMX (UTC-6).
const ES_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtMembershipDate(raw?: string | null): string {
  if (!raw) return "—";
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const [, y, mo, d] = m;
  return `${parseInt(d, 10).toString().padStart(2, "0")} ${ES_MONTHS[parseInt(mo, 10) - 1]} ${y}`;
}

interface ClientOption {
  id: string;
  displayName: string;
  email?: string;
  phone?: string | null;
}

const membershipSchema = z.object({
  userId: z.string().min(1),
  planId: z.string().min(1),
  paymentMethod: z.enum(["efectivo", "tarjeta", "transferencia"]).optional(),
  startDate: z.string().min(1),
});

type MembershipFormData = z.infer<typeof membershipSchema>;

const MembershipTable = ({ status, title }: { status?: string; title: string }) => {
  const { toast } = useToast();
  const qc = useQueryClient();

  const url = status ? `/memberships?status=${status}` : "/memberships";
  const { data, isLoading } = useQuery<{ data: Membership[] }>({
    queryKey: ["memberships", status],
    queryFn: async () => (await api.get(url)).data,
  });
  const memberships = Array.isArray(data?.data) ? data.data : [];

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.put(`/memberships/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["memberships"] }); toast({ title: "Membresía activada" }); },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.put(`/memberships/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["memberships"] }); toast({ title: "Membresía cancelada" }); },
  });

  // Credits adjustment dialog state
  const [creditsTarget, setCreditsTarget] = useState<Membership | null>(null);
  const [creditsMode, setCreditsMode] = useState<"set" | "add" | "subtract">("set");
  const [creditsValue, setCreditsValue] = useState<string>("");
  const [creditsReason, setCreditsReason] = useState<string>("");
  // Combo split state — one input per discipline (reformer / barre / etc.).
  const [splitCredits, setSplitCredits] = useState<Record<string, string>>({});

  const adjustCreditsMutation = useMutation({
    mutationFn: (body: any) =>
      api.put(`/memberships/${creditsTarget?.id ?? ""}/credits`, body),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["memberships"] });
      const data = res?.data?.data ?? res?.data;
      const desc = data?.disciplineCredits
        ? Object.entries(data.disciplineCredits).map(([k, v]) => `${k}: ${v}`).join(" · ")
        : `${data?.before ?? "—"} → ${data?.after ?? "—"} clases`;
      toast({
        title: "Créditos ajustados",
        description: desc,
      });
      setCreditsTarget(null);
      setCreditsValue("");
      setCreditsReason("");
      setCreditsMode("set");
      setSplitCredits({});
    },
    onError: (err: any) => {
      toast({
        title: "Error al ajustar créditos",
        description: err?.response?.data?.message || err?.response?.data?.detail || err?.message,
        variant: "destructive",
      });
    },
  });

  const isSplitMembership = (m: Membership): boolean => {
    if (!m.hasBundleComponents) return false;
    const comps = Array.isArray(m.bundleComponents) ? m.bundleComponents : [];
    if (comps.length < 2) return false;
    return comps.some((c) => parseBundleLabel(c.label));
  };

  const openCredits = (m: Membership) => {
    setCreditsTarget(m);
    setCreditsMode("set");
    setCreditsValue(String(m.classesRemaining ?? ""));
    setCreditsReason("");
    // Pre-fill the per-discipline inputs from disciplineCredits or fallback
    // to an even split based on the bundle component labels.
    if (isSplitMembership(m)) {
      const next: Record<string, string> = {};
      const comps = m.bundleComponents ?? [];
      const stored = m.disciplineCredits ?? null;
      for (const c of comps) {
        const parsed = parseBundleLabel(c.label);
        if (!parsed) continue;
        const fromStored = stored && stored[parsed.discipline];
        next[parsed.discipline] = String(fromStored ?? parsed.count);
      }
      setSplitCredits(next);
    } else {
      setSplitCredits({});
    }
  };

  // ── Vigencia adjustment dialog state ──
  const [vigTarget, setVigTarget] = useState<Membership | null>(null);
  const [vigDate, setVigDate] = useState<string>("");
  const [vigReason, setVigReason] = useState<string>("");

  const extendMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.put(`/memberships/${id}/extend`, body),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["memberships"] });
      const data = res?.data ?? {};
      toast({
        title: "Vigencia actualizada",
        description: `${data.before ?? "—"} → ${data.after ?? "—"}`,
      });
      setVigTarget(null);
      setVigDate("");
      setVigReason("");
    },
    onError: (err: any) => {
      toast({
        title: "Error al ajustar vigencia",
        description: err?.response?.data?.message || err?.response?.data?.detail || err?.message,
        variant: "destructive",
      });
    },
  });

  const openVigencia = (m: Membership) => {
    setVigTarget(m);
    setVigDate(m.endDate ? String(m.endDate).slice(0, 10) : "");
    setVigReason("");
  };

  const quickExtend = (days: number) => {
    if (!vigTarget) return;
    extendMutation.mutate({
      id: vigTarget.id,
      body: { mode: "add", days, reason: vigReason.trim() || undefined },
    });
  };

  const renewVigencia = () => {
    if (!vigTarget) return;
    extendMutation.mutate({
      id: vigTarget.id,
      body: { mode: "renew", reason: vigReason.trim() || undefined },
    });
  };

  const submitVigencia = () => {
    if (!vigTarget || !vigDate) {
      toast({ title: "Selecciona una fecha", variant: "destructive" });
      return;
    }
    extendMutation.mutate({
      id: vigTarget.id,
      body: { mode: "set", endDate: vigDate, reason: vigReason.trim() || undefined },
    });
  };


  const submitCredits = () => {
    if (!creditsTarget) return;
    // Combo split: send disciplineCredits map; server fija el desglose y la suma.
    if (isSplitMembership(creditsTarget)) {
      const map: Record<string, number> = {};
      for (const [k, raw] of Object.entries(splitCredits)) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          toast({ title: "Cantidad inválida", description: `Revisa el valor de ${k}.`, variant: "destructive" });
          return;
        }
        map[k] = Math.floor(n);
      }
      adjustCreditsMutation.mutate({
        disciplineCredits: map,
        reason: creditsReason.trim(),
      });
      return;
    }
    // Modo simple
    const v = Number(creditsValue);
    if (!Number.isFinite(v) || v < 0) {
      toast({ title: "Cantidad inválida", description: "Debe ser un número ≥ 0", variant: "destructive" });
      return;
    }
    adjustCreditsMutation.mutate({
      mode: creditsMode,
      value: v,
      reason: creditsReason.trim(),
    });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Clases</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array(4).fill(0).map((_, i) => (
                <TableRow key={i}>{Array(6).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
              : memberships.map((m) => {
                const catColors: Record<string, string> = {
                  pilates: "bg-[#D9B5BA]/15 text-[#D9B5BA] border-[#D9B5BA]/30",
                  bienestar: "bg-[#8C6B6F]/15 text-[#8C6B6F] border-[#8C6B6F]/30",
                  all: "bg-[#FDF7F8]/15 text-[#FDF7F8] border-[#FDF7F8]/30",
                };
                const cat = m.classCategory ?? "";
                const combo = bundleLabel(m.notes) || (m.bundleParentId ? "Combo" : null);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.userName ?? m.userId}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{m.planName ?? m.planId}</span>
                        {cat && cat !== "all" && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border capitalize ${catColors[cat] ?? "text-[#1A1A1A]/40 border-[#8C6B6F]/15"}`}>
                            {cat}
                          </span>
                        )}
                        {combo && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-[#E5CF9F] bg-[#F4EAD6] text-[#B5832F]">
                            Bundle · {combo}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[m.status]}>{STATUS_LABELS[m.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtMembershipDate(m.endDate)}</TableCell>
                    <TableCell>
                      {m.classesRemaining === null || m.classesRemaining === undefined
                        ? (m.classLimit === null ? "∞" : "—")
                        : m.classesRemaining === 9999
                          ? "∞"
                          : `${m.classesRemaining}${m.classLimit ? ` / ${m.classLimit}` : ""}`
                      }
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal size={14} /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {m.status !== "active" && (
                            <DropdownMenuItem onClick={() => activateMutation.mutate(m.id)}>Activar</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openCredits(m)}>
                            <Coins size={14} className="mr-2" />
                            Ajustar créditos
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openVigencia(m)}>
                            <CalendarClock size={14} className="mr-2" />
                            Ajustar vigencia
                          </DropdownMenuItem>
                          {m.status !== "cancelled" && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (window.confirm(`¿Cancelar la membresía de ${m.userName ?? "esta alumna"}? Esta acción no se puede deshacer fácilmente.`)) {
                                  cancelMutation.mutate(m.id);
                                }
                              }}
                            >
                              Cancelar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            }
          </TableBody>
        </Table>
      </div>

      {/* Ajustar créditos dialog */}
      <Dialog open={!!creditsTarget} onOpenChange={(o) => { if (!o) setCreditsTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar créditos</DialogTitle>
          </DialogHeader>
          {creditsTarget && (() => {
            const isSplit = isSplitMembership(creditsTarget);
            const splitTotal = Object.values(splitCredits).reduce((s, raw) => s + (Number(raw) || 0), 0);
            return (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#FBF0F2]/40 border border-[#FAE5E7] p-3 text-sm">
                  <p className="font-medium">{creditsTarget.userName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {creditsTarget.planName ?? "Plan"} · Total actual:{" "}
                    <strong>{creditsTarget.classesRemaining ?? "—"}</strong> clases
                  </p>
                </div>

                {isSplit ? (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs">Desglose por disciplina</Label>
                      {(creditsTarget.bundleComponents ?? []).map((comp) => {
                        const parsed = parseBundleLabel(comp.label);
                        if (!parsed) return null;
                        const k = parsed.discipline;
                        const cap = parsed.count;
                        const cap_label = comp.label || `${cap} ${k}`;
                        return (
                          <div key={k} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="capitalize text-[#1A1A1A]/70">{k}</span>
                              <span className="text-muted-foreground">Tope del paquete: {cap_label}</span>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              max={String(cap)}
                              value={splitCredits[k] ?? ""}
                              onChange={(e) => setSplitCredits({ ...splitCredits, [k]: e.target.value })}
                              placeholder="0"
                            />
                          </div>
                        );
                      })}
                      <div className="rounded-md bg-[#8C6B6F]/[0.06] border border-[#8C6B6F]/15 px-3 py-1.5 text-xs flex items-center justify-between">
                        <span className="text-muted-foreground">Total nuevo</span>
                        <strong>{splitTotal} clases</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Acción</Label>
                      <Select value={creditsMode} onValueChange={(v) => setCreditsMode(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="set">Fijar a valor exacto</SelectItem>
                          <SelectItem value="add">Sumar clases</SelectItem>
                          <SelectItem value="subtract">Restar clases</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {creditsMode === "set" ? "Cantidad final" : creditsMode === "add" ? "Clases a sumar" : "Clases a restar"}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        value={creditsValue}
                        onChange={(e) => setCreditsValue(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Motivo (opcional)</Label>
                  <Input
                    value={creditsReason}
                    onChange={(e) => setCreditsReason(e.target.value)}
                    placeholder="ej: Compensación por clase cancelada"
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditsTarget(null)}>Cancelar</Button>
            <Button onClick={submitCredits} disabled={adjustCreditsMutation.isPending}>
              {adjustCreditsMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ajustar vigencia dialog */}
      <Dialog open={!!vigTarget} onOpenChange={(o) => { if (!o) setVigTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar vigencia</DialogTitle>
          </DialogHeader>
          {vigTarget && (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#FBF0F2]/40 border border-[#FAE5E7] p-3 text-sm">
                <p className="font-medium">{vigTarget.userName ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {vigTarget.planName ?? "Plan"} · Vence:{" "}
                  <strong>{fmtMembershipDate(vigTarget.endDate)}</strong>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Atajos rápidos</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => quickExtend(7)}
                    disabled={extendMutation.isPending}
                  >
                    +7 días
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => quickExtend(15)}
                    disabled={extendMutation.isPending}
                  >
                    +15 días
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => quickExtend(30)}
                    disabled={extendMutation.isPending}
                  >
                    +30 días
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full mt-1.5"
                  onClick={renewVigencia}
                  disabled={extendMutation.isPending}
                >
                  Renovar (vigencia del plan desde hoy)
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">O elige fecha exacta</Label>
                <DatePicker value={vigDate} onChange={setVigDate} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Motivo (opcional)</Label>
                <Input
                  value={vigReason}
                  onChange={(e) => setVigReason(e.target.value)}
                  placeholder="ej: Compensación por viaje del estudio"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVigTarget(null)}>Cancelar</Button>
            <Button onClick={submitVigencia} disabled={extendMutation.isPending || !vigDate}>
              {extendMutation.isPending ? "Guardando…" : "Fijar fecha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MembershipsList = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<ClientOption | null>(null);
  const debouncedUserSearch = useDebounce(userSearch, 250);

  const form = useForm<MembershipFormData>({
    resolver: zodResolver(membershipSchema),
    defaultValues: { userId: "", startDate: new Date().toISOString().split("T")[0] },
  });

  const createMutation = useMutation({
    mutationFn: (d: MembershipFormData) => api.post("/memberships", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memberships"] });
      toast({ title: "Membresía asignada" });
      setOpen(false);
      setSelectedUser(null);
      setUserSearch("");
      form.reset({ userId: "", startDate: new Date().toISOString().split("T")[0] });
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      toast({
        title: "No se pudo asignar la membresía",
        description: data?.message || data?.error || err?.message || "Error inesperado.",
        variant: "destructive",
      });
    },
  });

  const { data: usersData, isFetching: searchingUsers } = useQuery<{ data: ClientOption[] }>({
    queryKey: ["membership-users-search", debouncedUserSearch],
    enabled: open,
    queryFn: async () => (
      await api.get(`/users?role=client${debouncedUserSearch ? `&search=${encodeURIComponent(debouncedUserSearch)}` : ""}`)
    ).data,
  });
  const userOptions = Array.isArray(usersData?.data) ? usersData.data : [];

  const { data: plansData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans")).data,
  });

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-6xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <h1 className="text-2xl font-bold">Membresías</h1>
            <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} className="mr-1" />Asignar</Button>
          </div>

          <Tabs defaultValue="all">
            <TabsList className="mb-6">
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="active">Activas</TabsTrigger>
              <TabsTrigger value="expiring">Por vencer</TabsTrigger>
              <TabsTrigger value="pending">Pendientes</TabsTrigger>
            </TabsList>
            <TabsContent value="all"><MembershipTable title="Todas las membresías" /></TabsContent>
            <TabsContent value="active"><MembershipTable status="active" title="Membresías activas" /></TabsContent>
            <TabsContent value="expiring"><MembershipTable status="expiring" title="Por vencer (7 días)" /></TabsContent>
            <TabsContent value="pending"><MembershipTable status="pending_payment" title="Pendientes de pago" /></TabsContent>
          </Tabs>
        </div>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setSelectedUser(null);
              setUserSearch("");
              form.reset({ userId: "", startDate: new Date().toISOString().split("T")[0] });
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Asignar membresía</DialogTitle></DialogHeader>
            <form
              onSubmit={form.handleSubmit(
                (d) => createMutation.mutate(d),
                (errors) => {
                  const missing: string[] = [];
                  if (errors.userId) missing.push("cliente");
                  if (errors.planId) missing.push("plan");
                  if (errors.startDate) missing.push("fecha de inicio");
                  toast({
                    title: "Faltan datos",
                    description: missing.length
                      ? `Selecciona ${missing.join(", ")}.`
                      : "Revisa los campos del formulario.",
                    variant: "destructive",
                  });
                }
              )}
              className="space-y-4"
            >
              <div className="space-y-1">
                <Label>Cliente</Label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="pl-8"
                    placeholder="Buscar por nombre, email o teléfono"
                  />
                </div>
                {selectedUser && (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{selectedUser.displayName}</p>
                      <p className="text-xs text-muted-foreground">{selectedUser.email ?? "—"}{selectedUser.phone ? ` · ${selectedUser.phone}` : ""}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedUser(null);
                        form.setValue("userId", "", { shouldValidate: true });
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                {!selectedUser && (
                  <div className="max-h-40 overflow-auto rounded-md border border-border">
                    {searchingUsers ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>
                    ) : userOptions.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
                    ) : (
                      userOptions.map((u) => (
                        <button
                          type="button"
                          key={u.id}
                          className="w-full px-3 py-2 text-left hover:bg-[#8C6B6F]/[0.06] border-b last:border-b-0 border-border"
                          onClick={() => {
                            setSelectedUser(u);
                            form.setValue("userId", u.id, { shouldValidate: true });
                            setUserSearch(u.displayName ?? "");
                          }}
                        >
                          <p className="text-sm font-medium">{u.displayName}</p>
                          <p className="text-xs text-muted-foreground">{u.email ?? "—"}{u.phone ? ` · ${u.phone}` : ""}</p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label>Plan *</Label>
                <Select
                  value={form.watch("planId") ?? ""}
                  onValueChange={(v) => form.setValue("planId", v, { shouldValidate: true })}
                >
                  <SelectTrigger className={form.formState.errors.planId ? "border-destructive" : ""}>
                    <SelectValue placeholder="Seleccionar plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(plansData?.data) ? plansData.data : []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.planId && (
                  <p className="text-[10px] text-destructive">Selecciona un plan.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Método de pago</Label>
                <Select
                  value={form.watch("paymentMethod") ?? ""}
                  onValueChange={(v) => form.setValue("paymentMethod", v as "efectivo", { shouldValidate: true })}
                >
                  <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Fecha de inicio</Label>
                <DatePicker value={form.watch("startDate")} onChange={(v) => form.setValue("startDate", v)} />
              </div>
              {/* ── Price summary ── */}
              {(() => {
                const selPlanId = form.watch("planId");
                const selPM = form.watch("paymentMethod");
                const allPlans = Array.isArray(plansData?.data) ? plansData.data : [];
                const selPlan = allPlans.find((p: any) => p.id === selPlanId) as any;
                if (!selPlan) return null;
                const basePrice = parseFloat(selPlan?.price ?? 0);
                const isDiscount = selPM === "efectivo" || selPM === "transferencia";
                const total = basePrice;
                let discountTotal: number | null = null;
                if (isDiscount) {
                  const dp = selPlan?.discountPrice ?? selPlan?.discount_price;
                  if (dp != null && dp !== "" && Number(dp) > 0) {
                    discountTotal = Number(dp);
                  }
                }
                const finalPrice = discountTotal ?? total;
                return (
                  <div className="rounded-xl border border-[#8C6B6F]/20 bg-[#FAE5E7]/60 p-3 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#1A1A1A]/60">{selPlan?.name}</span>
                      {discountTotal ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#8C6B6F] line-through">${total.toLocaleString("es-MX")}</span>
                          <span className="font-bold text-[#1A1A1A]">${discountTotal.toLocaleString("es-MX")}</span>
                        </div>
                      ) : (
                        <span className="font-bold text-[#1A1A1A]">${total.toLocaleString("es-MX")}</span>
                      )}
                    </div>
                    {isDiscount && (
                      <p className="text-[10px] text-[#D9B5BA] font-medium">Precio con descuento (efectivo/transferencia)</p>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-[#8C6B6F]/10">
                      <span className="text-sm font-semibold text-[#1A1A1A]">Total a cobrar</span>
                      <span className="text-lg font-bold text-[#1A1A1A]">${finalPrice.toLocaleString("es-MX")} MXN</span>
                    </div>
                  </div>
                );
              })()}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending}>Asignar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </AuthGuard>
  );
};

export default MembershipsList;
