import type { ProfileResponse } from '@argent/shared';
import { Unauthenticated } from '../domain/errors';
import type { Profile, ProfileRepository } from './ports/profile-repository';

/** What the profile use cases need of `GetTwoFactorStatus` (01c's use case satisfies it). */
export interface TwoFactorStatusReader {
  execute(userId: string): Promise<{ enabled: boolean }>;
}

export interface GetProfileDependencies {
  profiles: ProfileRepository;
  twoFactorStatus: TwoFactorStatusReader;
}

export function profileView(profile: Profile, twoFactorEnabled: boolean): ProfileResponse {
  return {
    displayName: profile.displayName,
    email: profile.email,
    twoFactorEnabled,
    preferences: {
      defaultRateType: profile.defaultRateType,
      displayCurrency: profile.displayCurrency,
      timeZone: profile.timeZone,
      language: profile.language,
    },
  };
}

export class GetProfile {
  constructor(private readonly deps: GetProfileDependencies) {}

  async execute(userId: string): Promise<ProfileResponse> {
    const profile = await this.deps.profiles.findByUserId(userId);
    if (!profile) throw new Unauthenticated();
    const { enabled } = await this.deps.twoFactorStatus.execute(userId);
    return profileView(profile, enabled);
  }
}
