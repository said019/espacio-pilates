import { describe, expect, it } from "vitest";
import {
  compatibleMembershipCategoriesForClass,
  isMembershipCategoryCompatible,
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
  });
});
