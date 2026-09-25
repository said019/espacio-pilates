// El editor de créditos muestra un número absoluto, pero guardar ese número
// pisaría cualquier crédito que la clienta usó mientras el diálogo estaba
// abierto. Se envía solo la diferencia (sumar/restar) a /memberships/:id/credits,
// que además deja nota de auditoría.
export type CreditAdjustment = { mode: "add" | "subtract"; value: number };

export function creditAdjustment(before: number | null | undefined, after: number): CreditAdjustment | null {
  const delta = after - (before ?? 0);
  if (delta === 0) return null;
  return { mode: delta > 0 ? "add" : "subtract", value: Math.abs(delta) };
}
