import type { RateType } from '@argent/shared';
import type { DisplayCurrency, Language } from '../../domain/account-defaults';
import type { Email } from '../../domain/email';

export interface User {
  id: string;
  /** Always lower-cased. */
  email: string;
  /** Null for accounts created through Google that never set a password. */
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  defaultRateType: RateType;
  displayCurrency: DisplayCurrency;
  timeZone: string;
  language: Language;
  createdAt: Date;
  /**
   * Bumped by every password change. A session carries the version it was created with and is
   * rejected once they differ, so a session racing a reset cannot outlive it (AC-10).
   */
  credentialsVersion: number;
  /** When the password was last changed through a reset; null until then. */
  passwordChangedAt: Date | null;
}

export interface NewUser {
  email: Email;
  passwordHash: string | null;
  /** Set when the email is already proven, e.g. verified by Google (PRD 01b FR-03). */
  emailVerifiedAt?: Date;
  defaultRateType: RateType;
  displayCurrency: DisplayCurrency;
  timeZone: string;
  language: Language;
}

export interface UserRepository {
  /** Rejects with `DuplicateEmail` when the email is already registered. */
  create(user: NewUser): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  markEmailVerified(id: string, at: Date): Promise<void>;
  /**
   * Sets the new password hash, bumps `credentialsVersion` and records `passwordChangedAt = at`,
   * in one statement.
   */
  changePassword(id: string, passwordHash: string, at: Date): Promise<void>;
  /**
   * For an account whose email is still unverified: removes the password, bumps
   * `credentialsVersion`, and sets `passwordChangedAt` and `emailVerifiedAt` to `at`, in one
   * statement. Resolves null, changing nothing, when the email is already verified.
   */
  supersedeUnverified(id: string, at: Date): Promise<User | null>;
  /**
   * Bumps `credentialsVersion` in one statement and resolves the new value, so every session
   * created under an earlier version dies on its next use (FR-05). Rejects for an unknown user.
   */
  bumpCredentialsVersion(userId: string): Promise<number>;
}
