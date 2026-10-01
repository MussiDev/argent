import {
  TotpInvalid,
  TwoFactorAlreadyEnabled,
  TwoFactorSetupRequired,
  Unauthenticated,
} from '../domain/errors';
import { RECOVERY_CODE_COUNT } from '@argent/shared';
import { normalizeRecoveryCode } from '../domain/recovery-code';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeGenerator } from './ports/recovery-code-generator';
import type { SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository } from './ports/two-factor-repository';
import type { UnitOfWork } from './ports/unit-of-work';
import type { UserRepository } from './ports/user-repository';
import { openTotpSecret } from './second-factor-limits';
import type { SessionTokens, StartSession } from './start-session';

export interface EnableTwoFactorDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
  recoveryCodeGenerator: RecoveryCodeGenerator;
  /** Argon2id: recovery codes are stored only as its hashes (NFR-02). */
  passwordHasher: PasswordHasher;
  unitOfWork: UnitOfWork;
  startSession: StartSession;
  clock: Clock;
  /**
   * Told when the caller's new session could not be started after 2FA was enabled. The answer is
   * unchanged: the codes are returned, without a session. Must not log secrets.
   */
  reportReissueFailure: (error: unknown) => void;
}

export interface EnableTwoFactorInput {
  userId: string;
  code: string;
}

export interface EnableTwoFactorResult {
  /** The recovery codes in display form; returned this once and never again (AC-02). */
  recoveryCodes: string[];
  /** The caller's new session, or null when it could not be started (the user signs in again). */
  session: SessionTokens | null;
}

/**
 * Confirms the pending secret with one valid code and turns 2FA on (AC-01): issues the recovery
 * codes (FR-03), ends every session of the user and emails a notice (FR-05, AC-07), and starts a
 * new session for the caller.
 */
export class EnableTwoFactor {
  constructor(private readonly deps: EnableTwoFactorDependencies) {}

  async execute({ userId, code }: EnableTwoFactorInput): Promise<EnableTwoFactorResult> {
    const settings = await this.deps.twoFactor.findByUserId(userId);
    if (!settings) throw new TwoFactorSetupRequired();
    if (settings.enabledAt) throw new TwoFactorAlreadyEnabled();
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();

    const now = this.deps.clock.now();
    const secret = openTotpSecret(this.deps.secretBox, settings);
    const step = this.deps.totp.verify(secret, code, now);
    // `activate` does not record the step, so it is recorded here: the code cannot be replayed.
    if (step === null || !(await this.deps.twoFactor.advanceLastUsedStep(userId, step))) {
      throw new TotpInvalid();
    }

    // Argon2id runs before the transaction opens, so no connection is held while hashing, and one
    // hash at a time, so memory stays bounded (threat R-45).
    const recoveryCodes = this.deps.recoveryCodeGenerator.generate(RECOVERY_CODE_COUNT);
    const hashes: string[] = [];
    for (const recoveryCode of recoveryCodes) {
      const stored = normalizeRecoveryCode(recoveryCode);
      // A generated code always normalizes; anything else is a bug, never a code to store.
      if (stored === null) throw new Error('generated recovery code does not normalize');
      hashes.push(await this.deps.passwordHasher.hash(stored));
    }

    const credentialsVersion = await this.deps.unitOfWork.run(
      async ({ twoFactor, recoveryCodes: storedCodes, users, sessions, emailSender }) => {
        // Only the exact secret the code was verified against: a setup that replaced it meanwhile
        // makes this fail and roll back (threat R-52).
        if (!(await twoFactor.activate(userId, settings.secretSealed, now))) {
          throw new TwoFactorSetupRequired();
        }
        await storedCodes.replaceAll(userId, hashes);
        // Every session created under the old version dies on its next use, including one that a
        // racing sign-in or refresh commits after this revocation (AC-07, threat R-46).
        const version = await users.bumpCredentialsVersion(userId);
        await sessions.revokeAllForUser(userId, now);
        await emailSender.enqueue({
          kind: 'two_factor_enabled',
          userId,
          toEmail: user.email,
          language: user.language,
        });
        return version;
      },
    );

    // 2FA is on: the codes must reach the user even if the new session cannot be started.
    let session: SessionTokens | null = null;
    try {
      session = await this.deps.startSession.execute({ id: userId, credentialsVersion });
    } catch (error) {
      this.deps.reportReissueFailure(error);
    }
    return { recoveryCodes, session };
  }
}
