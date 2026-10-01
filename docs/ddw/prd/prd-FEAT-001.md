# PRD FEAT-001: Define the Pesly Railway services as Infrastructure as Code

| Field | Value |
|-------|-------|
| Ticket | FEAT-001 |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

FIX-002 described the three Pesly application services in `apps/api/railway.json`,
`apps/api/railway.worker.json` and `apps/web/railway.json` (Railway "Config as Code"). Railway
refused to opt the services into that format (services that never used it cannot opt in since
2026-08-28), so the same values were typed by hand into the Railway UI. The files no longer drive
anything, and Railway stops reading Config as Code on 2026-12-01.

Today the repository and production can drift silently: a change to a `railway.json` does nothing,
and a change in the UI is invisible to the repository. Railway's replacement is Infrastructure as
Code: a `.railway/railway.ts` file applied with `railway config plan` / `railway config apply`,
which supports partials that own only some services of a project.

The Pesly services share the Railway project with unrelated services (nortear, brisa-studio,
portfolio and others), which this change must not touch.

User decisions (2026-10-01): migrate to Infrastructure as Code (option A) rather than delete the
files; declare the non-secret variables in the file and keep every secret out of the repository.

## Goals

- The repository is again the source of truth for how the Pesly services are built, started and
  configured.
- Applying the definition to production changes nothing that is running today.

## Functional Requirements

- FR-01: The repository must define the four Pesly services — `argent-api`, `argent-worker`,
  `argent-web` and `argent-postgres` — in a Railway Infrastructure as Code partial that owns only
  those services.
- FR-02: The definition must declare, for each application service, its build command, start
  command (with the heap caps from FIX-002), watch paths and restart policy, and for `argent-api`
  its pre-deploy migration command.
- FR-03: The definition must declare each application service's non-secret variables as values or
  references between services, and must leave every secret variable (`JWT_SECRET`,
  `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) preserved, with no value in the
  repository.
- FR-04: The repository must provide commands to preview (`plan`) and to apply the definition
  against the production environment.
- FR-05: The repository must remove the three `railway*.json` files and replace the test that
  checks them with a test that checks the Infrastructure as Code definition.

## Non-Functional Requirements

- NFR-01: The first `plan` against production lists 0 services created or deleted, 0 changes to
  services outside the partial, and 0 changes to the build, start, pre-deploy, watch path and
  restart settings now in production.
- NFR-02: The repository contains 0 secret values: every secret is preserved.
- NFR-03: The change adds 0 runtime dependencies; tooling is a development dependency only.
- NFR-04: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the definition is planned against production, THE plan SHALL list only the
  four Pesly services as managed by the partial.
- AC-02 (FR-01): IF the definition is planned against production, THEN THE plan SHALL show no
  change, creation or deletion for any service outside the partial.
- AC-03 (FR-02): WHEN the definition is checked by the test suite, THE test SHALL find the build,
  start, watch paths and `ON_FAILURE` restart policy (at most 10 retries) of each application
  service, the API pre-deploy migration, and start commands capped at 320 MB (API, web) and 192 MB
  (worker).
- AC-04 (FR-03): WHEN the definition is checked by the test suite, THE test SHALL find each
  service's non-secret variables declared and each secret variable preserved.
- AC-05 (FR-03): IF a secret variable is given a value in the definition, THEN THE test suite SHALL
  fail naming that variable.
- AC-06 (FR-04): WHEN the plan command runs against production after the migration, THE plan SHALL
  report no differences for the managed services.
- AC-07 (FR-05): WHEN the change is merged, THE repository SHALL contain no `railway.json` or
  `railway.worker.json` file.

## Out of Scope

- A GitHub Action that applies the definition automatically; applying stays a manual step after
  reviewing the plan.
- Renaming the services or the repository from argent to pesly (its own ticket).
- Custom domains, the PostgreSQL image and volume settings, and replica limits beyond what
  Railway already has.
- The services of other projects sharing the Railway project.

## Risks and Mitigations

- **The partial deletes or rewrites unrelated services.** Mitigation: AC-02 and NFR-01 — the plan
  is reviewed before any apply, and no apply runs with changes outside the partial.
- **A secret ends up in the repository.** Mitigation: AC-05 — the test fails on any secret with a
  value; secrets stay preserved (NFR-02).
- **The first apply recreates a service, losing its domain or data.** Mitigation: the existing
  services are adopted (`railway config pull`) and the plan must show 0 creations or deletions
  before applying (NFR-01).
- **The DSL or CLI changes.** Mitigation: versions are pinned in the lockfile as development
  dependencies.

## Dependencies

- Railway Infrastructure as Code (`.railway/railway.ts`, `railway config plan|apply|pull`):
  https://docs.railway.com/infrastructure-as-code
- The settings and variables entered by hand in FIX-002 and FIX-003
  (`docs/ddw/specs/fix-FIX-002.md`, `docs/ddw/specs/fix-FIX-003.md`).
- `apps/api/test/deploy/railway-config.test.ts`, which is replaced.
