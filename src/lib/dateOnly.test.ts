import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDateOnly } from "./dateOnly";

describe("parseDateOnly", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Mexico_City"; });
  afterAll(() => { process.env.TZ = originalTz; });

  it("reproduce el error: new Date() muestra un día antes en México", () => {
    expect(new Date("2026-09-30T00:00:00.000Z").getDate()).toBe(29);
  });

  it("toma el día del calendario sin correrlo por la zona horaria", () => {
    for (const raw of ["2026-09-30T00:00:00.000Z", "2026-09-30"]) {
      const d = parseDateOnly(raw)!;
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 30]);
    }
  });

  it("regresa null si no es una fecha", () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly("sin fecha")).toBeNull();
  });
});
