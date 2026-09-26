import type { RateType } from '@argent/shared';
import type { DisplayCurrency, Language } from '../../domain/account-defaults';
import type { Email } from '../../domain/email';

export interface User {
  id: string;
  /** Always lower-cased. */
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  defaultRateType: RateType;
  displayCurrency: DisplayCurrency;
  timeZone: string;
  language: Language;
  createdAt: Date;
}

export interface NewUser {
  email: Email;
  passwordHash: string;
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
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}
