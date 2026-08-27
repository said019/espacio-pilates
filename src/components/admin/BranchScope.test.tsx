import { describe, expect, it } from "vitest";
import type { Branch } from "@/types/branch";
import { ALL_BRANCHES, branchNameFromRow, branchQueryParams } from "./BranchScope";

const branches: Branch[] = [
  {
    id: "branch-villa-magna",
    code: "villa-magna",
    name: "Villa Magna",
    address: null,
    is_active: true,
    sort_order: 1,
  },
  {
    id: "branch-pozos",
    code: "pozos",
    name: "Pozos",
    address: null,
    is_active: true,
    sort_order: 2,
  },
];

describe("admin branch scope helpers", () => {
  it("requests every branch explicitly instead of falling back to Villa Magna", () => {
    expect(branchQueryParams(ALL_BRANCHES)).toEqual({ all_branches: true });
  });

  it("scopes branch reads to the selected branch id", () => {
    expect(branchQueryParams("branch-pozos")).toEqual({ branch_id: "branch-pozos" });
  });

  it("resolves branch labels from normalized or snake-case rows", () => {
    expect(branchNameFromRow({ branchName: "Pozos" }, branches)).toBe("Pozos");
    expect(branchNameFromRow({ branch_id: "branch-villa-magna" }, branches)).toBe("Villa Magna");
    expect(branchNameFromRow({}, branches)).toBe("Sucursal sin asignar");
  });
});
