# Verification DISC-001-02b

| Field | Value |
|---|---|
| Module | `apps/api/src/categories/**`, `apps/api/src/identity/**` (`NewUserProvisioning` port and `onUserCreated` hooks), `apps/api/drizzle/0009_categories.sql`, `packages/shared/src/categories/**`, `apps/web/src/features/categories/**` |
| Line coverage | 96.89% (whole project, fresh run). New and modified code: 97.57% (481/493). |
| Branch coverage | 92% (whole project, fresh run). New and modified code: 89.70% (270/301). |
| Function coverage | 94.77% (whole project, fresh run). New and modified code: 97.53% (158/162). |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings. `pnpm typecheck` clean for shared, api and web. `pnpm exec prettier --check --end-of-line auto .` clean. `drizzle-kit generate` in `apps/api` reports "No schema changes" and wrote no files. |

Cross-verification by `ddw-module-verifier` (an agent that did not write the code), on branch `feat/DISC-001-02b` at `075529c`.

- **Suite:** I ran `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02b_test pnpm test:coverage`. It passed 121 files and 1833 tests, 0 failed, matching `docs/ddw/reports/tests-DISC-001-02b.md` exactly (96.89% / 92% / 94.77%).
- **Not re-run:** e2e and perf, because the ports are shared. Those figures (e2e 64/64, perf 6/6) are taken from the tests report.
- **Read-only:** I changed no source, test or doc file.

## Acceptance criteria

"Behavioural" below means the test asserts the response body and the persisted state, not only the status.

- ✅ AC-01 (FR-01), behavioural
  - Code: `seed-default-categories.ts:seedDefaultCategories`, called from `register-user.ts:78` through `drizzle-unit-of-work.ts` `provisioning.provision`, registered in `server.ts:17`.
  - `account-creation.test.ts` "gives a user registered with email and password exactly the 33 defaults (AC-01)"
  - `category-routes.test.ts` "gives a user registered with the creation hook exactly the 33 defaults, key set and name null (AC-01)"
  - `category-repository.test.ts` "creates the 33 defaults once per owner and writes exactly the live catalog"
  - `default-categories.test.ts` "has exactly the 33 Appendix A entries with unique keys" and "has 9 expense roots, 19 expense subcategories and 5 income roots"
  - `register-user.test.ts` "provisions the new user right after create (AC-01)"
- ✅ AC-02 (FR-02), behavioural
  - Code: `create-category.ts:CreateCategory.execute`; route `category-routes.ts` `POST /categories`.
  - `category-routes.test.ts` "creates a category (201) that appears in the list and under its kind (AC-02)"
  - `category-use-cases.test.ts` "returns the category and lists it under its kind"
  - `category-contracts.test.ts` "rejects a missing %s and names it" (name, kind, icon, color), plus the icon, color and kind outside-the-list tests
  - `api-client.test.ts` "creates a category with cookies, the CSRF header and a JSON body (AC-02)"
  - `categories-containers.test.tsx` "creates the category once with the validated body and reports it (AC-02)" and "names each missing field, focuses the first one and sends nothing (AC-02)"
  - e2e "a category and a subcategory are created ... (AC-02, AC-11)"
- ✅ AC-03 (FR-03), behavioural
  - Code: `create-category.ts:226` (`CategoryNestingTooDeep`); trigger `categories_guard` in `0009_categories.sql`.
  - `category-routes.test.ts` "refuses a subcategory under a subcategory with CATEGORY_NESTING_TOO_DEEP (AC-03)"
  - `category-use-cases.test.ts` "a subcategory under a subcategory fails with CategoryNestingTooDeep"
  - `category-repository.test.ts` "rejects a child under a child with 23514"
  - `error-handler.test.ts` "maps %s to %i with only its code" (400)
  - `api-client.test.ts` "maps a %i %s answer of createCategory to %s"
  - `categories-containers.test.tsx` "shows a %s answer on the parent field (AC-03, AC-04)"
  - The message text is in the `categoryNestingTooDeep` catalog entry.
- ✅ AC-04 (FR-04), behavioural
  - Code: `create-category.ts:227` (`CategoryParentKindMismatch`); composite foreign key `categories_parent_owner_kind_fk`.
  - `category-routes.test.ts` "refuses a parent of another kind with CATEGORY_PARENT_KIND_MISMATCH (AC-04)"
  - `category-use-cases.test.ts` "a parent of another kind fails with CategoryParentKindMismatch"
  - `category-repository.test.ts` "rejects a parent of another kind or another owner with 23503"
  - The same container test as AC-03.
