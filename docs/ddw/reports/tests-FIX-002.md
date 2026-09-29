# Test run FIX-002

Second closeout run, after the corrective loop that switched the web start command to `node`
(the first run, 517/517, is in git history at `6e1aaed`).

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (Node 24.13.1, win32-x64) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 520 |
| Passed | 518 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 95.28% |
| Branch coverage | 92.32% |
| Function coverage | 92.74% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm audit --prod --audit-level high` — no known vulnerabilities; Prettier clean on every changed file (the local Windows checkout converts to CRLF, which `prettier --check .` reports on every file; CI checks out LF) |

## New tests (FIX-002)

- `apps/api/test/deploy/build-output.test.ts` — 7 tests: entry points import no `.ts`/`tsx`
  (regression, AC-02), module graphs load with plain node, no inlined environment value (R-01),
  migrations applied to an empty database (AC-03), missing `DATABASE_URL` error (AC-04), migration
  error, build error.
- `apps/api/test/deploy/railway-config.test.ts` — 15 cases (5 per service, the web-only one
  skipped for API and worker): pnpm build and start (AC-01), heap cap and restart policy (AC-07),
  web started by `node` with no pnpm parent, no variables (R-01), pre-deploy migration only on the
  API (AC-05).
- `apps/web/test/start-script.test.ts` — 1 test: no port flag (AC-06).

RED evidence: first round, all three files failed before the fix (no build script, `ENOENT` on
`apps/api/railway.json`, web start `next start --port 3000`). Corrective loop: `starts Next.js with
node directly, with no pnpm parent process` failed on the old command (`Received: "NODE_OPTIONS=…
pnpm --filter @argent/web start"`) before `apps/web/railway.json` changed.

Smoke test of the new web start command, run from the repository root after
`pnpm --filter @argent/web build`: `PORT=3917 node --max-old-space-size=320
apps/web/node_modules/next/dist/bin/next start apps/web` → `GET /` 307 to `/es`, `GET /es` 200;
one `node.exe` process, 133 MB working set at idle.

## Failures
(none)

## Skips
- `Railway config for api > starts Next.js with node directly, with no pnpm parent process` — reason: web-only assertion, `it.runIf(name === 'web')`
- `Railway config for worker > starts Next.js with node directly, with no pnpm parent process` — reason: web-only assertion, `it.runIf(name === 'web')`
