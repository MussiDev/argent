import { z } from 'zod';

/** `POST /auth/verification/resend`: the user comes from the session, so the body is empty. */
export const resendVerificationRequestSchema = z.object({});

export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

export const resendVerificationResponseSchema = z.object({
  status: z.literal('verification_sent'),
});

export type ResendVerificationResponse = z.infer<typeof resendVerificationResponseSchema>;
