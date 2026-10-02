# Threat model DISC-001-02b: Categories

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02b |
| Spec | docs/ddw/specs/spec-DISC-001-02b.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

Risk identifiers are local to this ticket (R-01 to R-17).

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/categories/default-categories.ts` + `packages/shared/src/categories/category.ts` (default catalog, request and response validators, icon and color keys) | Block 1 |
| `packages/shared/src/errors.ts` + `apps/api/src/shared/http/error-handler.ts` (`CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `CATEGORY_NESTING_TOO_DEEP`, `CATEGORY_PARENT_KIND_MISMATCH`) | Block 2 |
| `apps/api/src/categories/domain/naming.ts` + `apps/api/src/categories/application/ensure-defaults.ts` + `apps/api/src/categories/application/ports/category-usage.ts` (name rule, lazy seeding, usage port) | Block 3 |
| `apps/api/src/categories/infrastructure/db/schema.ts` + `apps/api/drizzle/0009_categories.sql` (`categories`, `category_defaults_seeded`, composite foreign key, guard trigger, unique indexes) + `apps/api/drizzle/rollback/0009_categories.down.sql` | Block 4 |
| `apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts` + `apps/api/src/categories/infrastructure/usage/no-usage-adapter.ts` | Block 4 |
| `apps/api/src/categories/infrastructure/db/seed-default-categories.ts` + the backfill statements of `apps/api/drizzle/0009_categories.sql` (default rows for existing users) | Block 4 |
| `apps/api/src/identity/application/ports/new-user-provisioning.ts` + `apps/api/src/identity/application/register-user.ts` + `apps/api/src/identity/application/complete-google-sign-in.ts` + `apps/api/src/identity/infrastructure/db/drizzle-unit-of-work.ts` + `apps/api/src/server.ts` (creation-time provisioning hook inside the user transaction) | Block 9 |
| `apps/api/src/categories/infrastructure/http/category-routes.ts` (`GET /categories`, `POST /categories`, `GET /categories/:id`, `PATCH /categories/:id`, `POST /categories/:id/archive`, `POST /categories/:id/unarchive`, `DELETE /categories/:id`) + `apps/api/src/server.ts` wiring | Block 5 |
| `apps/web/src/lib/api-client.ts` category methods | Block 6 |
| `apps/web/src/features/categories/containers/categories-container.tsx` + `apps/web/src/features/categories/components/category-list.tsx` + `apps/web/src/features/categories/components/category-visual.tsx` | Block 7 |

## Trust boundaries
- Browser → API (Express): public internet; category names, kinds, icons, colors and parent ids in requests, categories in responses, session cookies, all over TLS; the origin guard and `X-Requested-With` protect state-changing routes.
- API (categories routes) → application layer: the authenticated user id and the `AccessScope` issued by the `AccessPolicy` cross here; bodies have been parsed by the shared validators.
- Application layer → PostgreSQL: private network; owner-scoped `categories` rows and the per-owner seed marker.
- Identity transaction → categories seeding hook (composition root wiring): the user id and the open transaction handle cross it; the hook writes only categories rows for that id and any failure rolls the whole user creation back.
- Application layer → `CategoryUsage` port: the boundary PRD 03 will implement; only category ids already filtered by the scope cross it.
- Web containers → presentational components: names reach the DOM only through React's escaping; icon and color arrive as keys mapped to Lucide components and theme tokens, never as raw values.

## STRIDE analysis
### `apps/api/src/categories/infrastructure/db/seed-default-categories.ts` + the backfill statements of `apps/api/drizzle/0009_categories.sql` (default rows for existing users)
- **Spoofing:** the hook receives the id of the user just created by the same transaction and writes only rows owned by that id; the backfill derives owners from `users` itself, so no input names an owner (R-01).
- **Tampering:** the marker row inserted with `on conflict do nothing` makes the seeding and the backfill idempotent, so a re-run or a user who deleted a default never changes existing rows (R-15); the backfill is insert-only and touches no other table.
- **Repudiation:** the migration is recorded in the Drizzle journal and the backfill is a single reviewed statement pair; registration failures are logged by the shared handler.
- **Information Disclosure:** the rows carry only catalog keys, icons and colors, no user data beyond the owner id.
- **Denial of Service:** the backfill is one pre-deploy transaction of users times 33 rows (about 330 rows today) and holds locks only on the new tables; the creation-time seeding is one statement of 33 rows on top of a registration that hashes a password, so it adds milliseconds (R-16).
- **Elevation of Privilege:** the hook runs with the identity transaction handle, so it could in principle write anywhere; it is a fixed function of the categories module registered by the composition root, typed for its one purpose, and covered by tests that read back only categories rows (R-17).

