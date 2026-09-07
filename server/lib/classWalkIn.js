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

export function walkInStatusCanChange({ currentWalkIn, nextWalkIn, activeBookingCount }) {
  if (booleanFlag(currentWalkIn) === booleanFlag(nextWalkIn)) return true;
  // Converting a normal class to walk-in is safe when the server refunds the
  // already-consumed credits atomically. Reverting to normal with reservations
  // is blocked because those clients may no longer have a compatible package.
  if (booleanFlag(nextWalkIn)) return true;
  const count = Number(activeBookingCount);
  return Number.isFinite(count) && count === 0;
}
