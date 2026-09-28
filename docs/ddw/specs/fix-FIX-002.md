# Fix-plan FIX-002: Align Railway deployment with the monorepo and cap runtime memory

| Field | Value |
|-------|-------|
| Ticket | FIX-002 |
| Tier | FIX |
| RCA | docs/ddw/specs/rca-FIX-002.md |
| Date | 2026-09-28 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Problem
The Railway deployment of `main` fails at build: `ERR_PNPM_NO_SCRIPT Missing script: build`. The
auto-generated service runs `pnpm run build` and `npm run start` at the repository root, and a
single service cannot run the API, the web and the email worker. Production has no successful
deployment.

## Root cause
Nothing in the repository defines the deployment (RCA FIX-002). The API can only run through `tsx`,
because its relative imports have no extension and `@argent/shared` exports TypeScript source; the
web start hardcodes port 3000; no start command caps the V8 heap.

## Coverage: RCA → steps
| Requirement | Covered by |
|---|---|
| FR-01 | Step 5, Step 6, Step 7 |
| FR-02 | Step 1, Step 2 |
| FR-03 | Step 1 |
| FR-04 | Step 5 |
| FR-05 | Step 4 |
| FR-06 | Step 5, Step 6, Step 7 |
| NFR-01 | Strategy: no route, schema or migration file changes; only build scripts and config are added |
| NFR-02 | Strategy: the new tests sit in `apps/api/test` and `apps/web/test`; no `src` file changes, so coverage over `*/src/**` is unaffected |
| NFR-03 | Strategy: `--max-old-space-size=320` for API and web, `192` for the worker, asserted by the config test |
| NFR-04 | Strategy: `esbuild` is a devDependency; the bundle externalizes every runtime package already declared |

## Solution — steps
1. `apps/api/scripts/build.mjs` (new) — esbuild JS API build: entry points `src/server.ts`,
   `src/worker.ts`, `src/shared/db/migrate.ts`; `outbase: 'src'`, `outdir: 'dist'`,
   `bundle: true`, `platform: 'node'`, `format: 'esm'`, `target: 'node24'`, `sourcemap: true`, no
   `define`. A plugin marks every bare import external except `@argent/shared` (and its subpaths),
   which is bundled because it exports `.ts` source. Outputs `dist/server.js`, `dist/worker.js` and
   `dist/shared/db/migrate.js`; the migration file keeps its depth, so
   `new URL('../../../drizzle', import.meta.url)` still resolves to `apps/api/drizzle`. JSON imports
   (`render-email.ts` messages) are inlined by esbuild. Exits non-zero on any build error.
2. `apps/api/package.json` — add `"build": "node scripts/build.mjs"` and devDependency
   `"esbuild": "^0.28.2"`; keep the `dev`, `start`, `worker` and `db:migrate` tsx scripts that
   Playwright and local development use.
3. `pnpm-lock.yaml` — regenerated with `pnpm install` so the `apps/api` importer lists `esbuild`;
   CI installs with `--frozen-lockfile` and fails without it.
4. `apps/web/package.json` — `start` becomes `next start` (Next.js reads `PORT`, default 3000);
   `dev` keeps `--port 3000`.
5. `apps/api/railway.json` (new) — `build.builder: RAILPACK`,
   `build.buildCommand: pnpm --filter @argent/api build`,
   `build.watchPatterns: ["apps/api/**", "packages/shared/**", "pnpm-lock.yaml"]`,
   `deploy.preDeployCommand: ["node apps/api/dist/shared/db/migrate.js"]`,
   `deploy.startCommand: node --max-old-space-size=320 apps/api/dist/server.js`,
   `deploy.restartPolicyType: ON_FAILURE`, `deploy.restartPolicyMaxRetries: 10`. No `variables`.
6. `apps/api/railway.worker.json` (new) — same build and watch patterns;
   `deploy.startCommand: node --max-old-space-size=192 apps/api/dist/worker.js`; same restart
   policy; no pre-deploy command (the API service owns migrations). No `variables`.
7. `apps/web/railway.json` (new) — `build.buildCommand: pnpm --filter @argent/web build`,
   `build.watchPatterns: ["apps/web/**", "packages/shared/**", "pnpm-lock.yaml"]`,
   `deploy.startCommand: NODE_OPTIONS=--max-old-space-size=320 pnpm --filter @argent/web start`;
   same restart policy. No `variables`.
8. `AGENTS.md` — add a `Build` row to the Stack table:
   `pnpm --filter @argent/api build`, `pnpm --filter @argent/web build`.