### `apps/api/src/identity/application/ports/new-user-provisioning.ts` + `apps/api/src/identity/application/register-user.ts` + `apps/api/src/identity/application/complete-google-sign-in.ts` + `apps/api/src/identity/infrastructure/db/drizzle-unit-of-work.ts` + `apps/api/src/server.ts` (creation-time provisioning hook inside the user transaction)
- **Spoofing:** provisioning runs only after `users.create` in the two creation paths; the supersede path and the duplicate-email branch create no user and call nothing, so nobody can trigger seeding for an account they do not own.
- **Tampering:** user, verification email or Google link, and defaults commit together or not at all; a failing hook rolls everything back, so no half-created account exists (R-16).
- **Repudiation:** a failed creation is logged with request id and code like any unexpected failure; no business event is lost because nothing committed.
- **Information Disclosure:** registration keeps its anti-enumeration answer: the duplicate-email branch seeds nothing and answers the same generic success, and a seeding failure answers the generic 500 without detail (R-16).
- **Denial of Service:** the registration limiter still runs first, before hashing and before any seeding, so seeding cannot be driven faster than registrations are allowed (R-16).
- **Elevation of Privilege:** identity depends only on its own port; the composition root registers the categories hook, so identity gains no access to categories internals and categories gains none to identity beyond the transaction handle (R-17).

### `packages/shared/src/categories/default-categories.ts` + `packages/shared/src/categories/category.ts` (default catalog, request and response validators, icon and color keys)
- **Spoofing:** the contracts carry no user id, owner or role, so a client cannot name another owner (R-01).
- **Tampering:** `kind` and `parentId` on update are declared `never`, so they cannot be changed by mass assignment (R-03); icon and color are checked against fixed key lists, so no free text or raw style value is accepted (R-09).
- **Repudiation:** none; pure data and functions.
- **Information Disclosure:** validation failures list field paths only and never echo submitted values; the response validator strips undeclared fields (R-08).
- **Denial of Service:** `limit` is capped at 100, names at 50 code points, and the 16 kb body limit applies (R-07).
- **Elevation of Privilege:** nothing in the contracts grants a role; ownership is decided server-side from the session.

### `packages/shared/src/errors.ts` + `apps/api/src/shared/http/error-handler.ts` (`CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `CATEGORY_NESTING_TOO_DEEP`, `CATEGORY_PARENT_KIND_MISMATCH`)
- **Spoofing:** not applicable.
- **Tampering:** the code to status mapping is a compile-time `Record`, so a missing mapping does not build.
- **Repudiation:** rejected requests are logged with request id, route, status and code.
- **Information Disclosure:** the body is only `{ code }`; the 409 and 400 answers come only for categories the caller owns, because another user's category or parent answers 404 first (R-08).
- **Denial of Service:** none beyond the shared handler.
- **Elevation of Privilege:** none; the codes change no state.

