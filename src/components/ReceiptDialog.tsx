/**
 * Diálogo imprimible del comprobante de pago (constancia informal, NO CFDI).
 * Compartido por: Mis órdenes (clienta) y Pagos → Historial (admin).
 * Espera la fila de la orden con campos snake_case: order_number, paid_at,
 * created_at, items, plan_name, subtotal, inscription_amount, discount_amount,
 * platform_fee, total_amount, payment_method.
 */
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const ReceiptDialog = ({ order, onClose }: { order: any | null; onClose: () => void }) => (
  <Dialog open={!!order} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="max-w-md">
      <style>{`@media print {
        /* Quitar TODA la app del flujo de impresión. Antes se usaba visibility:hidden,
           que oculta pero CONSERVA la altura → imprimía la página completa del admin
           en 6 hojas en blanco. display:none la elimina del flujo → 1 sola hoja. El
           recibo vive en el portal de Radix (hermano de #root en <body>), no dentro. */
        #root { display: none !important; }
        body * { visibility: hidden; }
        .receipt-print, .receipt-print * { visibility: visible; }
        /* El diálogo (portal) pasa a flujo normal para definir la(s) página(s) del recibo. */
        [role="dialog"] { position: static !important; transform: none !important; max-height: none !important; max-width: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; }
        .receipt-print { position: static !important; width: 100%; }
      }`}</style>
      {order && (
        <div className="receipt-print space-y-4">
          <DialogHeader>
            <DialogTitle>Comprobante de pago</DialogTitle>
          </DialogHeader>
          <div className="text-center space-y-0.5">
            <p className="font-semibold text-[#1A1A1A]">Tu Espacio Pilates · Villa Magna</p>
            {(order.user_name || order.userName || order.guest_name) && (
              <p className="text-sm text-[#1A1A1A]">A nombre de: <span className="font-medium">{order.user_name || order.userName || order.guest_name}</span></p>
            )}
            {order.order_number && (
              <p className="text-xs font-mono text-[#8C6B6F]">Folio {order.order_number}</p>
            )}
            <p className="text-xs text-[#3D3A3A]">
              {format(new Date(order.paid_at || order.updated_at || order.created_at), "d MMM yyyy · HH:mm", { locale: es })}
            </p>
          </div>
          <div className="rounded-lg border border-[#F0D0D5] divide-y divide-[#F0D0D5] text-sm">
            {(Array.isArray(order.items) && order.items.length
              ? order.items.map((it: any) => ({
                  label: `${it.plan_name}${Number(it.quantity) > 1 ? ` × ${it.quantity}` : ""}`,
                  amount: Number(it.line_total),
                }))
              : [{
                  label: order.plan_name,
                  amount: Number(order.subtotal) - Number(order.inscription_amount || 0),
                }]
            ).map((l, i) => (
              <div key={i} className="flex justify-between px-3 py-2">
                <span className="text-[#3D3A3A]">{l.label}</span>
                <span className="tabular-nums">${l.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
            {Number(order.inscription_amount) > 0 && (
              <div className="flex justify-between px-3 py-2">
                <span className="text-[#3D3A3A]">Inscripción (pago único)</span>
                <span className="tabular-nums">${Number(order.inscription_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between px-3 py-2">
                <span className="text-[#3D3A3A]">Descuento</span>
                <span className="tabular-nums">−${Number(order.discount_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {Number(order.platform_fee) > 0 && (
              <div className="flex justify-between px-3 py-2">
                <span className="text-[#3D3A3A]">Uso de plataforma (4% tarjeta)</span>
                <span className="tabular-nums">${Number(order.platform_fee).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between px-3 py-2 font-semibold">
              <span>
                Total pagado ({order.payment_method === "cash" ? "Efectivo" : order.payment_method === "transfer" ? "Transferencia" : order.payment_method === "card" ? "Tarjeta" : order.payment_method})
              </span>
              <span className="tabular-nums">${Number(order.total_amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN</span>
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
);
