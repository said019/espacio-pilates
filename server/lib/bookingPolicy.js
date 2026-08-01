// server/lib/bookingPolicy.js
export function endOfPurchaseMonth(startISO) {
  const [y, m] = startISO.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // día 0 del mes siguiente
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// Las membresías y el calendario comercial se rigen por el horario del estudio,
// no por UTC ni por la zona del contenedor de Railway. Acepta un instante para
// que pueda probarse sin depender del reloj del servidor.
export function mexicoCityDate(instant = new Date()) {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(
    fields
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function canCancel({ nowMs, classStartMs, cancelHours = 12, minHours = 3 }) {
  const hoursLeft = (classStartMs - nowMs) / 3600_000;
  return {
    allowed: hoursLeft >= minHours,        // can cancel down to minHours before class
    refundCredit: hoursLeft >= cancelHours // refund only when >= cancelHours
  };
}

export function canReschedule({ nowMs, classStartMs, rescheduleHours = 3 }) {
  const hoursLeft = (classStartMs - nowMs) / 3600_000;
  return { allowed: hoursLeft >= rescheduleHours };
}

export function membershipStartDate(requestedStart, plan) {
  const requested = String(requestedStart).slice(0, 10);
  const rawStartsOn = plan?.starts_on ?? plan?.startsOn;
  const startsOn = rawStartsOn instanceof Date
    ? rawStartsOn.toISOString().slice(0, 10)
    : String(rawStartsOn || "").slice(0, 10);
  return startsOn && requested < startsOn ? startsOn : requested;
}
