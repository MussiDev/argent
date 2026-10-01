# Verification FIX-005

| Field | Value |
|---|---|
| Module | `.railway/railway.ts` |
| Fix-plan | docs/ddw/specs/fix-FIX-005.md |
| RCA | docs/ddw/specs/rca-FIX-005.md |
| Implementation commit | `e60b0c8` |
| Line coverage | 96.51% |
| Branch coverage | 93.01% |
| Function coverage | 92.93% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; `prettier --check --end-of-line auto .` — clean |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code): PASSED, 4 warnings; re-ran the suite 922/922, `pnpm railway:plan` (up to date) and `railway metrics` |

## Acceptance criteria
- ✅ AC-01 — the worker is capped at 1 vCPU / 512,000,000 bytes and the web at 1 vCPU / 1,000,000,000 bytes (`apps/api/test/deploy/railway-iac.test.ts:261-268`); code `.railway/railway.ts:71, 93`
- ✅ AC-02 — the API keeps 2 vCPU / 2,000,000,000 bytes and the database declares no limit (`railway-iac.test.ts:262-267`); code `.railway/railway.ts:42-45, 30`
- ✅ AC-03 — `containerMemoryIssues` names a service whose memory limit is missing or below twice its V8 heap cap (`railway-iac.test.ts:166-182`, sad path `:376-390`)
- ✅ AC-04 — the plan applied listed only the two limits (`docs/ddw/reports/tests-FIX-005.md`); after the apply the plan is up to date, re-run by the verifier
- ✅ AC-05 — after the apply the worker and web are Online with the limits live in `railway metrics`, and `https://pesly.com.ar/es` answers 200, re-run by the verifier

## Spec blocks
- ✅ Block 1 — fix-plan steps 1–4 done (`e60b0c8` and the recorded apply); step 5 (`CHANGELOG.md`) is deferred to CLOSEOUT by the fix-plan itself

## Tests
- ✅ Regression test: `caps every application container, at least twice its V8 heap, and leaves the database unset` — before the definition change it reported `argent-worker: expected undefined to deeply equal { containers: { cpu: 1, …(1) } }`; passes after
- ✅ Every test the fix-plan listed exists and passes (4 of 4, two of them manual and recorded); full suite 922 passed, 0 skipped
- ✅ Sad-path tests: `container limit error: a memory limit below twice the heap, or none, names the service and the minimum`; manual: the first plan, which listed a deletion besides the two limits, was not applied
- ✅ Dead code: none (W-VER-01)

## Deviation (approved by the user)
- `TOTP_ENCRYPTION_KEY` declared as `preserve()` on `argent-api` (`.railway/railway.ts:57`; test `SECRETS` and `SERVICE_SECRETS`). It was added in Railway for DISC-001-01c, which is merged and in production, and the first plan would have deleted it: the API requires it in production (`apps/api/src/shared/config/env.ts:142`), and the stored TOTP secrets are sealed with it. Outside the RCA's requirements, but needed for NFR-02 (the plan lists only the two limits). This record supersedes the line "no variable or secret changes" in `docs/ddw/security/threat-FIX-005.md`: the change adds one preserved secret, whose value never enters the repository.

## Warnings (non-blocking)
- ⚠️ The deviation above is recorded here, in the test and SAST reports, the commit and the CHANGELOG, not in the RCA or fix-plan text.
- ⚠️ The worker's 24 h peak of 569 MB in the RCA is above its new limit; the RCA attributes it to two containers counted together during a deploy, which no single-container figure confirms. Watch `railway metrics` on the next worker deploy (rollback indicator: 90% of the limit).
- ⚠️ The fix-plan's "2.7 times" for the worker is 2.54 times its heap cap in MiB; NFR-01 holds either way.
- ⚠️ Railway rounds the worker limit up to 524 MB (500 MiB); the effective limit is at least the declared one.

Result: PASSED
