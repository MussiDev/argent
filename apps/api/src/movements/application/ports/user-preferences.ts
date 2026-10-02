import type { RateType } from '@pesly/shared';

export interface UserPreferenceValues {
  timeZone: string;
  defaultRateType: RateType;
}

export interface UserPreferences {
  find(userId: string): Promise<UserPreferenceValues>;
}
