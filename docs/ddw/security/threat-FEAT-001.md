# Threat model FEAT-001: Define the Pesly Railway services as Infrastructure as Code

| Field | Value |
|-------|-------|
| Ticket | FEAT-001 |
| Spec | docs/ddw/specs/spec-FEAT-001.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `.railway/railway.ts` | Block 1 |
| `apps/api/test/deploy/railway-iac.test.ts` | Block 1 |
| `package.json` scripts `railway:plan` / `railway:apply` | Block 1, Block 2 |
| `railway config pull` output in the scratch directory | Block 2 |
| `scripts/railway-config.mjs` | Block 3 |

## Trust boundaries
- Developer machine → Railway API: `railway config plan|apply|pull` carry the user's Railway session
  token and the desired configuration over HTTPS; apply changes production.
- Repository (public-facing GitHub) → Railway build: `.railway/railway.ts` is read from the repository,
  so anything committed there reaches whoever can read the repository.
- npm registry → developer machine and CI: the `railway` SDK package is installed from the registry
  and executed by the test runner and the CLI.
- Railway private network → `argent-postgres`: `DATABASE_URL` is a reference resolved by Railway,
  never a literal, so the database credential does not cross into the repository.

## STRIDE analysis
### `.railway/railway.ts`
- **Spoofing:** the definition carries no credential; `railway config apply` authenticates with the
  user's own Railway session, so the file cannot act as anyone.
- **Tampering:** a malicious change to the definition (for example a start command that exfiltrates
  variables) would run in production after apply; mitigated by pull-request review and by applying
  only after reading the plan (R-02).
- **Repudiation:** every change to the definition is a git commit on a reviewed pull request, and
  Railway records who applied each change in the project activity log.
- **Information Disclosure:** committing a secret value would publish it; every secret is
  `preserve()` and the test fails naming any secret with a literal value (R-01).
- **Denial of Service:** a wrong partial or name could delete or recreate a service, losing its
  domain or data; mitigated by the plan review that must show 0 creations and deletions (R-03).
- **Elevation of Privilege:** the partial owns only the four Pesly services; a definition that
  reached other services in the shared project would show up in the plan as changes outside the
  partial and stops the adoption (R-03).

### `apps/api/test/deploy/railway-iac.test.ts`
- **Spoofing:** the test calls no external service and holds no identity.
- **Tampering:** weakening the test (for example removing a secret from the list) is visible in the
  diff; the secret list is exported by the definition itself, so both change together.
- **Repudiation:** runs in CI on every pull request; results are kept in the CI logs.
- **Information Disclosure:** the test never reads real variable values; it reads only the
  definition's nodes, where secrets are the `preserve` marker.
- **Denial of Service:** pure in-process evaluation with no network; no resource concern.
- **Elevation of Privilege:** the test has no access to Railway; it cannot change production.

### `package.json` scripts `railway:plan` / `railway:apply`
- **Spoofing:** the scripts call the globally installed `railway` CLI with the user's session; a
  tampered global binary could impersonate the CLI (R-04).
- **Tampering:** `apply` modifies production; it is never run in CI and never without a reviewed
  plan (R-02).
- **Repudiation:** Railway's activity log records each apply with the user who ran it.
- **Information Disclosure:** plan output can include variable values for literal settings; secrets
  are preserved and are not printed as part of the definition.
- **Denial of Service:** an apply that recreates a service causes downtime; mitigated by the empty
  plan requirement (R-03).
- **Elevation of Privilege:** the scripts run with the user's Railway permissions only; no token is
  stored in the repository or in CI.

### `railway config pull` output in the scratch directory
- **Spoofing:** not applicable beyond the CLI session that produced it.
- **Tampering:** the output is only read for comparison; nothing is applied from it.
- **Repudiation:** the comparison and any corrected value are recorded in the commit and the test
  report.
- **Information Disclosure:** the pulled definition may contain secret values; it is written to the
  session scratch directory outside the repository and deleted after the comparison (R-05).
- **Denial of Service:** none; a read-only command.
- **Elevation of Privilege:** none; it reads with the user's permissions.

### `scripts/railway-config.mjs`
- **Spoofing:** the wrapper runs whatever `railway` the OS lookup returns, and sets `_` so the SDK
  executes that same binary; a planted `railway` earlier on the PATH would run with the user's
  Railway session (R-04).
- **Tampering:** it only accepts `plan` or `apply` and passes the remaining arguments as an argument
  array, never through a shell, so no argument can inject a command.
- **Repudiation:** it adds nothing to log; Railway's activity log records each apply.
- **Information Disclosure:** it prints only the CLI's own output and a fixed not-found message; it
  reads no variable values.
- **Denial of Service:** a missing CLI exits with code 1 at once; no retry loop.
- **Elevation of Privilege:** it runs with the user's own permissions and Railway session; it is
  never run in CI.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `JWT_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | credentials | encrypted by Railway's variable store; never in the repository (`preserve()`) | TLS between the CLI and the Railway API |
| `DATABASE_URL` (contains the PostgreSQL password) | credentials | stored by Railway on `argent-postgres`; the repository holds only a reference | Railway private network for the services; TLS for the CLI |
| Railway session token | credentials | the CLI's own config file in the user's home directory, outside the repository | TLS to the Railway API |
| Non-secret settings (origins, email sender, log level) | public | committed in `.railway/railway.ts` | TLS |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A secret value is committed in `.railway/railway.ts` | I | M | H | every secret is `preserve()`; the test fails naming any secret with a literal value (AC-05) |
| R-02 | A tampered or unreviewed definition is applied to production | T | L | H | changes go through a reviewed pull request; apply is manual, never in CI, and only after reading the plan |
| R-03 | The first apply deletes or recreates a service, or touches services of other projects | D | M | H | the partial owns only the four services; adoption stops on any creation, deletion or change outside the partial (Block 2) |
| R-04 | A compromised or planted Railway CLI, run by the user's shell or by the wrapper through `_` | S | L | M | the CLI is installed from the official `@railway/cli` package by the user; the wrapper only resolves the PATH lookup or the `railway.exe` npm installs beside its own shim, runs it without a shell, and accepts only `plan`/`apply`; the repository pins the SDK in the lockfile |
| R-05 | Secret values from `railway config pull` leak into the repository | I | M | H | pull runs in the scratch directory outside the repository and the file is deleted after comparison; `git status` is checked |

## Supply chain
One new package, `railway` 3.12.0 (Railway's official TypeScript SDK, MIT), added as an exact-pinned
development dependency in the root and `apps/api`; it is locked in `pnpm-lock.yaml`, excluded from
`pnpm audit --prod` and from the API bundle, and has no install script. The Railway CLI is not a
repository dependency (user decision 2026-10-01); the user installs it globally.

## Availability
The only availability risk is an apply that recreates or deletes a service (R-03), controlled by the
empty-plan requirement. The test runs offline and adds no load to production.
