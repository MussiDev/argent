import { isIanaTimeZone } from '@pesly/shared';
import { eq } from 'drizzle-orm';
import type {
  UserPreferences,
  UserPreferenceValues,
} from '../../application/ports/user-preferences';
import type { Database } from '../../../shared/db/client';
import { users } from './foreign-relations';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class DrizzleUserPreferences implements UserPreferences {
  constructor(private readonly db: Database) {}

  /** The caller's own row by primary key. A missing user fails closed: no defaults are guessed. */
  async find(userId: string): Promise<UserPreferenceValues> {
    const [row] = await this.db
      .select({ timeZone: users.timeZone, defaultRateType: users.defaultRateType })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new Error('User preferences requested for a user that does not exist');
    return {
      timeZone: isIanaTimeZone(row.timeZone) ? row.timeZone : DEFAULT_TIME_ZONE,
      defaultRateType: row.defaultRateType,
    };
  }
}
