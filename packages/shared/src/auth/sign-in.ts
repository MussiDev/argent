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

/** Signed in: the session itself travels in HttpOnly cookies, never in the body. */
export const signedInResponseSchema = z.object({
  status: z.literal('signed_in'),
  user: signedInUserSchema,
});

export type SignedInResponse = z.infer<typeof signedInResponseSchema>;

/**
 * The first factor passed for a user with 2FA (PRD 01c FR-04): no session yet, only the challenge
 * cookie. Says nothing about the user.
 */
export const secondFactorRequiredResponseSchema = z.object({
  status: z.literal('second_factor_required'),
});

/** `POST /auth/sign-in`: signed in, or waiting for the second factor. */
export const signInResponseSchema = z.discriminatedUnion('status', [
  signedInResponseSchema,
  secondFactorRequiredResponseSchema,
]);

export type SignInResponse = z.infer<typeof signInResponseSchema>;

/**
 * The errors the API reports to the sign-in screen through `?error=`: a failed Google sign-in, or a
 * second step whose challenge expired or was used up.
 */
export const SIGN_IN_ERRORS = ['google_failed', 'second_factor_expired'] as const;
export type SignInError = (typeof SIGN_IN_ERRORS)[number];
