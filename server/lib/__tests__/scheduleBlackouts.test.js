import { describe, expect, it } from "vitest";
import { isVillaMagnaSeptemberPilatesBlackout } from "../scheduleBlackouts.js";

describe("Villa Magna September 2026 Pilates blackout", () => {
  it("blocks Pilates throughout September in Villa Magna", () => {
    expect(isVillaMagnaSeptemberPilatesBlackout({
      branchCode: "villa-magna",
      date: "2026-09-01",
      classTypeName: "Pilates Mat",
      classTypeCategory: "pilates",
      apparatus: "reformer",
    })).toBe(true);
    expect(isVillaMagnaSeptemberPilatesBlackout({
      branchCode: "villa-magna",
      date: "2026-09-30",
      classTypeName: "Barre Studio",
      apparatus: "tower",
    })).toBe(true);
  });

  it("keeps Prenatal and Functional available", () => {
    expect(isVillaMagnaSeptemberPilatesBlackout({
      branchCode: "villa-magna",
      date: "2026-09-08",
      classTypeName: "Pilates Prenatal",
      classTypeCategory: "prenatal",
      apparatus: "reformer",
    })).toBe(false);
    expect(isVillaMagnaSeptemberPilatesBlackout({
      branchCode: "villa-magna",
      date: "2026-09-08",
      classTypeName: "Entrenamiento Funcional",
      classTypeCategory: "functional",
    })).toBe(false);
  });

  it("does not affect other branches or months", () => {
    const pilates = {
      classTypeName: "Pilates",
      classTypeCategory: "pilates",
      apparatus: "reformer",
    };
    expect(isVillaMagnaSeptemberPilatesBlackout({
      ...pilates,
      branchCode: "pozos",
      date: "2026-09-08",
    })).toBe(false);
    expect(isVillaMagnaSeptemberPilatesBlackout({
      ...pilates,
      branchCode: "villa-magna",
      date: "2026-08-31",
    })).toBe(false);
    expect(isVillaMagnaSeptemberPilatesBlackout({
      ...pilates,
      branchCode: "villa-magna",
      date: "2026-10-01",
    })).toBe(false);
  });
});
