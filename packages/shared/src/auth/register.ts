import { z } from 'zod';
import { displayNameSchema } from '../profile/profile';
import { emailInputSchema, passwordSchema } from './credentials';

export const TIME_ZONE_INPUT_MAX_LENGTH = 64;
export const LANGUAGE_INPUT_MAX_LENGTH = 35;

/** `POST /auth/register`. Time zone and language come from the device; the API resolves them. */
export const registerRequestSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  timeZone: z.string().max(TIME_ZONE_INPUT_MAX_LENGTH).optional(),
  language: z.string().max(LANGUAGE_INPUT_MAX_LENGTH).optional(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Identical for new and already registered emails (anti-enumeration). */
export const registerResponseSchema = z.object({ status: z.literal('verification_sent') });

export type RegisterResponse = z.infer<typeof registerResponseSchema>;
