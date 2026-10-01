# SAST report DISC-001-01d: Profile & Preferences

| Field | Value |
|---|---|
| Ticket | DISC-001-01d |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | `git diff origin/main...HEAD` (code, not docs): `packages/shared/src/{profile,money}/**`, `apps/api/src/identity/**` (profile and display name: `get-profile.ts`, `update-profile.ts`, `profile-routes.ts`, `drizzle-profile-repository.ts`, `schema.ts`, `account-defaults.ts`, `errors.ts`, `index.ts`, migration `0007` and its rollback), `apps/web/src/**` (`features/profile`, `components/ui/{select,form}.tsx`, `lib/api-client.ts`, nav link), tests and fixtures scanned for secrets only |
| Method | Manual review of the diff against catalog §4 plus targeted pattern searches over the touched files, and `pnpm audit --prod` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no key, token or connection string in the diff; the only credentials-like literals are the fixed test passwords and the local test database URL in tests and `playwright.config.ts` (unchanged); no new `.env` file; nothing under `src` imports test data.
- ✅ F-SAST-02 SQL injection (CWE-89): Drizzle builder only (`apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts:25`, `:41`), no `sql` template and no string-built query in the new repository; the migration `apps/api/drizzle/0007_profile_display_name.sql:1` is static DDL and its rollback is static.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no new `JSON.parse` of user input in `src`; request bodies are parsed only by the shared Zod schemas through `validate` (`apps/api/src/identity/infrastructure/http/profile-routes.ts:53`).
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the diff.
- ✅ F-SAST-06 XSS (CWE-79): the display name is rendered as a React text node or an input value (`apps/web/src/features/profile/components/profile-form.tsx`), never as HTML; no `dangerouslySetInnerHTML` or `innerHTML` in `apps/web/src/features/profile` or `components/ui/select.tsx`; the page runs under the existing nonce-based CSP.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added; the web client only calls the API origin it already uses (`apps/web/src/lib/api-client.ts`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed; the password hash column is never selected by the new repository (explicit column list at `drizzle-profile-repository.ts:10`).
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flags, no new environment variables.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the profile routes log request id, IP, user id and, for updates, the names of the changed fields only (`profile-routes.ts:44`, `:59`); a test asserts that no display name, email or preference value reaches the log (`apps/api/test/identity/profile.test.ts`, log test).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `PATCH /profile` is covered by the global Origin plus `X-Requested-With` guard and `SameSite=Strict` cookies (`apps/api/src/shared/http/origin-guard.ts`, `apps/api/src/app.ts`); a test shows a `PATCH` without the web origin answers 403.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed (no `package.json` or lockfile change).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): body validated by `updateProfileRequestSchema` (stripping object, display name 1 to 50 code points after a UTF-16 cap, enums, IANA-shaped time zone of at most 64 characters checked by `Intl`, at least one changeable field) at `packages/shared/src/profile/profile.ts:13`, `:27`, `:32` and `packages/shared/src/profile/time-zone.ts:9`; DB checks repeat the display name rule (`apps/api/drizzle/0007_profile_display_name.sql:2`); the email field is only compared and never stored (`apps/api/src/identity/application/update-profile.ts:14`, `:34`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): the email mismatch is a typed `AppError` answered 400 with a bare code (`apps/api/src/identity/domain/errors.ts`, `update-profile.ts:42`); validation failures list field paths only; any other failure is 500 `INTERNAL` through the shared error handler.
- ✅ F-SAST-16 Medium CVE in a dependency: none; no dependency change.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML` or `Math.random` in the touched source files.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Access control review

Both routes mount `requireSession` first and take the user id only from `auth.userId`
(`profile-routes.ts:39`, `:52`); the schemas strip a body `userId`, and a test shows another user's
profile cannot be read or changed. The repository has no method that writes `email`,
`password_hash`, `credentials_version` or `email_verified_at`. Mounting without
`requireVerifiedEmail` is a settled human decision (A-3): the routes touch only the caller's own
display name and preferences.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/drizzle/meta/_journal.json` | Migration `0007` leaves a gap at `0006` (reserved for DISC-001-02a) and its journal `when` must stay later than 02a's `0006` entry, or Drizzle skips the older one on a database that already has the newer | Recorded for the merge; renumber or bump `when` together with the rollback key if 02a's timestamp is later |
| I-2 | Info | `packages/shared/src/profile/time-zone.ts:3` | `TIME_ZONE_MAX_LENGTH` is defined here and also in `apps/api/src/identity/domain/account-defaults.ts` | Accepted: the registration fallback keeps its own limit on purpose; values are equal |
| I-3 | Info | `apps/api/drizzle/rollback/0007_profile_display_name.down.sql:1` | Destructive rollback loses every saved display name | Accepted: documented plan in the file header and in the spec (AGENTS.md rule on destructive migrations) |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info documented.