- ✅ AC-05 (FR-05), behavioural
  - Code: `update-category.ts:UpdateCategory.execute`; `drizzle-category-repository.ts:updateFields`.
  - `category-routes.test.ts` "persists name, icon and color and returns them (AC-05)" and "answers 400 for kind, parentId or an empty body and leaves the category unchanged (AC-05)"
  - `category-use-cases.test.ts` "persists name, icon and color and returns them"
  - `category-repository.test.ts` "updates name, icon and color and moves updated_at forward"
  - `category-contracts.test.ts` updateCategoryRequestSchema tests: "fails when kind is sent", "fails when parentId is sent", "fails when no field is sent"
  - `categories-containers.test.tsx` "edits inline and shows the new name, icon and color (AC-05)"
  - The "every existing movement" half is deferred to PRD 03 (see Deferrals).
- ✅ AC-06 (FR-06), behavioural
  - Code: `set-category-archived.ts`; `drizzle-category-repository.ts:154` `setArchived`.
  - `category-routes.test.ts` "archive hides from the default list, keeps GET, lists under archived=true and archives subcategories (AC-06, AC-07)"
  - `category-use-cases.test.ts` "hides the category from the default list, keeps it readable and deletes nothing"
  - `category-repository.test.ts` "archives the target and its children, unarchive restores only the target, and the default list excludes archived rows"
  - `categories-containers.test.tsx` "archives a parent out of the active view ... (AC-06, AC-07, AC-08)"
  - The "kept on movements" half is deferred (see Deferrals).
- ✅ AC-07 (FR-06), behavioural
  - Code: `drizzle-category-repository.ts:170` (`id = ? or parent_id = ?`).
  - The routes and repository tests for AC-06.
  - `category-use-cases.test.ts` "archiving a parent archives its subcategories" and "an already archived child keeps its own archived_at when its parent is archived"
  - The container test for AC-06.
- ✅ AC-08 (FR-07), behavioural
  - Code: `drizzle-category-repository.ts:174` (unarchive clears only the target).
  - `category-routes.test.ts` "unarchive restores only the target, idempotently (AC-08)"
  - `category-use-cases.test.ts` "unarchive restores only the target, idempotently, without touching others"
  - The repository and container tests for AC-06.
  - e2e "archive, unarchive and delete update the list ..."
- ✅ AC-09 (FR-08), behavioural
  - Code: `delete-category.ts:DeleteCategory.execute`; route `DELETE /categories/:id` answers 204.
  - `category-routes.test.ts` "answers 204 for an unused leaf (AC-09)"
  - `category-use-cases.test.ts` "removes a category with no movements and no subcategories"
  - `category-repository.test.ts` "removes an unreferenced leaf and answers false for a missing id"
  - `categories-containers.test.tsx` "asks for confirmation before deleting and then removes the row (AC-09)"
  - `api-client.test.ts` delete accepts an empty 204.
- ✅ AC-10 (FR-08), behavioural
  - Code: `delete-category.ts:309-310`; `drizzle-category-repository.ts:201` maps 23503 to `CategoryInUse`; `ON DELETE RESTRICT` on the parent key.
  - `category-routes.test.ts` "answers 409 CATEGORY_IN_USE for a category with a subcategory and keeps the row (AC-10)" and "... the usage adapter reports used (AC-10)"
  - `category-use-cases.test.ts` "fails with CategoryInUse when the usage port reports use, and the row stays" and "... when it has subcategories, and the row stays"
  - `category-repository.test.ts` "raises CategoryInUse and keeps the row when a referencing row exists (ON DELETE RESTRICT)" and "raises CategoryInUse for a parent that still has subcategories and counts them"
  - `error-handler.test.ts` 409 `CATEGORY_IN_USE`
  - `api-client.test.ts` "maps a 409 CATEGORY_IN_USE answer to categoryInUse (AC-10)"
  - `categories-containers.test.tsx` "answers a refused deletion with the message and an archive-instead action (AC-10)"
  - `categories-components.test.tsx` "shows the in-use message with archive-instead only on active rows (AC-10)"
  - Using a real movement is deferred to PRD 03.
