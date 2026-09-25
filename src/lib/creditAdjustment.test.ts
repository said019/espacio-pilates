import { describe, expect, it } from "vitest";
import { creditAdjustment } from "./creditAdjustment";

describe("creditAdjustment", () => {
  it("manda la diferencia para no pisar créditos usados mientras el diálogo estaba abierto", () => {
    expect(creditAdjustment(0, 1)).toEqual({ mode: "add", value: 1 });
    expect(creditAdjustment(5, 3)).toEqual({ mode: "subtract", value: 2 });
  });

  it("sin cambio no hay nada que guardar", () => {
    expect(creditAdjustment(4, 4)).toBeNull();
  });

  it("trata créditos desconocidos como 0", () => {
    expect(creditAdjustment(null, 2)).toEqual({ mode: "add", value: 2 });
  });
});
