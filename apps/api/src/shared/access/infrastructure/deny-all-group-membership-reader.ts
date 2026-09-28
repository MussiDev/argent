import type { GroupMembershipReader } from '../group-membership-reader';

/** Default adapter until groups exist (PRD 05): nobody belongs to a group, so only owners see rows. */
export class DenyAllGroupMembershipReader implements GroupMembershipReader {
  readonly groupIdsOf: GroupMembershipReader['groupIdsOf'] = () => Promise.resolve([]);
}
