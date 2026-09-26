import { newAccountDefaults, type Language } from '../domain/account-defaults';
import { Email } from '../domain/email';
import { DuplicateEmail, RateLimited } from '../domain/errors';
import { assertPasswordAcceptable } from './password-policy';
import type { AttemptLimiter, AttemptPolicy } from './ports/attempt-limiter';
import type { BreachedPasswordChecker } from './ports/breached-password-checker';
import type { EmailSender } from './ports/email-sender';
import type { PasswordHasher } from './ports/password-hasher';
import type { UnitOfWork } from './ports/unit-of-work';
import type { UserRepository } from './ports/user-repository';

/** NFR-03 / threat R-03: 5 registrations per IP per hour. */
export const REGISTER_IP_POLICY: AttemptPolicy = {
  kind: 'register_ip',
  limit: 5,
  windowSeconds: 60 * 60,
};

/** Rate-limit key when the client address is unknown; such requests share one bucket. */
export const UNKNOWN_IP = 'unknown';

export interface RegisterUserDependencies {
  attemptLimiter: AttemptLimiter;
  breachedPasswordChecker: BreachedPasswordChecker;
  passwordHasher: PasswordHasher;
  /** A real hash of an unknown password, verified for existing emails so both paths cost the same. */
  dummyPasswordHash: string;
  users: UserRepository;
  emailSender: EmailSender;
  unitOfWork: UnitOfWork;
}

export interface RegisterUserInput {
  email: string;
  password: string;
  timeZone?: string | undefined;
  language?: string | undefined;
  ip: string | undefined;
}

/** For logging only: the HTTP response is the same for both outcomes (anti-enumeration, R-02). */
export type RegisterUserResult = { outcome: 'created'; userId: string } | { outcome: 'existing' };

export class RegisterUser {
  constructor(private readonly deps: RegisterUserDependencies) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = Email.parse(input.email);

    // Recorded before anything else, and before any Argon2id work (R-04), so new and existing
    // emails count the same and concurrent requests cannot slip past a read-then-write check.
    const attempt = await this.deps.attemptLimiter.record(
      REGISTER_IP_POLICY,
      input.ip ?? UNKNOWN_IP,
    );
    if (!attempt.allowed) throw new RateLimited();

    // Applied to existing emails too: a weak password must get the same answer either way.
    await assertPasswordAcceptable(input.password, this.deps.breachedPasswordChecker);

    const defaults = newAccountDefaults({ timeZone: input.timeZone, language: input.language });

    if (await this.deps.users.findByEmail(email)) {
      await this.deps.passwordHasher.verify(this.deps.dummyPasswordHash, input.password);
      await this.enqueueDiscard(defaults.language);
      return { outcome: 'existing' };
    }

    const passwordHash = await this.deps.passwordHasher.hash(input.password);
    try {
      const userId = await this.deps.unitOfWork.run(async ({ users, emailSender }) => {
        const user = await users.create({ email, passwordHash, ...defaults });
        await emailSender.enqueue({
          kind: 'verification',
          userId: user.id,
          toEmail: user.email,
          language: user.language,
        });
        return user.id;
      });
      return { outcome: 'created', userId };
    } catch (error) {
      // Another request registered the same email in between: answer as for an existing email.
      if (!(error instanceof DuplicateEmail)) throw error;
      await this.enqueueDiscard(defaults.language);
      return { outcome: 'existing' };
    }
  }

  private enqueueDiscard(language: Language): Promise<void> {
    return this.deps.emailSender.enqueue({
      kind: 'discard',
      userId: null,
      toEmail: null,
      language,
    });
  }
}
