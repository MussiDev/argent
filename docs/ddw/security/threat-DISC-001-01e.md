# Threat model DISC-001-01e: Display Name at Sign-Up

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01e |
| Spec | docs/ddw/specs/spec-DISC-001-01e.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/auth/register.ts` | Block 1 |
| `apps/api/src/identity/domain/display-name.ts` | Block 1 |
| `apps/api/src/identity/application/register-user.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` | Block 3 |
| `apps/api/src/identity/application/complete-google-sign-in.ts` | Block 3 |
| `apps/web/src/features/auth/containers/register-container.tsx` | Block 4 |

## Trust boundaries
- Browser → API: `POST /auth/register` now carries `displayName` besides the email and password, over the public internet, unauthenticated, rate-limited per IP; the answer must stay identical for new and already registered emails.
- Google → API: the ID token returned by Google's token endpoint carries the `name` claim, which the API verifies and parses in `google-oidc-identity-provider.ts`; the name is a value chosen by the Google account's holder, so it is untrusted text.
- API → PostgreSQL: `drizzle-user-repository.ts` writes `users.display_name` in the same `INSERT` that creates the account; a check constraint (1 to 50 characters) guards it.
- User-supplied text → rendered UI: the stored name is shown by the profile screen of DISC-001-01d and by later screens, so it crosses from an untrusted string into the web app's DOM.

## STRIDE analysis
### `packages/shared/src/auth/register.ts`
- **Spoofing:** the schema carries no identity; a display name is not unique and proves nothing about who registers (R-05).
- **Tampering:** the schema is a stripping `z.object`, so unknown keys are dropped; `displayName` is trimmed and bounded (1 to 50 code points) before any use case sees it.
- **Repudiation:** not applicable to a pure schema; the route logs the outcome without the name (R-04).
- **Information Disclosure:** a validation failure lists only the failing field path (`body.displayName`), never the submitted value.
- **Denial of Service:** the UTF-16 cap of 200 before code points are counted rejects an oversized name without iterating it, and the 16 kb body limit bounds the rest (R-06).
- **Elevation of Privilege:** the new field grants nothing: it is stored as plain text and not read by any authorization decision.

### `apps/api/src/identity/domain/display-name.ts`
- **Spoofing:** not applicable; it is a pure function of a claim.
- **Tampering:** only the function's output (a valid name or null) reaches storage, so a crafted `name` claim (control characters, markup, a 10 kb string, a non-string) cannot reach the database in a form that breaks the 1 to 50 rule (R-02).
- **Repudiation:** not applicable; it records nothing.
- **Information Disclosure:** it returns only what it is given, reduced; the claim is never logged.
- **Denial of Service:** it works on a string already bounded by the verified ID token and truncates with a single pass over at most the claim's length; the adapter also bounds the claim (R-06).
- **Elevation of Privilege:** not applicable; it grants nothing.

### `apps/api/src/identity/application/register-user.ts`
- **Spoofing:** a registration for an email that already exists cannot change that account: the existing-email branch ignores the submitted name and never writes (R-01).
- **Tampering:** the name is stored only on the account this request creates, inside the existing unit of work; a concurrent duplicate registration is absorbed and stores nothing.
- **Repudiation:** the registration log carries the outcome and the new user id, never the name or the email.
- **Information Disclosure:** the 202 body and status are identical for new and existing emails, and an invalid name answers the same 400 before any email lookup, so the new field cannot reveal whether an email is registered (R-03).
- **Denial of Service:** no query and no hashing is added; the per-IP registration limit and the existing breach-check order are unchanged (R-06).
- **Elevation of Privilege:** the use case cannot set any other column from the request; the name does not influence verification, roles or sessions.

### `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts`
- **Spoofing:** not applicable; the repository takes values already validated by the schema and the use case.
- **Tampering:** one parameterized `INSERT` writes `display_name` with the other columns; the `users_display_name_check` constraint rejects an empty or over-long value as the last line of defense (R-02).
- **Repudiation:** not applicable; the row has `created_at` as before.
- **Information Disclosure:** the repository adds no new read; nothing about other users is returned.
- **Denial of Service:** the statement is the same single insert as before with one more column.
- **Elevation of Privilege:** it has no method that lets a caller change another user's name; creation only.

### `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts`
- **Spoofing:** the `name` claim is read only from an ID token whose signature, audience, issuer, expiry and nonce were verified (DISC-001-01b NFR-02), so an attacker cannot inject a name without a valid token; the name itself is the holder's own choice and is treated as untrusted (R-02).
- **Tampering:** the claim is parsed leniently on purpose: a non-string or malformed `name` becomes missing and never weakens the strict validation of `sub`, `email`, `email_verified` and `hd`, which still fail the sign-in as before (R-07).
- **Repudiation:** failures keep carrying a reason and never the claims, as before.
- **Information Disclosure:** the adapter never logs claims; the name goes only to the account-creation path.
- **Denial of Service:** the claim's size is bounded by the verified ID token and by a length cap in the claims schema (R-06).
- **Elevation of Privilege:** the name has no authority: it cannot select an account, link an identity or influence the authority check on the email (R-07).

### `apps/api/src/identity/application/complete-google-sign-in.ts`
- **Spoofing:** a Google sign-in for an existing linked account or an existing email never writes the name, so a Google account whose name imitates someone else cannot rename a victim's account (R-01).
- **Tampering:** the name is written only in the creation branch, in the same `users.create` as the rest of the account; superseding an unverified account (DISC-001-01b) does not write it.
- **Repudiation:** the route logs the user id, the path (`created`, `linked`, ...) and failure reasons, never the name or the email.
- **Information Disclosure:** the name stays inside the account created for that same Google identity; nothing is returned to the browser beyond the existing redirect.
- **Denial of Service:** no extra query or call: the name is part of the existing insert.
- **Elevation of Privilege:** the display name is not an input to the authority, linking or supersede decisions, so it cannot be used to take over an account (R-07).

### `apps/web/src/features/auth/containers/register-container.tsx`
- **Spoofing:** the container sends no identity; the name is free text the visitor types.
- **Tampering:** it validates with the shared `registerRequestSchema` before sending and the API stays the authority on every value.
- **Repudiation:** not applicable on the client; the API logs the outcome without the name.
- **Information Disclosure:** the typed name is kept only in the form while the visitor is on the screen; nothing is written to local storage and the confirmation screen is the same for new and existing emails.
- **Denial of Service:** one request per submit; a field error sends no request.
- **Elevation of Privilege:** the name is rendered as React text (escaped), never as HTML, under the nonce-based CSP (R-02).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| display name (`users.display_name`) | PII | `users` column with a 1 to 50 character check; database volume encrypted with AES-256; never logged | TLS 1.2+; request body only, never a URL |
| Google `name` claim | PII | only the reduced value (valid name or null) is stored in `users.display_name`; the raw claim is never stored or logged; database volume encrypted with AES-256 | TLS 1.2+ from Google's token endpoint, inside a signed ID token |
| email address | PII | `users.email`; database volume encrypted with AES-256; never logged | TLS 1.2+; request body only |
| password | credentials | Argon2id hash in `users.password_hash`; the plaintext is never stored or logged; database volume encrypted with AES-256 | TLS 1.2+; request body only |
| Google ID token | credentials | never stored; claims used in memory | TLS 1.2+ from Google |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A registration or a Google sign-in overwrites the name, or any data, of an existing account (another person's) | T | M | H | the existing-email branch of `RegisterUser` ignores and never stores the name; `CompleteGoogleSignIn` writes the name only in the creation branch; tests for AC-08 and AC-09 check that an existing account's name is unchanged (Blocks 2 and 3) |
| R-02 | Stored script injection or control characters through the name (registration or the Google claim) | T | M | H | the name is trimmed, limited to 50 code points and free of NUL characters by the shared schema, the Google claim is reduced by `displayNameFromGoogleClaim` before storage (NUL removed, truncated),  the database check repeats the bound, and the name is rendered as escaped React text under the nonce-based CSP and never put in HTML, emails or logs (Blocks 1 to 4) |
| R-03 | The required field makes `POST /auth/register` reveal whether an email is registered (validation order, status or body differences) | I | M | H | the name is validated by the shared schema in the `validate` middleware before the use case and before any email lookup; for a valid name the existing-email branch is unchanged and the 202 body is identical; tests compare new and existing emails for valid and invalid names (Block 2, NFR-02) |
| R-04 | The name, the email or the Google claim lands in logs | I | L | M | the registration route logs the outcome and user id only, the Google route logs the user id, path and reason only, the adapter never logs claims; a test asserts that no display name reaches the log lines of a registration (Block 2) |
| R-05 | Impersonation: a visitor registers with another person's name | S | M | L | accepted by design in this ticket as no screen shows another user's name yet (names are shown only to their owner); display names are not unique and prove no identity; revisit when groups (PRD 05) show member names (recorded as a follow-up, not a control of this ticket) and a verified email remains the account's identity |
| R-06 | Oversized or abusive input (very long name, huge claim) degrades the service | D | M | L | UTF-16 cap of 200 before code points are counted, the 16 kb body limit, the per-IP registration limit, a length cap on the claim in the adapter's schema, and the single-pass truncation |
| R-08 | A name typed by whoever registered an unverified account survives a Google sign-in that supersedes that account (DISC-001-01b), so the victim sees an attacker's text as their own display name | S | L | L | none in this ticket: AC-08 says a linked account's name stays unchanged and the supersede path writes nothing; the text is shown only to the account's owner today and is escaped; open decision O-2 of the spec recommends replacing the name with the Google claim on supersede (needs a PRD wording change); recorded below as an accepted risk pending the owner |
| R-09 | Requesting the `profile` scope gives the API more Google profile data than it needs (picture, locale) and changes the consent screen | I | L | L | the adapter reads only the `name` claim from the verified ID token, never stores or logs any other profile claim, and the stored value is the reduced name; the consent-screen listing of the scope is checked in the Google Cloud console before shipping (open decision O-1) |
| R-07 | A malformed `name` claim breaks Google sign-in for a legitimate user, or the lenient parsing weakens the strict claim validation | D | L | M | `name` is parsed apart and leniently (non-string or malformed becomes missing); `sub`, `email`, `email_verified` and `hd` stay strictly validated; tests cover a non-string `name` still signing in and a malformed required claim still failing (Block 3) |

## Accepted risks
### R-08
- **Accepted by:** the project owner, to be confirmed: this entry is the agent's proposal (open decision O-2 of the spec) and needs the owner's approval before CODE.
- **Justification:** the attacker needs the victim to sign in with Google for an email the attacker registered first with a password and left unverified; the only audience of the text is the victim, on their own profile screen, where it is escaped and editable; the cost of the alternative is a PRD wording change.
- **Review conditions:** before any screen shows one user's display name to another (groups, PRD 05), or when DISC-001-01b's supersede path changes, or if the owner decides the O-2 change earlier.

### R-05
- **Accepted by:** the project owner, to be confirmed: this entry is the agent's proposal and needs the owner's approval before CODE; no screen of this ticket or of DISC-001-01d shows one user's name to another.
- **Justification:** the display name is shown only to its owner today, is not unique, and grants no authority, so impersonation has no audience until groups exist.
- **Review conditions:** before DISC-001-05 (groups and expense splitting) shows member names to other users, or earlier if any screen starts showing another user's name.

## Supply chain
No new runtime or development dependency is added (spec: "Justified new dependencies: None"). The name rule is plain TypeScript, the schema field reuses the existing Zod schema, and the Google adapter keeps using `jose`, so `pnpm audit --prod --audit-level high` covers the dependency surface unchanged.

## Availability
The registration route keeps its per-IP limit of 5 per hour and its 16 kb body limit; the new field adds no query, no hashing and no external call. The Google callback adds no call either: the name is part of the claims already returned by the verified token and of the insert that already happens. The name rules are single passes over bounded strings, so there is no unbounded work for an attacker to multiply.
