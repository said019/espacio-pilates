export type PaymentPlanGroup = "registration" | "pilates" | "functional" | "bienestar" | "otro";

export function isAssignablePaymentPlan(plan: any) {
  const active = plan?.isActive !== false && plan?.is_active !== false;
  const kind = plan?.planKind ?? plan?.plan_kind;
  return active && kind !== "internal";
}

export function groupPaymentPlans(plans: any[]) {
  const groups: Record<PaymentPlanGroup, any[]> = {
    registration: [],
    pilates: [],
    functional: [],
    bienestar: [],
    otro: [],
  };

  for (const plan of plans.filter(isAssignablePaymentPlan)) {
    const category = plan.classCategory ?? plan.class_category ?? "";
    const program = plan.program ?? "";
    const kind = plan.planKind ?? plan.plan_kind ?? "";

    if (kind === "registration") groups.registration.push(plan);
    else if (program === "functional" || category === "funcional") groups.functional.push(plan);
    else if (program === "pilates" || category === "pilates") groups.pilates.push(plan);
    else if (category === "bienestar") groups.bienestar.push(plan);
    else if (category === "all") groups.otro.push(plan);
    else if (/pilates|mat|flow/i.test(String(plan.name ?? ""))) groups.pilates.push(plan);
    else if (/body|strong|flex/i.test(String(plan.name ?? ""))) groups.bienestar.push(plan);
    else groups.otro.push(plan);
  }

  return groups;
}
