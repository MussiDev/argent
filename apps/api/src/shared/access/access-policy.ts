import type { AuthContext } from '../http/auth-context';
import type { GroupMembershipReader } from './group-membership-reader';

/**
 * `read`: the owner or a member of the group the resource is shared through.
 * `write` (update, delete): the owner only, until PRD 05 adds group roles.
 */
export type AccessAction = 'read' | 'write';

/**
 * Not exported as a value: only the policy below can construct one. The ES private field makes
 * the type nominal, so object literals and spread copies (`{ ...scope, userId }`) are compile
 * errors, and `#issued in value` is a run-time check nothing outside this class can fake.
 */
class IssuedScope<A extends AccessAction> {
  readonly #issued = true;
  readonly groupIds: readonly string[];

  constructor(
    readonly userId: string,
    readonly action: A,
    groupIds: readonly string[],
  ) {
    this.groupIds = Object.freeze([...groupIds]);
    Object.freeze(this);
  }

  static isIssued(value: unknown): boolean {
    return typeof value === 'object' && value !== null && #issued in value;
  }
}

/**
 * The rows a user may touch for one action, issued only by an `AccessPolicy` and frozen.
 * Repositories of user data REQUIRE it in their signatures: reads take `AccessScope` (either
 * action), writes take `AccessScope<'write'>` (`findById(scope, id)`, `update(scope, id, …)`,
 * `delete(scope, id)`). They put it in the WHERE clause through `scopedTo`
 * (`shared/access/infrastructure`), so a query that forgets the check does not compile (threat
 * R-18). A row outside the scope is indistinguishable from a missing one: both become 404.
 */
export type AccessScope<A extends AccessAction = AccessAction> = IssuedScope<A>;

/** Fails closed on a scope that did not come from an `AccessPolicy` (e.g. cast or spread copy). */
export function assertIssuedScope(scope: unknown): asserts scope is AccessScope {
  if (!IssuedScope.isIssued(scope)) {
    throw new Error('AccessScope was not issued by an AccessPolicy');
  }
}

/** Port every module uses to obtain the scope of a request (PRD 01 FR-08). */
export interface AccessPolicy {
  scopeFor<A extends AccessAction>(auth: AuthContext, action: A): Promise<AccessScope<A>>;
}

/** FR-08: owner OR group member for reads; owner only for writes (no group roles yet). */
export class OwnerOrGroupMemberAccessPolicy implements AccessPolicy {
  constructor(private readonly groupMembership: GroupMembershipReader) {}

  async scopeFor<A extends AccessAction>(auth: AuthContext, action: A): Promise<AccessScope<A>> {
    const groupIds = action === 'read' ? await this.groupMembership.groupIdsOf(auth.userId) : [];
    return new IssuedScope(auth.userId, action, groupIds);
  }
}
