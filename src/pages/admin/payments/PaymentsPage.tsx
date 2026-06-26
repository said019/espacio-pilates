import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, User, Package, CheckCircle2, CreditCard, Banknote, ArrowRight, ChevronLeft, History, Sparkles, Clock, XCircle, Eye, Download } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────
const PAYMENT_METHODS = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "card", label: "Tarjeta", icon: CreditCard },
  { value: "transfer", label: "Transferencia", icon: ArrowRight },
];

const STEP_META = [
  { label: "Buscar cliente", icon: User },
  { label: "Elegir plan", icon: Package },
  { label: "Confirmar", icon: CheckCircle2 },
];

// ── Category groups for plan display ──────────────────────
function groupPlans(plans: any[]) {
  const groups: Record<string, any[]> = { pilates: [], bienestar: [], otro: [] };
  for (const p of plans) {
    const cat = p.classCategory ?? p.class_category ?? "";
    if (cat === "pilates") groups.pilates.push(p);
    else if (cat === "bienestar") groups.bienestar.push(p);
    else if (cat === "all") groups.otro.push(p);
    else if (p.name?.toLowerCase().includes("pilates") || p.name?.toLowerCase().includes("mat") || p.name?.toLowerCase().includes("flow")) groups.pilates.push(p);
    else if (p.name?.toLowerCase().includes("body") || p.name?.toLowerCase().includes("strong") || p.name?.toLowerCase().includes("flex")) groups.bienestar.push(p);
    else groups.otro.push(p);
  }
  return groups;
}

// ── Step indicator ────────────────────────────────────────
const StepBar = ({ step }: { step: number }) => (
  <div className="flex items-center gap-0 mb-8">
    {STEP_META.map((s, i) => {
      const done = step > i + 1;
      const active = step === i + 1;
      return (
        <div key={i} className="flex items-center gap-0">
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
            done && "bg-[#8C6B6F]/20 text-[#8C6B6F] border border-[#8C6B6F]/30",
            active && "bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] text-white shadow-[0_0_16px_rgba(148,134,122,0.4)]",
            !done && !active && "bg-[#8C6B6F]/[0.06] text-[#1A1A1A]/25 border border-[#8C6B6F]/15"
          )}>
            <span className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
              done && "bg-[#8C6B6F] text-white",
              active && "bg-[#8C6B6F]/15 text-[#1A1A1A]",
              !done && !active && "bg-[#8C6B6F]/10 text-[#1A1A1A]/30"
            )}>
              {done ? "✓" : i + 1}
            </span>
            {s.label}
          </div>
          {i < 2 && (
            <div className={cn(
              "w-8 h-px mx-1 transition-all",
              done ? "bg-[#8C6B6F]/50" : "bg-[#8C6B6F]/10"
            )} />
          )}
        </div>
      );
    })}
  </div>
);

