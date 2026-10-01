# Test run FEAT-002

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_iac_test pnpm test:coverage` |
| Total | 1081 |
| Passed | 1081 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.68% |
| Branch coverage | 92.72% |
| Function coverage | 93.47% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean |

This run is on the branch after merging `main` (DISC-001-01d, profile and preferences, PR #11) in
`9edead7`: the two conflicts (`CHANGELOG.md`, `account-defaults.ts`) were resolved, the feature's
9 files importing the old scope were renamed, and its profile description ("How you appear in
Argent." / "Cómo apareces en Argent.") now names Pesly; the scope scan and the catalog checks
pass on the merged tree. A first full run had 1 timeout in `test/foundation/architecture-boundaries.test.ts`
("rejects in domain: …"), whose first ESLint call took 9.7 seconds on this machine, the same cold
start seen in FIX-004; the run above, started right after, passed.

The run used the separate database `argent_iac_test`. Other checks: `pnpm install
--frozen-lockfile` — up to date; `pnpm typecheck` — clean; `pnpm audit --prod --audit-level high`
— no known vulnerabilities; `pnpm --filter ./apps/api --fail-if-no-match build` and
`pnpm --filter ./apps/web --fail-if-no-match build` — both build with the renamed packages;
`git grep -n "@argent"` outside `docs/ddw/` and `CHANGELOG.md` — 0 lines.

TDD evidence by block:
- Block 1: "builds each application service with RAILPACK …" and "selects every build package by
  path …" failed before the definition change (`argent-api: expected { builder: 'RAILPACK', …(2) }
  to deeply equal …`; `expected [ …(6) ] to deeply equal []`); the sad path "build filter error: …"
  passed by construction.
- Block 2: 14 of 16 new tests failed before the copy change (for example `expected 'Argent' to be
  'Pesly'`, `expected [ 'verification.subject', …(8) ] to deeply equal []`, `expected 'Confirmá tu
  email en Argent' to match /\bPesly\b/`, `expected 'Argent <no-reply@argent.local>' to be 'Pesly
  <no-reply@pesly.local>'`); the two "product name error: …" sad paths passed by construction.
- Block 3: the scope scan failed listing 40 files (`expected [ 'apps/api/package.json', …(39) ] to
  deeply equal []`); breaking the bundled-package matcher on purpose made `build-output.test.ts`
  fail (`server.js: expected '…' not to match /["']@[^/"']+\/shared["']/`, `ERR_MODULE_NOT_FOUND`)
  before it was restored.

## Production (Block 1, manual)

- Plan with the path filters: `Plan: 0 to add, 3 to change, 0 to destroy` — only
  `build.buildCommand` on `argent-api`, `argent-worker` (`"pnpm --filter @argent/api build" →
  "pnpm --filter ./apps/api --fail-if-no-match build"`) and `argent-web` (`… @argent/web build" →
  "pnpm --filter ./apps/web --fail-if-no-match build"`). No other change, so the plan sad path
  ("anything besides the three build commands") did not trigger.
- The user approved; `pnpm railway:apply --yes` applied 3 changes. The three services rebuilt `main`
  (still `@argent/*`) and reported SUCCESS; the API build log shows
  `pnpm --filter ./apps/api --fail-if-no-match build`. No rebuild failed, so no rollback.
- After the apply: `pnpm railway:plan` → "Your Railway configuration is already up to date.";
  `https://api.pesly.com.ar/health` → 200; `https://pesly.com.ar/es` → 200.
- AC-09 (rebuild after the merge) is checked when the pull request is merged; locally, the same
  path-filter commands build the renamed `@pesly/*` packages.

## Failures
(none)

## Skips
(none)
