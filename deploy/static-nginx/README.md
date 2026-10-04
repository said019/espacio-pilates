# Espacio: runtime estático nginx

Este cambio prepara una imagen de frontend independiente. Usa el patrón validado en BMB: nginx 1.30.5 Alpine 3.24 fijado por digest, dos workers, raíz pública dedicada y Brotli estático fijado por commit. El patch de una línea `allow_ranges` conserva rangos 206/416 e If-Range sobre `.br`. No añade caché duradera, proxy ni procesos Node al runtime.

La base revisada es `b34257c3a7f55c56ac63fb04619b06149f888aef`. Código de cliente, archivos públicos, package/lock, Caddyfile, Nixpacks y arranque existentes permanecen intactos. El builder conserva Node 20 (fijado a 20.18.1), `NODE_ENV=production` y el compresor actual. La imagen final contiene exactamente el `dist` de ese build bajo `/srv/frontend/public`; no sirve los archivos por defecto de nginx. Se conservan SPA, redirects, Content-Type, HEAD, ETag, 304, compresión y rangos. PORT conserva el default 3000 y se valida antes de arrancar. El sello del service worker conserva el contrato actual; todos los archivos públicos originales se verifican por SHA-256.

Sólo se admiten al contexto Docker fuentes y assets de frontend mediante `Dockerfile.dockerignore`; `.env*`, backend, base de datos y credenciales quedan fuera. Los únicos argumentos son públicos: `VITE_API_URL, RAILWAY_GIT_COMMIT_SHA, VITE_MP_PUBLIC_KEY`. Deben conservarse los valores del servicio al publicar; la CI usa fixtures `example.invalid` y claves públicas sintéticas. No ejecuta JavaScript en navegador, ni llama APIs, DB o integraciones.

## CI y reproducción

Desde `la raíz del repositorio`:

```sh
docker build -f deploy/static-nginx/Dockerfile --target app-builder -t static-app-builder \
  --build-arg VITE_API_URL=https://example.invalid/api \
  --build-arg RAILWAY_GIT_COMMIT_SHA="$(git rev-parse HEAD)" \
  --build-arg VITE_MP_PUBLIC_KEY=TEST-static-contract-fixture .
```

El workflow `Frontend nginx contract` construye también la imagen final con los mismos argumentos, verifica todo el árbol y publica `nginx-build-artifact-result.json` con SHA del checkout, lock, Caddyfile, modo y hashes de cada original/variante `.br/.gz`. Compara el mismo build en nginx y Caddy 2.11.4 fijado por digest, recorre rutas reales de `src/App.tsx` y todos los assets, y prueba redirects, MIME, HEAD, ETag/304, 206/416/If-Range, negociación gzip/Brotli, workers y PORT inválido. Limpia sus contenedores y volúmenes temporales. No ejecuta otro benchmark sintético de RAM.

## Compatibilidad de arranque y recuperación del 4 de octubre de 2026

La adopción IaC informó SUCCESS pero el frontend devolvió 502: al quedar vacío el selector legacy, Railway autodescubrió el `railway.json` compartido y ejecutó `sh start.sh`. Ese archivo no existía en la imagen nginx. Se recuperó el frontend mediante rollback oficial al deployment nginx previo; la API no se modificó. **La adopción no está completa** y un apply exitoso no demuestra que la página responda.

La imagen frontend ahora fija `WORKDIR /srv/frontend` y contiene su propio `start.sh`, fuera de `/srv/frontend/public`. Ese wrapper hace `exec /usr/local/bin/start-static-nginx`; el launcher termina en nginx como PID 1. No copia ni cambia el `start.sh` de raíz, que sigue perteneciendo al arranque compartido/API. Tanto el CMD normal como el override heredado `sh start.sh` ejecutan el mismo launcher, con la misma validación de PORT. Los contratos inician ambos desde el WorkingDir real, comprueban PID 1, HTTP/HEAD y rechazo de PORT inválido. El partial añade healthcheck HTTP `/`; antes de otra adopción debe comprobarse que el deployment efectivo conserva ese healthcheck, Dockerfile, artefacto y arranque.

## Selección durable del rol frontend

API y frontend comparten la raíz, `package.json`, assets y el build. Por eso **no se añade un Dockerfile global ni se cambia `railway.json`/`start.sh` de raíz**: la API `web` necesita `server/`, `public/`, `dist/` y migraciones. El runtime nginx conserva su CMD `/usr/local/bin/start-static-nginx`, contexto raíz y todos los argumentos públicos del build; no se eliminan las validaciones `test -n`.

Para el frontend existente, [.railway/railway.ts](../../.railway/railway.ts) declara una configuración IaC parcial que conserva fuente, dominios, región, launcher y variables con `preserve()`. Su documentación y contratos están en [.railway/README.md](../../.railway/README.md). Tras el incidente, la adopción sigue pendiente de un plan revisado y de una publicación con salud HTTP comprobada: merge del código por sí solo **no aplica IaC**. No se asume que el archivo alternativo siga seleccionado tras la migración; vaciar el selector no desactiva la autodetección. El backend nunca forma parte de este partial.

Para un proyecto nuevo, crear explícitamente un servicio **frontend**, raíz del repo, y configurar `RAILWAY_DOCKERFILE_PATH=deploy/static-nginx/Dockerfile` junto con los valores públicos `VITE_API_URL` y `VITE_MP_PUBLIC_KEY`; el despliegue desde Git aporta `RAILWAY_GIT_COMMIT_SHA`. Dejar el start command sin override para usar el CMD de Docker. Esta [selección de Dockerfile mediante variable](https://docs.railway.com/builds/dockerfiles) es soportada; no depende de `railway.json`. La API se configura como un servicio aparte con su DB/secretos existentes: este comando no la crea ni deduce sus credenciales.

[Config as Code está retirándose](https://docs.railway.com/config-as-code): los archivos JSON sólo continúan para servicios existentes hasta el 1 de diciembre de 2026 y no admiten nuevos servicios. No seleccionar el JSON nginx para la API ni reutilizar sin revisión los IDs/dominios del partial en otro proyecto.

Antes de fusionar o adoptar IaC, revisar los watchPatterns de API para excluir `.railway/**` además de los archivos frontend ya excluidos, conservando todos los paths de negocio. Tras una publicación coordinada, comprobar deployment/artefactos/HTTP y que la API conserve su deployment. Rollback del frontend: restaurar su configuración anterior y el deployment nginx verificado; no cambiar la raíz/API ni usar Caddy dentro de una imagen nginx.

El beneficio esperado es pequeño. La comparación BMB previa mostró una reducción local de memoria total, con fuerte componente de archivos/cache; no acredita ahorro facturado aquí. El coste completo previo de RAM es un techo imposible de eliminar, no una previsión. Cuantificar sólo con ventanas comparables después de un despliegue verificado.
