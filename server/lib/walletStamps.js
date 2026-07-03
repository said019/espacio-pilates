// Franja de estampas de asistencia para los pases de Wallet (Apple/Google) —
// capa pura y testeable. server/index.js hace la orquestación (leer el
// snapshot de la alumna, decidir cuándo llamar esto, e incrustar el resultado
// en el .pkpass o exponerlo por HTTP a Google).

import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STAMP_SOURCE_PATH = path.join(__dirname, "..", "..", "wallet-assets", "stamp-tuespacio.png");

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

// Cache en memoria del PNG fuente, por ruta — evita releer el archivo en cada
// llamada. Es intencional (mismo patrón que appleApnsProviderTokenCache en
// server/index.js): estado module-level para una capa mayormente pura.
const sourceBufferCache = new Map();
async function loadSourceBuffer(sourcePath) {
  if (sourceBufferCache.has(sourcePath)) return sourceBufferCache.get(sourcePath);
  const buf = await sharp(sourcePath).toBuffer();
  sourceBufferCache.set(sourcePath, buf);
  return buf;
}

// Redimensiona el sello fuente a una celda `size`×`size` (con 8% de margen).
// Si `used` es true, lo pasa a escala de grises y le reduce la opacidad a
// ~18% componiendo una capa semitransparente con blend "dest-in" (multiplica
// el alpha existente del trazo — conserva la forma, solo la atenúa; no crea
// una caja sólida).
async function buildStampTile(sourceBuffer, size, used) {
  const inner = Math.round(size * 0.84);
  let tile = await sharp(sourceBuffer)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  if (used) {
    tile = await sharp(tile).grayscale().toBuffer();
    const alphaLayer = await sharp({
      create: { width: inner, height: inner, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.18 } },
    }).png().toBuffer();
    tile = await sharp(tile).composite([{ input: alphaLayer, blend: "dest-in" }]).png().toBuffer();
  }
  const pad = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: tile, left: pad, top: pad }])
    .png()
    .toBuffer();
}

// Compone la franja completa: `remaining` estampas visibles (en tinta, al
// final del recorrido), el resto apagadas (gris + 18% opacidad, al inicio),
// leyendo de izquierda a derecha y de arriba hacia abajo. Devuelve un Buffer
// PNG transparente de widthPx×heightPx. Si `total` es 0 (o resolveStampLayout
// no produce filas), devuelve un lienzo transparente vacío sin lanzar.
export async function renderStampStripPng({ total, remaining, widthPx, heightPx, sourcePath = STAMP_SOURCE_PATH }) {
  const rows = resolveStampLayout(total);
  if (!rows.length) {
    return sharp({ create: { width: widthPx, height: heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
  }
  const sourceBuffer = await loadSourceBuffer(sourcePath);
  const usedTotal = Math.max(0, total - remaining);
  const maxCols = Math.max(...rows);
  const gap = Math.round(widthPx * 0.012);
  const rowHeight = Math.floor((heightPx - gap * (rows.length - 1)) / rows.length);
  const cellSize = Math.min(rowHeight, Math.floor((widthPx - gap * (maxCols - 1)) / maxCols));

  const composites = [];
  let idx = 0;
  let y = Math.round((heightPx - (rowHeight * rows.length + gap * (rows.length - 1))) / 2);
  for (const count of rows) {
    const rowWidth = count * cellSize + (count - 1) * gap;
    let x = Math.round((widthPx - rowWidth) / 2);
    for (let i = 0; i < count; i++) {
      const used = idx < usedTotal;
      const tile = await buildStampTile(sourceBuffer, cellSize, used);
      composites.push({ input: tile, left: x, top: y });
      x += cellSize + gap;
      idx++;
    }
    y += rowHeight + gap;
  }

  return sharp({ create: { width: widthPx, height: heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toBuffer();
}
