import { describe, expect, it } from "vitest";
import { summarizeRoster } from "./rosterSummary";

describe("class roster summary", () => {
  it("separates confirmed attendees from the waitlist", () => {
    const roster = [
      ...Array.from({ length: 7 }, () => ({ status: "confirmed" })),
      { status: "checked_in" },
      { status: "waitlist" },
      { status: "cancelled" },
    ];

    expect(summarizeRoster(roster)).toEqual({ confirmed: 8, waitlist: 1 });
  });
});
