import { eq } from 'drizzle-orm';
import type { NewUser, User, UserRepository } from '../../application/ports/user-repository';
import type { Email } from '../../domain/email';
import { DuplicateEmail } from '../../domain/errors';
import { users, type IdentityDb } from './schema';

const UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';
const MAX_CAUSE_DEPTH = 5;

/** Drizzle wraps driver errors (DrizzleQueryError), so the pg error may sit in the cause chain. */
function isDuplicateEmailViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (
      Reflect.get(current, 'code') === UNIQUE_VIOLATION &&
      Reflect.get(current, 'constraint') === EMAIL_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: IdentityDb) {}

  async create(user: NewUser): Promise<User> {
    try {
      const [created] = await this.db
        .insert(users)
        .values({
          email: user.email.value,
          passwordHash: user.passwordHash,
          defaultRateType: user.defaultRateType,
          displayCurrency: user.displayCurrency,
          timeZone: user.timeZone,
          language: user.language,
        })
        .returning();
      if (!created) throw new Error('Insert into users returned no row');
      return created;
    } catch (error) {
      if (isDuplicateEmailViolation(error)) throw new DuplicateEmail({ cause: error });
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

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }
}
