import type { ProfileResponse, UpdateProfileRequest } from '@pesly/shared';
import { Email } from '../domain/email';
import { EmailChangeNotAllowed, InvalidEmail, Unauthenticated } from '../domain/errors';
import { profileView, type GetProfileDependencies } from './get-profile';
import type { ProfileChanges } from './ports/profile-repository';

export type UpdateProfileDependencies = GetProfileDependencies;

export class UpdateProfile {
  constructor(private readonly deps: UpdateProfileDependencies) {}

  async execute(userId: string, input: UpdateProfileRequest): Promise<ProfileResponse> {
    const { profiles, twoFactorStatus } = this.deps;
    if (input.email !== undefined) await this.assertSameEmail(userId, input.email);

    const changes: ProfileChanges = {};
    if (input.displayName !== undefined) changes.displayName = input.displayName;
    if (input.defaultRateType !== undefined) changes.defaultRateType = input.defaultRateType;
    if (input.displayCurrency !== undefined) changes.displayCurrency = input.displayCurrency;
    if (input.timeZone !== undefined) changes.timeZone = input.timeZone;
    if (input.language !== undefined) changes.language = input.language;

    // The request schema requires a changeable field, but an empty `UPDATE … SET` is invalid SQL.
    const profile =
      Object.keys(changes).length > 0
        ? await profiles.update(userId, changes)
        : await profiles.findByUserId(userId);
    if (!profile) throw new Unauthenticated();
    const { enabled } = await twoFactorStatus.execute(userId);
    return profileView(profile, enabled);
  }

  /** The email is shown, never changed here: an equal one is a no-op, anything else is refused. */
  private async assertSameEmail(userId: string, submitted: string): Promise<void> {
    const current = await this.deps.profiles.findByUserId(userId);
    if (!current) throw new Unauthenticated();
    try {
      if (Email.parse(submitted).value === current.email) return;
    } catch (error) {
      if (!(error instanceof InvalidEmail)) throw error;
    }
    throw new EmailChangeNotAllowed();
  }
}
