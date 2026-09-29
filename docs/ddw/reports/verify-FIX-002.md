# Verification FIX-002

| Field | Value |
|---|---|
| Module | Railway deployment: `apps/api/scripts/build.mjs`, `apps/api/railway.json`, `apps/api/railway.worker.json`, `apps/web/railway.json`, `apps/api/package.json`, `apps/web/package.json` |
| Fix-plan | docs/ddw/specs/fix-FIX-002.md |
| RCA | docs/ddw/specs/rca-FIX-002.md |
| Implementation commits | `6e1aaed` (round 1), `20445d2` (corrective loop); none under `*/src/**` |
| Line coverage | 95.28% |
| Branch coverage | 92.32% |
| Function coverage | 92.74% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; Prettier clean on every changed file |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code), round 2: PASSED, 4 warnings |

## Rounds

- Round 1 (2026-09-28): cross-verification PASSED, but the verdict was refused by
  `validate_verify.py` on F-VER-02 because the fix-plan had no block heading. Corrective loop
  VERIFY → CODE → PLAN: `## Block 1` added, and by user decision the web start moved from
  `pnpm --filter @argent/web start` to Next.js run directly by `node`.
- Round 2 (2026-09-29): this verdict.

## Acceptance criteria
- ✅ AC-01 — `builds only its workspace package with pnpm and starts with pnpm or node, never npm` (`apps/api/test/deploy/railway-config.test.ts:32-37`)
- ✅ AC-02 — `produces server, worker and migration entry points that import no TypeScript and no tsx` and `loads the server and worker module graphs with plain node` (`apps/api/test/deploy/build-output.test.ts:64-82`)
- ✅ AC-03 — `applies every migration to an empty database when run with node` (`build-output.test.ts:90-99`)
- ✅ AC-04 — the built migration without `DATABASE_URL` exits with code 1 and names the variable (`build-output.test.ts:101-105`)
- ✅ AC-05 — `runs the built migration before the new version starts` / `leaves migrations to the API service` (`railway-config.test.ts:57-70`)
- ✅ AC-06 — `passes no port flag, so Next.js listens on PORT` (`apps/web/test/start-script.test.ts:8-11`), the exact web start command with no port flag (`railway-config.test.ts:46-51`), and the smoke test from the repository root (`PORT=3917`, `GET /es` 200, docs/ddw/reports/tests-FIX-002.md)
- ✅ AC-07 — caps the heap in the start command only, with a bounded restart policy (`railway-config.test.ts:39-44`); the web runs as one `node` process with no pnpm parent (`railway-config.test.ts:46-51`)

## Spec blocks
- ✅ Block 1 — fix-plan steps 1–8 implemented in `6e1aaed` and `20445d2` (step 7 matches `apps/web/railway.json:9`); step 9 (`CHANGELOG.md`) is deferred to CLOSEOUT by the fix-plan itself

## Tests
- ✅ Regression test: `produces server, worker and migration entry points that import no TypeScript and no tsx` — failed before the fix (no build script at `f7553c0`), passes after
- ✅ Corrective loop test: `starts Next.js with node directly, with no pnpm parent process` — failed on the old command (`Received: "NODE_OPTIONS=… pnpm --filter @argent/web start"`), passes after
- ✅ Every test the fix-plan listed exists and passes (12 planned); full suite 518 passed, 2 skipped with reason (docs/ddw/reports/tests-FIX-002.md)
- ✅ Sad-path tests: `missing DATABASE_URL error` (`build-output.test.ts:101`), `migration error` (`:107`), `build error` (`:115`), `heap limit error` (`railway-config.test.ts:39`)
- ✅ Dead code: none in `build.mjs` or the new tests (W-VER-01)

## Warnings (non-blocking)
- ⚠️ W-VER-03 — fixed-name databases (`argent_test`, and `argent_build_test` added here) collide when two worktrees run the suite at the same time; round 1's first cross-verification run deadlocked on `apps/api/test/setup.ts:15` while another worktree was testing, and passed on rerun. Pre-existing for `argent_test`.
- ⚠️ `apps/web/test/start-script.test.ts` asserts the `package.json` start script, which Railway no longer runs; Next.js binding to `PORT` is shown by the smoke test and by the CLI source (`next/dist/bin/next:181`), not by an automated server test.
- ⚠️ Watch patterns do not include root files (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`); changing only those does not redeploy.
- ⚠️ Source maps are emitted but the API and worker start commands do not pass `--enable-source-maps`, so production stack traces point into the bundle.
- ⚠️ The web start depends on Next's internal path `apps/web/node_modules/next/dist/bin/next` and on `NODE_ENV` not being `development` on Railway (next-intl validates its config paths only in dev and build); the Railway setup sets `NODE_ENV=production` (threat R-05).

Resolved since round 1: the web no longer runs through a resident pnpm parent process.

Result: PASSED
