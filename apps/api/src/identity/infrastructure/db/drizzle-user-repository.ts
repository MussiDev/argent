import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NewUser, User, UserRepository } from '../../application/ports/user-repository';
import type { Email } from '../../domain/email';
import { DuplicateEmail } from '../../domain/errors';
import { users, type IdentityDb } from './schema';
import { violatedUniqueConstraint } from './unique-violation';

const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: IdentityDb) {}

  async create(user: NewUser): Promise<User> {
    try {
      const [created] = await this.db
        .insert(users)
        .values({
          email: user.email.value,
          passwordHash: user.passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? null,
          displayName: user.displayName ?? null,
          defaultRateType: user.defaultRateType,
          displayCurrency: user.displayCurrency,
          timeZone: user.timeZone,
          language: user.language,
        })
        .returning();
      if (!created) throw new Error('Insert into users returned no row');
      return created;
    } catch (error) {
      if (violatedUniqueConstraint(error) === EMAIL_UNIQUE_CONSTRAINT)
        throw new DuplicateEmail({ cause: error });
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.value)).limit(1);
    return user ?? null;
  }

  async markEmailVerified(id: string, at: Date): Promise<void> {
    await this.db.update(users).set({ emailVerifiedAt: at }).where(eq(users.id, id));
  }

  async changePassword(id: string, passwordHash: string, at: Date): Promise<void> {
    await this.db
      .update(users)
      .set({
        passwordHash,
        credentialsVersion: sql`${users.credentialsVersion} + 1`,
        passwordChangedAt: at,
      })
      .where(eq(users.id, id));
  }

  /**
   * `email_verified_at is null` is re-evaluated after waiting for a concurrent writer's row lock,
   * so an account verified meanwhile is left alone.
   */
  async supersedeUnverified(id: string, at: Date): Promise<User | null> {
    const [superseded] = await this.db
      .update(users)
      .set({
        passwordHash: null,
        credentialsVersion: sql`${users.credentialsVersion} + 1`,
        passwordChangedAt: at,
        emailVerifiedAt: at,
      })
      .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)))
      .returning();
    return superseded ?? null;
  }

  async bumpCredentialsVersion(userId: string): Promise<number> {
    const [bumped] = await this.db
      .update(users)
      .set({ credentialsVersion: sql`${users.credentialsVersion} + 1` })
      .where(eq(users.id, userId))
      .returning({ credentialsVersion: users.credentialsVersion });
    if (!bumped) throw new Error('User not found while bumping its credentials version');
    return bumped.credentialsVersion;
  }
}
