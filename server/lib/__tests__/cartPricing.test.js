import { describe, it, expect } from "vitest";
import { computeCartTotals, round2 } from "../cartPricing.js";

describe("computeCartTotals", () => {
  it("suma renglones e inscripción en el subtotal", () => {
    const r = computeCartTotals({ lineTotals: [880, 130, 130], inscription: 500 });
    expect(r.itemsSubtotal).toBe(1140);
    expect(r.subtotal).toBe(1640);
    expect(r.platformFee).toBe(0);
    expect(r.total).toBe(1640);
  });

  it("aplica descuento antes de la inscripción (sobre el total a cobrar) y sin recargo en transferencia", () => {
    // 1 paquete 880 + 2 clases extra 130 = 1140; -100 código; +500 inscripción = 1540
    const r = computeCartTotals({ lineTotals: [880, 130, 130], discount: 100, inscription: 500, isCard: false });
    expect(r.total).toBe(1540);
    expect(r.platformFee).toBe(0);
  });

  it("tarjeta agrega 4% sobre (ítems − descuento + inscripción)", () => {
    // (1140 - 100 + 500) = 1540 → +4% = 61.6 → 1601.6
    const r = computeCartTotals({ lineTotals: [880, 130, 130], discount: 100, inscription: 500, isCard: true });
    expect(r.platformFee).toBe(61.6);
    expect(r.total).toBe(1601.6);
  });

  it("sin inscripción ni descuento, tarjeta = 4% del subtotal de ítems", () => {
    const r = computeCartTotals({ lineTotals: [130, 130], isCard: true });
    expect(r.subtotal).toBe(260);
    expect(r.platformFee).toBe(10.4);
    expect(r.total).toBe(270.4);
  });

  it("round2 redondea a centavos", () => {
    expect(round2(61.599999)).toBe(61.6);
  });
});
