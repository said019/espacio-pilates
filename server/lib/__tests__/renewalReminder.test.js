import { describe, it, expect } from "vitest";
import { mexicoDateParts, isRenewalReminderTime, renewalReminderDedupKey } from "../renewalReminder.js";

// Construye un Date en UTC para (year, month 1-12, day, hour).
const utc = (y, mo, d, h) => new Date(Date.UTC(y, mo - 1, d, h, 0, 0));

describe("mexicoDateParts", () => {
  it("resta 6 horas (UTC-6): 18:00 UTC = 12:00 México mismo día", () => {
    expect(mexicoDateParts(utc(2026, 9, 28, 18))).toEqual({ year: 2026, month: 9, day: 28, hour: 12 });
  });
  it("cruza al día anterior antes de las 6:00 UTC", () => {
    // 03:00 UTC del día 1 = 21:00 del día anterior en México
    expect(mexicoDateParts(utc(2026, 9, 1, 3))).toEqual({ year: 2026, month: 8, day: 31, hour: 21 });
  });
});

describe("isRenewalReminderTime", () => {
  it("true el 28 a las 12pm México (18:00 UTC)", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 28, 18))).toBe(true);
  });
  it("true el 1ro a las 12pm México", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 1, 18))).toBe(true);
  });
  it("false otro día a las 12pm México", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 15, 18))).toBe(false);
  });
  it("false el 28 a otra hora (14:00 México)", () => {
    expect(isRenewalReminderTime(utc(2026, 9, 28, 20))).toBe(false);
  });
});

describe("renewalReminderDedupKey", () => {
  it("formatea renew_YYYY_MM_DD con ceros a la izquierda (día 1)", () => {
    expect(renewalReminderDedupKey(utc(2026, 9, 1, 18))).toBe("renew_2026_09_01");
  });
  it("día 28", () => {
    expect(renewalReminderDedupKey(utc(2026, 12, 28, 18))).toBe("renew_2026_12_28");
  });
});
