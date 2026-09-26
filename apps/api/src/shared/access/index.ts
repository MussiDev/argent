/**
 * Access control for user data (PRD 01 FR-07, FR-08): the port, the policy, the scope types and
 * the errors. Adapters (the Drizzle `scopedTo` predicate, the default membership reader) live in
 * `./infrastructure/` and only infrastructure code imports them.
 *
 * Route: `requireSession` then `requireVerifiedEmail` (`shared/http`), then
 * `const scope = await policy.scopeFor(auth, 'read' | 'write')`. Repository: every method takes the
 * scope first (writes require `AccessScope<'write'>`) and filters with `scopedTo` in the same
 * statement. Handler: `notFoundUnlessAllowed` turns an empty result into 404. See
 * `test/fixtures/fixture-resource-*.ts` for the template.
 *
 * Every scoped table needs btree indexes on its owner and group columns (list queries filter on
 * them).
 */
export * from './access-policy';
export * from './group-membership-reader';
export * from './not-found-unless-allowed';
