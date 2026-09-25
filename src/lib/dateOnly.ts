// Las columnas DATE (vigencias, cumpleaños, fecha de clase) llegan de la API como
// "2026-09-30" o "2026-09-30T00:00:00.000Z" (medianoche UTC). new Date()/parseISO
// las pasan a hora local y en México (UTC-6) se ven un día ANTES (vence el 29 en
// vez del 30). Se toma solo el día del calendario y se arma a medianoche local.
export function parseDateOnly(value: unknown): Date | null {
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
