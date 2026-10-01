# Spec FEAT-002: Rename the product from Argent to Pesly

| Field | Value |
|-------|-------|
| Ticket | FEAT-002 |
| PRD | docs/ddw/prd/prd-FEAT-002.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary

The product name changes from Argent to Pesly in three steps, ordered so production never builds
with a filter that matches nothing. Block 1 switches the Railway build commands to path filters
with `--fail-if-no-match` and applies them while `main` still has the `@argent/*` packages: the
same packages are built, only the way they are selected changes. Block 2 renames every
user-visible string (web and email catalogs in Spanish and English, the local default sender, the
test fixtures that use the product name) and the product wording of `AGENTS.md`, guarded by a
case-insensitive catalog check. Block 3 renames the workspace packages from `@argent/*` to
`@pesly/*`, including the two places that match the shared package's name with a regex, and is
checked on Railway after the merge. Cookies, the CSRF header value, the JWT issuer and audience,
and Railway service and database names stay as they are (PRD Out of Scope, NFR-02).

Spec loop 1 (user decision after the architecture review, 2026-10-01): Railway builds from `main`,
so name filters would break whichever came first, the apply or the merge, and pnpm exits 0 when a
filter matches nothing (measured: `pnpm --filter @nope/x run build` exits 0; with
`--fail-if-no-match` it exits 1; `pnpm --filter ./apps/api --fail-if-no-match run build` builds the
API). The build commands therefore filter by path and are applied first.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 2 |
| FR-02 | Block 2 |
| FR-03 | Block 2 |
| FR-04 | Block 3 |
| FR-05 | Block 1 (definition and apply), Block 3 (rebuild after the merge) |
| FR-06 | Block 2 |
| NFR-01 | Strategy: the case-insensitive catalog checks (Block 2) and the repository scan for the old scope (Block 3); the remaining occurrences are the out-of-scope identifiers below and the word "Argentina" |
| NFR-02 | Strategy: `session-cookies.ts`, `origin-guard.ts`, `api-client.ts` (`REQUESTED_WITH`, `REFRESH_LOCK`) and `jose-access-token-issuer.ts` (`ACCESS_TOKEN_ISSUER`, `ACCESS_TOKEN_AUDIENCE`) are not modified; renaming the JWT issuer or audience would reject every live access token at deploy time |
| NFR-03 | Block 1: the plan must list only the three build commands; `--fail-if-no-match` makes an unmatched filter fail the build |
| NFR-04 | Strategy: no logic changes; the full suite runs with coverage at closeout |

## Dependencies between blocks

Block 1 goes first and is applied to production before Block 3 reaches `main`: path filters work
with both package names, so the rename can then merge without another apply. Block 2 is
independent of the other two. Block 3 depends on Block 1 (its post-merge check relies on the path
filters). The pull request is merged only after Block 1 is applied.

## Block 1 — Build by path on Railway

**Files**
- `.railway/railway.ts` (modified) — the three `buildCommand` values become
  `pnpm --filter ./apps/api --fail-if-no-match build` (API, worker) and
  `pnpm --filter ./apps/web --fail-if-no-match build` (web).
- `apps/api/test/deploy/railway-iac.test.ts` (modified) — the expected build commands, plus a check
  that every build command filters by path and carries `--fail-if-no-match`.
- `AGENTS.md` (modified) — the Build row (line 37) uses the same path filters.
- `docs/ddw/reports/tests-FEAT-002.md` (modified) — the production record.

**Logic**

A pure helper in the test, `buildFilterIssues(services)`, returns `service: reason` for every
application service whose build command does not filter by a `./` path or lacks
`--fail-if-no-match`. After the definition change: `pnpm railway:plan` must list only the three
`build.buildCommand` changes; the user approves; `pnpm railway:apply --yes`; the three services
rebuild `main` (still `@argent/*`) with the path filters and must report SUCCESS; a second plan is
up to date.

**Input validation**
- None: the definition takes no runtime input.

**Error handling**
- A build command filtering by package name, or without `--fail-if-no-match` — the test fails
  naming the service.
- The plan lists anything besides the three build commands — stop; nothing is applied; the
  definition is corrected.
