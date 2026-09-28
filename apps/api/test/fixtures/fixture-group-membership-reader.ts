import { eq } from 'drizzle-orm';
import type { GroupMembershipReader } from '../../src/shared/access';
import type { Database } from '../../src/shared/db/client';
import { testFixtureGroupMembers } from './fixture-resource-repository';

/** Test adapter: membership comes from `test_fixture_group_members` (see fixture-schema.sql). */
export class FixtureGroupMembershipReader implements GroupMembershipReader {
  constructor(private readonly db: Database) {}

  async groupIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ groupId: testFixtureGroupMembers.groupId })
      .from(testFixtureGroupMembers)
      .where(eq(testFixtureGroupMembers.userId, userId));
    return rows.map((row) => row.groupId);
  }
}
