# Test run FIX-001

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_fix001_test pnpm test:coverage` |
| Total | 497 |
| Passed | 497 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.28% |
| Branch coverage | 92.32% |
| Function coverage | 92.74% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Typecheck | `pnpm typecheck` — clean, exit 0 |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `prettier --check --end-of-line auto` on the 10 changed files — clean. `pnpm lint` reports only CRLF line endings in 249 files, an artifact of `core.autocrlf=true` in this worktree (the index stores LF). |

## Failures
(none)

## Skips
(none)
