/** A user's TOTP settings; the secret is stored only sealed (threat R-42). */
export interface TwoFactorSettings {
  userId: string;
  secretSealed: string;
  /** Null while the setup is pending confirmation. */
  enabledAt: Date | null;
  /** The last time step accepted; a code is accepted only for a later one (NFR-03, R-41). */
  lastUsedStep: number;
  createdAt: Date;
}

export interface TwoFactorRepository {
  findByUserId(userId: string): Promise<TwoFactorSettings | null>;
  /**
   * Stores `sealed` as the user's pending secret, replacing a previous pending one. Resolves false,
   * changing nothing, when 2FA is already enabled.
   */
  savePending(userId: string, sealed: string): Promise<boolean>;
  /**
   * Enables 2FA only while it is still pending with exactly `sealed`, so a setup that replaced the
   * secret meanwhile makes it resolve false (threat R-52).
   */
  activate(userId: string, sealed: string, at: Date): Promise<boolean>;
  /** Records `step` as used only when it is later than the last one; atomic (threat R-41). */
  advanceLastUsedStep(userId: string, step: number): Promise<boolean>;
  delete(userId: string): Promise<void>;
}
