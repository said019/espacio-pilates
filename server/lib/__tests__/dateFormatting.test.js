import { describe, it, expect } from "vitest";
import { formatEsMxDate, formatMexicoCityTimestamp, mexicoCityDateParts } from "../dateFormatting.js";
import { mexicoCityDate } from "../bookingPolicy.js";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const formats = {
  date: undefined,
  dayMonth: { day: "numeric", month: "short" },
  dayMonthYear: { day: "numeric", month: "short", year: "numeric" },
  weekdayDayMonth: { weekday: "short", day: "numeric", month: "short" },
  weekdayDayMonthYear: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  utcDate: { timeZone: "UTC" },
};
const instants = [
  "2026-01-01T00:00:00Z", "2026-08-01T04:52:03Z", "2026-08-01T06:00:00Z",
  "2024-02-29T23:59:59Z", "2026-12-31T23:59:59Z", "2021-10-31T06:30:00Z",
  "2021-10-31T07:30:00Z", "2026-09-30", "invalid fixture",
];

describe("reused server date formatters", () => {
  it("tracks TZ changes after import, returns to the original zone and keeps fixed zones stable", () => {
    const moduleUrl = pathToFileURL(resolve("server/lib/dateFormatting.js")).href;
    const script = `
      import assert from 'node:assert/strict';
      const { formatEsMxDate, formatMexicoCityTimestamp, mexicoCityDateParts } = await import(${JSON.stringify(moduleUrl)});
      const formats = ${JSON.stringify(formats)};
      formats.date = undefined;
      const original = process.env.TZ;
      const date = new Date('2026-08-01T00:30:00Z');
      const fixedStamp = formatMexicoCityTimestamp(date);
      const fixedParts = mexicoCityDateParts(date);
      let checks = 0;
      try {
        for (const zone of ['UTC', 'America/Mexico_City', 'Pacific/Auckland', 'America/New_York', 'UTC']) {
          process.env.TZ = zone;
          for (const [style, options] of Object.entries(formats)) {
            assert.equal(formatEsMxDate(date, style), date.toLocaleDateString('es-MX', options)); checks++;
          }
          assert.equal(formatMexicoCityTimestamp(date), fixedStamp);
          assert.deepEqual(mexicoCityDateParts(date), fixedParts);
        }
      } finally {
        if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
      }
      assert.equal(formatEsMxDate(date), date.toLocaleDateString('es-MX')); checks++;
      console.log(JSON.stringify({checks}));
    `;
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(JSON.parse(result).checks).toBe(31);
  });

  for (const [style, options] of Object.entries(formats)) {
    it(`preserves es-MX ${style}, including invalid-date behavior`, () => {
      for (const input of instants) {
        const date = new Date(input);
        expect(formatEsMxDate(date, style)).toBe(date.toLocaleDateString("es-MX", options));
      }
    });
  }

  it("preserves the Mexico City timestamp, precision and punctuation", () => {
    for (const input of instants) {
      const date = new Date(input);
      expect(formatMexicoCityTimestamp(date)).toBe(date.toLocaleString("es-MX", { timeZone: "America/Mexico_City" }));
    }
  });

  it("preserves complete stats parts and booking calendar date at month/year/DST boundaries", () => {
    for (const input of instants.slice(0, -1)) {
      const date = new Date(input);
      const originalParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      expect(mexicoCityDateParts(date)).toEqual(originalParts);
      const bookingParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const values = Object.fromEntries(bookingParts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
      expect(mexicoCityDate(date)).toBe(`${values.year}-${values.month}-${values.day}`);
    }
    expect(() => mexicoCityDate(new Date("invalid fixture"))).toThrow(RangeError);
    expect(() => mexicoCityDateParts(new Date("invalid fixture"))).toThrow(RangeError);
  });
});