### `apps/api/src/categories/domain/naming.ts` + `apps/api/src/categories/application/ensure-defaults.ts` + `apps/api/src/categories/application/ports/category-usage.ts` (name rule, lazy seeding, usage port)
- **Spoofing:** every operation receives an `AccessScope` issued from the session's `AuthContext`; use cases never read a user id from input (R-01).
- **Tampering:** the name rule compares against the Spanish and English names of untouched defaults, so a user cannot create a lookalike that later collides after a language switch (R-05); delete checks `isUsed` and children and the database foreign key is the second line of defence (R-06).
- **Repudiation:** create, update, archive, unarchive and delete emit an audit line with user id and category id only (R-10).
- **Information Disclosure:** the usage port receives only ids the scoped repository returned, so an adapter cannot be asked about another user's categories through this module (R-11).
- **Denial of Service:** seeding runs once per owner (a marker row), so the 33 default inserts are not repeated on every request (R-07).
- **Elevation of Privilege:** a write needs `AccessScope<'write'>`, a type only the policy can issue; group access is denied until PRD 05 (R-01).

### `apps/api/src/categories/infrastructure/db/schema.ts` + `apps/api/drizzle/0009_categories.sql` (`categories`, `category_defaults_seeded`, composite foreign key, guard trigger, unique indexes) + `apps/api/drizzle/rollback/0009_categories.down.sql`
- **Spoofing:** `owner_id` is `NOT NULL` with a foreign key to `users.id`, and the composite foreign key (`parent_id`, `owner_id`, `kind`) makes a parent share owner and kind, so a category cannot hang under another user's parent (R-01, R-03).
- **Tampering:** `CHECK` constraints on kind, name length and key-or-name; a trigger refuses changes to `owner_id`, `kind`, `parent_id` and `default_key` and a parent that has a parent; unique indexes on the default key and on custom names close the duplicate race (R-03, R-04).
- **Repudiation:** `created_at` and `updated_at` are set by the database.
- **Information Disclosure:** `categories` rows are user data (labels may reveal habits) and are reachable only through the owner-scoped repository; the database volume is encrypted at rest (R-01).
- **Denial of Service:** the owner indexes keep owner-filtered lists indexed; the migration is additive; the advisory lock is per owner and transaction-scoped, so one user's writes cannot block another's (R-07, R-12).
- **Elevation of Privilege:** the runtime role needs no new privileges; the migration runs in the pre-deploy step.

### `apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts` + `apps/api/src/categories/infrastructure/usage/no-usage-adapter.ts`
- **Spoofing:** every method requires an `AccessScope` and a call without a scope issued by the policy fails closed (`assertIssuedScope`).
- **Tampering:** Drizzle parameterized statements only; reads and writes are single statements with the `scopedTo` predicate in their `WHERE`, and name writes run in one transaction under the owner lock (no check-then-act gap) (R-01, R-04).
- **Repudiation:** unique and foreign-key violations map to typed domain errors, so the outcome is explicit in logs.
- **Information Disclosure:** a row outside the scope is indistinguishable from a missing one (`null` / `false`), so callers cannot learn which it was (R-01, R-08).
- **Denial of Service:** list queries are paginated and indexed; the advisory lock key is a hash of the owner id and is released at commit (R-07).
- **Elevation of Privilege:** `scopedTo` takes only the owner column, so no group membership can widen access before PRD 05.

