# Test run FEAT-001

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_iac_test pnpm test:coverage` |
| Total | 697 |
| Passed | 697 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.74% |
| Branch coverage | 92.39% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean |

This is the run after the corrective loop from VERIFY (Block 3 added). The run used a separate
database, `argent_iac_test`, because `argent_test` is shared with another session working in the
main checkout. A first attempt of this run failed 10 tests in `test/identity/migration.test.ts`
with `schema "drizzle" does not exist`: that file always uses the fixed database
`argent_migration_test`, which the other session's suite was using at the same time. Once
`pg_stat_activity` showed no connection, the full run above passed. No file this ticket changes is
involved.

`pnpm lint` fails only in its `prettier --check .` step, and only on line endings: this Windows
checkout has `core.autocrlf=true`, so the working copy has CRLF while `.prettierrc` asks for LF.
`git ls-files --eol` lists 0 files with CRLF in the index, so CI checks LF content; the same check
with `--end-of-line auto` is clean.

Other checks: `pnpm typecheck` — clean. `pnpm audit --prod --audit-level high` and
`pnpm audit --audit-level high` — no known vulnerabilities.

## Adoption against production (Block 2, manual)

- Railway CLI: `railway --version` → `railway 5.63.1` (minimum 5.63.1), linked to project
  `joaquin`, environment `production`.
- `railway config pull --json` ran into the session scratch directory, outside the repository; it
  rendered every variable as `preserve()` (no values). The three variables that differed were read
  one by one with values filtered to those names: `${{argent-api.EMAIL_FROM}}`,
  `${{argent-api.WEB_BASE_URL}}` and `${{argent-api.API_ORIGIN}}`. The pull file was deleted after
  the comparison; `git status` showed no untracked file from it.
- First plan (values redacted by the CLI): `Plan: 0 to add, 10 to change, 0 to destroy`, all on the
  three owned services, none outside the partial:
  - `argent-api source.checkSuites (true → null)` — reconciled: the definition sets
    `checkSuites: true`.
  - `build.watchPatterns (["/apps/api/**", ...] → ["apps/api/**", ...])` on the three services —
    reconciled: the definition uses the leading-slash form.
  - `argent-api deploy.limitOverride.containers.cpu (2 → null)` and `memoryBytes (2000000000 → null)`
    — reconciled: the definition declares the limit.
  - `argent-worker.EMAIL_FROM`, `argent-worker.WEB_BASE_URL`, `argent-web.API_ORIGIN`
    (`preserve() → «hidden»`) — reconciled: the definition references `argent-api`'s variables.
  - `deploy.restartPolicyMaxRetries (null → 10)` and `deploy.restartPolicyType (null → "ON_FAILURE")`
    on the three services — Railway's default stored as unset.
- After reconciling, the plan listed only the 3 restart changes. The user approved an apply
  ("Si"); it ran (3 changes, the services redeployed with SUCCESS), but the next plan still listed
  the same 3 changes: Railway stores its default restart policy as unset.
- The user chose to lower the retries to 5 (option B) and approved a second apply; the next plan
  listed only `deploy.restartPolicyType (null → "ON_FAILURE")` on the three services. The user
  approved leaving the type at Railway's default; with the type no longer declared, the plan was
  empty.
- Final plan through the repository's command, `pnpm railway:plan` (on Windows, no manual
  environment setup):

```
$ node scripts/railway-config.mjs plan

Railway configuration
Using \\?\C:\Users\Joako\Desktop\argent-deploy\.railway\railway.ts
Project joaquin
Environment production

✓ Your Railway configuration is already up to date.
```

  Exit code 0: 0 to add, 0 to change, 0 to destroy, no change outside the partial.
- CLI not installed: `PATH="/usr/bin:/bin:/c/Program Files/nodejs" node scripts/railway-config.mjs plan`
  → `Railway CLI not found: install it with npm i -g @railway/cli`, exit code 1; nothing ran.
- After both applies the services `argent-api`, `argent-worker` and `argent-web` reported SUCCESS;
  `https://api.pesly.com.ar/health` answered 200 and `https://pesly.com.ar` answered 307 (locale
  redirect).

## Failures
(none)

## Skips
(none)
