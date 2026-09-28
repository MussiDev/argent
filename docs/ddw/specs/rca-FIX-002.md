# RCA FIX-002: Align Railway deployment with the monorepo and cap runtime memory

| Field | Value |
|-------|-------|
| Ticket | FIX-002 |
| Tracker | none |
| Date | 2026-09-28 |
| Origin | Failed Railway deployment of `main` at `a217c64` (merge of PR #2) |
| Related PRD | `docs/ddw/prd/prd-DISC-001-01a.md` (NFR-07, NFR-09, NFR-11; no gap) |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

The `argent` service on Railway (project `nortear`, environment `production`) failed its first
build after PR #2 merged. The repository carries no deployment definition, so Railway
auto-configured a single service at the repository root. The account shares a compute usage limit
with other projects ($18.70 of $20 used on 2026-09-28), so the deployment must also avoid
unbounded memory: Railway bills resident memory per minute, and V8 sizes its default heap from the
host, not the container.

### Root cause — no deployment definition for a three-process monorepo

- **Component:** deployment configuration (root `package.json`, `apps/api/package.json`,
  `apps/web/package.json`; no `railway.json` exists).
- **Chain of events:**
  1. Railway builds the repository root with Railpack and the auto-detected command
     `pnpm run build`.
  2. The root `package.json` has no `build` script: `ERR_PNPM_NO_SCRIPT Missing script: build`, and
     the image is never built.
  3. Even with a build, the start command is `npm run start`: the package manager is pnpm, and the
     root has no `start` script.
  4. The monorepo runs three long-lived processes — API (`apps/api/src/server.ts`), web
     (`next start`) and email worker (`apps/api/src/worker.ts`) — plus a migration step
     (`apps/api/src/shared/db/migrate.ts`); one service cannot run them.
- **Technical root cause:** the deployment was never defined in the repository. Beyond the missing
  scripts, the API can only run through `tsx`: its relative imports have no file extension and
  `@argent/shared` exports TypeScript source (`packages/shared/package.json` `exports` →
  `./src/index.ts`), so plain `node` cannot load it without a build step that bundles the shared
  package. `migrate.ts` locates the SQL migrations relative to its own file
  (`new URL('../../../drizzle', import.meta.url)`), which breaks if the file moves in a build.
  `apps/web` starts on a hardcoded `--port 3000` instead of the port the platform assigns. No start
  command caps the V8 heap.
- **Impact:** production is offline (no successful deployment exists). Once fixed naively, `tsx`
  keeps esbuild resident in every API and worker process, and an uncapped heap grows with each
  traffic peak and is billed for as long as the container lives.

## Goals

- `main` deploys on Railway as three services (API, web, email worker) that build and start.
- Every long-running process has a bounded heap, set only where the process starts.

## Functional Requirements

- FR-01: The repository must declare one deployment definition per service (API, web, email
  worker) with its build command, start command and restart policy, all using pnpm.
- FR-02: The API build must produce JavaScript that plain `node` runs for the server, the email
  worker and the migration entry point, with no `tsx` at runtime.
- FR-03: The migration entry point must find the SQL migrations in `apps/api/drizzle` when run
  from the build output.
- FR-04: The API deployment must apply pending migrations before the new API version starts
  serving.
- FR-05: The web start command must listen on the port given by the `PORT` environment variable.
- FR-06: Each long-running start command must cap the V8 old-space heap in the command itself, not
  through a service-level `NODE_OPTIONS` variable that also applies to the build.

## Non-Functional Requirements

- NFR-01: The fix changes 0 HTTP contracts, 0 database columns and 0 migrations.
- NFR-02: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.
- NFR-03: The heap cap is `--max-old-space-size=320` (MB) for the API and the web, and
  `--max-old-space-size=192` for the email worker.
- NFR-04: The fix adds 0 runtime dependencies.

## Acceptance Criteria

- AC-01 (FR-01): WHEN Railway builds a service from its deployment definition, THE build SHALL use
  pnpm and build only that service's workspace package and its workspace dependencies.
- AC-02 (FR-02): WHEN the API build finishes, THE output SHALL contain server, worker and migration
  entry points that start with `node` and do not import `tsx` or any `.ts` file.
- AC-03 (FR-03): WHEN the built migration entry point runs against an empty database, THE system
  SHALL apply every migration in `apps/api/drizzle`.
- AC-04 (FR-03): IF the built migration entry point runs without `DATABASE_URL`, THEN THE process
  SHALL exit with a non-zero code and a message naming the variable.
- AC-05 (FR-04): WHEN an API deployment starts, THE platform SHALL run the migration entry point
  before the new API process starts, and SHALL NOT start it if the migration fails.
- AC-06 (FR-05): WHEN `PORT` is set, THE web server SHALL listen on that port.
- AC-07 (FR-06): WHEN any of the three services starts, THE start command SHALL carry the NFR-03
  heap cap, and the build commands SHALL carry none.

## Out of Scope

- A custom domain. NFR-11 (web and API under one registrable domain) cannot hold on
  `*.up.railway.app`, which is on the Public Suffix List; sign-in across web and API stays broken
  in production until a domain exists. Assumption recorded on 2026-09-28: the user has not chosen
  one yet.
- Railway-side settings that live outside the repository: creating the services, environment
  variables, the database, Serverless and CDN caching. They are applied by hand after this fix,
  with the user's confirmation for each.
- Separate database roles for migrations (SAST DISC-001-01a, I-03).

## Risks and Mitigations

- **Heap cap too low:** a process hitting the cap restarts in a loop. Mitigation: the restart
  policy is bounded, and the caps sit above the resident memory measured on similar services
  (Next.js and an Express API ran under 320 MB in project `nortear`); raise them if restarts appear.
  The worker's 192 MB is an estimate, not a measurement: it only polls the outbox every 2 s and
  sends email. User decision 2026-09-28: keep 192 MB and revisit it against Railway Metrics.
- **Bundle breaks a path lookup:** anything that resolves files relative to `import.meta.url`
  (migrations today) can break when bundled. Mitigation: AC-03 runs the built migration entry
  point against a real database.
- **Migrations and serving race:** two API replicas starting together could both migrate.
  Mitigation: one replica today, and drizzle's migrator records applied migrations in a table.

## Dependencies

- Railway config-as-code (`railway.json`) with a per-service config file path.
- The existing `DATABASE_URL`, `PORT` and origin variables parsed by
  `apps/api/src/shared/config/env.ts` and `apps/web/src/lib/web-env.ts`.
