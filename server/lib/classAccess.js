import { isSameBranch, normalizeProgram, programForClassCategory } from "./branchAccess.js";

const VALID_CLASS_CATEGORIES = new Set([
  "reformer",
  "barre",
  "pilates",
  "bienestar",
  "funcional",
  "functional",
  "mixto",
  "prenatal",
  "all",
]);

export function normalizeClassCategory(value, fallback = "all") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!VALID_CLASS_CATEGORIES.has(raw)) return fallback;
  // Historical Pilates rows represent the studio's regular Reformer access.
  if (raw === "pilates") return "reformer";
  if (raw === "functional") return "funcional";
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
  if (classType === "prenatal") return ["prenatal"];
  // Both values still exist in historical rows. Query both aliases so a
  // canonical Pilates membership cannot be rejected just because its stored
  // category predates the Reformer normalization (same for Functional).
  if (classType === "reformer") return ["reformer", "pilates", "all", "mixto"];
  if (classType === "funcional") return ["funcional", "functional", "all", "mixto"];
  return [classType, "all", "mixto"];
}

export function membershipCanBookClass(membership = {}, classInfo = {}) {
  const planKind = String(membership.plan_kind ?? membership.planKind ?? "").toLowerCase();
  if (planKind === "registration") return false;
  const membershipBranchId = membership.branch_id ?? membership.branchId;
  const classBranchId = classInfo.branch_id ?? classInfo.branchId;
  if (!isSameBranch(membershipBranchId, classBranchId)) return false;

  const membershipCategory = membership.class_category ?? membership.classCategory ?? "all";
  const classCategory = classInfo.class_category ?? classInfo.classCategory ?? "all";
  const membershipProgram = normalizeProgram(
    membership.program ?? membership.class_program ?? membershipCategory,
  );
  const classProgram = normalizeProgram(
    classInfo.program ?? classInfo.class_program ?? programForClassCategory(classCategory),
  );

  return membershipProgram === classProgram
    && isMembershipCategoryCompatible(membershipCategory, classCategory);
}

function dateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

export function membershipIsEligibleForClass(membership, classInfo, bookingUserId) {
  if (!membership || membership.status !== "active") return false;
  const membershipUserId = membership.user_id ?? membership.userId;
  if (!membershipUserId || String(membershipUserId) !== String(bookingUserId)) return false;
  if (!membershipCanBookClass(membership, classInfo)) return false;

  const classDate = dateKey(classInfo?.date ?? classInfo?.class_date ?? classInfo?.classDate);
  const startDate = dateKey(membership.start_date ?? membership.startDate);
  const endDate = dateKey(membership.end_date ?? membership.endDate);
  if (classDate && startDate && startDate > classDate) return false;
  if (classDate && endDate && endDate < classDate) return false;

  const remaining = membership.classes_remaining ?? membership.classesRemaining;
  return remaining === null || remaining === undefined
    || Number(remaining) >= 9999
    || Number(remaining) > 0;
}
