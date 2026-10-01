# Verification FEAT-001

| Field | Value |
|---|---|
| Module | `.railway/railway.ts`, `scripts/railway-config.mjs`, `package.json` scripts |
| PRD | docs/ddw/prd/prd-FEAT-001.md |
| Spec | docs/ddw/specs/spec-FEAT-001.md |
| Implementation commits | `c653879` (Block 1), `f210068` (Block 2), `5e55b04` (Block 3) |
| Line coverage | 95.74% |
| Branch coverage | 92.39% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; `prettier --check --end-of-line auto .` — clean |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code): round 1 BLOCKED, round 2 PASSED with 3 warnings; re-ran both test files 39/39 and `pnpm railway:plan` (up to date) |

## Round 1 (BLOCKED → corrective loop)

The code passed its tests, but the documents no longer described it: AC-03 asked for a declared
`ON_FAILURE` that the definition left at Railway's default, NFR-01 did not record the accepted
retries change, the spec text predated the production reconciliation, `pnpm railway:plan` failed on
Windows (the SDK's CLI version check cannot run npm's `.cmd` shim), and the test report lacked the
pasted plan output and the record of the applies. The loop went VERIFY → CODE → PLAN → DEFINE: the
PRD recorded the user's restart decision and the wrapper (AC-08, AC-09), the spec gained Block 3,
and Block 3 was implemented.

## Round 2

## Acceptance criteria
- ✅ AC-01 — the definition owns exactly the four Pesly resources (`apps/api/test/deploy/railway-iac.test.ts:196`, sad path `:371`); the production plan showed 0 added and 0 destroyed (`docs/ddw/reports/tests-FEAT-001.md`); code `.railway/railway.ts:4`
- ✅ AC-02 — no change outside the partial in any plan; the final `pnpm railway:plan` is up to date (`tests-FEAT-001.md`, "Adoption against production")
- ✅ AC-03 — build, start, watch paths, retries 5, no declared restart type, API-only migration and heap caps (`railway-iac.test.ts:209, 220, 226, 236, 245, 261, 317, 383`); code `.railway/railway.ts:11, 35-45`
- ✅ AC-04 — non-secret variables declared as literals or references, secrets preserved (`railway-iac.test.ts:267, 286, 301, 307`); the pull output stayed outside the repository and was deleted
- ✅ AC-05 — a literal secret, a secret dropped from the list and a secret handed over by reference are each reported as `service.VARIABLE` (`railway-iac.test.ts:332, 343, 360`)
- ✅ AC-06 — the final plan through `pnpm railway:plan` reports the configuration up to date (`tests-FEAT-001.md`); re-run by the verifier
- ✅ AC-07 — no `railway.json` or `railway.worker.json` (`railway-iac.test.ts:324`; `git ls-files`)
- ✅ AC-08 — the wrapper resolves npm's Windows shim to `railway.exe` and runs the plan (`apps/api/test/deploy/railway-cli-wrapper.test.ts:18-53, 105, 123`; manual run on Windows recorded); code `scripts/railway-config.mjs:20-56`
- ✅ AC-09 — a missing CLI is reported as not found (`railway-cli-wrapper.test.ts:55, 64`); the message and exit code 1 checked by hand and recorded; code `scripts/railway-config.mjs:75-78`

## Spec blocks
- ✅ Block 1 — definition, SDK pin, tsconfig include and test (16 required tests present and passing); the spec text matches the reconciled definition
- ✅ Block 2 — adoption against production: 6 manual checks recorded, including the first plan (10 changes), the reconciliation, the user's acceptance, both applies and the final empty plan
- ✅ Block 3 — cross-platform wrapper: 5 automated tests and 2 manual checks

## Tests
- ✅ Every test the spec lists exists and passes; full suite 697 passed, 0 skipped (docs/ddw/reports/tests-FEAT-001.md)
- ✅ Sad-path tests: `secret error: a secret given a literal value is reported as service.VARIABLE`, `secret error: a reference that hands the worker another service secret is reported`, `service set error: ...`, `heap limit error: ...`, `not found error: ...`, `subcommand error: ...`, `CLI error: ...`
- ✅ TDD evidence: Block 1 — run 1 "Cannot find module '../../../../.railway/railway'", run 2 with an empty stub 12 of 17 failed (for example "argent-api: start command has no --max-old-space-size (expected 320)", "Error: service argent-api is not defined"); Block 3 — run 1 "Cannot find module '../../../../scripts/railway-config.mjs'", run 2 with an undefined-returning stub 20 of 20 failed (for example "expected undefined to be null", "expected undefined to be +0"). Block 2 was driven by the production plan, pasted in the test report as its failing evidence
- ✅ Dead code: none; `findRailwayCandidates` is used by `main()` and has its own tests (W-VER-01)

## Warnings (non-blocking)
- ⚠️ Block 2 added two unit tests in `f210068` (the API container limit, and a secret handed over by reference) with no recorded failing-first run; the first test's difference appears in the pasted first plan (`cpu 2 → null`).
- ⚠️ Both applies ran with the Railway CLI executable directly (with `_` set to it), before the wrapper existed in `5e55b04`, not through `pnpm railway:apply`; the user approved each one.
- ⚠️ Spec Block 2's error handling still says a missing CLI exits with the CLI's own message; Block 3 replaced that with the wrapper's not-found message. Wording only.
- ⚠️ Accepted deviations: the extra export `findRailwayCandidates`; `scripts/railway-config.d.mts` and the `tsconfig.json` include that types it are not in Block 3's file list; the declaration file is written by hand, so its types can drift from the `.mjs` without a type error (the tests exercise all four functions).
- ⚠️ `pnpm lint` fails locally only in its Prettier step, on CRLF line endings from `core.autocrlf=true`; the git index has 0 CRLF files.
- ⚠️ W-VER-03 — `test/identity/migration.test.ts` always uses the fixed database `argent_migration_test`, which collided with another session's suite on the first full run. Pre-existing; part of the per-worktree test database ticket.

Result: PASSED