- ✅ AC-11 (FR-09), behavioural
  - Code: `domain/naming.ts:findNameConflict` plus `effectiveNames`, applied in `create-category.ts:230` and `update-category.ts:273`; second line of defence is the unique index `categories_owner_name_unique`.
  - `category-routes.test.ts` "refuses a duplicate name in any case and the Spanish or English name of an untouched sibling default (AC-11)" and "refuses a rename to a duplicate in any case or to an untouched sibling default name (AC-11)"
  - `category-use-cases.test.ts` has seven tests: duplicate in any case, among archived siblings, Spanish or English default name, rename in either language, same name under another parent or kind accepted, decomposed vs composed NFC, another user may reuse a name.
  - `category-repository.test.ts` has five tests, including "folds non-ASCII case: Nandu with a tilde conflicts with its lower-case form". It states the database collation it runs under.
  - `categories-containers.test.tsx` "shows the duplicate-name message on the name field (AC-11)" and "keeps the edit open with the duplicate-name message (AC-11)"
  - e2e (duplicate and default-translation names)
- ✅ AC-12 (FR-10), behavioural
  - Code: every repository method filters through `scopedTo` (`inScope` and `scopedRow`); `notFoundUnlessAllowed` in the use cases.
  - `category-routes.test.ts` "answers another user category, and a foreign parent, exactly like a missing id (AC-12)"
  - `category-use-cases.test.ts` "get, update, archive, unarchive and delete of a foreign id are ResourceNotFound and change nothing", "a missing id is ResourceNotFound too" and "create with a foreign parent is ResourceNotFound and creates nothing"
  - `category-repository.test.ts` "answers null, false or zero for every method on another owner id and changes nothing"
- ✅ AC-13 (FR-10), behavioural
  - Code: `drizzle-category-repository.ts:133` `list`.
  - `category-routes.test.ts` "lists only the caller categories (AC-13)"
  - `category-use-cases.test.ts` "list returns only the caller categories"
  - `category-repository.test.ts` "lists only the caller rows"
  - `categories-containers.test.tsx` "renders only the categories the API answered (AC-13)"
  - `categories-components.test.tsx` "shows only the categories it is given (AC-13)"
  - e2e "a second user never sees the first user's categories (AC-13)"
  - `api-client.test.ts` list serialization of `kind`, `archived`, `limit`, `offset`
- ✅ AC-14 (FR-11), behavioural
  - Code: `shared/src/categories/default-categories.ts:defaultCategoryName` and `category.ts:175` `displayCategoryName`, used through `features/categories/category-display.ts:categoryLabel` and `useLocale()` in `categories-container.tsx`. The API returns `key` and `name: null`, by design, so the label is resolved on the client.
  - `default-categories.test.ts` "resolves Spanish and English names"
  - `categories-components.test.tsx` "shows the Spanish default names with es (AC-14)"
  - `categories-containers.test.tsx` "shows the loading state, then the Spanish defaults with es (AC-14)"
  - `routes.test.tsx` "the categories screen is only shown behind the session guard"
  - e2e "the Spanish and English defaults render for the same user"
- ✅ AC-15 (FR-11), behavioural
  - Code: same as AC-14.
  - `categories-components.test.tsx` "shows the English default names with en (AC-15)" and "switches untouched defaults with the language and keeps a renamed default (AC-15, AC-16, AC-17)"
  - `categories-containers.test.tsx` "shows the English defaults with en (AC-15)"
  - `routes.test.tsx` "renders the categories screen in English with the English default names"
  - e2e language switch.
- ✅ AC-16 (FR-12), behavioural
  - Code: `update-category.ts` stores `name` and keeps the key; `drizzle-category-repository.ts:updateFields`; `displayCategoryName`.
  - `category-routes.test.ts` "renames a default: custom name returned, key kept, old translations free (AC-16, AC-17)"
  - `category-use-cases.test.ts` "stores the custom name, keeps the key, and frees the old translations"
  - `category-repository.test.ts` "keeps the key and stores the name when a default is renamed, and keeps the name null for icon edits"
  - `default-categories.test.ts` "keeps the renamed name of a default in both languages"
  - `categories-containers.test.tsx` "keeps a renamed default under its custom name in either language (AC-16, AC-17)"
  - e2e "a renamed default keeps its custom name after the language switch while its siblings translate".
