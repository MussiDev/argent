import { TwoFactorAlreadyEnabled, Unauthenticated } from '../domain/errors';
import type { SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository } from './ports/two-factor-repository';
import type { UserRepository } from './ports/user-repository';
import { sealTotpSecret } from './second-factor-limits';

export interface StartTwoFactorSetupDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
}

export interface TwoFactorSetup {
  /** What the authenticator app reads from the QR code. */
  otpauthUri: string;
  /** The same secret in base32, for manual entry. */
  secret: string;
}

/**
 * Starts (or restarts) enrollment: a fresh secret, stored sealed with the user id as associated
 * data (threat R-42) and pending until a code confirms it (FR-01).
 */
export class StartTwoFactorSetup {
  constructor(private readonly deps: StartTwoFactorSetupDependencies) {}

  async execute(userId: string): Promise<TwoFactorSetup> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();
    const secret = this.deps.totp.generateSecret();
    const sealed = sealTotpSecret(this.deps.secretBox, secret, userId);
    // Never replaces an enabled secret, even when racing an enable (threat R-52).
    if (!(await this.deps.twoFactor.savePending(userId, sealed))) {
      throw new TwoFactorAlreadyEnabled();
    }
    return { otpauthUri: this.deps.totp.otpauthUri(secret, user.email), secret };
  }
}
