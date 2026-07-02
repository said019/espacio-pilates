import { describe, it, expect } from "vitest";
import { buildReceiptModel, PAYMENT_METHOD_LABELS } from "../receipt.js";

describe("buildReceiptModel", () => {
  it("orden simple por transferencia: solo Subtotal en el desglose", () => {
    const m = buildReceiptModel({
      orderNumber: "ORD-001",
      items: [{ planName: "Paquete 9 Clases", quantity: 1, lineTotal: 1050 }],
      total: 1050,
      paymentMethod: "transfer",
    });
    expect(m.lines).toEqual([{ planName: "Paquete 9 Clases", quantity: 1, amount: 1050 }]);
    expect(m.breakdown).toEqual([{ label: "Subtotal", amount: 1050 }]);
    expect(m.total).toBe(1050);
    expect(m.methodLabel).toBe("Transferencia");
    expect(m.orderNumber).toBe("ORD-001");
  });

  it("carrito con inscripción, descuento y 4% tarjeta: filas condicionales en orden", () => {
    const m = buildReceiptModel({
      items: [
        { planName: "Paquete 9 Clases", quantity: 1, lineTotal: 1050 },
        { planName: "Clase Extra", quantity: 3, lineTotal: 390 },
      ],
      inscriptionAmount: 500,
      discountAmount: 100,
      platformFee: 73.6,
      total: 1913.6,
      paymentMethod: "card",
    });
    expect(m.breakdown.map((b) => b.label)).toEqual([
      "Subtotal",
      "Inscripción (pago único)",
      "Descuento",
      "Uso de plataforma (4% tarjeta)",
    ]);
    expect(m.breakdown[0].amount).toBe(1440); // 1050 + 390
    expect(m.breakdown[2].negative).toBe(true); // el descuento resta
    expect(m.methodLabel).toBe("Tarjeta");
    // Consistencia: subtotal + inscripción − descuento + fee = total
    expect(1440 + 500 - 100 + 73.6).toBeCloseTo(m.total, 2);
  });

  it("montos en cero NO agregan filas al desglose", () => {
    const m = buildReceiptModel({
      items: [{ planName: "Clase Suelta / Visita", quantity: 1, lineTotal: 250 }],
      total: 250,
      paymentMethod: "cash",
    });
    expect(m.breakdown).toHaveLength(1);
    expect(m.methodLabel).toBe("Efectivo");
  });

  it("método desconocido cae al string crudo; items vacíos no truenan", () => {
    const m = buildReceiptModel({ items: [], total: 0, paymentMethod: "oxxo" });
    expect(m.methodLabel).toBe("oxxo");
    expect(m.lines).toEqual([]);
    expect(m.breakdown[0]).toEqual({ label: "Subtotal", amount: 0 });
  });

  it("quantity y line_total llegan como strings de la BD y se normalizan a número", () => {
    const m = buildReceiptModel({
      items: [{ planName: "Clase Extra", quantity: "3", lineTotal: "390.00" }],
      total: 390,
      paymentMethod: "transfer",
    });
    expect(m.lines[0]).toEqual({ planName: "Clase Extra", quantity: 3, amount: 390 });
  });

  it("expone la nota de 'no es CFDI' y las etiquetas de método", () => {
    const m = buildReceiptModel({ items: [], total: 0, paymentMethod: "card" });
    expect(m.note).toMatch(/No es un comprobante fiscal \(CFDI\)/);
    expect(PAYMENT_METHOD_LABELS.transfer).toBe("Transferencia");
  });
});
