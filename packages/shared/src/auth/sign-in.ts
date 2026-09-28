import { z } from 'zod';
import { emailInputSchema, passwordSchema } from './credentials';

export const LANGUAGE_VALUES = ['es', 'en'] as const;

/**
 * `POST /auth/sign-in`. Length rules are not re-applied here: any 1-128 character password is
 * checked against the stored hash.
 */
export const signInRequestSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
});

export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const signedInUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  language: z.enum(LANGUAGE_VALUES),
});

/** The session itself travels in HttpOnly cookies, never in the body. */
export const signInResponseSchema = z.object({ user: signedInUserSchema });

export type SignInResponse = z.infer<typeof signInResponseSchema>;
