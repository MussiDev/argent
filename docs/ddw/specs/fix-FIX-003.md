# Fix-plan FIX-003: Give the email worker its own environment schema without Google credentials

| Field | Value |
|-------|-------|
| Ticket | FIX-003 |
| Tier | FIX |
| RCA | docs/ddw/specs/rca-FIX-003.md |
| Date | 2026-09-30 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Problem
The email worker refuses to start in production unless it is given the API's Google credentials,
and it holds `JWT_SECRET`, although it reads neither.

## Root cause
`apps/api/src/worker.ts:11` validates its environment with the API's `parseEnv`, so every API
setting — and every production check added for the API, such as the Google client in
DISC-001-01b — is also required by the worker (RCA FIX-003).

## Coverage: RCA → steps
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, step 1, step 2 |
| FR-02 | Block 1, step 1 |
| FR-03 | Block 1, step 1, step 3 |
| FR-04 | Block 1, step 1 |
| NFR-01 | Strategy: the API schema keeps every field and rule; `apps/api/test/foundation/env.test.ts` stays unchanged and green |
| NFR-02 | Strategy: new tests in `apps/api/test/foundation/worker-env.test.ts` cover the new schema and its branches |
| NFR-03 | Strategy: the worker fields, the email refinements and the worker-relevant production checks are defined once in `env.ts` and composed into both schemas |

## Block 1 — Solution steps

All steps form one block, verified as a unit.

**Files**
- `apps/api/src/shared/config/env.ts` (modified) — step 1
- `apps/api/src/worker.ts` (modified) — step 2
- `playwright.config.ts` (modified) — step 3
- `apps/api/test/foundation/worker-env.test.ts` (new) — tests below
- `CHANGELOG.md` (modified) — step 4

1. `apps/api/src/shared/config/env.ts` — extract `workerFields` (the zod shape of `NODE_ENV`,
   `LOG_LEVEL`, `DATABASE_URL`, `WEB_BASE_URL`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`),
   `emailIssues(env)` (Resend requires `RESEND_API_KEY` and `EMAIL_FROM`; Resend only with
   `NODE_ENV=production`) and `workerProductionIssues(env)` (`EMAIL_PROVIDER` must be `resend`;
   `WEB_BASE_URL` must use `https:`). The API schema becomes `z.object({ ...workerFields,
   ...apiFields })` and its refinement calls `emailIssues` and, in production, `productionIssues`,
   which now starts from `workerProductionIssues` and adds the API-only checks — same rules, same
   messages. Add `workerEnvSchema = z.object(workerFields)` refined with `emailIssues` and, in
   production, `workerProductionIssues`, with the same `EMAIL_FROM` default transform. Both
   `parseEnv` and the new exported `parseWorkerEnv` go through one `parseWith(schema, source)`
   helper that throws `Invalid environment: <names and messages>`, never values. Export
   `type WorkerEnv`.
2. `apps/api/src/worker.ts:11` — call `parseWorkerEnv(process.env)` instead of `parseEnv`.
3. `playwright.config.ts:22-83` — split `API_ENV` into `WORKER_ENV` (the worker's settings:
   `DATABASE_URL`, `WEB_BASE_URL`, `EMAIL_PROVIDER`) and `API_ENV` (`WORKER_ENV` plus the API-only
   settings); the worker webServer gets `WORKER_ENV`, and the comment on line 22 says so.
4. `CHANGELOG.md` — `### Fixed` entry for FIX-003 (written at CLOSEOUT).

After merge, applied by hand in Railway with the user's confirmation (outside the repository):
remove `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `API_ORIGIN`, `WEB_ORIGIN`,
`TRUST_PROXY` and `BREACH_CHECKER` from `argent-worker`.

## Data model
**Data model**
No change: no table, column, index, default or constraint is added or modified.

## Dependencies between steps
Step 2 depends on step 1 (`parseWorkerEnv` must exist). Step 3 is independent. Step 4 happens at
CLOSEOUT.

## Error handling
- A worker setting is missing or invalid — `parseWorkerEnv` throws `Invalid environment:` listing
  each variable name and message, never a value; the worker process exits non-zero and Railway
  restarts it under `ON_FAILURE`.
- A worker production check fails (`EMAIL_PROVIDER` not `resend`, `WEB_BASE_URL` not `https:`) —
  the same error, naming the variable; the worker does not start.
- Resend is configured without `RESEND_API_KEY` or `EMAIL_FROM` — the same error, naming the
  missing variable.

## Tests
- [ ] **Regression test** — `worker-env.test.ts`: `parseWorkerEnv` accepts a production environment
      with only the worker's 7 settings and no `JWT_SECRET` or Google settings; fails BEFORE the
      fix (the function does not exist, and `parseEnv` rejects that environment), passes AFTER —
      validates AC-01, AC-02.
- [ ] Invalid `WEB_BASE_URL` error — `worker-env.test.ts`: production with `WEB_BASE_URL` on
      `http:` throws naming `WEB_BASE_URL` — validates AC-03.
- [ ] Invalid `EMAIL_PROVIDER` error — `worker-env.test.ts`: production with `EMAIL_PROVIDER=console`
      throws naming `EMAIL_PROVIDER` — validates AC-04.
- [ ] Missing `DATABASE_URL` error — `worker-env.test.ts`: throws naming `DATABASE_URL`, and the
      message contains none of the provided values — validates AC-05.
- [ ] Missing Resend settings error — `worker-env.test.ts`: `EMAIL_PROVIDER=resend` without
      `RESEND_API_KEY` or `EMAIL_FROM` throws naming each.
- [ ] `worker-env.test.ts`: `EMAIL_FROM` defaults to the local sender with console or mailpit.
- [ ] Unchanged API rules — `apps/api/test/foundation/env.test.ts` passes without edits, including
      the Google production checks — validates AC-06.

## Regression risk
Low — the API schema keeps every field and rule (its existing test file is the check), and the
worker's consumers (`createEmailWorker`, `createEmailTransport`) take `Pick<Env, …>` of fields the
worker schema produces with the same types. The only runtime change is which variables the worker
demands.

## Rollback plan *(mandatory)*
- Steps: trivial: revert the commit. If the Railway variables were already removed from
  `argent-worker`, re-add them as references to `argent-api` before redeploying the reverted code.
- Indicators: the worker fails to start with `Invalid environment`, or the API accepts an
  environment its old schema rejected.
