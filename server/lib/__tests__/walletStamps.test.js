import { describe, it, expect } from "vitest";
import { resolveStampLayout, shouldRenderStampStrip } from "../walletStamps.js";

describe("resolveStampLayout", () => {
  it("total 0 o negativo → sin filas", () => {
    expect(resolveStampLayout(0)).toEqual([]);
    expect(resolveStampLayout(-3)).toEqual([]);
  });
  it("total ≤ 7 → una sola fila", () => {
    expect(resolveStampLayout(1)).toEqual([1]);
    expect(resolveStampLayout(7)).toEqual([7]);
  });
  it("total 9 → 5 arriba, 4 abajo", () => {
    expect(resolveStampLayout(9)).toEqual([5, 4]);
  });
  it("total 14 → 7 arriba, 7 abajo", () => {
    expect(resolveStampLayout(14)).toEqual([7, 7]);
  });
  it("total 8 → se parte parejo (4 y 4)", () => {
    expect(resolveStampLayout(8)).toEqual([4, 4]);
  });
  it("total 20 (paquete futuro hipotético) → se acomoda solo (10 y 10)", () => {
    expect(resolveStampLayout(20)).toEqual([10, 10]);
  });
});

describe("shouldRenderStampStrip", () => {
  const base = { hasMembership: true, isUnlimited: false, hasEventPass: false, classLimit: 7 };

  it("paquete real (7/9/14 clases) → sí", () => {
    expect(shouldRenderStampStrip({ ...base, classLimit: 7 })).toBe(true);
    expect(shouldRenderStampStrip({ ...base, classLimit: 9 })).toBe(true);
    expect(shouldRenderStampStrip({ ...base, classLimit: 14 })).toBe(true);
  });
  it("Clase Extra / Suelta (1 clase) → no", () => {
    expect(shouldRenderStampStrip({ ...base, classLimit: 1 })).toBe(false);
  });
  it("sin membresía → no", () => {
    expect(shouldRenderStampStrip({ ...base, hasMembership: false })).toBe(false);
  });
  it("membresía ilimitada → no", () => {
    expect(shouldRenderStampStrip({ ...base, isUnlimited: true })).toBe(false);
  });
  it("pase de evento → no", () => {
    expect(shouldRenderStampStrip({ ...base, hasEventPass: true })).toBe(false);
  });
});
