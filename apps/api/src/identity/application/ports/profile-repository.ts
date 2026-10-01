import type { RateType } from '@argent/shared';
import type { DisplayCurrency, Language } from '../../domain/account-defaults';

export interface Profile {
  userId: string;
  /** Always lower-cased. */
  email: string;
  displayName: string | null;
  defaultRateType: RateType;
  displayCurrency: DisplayCurrency;
  timeZone: string;
  language: Language;
}

/** The profile fields a user may change; fields left out are untouched. */
export interface ProfileChanges {
  displayName?: string;
  defaultRateType?: RateType;
  displayCurrency?: DisplayCurrency;
  timeZone?: string;
  language?: Language;
}

export interface ProfileRepository {
  /** Resolves null for an unknown user. The password hash never leaves the repository. */
  findByUserId(userId: string): Promise<Profile | null>;
  /**
   * Applies `changes` in one statement and resolves the updated profile; resolves null, writing
   * nothing, when no user has that id.
   */
  update(userId: string, changes: ProfileChanges): Promise<Profile | null>;
}
