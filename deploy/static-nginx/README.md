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

## Activación coordinada sólo del frontend

Este PR no sustituye la configuración raíz ni selecciona el nuevo Dockerfile automáticamente. Antes de activar, comprobar repo, rama, raíz `/` y servicio frontend exactos. Seleccionar `deploy/static-nginx/Dockerfile` con contexto `/` y arranque `/usr/local/bin/start-static-nginx`, conservando dominios, PORT, variables públicas y healthcheck. `deploy/static-nginx/railway.json` es la configuración alternativa que puede seleccionarse explícitamente para ese servicio. No seleccionar ese archivo en el backend. Verificar overrides efectivos de build y arranque y los triggers de servicios compartidos antes de fusionar o publicar; el merge puede disparar el despliegue automático ya existente aunque los archivos de arranque no cambien.

Tras publicar, comparar el árbol público y hashes con el artefacto CI de la misma revisión, argumentos públicos y sello, comprobar HTTP/rutas/workers y confirmar que el deployment de API no cambió. Rollback: seleccionar el deployment anterior y sus builder/arranque Caddy originales; no ejecutar Caddy dentro de la imagen nginx.

El beneficio esperado es pequeño. La comparación BMB previa mostró una reducción local de memoria total, con fuerte componente de archivos/cache; no acredita ahorro facturado aquí. El coste completo previo de RAM es un techo imposible de eliminar, no una previsión. Cuantificar sólo con ventanas comparables después de un despliegue verificado.
