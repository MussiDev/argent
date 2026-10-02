import { eq, sql } from 'drizzle-orm';
import type {
  Profile,
  ProfileChanges,
  ProfileRepository,
} from '../../application/ports/profile-repository';
import { users, type IdentityDb } from './schema';

/** Never includes `passwordHash` or any other credential column. */
const PROFILE_COLUMNS = {
  userId: users.id,
  email: users.email,
  displayName: users.displayName,
  // Only whether a hash exists: the hash never leaves the repository.
  hasPassword: sql<boolean>`${users.passwordHash} is not null`,
  defaultRateType: users.defaultRateType,
  displayCurrency: users.displayCurrency,
  timeZone: users.timeZone,
  language: users.language,
};

export class DrizzleProfileRepository implements ProfileRepository {
  constructor(private readonly db: IdentityDb) {}

  async findByUserId(userId: string): Promise<Profile | null> {
    const [profile] = await this.db
      .select(PROFILE_COLUMNS)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return profile ?? null;
  }

  async update(userId: string, changes: ProfileChanges): Promise<Profile | null> {
    // drizzle skips undefined values but rejects a statement with nothing to set.
    if (Object.values(changes).every((value) => value === undefined)) {
      return this.findByUserId(userId);
    }
    const [updated] = await this.db
      .update(users)
      .set(changes)
      .where(eq(users.id, userId))
      .returning(PROFILE_COLUMNS);
    return updated ?? null;
  }
}
