# PRD FEAT-002: Rename the product from Argent to Pesly

| Field | Value |
|-------|-------|
| Ticket | FEAT-002 |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

The product was renamed from Argent to Pesly on 2026-09-30 because `argent.com.ar` was taken; the
production domains are `pesly.com.ar` and `api.pesly.com.ar`. Only the two-factor authenticator
issuer says "Pesly" (DISC-001-01c). Every other place a user meets the product still says "Argent":
the web app's title and PWA name, the copy of the screens, the recovery codes file, and every email
subject and body, in Spanish and English. A user who signs up on `pesly.com.ar` receives "Confirm
your email for Argent".

The repository also names itself Argent: the root package, the `@argent/*` workspace packages that
every import and every Railway build command (`pnpm --filter @argent/api build`) refer to, and the
project docs (`AGENTS.md`).

User decisions (2026-10-01): rename now that two-factor authentication is merged; rename the
user-visible copy, the docs and the package scope; leave out the identifiers whose rename has a
real cost — cookie names (renaming them signs every user out), the `X-Requested-With` value (the
API and the web deploy separately, so a mismatch window would reject requests), and the Railway
service and database names (an Infrastructure as Code rename can recreate a service).

## Goals

- Every screen, email and file a user sees says Pesly, in Spanish and English.
- The repository and its packages are named after the product.
- Production keeps building and running with no user signed out.

## Functional Requirements

- FR-01: The web app must show "Pesly" as its title, its PWA name and short name, and in every UI
  string that names the product, in Spanish and English.
- FR-02: Every transactional email (email verification, password reset, two-factor enabled and
  disabled) must name the product "Pesly" in its subject and body, in Spanish and English.
- FR-03: The recovery codes file must be named and headed with "Pesly".
- FR-04: The workspace packages must be renamed from `@argent/api`, `@argent/web` and
  `@argent/shared` to `@pesly/api`, `@pesly/web` and `@pesly/shared`, and the root package from
  `argent` to `pesly`, with every import, filter and reference updated.
- FR-05: The Railway definition must build the API, worker and web with the renamed package
  filters, and production must be updated through the Infrastructure as Code plan and apply.
- FR-06: The project docs (`AGENTS.md`) and the local default email sender must name the product
  Pesly.

## Non-Functional Requirements

- NFR-01: After the change, a search of the repository outside `docs/ddw/` and `CHANGELOG.md`
  finds 0 occurrences of "Argent" as a product name in user-visible copy, package names or imports;
  the occurrences that remain are the out-of-scope identifiers and the word "Argentina".
- NFR-02: 0 users are signed out: cookie names and the `X-Requested-With` value are unchanged.
- NFR-03: The plan against production lists only the three build command changes: 0 creations,
  0 deletions, 0 other changes.
- NFR-04: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the web app is loaded in Spanish or English, THE page title and the PWA
  manifest name SHALL be "Pesly".
- AC-02 (FR-01): WHEN the UI catalogs are checked by the test suite, THE es and en catalogs SHALL
  contain no "Argent" as a product name.
- AC-03 (FR-02): WHEN any transactional email is rendered in Spanish or English, THE subject and
  body SHALL name "Pesly" and not "Argent".
- AC-04 (FR-03): WHEN a user downloads the recovery codes, THE file name and its first line SHALL
  name Pesly.
- AC-05 (FR-04): WHEN the workspace is installed, built, linted, type-checked and tested, THE
  packages SHALL resolve as `@pesly/*` with no reference to `@argent/*`.
- AC-06 (FR-05): WHEN the definition is planned against production, THE plan SHALL list only the
  build commands of `argent-api`, `argent-worker` and `argent-web` changing to `@pesly/*` filters.
- AC-07 (FR-05): IF the renamed build fails on Railway, THEN THE previous deployment SHALL keep
  serving and the rollback SHALL restore the `@argent/*` build commands.
- AC-08 (FR-06): WHEN the API runs without `EMAIL_FROM` outside production, THE default sender
  SHALL name Pesly.

## Out of Scope

- Cookie names (`__Host-argent_*`, `__Secure-argent_oauth`), the `X-Requested-With: argent` value
  and the refresh lock name in the web client.
- Railway service names (`argent-*`), database names and credentials, `docker-compose.yml`, the CI
  database settings and `.env.example` database URLs.
- Test fixture domains such as `argent.test`.
- The Google Auth Platform app name on the consent screen (changed by hand in Google Cloud).
- `docs/ddw/` history and existing `CHANGELOG.md` entries.

## Risks and Mitigations

- **Railway builds break on the new filters:** Mitigation: the plan must show only the build
  commands (AC-06); the previous deployment keeps serving if a build fails, and the rollback
  restores the old commands (AC-07).
- **A missed import breaks the build:** Mitigation: AC-05 — install, build, lint, typecheck and the
  full suite run on the renamed workspace, and CI runs them again.
- **Users are signed out:** Mitigation: NFR-02 — cookie names and the CSRF header value are not
  touched.
- **"Argentina" is renamed by mistake:** Mitigation: replacements match the product name only, and
  the time zone tests (`America/Argentina/Buenos_Aires`) keep passing.

## Dependencies

- `.railway/railway.ts`, `scripts/railway-config.mjs` and `apps/api/test/deploy/railway-iac.test.ts`
  (FEAT-001).
- The i18n catalogs in `apps/web/messages/` and `apps/api/src/identity/infrastructure/email/messages/`.
