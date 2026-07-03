// Franja de estampas de asistencia para los pases de Wallet (Apple/Google) —
// capa pura y testeable. server/index.js hace la orquestación (leer el
// snapshot de la alumna, decidir cuándo llamar esto, e incrustar el resultado
// en el .pkpass o exponerlo por HTTP a Google).

// Reparte `total` estampas en 1 o 2 filas. ≤7 estampas → una sola fila.
// Más de 7 → dos filas; la de arriba se lleva la mitad redondeada hacia arriba
// (9 → [5,4], 14 → [7,7]). No hay totales hardcodeados: cualquier paquete
// futuro se acomoda solo con esta misma regla.
export function resolveStampLayout(total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n === 0) return [];
  if (n <= 7) return [n];
  const row1 = Math.ceil(n / 2);
  return [row1, n - row1];
}

// ¿Este pase debe llevar franja de estampas? No para: sin membresía, membresía
// ilimitada, pases de evento, o paquetes de 1 sola clase (Clase Extra/Suelta —
// una sola estampa no comunica nada; se deja solo el texto "1/1" que ya existe).
export function shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit }) {
  if (!hasMembership || isUnlimited || hasEventPass) return false;
  return Number(classLimit) > 1;
}
