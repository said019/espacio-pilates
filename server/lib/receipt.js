// Armado puro del comprobante de pago (sin red/DB) — testeable.
// items: [{ planName, quantity, lineTotal }]. El caller resuelve el fallback de
// órdenes viejas sin order_plan_items (1 renglón con el plan principal).
import { round2 } from "./cartPricing.js";

export const PAYMENT_METHOD_LABELS = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
};

export function buildReceiptModel({
  orderNumber = null,
  paidAt = null,
  items = [],
  inscriptionAmount = 0,
  discountAmount = 0,
  platformFee = 0,
  total = 0,
  paymentMethod = "",
} = {}) {
  const lines = items.map((it) => ({
    planName: String(it.planName || "Plan"),
    quantity: Math.max(1, Number(it.quantity) || 1),
    amount: round2(it.lineTotal),
  }));
  const itemsSubtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const breakdown = [{ label: "Subtotal", amount: itemsSubtotal }];
  if (Number(inscriptionAmount) > 0) breakdown.push({ label: "Inscripción (pago único)", amount: round2(inscriptionAmount) });
  if (Number(discountAmount) > 0) breakdown.push({ label: "Descuento", amount: round2(discountAmount), negative: true });
  if (Number(platformFee) > 0) breakdown.push({ label: "Uso de plataforma (4% tarjeta)", amount: round2(platformFee) });
  return {
    orderNumber,
    paidAt,
    lines,
    breakdown,
    total: round2(total),
    methodLabel: PAYMENT_METHOD_LABELS[paymentMethod] || String(paymentMethod || "—"),
    note: "Este comprobante es una constancia de pago emitida por Tu Espacio Pilates. No es un comprobante fiscal (CFDI).",
  };
}
