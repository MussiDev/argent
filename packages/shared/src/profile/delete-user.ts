import { z } from 'zod';
import { passwordSchema } from '../auth/credentials';
import { secondFactorCodeSchema } from '../auth/two-factor';

/**
 * `DELETE /users/me`: the re-authentication proof. Which field is needed depends on the account
 * (password, second factor, or neither for a Google-only one), so both are optional here and the use
 * case decides.
 */
export const deleteUserRequestSchema = z.object({
  password: passwordSchema.optional(),
  secondFactorCode: secondFactorCodeSchema.optional(),
});

export type DeleteUserRequest = z.infer<typeof deleteUserRequestSchema>;

/** `POST /users/me/deletion-reauth`: where to send the user to confirm with Google. */
export const startDeletionReauthResponseSchema = z.object({
  authorizationUrl: z.string(),
});

export type StartDeletionReauthResponse = z.infer<typeof startDeletionReauthResponseSchema>;
