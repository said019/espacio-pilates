import { describe, expect, it } from "vitest";
import {
  extractMemberships,
  getEntityBranchCode,
  getEntityBranchName,
  getEntityProgram,
  matchesBranch,
  type BranchOption,
} from "./useBranch";

const villaMagna: BranchOption = {
  id: "vm-id",
  code: "villa-magna",
  name: "Villa Magna",
  address: null,
  isActive: true,
};

const pozos: BranchOption = {
  id: "pozos-id",
  code: "pozos",
  name: "Pozos",
  address: null,
  isActive: true,
};

describe("multi-branch client helpers", () => {
  it("normalizes branch and program fields from camel and snake case responses", () => {
    expect(getEntityBranchCode({ branch_code: "pozos" })).toBe("pozos");
    expect(getEntityBranchCode({ branchName: "Villa Magna" })).toBe("villa-magna");
    expect(getEntityProgram({ class_category: "funcional" })).toBe("functional");
    expect(getEntityProgram({ program: "prenatal" })).toBe("prenatal");
  });

  it("treats legacy unscoped records as Villa Magna unless explicitly universal", () => {
    expect(matchesBranch({}, villaMagna)).toBe(true);
    expect(matchesBranch({}, pozos)).toBe(false);
    expect(matchesBranch({}, pozos, "universal")).toBe(true);
    expect(matchesBranch({ branch_id: "pozos-id" }, pozos)).toBe(true);
  });

  it("uses immutable branch snapshots when rendering historical orders", () => {
    expect(getEntityBranchName({ branch_snapshot_name: "Pozos (2026)" })).toBe("Pozos (2026)");
  });

  it("accepts both the legacy primary membership and the new collection", () => {
    const memberships = extractMemberships({
      data: { id: "pilates", program: "pilates" },
      memberships: [
        { id: "pilates", program: "pilates" },
        { id: "functional", program: "functional" },
      ],
    });

    expect(memberships.map((membership) => membership.id)).toEqual(["pilates", "functional"]);
  });
});
