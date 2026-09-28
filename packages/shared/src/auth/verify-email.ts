import { z } from 'zod';
import { oneTimeTokenSchema } from './credentials';

/** `POST /auth/verify-email`. The token travels in the body, never in the URL path. */
export const verifyEmailRequestSchema = z.object({ token: oneTimeTokenSchema });

export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const verifyEmailResponseSchema = z.object({ status: z.literal('verified') });

export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;
