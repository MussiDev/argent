# Threat model FIX-002: Align Railway deployment with the monorepo and cap runtime memory

| Field | Value |
|-------|-------|
| Ticket | FIX-002 |
| Spec | docs/ddw/specs/fix-FIX-002.md |
| Tier | FIX |
| Date | 2026-09-28 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/scripts/build.mjs` | Step 1 — esbuild bundle of server, worker and migration entry points |
| `apps/api/railway.json` | Step 3 — API service: build, pre-deploy migration, start |
| `apps/api/railway.worker.json` | Step 3 — email worker service: build, start |
| `apps/web/railway.json` | Step 3 — web service: build, start |
| `apps/web/package.json` | Step 2 — `start` listens on `PORT` |

## Trust boundaries
- GitHub `main` → Railway build: the repository (source, lockfile, `railway*.json`) crosses into the
  build environment, which holds no runtime secrets it needs to bundle.
- Railway build → runtime container: the built image (`apps/api/dist`, `.next`) crosses; secrets
  are injected only at runtime as environment variables.
- Public internet → Railway edge → API and web containers: HTTPS terminated at the edge
  (NFR-07 of DISC-001-01a); the worker has no public domain.
- API, worker and pre-deploy migration → PostgreSQL: `DATABASE_URL` over Railway's private network
  (`*.railway.internal`), no TCP proxy.

## STRIDE analysis
### `apps/api/scripts/build.mjs`
- **Spoofing:** runs only in the build environment from repository code; no identity is involved.
- **Tampering:** a tampered `esbuild` binary would alter every bundle; the version is pinned by
  `pnpm-lock.yaml` integrity hashes and installed with `--frozen-lockfile` (R-04).
- **Repudiation:** every build runs from a git commit that Railway records per deployment.
- **Information Disclosure:** the script uses no `define` of `process.env`, so no environment value
  is inlined into the bundle; a test asserts the bundle carries no `process.env` substitution
  (R-01).
- **Denial of Service:** a failed build leaves the previous deployment running; Railway never swaps
  in an image that did not build.
- **Elevation of Privilege:** bundling does not change what the code can do at runtime; imports
  outside `@argent/shared` stay external and resolve to the locked packages.

### `apps/api/railway.json`
- **Spoofing:** not applicable to a config file; the service identity is Railway's.
- **Tampering:** changes only through a reviewed commit to `main`; CI runs on every PR.
- **Repudiation:** the deployment view shows the config used per deployment.
- **Information Disclosure:** the file holds commands only, never variables or secrets; a test
  asserts it has no `variables` key (R-01).
- **Denial of Service:** the pre-deploy migration blocks the new version when it fails, so a broken
  migration never serves traffic (R-02); the heap cap can cause restarts, bounded by the restart
  policy (R-03).
- **Elevation of Privilege:** the pre-deploy migration uses the same `DATABASE_URL` as the API; this
  is unchanged from DISC-001-01a and already tracked as SAST finding I-03.

### `apps/api/railway.worker.json`
- **Spoofing:** the worker serves no HTTP and gets no public domain, so nothing can call it.
- **Tampering:** same review path as the API config.
- **Repudiation:** the worker logs every send attempt (DISC-001-01a Block 8).
- **Information Disclosure:** commands only, no secrets; covered by the same test (R-01).
- **Denial of Service:** a 192 MB heap cap that is too low restarts the worker; outbox rows stay
  pending and are sent after the restart (R-03).
- **Elevation of Privilege:** no new permission; same database role as today.

### `apps/web/railway.json`
- **Spoofing:** the web holds no financial data (AGENTS.md); it forwards to the API.
- **Tampering:** same review path as the API config.
- **Repudiation:** Railway records the config per deployment.
- **Information Disclosure:** commands only, no secrets; covered by the same test (R-01).
- **Denial of Service:** the heap cap can restart Next.js under load, bounded by the restart policy
  (R-03).
- **Elevation of Privilege:** `NODE_OPTIONS` is set in the start command only, so the build is not
  constrained and no flag reaches other processes.

### `apps/web/package.json`
- **Spoofing:** listening on `PORT` does not change who can reach the server; the edge routes to it.
- **Tampering:** not applicable; a script change.
- **Repudiation:** not applicable; a script change.
- **Information Disclosure:** no change to what the web serves.
- **Denial of Service:** an unset `PORT` falls back to Next.js's default 3000, which Playwright
  and local runs use today.
- **Elevation of Privilege:** not applicable; a script change.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `DATABASE_URL` (includes the database password) | credentials | Railway encrypted service variables; never in the repository or the bundle | Railway private network (WireGuard) |
| `JWT_SECRET` and email provider key | credentials | Railway encrypted service variables; never in the repository or the bundle | injected into the container environment only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A secret ends up in a `railway*.json` file or inlined into the bundle | I | L | H | Config test rejects a `variables` key; build test asserts no `process.env` value is inlined; secrets live only in Railway variables |
| R-02 | A failed migration leaves the API serving against a half-migrated schema | D | L | H | Migration runs as `preDeployCommand`; a non-zero exit cancels the deployment and the previous one keeps serving |
| R-03 | The heap cap is too low and the process restarts in a loop | D | M | M | `ON_FAILURE` with at most 10 retries; caps sit above measured usage of similar services; revisit against Railway Metrics |
| R-04 | A compromised `esbuild` release alters the API bundle | T | L | H | Version pinned in `pnpm-lock.yaml` with integrity hashes and installed frozen; it is a devDependency that does not ship at runtime |
| R-05 | The API starts without `NODE_ENV=production`, skipping production-only checks (SAST L-03) | E | M | H | `NODE_ENV=production` set in Railway variables for every service before the first deployment; the API logs `nodeEnv` on start, checked in the deploy logs |

## Supply chain
One dev-time dependency is declared: `esbuild` ^0.28.2, the version already resolved in
`pnpm-lock.yaml` through `tsx`. It runs only during the build and is not imported at runtime. No
runtime dependency is added (NFR-04 of the RCA).

## Availability
The heap caps trade peak memory for possible restarts (R-03). Failed builds and failed migrations
keep the previous deployment serving (R-02). Volumetric attacks stop at Railway's edge; this change
adds no endpoint.
