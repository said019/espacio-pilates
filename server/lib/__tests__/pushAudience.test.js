import { describe, expect, it } from "vitest";
import {
  PUSH_SEGMENTS,
  normalizePushSegment,
  pushAudienceQuery,
  renewalNotificationAudienceQuery,
} from "../pushAudience.js";

describe("normalizePushSegment", () => {
  it("acepta los tres segmentos públicos", () => {
    expect(normalizePushSegment(PUSH_SEGMENTS.ALL)).toBe("all");
    expect(normalizePushSegment(PUSH_SEGMENTS.ACTIVE_MEMBERSHIP)).toBe("active_membership");
    expect(normalizePushSegment(PUSH_SEGMENTS.RENEWAL_PENDING)).toBe("renewal_pending");
  });

  it("cae de forma segura en all para un valor desconocido", () => {
    expect(normalizePushSegment("anything_else")).toBe("all");
  });
});

describe("pushAudienceQuery", () => {
  it("el segmento de renovación exige membresía vencida", () => {
    const sql = renewalNotificationAudienceQuery();
    expect(sql).toContain("previous_membership.end_date < CURRENT_DATE");
    expect(sql).toContain("previous_membership.status IN ('active', 'expired')");
  });

  it("excluye a quien ya tiene otra membresía activa y vigente", () => {
    const sql = renewalNotificationAudienceQuery();
    expect(sql).toContain("AND NOT EXISTS");
    expect(sql).toContain("current_membership.status = 'active'");
    expect(sql).toContain("current_membership.end_date >= CURRENT_DATE");
  });

  it("el push de renovación parte del mismo segmento y exige preferencia push", () => {
    const sql = pushAudienceQuery(PUSH_SEGMENTS.RENEWAL_PENDING);
    expect(sql).toContain("previous_membership.end_date < CURRENT_DATE");
    expect(sql).toContain("u.push_reminders IS NOT FALSE");
  });

  it("no incluye cuentas ajenas a clientas ni cuentas desactivadas", () => {
    for (const segment of Object.values(PUSH_SEGMENTS)) {
      const sql = pushAudienceQuery(segment);
      expect(sql).toContain("u.role = 'client'");
      expect(sql).toContain("u.is_active IS NOT FALSE");
    }
  });
});
