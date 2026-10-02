# Spec DISC-001-02b: Categories

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02b |
| PRD | docs/ddw/prd/prd-DISC-001-02b.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary
Adds the `categories` module (its own module under `apps/api/src/categories/`, human decision Q4) and
the matching web feature. A category has a kind (expense or income), an optional parent (one level
only, same kind), an icon and a color taken from fixed lists, and is archived instead of deleted when
history may depend on it. The default set of Appendix A is seeded once per user from a catalog in
`packages/shared` keyed by stable keys. A default category stores its key and no name until the user
renames it; the web shows `defaultCategoryName(key, language)` for the active locale, so untouched
defaults follow the interface language and stop translating the moment the user renames them (human
decision Q3). The API never needs the user's language: it returns `key` and `name` (null while
untouched) and the client resolves the label. Names stay unique per user, parent and kind across both
languages. Ownership uses the existing `AccessPolicy` / `AccessScope` / `scopedTo` template, so another
user's category answers 404. Whether a category is used by a movement sits behind an application port
whose only adapter returns `false` until PRD 03, the same pattern as accounts.

## Decisions recorded in this spec
- **Own module (Q4, human):** `apps/api/src/categories/{domain,application,infrastructure}` and
  `apps/web/src/features/categories`; `AGENTS.md` gets `categories` in its module list in Block 5.
- **Interface language (Q3, human):** untouched defaults follow the CURRENT interface language;
  renaming makes a default the user's own and it no longer translates. Resolved on the client from the
  shared catalog with `useLocale()`; language changes already move the user to the matching locale
  route (DISC-001-01d), so the labels switch with no API call.
