const VALID_CLASS_CATEGORIES = new Set([
  "reformer",
  "barre",
  "pilates",
  "bienestar",
  "funcional",
  "mixto",
  "prenatal",
  "all",
]);

export function normalizeClassCategory(value, fallback = "all") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!VALID_CLASS_CATEGORIES.has(raw)) return fallback;
  // Historical Pilates rows represent the studio's regular Reformer access.
  if (raw === "pilates") return "reformer";
  return raw;
}

export function isMembershipCategoryCompatible(membershipCategory, classCategory) {
  const membership = normalizeClassCategory(membershipCategory, "all");
  const classType = normalizeClassCategory(classCategory, "all");

  // Prenatal is a closed program in both directions: its membership cannot
  // enter regular studio classes, and regular/all-access plans cannot consume
  // credits in a Prenatal class.
  if (membership === "prenatal" || classType === "prenatal") {
    return membership === "prenatal" && classType === "prenatal";
  }

  if (membership === "all" || membership === "mixto") return true;
  if (classType === "all") return true;
  return membership === classType;
}

export function compatibleMembershipCategoriesForClass(classCategory) {
  const classType = normalizeClassCategory(classCategory, "all");
  return classType === "prenatal"
    ? ["prenatal"]
    : [classType, "all", "mixto"];
}
