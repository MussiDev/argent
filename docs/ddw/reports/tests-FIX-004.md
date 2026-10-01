# Test run FIX-004

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_iac_test pnpm test:coverage` |
| Total | 699 |
| Passed | 699 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.75% |
| Branch coverage | 92.41% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean |

The run used the separate database `argent_iac_test`, because `argent_test` is shared with another
session. A first full run had 1 failure, a 5-second timeout in
`test/foundation/architecture-boundaries.test.ts` ("rejects in domain: import { x } from
'../infrastructure/db/schema'"), whose first ESLint call took 10 seconds right after Docker Desktop
had been started on this machine; it does not touch the changed code, and the run above, started
right after, passed.

TDD evidence: the regression test "signs in to the account a concurrent callback created between
the identity and the email lookups" failed before the fix with `expected { outcome: 'failed', …(2) }
to match object { outcome: 'signed_in', …(1) }` (received `outcome: "failed"`, reason
`another_identity_linked`), and passes after it. The sad path "identity error: still refuses a user
whose Google identity has a different subject, creating nothing" passed before and after, as it
should.

Race test (NFR-03): "end with exactly one user and one identity for the same new Google subject" —
20 of 20 consecutive local runs passed after the fix.

Other checks: `pnpm typecheck` — clean. `pnpm audit --prod --audit-level high` — no known
vulnerabilities.

## Failures
(none)

## Skips
(none)
