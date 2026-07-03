# Estampas de asistencia en Apple/Google Wallet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pase de Wallet (Apple y Google) muestre una franja de estampas (una por clase del paquete) que se van apagando conforme la alumna toma sus clases, calculada a partir del `classLimit` real de los planes que se venden — sin totales inventados ni imágenes pre-renderizadas.

**Architecture:** Un módulo nuevo y puro `server/lib/walletStamps.js` decide el acomodo por filas y compone la franja en el momento con `sharp` (nueva dependencia). Apple la recibe embebida dentro del `.pkpass` que ya se genera hoy; Google la consume vía un endpoint público nuevo referenciado en `imageModulesData`, con cache-busting para que refleje siempre las clases restantes actuales. No hay lógica de negocio nueva — solo renderizado de números que el sistema ya calcula.

**Tech Stack:** Node/Express (`server/index.js`), `sharp` (composición de imágenes), Vitest (pruebas), Python/Pillow (limpieza de asset, un solo uso).

**Spec:** `docs/superpowers/specs/2026-07-03-wallet-stamps-design.md`.

**Contexto crítico de ejecución:**
- Ubicar SIEMPRE por contenido (grep de los anclas citados), no por número de línea — `server/index.js` (~15.7k líneas) se corre con cada edición.
- El enfoque de composición con `sharp` (grayscale + blend `dest-in` para la opacidad) **ya fue prototipado y verificado de verdad** durante la redacción de este plan — no es especulativo. El código de las Tareas 2-4 es el que se probó.
- **Bug descubierto y a corregir en este mismo trabajo:** el flag `hasIconStampMode` (usado para ocultar el texto "CLASES DISPONIBLES"/"CLASES" cuando "hay una franja visual") hoy es `true` para **cualquier** membresía con `class_limit > 0`, porque `resolveWalletStripStampState` siempre devuelve un total positivo — así que ese texto está oculto en producción para TODOS los paquetes reales, sin que ninguna franja lo reemplace (la franja vieja se quitó hace unos días). Este plan lo corrige de raíz al conectar `hasIconStampMode` a la nueva lógica real (`shouldRenderStampStrip`).
- Entorno local: backend `node server/index.js` (8090), front `npx vite --port 5173`, admin `espaciopilatesvm@gmail.com` / `EspacioVM2026!`. En local el push/wallet dependen de credenciales que si existen en `.env`; para este trabajo la verificación fuerte es contra producción (ya configurada).
- No hacer push a git al final; preguntar a Said.

---

### Task 1: Limpiar el asset fuente de la estampa

**Files:**
- Create: `wallet-assets/stamp-tuespacio.png` (a partir de `stamp tuespacio.jpeg`, en la raíz del repo)

- [ ] **Step 1: Convertir el JPEG (fondo blanco) a PNG con fondo transparente**

Run (usa Pillow, ya disponible en el entorno):
```bash
cd "/Users/saidromero/Tu Espacio Pilates"
python3 -c "
from PIL import Image
im = Image.open('stamp tuespacio.jpeg').convert('RGBA')
datas = im.getdata()
new_data = []
for r, g, b, a in datas:
    if r > 240 and g > 240 and b > 240:
        new_data.append((r, g, b, 0))
    else:
        new_data.append((r, g, b, 255))
im.putdata(new_data)
im.save('wallet-assets/stamp-tuespacio.png')
print('OK', im.size, im.mode)
"
```
Expected: `OK (998, 998) RGBA`.

- [ ] **Step 2: Verificar transparencia real (no solo blanco opaco)**

Run:
```bash
python3 -c "
from PIL import Image
im = Image.open('wallet-assets/stamp-tuespacio.png')
print('mode:', im.mode)
print('esquina (0,0):', im.getpixel((0,0)))
"
```
Expected: `mode: RGBA` y la esquina con alpha `0` (cuarto valor), p.ej. `(255, 255, 255, 0)`.

- [ ] **Step 3: Commit**

```bash
git add wallet-assets/stamp-tuespacio.png
git commit -m "feat(wallet): asset fuente de la estampa (fondo transparente)

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 2: `resolveStampLayout` — acomodo por filas (TDD)

**Files:**
- Create: `server/lib/walletStamps.js`
- Create: `server/lib/__tests__/walletStamps.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