- A rebuild fails on Railway — the previous deployment keeps serving; revert the commit and apply
  again with the user's approval.

**Required tests**
- [ ] the Railway definition builds the API and worker with `pnpm --filter ./apps/api
      --fail-if-no-match build` and the web with `pnpm --filter ./apps/web --fail-if-no-match
      build` — validates AC-06
- [ ] sad path: a build command filtering by package name, or without `--fail-if-no-match`, is
      reported naming the service — validates AC-07
- [ ] sad path, the plan lists anything besides the three build commands (manual, recorded):
      nothing is applied; the plan run lists only them — validates AC-06
- [ ] sad path, a rebuild fails on Railway (manual, recorded): the previous deployment keeps
      serving and the commit is reverted; after the apply the three services report SUCCESS —
      validates AC-07

**Completion criterion**
The tests pass; after the apply the plan is up to date, the three services report SUCCESS, and
`https://api.pesly.com.ar/health` and `https://pesly.com.ar/es` answer 200.

## Block 2 — User-visible copy and docs

**Files**
- `apps/web/messages/en.json`, `apps/web/messages/es.json` (modified) — `metadata.title` and
  `home.title` become "Pesly"; the verified message names Pesly; the recovery codes `fileName`
  becomes `pesly-recovery-codes.txt` / `pesly-codigos-de-recuperacion.txt` and `fileHeader` names
  Pesly.
- `apps/api/src/identity/infrastructure/email/messages/en.json`, `.../es.json` (modified) — every
  subject and body of the verification, password reset, two-factor enabled and disabled emails
  names Pesly.
- `apps/api/src/shared/config/env.ts` (modified) — `LOCAL_EMAIL_FROM` becomes
  `Pesly <no-reply@pesly.local>`.
- `AGENTS.md` (modified) — the title (line 1) and the product description (line 13).
- `apps/web/test/i18n-catalogs.test.ts` (modified) — the product name check on the web catalogs.
- `apps/api/test/identity/email-messages.test.ts` (modified) — the product name check on the email
  catalogs and a rendered email.
- `apps/api/test/identity/two-factor-enrollment.test.ts` (modified) — the four two-factor email
  subjects it writes literally.
- `apps/api/test/foundation/env.test.ts` (modified) — the local default sender, and the
  `Argent <no-reply@argent.app>` fixtures become `Pesly <no-reply@pesly.app>`.
- `apps/api/test/helpers/test-env.ts`, `apps/api/test/identity/email-transports.test.ts`,
  `apps/api/test/identity/email-worker-retry.test.ts` (modified) — the `EMAIL_FROM` fixtures name
  Pesly (fixture domains such as `argent.test` stay, PRD Out of Scope).

**Logic**

Catalog values are edited in place; keys do not change, so components and the manifest
(`manifest.ts` reads `metadata.title`) need no edit. Each catalog test gets a pure helper,
`productNameLeaks(catalog)`, written in that test file (no helper is shared across Vitest
projects): it walks the catalog and returns the dotted key of every string value matching
`/\bargent\b/i`, which catches "Argent" and "argent-recovery-codes" but not "Argentina". The web
test asserts it is empty for es and en and that `metadata.title` is "Pesly"; the API test asserts
the same for the email catalogs and renders the verification email in each language to check its
subject.

**Input validation**
- None: catalogs are static files checked by the existing parity tests.

**Error handling**
- A catalog string that still names Argent, in any case — the test fails listing the dotted key and
  the language.
- A missing or renamed catalog key — the existing parity tests fail as today.

**Required tests**
- [ ] `metadata.title` is "Pesly" in es and en, and the PWA manifest name comes from it —
      validates AC-01
- [ ] the es and en web catalogs contain no Argent product name, in any case — validates AC-02
- [ ] every email subject and body names Pesly in es and en, and the rendered verification email's
      subject names Pesly — validates AC-03
- [ ] the recovery codes file name and header name Pesly in es and en — validates AC-04
- [ ] the local default sender is `Pesly <no-reply@pesly.local>` when `EMAIL_FROM` is not set —
      validates AC-08
- [ ] sad path: a catalog string that still names Argent, in any case, is reported by its dotted
      key, and "Argentina" is not — validates AC-02
