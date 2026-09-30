# Verification FIX-003

| Field | Value |
|---|---|
| Module | `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts`, `playwright.config.ts` |
| Fix-plan | docs/ddw/specs/fix-FIX-003.md |
| RCA | docs/ddw/specs/rca-FIX-003.md |
| Implementation commit | `6486906` |
| Line coverage | 95.74% |
| Branch coverage | 92.39% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; Prettier clean on every changed file |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code): PASSED, 5 warnings; re-ran `apps/api/test/foundation` 100/100 |

## Acceptance criteria
- ✅ AC-01 — production with only the worker's seven settings is accepted (`apps/api/test/foundation/worker-env.test.ts:20`); code `env.ts` `workerEnvSchema`, `parseWorkerEnv`, `worker.ts:11`
- ✅ AC-02 — the same test has neither `JWT_SECRET` nor any Google setting, and the result carries neither (`worker-env.test.ts:20`)
- ✅ AC-03 — http `WEB_BASE_URL` in production is refused naming the variable (`worker-env.test.ts:30`)
- ✅ AC-04 — a provider other than resend in production is refused naming `EMAIL_PROVIDER` (`worker-env.test.ts:34`)
- ✅ AC-05 — a missing `DATABASE_URL` is named and none of the seven provided values appears in the message (`worker-env.test.ts:38`)
- ✅ AC-06 — the API keeps its Google production checks; `apps/api/test/foundation/env.test.ts:136` and `:141` pass with the file unchanged from `origin/main`

## Spec blocks
- ✅ Block 1 — fix-plan steps 1–3 implemented in `6486906`; step 4 (`CHANGELOG.md`) is deferred to CLOSEOUT by the fix-plan itself

## Tests
- ✅ Regression test: `accepts production with only its seven settings, without JWT_SECRET or Google settings` — failed before the fix (`parseWorkerEnv` absent at `cb3c147`), passes after
- ✅ Every test the fix-plan listed exists and passes (7 promised, 7 present plus one extra); full suite 671 passed, 2 skipped with reason; e2e 39/39 (docs/ddw/reports/tests-FIX-003.md)
- ✅ Sad-path tests: `invalid WEB_BASE_URL error` (`:30`), `invalid EMAIL_PROVIDER error` (`:34`), `missing DATABASE_URL error` (`:38`), `missing Resend settings error` (`:52`), `refuses resend outside production` (`:57`)
- ✅ Dead code: none; `WorkerEnv` is the exported return type of `parseWorkerEnv` (W-VER-01)

## Warnings (non-blocking)
- ⚠️ The order of messages inside `Invalid environment:` changed for the API (worker fields and checks now come first); wording and rules are identical, and no test or caller depends on the order.
- ⚠️ The `EMAIL_FROM` default transform appears in both schemas, as the fix-plan specified; the rules themselves are defined once.
- ⚠️ `worker-env.test.ts` does not repeat sad paths for `LOG_LEVEL`, `NODE_ENV` or a multi-line `EMAIL_FROM`; those fields are the same zod definitions the API schema uses.
- ⚠️ The value-free message is asserted for a missing value, not for an invalid one.
- ⚠️ W-VER-03 — fixed-name test databases shared between worktrees: two full-suite runs collided with another session's suite on `argent_test` before this run passed. Pre-existing; worth its own ticket.

Result: PASSED
