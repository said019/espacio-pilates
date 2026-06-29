import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Check, Loader2, CreditCard, Copy, Building2,
  Tag, ChevronRight, ArrowLeft, Upload, CheckCircle, Sparkles,
} from "lucide-react";
import imgPilates from "@/assets/pilates_2320695.png";

type Step = "select" | "method" | "bank" | "upload" | "done";
type PaymentMethod = "transfer" | "card";

function compressImage(file: File, maxWidth = 1400, quality = 0.82): Promise<File> {
  return new Promise((resolve) => {
    // Skip non-images (PDF) and HEIC/HEIF (browser can't decode reliably — server stores as-is)
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (!file.type.startsWith("image/") || isHeic) {
      resolve(file);
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve(file); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob || blob.size >= file.size) { resolve(file); return; }
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          quality
        );
      } catch {
        cleanup();
        resolve(file);
      }
    };
    img.onerror = () => { cleanup(); resolve(file); };
    img.src = objectUrl;
  });
}


// Helper: get discount price from plan's discount_price field (DB-driven)
function getPlanDiscountPrice(plan: any): number | null {
  const dp = plan?.discountPrice ?? plan?.discount_price;
  if (dp == null || dp === "" || dp === 0) return null;
  return Number(dp);
}

function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["true", "1", "yes", "si", "sí", "t"].includes(value.toLowerCase());
  return false;
}

