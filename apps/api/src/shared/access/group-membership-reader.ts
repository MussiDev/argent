/**
 * Port: the groups a user belongs to, so an `AccessPolicy` can widen read scopes to rows shared
 * through them. The groups module (PRD 05) provides the real adapter; until then the app uses
 * `DenyAllGroupMembershipReader`.
 */
export interface GroupMembershipReader {
  groupIdsOf(userId: string): Promise<string[]>;
}
