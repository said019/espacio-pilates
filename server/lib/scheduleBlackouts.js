const VILLA_MAGNA_CODE = "villa-magna";
const SEPTEMBER_2026_START = "2026-09-01";
const OCTOBER_2026_START = "2026-10-01";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

export function shouldSkipAutomaticVillaMagnaSeptemberPilates({
  branchCode,
  date,
  classTypeName,
  classTypeCategory,
  apparatus,
} = {}) {
  if (normalized(branchCode) !== VILLA_MAGNA_CODE) return false;

  const classDate = dateOnly(date);
  if (classDate < SEPTEMBER_2026_START || classDate >= OCTOBER_2026_START) return false;

  const name = normalized(classTypeName);
  const category = normalized(classTypeCategory);
  const equipment = normalized(apparatus);
  const isFunctional =
    name.includes("functional") ||
    name.includes("funcional") ||
    ["functional", "funcional"].includes(category) ||
    ["functional", "funcional"].includes(equipment);
  const isPrenatal =
    name.includes("prenatal") || category === "prenatal" || equipment === "prenatal";

  return !isFunctional && !isPrenatal;
}
