import { z } from 'zod';
import { LANGUAGE_INPUT_MAX_LENGTH, TIME_ZONE_INPUT_MAX_LENGTH } from './register';

/** Google's parameters are far shorter; anything longer is not a Google redirect. */
export const GOOGLE_CALLBACK_VALUE_MAX_LENGTH = 2048;
export const GOOGLE_CALLBACK_MAX_REPEATS = 5;

/** The only error the API reports to the web app after a Google sign-in (`?error=`). */
export const GOOGLE_SIGN_IN_ERRORS = ['google_failed'] as const;
export type GoogleSignInError = (typeof GOOGLE_SIGN_IN_ERRORS)[number];

/** An empty query value (`?hd=`) means the same as an absent one. */
function emptyAsMissing<T>(value: T | ''): T | undefined {
  return value === '' ? undefined : value;
}

/**
 * `GET /auth/google/start`, reached by top-level navigation from the web app. Same bounds as
 * registration; the API resolves unknown values to the defaults.
 */
export const googleStartQuerySchema = z.object({
  timeZone: z.string().max(TIME_ZONE_INPUT_MAX_LENGTH).optional().transform(emptyAsMissing),
  language: z.string().max(LANGUAGE_INPUT_MAX_LENGTH).optional().transform(emptyAsMissing),
});

export type GoogleStartQuery = z.infer<typeof googleStartQuerySchema>;

/**
 * A repeated parameter is kept as an array so the API can refuse it as a failed sign-in, not as a
 * 400: the redirect comes from Google and the user must land back on the sign-in screen.
 */
const callbackValueSchema = z
  .union([
    z.string().max(GOOGLE_CALLBACK_VALUE_MAX_LENGTH),
    z.array(z.string().max(GOOGLE_CALLBACK_VALUE_MAX_LENGTH)).max(GOOGLE_CALLBACK_MAX_REPEATS),
  ])
  .optional()
  .transform(emptyAsMissing);

/** `GET /auth/google/callback`: Google's redirect. Unknown parameters are stripped. */
export const googleCallbackQuerySchema = z.object({
  code: callbackValueSchema,
  state: callbackValueSchema,
  error: callbackValueSchema,
  error_description: callbackValueSchema,
  scope: callbackValueSchema,
  authuser: callbackValueSchema,
  prompt: callbackValueSchema,
  hd: callbackValueSchema,
  iss: callbackValueSchema,
});

export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;
