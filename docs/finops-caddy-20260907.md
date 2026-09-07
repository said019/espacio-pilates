# Espacio: static runtime optimization

Scope: frontend only, based on active source `fb3f3ae0f2a057aa814d646336ac1ccef1697504`. No changes to server/src/public, Vite configuration, dependency versions or lockfiles, payments, bookings, notifications or Wallet resources.

The shared start.sh keeps its backend branch exactly unchanged (`exec node server/index.js`). Only SERVE_MODE=frontend starts verified Caddy 2.11.4. Both Railway and Nixpacks continue invoking sh start.sh. Build preparation is conditional on SERVE_MODE=frontend, so future backend builds do not need the static runtime. Existing PORT fallback 3000 and Railway TLS remain unchanged.

The build-only script verifies the official release archive against pinned SHA-512, keeps the Caddy license, rejects symlinks and creates Brotli/gzip sidecars without modifying originals. Administration, automatic HTTPS, persistence and directory browsing are disabled. The file root is dist only.

## Tests

```sh
npm test
npm run build
node scripts/prepare-static-runtime.mjs
node scripts/test-caddy-static.mjs
node scripts/finops-frontend-check.mjs
```

The contract test compares direct Node serve with the real shared launcher in frontend mode: 38 routes, 609 files, 653 equivalent GET paths, exact service-worker preservation, manifest, images, Wallet assets, MIME/cache, ranges, HEAD, conditional requests, corrupt archive rejection and compressed content. The entry asset is read from HTML rather than selecting the first index chunk; this app has many small lazy-loaded index chunks.

The existing launcher regression remains: 11 HTTP cases, repeated local requests, lower process-tree RSS, one process, SIGTERM termination and unchanged backend branch. ETags are validated against each server's own conditional response, not compared as opaque strings; JavaScript MIME aliases are normalized. HEAD has no body and Caddy advertises the compressed GET representation whereas Node omits this metadata; status, zero body, MIME and cache remain checked. These are valid protocol differences, not removed feature checks.

Invalid /sw.js/ redirects to canonical /sw.js instead of SPA HTML; traversal /../package.json returns only public SPA HTML instead of 400, never repository files. Valid URLs retain content. No production logins, bookings, payments or push registrations are used for these tests.

Railway pre-deploy 24h: 360 in-window samples, mean 0.1004708212 GB, max 0.2014754133 GB, last 0.080367616 GB. Decimal MB = GB * 1000. Local memory measurements are not Railway savings; compare post-deploy full windows before claiming monthly savings.

## Deploy safely

Temporarily guard backend watch paths with `/server/**` before the frontend-only merge, then restore the original empty list after checks. Do not redeploy backend or Postgres. Wait for normal CI; do not bypass failures. Confirm active frontend SUCCESS/stopped=false, frontend mode and actual Caddy startup. Verify both domains and baseline hashes/cache, including all bytes of sw.js. This backend has no dedicated /api/health endpoint: use its public SELECT-only /api/branches response and unchanged healthy deployment instead.

Rollback: restore only the frontend to previous deployment `70271569-a594-4a7e-8415-6908ae5e111d`, or revert the frontend change through GitHub with backend watch protection. Previous frontend launcher line: `exec node node_modules/serve/build/main.js -s dist -l "${PORT:-3000}"`. No reverse database migration or data deletion is involved.

References: [Caddy file_server](https://caddyserver.com/docs/caddyfile/directives/file_server), [try_files](https://caddyserver.com/docs/caddyfile/directives/try_files), [verified release](https://github.com/caddyserver/caddy/releases/tag/v2.11.4).
