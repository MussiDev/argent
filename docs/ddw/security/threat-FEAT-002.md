# Threat model FEAT-002: Rename the product from Argent to Pesly

| Field | Value |
|-------|-------|
| Ticket | FEAT-002 |
| Spec | docs/ddw/specs/spec-FEAT-002.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| Web and email i18n catalogs (`apps/web/messages/*.json`, `apps/api/src/identity/infrastructure/email/messages/*.json`) | Block 1 |
| Workspace packages and `apps/api/scripts/build.mjs` (`BUNDLED_PACKAGE`) | Block 2 |
| `.railway/railway.ts` build commands and the production apply | Block 2, Block 3 |

## Trust boundaries
- API → user's mailbox (Resend): email subjects and bodies leave the system; recipients use the
  product name to judge whether an email is genuine.
- Developer machine → Railway API: `pnpm railway:plan|apply` with the user's session; apply
  rebuilds the three application services.
- npm registry and the pnpm workspace → build: the renamed `@pesly/*` packages are workspace
  packages resolved by `workspace:*`, never fetched from the registry.

## STRIDE analysis
### Web and email i18n catalogs
- **Spoofing:** emails that say "Pesly" now match the sender domain `pesly.com.ar` and the
  two-factor issuer; a mismatch (product "Argent" from `pesly.com.ar`) is what phishing awareness
  tells users to distrust, so the rename removes a confusing signal.
- **Tampering:** catalogs are static files changed only through reviewed commits; the parity tests
  keep es and en in step.
- **Repudiation:** no change to logging.
- **Information Disclosure:** the copy changes carry no data; no email gains content.
- **Denial of Service:** no runtime path changes.
- **Elevation of Privilege:** none.

### Workspace packages and `apps/api/scripts/build.mjs` (`BUNDLED_PACKAGE`)
- **Spoofing:** an `@pesly/*` package published on the public registry could be pulled instead of
  the workspace package if a dependency were declared with a version range; the spec keeps
  `workspace:*` for every internal dependency, which pnpm resolves only inside the workspace (R-01).
- **Tampering:** the lockfile is regenerated and committed; CI and Railway install with
  `--frozen-lockfile`, so an unexpected resolution fails the install.
- **Repudiation:** reviewed commits.
- **Information Disclosure:** none.
- **Denial of Service:** a missed rename in `BUNDLED_PACKAGE` would leave the shared package
  external and crash the API and worker on start (R-02).
- **Elevation of Privilege:** none.

### `.railway/railway.ts` build commands and the production apply
- **Spoofing:** apply runs with the user's own Railway session.
- **Tampering:** the plan is read before the apply; it must list only the three build commands.
- **Repudiation:** Railway's activity log records the apply.
- **Information Disclosure:** no variable or secret changes; secrets stay preserved.
- **Denial of Service:** name filters would break whichever came first, the apply or the merge,
  and pnpm exits 0 when a filter matches nothing (R-04); a failed rebuild keeps the previous
  deployment serving; a rebuild that starts but crashes would take the service down until rolled
  back (R-02).
- **Elevation of Privilege:** none.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Email subjects and bodies (product name only) | public | static catalogs in the repository | TLS to Resend and the recipient's provider |
| User sessions (cookies, access tokens) | credentials | unchanged: refresh token hashed in PostgreSQL; cookie names, JWT issuer and audience not modified | TLS, cookies `Secure`, `HttpOnly` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A public `@pesly/*` package is installed in place of the workspace package (dependency confusion) | S | L | H | every internal dependency stays `workspace:*`; the lockfile is committed and installs are frozen |
| R-02 | The API or worker crashes in production because the shared package is left external after the rename, or a build runs with a filter that matches nothing | D | M | H | `build.mjs` reads the shared package's name from its `package.json`; `build-output.test.ts` fails if the built bundle imports any `@<scope>/shared`; Railway builds by path with `--fail-if-no-match`, applied before the merge, so an unmatched filter fails the build and the previous deployment keeps serving |
| R-04 | The Railway build commands break when the rename reaches `main` (name filters stop matching, and pnpm exits 0 on no match) | D | H | H | build commands filter by path (`./apps/api`, `./apps/web`), which match both names, and are applied before the merge (spec Block 1); `--fail-if-no-match` turns any unmatched filter into a failed build |
| R-03 | Users are signed out by a renamed cookie or token claim | D | L | M | cookie names, the CSRF header value and the JWT issuer and audience are out of scope and unchanged (NFR-02) |

## Supply chain
No new dependency. The renamed scope `@pesly` is only used by workspace packages resolved through
`workspace:*`; nothing is published.

## Availability
The apply rebuilds the three application services once. A failed build leaves the previous
deployment serving; a crash on start is caught by the build test before merge (R-02).
