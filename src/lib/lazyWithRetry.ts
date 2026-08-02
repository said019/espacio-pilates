import { lazy, type ComponentType } from "react";

/**
 * React.lazy con reintento.
 *
 * Por qué existe: cada página se carga con import() dinámico (code-splitting).
 * Si ese chunk no baja —red móvil intermitente, o un deploy nuevo que borró el
 * archivo con hash viejo que el navegador tenía en su index.html cacheado— la
 * promesa se rechaza, Suspense revienta y la clienta ve una PANTALLA EN BLANCO
 * sin forma de recuperarse. Desde otra sesión recién cargada todo se ve bien,
 * porque ahí el HTML sí apunta a los chunks que existen.
 *
 * Estrategia: reintentar una vez (cubre el parpadeo de red) y, si vuelve a
 * fallar, recargar la página una sola vez (cubre el deploy nuevo). El flag en
 * sessionStorage evita un bucle de recargas si el servidor está caído.
 */

const RELOAD_KEY = "tep_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 20_000;

function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "");
  return /dynamically imported module|Importing a module script failed|module script failed|ChunkLoadError|Loading chunk|Failed to fetch/i.test(msg);
}

function readReloadStamp(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function writeReloadStamp(value: number) {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(value));
  } catch {
    /* modo privado / storage bloqueado: seguimos sin flag */
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;

      await new Promise((r) => setTimeout(r, 700));
      try {
        return await factory();
      } catch (retryErr) {
        const now = Date.now();
        if (now - readReloadStamp() > RELOAD_COOLDOWN_MS) {
          writeReloadStamp(now);
          window.location.reload();
          // La página se va: nunca resolvemos para no pintar nada intermedio.
          return new Promise<never>(() => {});
        }
        // Ya recargamos hace poco y sigue fallando → que lo tome el ErrorBoundary.
        throw retryErr;
      }
    }
  });
}