```js
// server/lib/__tests__/walletStamps.test.js
import { describe, it, expect } from "vitest";
import { resolveStampLayout } from "../walletStamps.js";

describe("resolveStampLayout", () => {
  it("total 0 o negativo → sin filas", () => {
    expect(resolveStampLayout(0)).toEqual([]);
    expect(resolveStampLayout(-3)).toEqual([]);
  });
  it("total ≤ 7 → una sola fila", () => {
    expect(resolveStampLayout(1)).toEqual([1]);
    expect(resolveStampLayout(7)).toEqual([7]);
  });
  it("total 9 → 5 arriba, 4 abajo", () => {
    expect(resolveStampLayout(9)).toEqual([5, 4]);
  });
  it("total 14 → 7 arriba, 7 abajo", () => {
    expect(resolveStampLayout(14)).toEqual([7, 7]);
  });
  it("total 8 → se parte parejo (4 y 4)", () => {
    expect(resolveStampLayout(8)).toEqual([4, 4]);
  });
  it("total 20 (paquete futuro hipotético) → se acomoda solo (10 y 10)", () => {
    expect(resolveStampLayout(20)).toEqual([10, 10]);
  });
});
```

- [ ] **Step 2: Verificar que falla (el módulo no existe todavía)**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: FAIL — `Cannot find module '../walletStamps.js'` (o similar).

- [ ] **Step 3: Crear el módulo con `resolveStampLayout`**

