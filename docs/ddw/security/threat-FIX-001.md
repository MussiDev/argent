# Threat model FIX-001: Fix review edge cases in session refresh and sign-in refund

| Field | Value |
|-------|-------|
| Ticket | FIX-001 |
| Spec | docs/ddw/specs/fix-FIX-001.md |
| Tier | FIX |
| Date | 2026-09-28 |

No new endpoint, input, dependency or data flow. The change narrows two failure branches of existing
use cases; the parent model is `docs/ddw/security/threat-DISC-001-01a.md` (R-01, R-04, R-15 apply).

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/identity/application/refresh-session.ts` | Steps 1–2 (FR-01) |
| `apps/api/src/identity/application/ports/session-repository.ts` | Step 3, comment only (FR-01) |
| `apps/api/src/identity/application/sign-in.ts` | Steps 4–5 (FR-02) |

## Trust boundaries
- Browser → API: `POST /auth/refresh` carries the refresh token cookie; `POST /auth/sign-in` carries
  email and password. Unchanged by this fix.
- API → PostgreSQL: the rotation claim (`markReplaced`), the new committed-state re-read
  (`findById`) and the limiter refund (`release`) cross into the database.

## STRIDE analysis
### `apps/api/src/identity/application/refresh-session.ts`
- **Spoofing:** the refresh token remains the only credential; a lost claim never issues a session,
  whichever branch it takes, so no path hands out tokens it did not before.
- **Tampering:** the decision reads `replaced_by` from the committed row; the client supplies only
  the token, whose hash selects the row, so it cannot influence which branch is taken.
- **Repudiation:** real reuse still logs `refresh token reused; session family revoked` with user,
  family, IP and request id; a refresh that lost to a sign-out stops producing that false entry,
  which makes the reuse log more trustworthy for investigations.
- **Information Disclosure:** both lost-claim outcomes answer the same 401 `UNAUTHENTICATED` with
  cleared cookies, so a client cannot tell a sign-out race from a reuse detection.
- **Denial of Service:** one extra primary-key read, only on the rare lost-claim path; no loop and no
  lock is held (the rotation transaction has already rolled back).
- **Elevation of Privilege:** an attacker racing a victim's sign-out with a stolen live token gets 401
  and no successor; the family keeps no live session, because a signed-out session has no successor,
  so skipping the family revocation leaves nothing usable behind (R-01).

### `apps/api/src/identity/application/ports/session-repository.ts`
- **Spoofing:** comment-only change; no behaviour to impersonate.
- **Tampering:** comment-only change; the `UPDATE … WHERE revoked_at IS NULL` claim is unchanged.
- **Repudiation:** comment-only change; nothing logged differently.
- **Information Disclosure:** comment-only change; no data exposed.
- **Denial of Service:** comment-only change; no runtime cost.
- **Elevation of Privilege:** the corrected contract stops future callers from reading `false` as
  proof of reuse (R-02).

### `apps/api/src/identity/application/sign-in.ts`
- **Spoofing:** the rate-limited path still refuses before any Argon2id work or credential lookup;
  catching the refund error does not let the attempt proceed.
- **Tampering:** reservations and their windows come from the limiter, not from the request.
- **Repudiation:** a failed refund is logged through `reportRefundFailure` at warn with the error
  (safe serializer), on both paths.
- **Information Disclosure:** the answer is 429 `RATE_LIMITED` whether or not the refund failed, so
  a 500 no longer reveals a backend failure to the client; the logged error carries no query
  parameters or row values.
- **Denial of Service:** a failed refund leaves the units counted, so the limiter only gets stricter
  (fail safe); the refusal still happens before Argon2id, keeping R-04 of the parent model intact.
- **Elevation of Privilege:** swallowing the refund error never turns a refusal into an allowed
  attempt: `RateLimited` is thrown unconditionally after the try/catch (R-03).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| refresh token | credentials | SHA-256 hash in `sessions`; database volume encrypted with AES-256 by the managed provider | TLS 1.2+, `HttpOnly` `Secure` `SameSite=Strict` cookie |
| email address (limiter key) | PII | `auth_attempts` rows deleted after 24 h; database volume encrypted with AES-256; never written to logs | TLS 1.2+ |
| IP address (limiter key, logs) | PII | `auth_attempts` rows deleted after 24 h; database volume encrypted with AES-256 | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | a real reuse is misread as a sign-out race, so a stolen token's family is not revoked | E | L | H | reuse is decided on `replaced_by` from committed state; the existing PostgreSQL test of two concurrent refreshes (`sessions.test.ts:209`) must still end with the family revoked |
| R-02 | a future caller treats `markReplaced === false` as reuse again | E | L | M | port JSDoc corrected to state both meanings of `false` |
| R-03 | catching the refund error lets a rate-limited attempt through | S | L | H | `RateLimited` thrown after the try/catch in every case; unit test asserts 429 when `release` rejects |

## Supply chain
No new dependencies; the fix uses existing ports (`SessionRepository.findById`,
`SignInDependencies.reportRefundFailure`).

## Availability
The only added work is one primary-key read on the lost-claim path, which is rare (a concurrent
rotation or sign-out on the same session). A failed refund no longer surfaces as a 500, so a
degraded limiter store degrades to stricter limiting instead of errors on the refusal path.
