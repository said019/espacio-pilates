import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  effectiveWalkInAmount,
  isAdminOnlyPlan,
  isComplimentaryWalkInPlan,
  isPublicComplimentaryWalkInPlan,
} from "../walkIn.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(testDirectory, "../../index.js"), "utf8");

describe("walk-in gratuito", () => {
  const freeInternalPlan = {
    plan_kind: "internal",
    is_admin_only: true,
    price: "0.00",
  };

  it("la administración decide si el walk-in es público o privado", () => {
    expect(isAdminOnlyPlan("internal", false)).toBe(false);
    expect(isAdminOnlyPlan("internal", true)).toBe(true);
    expect(isAdminOnlyPlan("single", false)).toBe(false);
  });

  it("reconoce únicamente el plan interno gratuito", () => {
    expect(isComplimentaryWalkInPlan(freeInternalPlan)).toBe(true);
    expect(isComplimentaryWalkInPlan({ ...freeInternalPlan, price: 150 })).toBe(false);
    expect(isComplimentaryWalkInPlan({ ...freeInternalPlan, is_admin_only: false })).toBe(false);
  });

  it("fuerza monto cero aunque el navegador mande otro importe", () => {
    expect(effectiveWalkInAmount(freeInternalPlan, 500)).toBe(0);
  });

  it("conserva el monto solicitado para walk-ins cobrados", () => {
    expect(effectiveWalkInAmount({ plan_kind: "single", is_admin_only: false, price: 250 }, 250)).toBe(250);
  });

  it("reconoce un walk-in público gratuito para activarlo sin pago", () => {
    expect(isPublicComplimentaryWalkInPlan({
      plan_kind: "internal",
      is_admin_only: false,
      price: "0.00",
    })).toBe(true);
    expect(isPublicComplimentaryWalkInPlan(freeInternalPlan)).toBe(false);
    expect(isPublicComplimentaryWalkInPlan({
      plan_kind: "internal",
      is_admin_only: false,
      price: 100,
    })).toBe(false);
  });

  it("no usa planes internos como antecedente para exentar inscripción", () => {
    expect(serverSource).toContain("NOT IN ('registration', 'internal')");
  });
});
