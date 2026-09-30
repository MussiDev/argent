# Threat model FIX-003: Give the email worker its own environment schema without Google credentials

| Field | Value |
|-------|-------|
| Ticket | FIX-003 |
| Spec | docs/ddw/specs/fix-FIX-003.md |
| Tier | FIX |
| Date | 2026-09-30 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/shared/config/env.ts` | Block 1, step 1 — `workerFields`, `emailIssues`, `workerProductionIssues`, `parseWorkerEnv` |
| `apps/api/src/worker.ts` | Block 1, step 2 — worker entry point |
| `playwright.config.ts` | Block 1, step 3 — `WORKER_ENV` for the e2e worker |

## Trust boundaries
- Railway service variables → worker process: the environment crosses into the process at start;
  after this fix only the worker's 7 settings are required, and the Google client secret and
  `JWT_SECRET` stop being provided to it.
- Worker process → PostgreSQL (`DATABASE_URL`) and → Resend (`RESEND_API_KEY`): unchanged.

## STRIDE analysis
### `apps/api/src/shared/config/env.ts`
- **Spoofing:** the schema authenticates nothing; the API keeps requiring `JWT_SECRET` and the
  Google client, so token signing and Google sign-in are unchanged.
- **Tampering:** a weaker worker schema could accept an unsafe production setting; the worker keeps
  the production checks that apply to it (`resend`, `https:` links), tested by AC-03 and AC-04 (R-01).
- **Repudiation:** not applicable; configuration parsing records nothing.
- **Information Disclosure:** errors list variable names and messages only, never values, through
  one shared `parseWith` helper (AC-05, R-02).
- **Denial of Service:** a new API-only setting no longer stops the worker, which is the defect
  this fixes.
- **Elevation of Privilege:** the API schema keeps every rule, so no API check is loosened (AC-06,
  R-03).

### `apps/api/src/worker.ts`
- **Spoofing:** the worker serves no requests and signs no tokens.
- **Tampering:** same database and transport as before.
- **Repudiation:** the worker still logs its provider on start and each send attempt.
- **Information Disclosure:** after the Railway cleanup the worker no longer holds `JWT_SECRET` or
  the Google client secret, so a compromised worker cannot forge sessions or act as the Google
  client (the reason for this fix).
- **Denial of Service:** a missing worker setting still stops the worker with a named error; the
  restart policy is unchanged.
- **Elevation of Privilege:** fewer secrets in the process; no new capability.

### `playwright.config.ts`
- **Spoofing:** test-only values, never used in production.
- **Tampering:** not applicable; test configuration.
- **Repudiation:** not applicable; test configuration.
- **Information Disclosure:** the e2e values are fakes already public in the repository.
- **Denial of Service:** if `WORKER_ENV` missed a setting the worker needs, e2e fails loudly; that
  is the intended signal.
- **Elevation of Privilege:** not applicable; test configuration.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `JWT_SECRET` and `GOOGLE_CLIENT_SECRET` | credentials | Railway encrypted service variables; removed from the worker service | injected only into the API container environment |
| `RESEND_API_KEY` and `DATABASE_URL` | credentials | Railway encrypted service variables | TLS to Resend; Railway private network to PostgreSQL |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | The worker schema drops a production check it needs and sends links over `http:` or through a fake transport | T | L | M | `workerProductionIssues` keeps both checks; AC-03 and AC-04 test them; rules defined once (NFR-03) |
| R-02 | A startup error prints a secret value | I | L | H | One `parseWith` helper formats names and messages only; AC-05 asserts no provided value appears |
| R-03 | Refactoring the API schema loosens an API rule | E | L | H | `env.test.ts` passes without edits (AC-06), including the Google production checks |

## Supply chain
No dependency is added or changed.

## Availability
The fix removes a way for the worker to be taken down by API-only settings. Startup failures still
name the variable and follow the existing restart policy.
