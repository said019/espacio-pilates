# Estampas de asistencia en Apple/Google Wallet — Diseño

**Fecha:** 2026-07-03
**Proyecto:** Tu Espacio Pilates · Villa Magna

## 1. Motivo

El pase de Wallet ya muestra "CLASES RESTANTES" como texto. La dueña quiere que además se vea como una **franja de estampas** (una por clase del paquete), que se van "consumiendo" (apagando) conforme la alumna toma sus clases — igual que una tarjeta de sellos física, pero mostrando lo que **queda**, no lo que se ha ganado.

La estampa es la figura de pilates de la marca (`stamp tuespacio.jpeg`, en la raíz del repo — línea negra sobre fondo blanco, 998×998).

**Contraste con el sistema anterior:** el código ya tenía un sistema de "strip" (retirado hace unos días por traer arte de otra marca) que usaba 6 totales fijos e inventados (1/4/8/12/16/20) con ~150 imágenes PNG pre-renderizadas, una por cada combinación de total×restantes×categoría. Este diseño lo reemplaza por **totales reales, tomados del `classLimit` de los planes que de verdad se venden**, y la imagen se **compone en el momento** (no se pre-renderiza nada).

## 2. Estado verificado

- **Planes activos hoy** (`GET /api/plans` en producción): Paquete 7 Clases (`classLimit=7`), Paquete 9 Clases (`classLimit=9`), Paquete 14 Clases (`classLimit=14`), Clase Extra (`classLimit=1`), Clase Suelta/Visita (`classLimit=1`), Inscripción (`classLimit=0`, no es paquete de clases). Ningún plan ilimitado a la venta hoy.
- El pase (Apple y Google) ya calcula `classLimit`, `classesRemaining`, `isUnlimited`, `hasMembership`, `hasEventPass` al momento de generarse (`generateApplePkpass` / `buildGoogleWalletSaveUrl`, vía `getWalletSnapshotForUser`). No hace falta lógica nueva de negocio: la franja solo **dibuja** esos números.
- El pase ya se re-sincroniza automáticamente en cada reserva, cancelación, check-in, etc. (`triggerWalletPassSync` → `syncGoogleWalletObjectForUser` / `notifyApplePassUpdatedForUser`). La franja se actualiza sola con esa misma maquinaria.
- No hay ninguna librería de composición de imágenes instalada (`sharp`, `jimp`, `canvas`) — se agrega `sharp` como dependencia nueva. El build de Railway (`nixpacks.toml`, Node 20 estándar) la soporta sin cambios.
- Existe un identificador por-alumna ya público y usado hoy para Apple: el serial `tep_<uuid-sin-guiones>` (`buildAppleWalletSerialFromUserId` / `parseUserIdFromAppleWalletSerial`), expuesto sin autenticación en `GET /api/wallet/v1/passes/:passTypeId/:serial`. Se reutiliza el mismo serial para el endpoint público de la estampa de Google (es un identificador general de wallet, no específico de Apple pese al nombre de la función).
- Medidas reales verificadas contra documentación oficial:
  - **Apple** `strip.png` (pase `storeCard`): 375×123pt @1x → **1125×369px @3x** (relación ~3:1). Nuestro pase no usa `primaryFields` (queda vacío salvo flag), así que ningún texto se sobrepone a la franja.
  - **Google** `imageModulesData.mainImage`: ancho mínimo recomendado **1860px**, "imágenes anchas y rectangulares", alto proporcional. Se usará **1860×610px** (~3:1, misma proporción que Apple para que se vean consistentes entre plataformas).

## 3. Diseño aprobado (validado con mockups)

### 3.1 Dirección del "consumo"
Las estampas **arrancan visibles** (la figura en tinta, opacidad 100%) y las que ya se usaron se **apagan** (escala de grises + 18% opacidad), de izquierda a derecha y de arriba hacia abajo. Lo que queda a la vista, resaltado, es lo que le queda a la alumna — coincide con el campo de texto "CLASES RESTANTES" que ya tiene el pase. (Se descartó la metáfora clásica de tarjeta de sellos —estampas vacías que se van "llenando"— porque aquí no es una recompensa que se gana, es un paquete prepagado que se gasta.)

### 3.2 Acomodo por filas
Regla general (no hay totales hardcodeados; se calcula del `classLimit` real):
- **Total ≤ 7** → una sola fila.
- **Total > 7** → dos filas: `ceil(total/2)` arriba, `floor(total/2)` abajo.

Con los planes reales de hoy: **7 → 1 fila de 7**. **9 → 5 arriba + 4 abajo**. **14 → 7 arriba + 7 abajo**. Un paquete futuro de cualquier otro tamaño se acomoda solo con esta misma regla, sin tocar código.

### 3.3 Excepciones — sin franja de estampas
- **Clase Extra y Clase Suelta/Visita** (`classLimit=1`): sin franja. Una sola estampa no comunica nada útil; se deja solo el texto "1/1" / "0/1" que el pase ya muestra hoy.
- **Membresía ilimitada** (`isUnlimited`): sin franja (no hay total que dibujar). Sin cambio respecto a hoy.
- **Pase de evento** (`hasEventPass`): sin franja (no aplica, es otro tipo de pase). Sin cambio respecto a hoy.
- **Sin membresía activa**: sin franja.

