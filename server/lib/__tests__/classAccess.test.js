import { describe, expect, it } from "vitest";
import {
  compatibleMembershipCategoriesForClass,
  isMembershipCategoryCompatible,
  membershipCanBookClass,
  membershipIsEligibleForClass,
  normalizeClassCategory,
} from "../classAccess.js";

describe("Prenatal class access", () => {
  it("allows the Prenatal membership to book Prenatal classes", () => {
    expect(isMembershipCategoryCompatible("prenatal", "prenatal")).toBe(true);
  });

  it("does not let the Prenatal membership enter regular studio classes", () => {
    expect(isMembershipCategoryCompatible("prenatal", "pilates")).toBe(false);
    expect(isMembershipCategoryCompatible("prenatal", "all")).toBe(false);
  });

  it("does not let regular or all-access memberships enter Prenatal", () => {
    expect(isMembershipCategoryCompatible("pilates", "prenatal")).toBe(false);
    expect(isMembershipCategoryCompatible("all", "prenatal")).toBe(false);
    expect(isMembershipCategoryCompatible("mixto", "prenatal")).toBe(false);
  });

  it("selects only Prenatal memberships for a Prenatal class", () => {
    expect(compatibleMembershipCategoriesForClass("prenatal")).toEqual(["prenatal"]);
  });

  it("preserves the legacy Pilates to Reformer alias", () => {
    expect(normalizeClassCategory("pilates")).toBe("reformer");
    expect(compatibleMembershipCategoriesForClass("pilates")).toEqual([
      "reformer",
      "pilates",
      "all",
      "mixto",
    ]);
  });
});

describe("branch and program membership scope", () => {
  const villaMagnaId = "11111111-1111-4111-8111-111111111111";
  const pozosId = "22222222-2222-4222-8222-222222222222";

  it("allows a Pilates membership only for Pilates at the same branch", () => {
    expect(membershipCanBookClass(
      { branch_id: pozosId, program: "pilates", class_category: "pilates" },
      { branch_id: pozosId, class_category: "reformer" },
    )).toBe(true);
  });

  it("allows a Functional membership for Functional at Pozos", () => {
    expect(membershipCanBookClass(
      { branch_id: pozosId, program: "functional", class_category: "functional" },
      { branch_id: pozosId, class_category: "funcional" },
    )).toBe(true);
  });

  it("rejects a Villa Magna membership for a Pozos class", () => {
    expect(membershipCanBookClass(
      { branch_id: villaMagnaId, program: "pilates", class_category: "pilates" },
      { branch_id: pozosId, class_category: "pilates" },
    )).toBe(false);
  });

  it("rejects a Pozos Pilates membership for a Pozos Functional class", () => {
    expect(membershipCanBookClass(
      { branch_id: pozosId, program: "pilates", class_category: "all" },
      { branch_id: pozosId, class_category: "funcional" },
    )).toBe(false);
  });

  it("rejects a Pozos Functional membership for a Pozos Pilates class", () => {
    expect(membershipCanBookClass(
      { branch_id: pozosId, program: "functional", class_category: "all" },
      { branch_id: pozosId, class_category: "pilates" },
    )).toBe(false);
  });

  it("rejects another client's membership even when branch and program match", () => {
    expect(membershipIsEligibleForClass(
      {
        user_id: "client-b",
        branch_id: pozosId,
        program: "pilates",
        class_category: "pilates",
        status: "active",
        end_date: "2099-12-31",
        classes_remaining: 7,
      },
      { branch_id: pozosId, class_category: "pilates", date: "2099-09-02" },
      "client-a",
    )).toBe(false);
  });

  it("never treats a registration record as class access", () => {
    expect(membershipCanBookClass(
      {
        branch_id: pozosId,
        program: "pilates",
        class_category: "pilates",
        plan_kind: "registration",
      },
      { branch_id: pozosId, class_category: "pilates" },
    )).toBe(false);
  });

  it("does not promote an inactive, expired, or exhausted waitlist membership", () => {
    const classInfo = { branch_id: pozosId, class_category: "funcional", date: "2099-09-02" };
    const baseMembership = {
      user_id: "client-a",
      branch_id: pozosId,
      program: "functional",
      class_category: "funcional",
      status: "active",
      end_date: "2099-09-30",
      classes_remaining: 1,
    };

    expect(membershipIsEligibleForClass(baseMembership, classInfo, "client-a")).toBe(true);
    expect(membershipIsEligibleForClass(
      { ...baseMembership, status: "cancelled" }, classInfo, "client-a",
    )).toBe(false);
    expect(membershipIsEligibleForClass(
      { ...baseMembership, end_date: "2099-09-01" }, classInfo, "client-a",
    )).toBe(false);
    expect(membershipIsEligibleForClass(
      { ...baseMembership, start_date: "2099-09-03" }, classInfo, "client-a",
    )).toBe(false);
    expect(membershipIsEligibleForClass(
      { ...baseMembership, classes_remaining: 0 }, classInfo, "client-a",
    )).toBe(false);
  });
});
