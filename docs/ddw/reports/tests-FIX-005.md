# Test run FIX-005

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_iac_test pnpm test:coverage` |
| Total | 922 |
| Passed | 922 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.51% |
| Branch coverage | 93.01% |
| Function coverage | 92.93% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean |

The run used the separate database `argent_iac_test`. The branch starts at `8bc09d2`, which already
contains DISC-001-01c (two-factor authentication, PR #8), hence 922 tests.

TDD evidence:
- Limits: "caps every application container, at least twice its V8 heap, and leaves the database
  unset" failed before the definition change with `argent-worker: expected undefined to deeply equal
  { containers: { cpu: 1, …(1) } }`, and passes after it. The sad path "container limit error: a
  memory limit below twice the heap, or none, names the service and the minimum" exercises the
  helper on hand-built nodes.
- TOTP key: after `TOTP_ENCRYPTION_KEY` was added to the expected secrets, "every secret is
  preserved, …" failed with `argent-api.TOTP_ENCRYPTION_KEY: expected undefined to deeply equal
  { type: 'preserve' }` and "declares each service non-secret variables …" failed on the variable
  list, before the definition declared it; both pass after.

Other checks: `pnpm typecheck` — clean. `pnpm audit --prod --audit-level high` — no known
vulnerabilities.

## Production (step 4, manual)

- First plan with the limits only: `Plan: 0 to add, 2 to change, 1 to destroy` — the destroy was
  `Delete variable argent-api.TOTP_ENCRYPTION_KEY`, a secret added in Railway for DISC-001-01c after
  FEAT-001. Nothing was applied (the "plan lists anything besides the two new limits" sad path). With
  the user's approval the key was declared as `preserve()` (deviation from the RCA scope, needed for
  NFR-02).
- Second plan: `Plan: 0 to add, 2 to change, 0 to destroy` — only
  `argent-worker deploy.limitOverride.containers.cpu (null → 1), memoryBytes (null → 512000000)` and
  `argent-web ... cpu (null → 1), memoryBytes (null → 1000000000)`.
- The user approved the apply; `pnpm railway:apply --yes` applied 2 changes (the first run without
  `--yes` refused to run non-interactively). The worker and web redeployed; all three application
  services reported SUCCESS; no service failed to start or kept restarting, so no rollback.
- After the apply: `pnpm railway:plan` → "Your Railway configuration is already up to date."
  `https://api.pesly.com.ar/health` → 200, `https://pesly.com.ar` → 307, `https://pesly.com.ar/es`
  → 200.
- `railway metrics --since 10m`: `argent-worker` limit 1.0 vCPU / 524 MB (Railway rounds 512,000,000
  bytes up to 500 MiB), using 41 MB; `argent-web` limit 1.0 vCPU / 1024 MB, using 82 MB.

## Failures
(none)

## Skips
(none)