- [ ] sad path: a missing or renamed catalog key still fails the existing parity tests —
      validates AC-03

**Completion criterion**
The tests above pass with the existing web, email and two-factor tests, and
`git grep -niwP argent` finds no product name in the catalogs, `env.ts`, the listed fixtures or
`AGENTS.md` lines 1 and 13.

## Block 3 — Package scope

**Files**
- `package.json` (modified) — `name` becomes `pesly`; the `--filter @argent/...` scripts become
  `@pesly/...`.
- `apps/api/package.json`, `apps/web/package.json`, `packages/shared/package.json` (modified) —
  names `@pesly/api`, `@pesly/web`, `@pesly/shared`; `workspace:*` dependencies on
  `@pesly/shared`.
- `pnpm-lock.yaml` (modified) — regenerated by `pnpm install` and committed with the change (CI
  and Railway install with `--frozen-lockfile`).
- Every source and test file importing `@argent/shared` (16 API source files, 9 web source files,
  7 test files, and `architecture-boundaries.test.ts`'s import fixture) (modified).
- `apps/api/scripts/build.mjs` (modified) — the bundled package's name is read from
  `packages/shared/package.json` instead of a hardcoded regex, so the next rename cannot leave it
  behind.
- `apps/api/test/deploy/build-output.test.ts` (modified) — the bundled-package check matches any
  scope (`/["']@[^/"']+\/shared["']/`).
- `apps/web/next.config.ts` (modified) — `transpilePackages: ['@pesly/shared']`.
- `playwright.config.ts` (modified) — the five `--filter` commands.
- `apps/api/test/deploy/package-scope.test.ts` (new) — scans tracked files for the old scope.
- Railway after the merge: the three services rebuild from `main` (recorded in the test report).

**Logic**

A mechanical rename of the package scope, checked by the type checker, the build and the tests.
`package-scope.test.ts` runs `git grep -l` with `cwd` set to the repository root, for a needle built
at runtime (`['@', 'argent/'].join('')` and its escaped form) so the test file never matches
itself, excluding `docs/ddw/` and `CHANGELOG.md` by pathspec; a pure helper,
`oldScopeReferences(paths)`, keeps the reported paths outside those exclusions.

**Input validation**
- None: the change takes no runtime input.

**Error handling**
- A file still referencing the old scope — the scan test fails listing the file.
- `build.mjs` leaving the shared package external — `build-output.test.ts` fails (the built bundle
  would import `@<scope>/shared`).
- A stale lockfile — `pnpm install --frozen-lockfile` fails in CI.
- A service failing to rebuild after the merge — the previous deployment keeps serving; revert the
  merge.

**Required tests**
- [ ] no tracked file outside `docs/ddw/` and `CHANGELOG.md` references the old scope, and the
      scan does not report itself — validates AC-05
- [ ] the built API bundles the shared package and imports no `@<scope>/shared` at runtime
      (`build-output.test.ts`) — validates AC-05
- [ ] sad path: a file still referencing the old scope is reported by path, and `docs/ddw/` is not —
      validates AC-05
- [ ] sad path: `build.mjs` leaving the shared package external makes `build-output.test.ts` fail
      — validates AC-05
- [ ] sad path: a stale lockfile fails `pnpm install --frozen-lockfile` (CI) — validates AC-05
- [ ] sad path, a service failing to rebuild after the merge (manual, recorded): the previous
      deployment keeps serving and the merge is reverted; after the merge the three services
      rebuild and report SUCCESS with no further apply — validates AC-09

**Completion criterion**
`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass;
`git grep -n "@argent"` outside `docs/ddw/` and `CHANGELOG.md` returns nothing; after the merge
the three services report SUCCESS and the web's page title is "Pesly".

## Final verification

- `git grep -niwP argent` outside `docs/ddw/`, `CHANGELOG.md`, the out-of-scope identifiers and
  fixture domains finds no product name; `git grep "@argent"` finds nothing outside `docs/ddw/` and
  `CHANGELOG.md`.
- `pnpm test:coverage`, `pnpm typecheck`, `pnpm lint` and `pnpm audit --prod --audit-level high`
  are clean.
- `pnpm railway:plan` is up to date; production serves Pesly, and no user was signed out.
