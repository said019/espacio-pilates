export function booleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["true", "1", "yes", "si", "sí", "t"].includes(value.trim().toLowerCase());
  return false;
}

export function isWalkInClass(classRow) {
  return booleanFlag(classRow?.is_walk_in ?? classRow?.isWalkIn);
}

export function shouldConsumeCredit({ walkIn, waitlist }) {
  return !booleanFlag(walkIn) && !booleanFlag(waitlist);
}

export function walkInStatusCanChange(activeBookingCount) {
  const count = Number(activeBookingCount);
  return Number.isFinite(count) && count === 0;
}
