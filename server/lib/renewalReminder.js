// Capa pura del recordatorio de renovación (días 28 y 1ro, 12pm hora de
// México). La orquestación (query + envío push) vive en server/index.js.
// San Luis Potosí es UTC-6 todo el año (México no observa DST desde 2023),
// mismo criterio que el cron semanal existente.

const MEXICO_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC-6

// Partes de fecha/hora en horario de México.
export function mexicoDateParts(date) {
  const mx = new Date(date.getTime() - MEXICO_OFFSET_MS);
  return {
    year: mx.getUTCFullYear(),
    month: mx.getUTCMonth() + 1, // 1-12
    day: mx.getUTCDate(),
    hour: mx.getUTCHours(),
  };
}

// ¿Es momento de correr el recordatorio? Días 28 o 1, a las 12 (hora México).
export function isRenewalReminderTime(date) {
  const { day, hour } = mexicoDateParts(date);
  return (day === 28 || day === 1) && hour === 12;
}

// Clave de dedup por fecha: renew_YYYY_MM_DD (DD = 28 o 01).
export function renewalReminderDedupKey(date) {
  const { year, month, day } = mexicoDateParts(date);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `renew_${year}_${mm}_${dd}`;
}
