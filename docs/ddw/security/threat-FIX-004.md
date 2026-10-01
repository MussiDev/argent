# Threat model FIX-004: Concurrent Google callbacks fail intermittently with google_failed

| Field | Value |
|-------|-------|
| Ticket | FIX-004 |
| Spec | docs/ddw/specs/fix-FIX-004.md |
| Tier | FIX |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/identity/application/complete-google-sign-in.ts` (`resolveAccount`) | Block 1, step 1 |
| `apps/api/test/identity/google-sign-in-races.test.ts` | Block 1, steps 2 and 3 |

## Trust boundaries
- Browser → API: `GET /auth/google/callback` carries the OAuth `state`, `code` and the binding
  cookie; the state is single use and bound to the browser before `resolveAccount` runs.
- API → Google: the code exchange returns signed ID token claims (`sub`, `email`,
  `email_verified`); only verified claims reach `resolveAccount`.
- API → PostgreSQL: the lookups and inserts of `resolveAccount` run in one transaction at READ
  COMMITTED.

## STRIDE analysis
### `apps/api/src/identity/application/complete-google-sign-in.ts` (`resolveAccount`)
- **Spoofing:** the new branch signs in only when the Google identity linked to the user is the one
  whose `sub` came from the verified ID token; a different Google account is still refused (R-01).
- **Tampering:** `sub` and `email` come from Google's signed token, not from request parameters;
  the extra read cannot be steered by the caller.
- **Repudiation:** the route still logs every sign-in with `via`, user id and session id, and every
  refusal with its reason.
- **Information Disclosure:** no new data is returned; the redirect is the same signed-in page the
  winning callback gets.
- **Denial of Service:** one extra indexed read, only in the branch that used to refuse; no new
  loop or retry.
- **Elevation of Privilege:** the user signed in is the one already linked to this exact Google
  subject, the same outcome as the `existing_identity` path at the start of `resolveAccount` (R-02).

### `apps/api/test/identity/google-sign-in-races.test.ts`
- **Spoofing:** the test uses the fake OIDC provider and fixed claims; no real Google account.
- **Tampering:** the competing callback is injected through the unit of work, test code only.
- **Repudiation:** runs in CI on every pull request.
- **Information Disclosure:** fixture emails and subjects only.
- **Denial of Service:** runs against the test database, serially with the other API tests.
- **Elevation of Privilege:** test code has no production access.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Google `sub` and email | PII | PostgreSQL on Railway, private network only; volume encryption by the platform | TLS from Google; private network to the database |
| Session tokens issued on sign-in | credentials | refresh token stored hashed; access token not stored | TLS, cookies `Secure`, `HttpOnly` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | The fix signs a second, different Google account into an existing user | S | L | H | the sign-in proceeds only when `findUserByProviderSubject(sub)` returns the same user; the different-subject sad path test (AC-03) keeps the refusal |
| R-02 | The re-read returns a user whose link a concurrent reset is removing (R-37) | E | L | M | the user is taken from the same read that returns the link, as the first lookup does; the existing R-37 test still runs |

## Supply chain
No dependency change.

## Availability
One extra indexed read in a branch that previously ended the request; no new retry or loop.
