import { describe, it, expect } from "vitest";
import { resolveStampLayout, shouldRenderStampStrip, renderStampStripPng, STAMP_SOURCE_PATH } from "../walletStamps.js";
import sharp from "sharp";

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

describe("renderStampStripPng", () => {
  it("genera un PNG con las dimensiones exactas pedidas (tamaño Apple @3x)", async () => {
    const buf = await renderStampStripPng({ total: 9, remaining: 6, widthPx: 1125, heightPx: 369 });
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1125);
    expect(meta.height).toBe(369);
    expect(meta.hasAlpha).toBe(true);
  });

  it("genera un PNG con las dimensiones exactas pedidas (tamaño Google)", async () => {
    const buf = await renderStampStripPng({ total: 14, remaining: 9, widthPx: 1860, heightPx: 610 });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1860);
    expect(meta.height).toBe(610);
  });

  it("fondo transparente en la esquina (nada dibujado ahí)", async () => {
    const buf = await renderStampStripPng({ total: 7, remaining: 4, widthPx: 375, heightPx: 123 });
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    // Esquina superior-izquierda: RGBA, alpha (4to byte) debe ser 0.
    expect(data[3]).toBe(0);
  });

  it("total 0 (sin franja) devuelve un lienzo transparente sin lanzar", async () => {
    const buf = await renderStampStripPng({ total: 0, remaining: 0, widthPx: 375, heightPx: 123 });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(375);
    expect(meta.height).toBe(123);
  });

  it("STAMP_SOURCE_PATH apunta al asset real generado en la Tarea 1", async () => {
    const meta = await sharp(STAMP_SOURCE_PATH).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });
});
