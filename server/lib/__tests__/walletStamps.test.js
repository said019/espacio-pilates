import { describe, it, expect } from "vitest";
import { resolveStampLayout } from "../walletStamps.js";

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