```js
// server/lib/walletStamps.js
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
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/walletStamps.js server/lib/__tests__/walletStamps.test.js
git commit -m "feat(wallet): resolveStampLayout — acomodo por filas de la franja de estampas

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 3: `shouldRenderStampStrip` — cuándo mostrar franja (TDD)

**Files:**
- Modify: `server/lib/walletStamps.js`
- Modify: `server/lib/__tests__/walletStamps.test.js`

- [ ] **Step 1: Agregar las pruebas que fallan**

Agregar al final de `server/lib/__tests__/walletStamps.test.js`:

```js
import { resolveStampLayout, shouldRenderStampStrip } from "../walletStamps.js";
```
(reemplaza el import existente `import { resolveStampLayout } from "../walletStamps.js";` por la línea de arriba con ambos nombres.)

```js
describe("shouldRenderStampStrip", () => {
  const base = { hasMembership: true, isUnlimited: false, hasEventPass: false, classLimit: 7 };

  it("paquete real (7/9/14 clases) → sí", () => {
    expect(shouldRenderStampStrip({ ...base, classLimit: 7 })).toBe(true);
    expect(shouldRenderStampStrip({ ...base, classLimit: 9 })).toBe(true);
    expect(shouldRenderStampStrip({ ...base, classLimit: 14 })).toBe(true);
  });
  it("Clase Extra / Suelta (1 clase) → no", () => {
    expect(shouldRenderStampStrip({ ...base, classLimit: 1 })).toBe(false);
  });
  it("sin membresía → no", () => {
    expect(shouldRenderStampStrip({ ...base, hasMembership: false })).toBe(false);
  });
  it("membresía ilimitada → no", () => {
    expect(shouldRenderStampStrip({ ...base, isUnlimited: true })).toBe(false);
  });
  it("pase de evento → no", () => {
    expect(shouldRenderStampStrip({ ...base, hasEventPass: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: FAIL — `shouldRenderStampStrip is not a function` (o `undefined`).

- [ ] **Step 3: Implementar `shouldRenderStampStrip`**

Agregar a `server/lib/walletStamps.js`, después de `resolveStampLayout`:

```js
// ¿Este pase debe llevar franja de estampas? No para: sin membresía, membresía
// ilimitada, pases de evento, o paquetes de 1 sola clase (Clase Extra/Suelta —
// una sola estampa no comunica nada; se deja solo el texto "1/1" que ya existe).
export function shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit }) {
  if (!hasMembership || isUnlimited || hasEventPass) return false;
  return Number(classLimit) > 1;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/walletStamps.js server/lib/__tests__/walletStamps.test.js
git commit -m "feat(wallet): shouldRenderStampStrip — cuándo mostrar la franja de estampas

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 4: `renderStampStripPng` — composición real con `sharp`

**Files:**
- Modify: `server/lib/walletStamps.js`
- Modify: `server/lib/__tests__/walletStamps.test.js`
- Modify: `package.json` (nueva dependencia)

**Contexto:** este código ya fue prototipado y ejecutado de verdad contra el asset real durante el diseño de este plan — se confirmó (a) el PNG resultante tiene canal alpha real (`hasAlpha: true`, esquina `(0,0,0,0)`), (b) el acomodo 5+4 y 7+7 se ve correcto a las medidas reales de Apple (1125×369) y Google (1860×610), (c) las estampas "usadas" salen en gris a ~18% de opacidad sin crear una caja sólida (se preserva la forma del trazo). No es código especulativo.

- [ ] **Step 1: Instalar `sharp`**

Run: `npm install sharp`
Expected: agrega `"sharp": "^X.Y.Z"` a las `dependencies` de `package.json` (la versión exacta la resuelve npm).

- [ ] **Step 2: Escribir las pruebas que fallan**

Agregar al inicio de `server/lib/__tests__/walletStamps.test.js`, reemplazando el import:

```js
import { resolveStampLayout, shouldRenderStampStrip, renderStampStripPng, STAMP_SOURCE_PATH } from "../walletStamps.js";
import sharp from "sharp";
```

Y agregar al final del archivo:

```js
describe("renderStampStripPng", () => {
  it("genera un PNG con las dimensiones exactas pedidas (tamaño Apple @3x)", async () => {
    const buf = await renderStampStripPng({ total: 9, remaining: 6, widthPx: 1125, heightPx: 369 });
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1125);
    expect(meta.height).toBe(369);
    expect(meta.hasAlpha).toBe(true);
  });

  it("genera un PNG con las dimensiones exactas pedidas (tamaño Google)", async () => {
    const buf = await renderStampStripPng({ total: 14, remaining: 9, widthPx: 1860, heightPx: 610 });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1860);
    expect(meta.height).toBe(610);
  });

  it("fondo transparente en la esquina (nada dibujado ahí)", async () => {
    const buf = await renderStampStripPng({ total: 7, remaining: 4, widthPx: 375, heightPx: 123 });
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    // Esquina superior-izquierda: RGBA, alpha (4to byte) debe ser 0.
    expect(data[3]).toBe(0);
  });

  it("total 0 (sin franja) devuelve un lienzo transparente sin lanzar", async () => {
    const buf = await renderStampStripPng({ total: 0, remaining: 0, widthPx: 375, heightPx: 123 });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(375);
    expect(meta.height).toBe(123);
  });

  it("STAMP_SOURCE_PATH apunta al asset real generado en la Tarea 1", async () => {
    const meta = await sharp(STAMP_SOURCE_PATH).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: FAIL — `renderStampStripPng is not a function` (o `undefined`).

- [ ] **Step 4: Implementar `renderStampStripPng`**

Agregar al inicio de `server/lib/walletStamps.js` (después del comentario de cabecera, antes de `resolveStampLayout`):

```js
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STAMP_SOURCE_PATH = path.join(__dirname, "..", "..", "wallet-assets", "stamp-tuespacio.png");
```

Y agregar al final del archivo (después de `shouldRenderStampStrip`):

```js
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
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run server/lib/__tests__/walletStamps.test.js`
Expected: `Tests  16 passed (16)`.

- [ ] **Step 6: Inspección visual (opcional pero recomendada)**

Run:
```bash
node -e "
import('./server/lib/walletStamps.js').then(async ({ renderStampStripPng }) => {
  const fs = await import('fs');
  const buf = await renderStampStripPng({ total: 9, remaining: 6, widthPx: 1125, heightPx: 369 });
  fs.writeFileSync('/tmp/stamp-check.png', buf);
  console.log('escrito /tmp/stamp-check.png —', buf.length, 'bytes');
});
"
```
Abrir `/tmp/stamp-check.png` y confirmar visualmente: 5 estampas arriba, 4 abajo, las primeras 3 (de las 9) apagadas, las últimas 6 visibles.

- [ ] **Step 7: Commit**

```bash
git add server/lib/walletStamps.js server/lib/__tests__/walletStamps.test.js package.json package-lock.json
git commit -m "feat(wallet): renderStampStripPng — compone la franja con sharp

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 5: Quitar el sistema viejo de strip + arreglar el bug de `hasIconStampMode` en Google

**Files:**
- Modify: `server/index.js`

**Contexto:** `hasIconStampMode` en `buildGoogleWalletSaveUrl` hoy es `true` para cualquier membresía real (bug descrito arriba), lo que oculta el texto "CLASES DISPONIBLES" sin que nada lo reemplace visualmente. Esta tarea lo conecta a la lógica real.

- [ ] **Step 1: Agregar el import del módulo nuevo**

Localizar (grep `import { isEmailIdentifier }`) y agregar la línea inmediatamente después:

```js
import { isEmailIdentifier } from "./lib/authIdentity.js";
import { resolveStampLayout, shouldRenderStampStrip, renderStampStripPng } from "./lib/walletStamps.js";
```

- [ ] **Step 2: Quitar el sistema viejo (dead code)**

Localizar (grep `const WALLET_STRIP_TOTAL_BUCKETS`) el bloque completo:

```js
const WALLET_STRIP_TOTAL_BUCKETS = [1, 4, 8, 12, 16, 20];

function resolveWalletStripStampState(classLimitRaw, classesRemainingRaw) {
  const classLimit = Number(classLimitRaw ?? 0);
  const classesRemaining = Math.max(0, Number(classesRemainingRaw ?? 0));
  if (!Number.isFinite(classLimit) || classLimit <= 0) {
    return { total: 0, remaining: 0 };
  }
  const nearestTotal = WALLET_STRIP_TOTAL_BUCKETS.reduce((best, current) =>
    Math.abs(current - classLimit) < Math.abs(best - classLimit) ? current : best,
    WALLET_STRIP_TOTAL_BUCKETS[0]);
  const ratio = classLimit > 0 ? Math.min(1, Math.max(0, classesRemaining / classLimit)) : 0;
  const remainingBucket = Math.min(nearestTotal, Math.max(0, Math.round(ratio * nearestTotal)));
  return { total: nearestTotal, remaining: remainingBucket };
}
```

y **eliminarlo por completo** (las nuevas `resolveStampLayout`/`shouldRenderStampStrip` en `server/lib/walletStamps.js` lo reemplazan).

- [ ] **Step 3: Corregir `hasIconStampMode` en `buildGoogleWalletSaveUrl`**

Localizar (grep `const hasIconStampMode = hasMembership && !isUnlimited && classLimit > 0;`) y reemplazar:

```js
  const hasIconStampMode = hasMembership && !isUnlimited && classLimit > 0;
```

por:

```js
  const hasIconStampMode = shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit });
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "fix(wallet): hasIconStampMode en Google usaba un bucket ficticio que siempre era true

resolveWalletStripStampState (sistema de franja retirado hace días) siempre
devolvía un total positivo para cualquier class_limit>0, así que el texto
'CLASES DISPONIBLES' quedaba oculto para TODOS los paquetes reales sin que
ninguna franja lo reemplazara. Se conecta a shouldRenderStampStrip (la lógica
real) y se quita el sistema de buckets muerto.

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 6: Franja real en Apple Wallet (dentro del `.pkpass`)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Corregir `hasIconStampMode` y quitar `shouldUseStampStrip` (dead code) en `generateApplePkpass`**

Localizar (grep `const stripStampState = resolveWalletStripStampState`) el bloque:

```js
  const stripStampState = resolveWalletStripStampState(classLimit, classesRemaining);
  const hasIconStampMode = hasMembership && !isUnlimited && stripStampState.total > 0;
  const membershipHeadline = isUnlimited ? "Membresía" : membershipCategoryLabel;
  const memberDisplayName = truncateWalletField(userName, 22);
  const firstName = truncateWalletField(String(userName || "").trim().split(/\s+/)[0] || "Alumna", 18);
  const nextClassShort = nextBooking
    ? truncateWalletField(
        `${nextBooking.class_name || "Clase"} · ${new Date(nextBooking.date).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}${nextBooking.start_time ? ` ${String(nextBooking.start_time).slice(0, 5)}` : ""}`,
        30,
      )
    : "";
  const planDisplayName = truncateWalletField(
    hasMembership ? (membership.plan_name || `${membershipCategoryLabel} ${isUnlimited ? "Ilimitado" : ""}`.trim()) : "",
    28,
  );
  const shouldUseStampStrip = !hasEventPass && hasMembership && !isUnlimited && stripStampState.total > 0;
```

y reemplazarlo por (nota: se quita la línea de `stripStampState`, se corrige `hasIconStampMode`, y se elimina `shouldUseStampStrip` por no usarse en ningún otro lado del archivo):

```js
  const hasIconStampMode = shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit });
  const membershipHeadline = isUnlimited ? "Membresía" : membershipCategoryLabel;
  const memberDisplayName = truncateWalletField(userName, 22);
  const firstName = truncateWalletField(String(userName || "").trim().split(/\s+/)[0] || "Alumna", 18);
  const nextClassShort = nextBooking
    ? truncateWalletField(
        `${nextBooking.class_name || "Clase"} · ${new Date(nextBooking.date).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}${nextBooking.start_time ? ` ${String(nextBooking.start_time).slice(0, 5)}` : ""}`,
        30,
      )
    : "";
  const planDisplayName = truncateWalletField(
    hasMembership ? (membership.plan_name || `${membershipCategoryLabel} ${isUnlimited ? "Ilimitado" : ""}`.trim()) : "",
    28,
  );
```

- [ ] **Step 2: Quitar las variables `strip*Path` muertas**

Localizar (grep `Sin strip: la franja del medio`) el bloque:

```js
  // Sin strip: la franja del medio ("morado con iconos") era arte de marca ajena
  // (Ophelia). El pase queda limpio: solo logo TEP + campos + QR sobre rosa claro.
  const dynamicStripName = "none";
  const stripPath = null;
  const strip2xPath = null;
  const strip3xPath = null;
```

y **eliminarlo por completo** (las líneas de arriba, `// Sin thumbnail: ...` / `const thumbPath = null; const thumb2xPath = null;`, se quedan igual — solo se quita este bloque de abajo).

- [ ] **Step 3: Generar los buffers reales de la franja**

Localizar (grep `const stripBuffer = readAssetBuffer(stripPath);`) el bloque:

```js
  const stripBuffer = readAssetBuffer(stripPath);
  const strip2xBuffer = readAssetBuffer(strip2xPath) || stripBuffer;
  const strip3xBuffer = readAssetBuffer(strip3xPath) || strip2xBuffer || stripBuffer;
```

y reemplazarlo por:

```js
  const stripBuffer = hasIconStampMode
    ? await renderStampStripPng({ total: classLimit, remaining: classesRemaining, widthPx: 375, heightPx: 123 })
    : null;
  const strip2xBuffer = hasIconStampMode
    ? await renderStampStripPng({ total: classLimit, remaining: classesRemaining, widthPx: 750, heightPx: 246 })
    : null;
  const strip3xBuffer = hasIconStampMode
    ? await renderStampStripPng({ total: classLimit, remaining: classesRemaining, widthPx: 1125, heightPx: 369 })
    : null;
```

(`generateApplePkpass` ya es `async` — el `await` es válido aquí. El bloque que arma `files["strip.png"] = stripBuffer` etc. más abajo NO se toca: ya maneja `null` correctamente.)

- [ ] **Step 4: Limpiar el `console.log` que citaba variables muertas**

Localizar (grep `"stripAsset:", dynamicStripName,`) el bloque:

```js
    "strip:", !!stripBuffer,
    "stripState:", `${stripStampState.remaining}/${stripStampState.total}`,
    "stripAsset:", dynamicStripName,
  );
```

y reemplazarlo por:

```js
    "strip:", !!stripBuffer,
    "stripState:", hasIconStampMode ? `${classesRemaining}/${classLimit}` : "sin franja",
  );
```

- [ ] **Step 5: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(wallet): franja de estampas real dentro del .pkpass de Apple

generateApplePkpass ahora genera strip.png/@2x/@3x con renderStampStripPng
cuando el pase tiene un paquete de clases real (>1), en vez de los null
heredados del sistema de franja retirado. Sin franja en membresías ilimitadas,
pases de evento, o paquetes de 1 clase (ver shouldRenderStampStrip).

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 7: Franja real en Google Wallet (endpoint público + `imageModulesData`)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Agregar el endpoint público de la estampa**

Localizar (grep `app.get("/api/wallet/v1/passes/:passTypeId/:serial"`, el endpoint público de Apple que sirve de plantilla) e insertar el nuevo endpoint **inmediatamente antes** de esa línea:

```js
// GET /api/wallet/stamp-strip/:serial — imagen pública de la franja de
// estampas (la consume Google Wallet vía imageModulesData). Sin auth: Google
// la pide directo, mismo patrón sin autenticación que el endpoint de abajo
// (/api/wallet/v1/passes/:passTypeId/:serial). El :serial es el mismo
// identificador tep_<hex> que ya usa Apple — no es específico de esa
// plataforma pese al nombre de la función que lo parsea.
app.get("/api/wallet/stamp-strip/:serial", async (req, res) => {
  try {
    const userId = parseUserIdFromAppleWalletSerial(req.params.serial);
    if (!userId) return res.status(404).send();
    const snapshot = await getWalletSnapshotForUser(userId);
    if (!snapshot) return res.status(404).send();
    const { membership } = snapshot;
    const hasMembership = !!membership;
    const isUnlimited = hasMembership && (membership.class_limit === null || membership.class_limit >= 9999);
    const classLimit = hasMembership ? Number(membership.class_limit ?? 0) : 0;
    const classesRemaining = hasMembership && !isUnlimited
      ? Math.max(0, Number(membership.classes_remaining ?? classLimit ?? 0))
      : 0;
    const render = shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass: false, classLimit });
    const buffer = await renderStampStripPng({
      total: render ? classLimit : 0,
      remaining: render ? classesRemaining : 0,
      widthPx: 1860,
      heightPx: 610,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (err) {
    console.error("GET /api/wallet/stamp-strip/:serial error:", err.message);
    return res.status(500).send();
  }
});

```

- [ ] **Step 2: Agregar `imageModulesData` a `buildGoogleWalletSaveUrl`**

Localizar (grep `// ── Build loyaltyObject ──`) el bloque:

```js
  // ── Build loyaltyObject ──────────────────────────────────────────────────
  const loyaltyObject = {
```

y reemplazarlo por (agrega el cálculo del serial justo antes, sin tocar nada más):

```js
  // Mismo serial tep_<hex> que usa Apple — identificador general de wallet.
  const stampSerial = buildAppleWalletSerialFromUserId(userId);

  // ── Build loyaltyObject ──────────────────────────────────────────────────
  const loyaltyObject = {
```

Luego, localizar (grep `label: isUnlimited ? "MEMBRESÍA" : "CLASES RESTANTES",`) el bloque:

```js
    ...(hasMembership ? {
      loyaltyPoints: {
        balance: isUnlimited ? { string: "Ilimitado" } : { int: classesRemaining },
        label: isUnlimited ? "MEMBRESÍA" : "CLASES RESTANTES",
      },
    } : {}),
```

y agregar **inmediatamente después** (mismo nivel, dentro del objeto `loyaltyObject`):

```js
    ...(shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit }) ? {
      imageModulesData: [{
        id: "stamp_strip",
        mainImage: {
          sourceUri: { uri: `${BACKEND_ORIGIN}/api/wallet/stamp-strip/${stampSerial}?r=${classesRemaining}-${classLimit}` },
          contentDescription: { defaultValue: { language: "es", value: "Clases restantes" } },
        },
      }],
    } : {}),
```

**Importante:** usa `BACKEND_ORIGIN` (no `SITE_ORIGIN`) — el dominio del frontend no enruta `/api`. El query string `?r=<restantes>-<total>` es cache-busting deliberado: sin él, Google se queda con la primera imagen que vio y nunca refleja clases tomadas después.

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(wallet): franja de estampas real en Google Wallet (endpoint + imageModulesData)

Nuevo endpoint público GET /api/wallet/stamp-strip/:serial (sin auth, mismo
patrón que el web service de Apple) que genera la imagen a demanda. Se
referencia desde imageModulesData del loyaltyObject con un query param de
cache-busting (?r=restantes-total) para que Google vuelva a buscarla cada vez
que cambian las clases restantes.

Co-Authored-By: <MODELO> <noreply@anthropic.com>"
```

---

### Task 8: Verificación final

**Files:** ninguno (solo verificación)

- [ ] **Step 1:** `node --check server/index.js` → sin salida.
- [ ] **Step 2:** `npm test` → todos los tests pasan, incluidos los 16 nuevos de `walletStamps.test.js` (suite completa esperada: los existentes + 16 nuevos).
- [ ] **Step 3:** `npm run build` → `✓ built`.
- [ ] **Step 4 (reproducción local del camino de código):** levantar el backend local. Simular una llamada directa a `renderStampStripPng` (Task 4 Step 6) si no se hizo antes, para confirmar visualmente el resultado una vez más con el código ya integrado.
- [ ] **Step 5 (verificación en producción, tras desplegar):**
  - Descargar el `.pkpass` de una alumna con paquete real (`GET /api/wallet/apple/pkpass` autenticado) y confirmar que el ZIP incluye `strip.png`/`strip@2x.png`/`strip@3x.png`, y que abriéndolo (o extrayendo `strip@3x.png`) se ve la franja correcta para su `classes_remaining`/`class_limit`.
  - `GET /api/wallet/stamp-strip/<serial-de-esa-alumna>` (sin auth) responde `200` con `Content-Type: image/png` y una imagen de 1860×610.
  - `GET /api/wallet/google/save-url` (autenticado, de esa misma alumna) — decodificar el JWT y confirmar que `loyaltyObjects[0].imageModulesData[0].mainImage.sourceUri.uri` apunta a `BACKEND_ORIGIN` (no al dominio del frontend) e incluye `?r=`.
  - Probar con una alumna de **Clase Extra/Suelta** (1 clase): confirmar que NO se genera `strip.png` en su `.pkpass` y que `imageModulesData` está ausente en su `save-url`.
- [ ] **Step 6:** `git status` limpio, `git log --oneline -10`. **NO hacer push** — preguntar a Said.

---

## Self-Review

- **Cobertura del spec:** §3.1 (dirección del consumo, 18% opacidad) → Task 4. §3.2 (acomodo por filas) → Task 2. §3.3 (excepciones sin franja) → Task 3, aplicada en Tasks 6-7. §3.4 (estilo visual, asset limpio) → Task 1, Task 4. §4.1 (módulo `walletStamps.js`) → Tasks 2-4. §4.2 (Apple) → Task 6. §4.3 (Google, cache-busting, `BACKEND_ORIGIN`) → Task 7. §4.4 (sin lógica de negocio nueva) → ningún task toca `classes_remaining`/sincronización. §6 (pruebas) → Tasks 2-4 cubren `resolveStampLayout`/`shouldRenderStampStrip` con los casos exactos pedidos (7, 8, 9, 14, 20) más los estructurales de `renderStampStripPng`. Sin huecos.
- **Placeholders:** ninguno — cada paso trae el bloque de código exacto (ya verificado por ejecución real durante la redacción, no solo por lectura). `<MODELO>` en los commits es intencional.
- **Consistencia de tipos/nombres:** `resolveStampLayout(total)`, `shouldRenderStampStrip({hasMembership, isUnlimited, hasEventPass, classLimit})`, `renderStampStripPng({total, remaining, widthPx, heightPx, sourcePath})` se usan con la MISMA firma en Tasks 2-4 (definición) y Tasks 6-7 (consumo en `server/index.js`). `hasIconStampMode` se reutiliza como el nombre existente (mínimo blast radius) en ambas funciones de pase, ahora con el valor correcto. El bug de `hasIconStampMode`/`resolveWalletStripStampState` se corrige de forma idéntica en Google (Task 5) y Apple (Task 6).
- **Efecto colateral deseado documentado:** Task 5 corrige que el texto "CLASES DISPONIBLES" (Google) vuelva a aparecer para Clase Extra/Suelta (donde no hay franja) — comportamiento correcto, no un bug nuevo.
