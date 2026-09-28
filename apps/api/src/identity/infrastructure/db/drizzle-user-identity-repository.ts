import { and, eq } from 'drizzle-orm';
import type {
  IdentityProvider,
  NewUserIdentity,
  UserIdentityRepository,
} from '../../application/ports/user-identity-repository';
import { IdentityAlreadyLinked } from '../../domain/errors';
import {
  USER_IDENTITIES_PROVIDER_SUBJECT_UNIQUE,
  USER_IDENTITIES_USER_ID_PROVIDER_UNIQUE,
  userIdentities,
  type IdentityDb,
} from './schema';
import { violatedUniqueConstraint } from './unique-violation';

const LINK_CONSTRAINTS: readonly (string | undefined)[] = [
  USER_IDENTITIES_PROVIDER_SUBJECT_UNIQUE,
  USER_IDENTITIES_USER_ID_PROVIDER_UNIQUE,
];

export class DrizzleUserIdentityRepository implements UserIdentityRepository {
  constructor(private readonly db: IdentityDb) {}

  async findUserIdByProviderSubject(
    provider: IdentityProvider,
    subject: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)))
      .limit(1);
    return row?.userId ?? null;
  }

  async link(identity: NewUserIdentity): Promise<void> {
    try {
      await this.db.insert(userIdentities).values(identity);
    } catch (error) {
      if (LINK_CONSTRAINTS.includes(violatedUniqueConstraint(error))) {
        throw new IdentityAlreadyLinked({ cause: error });
      }
      throw error;
    }
  }

  async deleteNonAuthoritativeForUser(userId: string): Promise<void> {
    await this.db
      .delete(userIdentities)
      .where(and(eq(userIdentities.userId, userId), eq(userIdentities.emailAuthoritative, false)));
  }
}
