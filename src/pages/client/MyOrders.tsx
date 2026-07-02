import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Upload, Clock, CheckCircle, XCircle, AlertTriangle, ShoppingBag, CreditCard, Loader2, Ban, FileText, Printer } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  pending_payment:      { label: "Pendiente de pago",  icon: Clock,         className: "border-[#E5CF9F] text-[#B5832F] bg-[#F4EAD6]" },
  pending_verification: { label: "En revisión",        icon: Clock,         className: "border-[#CCCFD6] text-[#6B7480] bg-[#E6E8EC]" },
  approved:             { label: "Aprobada",           icon: CheckCircle,   className: "border-[#CFD4B6] text-[#6E7F4F] bg-[#ECEEDF]" },
  rejected:             { label: "Rechazada",          icon: XCircle,       className: "border-[#E2B7B0] text-[#A8473F] bg-[#F3DEDA]" },
  expired:              { label: "Expirada",           icon: AlertTriangle, className: "border-gray-400/50 text-gray-500 bg-gray-50" },
  cancelled:            { label: "Cancelada",          icon: XCircle,       className: "border-gray-400/50 text-gray-500 bg-gray-50" },
};

const MyOrders = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const checkoutResult = params.get("checkout"); // 'success' | 'failure' | 'pending' | null
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders")).data,
    refetchInterval: (query) => {
      const rows: any[] = Array.isArray((query.state.data as any)?.data) ? (query.state.data as any).data : [];
      const waitingCard = rows.some(
        (o) => o.payment_method === "card" && o.status === "pending_payment"
      );
      return checkoutResult === "success" && waitingCard ? 3000 : false;
    },
  });

  const orders: any[] = Array.isArray(data?.data) ? data.data : [];

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => (await api.post(`/orders/${orderId}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      toast({ title: "Orden cancelada" });
    },
    onError: (err: any) =>
      toast({ title: "No se pudo cancelar", description: err?.response?.data?.message, variant: "destructive" }),
  });

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-[#1A1A1A]">Mis órdenes</h1>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/checkout"><ShoppingBag size={14} className="mr-2" />Nueva orden</Link>
            </Button>
          </div>

          {checkoutResult === "success" && (
            <div className="rounded-xl border border-[#CCCFD6] bg-[#E6E8EC] px-4 py-3 text-sm text-[#6B7480] flex items-center gap-2">
              <Loader2 size={15} className="animate-spin shrink-0" />
              Estamos confirmando tu pago con el banco. Tu membresía se activará en cuanto se acredite (puede tardar unos segundos).
            </div>
          )}
          {checkoutResult === "failure" && (
            <div className="rounded-xl border border-[#E2B7B0] bg-[#F3DEDA] px-4 py-3 text-sm text-[#A8473F]">
              El pago no se completó. Puedes reintentar desde la orden pendiente.
            </div>
          )}
          {checkoutResult === "pending" && (
            <div className="rounded-xl border border-[#E5CF9F] bg-[#F4EAD6] px-4 py-3 text-sm text-[#B5832F]">
              Tu pago quedó en proceso. Te avisaremos cuando se confirme.
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <ShoppingBag size={40} className="mx-auto text-[#8C6B6F]/30" />
              <p className="text-sm text-[#3D3A3A]">No tienes órdenes aún</p>
              <Button asChild size="sm">
                <Link to="/app/checkout">Adquirir membresía</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.cancelled;
                const Icon = cfg.icon;
                return (
                  <div
                    key={o.id}
                    className="rounded-xl border border-[#F0D0D5] bg-white p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <p className="font-semibold text-sm text-[#1A1A1A]">
                          {Array.isArray(o.items) && o.items.length > 1
                            ? `${o.items.length} artículos`
                            : o.plan_name}
                        </p>
                        {Array.isArray(o.items) && o.items.length > 1 && (
                          <ul className="text-[11px] text-[#3D3A3A] mt-0.5 space-y-0.5">
                            {o.items.map((it: any, i: number) => (
                              <li key={i}>• {it.plan_name} × {it.quantity}</li>
                            ))}
                          </ul>
                        )}
                        <p className="text-xs text-[#3D3A3A]">
                          ${Number(o.total_amount).toLocaleString("es-MX")} MXN
                          {" · "}
                          {o.payment_method === "cash" ? "Efectivo" : o.payment_method === "transfer" ? "Transferencia" : o.payment_method === "card" ? "Tarjeta" : o.payment_method}
                        </p>
                        <p className="text-[11px] text-[#8C6B6F]">
                          {o.order_number && <span className="font-mono">{o.order_number} · </span>}
                          {o.created_at && format(new Date(o.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                        </p>
                      </div>
                      <Badge variant="outline" className={cfg.className}>
                        <Icon size={11} className="mr-1" />
                        {cfg.label}
                      </Badge>
                    </div>

                    {o.status === "pending_payment" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {o.payment_method === "card" ? (
                          <Button size="sm" onClick={() => navigate(`/app/pay/${o.id}`)}>
                            <CreditCard size={14} className="mr-2" />Reintentar pago
                          </Button>
                        ) : (
                          <Button asChild size="sm">
                            <Link to={`/app/checkout?orderId=${o.id}`}>
                              <Upload size={14} className="mr-2" />Subir comprobante
                            </Link>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelMutation.isPending && cancelMutation.variables === o.id}
                          onClick={() => {
                            if (window.confirm("¿Cancelar esta orden? No podrás reactivarla.")) {
                              cancelMutation.mutate(o.id);
                            }
                          }}
                        >
                          {cancelMutation.isPending && cancelMutation.variables === o.id
                            ? <Loader2 size={14} className="mr-2 animate-spin" />
                            : <Ban size={14} className="mr-2" />}
                          Cancelar
                        </Button>
                      </div>
                    )}

                    {o.status === "approved" && (
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={() => setReceiptOrder(o)}>
                          <FileText size={14} className="mr-2" />Ver comprobante
                        </Button>
                      </div>
                    )}

                    {o.status === "pending_verification" && (
                      <p className="text-xs text-[#6B7480] mt-3 bg-[#E6E8EC] rounded-lg px-3 py-2">
                        {o.payment_method === "cash"
                          ? "Acércate a recepción para completar tu pago."
                          : "Tu comprobante está siendo revisado. Te notificaremos cuando se apruebe."}
                      </p>
                    )}

                    {o.status === "rejected" && o.rejection_reason && (
                      <p className="text-xs text-[#A8473F] mt-3 bg-[#F3DEDA] rounded-lg px-3 py-2">
                        Motivo: {o.rejection_reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Comprobante de pago (vista imprimible) ── */}
          <Dialog open={!!receiptOrder} onOpenChange={(v) => !v && setReceiptOrder(null)}>
            <DialogContent className="max-w-md">
              <style>{`@media print { body * { visibility: hidden; } .receipt-print, .receipt-print * { visibility: visible; } .receipt-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
              {receiptOrder && (
                <div className="receipt-print space-y-4">
                  <DialogHeader>
                    <DialogTitle>Comprobante de pago</DialogTitle>
                  </DialogHeader>
                  <div className="text-center space-y-0.5">
                    <p className="font-semibold text-[#1A1A1A]">Tu Espacio Pilates · Villa Magna</p>
                    {receiptOrder.order_number && (
                      <p className="text-xs font-mono text-[#8C6B6F]">Folio {receiptOrder.order_number}</p>
                    )}
                    <p className="text-xs text-[#3D3A3A]">
                      {format(new Date(receiptOrder.paid_at || receiptOrder.updated_at || receiptOrder.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#F0D0D5] divide-y divide-[#F0D0D5] text-sm">
                    {(Array.isArray(receiptOrder.items) && receiptOrder.items.length
                      ? receiptOrder.items.map((it: any) => ({
                          label: `${it.plan_name}${Number(it.quantity) > 1 ? ` × ${it.quantity}` : ""}`,
                          amount: Number(it.line_total),
                        }))
                      : [{
                          label: receiptOrder.plan_name,
                          amount: Number(receiptOrder.subtotal) - Number(receiptOrder.inscription_amount || 0),
                        }]
                    ).map((l, i) => (
                      <div key={i} className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">{l.label}</span>
                        <span className="tabular-nums">${l.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    {Number(receiptOrder.inscription_amount) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Inscripción (pago único)</span>
                        <span className="tabular-nums">${Number(receiptOrder.inscription_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {Number(receiptOrder.discount_amount) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Descuento</span>
                        <span className="tabular-nums">−${Number(receiptOrder.discount_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {Number(receiptOrder.platform_fee) > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-[#3D3A3A]">Uso de plataforma (4% tarjeta)</span>
                        <span className="tabular-nums">${Number(receiptOrder.platform_fee).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between px-3 py-2 font-semibold">
                      <span>
                        Total pagado ({receiptOrder.payment_method === "cash" ? "Efectivo" : receiptOrder.payment_method === "transfer" ? "Transferencia" : "Tarjeta"})
                      </span>
                      <span className="tabular-nums">${Number(receiptOrder.total_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-[#8C6B6F] leading-snug">
                    Este comprobante es una constancia de pago emitida por Tu Espacio Pilates. No es un comprobante fiscal (CFDI).
                  </p>
                  <Button size="sm" className="w-full print:hidden" onClick={() => window.print()}>
                    <Printer size={14} className="mr-2" />Imprimir / Guardar PDF
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default MyOrders;