9. `CHANGELOG.md` — `### Fixed` entry for FIX-002 (written at CLOSEOUT).

After merge, applied by hand in Railway with the user's confirmation for each change (outside the
repository): split the `argent` service into `argent-api`, `argent-worker` and `argent-web` with
root directory `/` and config file paths `apps/api/railway.json`, `apps/api/railway.worker.json`
and `apps/web/railway.json`; set `NODE_ENV=production` and the variables `parseEnv` requires;
no public domain for the worker.

## Data model
**Data model**
No change: no table, column, index, default or constraint is added or modified. The existing
migrations in `apps/api/drizzle` are applied as they are; only the process that runs them moves
from `tsx` to the built `node` entry point.

## Dependencies between steps
Step 2 before Step 3 (the lockfile follows `package.json`). Step 1 and Step 2 before the build
tests. Steps 4 to 8 are independent. Step 9 happens at CLOSEOUT.

## Error handling
- The esbuild build fails (syntax error, unresolved import) — `build.mjs` exits with code 1 and
  esbuild's message; Railway marks the build failed and keeps the previous deployment serving.
- The built migration runs without `DATABASE_URL` — exits with code 1 and
  `DATABASE_URL is required to run migrations`; the pre-deploy step fails and the deployment is
  cancelled.
- A migration fails against the database — the migration process rejects and exits non-zero; the
  pre-deploy step fails and the new API version never starts.
- A process exceeds its heap cap — V8 aborts with `Reached heap limit`; Railway restarts it under
  `ON_FAILURE`, at most 10 times.

## Tests
- [ ] **Regression test** — `apps/api/test/deploy/build-output.test.ts`: running the API `build`
      script produces `dist/server.js`, `dist/worker.js` and `dist/shared/db/migrate.js`, and none
      of them imports `tsx` or a `.ts` file; fails BEFORE the fix (no `build` script), passes AFTER
      — validates AC-02.
- [ ] `build-output.test.ts`: the built bundles contain no inlined value of a test-only
      environment variable set during the build — threat R-01.
- [ ] `build-output.test.ts`: the built migration applied with `node` to a throwaway empty
      database (`argent_migration_test` pattern from `test/identity/migration.test.ts`) creates
      every table in `apps/api/drizzle` — validates AC-03.
- [ ] Missing `DATABASE_URL` error — `build-output.test.ts`: the built migration run with
      `DATABASE_URL` deleted from the child environment exits with code 1 and names
      `DATABASE_URL` — validates AC-04.
- [ ] Migration error — `build-output.test.ts`: the built migration run against an unreachable
      database URL exits non-zero.
- [ ] Build error — `build-output.test.ts`: a build with a missing entry point exits with code 1
      (the build script accepts an entry-point override for this test).
- [ ] `apps/api/test/deploy/railway-config.test.ts`: each of the three configs builds with
      `pnpm --filter <its package>` and starts with pnpm or node, never npm — validates AC-01.
- [ ] `railway-config.test.ts`: the API config's `preDeployCommand` runs the built migration, and
      the worker and web configs have none — validates AC-05.
- [ ] Heap limit error — `railway-config.test.ts`: start commands carry `--max-old-space-size` 320
      (API, web) and 192 (worker); build commands carry none; restart policy is `ON_FAILURE` with
      at most 10 retries — validates AC-07.
- [ ] `railway-config.test.ts`: no config has a `variables` key — threat R-01.
- [ ] `apps/web/test/start-script.test.ts`: the web `start` script passes no `--port`/`-p` flag,
      so Next.js listens on `PORT` — validates AC-06.

## Regression risk
Medium — the API now runs from a bundle in production while tests and local development still run
the TypeScript source through `tsx`, so a bundling-only defect (a path lookup, a dynamic import)
would show up only in the built output. The build-output tests run the built migration for real,
and the impact scan found no other `import.meta.url`, `__dirname` or dynamic import in
`apps/api/src` or `packages/shared/src`.

## Rollback plan *(mandatory)*
- Steps: revert the merge commit on `main`; in Railway, point the services back to no config file
  (or pause them) — the previous deployment keeps serving while a build fails, so reverting never
  takes a running service down.
- Indicators: a deployment that builds but crashes on start (`ERR_MODULE_NOT_FOUND`, missing
  migrations folder), restart loops on the heap cap in Railway Metrics, or the pre-deploy migration
  failing on a database that migrates fine with `pnpm db:migrate`.
