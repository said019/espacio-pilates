import { describe, expect, it } from "vitest";
import { manualClassTypesForBranch } from "./classTypeOptions";

const types = [
  { id: "pilates", name: "Pilates", category: "pilates" },
  { id: "functional", name: "Functional", category: "funcional" },
  { id: "prenatal", name: "Prenatal", category: "prenatal" },
];

describe("manual class type options by branch", () => {
  it("offers Pilates and Functional when an admin creates classes in Pozos", () => {
    expect(manualClassTypesForBranch(types, "pozos").map((type) => type.id))
      .toEqual(["pilates", "functional", "prenatal"]);
  });

  it("keeps the existing non-Functional catalog in Villa Magna", () => {
    expect(manualClassTypesForBranch(types, "villa-magna").map((type) => type.id))
      .toEqual(["pilates", "prenatal"]);
  });
});
