import { describe, expect, it } from "vitest";
import { isRegistrationPlan, registrationBlockReason } from "./registrationPlan";

describe("standalone registration", () => {
  it("recognizes explicit and legacy registration plans", () => {
    expect(isRegistrationPlan({ planKind: "registration", name: "Alta" })).toBe(true);
    expect(isRegistrationPlan({ plan_kind: "registration" })).toBe(true);
    expect(isRegistrationPlan({ name: "Inscripción Funcional" })).toBe(true);
    expect(isRegistrationPlan({ name: "Paquete 7 Clases" })).toBe(false);
  });
  it("allows an unpaid registration without a pending package", () => {
    expect(registrationBlockReason(true, { needsInscription: true, hasPendingPackage: false })).toBeUndefined();
  });
  it("blocks unknown or stale branch/program status", () => {
    expect(registrationBlockReason(false, { needsInscription: true })).toBeTruthy();
  });
  it("blocks paid registrations and enrollment included in pending packages", () => {
    expect(registrationBlockReason(true, { needsInscription: false })).toContain("Ya estás inscrita");
    expect(registrationBlockReason(true, { needsInscription: true, hasPendingPackage: true })).toContain("pendiente");
  });
});
