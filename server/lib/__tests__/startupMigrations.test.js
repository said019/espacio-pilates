import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(testDirectory, "../../index.js"), "utf8");

describe("startup migrations", () => {
  it("does not replay the one-time Villa Magna September cleanup on every boot", () => {
    expect(serverSource).not.toContain(
      'path.join(__dirname, "../supabase/migrations/202608280002_remove_villa_magna_september_pilates_classes.sql")',
    );
  });

  it("publishes the Pozos location during startup", () => {
    expect(serverSource).toContain(
      'path.join(__dirname, "../supabase/migrations/202608300001_pozos_location.sql")',
    );
  });
});
