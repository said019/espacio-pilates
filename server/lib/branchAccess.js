export const DEFAULT_BRANCH_CODE = "villa-magna";
export const DEFAULT_BRANCH_ID = "11111111-1111-4111-8111-111111111111";
export const POZOS_BRANCH_ID = "22222222-2222-4222-8222-222222222222";

const PROGRAM_ALIASES = new Map([
  ["pilates", "pilates"],
  ["reformer", "pilates"],
  ["studio", "pilates"],
  ["tower", "pilates"],
  ["funcional", "functional"],
  ["functional", "functional"],
  ["prenatal", "prenatal"],
]);

export function normalizeProgram(value, fallback = "pilates") {
  const normalized = PROGRAM_ALIASES.get(String(value ?? "").trim().toLowerCase());
  return normalized || fallback;
}

export function programForClassCategory(category) {
  return normalizeProgram(category, "pilates");
}

export function extractBranchReference(source = {}) {
  return source.branchId ?? source.branch_id ?? source.branch ?? null;
}

export function isSameBranch(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

export function isPackagePlan(plan = {}) {
  if (String(plan.plan_kind ?? plan.planKind ?? "").toLowerCase() === "package") return true;
  const limit = plan.class_limit ?? plan.classLimit;
  if (Number.isFinite(Number(limit)) && Number(limit) >= 2) return true;
  const name = String(plan.name ?? "").toLowerCase();
  return limit == null && /ilimitad|unlimited/.test(name);
}

export function isOrderVerifiableStatus(status) {
  return ["pending_payment", "pending_verification", "approved"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

export function validateSingleScope(plans = []) {
  if (!plans.length) return { valid: true, branchId: null, program: null };
  const branchIds = new Set(plans.map((plan) => String(plan.branch_id ?? plan.branchId ?? "")));
  const programs = new Set(plans.map((plan) => normalizeProgram(plan.program)));
  if (branchIds.size !== 1 || branchIds.has("")) {
    return { valid: false, code: "MIXED_BRANCH_CART", message: "Todos los paquetes del carrito deben ser de la misma sucursal." };
  }
  if (programs.size !== 1) {
    return { valid: false, code: "MIXED_PROGRAM_CART", message: "Todos los paquetes del carrito deben pertenecer al mismo programa." };
  }
  return { valid: true, branchId: [...branchIds][0], program: [...programs][0] };
}
