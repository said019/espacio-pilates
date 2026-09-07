import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isWalkInClass, shouldConsumeCredit, walkInStatusCanChange } from "../classWalkIn.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(testDirectory, "../../index.js"), "utf8");

describe("clases walk-in", () => {
  it("reconoce el indicador en snake_case y camelCase", () => {
    expect(isWalkInClass({ is_walk_in: true })).toBe(true);
    expect(isWalkInClass({ isWalkIn: "true" })).toBe(true);
    expect(isWalkInClass({ is_walk_in: false })).toBe(false);
  });

  it("una reserva confirmada walk-in no consume crédito", () => {
    expect(shouldConsumeCredit({ walkIn: true, waitlist: false })).toBe(false);
    expect(shouldConsumeCredit({ walkIn: false, waitlist: false })).toBe(true);
  });

  it("la lista de espera nunca consume crédito al unirse", () => {
    expect(shouldConsumeCredit({ walkIn: false, waitlist: true })).toBe(false);
    expect(shouldConsumeCredit({ walkIn: true, waitlist: true })).toBe(false);
  });

  it("solo permite cambiar el modo sin reservas activas", () => {
    expect(walkInStatusCanChange(0)).toBe(true);
    expect(walkInStatusCanChange(1)).toBe(false);
  });

  it("exige inscripción y no descuenta crédito en reservas walk-in", () => {
    expect(serverSource).toContain("WALK_IN_REQUIRES_INSCRIPTION");
    expect(serverSource).toContain("[classId, req.userId, membership?.id || null, status]");
    expect(serverSource).toContain("shouldConsumeCredit({ walkIn: walkInClass, waitlist: isWaitlist })");
  });

  it("revalida inscripción al promover la lista de espera", () => {
    expect(serverSource).toContain("UPDATE bookings SET status = 'confirmed', membership_id = NULL");
    expect(serverSource).toContain("clientHasPaidWalkInInscription(wl.user_id");
  });

  it("impide cambiar el modo de clases que ya tienen reservas", () => {
    expect(serverSource).toContain('app.put("/api/admin/classes/walk-in"');
    expect(serverSource).toContain("WALK_IN_HAS_BOOKINGS");
  });
});
