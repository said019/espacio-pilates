export function isRegistrationPlan(plan: any): boolean {
  return (plan?.planKind ?? plan?.plan_kind) === "registration"
    || /inscrip/i.test(String(plan?.name ?? ""));
}

export function registrationBlockReason(scoped: boolean, status: any): string | undefined {
  if (!scoped) return "Espera mientras verificamos tu inscripción.";
  if (!(status?.needsInscription ?? status?.needs_inscription)) return "Ya estás inscrita en este programa y sucursal.";
  if (status?.hasPendingPackage ?? status?.has_pending_package) return "Tu inscripción ya está incluida en un paquete pendiente.";
  return undefined;
}
