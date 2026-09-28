import { z } from 'zod';
import { emailInputSchema, oneTimeTokenSchema, passwordSchema } from './credentials';

/** `POST /auth/password-reset/request`. */
export const passwordResetRequestSchema = z.object({ email: emailInputSchema });

export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/** Identical for registered and unknown emails (anti-enumeration). */
export const passwordResetResponseSchema = z.object({
  status: z.literal('reset_sent_if_registered'),
});

export type PasswordResetResponse = z.infer<typeof passwordResetResponseSchema>;

/**
 * `POST /auth/password-reset/confirm`. The token travels in the body, never in the URL path. The
 * minimum password length is left to the API's domain rule (`PASSWORD_TOO_SHORT`).
 */
export const passwordResetConfirmRequestSchema = z.object({
  token: oneTimeTokenSchema,
  newPassword: passwordSchema,
});

export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>;

export const passwordResetConfirmResponseSchema = z.object({
  status: z.literal('password_updated'),
});

export type PasswordResetConfirmResponse = z.infer<typeof passwordResetConfirmResponseSchema>;
