import { describe, expect, it } from "vitest";
import { getBranchMapEmbedUrl, getBranchMapsUrl } from "./branchLocation";

describe("branch map links", () => {
  it("uses the exact Pozos coordinates for directions and the embedded map", () => {
    const branch = {
      address: "Pozos, San Luis Potosí, S.L.P.",
      mapsUrl: "https://maps.google.com/?q=22.096529,-100.869797",
    };

    expect(getBranchMapsUrl(branch)).toBe("https://maps.google.com/?q=22.096529,-100.869797");
    expect(getBranchMapEmbedUrl(branch)).toBe(
      "https://www.google.com/maps?q=22.096529%2C-100.869797&output=embed",
    );
  });

  it("falls back to an address search when no exact Maps URL exists", () => {
    const branch = { address: "Villa Magna, San Luis Potosí", mapsUrl: null };
    expect(getBranchMapsUrl(branch)).toContain("query=Villa%20Magna%2C%20San%20Luis%20Potos%C3%AD");
    expect(getBranchMapEmbedUrl(branch)).toContain("q=Villa%20Magna%2C%20San%20Luis%20Potos%C3%AD");
  });
});
