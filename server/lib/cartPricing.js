// Cálculo puro de totales del carrito (sin red/DB) — testeable.
// Orden: el descuento del código aplica al subtotal de ítems (antes de inscripción);
// la inscripción se suma una sola vez; el 4% de tarjeta se calcula sobre el monto ya
// descontado (ítems − descuento + inscripción).
export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function computeCartTotals({ lineTotals = [], discount = 0, inscription = 0, isCard = false, feeRate = 0.04 }) {
  const itemsSubtotal = round2(lineTotals.reduce((a, b) => a + Number(b || 0), 0));
  const subtotal = round2(itemsSubtotal + Number(inscription || 0)); // lo que se guarda en orders.subtotal
  const afterDiscount = round2(subtotal - Number(discount || 0));
  const platformFee = isCard ? round2(afterDiscount * feeRate) : 0;
  const total = round2(afterDiscount + platformFee);
  return { itemsSubtotal, subtotal, platformFee, total };
}
