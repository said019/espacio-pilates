import { describe, expect, it } from "vitest";
import { generationNotice } from "./generationNotice";

describe("generationNotice", () => {
  it("explains when all classes already exist with another coach", () => {
    const notice = generationNotice({ created: 0, skipped: 7 });
    expect(notice.title).toBe("0 clases creadas · 7 omitidas");
    expect(notice.description).toContain("aunque tengan otra coach");
    expect(notice.description).toContain("No se modificaron sus coaches ni reservas");
    expect(notice.description).toContain("Editar clase");
  });
  it("reports partial generation", () => {
    expect(generationNotice({ created: 3, skipped: 2 }).title).toBe("3 clases creadas · 2 omitidas");
  });
  it("reports generation without duplicates", () => {
    const notice = generationNotice({ created: 4, skipped: 0 });
    expect(notice.title).toBe("4 clases creadas · 0 omitidas");
    expect(notice.description).toContain("No se encontraron");
  });
});
