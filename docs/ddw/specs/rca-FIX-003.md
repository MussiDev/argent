# RCA FIX-003: Give the email worker its own environment schema without Google credentials

| Field | Value |
|-------|-------|
| Ticket | FIX-003 |
| Tracker | none |
| Date | 2026-09-30 |
| Origin | `argent-worker` crash-looping on Railway after PR #5 (DISC-001-01b) merged |
| Related PRD | `docs/ddw/prd/prd-DISC-001-01a.md` (outbox worker), `docs/ddw/prd/prd-DISC-001-01b.md` (Google sign-in); no gap |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

After DISC-001-01b merged, the `argent-worker` service on Railway exited on every start with
`Invalid environment: GOOGLE_CLIENT_ID: required in production; GOOGLE_CLIENT_SECRET: required in
production` until its restart budget ran out. It was brought back by giving the worker references to
the API's Google credentials, which it never uses. The worker also holds `JWT_SECRET`, which it never
reads. User decision 2026-09-30: the worker gets its own schema that asks only for what it uses
(option A), rather than only skipping the Google checks (option B).

### Root cause — the worker validates the API's environment

- **Component:** `apps/api/src/worker.ts` and `apps/api/src/shared/config/env.ts`.
- **Chain of events:**
  1. `worker.ts:11` calls `parseEnv(process.env)`, the API's schema.
  2. That schema requires every API setting (`JWT_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, ...) and, in
     production, the checks in `productionIssues` (`env.ts:48`).
  3. DISC-001-01b added `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to those production checks
     (`env.ts:70-71`).
  4. The worker, which does not sign in anyone, now refuses to start without them.
- **Technical root cause:** one environment schema serves two processes with different needs. The
  worker reads 7 settings — `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL` (`worker.ts:11-13`),
  `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` (`email-transport.ts:32`) and `WEB_BASE_URL`
  (`identity/index.ts:338`) — but must be given every secret the API needs.
- **Impact:** any new API-only setting can take the worker down (it happened with 01b), and the
  worker process holds `JWT_SECRET` and the Google client secret, widening what a compromise of the
  worker exposes.

## Goals

- The worker starts with only the settings it uses, in every environment.
- The worker keeps the production safety checks that apply to its settings.

## Functional Requirements

- FR-01: The worker must parse its environment with a schema that contains only `NODE_ENV`,
  `LOG_LEVEL`, `DATABASE_URL`, `WEB_BASE_URL`, `EMAIL_PROVIDER`, `RESEND_API_KEY` and
  `EMAIL_FROM`.
- FR-02: The worker schema must apply the same rules as the API schema to those 7 settings,
  including the production checks on them (`EMAIL_PROVIDER` must be `resend`, `WEB_BASE_URL` must use
  `https:`, `RESEND_API_KEY` and `EMAIL_FROM` required with Resend, Resend only with
  `NODE_ENV=production`).
- FR-03: The worker schema must not require `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  the Google endpoints, `WEB_ORIGIN`, `API_ORIGIN`, `TRUST_PROXY`, `BREACH_CHECKER` or `PORT`.
- FR-04: The worker must fail to start, naming the invalid variables and never their values, when a
  setting it uses is missing or invalid.

## Non-Functional Requirements

- NFR-01: The fix changes 0 HTTP contracts, 0 database columns and 0 migrations, and 0 rules of the
  API's own schema.
- NFR-02: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.
- NFR-03: The rules shared by both schemas are defined once (0 duplicated rule definitions), so the
  two cannot drift apart.

## Acceptance Criteria

- AC-01 (FR-01): WHEN the worker starts in production with exactly its 7 settings and valid
  values, THE worker SHALL start without error.
- AC-02 (FR-03): WHEN the worker starts in production without `JWT_SECRET` and without any Google
  setting, THE worker SHALL start without error.
- AC-03 (FR-02): IF the worker starts in production with `WEB_BASE_URL` on `http:`, THEN THE worker
  SHALL refuse to start and name `WEB_BASE_URL`.
- AC-04 (FR-02): IF the worker starts in production with an `EMAIL_PROVIDER` other than `resend`,
  THEN THE worker SHALL refuse to start and name `EMAIL_PROVIDER`.
- AC-05 (FR-04): IF `DATABASE_URL` is missing, THEN THE worker SHALL refuse to start with a message
  naming `DATABASE_URL` and containing no variable value.
- AC-06 (FR-01): WHEN the API starts, THE API SHALL keep validating its full schema, including the
  Google settings in production.

## Out of Scope

- Removing the now-unneeded variable references from the `argent-worker` service in Railway; done by
  hand after merge, with the user's confirmation.
- Any change to what the API requires.

## Risks and Mitigations

- **The two schemas drift:** a rule fixed in one and not the other. Mitigation: NFR-03, the shared
  rules are built once and reused by both schemas.
- **The worker silently loses a production check:** Mitigation: AC-03 and AC-04 test the production
  checks that apply to the worker.

## Dependencies

- `apps/api/src/shared/config/env.ts` (`parseEnv`, `productionIssues`).
- `apps/api/src/identity/infrastructure/email/email-transport.ts` (`createEmailTransport`).
- `apps/api/src/identity/index.ts` (`createEmailWorker`).
