import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Clock, CheckCircle, XCircle, AlertTriangle, ShoppingBag } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  pending_payment:      { label: "Subir comprobante",  icon: Upload,        className: "border-amber-500/50 text-amber-700 bg-amber-50" },
  pending_verification: { label: "En revisión",        icon: Clock,         className: "border-blue-500/50 text-blue-700 bg-blue-50" },
  approved:             { label: "Aprobada",           icon: CheckCircle,   className: "border-green-500/50 text-green-700 bg-green-50" },
  rejected:             { label: "Rechazada",          icon: XCircle,       className: "border-red-500/50 text-red-700 bg-red-50" },
  expired:              { label: "Expirada",           icon: AlertTriangle, className: "border-gray-400/50 text-gray-500 bg-gray-50" },
  cancelled:            { label: "Cancelada",          icon: XCircle,       className: "border-gray-400/50 text-gray-500 bg-gray-50" },
};

const MyOrders = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders")).data,
  });

  const orders: any[] = Array.isArray(data?.data) ? data.data : [];

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
                        <p className="font-semibold text-sm text-[#1A1A1A]">{o.plan_name}</p>
                        <p className="text-xs text-[#3D3A3A]">
                          ${Number(o.total_amount).toLocaleString("es-MX")} MXN
                          {" · "}
                          {o.payment_method === "cash" ? "Efectivo" : o.payment_method === "transfer" ? "Transferencia" : o.payment_method}
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
                      <Button asChild size="sm" className="mt-3 w-full sm:w-auto">
                        <Link to={`/app/checkout?orderId=${o.id}`}>
                          <Upload size={14} className="mr-2" />Subir comprobante
                        </Link>
                      </Button>
                    )}

                    {o.status === "pending_verification" && (
                      <p className="text-xs text-blue-700 mt-3 bg-blue-50 rounded-lg px-3 py-2">
                        {o.payment_method === "cash"
                          ? "Acércate a recepción para completar tu pago."
                          : "Tu comprobante está siendo revisado. Te notificaremos cuando se apruebe."}
                      </p>
                    )}

                    {o.status === "rejected" && o.rejection_reason && (
                      <p className="text-xs text-red-700 mt-3 bg-red-50 rounded-lg px-3 py-2">
                        Motivo: {o.rejection_reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default MyOrders;
