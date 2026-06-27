// server/lib/bookingPolicy.js
export function endOfPurchaseMonth(startISO) {
  const [y, m] = startISO.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // día 0 del mes siguiente
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