// ── Plan card ─────────────────────────────────────────────────────────────────
const PlanCard = ({
  plan, selected, onSelect,
}: { plan: any; selected: boolean; onSelect: () => void }) => {
  const classLimit = plan.classLimit ?? plan.class_limit ?? null;
  const durationDays = Number(plan.durationDays ?? plan.duration_days ?? 0);
  const nonTransferable = flag(plan.isNonTransferable ?? plan.is_non_transferable);
  const nonRepeatable = flag(plan.isNonRepeatable ?? plan.is_non_repeatable);
  const features: string[] = (Array.isArray(plan.features) ? plan.features : [])
    .filter((f: string) => !f.toLowerCase().includes("descuento") && !f.toLowerCase().includes("costo con"));
  const planPrice = Number(plan.price ?? 0);
  const discountPrice = getPlanDiscountPrice(plan);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative w-full text-left rounded-2xl border p-4 transition-all duration-200 overflow-hidden",
        selected
          ? "border-[#8C6B6F]/60 bg-gradient-to-br from-[#8C6B6F]/10 to-[#D9B5BA]/5 shadow-[0_0_20px_rgba(148,134,122,0.15)]"
          : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/25 hover:bg-[#8C6B6F]/[0.06]"
      )}
    >
      <div className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full opacity-30 blur-2xl bg-[#D9B5BA]" />
      {selected && (
        <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-gradient-to-br from-[#8C6B6F] to-[#D9B5BA] flex items-center justify-center">
          <Check size={11} className="text-white" />
        </span>
      )}
      <div className="flex items-start gap-3 pr-7">
        <div className="h-11 w-11 rounded-xl border flex items-center justify-center shrink-0 border-[#D9B5BA]/30 bg-[#D9B5BA]/10">
          <img src={imgPilates} alt="" className="h-7 w-7 object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A]/85 leading-snug">{plan.name}</p>
          {plan.description && (
            <p className="text-[11px] text-[#1A1A1A]/45 mt-0.5 leading-snug">{plan.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-1 mt-2">
        <span className="text-2xl font-bold text-[#1A1A1A]">${planPrice.toLocaleString("es-MX")}</span>
        <span className="text-xs text-[#1A1A1A]/35">{plan.currency ?? "MXN"}</span>
      </div>
      {discountPrice && (
        <p className="text-[11px] text-[#6B4F53] font-bold mt-0.5">
          Transferencia: ${discountPrice.toLocaleString("es-MX")}
        </p>
      )}
      {features.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {features.map((f, i) => (
            <li key={i} className="text-[10px] text-[#1A1A1A]/45 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">•</span>
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        {durationDays > 0 && (
          <span className="text-[10px] text-[#6B4F53] bg-[#D9B5BA]/15 border border-[#D9B5BA]/25 rounded-full px-2 py-0.5">
            {durationDays} días
          </span>
        )}
        {Number(classLimit) > 0 && (
          <span className="text-[10px] text-[#3D3A3A] bg-[#8C6B6F]/12 border border-[#8C6B6F]/20 rounded-full px-2 py-0.5">
            {classLimit} clases
          </span>
        )}
        {nonTransferable && (
          <span className="text-[10px] text-[#B5832F] bg-[#F4EAD6] border border-[#E5CF9F] rounded-full px-2 py-0.5">No transferible</span>
        )}
        {nonRepeatable && (
          <span className="text-[10px] text-[#A8473F] bg-[#F3DEDA] border border-[#E2B7B0] rounded-full px-2 py-0.5">No repetible</span>
        )}
      </div>
    </button>
  );
};

// ── Step pill bar ──────────────────────────────────────────────────────────────
const STEPS: { id: Step; label: string }[] = [
  { id: "select", label: "Plan" },
  { id: "method", label: "Pago" },
  { id: "upload", label: "Comprobante" },
  { id: "done",   label: "Listo" },
];

const StepBar = ({ current }: { current: Step }) => {
  const order: Step[] = ["select", "method", "bank", "upload", "done"];
  const currentIdx = order.indexOf(current);

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const sIdx = order.indexOf(s.id === "method" ? "method" : s.id);
        const done = currentIdx > sIdx;
        const active = s.id === current || (current === "bank" && s.id === "method");
        return (
          <div key={s.id} className="flex items-center gap-1">
            {i > 0 && <div className={cn("h-px w-6 rounded", done ? "bg-[#8C6B6F]/60" : "bg-[#8C6B6F]/10")} />}
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all",
              active ? "border-[#8C6B6F]/40 bg-[#8C6B6F]/10 text-[#8C6B6F]"
                : done ? "border-[#4ade80]/30 bg-[#4ade80]/5 text-[#4ade80]"
                : "border-[#8C6B6F]/15 text-[#1A1A1A]/25"
            )}>
              {done ? <Check size={10} /> : <span>{i + 1}</span>}
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const Checkout = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("select");
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("transfer");
  const [discountCode, setDiscountCode] = useState("");
  const [discountResult, setDiscountResult] = useState<any>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderUuid, setOrderUuid] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);

  // If arriving with ?orderId=xxx, jump straight to upload step
  useEffect(() => {
    const oid = searchParams.get("orderId");
    if (oid) {
      setOrderUuid(oid);
      setStep("upload");
    }
  }, []);

  const { data: plansData, isLoading: loadingPlans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans")).data,
  });

  const { data: paymentsConfig } = useQuery({
    queryKey: ["payments-config"],
    queryFn: async () => (await api.get("/payments/config")).data,
  });
  const cardEnabled: boolean = Boolean(paymentsConfig?.data?.cardEnabled);

  // One-time inscription status (auth). Auto-added server-side to class-package orders.
  const { data: inscriptionData } = useQuery({
    queryKey: ["inscription-status"],
    queryFn: async () => (await api.get("/inscription-status")).data,
  });
  const inscriptionInfo = inscriptionData?.data ?? inscriptionData;
  const needsInscription: boolean = Boolean(inscriptionInfo?.needsInscription);
  const inscriptionPrice: number = Number(inscriptionInfo?.price ?? 500) || 500;

  const rawPlans: any[] = Array.isArray(plansData?.data) ? plansData.data : Array.isArray(plansData) ? plansData : [];
  const allPlans = rawPlans
    .filter((p) => (p.isActive ?? p.is_active) !== false)
    .filter((p) => !(p.name ?? "").toLowerCase().includes("paquete +"))
    .sort((a, b) => (a.sortOrder ?? a.sort_order ?? 99) - (b.sortOrder ?? b.sort_order ?? 99));

  const trialPlan = allPlans.find((p) => (p.name ?? "").toLowerCase().includes("muestra"));
  const plans = allPlans.filter((p) => p !== trialPlan);

  // Compute price (price arrives as a string from the API → coerce to number to avoid string concatenation in totals)
  const basePrice = Number(selectedPlan?.price ?? 0);
  const individualDiscount = getPlanDiscountPrice(selectedPlan);
  const effectivePrice = paymentMethod === "transfer" && individualDiscount
    ? individualDiscount : basePrice;
  const finalAmount = discountResult ? effectivePrice - (discountResult.discount_amount ?? 0) : effectivePrice;

  // Is the selected plan a multi-class package? (Backend auto-adds inscription to these.)
  // Detect via class count (class_limit >= 2) OR by name matching /paquete/i.
  // Excludes "Clase Extra" / "Clase Suelta / Visita" (class_limit < 2) and the trial.
  const selectedClassLimit = Number(selectedPlan?.classLimit ?? selectedPlan?.class_limit ?? 0);
  const selectedName = String(selectedPlan?.name ?? "");
  const isPackage = Boolean(
    selectedPlan && (selectedClassLimit >= 2 || /paquete/i.test(selectedName))
  );
  // Inscription applies to packages when the client still needs it. Display-only mirror
  // of the backend rule; loading/absent status -> needsInscription=false -> no line.
  const showInscription = isPackage && needsInscription;
  const inscriptionAmount = showInscription ? inscriptionPrice : 0;
  // Plan price after any discount + inscription = what the backend charges.
  const totalWithInscription = finalAmount + inscriptionAmount;

  // "Clase Extra" es solo para alumnas inscritas → se bloquea si la alumna
  // aún necesita inscripción (la "Clase Suelta / Visita" es la única sin inscripción).
  const isClaseExtra = /clase\s*extra/i.test(selectedName);
  const blockedClaseExtra = isClaseExtra && needsInscription;

  const validateCodeMutation = useMutation({
    mutationFn: () => api.post("/discount-codes/validate", { code: discountCode, planId: selectedPlan?.id }),
    onSuccess: (res) => setDiscountResult(res.data?.data ?? res.data),
    onError: () => toast({ title: "Código inválido", variant: "destructive" }),
  });

  const createOrderMutation = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        planId: selectedPlan.id,
        discountCode: discountResult?.code,
        paymentMethod,
      }),
    onSuccess: (res) => {
      const data = res.data?.data ?? res.data;
      setOrderUuid(data.id);
      setOrderId(data.order_number ?? data.orderNumber ?? data.orderId ?? data.id);
      setBankDetails(data.bankDetails ?? data.bank_details);
      if (paymentMethod === "card") {
        // Pago DENTRO de la app (Payment Brick), sin abrir navegador externo.
        navigate(`/app/pay/${data.id}`);
        return;
      }
      setStep("bank");
    },
    onError: (err: any) =>
      toast({ title: "Error al crear orden", description: err.response?.data?.message, variant: "destructive" }),
  });

  const uploadProofMutation = useMutation({
    mutationFn: async () => {
      if (!orderUuid) throw new Error("No se encontró la orden. Regresa e intenta de nuevo.");
      if (!file) throw new Error("Selecciona un archivo primero");
      // Hard limit: 9MB raw (server cap is 10MB after multipart overhead)
      if (file.size > 9 * 1024 * 1024) {
        throw new Error(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)}MB. Usa una imagen más ligera (máx 9MB).`);
      }
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("file", compressed, compressed.name);
      return api.post(`/orders/${orderUuid}/proof`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-orders"] }); setStep("done"); },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || err?.message || "Inténtalo de nuevo";
      toast({ title: "Error al subir comprobante", description: msg, variant: "destructive" });
    },
  });

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-xl mx-auto space-y-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Comprar membresía</h1>

          <StepBar current={step} />

          {/* ── Step 1: Select plan ── */}
          {step === "select" && (
            <div className="space-y-5">
              {loadingPlans ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-28 rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Clase muestra */}
                  {trialPlan && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-[#D9B5BA]/80">
                        Conoce nuestro estudio
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlan(trialPlan);
                          setDiscountResult(null);
                        }}
                        className={cn(
                          "relative w-full text-left rounded-2xl border p-4 transition-all duration-200 overflow-hidden",
                          selectedPlan?.id === trialPlan.id
                            ? "border-[#D9B5BA]/60 bg-gradient-to-br from-[#D9B5BA]/10 to-[#8C6B6F]/5 shadow-[0_0_20px_rgba(181,191,156,0.15)]"
                            : "border-[#D9B5BA]/25 bg-[#D9B5BA]/[0.04] hover:border-[#D9B5BA]/40 hover:bg-[#D9B5BA]/[0.06]"
                        )}
                      >
                        {selectedPlan?.id === trialPlan.id && (
                          <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-gradient-to-br from-[#D9B5BA] to-[#8C6B6F] flex items-center justify-center">
                            <Check size={11} className="text-white" />
                          </span>
                        )}
                        <div className="flex items-start gap-3 pr-7">
                          <div className="h-11 w-11 rounded-xl border flex items-center justify-center shrink-0 border-[#D9B5BA]/30 bg-[#D9B5BA]/10">
                            <Sparkles size={18} className="text-[#D9B5BA]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#1A1A1A]/85 leading-snug">{trialPlan.name}</p>
                            <p className="text-[11px] text-[#1A1A1A]/45 mt-0.5 leading-snug">{trialPlan.description}</p>
                          </div>
                        </div>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-2xl font-bold text-[#1A1A1A]">${Number(trialPlan.price ?? 0).toLocaleString("es-MX")}</span>
                          <span className="text-xs text-[#1A1A1A]/35">{trialPlan.currency ?? "MXN"}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="text-[10px] text-[#6B4F53] bg-[#D9B5BA]/15 border border-[#D9B5BA]/25 rounded-full px-2 py-0.5">1 clase</span>
                          <span className="text-[10px] text-[#B5832F] bg-[#F4EAD6] border border-[#E5CF9F] rounded-full px-2 py-0.5">No transferible</span>
                          <span className="text-[10px] text-[#A8473F] bg-[#F3DEDA] border border-[#E2B7B0] rounded-full px-2 py-0.5">No reembolsable</span>
                        </div>
                      </button>
                    </div>
                  )}

                  {/* Plan cards */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-[#8C6B6F]/70">
                      Paquetes de clases
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {plans.map((plan) => (
                        <PlanCard
                          key={plan.id}
                          plan={plan}
                          selected={selectedPlan?.id === plan.id}
                          onSelect={() => {
                            setSelectedPlan(plan);
                            setDiscountResult(null);
                          }}
                        />
                      ))}
                    </div>
                  </div>

                </div>
              )}

              {/* Summary + continue */}
              {selectedPlan && (
                <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-4 space-y-4">
                  <div className="text-xs text-[#1A1A1A]/60 space-y-1.5">
                    <p><strong className="text-[#1A1A1A]/80">{selectedPlan.name}</strong></p>
                    {individualDiscount && individualDiscount < basePrice && (
                      <div className="flex items-center gap-2 bg-[#6B4F53]/10 border border-[#6B4F53]/20 rounded-lg px-3 py-2">
                        <span className="text-base">💰</span>
                        <p className="text-[#6B4F53] font-bold text-xs">
                          Paga con transferencia: <span className="text-sm">${individualDiscount.toLocaleString("es-MX")}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Discount code */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C6B6F]/50" />
                      <Input
                        className="pl-8 bg-[#8C6B6F]/[0.06] border-[#8C6B6F]/15 text-[#1A1A1A] placeholder:text-[#8C6B6F]/40 uppercase"
                        placeholder="Código de descuento"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                      />
                    </div>
                    <button
                      onClick={() => validateCodeMutation.mutate()}
                      disabled={!discountCode || validateCodeMutation.isPending}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-[#8C6B6F]/30 text-[#8C6B6F] bg-[#8C6B6F]/5 hover:bg-[#8C6B6F]/10 transition-all disabled:opacity-40"
                    >
                      Aplicar
                    </button>
                  </div>
                  {discountResult && (
                    <div className="flex items-center gap-2 text-xs text-[#6E7F4F]">
                      <Check size={12} /> Descuento aplicado: -${discountResult.discount_amount} MXN
                    </div>
                  )}

                  {/* Inscription line (packages only, when the client needs it) */}
                  {showInscription && (
                    <div className="space-y-1.5 pt-3 border-t border-[#8C6B6F]/15">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#1A1A1A]/60">Plan</span>
                        <span className="font-semibold text-[#1A1A1A]/80">${basePrice.toLocaleString("es-MX")} MXN</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#1A1A1A]/60">Inscripción (pago único)</span>
                        <span className="font-semibold text-[#1A1A1A]/80">${inscriptionAmount.toLocaleString("es-MX")} MXN</span>
                      </div>
                      <p className="text-[10px] text-[#1A1A1A]/40 leading-snug pt-0.5">
                        Pago único de inscripción — se cobra solo al inscribirte (o tras 6 meses de inactividad).
                      </p>
                    </div>
                  )}

                  {/* Total */}
                  <div className={cn("flex items-center justify-between py-3", showInscription ? "" : "border-t border-[#8C6B6F]/15")}>
                    <span className="text-sm text-[#1A1A1A]/60">Total a pagar</span>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-[#1A1A1A]">${(basePrice + inscriptionAmount).toLocaleString("es-MX")} <span className="text-sm font-normal text-[#1A1A1A]/35">MXN</span></span>
                      {individualDiscount && individualDiscount < basePrice && (
                        <p className="text-[11px] text-[#6B4F53] font-bold mt-0.5">
                          💰 Transferencia: ${(individualDiscount + inscriptionAmount).toLocaleString("es-MX")}
                        </p>
                      )}
                    </div>
                  </div>

                  {blockedClaseExtra && (
                    <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 leading-snug">
                      La <strong>clase extra</strong> es solo para alumnas inscritas. Aún no estás inscrita — elige una <strong>Clase suelta / visita</strong> o un <strong>paquete</strong> para empezar.
                    </div>
                  )}
                  <button
                    onClick={() => setStep("method")}
                    disabled={blockedClaseExtra}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] transition-opacity",
                      blockedClaseExtra ? "opacity-40 cursor-not-allowed" : "hover:opacity-90"
                    )}
                  >
                    Seleccionar método de pago <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Payment method ── */}
          {step === "method" && (
            <div className="space-y-4">
              <button onClick={() => setStep("select")} className="flex items-center gap-1.5 text-xs text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 transition-colors">
                <ArrowLeft size={13} /> Cambiar plan
              </button>

              <div className="rounded-2xl border border-[#8C6B6F]/20 bg-[#8C6B6F]/5 px-4 py-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#1A1A1A]/70">{selectedPlan?.name}</span>
                  <div className="text-right">
                    {individualDiscount && individualDiscount < basePrice && paymentMethod !== "card" ? (
                      <>
                        <span className="text-xs text-[#1A1A1A]/30 line-through mr-2">${(basePrice + inscriptionAmount).toLocaleString("es-MX")}</span>
                        <span className="text-lg font-bold text-[#6B4F53]">${totalWithInscription.toLocaleString("es-MX")} MXN</span>
                      </>
                    ) : (
                      <span className="text-lg font-bold text-[#1A1A1A]">${totalWithInscription.toLocaleString("es-MX")} MXN</span>
                    )}
                  </div>
                </div>
                {showInscription && (
                  <div className="mt-2 pt-2 border-t border-[#8C6B6F]/10 space-y-1">
                    <div className="flex justify-between items-center text-[11px] text-[#1A1A1A]/55">
                      <span>Plan</span>
                      <span>${finalAmount.toLocaleString("es-MX")} MXN</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-[#1A1A1A]/55">
                      <span>Inscripción (pago único)</span>
                      <span>${inscriptionAmount.toLocaleString("es-MX")} MXN</span>
                    </div>
                    <p className="text-[10px] text-[#1A1A1A]/40 leading-snug">
                      Pago único de inscripción — se cobra solo al inscribirte (o tras 6 meses de inactividad).
                    </p>
                  </div>
                )}
                {individualDiscount && individualDiscount < basePrice && paymentMethod !== "card" && (
                  <p className="text-[11px] text-[#6B4F53] font-bold mt-1.5 flex items-center gap-1">
                    💰 Ahorras ${(basePrice - individualDiscount).toLocaleString("es-MX")} con transferencia
                  </p>
                )}
              </div>

              <p className="text-sm font-semibold text-[#1A1A1A]/80">¿Cómo quieres pagar?</p>

              <div className={cn("grid grid-cols-1 gap-3", cardEnabled ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("transfer")}
                  className={cn(
                    "flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all",
                    paymentMethod === "transfer"
                      ? "border-[#D9B5BA]/50 bg-[#D9B5BA]/10 shadow-[0_0_16px_rgba(181,191,156,0.15)]"
                      : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/25"
                  )}
                >
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", paymentMethod === "transfer" ? "bg-[#D9B5BA]/20 text-[#D9B5BA]" : "bg-[#8C6B6F]/[0.06] text-[#1A1A1A]/40")}>
                    <Building2 size={22} />
                  </div>
                  <div className="text-center">
                    <p className={cn("text-sm font-semibold", paymentMethod === "transfer" ? "text-[#D9B5BA]" : "text-[#1A1A1A]/60")}>Transferencia</p>
                    <p className="text-[10px] text-[#1A1A1A]/30 mt-0.5">SPEI / banco</p>
                  </div>
                  {paymentMethod === "transfer" && (
                    <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#D9B5BA] to-[#8C6B6F] flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>

                {cardEnabled && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={cn(
                      "flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all",
                      paymentMethod === "card"
                        ? "border-[#B8915A]/50 bg-[#B8915A]/10 shadow-[0_0_16px_rgba(184,145,90,0.15)]"
                        : "border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#8C6B6F]/25"
                    )}
                  >
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", paymentMethod === "card" ? "bg-[#B8915A]/20 text-[#B8915A]" : "bg-[#8C6B6F]/[0.06] text-[#1A1A1A]/40")}>
                      <CreditCard size={22} />
                    </div>
                    <div className="text-center">
                      <p className={cn("text-sm font-semibold", paymentMethod === "card" ? "text-[#B8915A]" : "text-[#1A1A1A]/60")}>Tarjeta</p>
                      <p className="text-[10px] text-[#1A1A1A]/30 mt-0.5">Débito / crédito</p>
                    </div>
                    {paymentMethod === "card" && (
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#B8915A] to-[#D9B5BA] flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </span>
                    )}
                  </button>
                )}
              </div>

              <button
                onClick={() => createOrderMutation.mutate()}
                disabled={createOrderMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createOrderMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                {createOrderMutation.isPending ? "Procesando…" : (paymentMethod === "card" ? "Pagar con tarjeta" : "Confirmar")}
              </button>
            </div>
          )}

          {/* ── Step 3a: Bank details (transfer) ── */}
          {step === "bank" && bankDetails && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#8C6B6F]/25 bg-white p-5 space-y-1">
                <p className="text-base font-bold text-[#1A1A1A] mb-1">Datos de transferencia SPEI</p>
                <p className="text-sm text-[#3D3A3A] mb-4">Realiza la transferencia y luego sube tu comprobante.</p>
                {[
                  { label: "CLABE", value: bankDetails.clabe },
                  { label: "Cuenta", value: bankDetails.account_number ?? bankDetails.accountNumber },
                  { label: "Banco", value: bankDetails.bank },
                  { label: "Titular", value: bankDetails.account_holder ?? bankDetails.accountHolder },
                  { label: "Monto", value: `$${bankDetails.amount?.toLocaleString("es-MX")} MXN` },
                ].map(({ label, value }) => value && (
                  <div key={label} className="flex items-center justify-between py-3 border-b border-[#F0D0D5] last:border-0">
                    <span className="text-sm text-[#3D3A3A] font-medium">{label}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(String(value).replace(/\s/g, "")); toast({ title: `${label} copiado` }); }}
                      className="flex items-center gap-2 group"
                    >
                      <span className="font-mono text-sm font-bold text-[#1A1A1A] select-all">{value}</span>
                      <span className="w-7 h-7 rounded-lg bg-[#8C6B6F]/10 flex items-center justify-center text-[#8C6B6F] group-hover:bg-[#8C6B6F]/20 transition-colors">
                        <Copy size={13} />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[#3D3A3A] text-center">Toca cualquier dato para copiarlo al portapapeles</p>
              <button onClick={() => setStep("upload")} className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 transition-opacity text-sm tracking-wide uppercase">
                Ya realicé la transferencia →
              </button>
            </div>
          )}

          {/* ── Step 4: Upload proof ── */}
          {step === "upload" && (
            <div className="rounded-2xl border border-[#8C6B6F]/20 bg-white p-5 space-y-4">
              <div>
                <p className="text-base font-bold text-[#1A1A1A]">Subir comprobante</p>
                <p className="text-sm text-[#3D3A3A] mt-1">Sube una foto o captura de pantalla de tu comprobante de transferencia.</p>
              </div>
              <div
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-10 cursor-pointer text-center transition-all",
                  file ? "border-[#4ade80]/50 bg-[#4ade80]/5" : "border-[#8C6B6F]/25 hover:border-[#8C6B6F]/40 bg-[#FAE5E7]"
                )}
              >
                <input type="file" accept="image/*,.pdf,.heic,.heif" ref={fileRef} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file ? (
                  <>
                    <Check size={28} className="text-[#4ade80] mx-auto mb-2" />
                    <p className="text-sm text-[#1A1A1A] font-semibold">{file.name}</p>
                    <p className="text-xs text-[#3D3A3A] mt-1">Toca para cambiar archivo</p>
                  </>
                ) : (
                  <>
                    <Upload size={28} className="text-[#8C6B6F] mx-auto mb-2" />
                    <p className="text-sm text-[#1A1A1A] font-medium">Toca aquí para subir tu comprobante</p>
                    <p className="text-xs text-[#3D3A3A] mt-1">JPG, PNG o PDF</p>
                  </>
                )}
              </div>
              <button
                onClick={() => uploadProofMutation.mutate()}
                disabled={!file || uploadProofMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 transition-opacity disabled:opacity-40 text-sm tracking-wide uppercase"
              >
                {uploadProofMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                {uploadProofMutation.isPending ? "Enviando…" : "Enviar comprobante"}
              </button>
            </div>
          )}

          {/* ── Step 5: Done ── */}
          {step === "done" && (
            <div className="rounded-2xl border border-[#4ade80]/20 bg-[#4ade80]/5 p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#4ade80]/20 to-[#4ade80]/5 border border-[#4ade80]/30 flex items-center justify-center mx-auto">
                <CheckCircle size={30} className="text-[#4ade80]" />
              </div>
              <h2 className="text-xl font-bold text-[#1A1A1A]">¡Comprobante recibido!</h2>
              <p className="text-sm text-[#1A1A1A]/45 max-w-xs mx-auto">Verificaremos tu pago en breve. Recibirás una notificación cuando tu membresía esté activa.</p>
              <button onClick={() => window.location.replace("/app")} className="mt-2 px-6 py-2.5 rounded-xl text-sm font-semibold border border-[#8C6B6F]/20 text-[#1A1A1A]/70 hover:text-[#1A1A1A] hover:border-[#8C6B6F]/30 transition-all">
                Ir a mi panel
              </button>
            </div>
          )}
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default Checkout;