- ✅ AC-17 (FR-12), behavioural
  - Code: `update-category.ts` (D4: only a name change makes a default the user's own); `displayCategoryName`.
  - `category-use-cases.test.ts` "editing only icon or color keeps an untouched default untouched (D4)"
  - `categories-containers.test.tsx` "does not rename a default when only its color changes (D4)"
  - The routes, list-component and e2e tests of AC-15 and AC-16.
  - `default-categories.test.ts` "translates an untouched default"
- ✅ AC-18 (FR-01), behavioural
  - Code: `complete-google-sign-in.ts:248` (new-user branch only).
  - `account-creation.test.ts` "gives a user created by Google sign-up exactly the defaults and a working session (AC-18)"
  - Google supersede path: "creates no categories on the Google supersede path (FR-01)"
- ✅ AC-19 (FR-01), behavioural
  - Code: `drizzle-unit-of-work.ts:34-45` (a rejecting hook becomes `NewUserProvisioningFailed` inside the transaction); `register-user.ts:78`.
  - `account-creation.test.ts` "rolls registration back when the hook throws: no user, no verification email, no categories (AC-19)" and "rolls Google sign-up back when the hook throws: no user, link or session, state consumed (AC-19)"
  - `identity-infrastructure.test.ts` "rolls the user back when a hook rejects, and skips the hooks after it (AC-19)"
  - `register-user.test.ts` "rejects with the provisioning exception and enqueues no verification email (AC-19)"
  - The "logged distinctly" requirement is implemented (`new-user-provisioning-failed.ts`) and asserted (`type: 'NewUserProvisioningFailed'` in `account-creation.test.ts`).
- ✅ AC-20 (FR-13), behavioural
  - Code: the "-- backfill default categories" statement in `drizzle/0009_categories.sql`. It is one CTE statement with 33 literal rows, run before the guard trigger.
  - `migration.test.ts` "backfills the default set for existing users on a database at 0007 and changes no other row". It compares each user's rows with the frozen fixture `default-set-0009.ts` (33 rows) and checks per-table digests of the other tables.
- ✅ AC-21 (FR-13), behavioural
  - Code: the `NOT EXISTS` marker filter in the same statement.
  - `migration.test.ts` "creates no duplicate when the backfill runs again, and never gives back a deleted default or reseeds a marked user"
- ✅ AC-22 (FR-14), behavioural
  - Code: the marker `on conflict do nothing returning` in `seed-default-categories.ts` and `ensureDefaults` (`drizzle-category-repository.ts:113`).
  - `migration.test.ts`, same test as AC-21 (after the second run, ana has 32 rows and bob none).
  - `category-repository.test.ts` "does not recreate a deleted default when seeding again" and "seeds a user without the marker once and never brings back a deleted default"
  - `category-use-cases.test.ts` "seeds the Appendix A defaults once and never recreates a deleted one"
  - `account-creation.test.ts` "does not recreate a default the user deleted, on a later sign-in or safety-net call (AC-22)" and "gives two registered users each their own set (AC-22)"

No criterion is verified by a status-code-only test. The routes tests assert bodies and database rows.

## Non-functional requirements
- ✅ NFR-01 (page size at most 100)
  - Code: `category.ts:122-139` (`LIST_CATEGORIES_MAX_LIMIT` = 100, default 100); `list-categories.ts` re-checks the range.
  - `category-routes.test.ts` "accepts limit 100 and rejects 101"; also `limit=` blank and `limit=0`.
  - `category-contracts.test.ts` "accepts a limit of 100 and fails on 101 and 0"
  - `category-use-cases.test.ts` "refuses a limit or offset outside the documented range" and "limit and offset slice the same ordered list and total stays the full count"
  - `category-repository.test.ts` "orders by created_at then id, deterministically with identical timestamps, and pages with limit and offset"
  - `categories-containers.test.tsx` "pages through the list until the total is reached"
- ✅ NFR-02 (single owner, every query filtered by owner)
  - Code: `scopedTo` in every repository method and in the marker query; `owner_id NOT NULL`; composite foreign keys; `categories_guard` makes the owner immutable.
  - `category-repository.test.ts` "answers null, false or zero for every method on another owner id ..."
  - `category-repository.test.ts` "rejects raw updates of kind, parent_id, owner_id and default_key and leaves the row unchanged" and "gives a second owner their own set without touching the first"
  - `category-routes.test.ts` "records user id and category id for create, update, archive, unarchive and delete, never a name"
  - The unscoped queries are intentional. The backfill derives owners from `users`, and `CategoryUsage.isUsed(id)` only receives ids the scoped repository returned.
- ✅ NFR-03 (name 1 to 50 characters)
  - Code: `category.ts:56-75` (`categoryNameSchema`); CHECK `categories_name_length_check` in `0009_categories.sql`.
  - `category-contracts.test.ts` "accepts 50 code points and fails on 51", "fails on empty and whitespace-only names", and the table of invisible and control characters (zero-width space, zero-width joiner, right-to-left override, NUL, BOM, tab, newline, soft hyphen)
  - `category-repository.test.ts` "enforces the check constraints" (51 chars, empty, no key and no name, icon over 40)
  - `categories-containers.test.tsx` "treats a blank name as missing, a long one as too long and invisible characters as invalid"

## Spec blocks
- ✅ Block 1 — every task done (6 of 6 files), 8 of 8 required tests. The extra spec test (the web `categories` namespace does not duplicate default names) is in `i18n-catalogs.test.ts` "does not duplicate any default category name in the %s namespace".
- ✅ Block 2 — every task done (6 of 6), 5 of 5 required tests (`error-handler.test.ts` 409/409/400/400, `api-client.test.ts` four codes mapped and an unknown code to `unexpected`, `i18n-catalogs.test.ts` green).
- ✅ Block 3 — every task done (15 of 15 files), 15 of 15 required tests. The fake (`fakes.ts`) has no `findNameConflict` or `NameTaken`, so the production rule runs through the use cases. The boundary lint and probes pass.
- ✅ Block 4 — every task done (migration 0009, snapshot, journal idx 9 with `when` 1790902441319, rollback script, schema, repository, `seed-default-categories.ts`, `no-usage-adapter.ts`, tests), 17 of 17 required tests. The catalog and the migration both hold 33 rows. The migration test count is 9, every rollback chain starts with `rollback('0009_categories')`, and the journal-`when` ordering test fails if reversed.
- ✅ Block 5 — every task done (6 of 6, including the AGENTS.md edit: `categories` is in the module list and the default-names exception is stated), 14 of 14 required tests. `server.ts:18` mounts `createCategoryRoutes`. Every route validates params, query and body through `validate`, and responses are validated (fail closed).
- ✅ Block 6 — every task done (2 of 2), 9 of 9 required tests.
- ✅ Block 7 — every task done (all listed files exist, plus extras), 13 of 13 required tests. The focus hook is reused from `features/profile/use-focus-invalid.ts`, not copied. The shell link, the route test and i18n parity pass. The 12 colour tokens are asserted.
- ✅ Block 8 — every task done (2 of 2), 6 of 6 required tests. e2e: 5 flows (64/64 per the tests report, not re-run here). The boundary probes pass in the 1833-test run.
- ✅ Block 9 — every task done (15 of 15 files), 9 of 9 required tests. The new `no-restricted-imports` pattern and the identity-to-categories probes pass; `perf` budgets are taken from the tests report (6/6).

Spec statements still match the code:
- **Catalog:** 33 defaults (9 expense roots, 19 expense subcategories, 5 income roots).
- **Migration:** 0009 with its journal `when` and rollback.
- **Decisions D1 to D9:**
  - D1: seeding at creation plus the migration backfill.
  - D2: a custom name equal to a default's name in either language is refused with 409.
  - D3: 24 icon and 12 colour keys.
  - D4: only a rename detaches a default from translation.
  - D5: a subcategory under an archived parent is allowed (`category-use-cases.test.ts`).
  - D6: default limit 100, `archived` means active-only or archived-only.
  - D7: names unique among archived siblings, unarchive is not cascading, archive is idempotent, and the guard trigger is in place.
  - D8: the AGENTS.md exception.
  - D9: `ensureDefaults` is still called first by every use case.

## Tests
- ✅ Sad-path tests, every input.
  - Routes: 401 and 403 `EMAIL_NOT_VERIFIED` on all routes (`it.each`); the missing origin header on a state-changing request; an invalid body, `kind` or `parentId` on PATCH, and an empty body; `limit` of 0, 101 and blank, and a negative or fractional offset; a non-UUID id; 404 for foreign ids and a foreign parent; 409 duplicate name and in use.
  - Shared validators: name edge cases, icon and colour outside the lists, kind outside expense or income, a `parentId` that is not a UUID.
  - Repository: check constraints, guard trigger (23514), foreign keys (23503), foreign owners, an unexpected driver error propagated unchanged, and a rolled-back transaction.
  - Web: the missing-field, invisible-character, duplicate-name and network-failure forms; client tests for an unsafe id, a network failure, an invalid response body, and a markup name rendered as literal text.
- ✅ Coverage per file (fresh run). No file of the new logic is below 80% lines or functions, except Drizzle `schema.ts` (50% lines, 25% functions: table callbacks that only run under drizzle-kit; the constraints are proven by the migration and repository tests). Files at or below 80% branches:

| File | Lines | Branches |
|---|---|---|
| `domain/category.ts` | 100% | 75% |
| `features/categories/category-display.ts` | 90.9% | 75% |
| `categories-container.tsx` | 93.65% | 80% |

  Other branch figures: `drizzle-category-repository.ts` 90.62%, `category-routes.ts` 92.3%. Type-only files report 0 of 0. The three-metric aggregate for the new code is above the floor.
- ✅ TDD evidence (the first verifier round found it missing from the repository; the red-run records from the implementers' reports are now written here, and the verifier's own spot-check found the commit structure consistent with them): Block 1 red 85 of 86 (shared contract tests failing before the catalog and schemas existed); Block 2 red 8 of 8 (the four codes missing from the handler map, web mapping and catalogs); Block 3 red at import (`Cannot find module '../../src/categories'`, 0 tests ran), then 33 of 33 green; Block 4 red: whole `category-repository.test.ts` failed, `migration.test.ts` 21 of 25 failed, `build-output.test.ts` not run red (needs a full build) and adapted; Block 6 red 25 of 102 (`TypeError: client.deleteCategory is not a function`, `client.unarchiveCategory is not a function`, `client.getCategory is not a function`); Block 7 red at import for every new web test file (`Failed to resolve import` in `routes.test.tsx` and the component and container suites); Block 9 red 21 failed of 70 in 4 files, then three more red tests for the distinct `NewUserProvisioningFailed` (`expected 'Error' to be 'NewUserProvisioningFailed'`); Block 5 red 51 of 51 (`TypeError: createCategoryRoutes is not a function` and the two AGENTS.md assertions); Block 8 tests are over existing code, so the implementer proved each can fail by mutation (removing the domain and application lint patterns made 8 probes fail, re-pointing the identity import made the 2 persistence probes fail, forcing the Spanish label made 2 e2e flows fail). Review follow-ups for Blocks 1 and 3 were written as assertions that could not pass before the change (messages that did not exist). Each commit bundles the code with its tests.
- Commit order differs from the spec's execution order. Blocks 6 and 7 (`86de4e2`, `6df412e`) landed before Blocks 4, 9 and 5. The web tests mock the API, so this does not affect validity.

## Deferrals to PRD 03 (human-approved in the spec)
- AC-05 "shows it in every existing movement" and AC-06 "keeps it on existing movements". The substitutes are tests that the fields persist and that archiving deletes nothing and keeps the category readable by id.
- AC-10 with a real movement. The substitutes are the use case with a fake port, the 409 mapping and the `ON DELETE RESTRICT` test with a test-only referencing table. PRD 03's adapter must add a foreign key from movements to categories with `ON DELETE RESTRICT`.

## Warnings (non-blocking)
- ⚠️ W-VER-01: dead code and unused imports are clean (`eslint` strictTypeChecked, no `TODO`, `any`, `eslint-disable` or `@ts-*` in the new code). The only unused export is the type `CategoryIdParams` in `category.ts`.
- ⚠️ W-VER-02: low-branch files as in the coverage table above. `categoryLabel`'s fallback for a default key that this build does not know (a newer catalog) is untested.
- ⚠️ W-VER-03: fragile or tautological tests.
  - `category-use-cases.test.ts` "a repository foreign-key violation surfaces as CategoryInUse" has the fake throw `CategoryInUse` itself. The real mapping is covered at repository level.
  - The migration test locates the backfill by its comment `-- backfill default categories`. It fails loudly if the comment changes.
  - The `Ñandú` fold depends on the database collation.
  - The tests report records one `ECONNRESET` flake right after a Docker restart; the identical re-run was green.
  - The shared fixed e2e ports 3000, 4000 and 4100 and the CRLF working tree are environmental.
- ⚠️ Spec drift, all behaviour-neutral:
  - Extra files not in the file lists: `new-user-provisioning-failed.ts`, `category-display.ts`, `category-pickers.tsx`, `categories-load-state.tsx`, `category-field.tsx`, `test/support/category-fixtures.ts`.
  - The threat document says "a single reviewed statement pair" for the backfill; the code is one CTE statement.
  - AGENTS.md "Build" commands still say `@argent/api` and `@argent/web`, but the packages are `@pesly/*`. This drift predates the ticket.
- ⚠️ The origin guard is tested on a state-changing request, not once per method.
- ⚠️ The 0009 `when` (1790902441319) is the latest journal value. The later-merging ticket must re-chain the snapshot and carry the guard trigger, as the spec says.

Result: PASSED
