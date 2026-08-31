import { describe, expect, it } from "vitest";
import { getBranchMapEmbedUrl, getBranchMapsUrl } from "./branchLocation";

describe("branch map links", () => {
  it("uses the confirmed Pozos listing for directions and the embedded map", () => {
    const branch = {
      address: "Camino a los Pozos, Boulevard de Pozos 302-E, 78420 Laguna de Santa Rita, S.L.P.",
      mapsUrl: "https://www.google.com/maps?q=Tu+Espacio+Pilates+Pozos,+Camino+a+los+Pozos,+Boulevard+de+Pozos+302-E,+78420+Laguna+de+Santa+Rita,+S.L.P.&ftid=confirmed-place",
    };

    expect(getBranchMapsUrl(branch)).toContain("ftid=confirmed-place");
    expect(getBranchMapEmbedUrl(branch)).toBe(
      "https://www.google.com/maps?q=Tu%20Espacio%20Pilates%20Pozos%2C%20Camino%20a%20los%20Pozos%2C%20Boulevard%20de%20Pozos%20302-E%2C%2078420%20Laguna%20de%20Santa%20Rita%2C%20S.L.P.&output=embed",
    );
  });

  it("falls back to an address search when no exact Maps URL exists", () => {
    const branch = { address: "Villa Magna, San Luis Potosí", mapsUrl: null };
    expect(getBranchMapsUrl(branch)).toContain("query=Villa%20Magna%2C%20San%20Luis%20Potos%C3%AD");
    expect(getBranchMapEmbedUrl(branch)).toContain("q=Villa%20Magna%2C%20San%20Luis%20Potos%C3%AD");
  });
});