- **Default names live in `packages/shared`, not in the web catalogs**, because the API needs both
  languages to enforce uniqueness across languages (decision D2 below). A test pins that the catalog
  covers exactly the Appendix A set and another that the web `categories` namespace does not duplicate
  the default names. AGENTS.md says every UI string goes through the i18n catalogs, so Block 5 records
  this exception in AGENTS.md (decision D8, needing the human's approval) and every other category
  string stays in the catalogs. The response shape is `key` (set for defaults, kept after a rename) and
  `name` (null while untouched); any other client (reports, exports, push) resolves a label with
  `displayCategoryName` from the shared package.
- **Seeding is lazy and once per user (D1):** the first categories request of a user inserts the
  defaults in one transaction and records `category_defaults_seeded`, so it covers users created before
  this ticket and new users, needs no change to the identity module, and never resurrects a default the
  user deleted. `ensureDefaults` first checks the marker with a plain select (one cheap read on every
  later request) and returns nothing; the seeding transaction commits on its own before the use case
  runs, so a later failure keeps the defaults. Any backend reader that must see defaults (reports, PRD
  03 joins) has to call the categories module, not read the table directly. See "Open decisions".
- **Name uniqueness (D2):** compared case-insensitively among siblings (same owner, kind and parent),
  archived ones included. The effective names of an untouched default are BOTH its Spanish and its
  English name, so a custom name equal to either is refused.
- **Atomicity of name checks:** the application layer orchestrates, the adapter only offers atomic
  primitives. The repository port has `runExclusive(scope write, fn)`, which opens one transaction
  holding the per-owner advisory lock `pg_advisory_xact_lock(hashtextextended('categories:name:' ||
  owner_id, 0))` (namespaced like identity's keys) and hands `fn` a transactional view with
  `findById`, `listSiblings(kind, parentId)`, `insert` and `updateFields`. Create and rename call
  `findNameConflict` inside `fn`, so the unit tests exercise the real rule; the parent of a new
  category is loaded inside the same transaction, so a concurrent delete of the parent is a 404, not a
  500. The unique index on custom names is the second line of defence.
- **Icon and color are keys from fixed lists (D3):** 24 icon keys mapped to Lucide icons and 12 color
  keys mapped to theme tokens, so no raw color value or free text reaches the page. The default
  categories' icons and colors are proposed in `default-categories.ts`.
- **Hand-written SQL fallback:** if drizzle-kit cannot express the composite self-reference, the
  partial unique indexes or the `coalesce` expression index, they are written by hand in
  `0009_categories.sql` and declared in `schema.ts` so the snapshot matches and `drizzle-kit generate`
  reports no change; `NULLS NOT DISTINCT` is not used because the production PostgreSQL version is not
  pinned. The guard trigger is invisible to drizzle-kit, so a snapshot re-chain by the later-merging
  ticket must carry it. `lower()` follows the database collation; the repository test states the
  collation it runs under and asserts the `Ñandú` / `ñandú` fold for it.
- **Migration number:** `0009_categories`. Main has 0005 and 0007, DISC-001-02a (PR #13) adds 0006 and
  another ticket reserves 0008. Its journal `when` must be later than every existing one (at least
  later than 0006's 1790895423195 and 0007's 1790891329764) and the generated value is reported in
  CODE; the later-merging ticket re-chains the snapshot (`prevId`) and updates the migration test
  constants. Drizzle applies by `when` greater than the last applied, so never lower a merged value.
- **Shared files expected to conflict with PR #13 (accounts):** `packages/shared/src/errors.ts`,
  `apps/api/src/shared/http/error-handler.ts`, `apps/web/src/lib/api-client.ts` (method union gets
  DELETE in both), both catalogs, `apps/api/src/server.ts` (`routerFactories`), `migration.test.ts`
  (counts and every rollback chain), `build-output.test.ts`, `apps/api/drizzle/meta/_journal.json`,
  the snapshot chain, `docs/ddw/prd/prd-DISC-001-02.md`, `CHANGELOG.md`, `architecture-boundaries.test.ts`.
  `apps/api/src/shared/db/pg-errors.ts` and the change to `apps/api/src/identity/infrastructure/db/
  unique-violation.ts` are copied byte-identical from DISC-001-02a's branch so both branches add the
  same content and the later merge is clean.

## Open decisions for the human (do not block CODE; the defaults below are what this spec builds)
- **D1, how defaults reach users:** the PRD says "for every new user". Default built: lazy, once per
  user, on the first categories request (covers existing and new users, no identity coupling, no
  resurrection of deleted defaults). Alternative: seed in the registration use cases plus a one-off
  backfill migration for existing users. Recommendation: lazy. Tradeoff: a user's rows exist only after
  their first categories request, which is unobservable because every read seeds first.
- **D2, names that collide across languages:** a user-created category named "Comida" while the default
  "Food" is untouched would collide when the language switches to Spanish. Default built: refuse any
  custom name equal to the Spanish or English name of an untouched sibling default (409
  `CATEGORY_NAME_TAKEN`), so uniqueness holds in every language at all times. Alternatives: allow it and
  mark the translation as taken, or let the custom name win silently. Recommendation: refuse. Tradeoff: an
  English user cannot reuse a Spanish default word until they rename the default.
- **D3, icons, colors and their default values:** the PRD names an icon and a color without a set.
  Default built: the fixed lists above and a proposed icon and color for each default (a
  subcategory inherits its parent's). Recommendation: accept; changing values later is a catalog edit.
- **D4, what counts as "renamed":** only a name change makes a default the user's own; editing its icon
  or color keeps the name translating. Recommendation: keep.
- **D6, list defaults and the archived filter:** `limit` defaults to 100 (the maximum) so a user's whole
  set arrives in one call in practice, the web container pages until `total` is reached so nothing is
  silently truncated, and `archived=false` returns only active categories while `archived=true` returns
  only archived ones. Recommendation: keep.
- **D7, uniqueness scope and small rules the PRD does not state:** names are unique among archived
  siblings too (an archived "Gym" blocks a new "Gym" under the same parent and kind); unarchiving does
  not unarchive subcategories; archive and unarchive are idempotent; the database refuses changing a
  category's owner, kind, parent or default key. Recommendation: keep.
- **D8, AGENTS.md exception for default names:** default category names live in `packages/shared`
  (needed server-side for D2) instead of the web catalogs; this ticket adds one sentence to AGENTS.md
  to record it. Alternative: keep the strings in the web catalogs and have the API import them (not
  possible across the app boundary) or duplicate them with a sync test. Recommendation: the exception.
- **D5, archived parent:** creating a subcategory under an archived parent is allowed, and unarchiving a
  subcategory does not require an active parent (the PRD says nothing). Recommendation: keep, review
  when movement pickers exist (PRD 03).

## Deferred to PRD 03 (explicit, and not silent gaps)
- AC-05 "shows it in every existing movement" and AC-06 "keeps it on existing movements": movements do
  not exist; the tests assert that the category's fields persist and that archiving deletes nothing and
  keeps it readable by id.
- AC-10 with a real movement: here the use case with a fake port, the 409 mapping and the ON DELETE
  RESTRICT backstop with a test-only referencing table are tested; PRD 03's adapter must add a foreign
  key from movements to categories with `ON DELETE RESTRICT`.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4, Block 5, Block 7 |
| FR-02 | Block 1, Block 3, Block 4, Block 5, Block 7 |
| FR-03 | Block 1, Block 3, Block 4, Block 5 |
| FR-04 | Block 3, Block 4, Block 5 |
| FR-05 | Block 1, Block 3, Block 5, Block 7 |
| FR-06 | Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-07 | Block 3, Block 5, Block 6, Block 7 |
| FR-08 | Block 2, Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-09 | Block 2, Block 3, Block 4, Block 5, Block 7 |
| FR-10 | Block 3, Block 4, Block 5, Block 6 |
| FR-11 | Block 1, Block 7, Block 8 |
| FR-12 | Block 1, Block 3, Block 4, Block 5, Block 7 |
| NFR-01 | Strategy: the list query validator caps `limit` at 100 with a default of 100 and the whole default set (33 rows) fits one page (Block 1, Block 5) |
| NFR-02 | Strategy: every repository method requires an `AccessScope` and filters with `scopedTo` in the same statement; the owner column is `NOT NULL` with composite foreign keys that keep parent and child under one owner (Block 4) |
| NFR-03 | Strategy: the name validator trims, normalizes and counts code points (1 to 50) and a `CHECK` on `char_length` mirrors it (Block 1, Block 4) |

## Dependencies between blocks
Execution order: Block 1 → Block 2 → Block 3 → Block 4 → Block 5 → Block 6 → Block 7 → Block 8.
- Block 2 needs the error codes added in Block 1's package.
- Block 3 needs Blocks 1 and 2 (catalog, validators, error codes).
- Block 4 implements the ports defined in Block 3.
- Block 5 composes Blocks 3 and 4 with `requireSession`, `requireVerifiedEmail`, `validate` and `AccessPolicy`.
- Block 6 calls the contract fixed in Block 5; Block 7 uses Block 6; Block 8 runs against everything.

## Block 1 — Default catalog and category contracts (packages/shared)

**Files**
- `packages/shared/src/categories/default-categories.ts` (new) — the Appendix A set with stable keys, names in both languages, kind, parent key, icon and color.
- `packages/shared/src/categories/category.ts` (new) — kinds, icon and color keys, validators and response shapes for categories.
- `packages/shared/src/index.ts` (modified) — exports both.
- `packages/shared/src/errors.ts` (modified) — adds `CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `CATEGORY_NESTING_TOO_DEEP` and `CATEGORY_PARENT_KIND_MISMATCH` to `ERROR_CODES`.
- `apps/api/test/shared/default-categories.test.ts` and `apps/api/test/shared/category-contracts.test.ts` (new) — unit tests.

**Logic**
- `default-categories.ts` exports `DEFAULT_CATEGORIES` (33 entries: 9 expense roots, 19 expense subcategories, 5 income roots), each `{ key, kind, parentKey, names: { es, en }, icon, color }` with dot-path keys (`food`, `food.groceries`, `taxes`, `other-expenses`, `salary`), and `defaultCategoryName(key, language)` plus `defaultCategoryNames(key)` returning both languages. A subcategory inherits its parent's icon and color.
- `category.ts` exports `CATEGORY_KINDS`, `CATEGORY_ICONS` (24 keys), `CATEGORY_COLORS` (12 keys), `categoryNameSchema` (NFC, trimmed, 1 to 50 code points, no Unicode Cc or Cf character, same rule as account names), `createCategoryRequestSchema` (`name`, `kind`, `icon`, `color`, optional `parentId` UUID), `updateCategoryRequestSchema` (at least one of `name`, `icon`, `color`; `kind` and `parentId` declared `z.never().optional()` so sending them fails instead of being stripped), `categoryIdParamsSchema`, `listCategoriesQuerySchema` (`kind` optional enum, `archived` `'true'|'false'` default false transformed to a boolean and meaning only active or only archived rows, `limit` 1 to 100 default 100, `offset` from 0), `categoryResponseSchema` (`id`, `kind`, `parentId`, `key`, `name`, `icon`, `color`, `archived`, `archivedAt`, `createdAt`; `key` is non-null for defaults and `name` is null while a default is untouched) and `listCategoriesResponseSchema` (`items`, `total`, `limit`, `offset`), and `displayCategoryName({ key, name }, language)`.

**Input validation**
- Names: string, NFC, trimmed, 1 to 50 code points, no Cc or Cf character. Kind: `expense` or `income`. Icon and color: one of the listed keys. `parentId`: UUID. `limit` at most 100. Unknown keys are stripped by `validate`, except `kind` and `parentId` on update, which fail.

**Error handling**
- A name that is empty, longer than 50 code points or that contains a control or format character fails validation naming `name`.
- An icon or color outside the lists fails validation naming the field.
- A kind other than `expense` or `income` fails validation.
- An update body with none of `name`, `icon`, `color`, or with `kind` or `parentId`, fails validation.
- `limit` above 100 or below 1 fails validation.

**Required tests**
- [ ] The catalog has exactly the 33 Appendix A entries with unique keys, the expected parents and kinds, and both names for each (validates AC-01, AC-14).
- [ ] `defaultCategoryName('food', 'es')` is `Comida`, `('food.groceries', 'es')` is `Supermercado` and the English names are `Food` and `Groceries` (validates AC-14, AC-15).
- [ ] `displayCategoryName` returns the custom name when set and the translated default otherwise, and keeps the custom name in both languages (validates AC-16, AC-17).
- [ ] The create validator accepts a valid category and fails with an invalid missing name, kind, icon or color naming the field (validates AC-02).
- [ ] The name validator fails on an invalid 51-code-point name and on zero-width, right-to-left override and NUL characters, and accepts 50 code points (validates NFR-03).
- [ ] The update validator fails with an invalid body when `kind` or `parentId` is sent and when no field is sent (validates AC-05).
- [ ] The list query validator fails on an invalid `limit` of 101 and accepts 100 (validates NFR-01).
- [ ] An icon or color outside the lists and a kind other than expense or income fail as invalid (validates AC-02).

**Completion criterion**
The two shared test files pass, `pnpm typecheck` passes, and `@pesly/shared` exports `DEFAULT_CATEGORIES`, `defaultCategoryName`, `displayCategoryName`, the validators and the four error codes.

## Block 2 — Error code wiring (API error handler and web client)

**Files**
- `apps/api/src/shared/http/error-handler.ts` (modified) — status per new code in `STATUS_BY_CODE`.
- `apps/web/src/lib/api-client.ts` (modified) — `ApiErrorKey` and `MESSAGE_KEY_BY_CODE` entries.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — four keys under `errors`.
- `apps/api/test/foundation/error-handler.test.ts` and `apps/web/test/api-client.test.ts` (modified) — status and key cases.

**Logic**
`CATEGORY_NAME_TAKEN` and `CATEGORY_IN_USE` answer 409 (the state conflicts); `CATEGORY_NESTING_TOO_DEEP` and `CATEGORY_PARENT_KIND_MISMATCH` answer 400 (the request names an invalid parent). The two 400 answers are not `VALIDATION_FAILED`: they carry their own code and the web shows them on the parent field. Message keys: `categoryNameTaken`, `categoryInUse`, `categoryNestingTooDeep` ("Subcategories cannot have subcategories", AC-03) and `categoryParentKindMismatch`, in neutral Spanish and English.

**Error handling**
- A `CATEGORY_NAME_TAKEN` error answers 409 with only `{ code }`.
- A `CATEGORY_IN_USE` error answers 409 with only `{ code }`.
- A `CATEGORY_NESTING_TOO_DEEP` or `CATEGORY_PARENT_KIND_MISMATCH` error answers 400 with only `{ code }`.
- The web client maps each of the four codes to its message key and an unknown code to `unexpected`.

**Required tests**
- [ ] The error handler answers 409 `CATEGORY_NAME_TAKEN` with no extra fields (validates AC-11).
- [ ] The error handler answers 409 `CATEGORY_IN_USE` with no extra fields (validates AC-10).
- [ ] The error handler answers 400 for `CATEGORY_NESTING_TOO_DEEP` and `CATEGORY_PARENT_KIND_MISMATCH` (validates AC-03, AC-04).
- [ ] The web client maps the four codes to their message keys and an unknown code to `unexpected` (error path).
- [ ] `i18n-catalogs.test.ts` stays green: both catalogs carry the same keys.

**Completion criterion**
`pnpm typecheck` passes for every package and the touched test files pass.

## Block 3 — Categories domain and application (apps/api/src/categories)

**Files**
- `apps/api/src/categories/domain/category.ts` (new) — `Category` type and `effectiveNames`.
- `apps/api/src/categories/domain/naming.ts` (new) — pure rule `findNameConflict`.
- `apps/api/src/categories/domain/errors.ts` (new) — `CategoryNameTaken`, `CategoryInUse`, `CategoryNestingTooDeep`, `CategoryParentKindMismatch` (extend `AppError`).
- `apps/api/src/categories/application/ports/category-repository.ts` and `ports/category-usage.ts` (new) — repository port and usage port.
- `apps/api/src/categories/application/ensure-defaults.ts`, `list-categories.ts`, `get-category.ts`, `create-category.ts`, `update-category.ts`, `set-category-archived.ts`, `delete-category.ts` (new) — one use case per file.
- `apps/api/src/categories/index.ts` (new) — barrel.
- `apps/api/test/categories/category-use-cases.test.ts` and `apps/api/test/categories/fakes.ts` (new) — unit tests with in-memory fakes.

**Logic**
- `effectiveNames(category)` returns the custom name alone when `name` is set, and both language names of its key when untouched. `findNameConflict(siblings, candidate, excludeId)` compares NFC lower-cased names against the effective names of every sibling except `excludeId` and answers the conflicting sibling or null.
- Ports (no framework imports; `AccessScope` from the `shared/access` barrel only): `CategoryRepository` with `ensureDefaults(scope write)` (checks the seed marker and seeds once per owner; returns nothing), `findById(scope, id)`, `list(scope, { kind?, archived, limit, offset })` returning `{ items, total }`, `setArchived(scope write, id, archived)` (archiving also archives the subcategories), `countChildren(scope, id)`, `delete(scope write, id)`, and `runExclusive(scope write, fn)`, which runs `fn` in one transaction under the per-owner lock with a transactional view offering `findById`, `listSiblings(kind, parentId)`, `insert` and `updateFields`; the use cases decide, the adapter only provides atomic primitives. `CategoryUsage.isUsed(categoryId)` is the only door through which movements reach categories; PRD 03 implements it, and the port is unscoped by design: it only receives ids the scoped repository returned.
- Use cases: every one calls `ensureDefaults` first. `create` runs inside `runExclusive`: it loads the parent through the transactional view (a foreign, missing or concurrently deleted parent is 404), refuses a parent that already has a parent (`CategoryNestingTooDeep`, AC-03) and a parent of another kind (`CategoryParentKindMismatch`, AC-04), applies `findNameConflict` to the siblings and inserts; `update` runs inside `runExclusive` too and changes name, icon and color (a name change on a default stores the custom name and keeps the key, so the category stops translating; a name change applies `findNameConflict` excluding the category itself); `set-category-archived` archives (with its subcategories, AC-07) or unarchives only the target (AC-08), idempotently; `delete` finds with the write scope (404), refuses when `isUsed` or `countChildren` is non-zero (`CategoryInUse`, AC-10), then deletes; a foreign-key violation from the repository also surfaces as `CategoryInUse`.

**Input validation**
- Use cases receive values already parsed by the Block 1 validators; they re-check only that `limit` and `offset` are inside the documented range.

**Error handling**
- Create, rename or any name change that equals an effective sibling name (case-insensitive, either language of an untouched default) raises `CategoryNameTaken`.
- A parent that already has a parent raises `CategoryNestingTooDeep`; a parent of another kind raises `CategoryParentKindMismatch`.
- Delete of a category the port reports as used, or that has subcategories, raises `CategoryInUse` and keeps the row.
- Any operation on an id that is missing or owned by another user raises `ResourceNotFound` (404), including a foreign parent.
- A repository foreign-key violation on delete raises `CategoryInUse`; a failing usage port propagates the error.

**Required tests**
- [ ] A new user's first call seeds exactly the Appendix A defaults once, and a second call seeds nothing; a deleted default is not recreated (validates AC-01).
- [ ] the in-memory fake implements only the atomic primitives, so the AC-11 and AC-16 tests below run the production `findNameConflict` through the use cases (validates AC-11, AC-16).
- [ ] create returns the category and it appears in the list under its kind (validates AC-02).
- [ ] a subcategory under a subcategory fails with the `CategoryNestingTooDeep` error (validates AC-03).
- [ ] a parent of another kind fails with the `CategoryParentKindMismatch` error (validates AC-04).
- [ ] update persists name, icon and color and returns them (validates AC-05).
- [ ] archiving hides a category from the default list, keeps it readable by id and deletes nothing, and archiving a parent archives its subcategories (validates AC-06, AC-07).
- [ ] unarchive shows a category again, idempotently, without touching others (validates AC-08).
- [ ] delete removes a category with no movements and no subcategories (validates AC-09).
- [ ] delete fails with the `CategoryInUse` error when the fake port reports use or a subcategory exists, and the row stays (validates AC-10).
- [ ] a custom name that duplicates a sibling name in any case, or a Spanish or English name of an untouched sibling default, fails with the `CategoryNameTaken` error; the same name under another parent or kind is accepted (validates AC-11).
- [ ] renaming a default stores the custom name, keeps the key, and the old translations become free (validates AC-16).
- [ ] get, update, archive, unarchive and delete of another user's category, and a create with a foreign parent, raise the `ResourceNotFound` error (404) and change nothing (validates AC-12).
- [ ] list returns only the caller's categories (validates AC-13).
- [ ] a repository foreign-key violation on delete surfaces as the `CategoryInUse` error, and a failing usage port makes delete fail with its error (error path).

**Completion criterion**
`category-use-cases.test.ts` passes, `pnpm lint` reports no boundary violation for `apps/api/src/categories/domain` and `application`, no file in `domain` imports `drizzle-orm`, `pg`, `express` or anything under `infrastructure`, and no file in `application` imports anything under `infrastructure` (including `shared/access/infrastructure`).

## Block 4 — Persistence: table, migration, repository, usage adapter

**Files**
- `apps/api/src/categories/infrastructure/db/schema.ts` (new) — Drizzle tables `categories` and `category_defaults_seeded`; imports `users` from `identity/infrastructure/db/schema` for the foreign key (drizzle-kit needs the reference to resolve).
- `apps/api/drizzle/0009_categories.sql` (new, generated, then the guard trigger appended by hand), `apps/api/drizzle/meta/0009_snapshot.json` (new) and `apps/api/drizzle/meta/_journal.json` (modified: idx 9).
- `apps/api/drizzle/rollback/0009_categories.down.sql` (new) — destructive reverse script following the 0005 and 0007 convention.
- `apps/api/src/shared/db/pg-errors.ts` (new) — `violatedConstraint(error, code)` for 23505 and 23503, and `apps/api/src/identity/infrastructure/db/unique-violation.ts` (modified) delegating to it; both are copied byte-identical from DISC-001-02a's branch (`git show origin/feat/DISC-001-02a-accounts:<path>`), so the later merge is clean.
- `apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts` (new) — implements the repository port.
- `apps/api/src/categories/infrastructure/usage/no-usage-adapter.ts` (new) — answers `false`.
- `apps/api/test/categories/category-repository.test.ts` (new), `apps/api/test/identity/migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` (modified).

**Logic**
- Repository: every method takes the scope first and filters with `scopedTo(scope, { owner: categories.ownerId })` in the same statement; foreign or missing rows give `null` or `false`. `ensureDefaults` inserts the owner's row in `category_defaults_seeded` with `on conflict do nothing returning` and, only when that row was new, inserts the roots then the children (joined by key) in the same transaction, so concurrent first requests seed once and deleted defaults never return. `runExclusive` opens one transaction, takes `pg_advisory_xact_lock(hashtextextended('categories:name:' || owner_id, 0))` and exposes the transactional primitives; the conflict rule itself runs in the use case; a unique violation on `categories_owner_name_unique` also becomes `CategoryNameTaken`, and a foreign-key violation (23503) on insert under a parent that vanished becomes `ResourceNotFound`. `update` sets `name` (turning an untouched default into the user's own), `icon`, `color` and `updated_at` explicitly. `setArchived(…, true)` archives the target and its children in one statement (`id = ? or parent_id = ?`) and keeps existing `archived_at`; unarchiving clears only the target. A foreign-key violation (23503) on delete becomes `CategoryInUse`; any other error propagates unchanged.
- A trigger rejects changing `owner_id`, `kind`, `parent_id` or `default_key` after insert, and rejects a parent that itself has a parent (defence in depth for FR-03, FR-04).
- Rollback: run `0009_categories.down.sql`, which drops the trigger, the function and both tables and deletes the journal row whose `created_at` equals the journal `when` of 0009, then revert the commit. DESTRUCTIVE (every category is lost), so it needs an explicit plan and the API stopped. Because 0009 has the newest `when`, it is rolled back before every other migration.

**Data model**
- Entity `categories`: `id` uuid primary key default `gen_random_uuid()`; `owner_id` uuid not null, foreign key to `users.id` on delete cascade; `kind` text not null with a check in (`expense`, `income`); `parent_id` uuid nullable; `default_key` text nullable (check length 1 to 60); `name` text nullable with a check that it is null or has `char_length` 1 to 50; a check that `default_key` or `name` is not null; `icon` and `color` text not null with a check of length 1 to 40; `archived_at` timestamptz nullable; `created_at` and `updated_at` timestamptz not null default `now()`.
- Constraints and indexes: unique (`id`, `owner_id`, `kind`) and composite foreign key (`parent_id`, `owner_id`, `kind`) to it with `on delete restrict`, so a parent shares owner and kind (MATCH SIMPLE leaves roots unconstrained); unique index `categories_owner_default_key_unique` on (`owner_id`, `default_key`) where `default_key` is not null; unique index `categories_owner_name_unique` on (`owner_id`, `kind`, `coalesce(parent_id, '00000000-0000-0000-0000-000000000000')`, `lower(name)`) where `name` is not null; index `categories_owner_kind_parent_idx` on (`owner_id`, `kind`, `parent_id`); index `categories_owner_created_idx` on (`owner_id`, `created_at`, `id`).
- Entity `category_defaults_seeded`: `owner_id` uuid primary key, foreign key to `users.id` on delete cascade; `seeded_at` timestamptz not null default `now()`.

**Error handling**
- A custom name colliding on `categories_owner_name_unique` raises `CategoryNameTaken`, never a raw driver error.
- Delete blocked by a referencing row (23503) raises `CategoryInUse`.
- A direct update that changes `owner_id`, `kind`, `parent_id` or `default_key`, or inserts a child under a child, fails at the database with 23514 and leaves the row unchanged.
- A name longer than 50 characters, empty, or a row with neither `default_key` nor `name` fails the check constraints.
- Any other database error propagates and becomes 500 `INTERNAL` through the shared error handler.

**Required tests**
- [ ] `ensureDefaults` seeds the 33 defaults once per owner, concurrent first calls seed once, and a second owner gets their own set (validates AC-01, NFR-02).
- [ ] create and read a category under a default parent; update changes name, icon, color; a default renamed keeps its key and stores the name (validates AC-02, AC-05, AC-16).
- [ ] archive archives the target and its children, unarchive restores only the target, and the default list excludes archived rows (validates AC-06, AC-07, AC-08).
- [ ] delete of an unreferenced leaf removes it; delete of a category referenced by a test-only table with `ON DELETE RESTRICT` fails with the `CategoryInUse` error and the row stays (validates AC-09, AC-10).
- [ ] a duplicate custom name in any case conflicts, a Spanish or English name of an untouched sibling default conflicts, the same name under another parent or kind is accepted, and non-ASCII names such as `Ñandú` and `ñandú` conflict (validates AC-11).
- [ ] a raw update of `kind`, `parent_id`, `owner_id` or `default_key` fails with the 23514 error and leaves the row unchanged; a child under a child fails with 23514; a parent of another kind or owner fails the composite foreign key with 23503 (validates AC-03, AC-04).
- [ ] reading, updating, archiving, unarchiving and deleting another owner's id return `null` / `false` (the 404 case) and change nothing (validates AC-12, NFR-02).
- [ ] list returns only the caller's rows, orders by `created_at, id`, honours `kind`, `limit` and `offset` and has a deterministic page order with identical `created_at` values (validates AC-13, NFR-01).
- [ ] the check constraints fail on an invalid 51-character name, an empty name, a row without key and name, and an icon longer than 40 characters (validates NFR-03).
- [ ] an unexpected driver error propagates unchanged instead of being mapped to a domain error (error path).
- [ ] `migration.test.ts`: all migrations apply on an empty database (count 8 on this branch), the 0009 rollback and re-apply work, every rollback chain starts with `rollback('0009_categories')`, and the journal `when` of 0009 is later than every other `when` (the test fails if the order is ever reversed).
- [ ] a create under a parent deleted concurrently fails with the 23503 error mapped to 404 and no row is left (error path).
- [ ] `build-output.test.ts`: the built migrator creates `categories` and `category_defaults_seeded`.

**Completion criterion**
The repository test, `migration.test.ts` and `build-output.test.ts` pass against PostgreSQL, `pnpm exec drizzle-kit generate` reports no pending difference, and the only hand-written SQL is the appended guard function and trigger.

## Block 5 — HTTP routes, wiring and AGENTS.md

**Files**
- `apps/api/src/categories/infrastructure/http/category-routes.ts` (new) — `RouterFactory` for `/categories`.
- `apps/api/src/categories/infrastructure/http/category-presenter.ts` (new) — maps a domain category to the response.
- `apps/api/src/categories/index.ts` (modified) — exports `createCategoryRoutes`.
- `apps/api/src/server.ts` (modified) — mounts the factory through `routerFactories`.
- `AGENTS.md` (modified) — adds `categories` to the module list under "Architecture conventions" and one sentence recording the exception that default category names (Spanish and English) live in `packages/shared/src/categories` because the API enforces uniqueness across languages, while every other string stays in the i18n catalogs.
- `apps/api/test/categories/category-routes.test.ts` (new) — HTTP tests through the identity harness with real sessions.

**Logic**
`createCategoryRoutes({ db, usage?, logger })` builds the repository and the use cases (default usage adapter: `NoUsageAdapter`) and returns a `RouterFactory` that mounts `requireSession` and `requireVerifiedEmail` on `/categories`, then each route with the shared `validate` middleware. The scope comes from `OwnerOrGroupMemberAccessPolicy` with the deny-all membership reader; every handler asks for a write scope because the first call seeds defaults. An empty result becomes 404. Create, update, archive, unarchive and delete write an info audit line with the user id and category id only (never a name). `createApp` does not self-mount the module; `server.ts` passes the factory next to any other module factory.

**API contract**
- `GET /categories` — Query: `kind` (optional), `archived` (`true` or `false`, default false), `limit` (1 to 100, default 100), `offset`. Response 200: `{ items: CategoryResponse[], total, limit, offset }`. Errors: 400, 401, 403. Auth: session plus verified email.
- `POST /categories` — Request body: `name`, `kind`, `icon`, `color`, optional `parentId`. Response 201: `CategoryResponse`. Errors: 400 `VALIDATION_FAILED` with `fields`, 400 `CATEGORY_NESTING_TOO_DEEP`, 400 `CATEGORY_PARENT_KIND_MISMATCH`, 401, 403, 404 for a missing or foreign parent, 409 `CATEGORY_NAME_TAKEN`. Auth: session plus verified email.
- `GET /categories/:id` — Params: `id` UUID. Response 200: `CategoryResponse` (archived included). Errors: 400, 401, 403, 404. Auth: session plus verified email.
- `PATCH /categories/:id` — Params: `id`. Request body: at least one of `name`, `icon`, `color` (`kind` or `parentId` present means 400). Response 200: `CategoryResponse`. Errors: 400, 401, 403, 404, 409 `CATEGORY_NAME_TAKEN`. Auth: session plus verified email.
- `POST /categories/:id/archive` and `POST /categories/:id/unarchive` — Params: `id`; empty request body. Response 200: `CategoryResponse`, idempotent. Errors: 400, 401, 403, 404. Auth: session plus verified email.
- `DELETE /categories/:id` — Params: `id`. Response 204. Errors: 400, 401, 403, 404, 409 `CATEGORY_IN_USE`. Auth: session plus verified email.
- State-changing methods also need the web origin and `X-Requested-With` (existing origin guard).

**Input validation**
- Every route validates params, query and body with the shared validators of Block 1 through `validate`; handlers never read `req.body`. Identifiers are UUIDs; unknown body keys are stripped; `kind` and `parentId` on PATCH fail.

**Error handling**
- Validation failures answer 400 `VALIDATION_FAILED` with field paths and never echo submitted values.
- A missing, malformed or expired session answers 401; an unverified email answers 403 `EMAIL_NOT_VERIFIED`.
- Another user's category (and a foreign or missing parent) answers 404 `NOT_FOUND`, identical to a missing id.
- A duplicate name answers 409 `CATEGORY_NAME_TAKEN`; deleting a used category or one with subcategories answers 409 `CATEGORY_IN_USE`; nesting and kind mismatch answer 400 with their codes.
- A response body that does not match its validator becomes 500 `INTERNAL` (fail closed), never a leak.

**Required tests**
- [ ] a new verified user's first `GET /categories` returns exactly the Appendix A defaults (33) with `key` set and `name` null (validates AC-01).
- [ ] create returns 201 and the category appears in the list and under its kind (validates AC-02).
- [ ] create with a parent that has a parent answers 400 `CATEGORY_NESTING_TOO_DEEP` and with a parent of another kind answers 400 `CATEGORY_PARENT_KIND_MISMATCH` (validates AC-03, AC-04).
- [ ] PATCH persists name, icon and color and returns them; PATCH with `kind` or `parentId` answers 400 and the category is unchanged (validates AC-05).
- [ ] archive removes a category from the default list, keeps GET by id and `archived=true`, archives its subcategories (validates AC-06, AC-07); unarchive restores it (validates AC-08).
- [ ] DELETE answers 204 for an unused leaf (validates AC-09) and 409 `CATEGORY_IN_USE` for one with a subcategory or with a movement reported by the injected test usage adapter, and the row remains (validates AC-10).
- [ ] create and PATCH reject a duplicate name in any case, and a Spanish or English name of an untouched sibling default, with 409 `CATEGORY_NAME_TAKEN` (validates AC-11).
- [ ] renaming a default via PATCH returns its custom name with the `key` kept; the other translations stay free (validates AC-16, AC-17).
- [ ] GET, PATCH, archive, unarchive and DELETE on another user's category, and a create with a foreign parent, answer 404 with the same body as a missing id (validates AC-12).
- [ ] the list shows only the caller's categories (validates AC-13).
- [ ] every route answers 401 without a session and 403 `EMAIL_NOT_VERIFIED` for an unverified user (error path).
- [ ] `limit` 101 answers 400 and `limit` 100 is accepted (validates NFR-01).
- [ ] a state-changing request without the origin header answers 403 (error path), and the audit line holds the user id and category id and no name (validates NFR-02).
- [ ] `AGENTS.md` lists `categories` among the modules and states the default-names exception (a test reads the file) (validates the Q4 decision).

**Completion criterion**
`category-routes.test.ts` passes, `GET /categories` answers 200 for a verified user when the factory is mounted through `routerFactories`, and `pnpm typecheck` and `pnpm lint` pass for `apps/api`.

## Block 6 — Web API client methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — category methods; `RequestOptions.method` widened with `DELETE`.
- `apps/web/test/api-client.test.ts` (modified) — tests for the new methods.

**Logic**
Adds `listCategories(query)`, `createCategory(body)`, `getCategory(id)`, `updateCategory(id, body)`, `archiveCategory(id)`, `unarchiveCategory(id)` and `deleteCategory(id)`. All are session-bound (`refreshOnUnauthenticated`), parse responses with the shared response validators and map the four new codes through Block 2. The id is encoded in the path and an unsafe id (`''`, `.`, `..`) returns a validation failure without a request; the list query is built with `URLSearchParams` from validated values only.

**Input validation**
- Request bodies come from values the containers validated with the shared validators; the client encodes the id and sends no other user-controlled path segment.

**Error handling**
- A network failure returns `{ ok: false, code: 'NETWORK' }`.
- A 409 `CATEGORY_NAME_TAKEN` returns the failure with `categoryNameTaken`.
- A 409 `CATEGORY_IN_USE` returns the failure with `categoryInUse`.
- A response that does not match its validator returns `INTERNAL` instead of throwing.

**Required tests**
- [ ] `createCategory` sends the body with credentials and the `X-Requested-With` header and returns the parsed category (validates AC-02).
- [ ] `updateCategory` uses `PATCH` with the encoded id (validates AC-05).
- [ ] `archiveCategory`, `unarchiveCategory` and `deleteCategory` use the right method and path and delete accepts an empty 204 (validates AC-06, AC-08, AC-09).
- [ ] `listCategories` serializes `kind`, `archived`, `limit` and `offset` (validates AC-13).
- [ ] a 409 answer with `CATEGORY_NAME_TAKEN` maps to `categoryNameTaken` (validates AC-11).
- [ ] a 409 answer with `CATEGORY_IN_USE` maps to `categoryInUse` (validates AC-10).
- [ ] an unsafe id returns a validation failure without a request (error path).
- [ ] a network failure returns the `NETWORK` error result without throwing (error path).
- [ ] an invalid response body returns the `INTERNAL` error result without throwing (error path).

**Completion criterion**
`api-client.test.ts` passes and `pnpm typecheck` passes for `apps/web`.

## Block 7 — Web categories screens

**Files**
- `apps/web/src/features/categories/components/category-form.tsx`, `category-list.tsx`, `category-visual.tsx` (new) — presentational components (form, list with subcategories, icon and color rendering).
- `apps/web/src/features/categories/containers/categories-container.tsx` (new) — loads, edits, archives, unarchives and deletes; `create-category-container.tsx` (new) — validates and creates.
- `apps/web/src/features/categories/category-form-errors.ts` and `category-icons.ts` (new) — field messages and the icon key to Lucide map; the focus hook of `features/profile/use-focus-invalid.ts` is reused, not copied.
- `apps/web/src/app/[locale]/(app)/categories/page.tsx` (new) — route; `apps/web/src/features/auth/components/authenticated-shell.tsx` (modified) — a Categories link in the navigation.
- `apps/web/src/app/globals.css` (modified) — 12 category color tokens for light and dark themes, mapped in `@theme inline`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `categories` namespace and the nav label.
- `apps/web/test/categories-components.test.tsx`, `apps/web/test/categories-containers.test.tsx`, `apps/web/test/authenticated-shell-container.test.tsx` and `apps/web/test/routes.test.tsx` (new or modified).

**Logic**
- Container/presentational split; presentational components fetch nothing and receive resolved labels or a `language` prop; only containers use `useApiClient` and `useLocale()`. The icon picker and the color picker are groups of native radio inputs styled with the existing tokens and the archived toggle is a native checkbox (no new runtime dependency), built from `components/ui/form.tsx` and `select.tsx` where they fit. The container pages through the list until `total` is reached, so nothing is truncated past 100 categories.
- The list shows expense and income sections, each category with its subcategories, a name from `displayCategoryName(category, locale)` (so untouched defaults switch language with the locale), the icon and color rendered from keys (`category-visual.tsx` maps colors to theme tokens and icons to Lucide, never raw values), an archived toggle, inline edit of name, icon and color, archive and unarchive, and delete with an inline confirmation and, on `categoryInUse`, the message plus an "archive instead" action.
- The create form has kind, optional parent (active top-level categories of that kind), name, icon and color; the container validates with the shared validators and shows per-field messages; a name error from the API (`categoryNameTaken`, nesting, kind mismatch) shows on the right field.
- The pages are thin Server Components rendering the containers; no Server Component reads financial data. Strings come only from the catalogs, in Spanish and English, except the default category names, which come from the shared catalog (decision recorded above).

**Input validation**
- Form fields are validated client-side with the shared validators of Block 1 (name 1 to 50 code points without control or format characters, kind, icon, color, parent); the API stays the authority.

**Error handling**
- A missing or invalid name, icon or color shows the field message and sends no request.
- `categoryNameTaken` shows the duplicate-name message on the name field.
- `categoryInUse` shows the message with the archive-instead action.
- A nesting or kind-mismatch answer shows its message on the parent field.
- A network or unexpected failure shows the retry alert and keeps the typed values.

**Required tests**
- [ ] with `es` the default categories show `Comida` and `Supermercado`, and with `en` `Food` and `Groceries` (validates AC-14, AC-15).
- [ ] rerendering the same list when the locale changes switches untouched defaults and keeps a renamed default's custom name (validates AC-15, AC-16, AC-17).
- [ ] submitting a valid form calls `createCategory` once and shows the category (validates AC-02).
- [ ] a missing name, icon or color shows each field error and calls nothing (error path, AC-02).
- [ ] a nesting or kind-mismatch answer shows the message on the parent field (validates AC-03, AC-04).
- [ ] inline edit shows the new name, icon and color (validates AC-05).
- [ ] archive removes the row from the active view, archiving a parent hides its subcategories, and unarchive restores it (validates AC-06, AC-07, AC-08).
- [ ] delete asks for confirmation and removes the row (validates AC-09); a 409 shows the message and the archive-instead action (validates AC-10).
- [ ] a duplicate-name answer shows the name error (validates AC-11).
- [ ] only the caller's categories are rendered from the API answer (validates AC-13).
- [ ] a category name containing markup is rendered as literal text and never interpreted (error path, invalid markup).
- [ ] a network failure shows the retry state keeping typed values (error path).
- [ ] the shell navigation has the Categories link, `routes.test.tsx` renders the page, and `i18n-catalogs.test.ts` stays green (es and en keys match).

**Completion criterion**
The web test files and `i18n-catalogs.test.ts` pass, `pnpm typecheck` and `pnpm lint` pass for `apps/web`, and the page renders in `es` and `en` without hardcoded strings or raw color values.

## Block 8 — End-to-end and boundary tests

**Files**
- `apps/web/e2e/categories.spec.ts` (new) — Playwright flows with a fresh verified user.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — probes for `apps/api/src/categories/domain` (I/O libraries and infrastructure) and `apps/api/src/categories/application` (infrastructure, including `shared/access/infrastructure`); the categories persistence file imports `users` from the identity persistence file only, never from the identity barrel.

**Logic**
- The e2e spec registers and verifies a user through Mailpit like `auth.spec.ts`, opens `/es/categories`, checks the defaults in Spanish, opens `/en/categories` and checks the English names, renames a default and checks the custom name in both locales while another default still translates, creates a category and a subcategory, rejects a duplicate name and a name equal to a default's translation, archives and unarchives a parent with its subcategory, deletes an unused category, and checks that a second user never sees the first user's categories. Copy for labels comes from `e2e/support/catalogs.ts`; default names come from the shared catalog.
- The boundary probes assert that the domain folder rejects `drizzle-orm`, `pg`, `express` and infrastructure imports, and that the application folder rejects infrastructure imports.

**Error handling**
- The e2e spec fails on any console error or unexpected status instead of retrying silently.
- A boundary probe that unexpectedly passes fails the test.
- If the e2e ports are busy the run waits and retries instead of reusing a running server.

**Required tests**
- [ ] e2e: the Spanish and English defaults render for the same user, and the language switch changes untouched default names (validates AC-01, AC-14, AC-15, AC-17).
- [ ] e2e: a renamed default keeps its custom name after the language switch while its siblings translate (validates AC-16, AC-17).
- [ ] e2e: a category and a subcategory are created, a duplicate and a default-translation name show an error message (validates AC-02, AC-11).
- [ ] e2e: archive, unarchive and delete update the list, and deleting a parent with subcategories shows an error and keeps it (validates AC-06, AC-07, AC-08, AC-09, AC-10).
- [ ] e2e: a second user never sees the first user's categories (validates AC-13).
- [ ] boundary probes reject forbidden imports in the categories domain and application folders (error path, invalid import).

**Completion criterion**
`pnpm e2e` passes the new spec and `pnpm test` stays green including the boundary probes.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor over the three trees) and `pnpm e2e` pass.
- Every FR-01 to FR-12 and AC-01 to AC-17 maps to a test above; the deferrals to PRD 03 are the ones listed and nothing else.
- `pnpm audit --prod --audit-level high` is unchanged: no runtime dependency is added to any package.
- Rollback: `0009_categories.down.sql` drops both tables and the trigger (destructive, explicit plan required); the rest of the change is reverted with the commit.