### 3.4 Estilo visual
- Imagen fuente: `stamp tuespacio.jpeg` (figura de pilates, línea negra). Se limpia **una sola vez** (fondo blanco → transparente) y se guarda como asset del repo — no se reprocesa en cada arranque del servidor.
- Estampa "restante": la figura en tinta a opacidad 100%, sin recolorear (coincide con el resto del texto del pase, que ya usa tinta `#3A3832`).
- Estampa "usada": escala de grises + 18% de opacidad.
- Fondo de la franja: transparente (deja ver el rosa claro `#D9B5BA` del pase, o la tinta `#3D2D31` en pases de evento — aunque estos últimos no llevan franja por 3.3).

## 4. Arquitectura

### 4.1 Módulo nuevo: `server/lib/walletStamps.js`
Sigue el patrón ya usado en el repo (`server/lib/push.js`, `mercadopago.js`, etc.: lógica pura y testable, separada de `server/index.js`). Expone:

- **`resolveStampLayout(total)`** — función pura. Devuelve el arreglo de estampas por fila (`[7]`, `[5,4]`, `[7,7]`, etc.) según la regla de 3.2. Sin dependencias de red ni de imagen — 100% unit-testeable.
- **`renderStampStripPng({ total, remaining, widthPx, heightPx })`** — usa `sharp` para componer la franja: coloca cada estampa (restante u usada, según su posición) en su fila/columna sobre un lienzo transparente de `widthPx`×`heightPx`, devuelve un `Buffer` PNG. Toma como entrada el asset limpio (`wallet-assets/stamp-tuespacio.png`) cacheado en memoria (leído de disco una vez, reutilizado en cada llamada — no se relee el archivo en cada request).
- **`shouldRenderStampStrip({ hasMembership, isUnlimited, hasEventPass, classLimit })`** — función pura con la lógica de 3.3 (excepciones), reutilizada por Apple y Google para no duplicar el criterio.

### 4.2 Apple — dentro del `.pkpass`
En `generateApplePkpass`, cuando `shouldRenderStampStrip(...)` es verdadero: llamar `renderStampStripPng` tres veces (375×123px para `strip.png`, 750×246px para `strip@2x.png`, 1125×369px para `strip@3x.png`) y agregar los tres al mapa de `files` del ZIP — mismo mecanismo que ya usa el resto de los assets del pase (icon/logo). Cuando es falso, no se agregan esos archivos (Apple simplemente no muestra franja).

### 4.3 Google — endpoint público nuevo
`GET /api/wallet/stamp-strip/:serial.png` (sin `authMiddleware`, mismo patrón que `/api/wallet/v1/passes/:passTypeId/:serial`): resuelve `userId` desde el serial, carga el snapshot, calcula el layout, llama a `renderStampStripPng` a 1860×610px, responde `Content-Type: image/png`.

En `buildGoogleWalletSaveUrl`, cuando `shouldRenderStampStrip(...)` es verdadero, se agrega:
```js
imageModulesData: [{
  id: "stamp_strip",
  mainImage: {
    sourceUri: { uri: `${BACKEND_ORIGIN}/api/wallet/stamp-strip/${serial}.png?r=${classesRemaining}-${classLimit}` },
    contentDescription: { defaultValue: { language: "es", value: "Clases restantes" } },
  },
}]
```
**Importante:** la URL usa `BACKEND_ORIGIN` (no `SITE_ORIGIN`) — el dominio del frontend no enruta `/api` (lección aprendida esta semana con el `webServiceURL` de Apple). El query string `?r=<restantes>-<total>` es **cache-busting deliberado**: Google Wallet cachea las imágenes por URL; sin este parámetro cambiante, la franja se quedaría pegada en el primer estado que Google haya visto y nunca reflejaría clases tomadas después. Cada vez que cambian las clases restantes, la URL cambia, y como el objeto ya se re-envía (PUT) en cada sincronización existente, Google la vuelve a buscar.

### 4.4 Sin lógica de negocio nueva
No se toca cómo se calculan `classesRemaining`/`classLimit`, ni cuándo se dispara la sincronización — eso ya existe. Este trabajo es puramente de renderizado.

## 5. Fuera de alcance
- Rediseñar las estampas de eventos (fuera de alcance; los pases de evento no llevan franja).
- Un modo alterno de franja para membresías ilimitadas (no aplica, no hay total).
- Migrar o borrar las ~150 imágenes `wallet-strip-*.png` legadas en `public/` (quedan huérfanas pero inofensivas; se pueden limpiar en otra tanda si se quiere).

## 6. Pruebas
- `resolveStampLayout`: casos 1 (sin franja, ver 3.3), 7→`[7]`, 8→`[4,4]`, 9→`[5,4]`, 14→`[7,7]`, 20→`[10,10]` (generalización).
- `shouldRenderStampStrip`: casos con/sin membresía, ilimitada, evento, `classLimit` 1 vs >1.
- `node --check`, `npm test` (suite existente + los tests nuevos de `walletStamps.js`), `npm run build`.
- Verificación real: descargar el `.pkpass` generado y confirmar visualmente el strip; verificar en producción que `GET /api/wallet/stamp-strip/<serial>.png` responde una imagen válida y que el `save-url` de Google incluye `imageModulesData` con la URL correcta (incluye `?r=`).