// ── Cash Assignment Wizard ──────────────────────────────
const CashAssignment = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [selectedUser, setSelectedUser] = useState<{ id: string; displayName: string; email?: string; phone?: string | null } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<{ id: string; name: string; price: number } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const { data: usersData, isLoading: usersLoading } = useQuery<{ data: { id: string; displayName: string; email: string; phone?: string | null }[] }>({
    queryKey: ["users-search", debouncedSearch],
    queryFn: async () => (
      await api.get(`/users?role=client${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""}`)
    ).data,
  });

  const allUsers = Array.isArray(usersData?.data) ? usersData.data : [];
  const filteredUsers = allUsers;

  const { data: plansData } = useQuery<{ data: { id: string; name: string; price: number; classLimit?: number | null; durationDays?: number; classCategory?: string }[] }>({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans")).data,
  });

  const assignMutation = useMutation({
    mutationFn: () => api.post("/memberships", {
      userId: selectedUser?.id,
      planId: selectedPlan?.id,
      paymentMethod,
      startDate: new Date().toISOString().split("T")[0],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memberships"] });
      toast({ title: "✅ Membresía activada correctamente" });
      setStep(1); setSelectedUser(null); setSelectedPlan(null); setSearch("");
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al asignar", variant: "destructive" }),
  });

  const plans = (Array.isArray(plansData?.data) ? plansData.data : []).filter((p) => (p as any).isActive !== false && (p as any).is_active !== false);
  const planGroups = groupPlans(plans);

  return (
    <div className="max-w-2xl mx-auto">
      <StepBar step={step} />

      {/* ── Step 1: Buscar cliente ─────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5">
            <h3 className="text-sm font-semibold text-[#1A1A1A]/60 uppercase tracking-wider mb-4">Buscar cliente</h3>
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#D9B5BA]/60" />
              <Input
                className="pl-9 bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 focus:border-[#8C6B6F]/50 focus:ring-[#8C6B6F]/20 text-[#1A1A1A] placeholder:text-[#8C6B6F]/40 rounded-xl"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, email o teléfono…"
                autoFocus
              />
            </div>
          </div>

          {usersLoading && (
            <div className="flex items-center justify-center py-8 text-[#D9B5BA]/60">
              <Loader2 className="animate-spin mr-2" size={16} /> Buscando…
            </div>
          )}

          <div className="space-y-2">
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:bg-[#8C6B6F]/5 hover:border-[#8C6B6F]/25 transition-all group text-left"
                onClick={() => { setSelectedUser(u); setStep(2); }}
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#8C6B6F]/30 to-[#D9B5BA]/20 border border-[#8C6B6F]/30 flex items-center justify-center text-sm font-bold text-[#8C6B6F] shrink-0">
                  {u.displayName?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#1A1A1A]/90 truncate">{u.displayName}</p>
                  <p className="text-xs text-[#1A1A1A]/35 truncate">
                    {u.email}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                </div>
                <ArrowRight size={14} className="text-[#1A1A1A]/20 group-hover:text-[#8C6B6F]/60 transition-colors shrink-0" />
              </button>
            ))}
            {filteredUsers.length === 0 && !usersLoading && (
              <p className="text-center py-6 text-[#1A1A1A]/30 text-sm">No se encontraron clientes</p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Elegir plan ────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Cliente seleccionado */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#8C6B6F]/8 border border-[#8C6B6F]/20">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#8C6B6F] to-[#D9B5BA] flex items-center justify-center text-xs font-bold text-white">
              {selectedUser?.displayName?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]/90">{selectedUser?.displayName}</p>
              <p className="text-xs text-[#1A1A1A]/40">{selectedUser?.email}</p>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto text-[#1A1A1A]/30 hover:text-[#1A1A1A]/60 text-xs" onClick={() => setStep(1)}>
              <ChevronLeft size={12} className="mr-1" /> Cambiar
            </Button>
          </div>

          {/* Plan groups */}
          {Object.entries(planGroups).map(([group, items]) => {
            if (!items.length) return null;
            const groupColors: Record<string, string> = {
              pilates: "text-[#D9B5BA]",
              bienestar: "text-[#8C6B6F]",
              otro: "text-[#1A1A1A]/50",
            };
            const groupLabels: Record<string, string> = {
              pilates: "Paquetes Pilates",
              bienestar: "Paquetes Bienestar",
              otro: "Otros paquetes",
            };
            return (
              <div key={group}>
                <p className={cn("text-[11px] font-semibold uppercase tracking-widest mb-2 px-1", groupColors[group])}>
                  {groupLabels[group] ?? group}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {items.map((p) => (
                    <button
                      key={p.id}
                      className={cn(
                        "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left group",
                        selectedPlan?.id === p.id
                          ? "border-[#8C6B6F]/50 bg-gradient-to-r from-[#8C6B6F]/10 to-[#D9B5BA]/5 shadow-[0_0_16px_rgba(148,134,122,0.12)]"
                          : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/25 hover:bg-[#8C6B6F]/5"
                      )}
                      onClick={() => setSelectedPlan(p)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-2 h-2 rounded-full shrink-0 transition-all",
                          selectedPlan?.id === p.id
                            ? "bg-[#8C6B6F] shadow-[0_0_8px_#8C6B6F]"
                            : "bg-[#8C6B6F]/12 group-hover:bg-[#8C6B6F]/50"
                        )} />
                        <div>
                          <p className="text-sm font-semibold text-[#1A1A1A]/85">{p.name}</p>
                          <p className="text-xs text-[#1A1A1A]/30">
                            {p.classLimit === null ? "Ilimitado" : `${p.classLimit} clases`}
                            {p.durationDays ? ` · ${p.durationDays} días` : ""}
                          </p>
                        </div>
                      </div>
                      <span className={cn(
                        "text-sm font-bold transition-colors",
                        selectedPlan?.id === p.id ? "text-[#8C6B6F]" : "text-[#1A1A1A]/60 group-hover:text-[#1A1A1A]/90"
                      )}>
                        ${Number(p.price).toLocaleString()} MXN
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="border-[#8C6B6F]/15 text-[#1A1A1A]/50 hover:text-[#1A1A1A] hover:border-[#8C6B6F]/25" onClick={() => setStep(1)}>
              <ChevronLeft size={14} className="mr-1" /> Volver
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 text-white font-semibold shadow-[0_0_20px_rgba(148,134,122,0.3)]"
              disabled={!selectedPlan}
              onClick={() => setStep(3)}
            >
              Continuar <ArrowRight size={14} className="ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirmar ─────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Resumen */}
          <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#8C6B6F]/15 flex items-center gap-2">
              <Sparkles size={14} className="text-[#FDF7F8]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/50">Resumen de la membresía</span>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#1A1A1A]/50">Cliente</span>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#8C6B6F] to-[#D9B5BA] flex items-center justify-center text-[9px] font-bold text-white">
                    {selectedUser?.displayName?.[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold text-[#1A1A1A]/90">{selectedUser?.displayName}</span>
                </div>
              </div>
              <div className="h-px bg-[#8C6B6F]/[0.06]" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#1A1A1A]/50">Plan</span>
                <span className="text-sm font-semibold text-[#1A1A1A]/90">{selectedPlan?.name}</span>
              </div>
              <div className="h-px bg-[#8C6B6F]/[0.06]" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#1A1A1A]/50">Total</span>
                <span className="text-lg font-bold text-[#8C6B6F]">${Number(selectedPlan?.price).toLocaleString()} MXN</span>
              </div>
            </div>
          </div>

          {/* Método de pago */}
          <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-[#1A1A1A]/40 mb-3 block">Método de pago</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all",
                    paymentMethod === value
                      ? "border-[#8C6B6F]/50 bg-[#8C6B6F]/10 text-[#8C6B6F]"
                      : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] text-[#1A1A1A]/40 hover:border-[#8C6B6F]/20 hover:text-[#1A1A1A]/70"
                  )}
                  onClick={() => setPaymentMethod(value)}
                >
                  <Icon size={16} />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="border-[#8C6B6F]/15 text-[#1A1A1A]/50 hover:text-[#1A1A1A] hover:border-[#8C6B6F]/25" onClick={() => setStep(2)}>
              <ChevronLeft size={14} className="mr-1" /> Volver
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 text-white font-bold shadow-[0_0_24px_rgba(148,134,122,0.35)] h-11"
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending}
            >
              {assignMutation.isPending
                ? <><Loader2 className="animate-spin mr-2" size={14} /> Activando…</>
                : <><CheckCircle2 size={15} className="mr-2" /> Confirmar y activar membresía</>
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Pending Orders (verify / reject) ─────────────────────
const PendingOrders = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{ url: string; userName: string; paidAt: string } | null>(null);

  const downloadProof = async () => {
    if (!preview) return;
    try {
      const safeName = (preview.userName || "alumna")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      const date = new Date(preview.paidAt || Date.now());
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

      const res = await fetch(preview.url);
      const blob = await res.blob();
      const ext = (() => {
        if (blob.type.includes("pdf")) return "pdf";
        if (blob.type.includes("png")) return "png";
        if (blob.type.includes("jpeg") || blob.type.includes("jpg")) return "jpg";
        if (blob.type.includes("webp")) return "webp";
        const m = preview.url.match(/\.(pdf|png|jpe?g|webp|heic)(\?|$)/i);
        return m ? m[1].toLowerCase() : "jpg";
      })();

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `comprobante_${safeName}_${dateStr}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      window.open(preview.url, "_blank");
    }
  };

  const { data: dataVerify, isLoading: loadingVerify } = useQuery<{ data: any[] }>({
    queryKey: ["admin-orders-pending-verification"],
    queryFn: async () => (await api.get("/admin/orders?status=pending_verification")).data,
  });
  const { data: dataPending, isLoading: loadingPending } = useQuery<{ data: any[] }>({
    queryKey: ["admin-orders-pending-payment"],
    queryFn: async () => (await api.get("/admin/orders?status=pending_payment")).data,
  });
  const isLoading = loadingVerify || loadingPending;
  const orders = [
    ...(Array.isArray(dataVerify?.data) ? dataVerify.data : []),
    ...(Array.isArray(dataPending?.data) ? dataPending.data.filter((o: any) => o.payment_method === "cash") : []),
  ].sort((a: any, b: any) => new Date(b.createdAt ?? b.created_at).getTime() - new Date(a.createdAt ?? a.created_at).getTime());

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/orders/${id}/verify`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-orders-pending-verification"] });
      qc.invalidateQueries({ queryKey: ["admin-orders-pending-payment"] });
      qc.invalidateQueries({ queryKey: ["orders-pending"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast({ title: "✅ Orden verificada y membresía activada" });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al verificar", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/orders/${id}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-orders-pending-verification"] });
      qc.invalidateQueries({ queryKey: ["admin-orders-pending-payment"] });
      qc.invalidateQueries({ queryKey: ["orders-pending"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast({ title: "Orden rechazada" });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? "Error al rechazar", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#8C6B6F]/60">
        <Loader2 className="animate-spin mr-2" size={16} /> Cargando…
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 size={32} className="text-[#D9B5BA]/40 mb-3" />
        <p className="text-[#1A1A1A]/40 text-sm font-medium">No hay órdenes pendientes</p>
        <p className="text-[#1A1A1A]/25 text-xs mt-1">Todas las órdenes han sido procesadas</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {orders.map((o: any) => {
          const isCash = o.payment_method === "cash";
          const isTransfer = o.payment_method === "transfer";
          return (
          <div
            key={o.id}
            className={cn(
              "rounded-xl border p-4 space-y-3",
              isCash
                ? "border-blue-500/25 bg-blue-50/40"
                : "border-amber-600/20 bg-amber-50/50"
            )}
          >
            {/* Payment method banner */}
            <div className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 -mx-0.5",
              isCash
                ? "bg-blue-100/70 border border-blue-200/50"
                : "bg-amber-100/70 border border-amber-200/50"
            )}>
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                isCash ? "bg-blue-500 text-white" : "bg-amber-500 text-white"
              )}>
                {isCash ? <Banknote size={15} /> : <CreditCard size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs font-bold", isCash ? "text-blue-800" : "text-amber-800")}>
                  {isCash ? "PAGO EN EFECTIVO — EN ESTUDIO" : isTransfer ? "TRANSFERENCIA / SPEI" : "TARJETA"}
                </p>
                <p className={cn("text-[10px]", isCash ? "text-blue-600/70" : "text-amber-600/70")}>
                  {isCash ? "La clienta pagará directamente en recepción" : "Comprobante enviado, verificar pago"}
                </p>
              </div>
              <Badge variant="outline" className={cn(
                "text-[10px] shrink-0",
                isCash ? "text-blue-700 border-blue-400/40 bg-blue-50" : "text-amber-700 border-amber-400/40 bg-amber-50"
              )}>
                <Clock size={9} className="mr-1" />
                {isCash ? "Por cobrar" : "Por verificar"}
              </Badge>
            </div>

            {/* Client info + amount */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#8C6B6F]/30 to-[#D9B5BA]/20 border border-[#8C6B6F]/30 flex items-center justify-center text-sm font-bold text-[#8C6B6F] shrink-0">
                  {(o.userName ?? "?")[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm text-[#1A1A1A]/90">{o.userName ?? "—"}</p>
                  <p className="text-xs text-[#1A1A1A]/40">{o.planName ?? "Plan"}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm text-[#1A1A1A]/90">
                  ${Number(o.totalAmount ?? o.total_amount ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN
                </p>
                <p className="text-[10px] text-[#1A1A1A]/35">
                  {o.createdAt ? new Date(o.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </p>
              </div>
            </div>

            {/* Proof link (only for transfers) */}
            {o.proofUrl && (
              <button
                onClick={() => setPreview({
                  url: o.proofUrl,
                  userName: o.userName ?? "alumna",
                  paidAt: o.proofUploadedAt ?? o.createdAt ?? new Date().toISOString(),
                })}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#8C6B6F] hover:text-[#1A1A1A] transition-colors px-1"
              >
                <Eye size={13} /> Ver comprobante de pago
              </button>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className={cn(
                  "flex-1 font-semibold text-xs h-9 text-white hover:opacity-90",
                  isCash
                    ? "bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-500/20 shadow-sm"
                    : "bg-gradient-to-r from-[#4a7a38] to-[#6b9a52]"
                )}
                onClick={() => verifyMutation.mutate(o.id)}
                disabled={verifyMutation.isPending}
              >
                {verifyMutation.isPending
                  ? <Loader2 className="animate-spin" size={13} />
                  : <><CheckCircle2 size={13} className="mr-1" /> {isCash ? "Confirmar pago y activar" : "Verificar y activar"}</>
                }
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-400/30 text-red-600 hover:bg-red-50 hover:border-red-400/50 font-semibold text-xs h-9"
                onClick={() => rejectMutation.mutate(o.id)}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? <Loader2 className="animate-spin" size={13} /> : <><XCircle size={13} className="mr-1" /> Rechazar</>}
              </Button>
            </div>
          </div>
          );
        })}
      </div>

      {/* Proof preview modal */}
      {preview && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-auto p-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-3 pb-2 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1A1A1A]/80 truncate">Comprobante de {preview.userName}</p>
                <p className="text-[11px] text-[#1A1A1A]/45">
                  {new Date(preview.paidAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={downloadProof}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#1A1A1A] hover:bg-[#8C6B6F] px-3 py-1.5 rounded-full transition-colors"
                >
                  <Download size={13} /> Descargar
                </button>
                <button onClick={() => setPreview(null)} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] text-lg leading-none px-1">✕</button>
              </div>
            </div>
            {preview.url.includes("application/pdf") || preview.url.endsWith(".pdf") ? (
              <iframe src={preview.url} className="w-full h-[60vh] rounded-lg border-0" title="Comprobante PDF" />
            ) : (
              <img src={preview.url} alt="Comprobante" className="w-full rounded-lg" />
            )}
          </div>
        </div>
      )}
    </>
  );
};

// ── Payments History ──────────────────────────────────────
const PaymentsHistory = () => {
  const { data } = useQuery<{ data: any[] }>({
    queryKey: ["payments"],
    queryFn: async () => (await api.get("/payments")).data,
  });
  const payments = Array.isArray(data?.data) ? data.data : [];

  const methodStyles: Record<string, string> = {
    cash: "text-[#3D3A3A] border-[#8C6B6F]/30 bg-[#8C6B6F]/10",
    card: "text-[#6B4F53] border-[#D9B5BA]/30 bg-[#D9B5BA]/10",
    transfer: "text-[#3D3A3A] border-[#8C6B6F]/30 bg-[#8C6B6F]/10",
  };
  const methodLabels: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia" };

  if (!payments.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History size={32} className="text-[#1A1A1A]/10 mb-3" />
        <p className="text-[#1A1A1A]/30 text-sm">Sin pagos registrados aún</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {payments.map((p: any) => (
        <div key={p.id} className="flex items-center gap-4 p-4 rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:bg-[#8C6B6F]/[0.06] transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#8C6B6F]/20 to-[#D9B5BA]/10 border border-[#8C6B6F]/20 flex items-center justify-center shrink-0">
            <CreditCard size={13} className="text-[#8C6B6F]/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1A1A1A]/85 truncate">{p.userName ?? p.userId ?? "—"}</p>
            <p className="text-xs text-[#1A1A1A]/30">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border", methodStyles[p.method] ?? "text-[#1A1A1A]/40 border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.06]")}>
              {methodLabels[p.method] ?? p.method ?? "—"}
            </span>
            <span className="text-sm font-bold text-[#1A1A1A]/90">${Number(p.total_amount ?? p.amount ?? 0).toLocaleString()} MXN</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Main Payments Page ────────────────────────────────────
const PaymentsPage = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "pending" ? "pending" : "cash";
  const [activeTab, setActiveTab] = useState<"cash" | "pending" | "history">(initialTab);

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-3xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[#1A1A1A] mb-1">Pagos</h1>
            <p className="text-sm text-[#1A1A1A]/35">Asigna membresías en efectivo, verifica pagos pendientes y consulta el historial</p>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-xl bg-[#8C6B6F]/[0.06] border border-[#8C6B6F]/15 w-fit mb-8">
            {([["cash", "Asignación efectivo"], ["pending", "Pendientes"], ["history", "Historial"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setActiveTab(val)}
                className={cn(
                  "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                  activeTab === val
                    ? "bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] text-white shadow-[0_0_14px_rgba(148,134,122,0.3)]"
                    : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "cash" && <CashAssignment />}
          {activeTab === "pending" && <PendingOrders />}
          {activeTab === "history" && <PaymentsHistory />}
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default PaymentsPage;