### `apps/api/src/categories/infrastructure/http/category-routes.ts` (`GET /categories`, `POST /categories`, `GET /categories/:id`, `PATCH /categories/:id`, `POST /categories/:id/archive`, `POST /categories/:id/unarchive`, `DELETE /categories/:id`) + `apps/api/src/server.ts` wiring
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail` (R-02).
- **Tampering:** state-changing requests need the web origin and `X-Requested-With`, on top of SameSite cookies (R-14); params, query and body go through the shared `validate` middleware and handlers never read `req.body` (R-03).
- **Repudiation:** the request log carries request id, method, route, status and duration; mutating routes add the audit line of R-10.
- **Information Disclosure:** another user's category or parent answers 404 with the same body as a missing id (R-01, R-08); logs never contain names (R-08).
- **Denial of Service:** `limit` is capped at 100, the JSON body limit is 16 kb and the first-request seeding is a single bounded transaction (R-07).
- **Elevation of Privilege:** the scope is built from the session's user id by `OwnerOrGroupMemberAccessPolicy` with the deny-all membership reader; no route accepts an owner id (R-01).

### `apps/web/src/lib/api-client.ts` category methods
- **Spoofing:** the client sends only session cookies with `credentials: 'include'` to the configured API origin and refuses redirects.
- **Tampering:** the id is encoded and unsafe ids (`''`, `.`, `..`) never produce a request; the query is built with `URLSearchParams` from validated values.
- **Repudiation:** not applicable; the API logs outcomes.
- **Information Disclosure:** error codes become message keys; API text is never shown (R-08).
- **Denial of Service:** one request per user action; no polling.
- **Elevation of Privilege:** the client holds no privilege; the API decides on every call.

### `apps/web/src/features/categories/containers/categories-container.tsx` + `apps/web/src/features/categories/components/category-list.tsx` + `apps/web/src/features/categories/components/category-visual.tsx`
- **Spoofing:** the containers rely on the session guard of the authenticated shell; an expired session sends the user to sign-in.
- **Tampering:** form values are parsed with the shared validators and the API revalidates everything; icon and color are keys, so a tampered response cannot inject a style or a component name that is not in the maps.
- **Repudiation:** the destructive delete asks for an explicit confirmation before the request is sent.
- **Information Disclosure:** names are rendered only as React text nodes, with no raw HTML sink, under the existing CSP (R-09); default names come from the static shared catalog.
- **Denial of Service:** none beyond the API limits.
- **Elevation of Privilege:** no client-side check is trusted; hiding an action in the UI grants or removes nothing.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| category name (free text, may reveal spending habits) | PII | `categories.name`; database volume encrypted with AES-256; reachable only through the owner-scoped repository | TLS 1.2+ |
| category kind, icon, color, parent link and default key | financial | `categories` columns; database volume encrypted with AES-256 | TLS 1.2+ |
| owner user id on each category and in `category_defaults_seeded` | PII | `categories.owner_id`, `category_defaults_seeded.owner_id`; database volume encrypted with AES-256 | TLS 1.2+, never returned to other users |
| usage answers from the movements port | financial | not stored by this module | in process only |
| audit log lines (user id, category id) | PII | log storage of the hosting platform; no names | internal logging pipeline |
| default category catalog (names in both languages, icons, colors) | public | in source (`packages/shared`) | TLS 1.2+ with the web bundle |
| error codes and message keys | public | not stored | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | broken object-level authorization: a user reads, edits, archives or deletes another user's category, or hangs one under another user's parent (PRD AC-12) | E | M | H | `AccessScope` issued from the session, `scopedTo` owner predicate in the same statement, 404 identical to a missing id (also for a foreign parent), the composite foreign key (`parent_id`, `owner_id`, `kind`), tests per route and per repository method |
| R-02 | an unverified email account uses the categories routes | S | M | M | `requireSession` then `requireVerifiedEmail` on `/categories`; tests for 401 and 403 on every route |
| R-03 | mass assignment or direct SQL changes the kind, parent, owner or default key of a category, breaking the one-level rule or history (PRD FR-03, FR-04) | T | M | H | update validator declares `kind` and `parentId` as `never`; the guard trigger refuses those changes and a parent with a parent; tested at both layers |
| R-04 | concurrent create or rename produces two categories with the same name under one parent, or two seeds of the defaults | T | M | M | per-owner transaction advisory lock around name writes, unique index on custom names, unique index on the default key, seed marker row inserted with `on conflict do nothing` in the same transaction |
| R-05 | names collide across languages: a custom name equal to the other language's default name breaks uniqueness after a language switch (PRD FR-09, FR-11) | T | M | M | the name rule compares with the Spanish and English names of every untouched sibling default and refuses with 409 `CATEGORY_NAME_TAKEN`; decision D2 is raised to the human |
| R-06 | a category is deleted while a movement is being recorded against it (check-then-act race) or while it has subcategories, destroying history (PRD FR-08) | T | L | H | `isUsed` and children checks, then a database foreign key `ON DELETE RESTRICT` required of PRD 03 and the parent foreign key `RESTRICT`, both mapped to `CATEGORY_IN_USE`; tested with a test-only referencing table |
| R-15 | the backfill creates wrong, duplicate or missing default rows for existing users, resurrects a default a user deleted, or runs for too long (PRD FR-13, FR-14) | T | M | M | one idempotent insert-only statement pair keyed by the per-owner marker, a literal list generated from the shared catalog and a test that migrates a database with users and compares rows with the catalog, a re-run test, a deleted-default test, and a size note (users times 33 rows in one pre-deploy transaction) |
| R-16 | seeding inside the user transaction slows registration or makes it fail, or leaves a half-created account (PRD AC-19) | D | L | M | the registration limiter runs before hashing and seeding (its attempt is not refunded after a rollback, so a failure costs one of the five registrations per IP per hour), seeding is one statement of 33 rows, seeding failures are logged distinctly, the created path answering 500 while the existing-email path answers 200 is the same oracle any internal failure of the created path already is, any failure rolls back user, email and defaults together and answers the generic 500, covered by a throwing-hook test for registration and for Google sign-up |
| R-17 | the creation hook gets the identity transaction handle and could be abused or break the dependency direction | E | L | M | identity declares only a port and hook type, the composition root registers one fixed categories function, a boundary probe forbids identity importing categories, and the hook is covered by tests reading back only categories rows |
| R-14 | cross-site request forges an archive or delete | S | M | M | origin guard with web origin and `X-Requested-With`, SameSite cookies, tests for the missing header |
| R-07 | oversized lists, repeated seeding or lock contention degrade the service (PRD NFR-01) | D | L | M | `limit` at most 100, 16 kb body limit, owner indexes, seeding once per owner, owner-scoped transaction-level lock, timeouts left to the platform |
| R-08 | category names leak through logs, validation messages or error bodies, or existence of other users' categories leaks through differing answers | I | M | M | logs carry routes, ids and statuses only; validation errors list paths only; responses are validator-stripped; 404 before any 409 or 400 for foreign ids; web shows message keys only |
| R-09 | a category name containing markup runs script in the web app, or a tampered icon or color injects a style (stored XSS) | T | L | H | React renders names as text; icon and color are keys checked against fixed lists and mapped to Lucide components and theme tokens; the existing CSP blocks inline script; a component test renders a name with markup as literal text |
| R-10 | a delete, archive or rename cannot be attributed afterwards | R | L | M | audit log line per mutating route with user id and category id only, plus the existing request log with request id |
| R-11 | a future usage adapter returns usage of other users' categories | I | L | H | the port only receives scope-filtered category ids and returns data keyed by those ids; the adapter contract is PRD 03's obligation, recorded in the spec deferrals |
| R-12 | the migration collides in numbering or journal order with sibling tickets (0006, 0008) or cannot be undone, leaving databases out of sync | T | M | M | provisional number `0009` with a journal `when` later than every existing one, an explicit renumber and re-chain procedure for the later-merging ticket, migration tests for apply, rollback and re-apply, a documented destructive rollback script |
| R-13 | a user who deleted a default category has it silently recreated, or a user never gets the defaults | T | L | L | seeding is gated by the per-owner marker row, so it happens exactly once; tests cover a deleted default staying deleted and concurrent first calls seeding once |

## Supply chain
No new runtime dependency in any package: the web reuses Lucide icons already installed, the native `<select>` and form components from DISC-001-01d, and the API reuses Express, Drizzle, `pg` and Zod already pinned in `pnpm-lock.yaml`. `pnpm audit --prod --audit-level high` is part of the final verification and must stay unchanged. No external service is added.

## Availability
The new routes are authenticated and limited by pagination (100), the 16 kb body limit and indexed owner-filtered queries; the first request of a user runs one bounded seeding transaction (33 rows) and every later request skips it. If PostgreSQL is unavailable the routes answer 500 `INTERNAL` and nothing is partially written, because seeding, name writes and archive cascades each run in one transaction or one statement. The per-owner advisory lock is held only for the duration of one transaction, so a slow request cannot block other users. Volumetric attacks are handled at the hosting edge. The absence of a per-user category cap follows the accepted decision for accounts (no cap, no extra write limiter) and bounds nothing here beyond pagination and the indexes.
