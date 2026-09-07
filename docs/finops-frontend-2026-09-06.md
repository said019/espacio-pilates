# Frontend startup overhead

## Prepared change — release gate still open

Replace only the frontend branch of start.sh: invoke the installed serve
14.2.6 entrypoint with Node, instead of keeping npm exec/npx resident.
Same package, args, PORT fallback, SPA routing, file serving and build.
The backend branch remains byte-for-byte unchanged. No dependency updates,
database migrations, storage changes, feature removal or memory caps.

## Evidence

- Source/production both bc45eb3d3d4b1c844c9bb6ad0cc726176bdf5a4a.
- Frontend has SERVE_MODE=frontend, no DATABASE_URL, and references the web API.
  API service web has DATABASE_URL and no SERVE_MODE. They are not duplicates.
- Local Node20.20.2: old process tree166.52MiB vs new91.53MiB after equivalent
  requests; old npm wrapper72.22MiB, old serve94.30MiB, new serve91.53MiB.
- Eleven response cases identical: HTML, SPA routes, JS/CSS, HEAD, range,
  gzip and ETag/304. 132 successful requests per mode; direct process handles
  SIGTERM. Local processes are cleaned up by their own detached process group.
- Existing 158 tests/25 files and build pass locally. CI runs Node20 as well.
- Production observed frontend100.19MB, API101.78MB, PostgreSQL91.20MB.
  These are current samples, not 24h means. Do not subtract the local72MiB
  npm measurement directly from production or call it realized monthly savings.

## Before release

Both Railway services track this repository and execute sh start.sh. Merging
may deploy the API too. Its startup replays several branch migrations and
contains legacy token/review/plan cleanup. Do not merge until either a supported
frontend-only deployment workflow is established or those API startup effects
are audited against read-only production counts/fingerprints and protected.
Do not disable CI/required checks, repoint to a different branch, remove a
service, or point the Railway config setting at an unrelated file as a shortcut.

The shared railway.json start command has higher precedence than dashboard
settings, so a dashboard-only override is insufficient. Source:
[Railway Config as Code](https://docs.railway.com/config-as-code/reference).

After publication confirm effective command, SPA/assets/API target, service
status and logs, database/history conservation, and sustained RAM. Revert
the one-line frontend launcher if needed; no data rollback should be necessary
for a frontend-only rollout.
