import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import type { TwoFactorRepository } from './ports/two-factor-repository';

export interface GetTwoFactorStatusDependencies {
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
}

export interface TwoFactorStatus {
  enabled: boolean;
  /** How many recovery codes are left; the codes themselves are never shown again (AC-02). */
  recoveryCodesRemaining: number;
}

export class GetTwoFactorStatus {
  constructor(private readonly deps: GetTwoFactorStatusDependencies) {}

  async execute(userId: string): Promise<TwoFactorStatus> {
    const settings = await this.deps.twoFactor.findByUserId(userId);
    // A pending setup is not enabled, and has no recovery codes yet.
    if (!settings?.enabledAt) return { enabled: false, recoveryCodesRemaining: 0 };
    return {
      enabled: true,
      recoveryCodesRemaining: await this.deps.recoveryCodes.countUnused(userId),
    };
  }
}
