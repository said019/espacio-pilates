export function isAdminOnlyPlan(_planKind, explicitAdminOnly = false) {
  return explicitAdminOnly === true;
}

export function isComplimentaryWalkInPlan(plan) {
  if (!plan) return false;
  const kind = String(plan.plan_kind ?? plan.planKind ?? "").trim().toLowerCase();
  const adminOnly = plan.is_admin_only ?? plan.isAdminOnly;
  const price = Number(plan.price);
  return kind === "internal" && adminOnly === true && Number.isFinite(price) && price === 0;
}

export function effectiveWalkInAmount(plan, requestedAmount) {
  if (isComplimentaryWalkInPlan(plan)) return 0;
  const amount = Number(requestedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function isPublicComplimentaryWalkInPlan(plan) {
  if (!plan) return false;
  const kind = String(plan.plan_kind ?? plan.planKind ?? "").trim().toLowerCase();
  const adminOnly = plan.is_admin_only ?? plan.isAdminOnly;
  const price = Number(plan.price);
  return kind === "internal" && adminOnly === false && Number.isFinite(price) && price === 0;
}
