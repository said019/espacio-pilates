import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, ShieldCheck, XCircle, AlertTriangle } from "lucide-react";

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY as string | undefined;

// Carga el SDK de Mercado Pago v2 una sola vez (bajo demanda, solo en esta pantalla).
let sdkPromise: Promise<any> | null = null;
function loadMpSdk(): Promise<any> {
  if ((window as any).MercadoPago) return Promise.resolve((window as any).MercadoPago);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.mercadopago.com/js/v2";
    s.async = true;
    s.onload = () => resolve((window as any).MercadoPago);
    s.onerror = () => { sdkPromise = null; reject(new Error("No se pudo cargar Mercado Pago")); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

const CardPayment = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const brickRef = useRef<any>(null);
  const creatingRef = useRef(false);
  const [brickReady, setBrickReady] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}`)).data,
    enabled: !!orderId,
  });
  const order = data?.data ?? data;

  useEffect(() => {
    if (!order) return;
    if (order.status !== "pending_payment") {
      navigate("/app/orders", { replace: true });
      return;
    }
    if (!MP_PUBLIC_KEY) {
      setFatal("El pago con tarjeta no está disponible por ahora.");
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const MPClass = await loadMpSdk();
        if (cancelled) return;
        const container = document.getElementById("cardPaymentBrick_container");
        if (container) container.innerHTML = "";
        const mp = new MPClass(MP_PUBLIC_KEY, { locale: "es-MX" });
        const builder = mp.bricks();
        brickRef.current = await builder.create("cardPayment", "cardPaymentBrick_container", {
          initialization: { amount: Number(order.total_amount) },
          customization: {
            paymentMethods: { maxInstallments: 1 },
            visual: { hidePaymentButton: false },
          },
          callbacks: {
            onReady: () => setBrickReady(true),
            onSubmit: (formData: any) => {
              setRejected(null);
              return new Promise<void>((resolve) => {
                api
                  .post(`/orders/${orderId}/pay-card-token`, {
                    token: formData.token,
                    payment_method_id: formData.payment_method_id,
                    issuer_id: formData.issuer_id,
                    payer: formData.payer,
                  })
                  .then((res) => {
                    const r = res.data?.data ?? res.data;
                    if (r.status === "approved") {
                      toast({ title: "¡Pago aprobado! 💜", description: "Tu membresía ya está activa." });
                      navigate("/app/orders?checkout=success", { replace: true });
                    } else if (r.status === "pending") {
                      navigate("/app/orders?checkout=pending", { replace: true });
                    } else {
                      setRejected(r.message || "El pago fue rechazado. Intenta con otra tarjeta.");
                    }
                    resolve();
                  })
                  .catch((err) => {
                    toast({
                      title: "No se pudo procesar el pago",
                      description: err?.response?.data?.message || "Intenta de nuevo.",
                      variant: "destructive",
                    });
                    resolve();
                  });
              });
            },
            onError: (e: any) => console.error("MP Brick error:", e),
          },
        });
      } catch (e: any) {
        setFatal(e?.message || "No se pudo cargar el pago.");
      }
    })();

    return () => {
      cancelled = true;
      creatingRef.current = false;
      try { brickRef.current?.unmount?.(); } catch (_) { /* noop */ }
      brickRef.current = null;
    };
  }, [order, navigate, orderId, toast]);

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-xl mx-auto space-y-5">
          <Link to="/app/orders" className="inline-flex items-center gap-1.5 text-sm text-[#8C6B6F] no-underline hover:text-[#1A1A1A]">
            <ArrowLeft size={15} /> Mis órdenes
          </Link>

          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Pagar con tarjeta</h1>
            {order && (
              <p className="text-sm text-[#3D3A3A] mt-1">
                {order.plan_name} · <span className="font-semibold">${Number(order.total_amount).toLocaleString("es-MX")} MXN</span>
              </p>
            )}
          </div>

          {fatal ? (
            <div className="rounded-xl border border-[#E2B7B0] bg-[#F3DEDA] px-4 py-3 text-sm text-[#A8473F] flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" /> {fatal}
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-[#E2B7B0] bg-[#F3DEDA] px-4 py-3 text-sm text-[#A8473F]">
              No se encontró la orden. <Link to="/app/orders" className="underline">Volver</Link>
            </div>
          ) : (
            <>
              {rejected && (
                <div className="rounded-xl border border-[#E2B7B0] bg-[#F3DEDA] px-4 py-3 text-sm text-[#A8473F] flex items-center gap-2">
                  <XCircle size={16} className="shrink-0" /> {rejected}
                </div>
              )}

              {(isLoading || !brickReady) && !fatal && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#8C6B6F]">
                  <Loader2 size={16} className="animate-spin" /> Cargando pago seguro…
                </div>
              )}

              <div id="cardPaymentBrick_container" />

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#8C6B6F]/80">
                <ShieldCheck size={13} /> Pago protegido por Mercado Pago. Tu tarjeta nunca pasa por nuestros servidores.
              </p>
            </>
          )}
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default CardPayment;
