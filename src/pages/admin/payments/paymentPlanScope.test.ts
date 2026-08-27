import { describe, expect, it } from "vitest";
import { groupPaymentPlans, isAssignablePaymentPlan } from "./paymentPlanScope";

describe("admin payment plan scope", () => {
  it("shows both Pozos registrations and keeps them separate from packages", () => {
    const plans = [
      { id: "pilates-registration", program: "pilates", planKind: "registration", isActive: true },
      { id: "functional-registration", program: "functional", planKind: "registration", isActive: true },
      { id: "functional-7", program: "functional", planKind: "package", isActive: true },
      { id: "pilates-7", program: "pilates", planKind: "package", isActive: true },
    ];

    const groups = groupPaymentPlans(plans);

    expect(groups.registration.map((plan) => plan.id)).toEqual([
      "pilates-registration",
      "functional-registration",
    ]);
    expect(groups.functional.map((plan) => plan.id)).toEqual(["functional-7"]);
    expect(groups.pilates.map((plan) => plan.id)).toEqual(["pilates-7"]);
  });

  it("hides inactive and internal plans without hiding registrations", () => {
    expect(isAssignablePaymentPlan({ planKind: "registration", isActive: true })).toBe(true);
    expect(isAssignablePaymentPlan({ planKind: "internal", isActive: true })).toBe(false);
    expect(isAssignablePaymentPlan({ planKind: "package", isActive: false })).toBe(false);
  });
});
