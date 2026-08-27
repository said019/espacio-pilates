import { describe, expect, it } from "vitest";
import {
  extractBranchReference,
  isPackagePlan,
  isOrderVerifiableStatus,
  normalizeProgram,
  validateSingleScope,
} from "../branchAccess.js";

describe("multi-branch access helpers", () => {
  it("normalizes historical program names", () => {
    expect(normalizeProgram("reformer")).toBe("pilates");
    expect(normalizeProgram("funcional")).toBe("functional");
    expect(normalizeProgram("prenatal")).toBe("prenatal");
  });

  it("accepts every supported branch input spelling", () => {
    expect(extractBranchReference({ branchId: "a" })).toBe("a");
    expect(extractBranchReference({ branch_id: "b" })).toBe("b");
    expect(extractBranchReference({ branch: "pozos" })).toBe("pozos");
  });

  it("recognizes finite and unlimited packages", () => {
    expect(isPackagePlan({ plan_kind: "package", class_limit: null })).toBe(true);
    expect(isPackagePlan({ class_limit: 7 })).toBe(true);
    expect(isPackagePlan({ name: "Ilimitado", class_limit: null })).toBe(true);
    expect(isPackagePlan({ plan_kind: "registration", class_limit: 0 })).toBe(false);
  });

  it("allows only pending or already-approved orders through verification", () => {
    expect(isOrderVerifiableStatus("pending_payment")).toBe(true);
    expect(isOrderVerifiableStatus("pending_verification")).toBe(true);
    expect(isOrderVerifiableStatus("approved")).toBe(true);
    expect(isOrderVerifiableStatus("rejected")).toBe(false);
    expect(isOrderVerifiableStatus("cancelled")).toBe(false);
    expect(isOrderVerifiableStatus("expired")).toBe(false);
  });

  it("rejects mixed-branch and mixed-program carts", () => {
    expect(validateSingleScope([
      { branch_id: "vm", program: "pilates" },
      { branch_id: "pozos", program: "pilates" },
    ])).toMatchObject({ valid: false, code: "MIXED_BRANCH_CART" });
    expect(validateSingleScope([
      { branch_id: "pozos", program: "pilates" },
      { branch_id: "pozos", program: "functional" },
    ])).toMatchObject({ valid: false, code: "MIXED_PROGRAM_CART" });
  });
});
