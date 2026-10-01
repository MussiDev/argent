# Test run FEAT-001

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_iac_test pnpm test:coverage` |
| Total | 677 |
| Passed | 677 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.74% |
| Branch coverage | 92.39% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `prettier --check` on the committed content of the touched files — clean |

The run used a separate database, `argent_iac_test`, because `argent_test` is shared with another
session working in the main checkout; the API test project migrates and truncates its database in
its setup file.

Other checks: `pnpm typecheck` — clean. `pnpm audit --prod --audit-level high` and
`pnpm audit --audit-level high` — no known vulnerabilities.

Block 2 (adoption against production, run manually with the global Railway CLI 5.63.1):
`railway config plan --detailed-exit-code` — "Your Railway configuration is already up to date",
exit 0: 0 to add, 0 to change, 0 to destroy, no change outside the partial. The services
`argent-api`, `argent-worker` and `argent-web` redeployed with SUCCESS; `https://api.pesly.com.ar/health`
answers 200 and `https://pesly.com.ar` answers 307 (locale redirect). The `railway config pull`
output was kept in the scratch directory, carried no secret values, and was deleted.

## Failures
(none)

## Skips
(none)
