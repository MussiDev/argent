import { z } from 'zod';

/** Same bound as the API's domain password rule; counted in Unicode code points (NIST SP 800-63B). */
export const PASSWORD_MAX_CODE_POINTS = 128;
/**
 * Raw UTF-16 cap checked before counting code points, so an oversized string is rejected without
 * iterating it (DoS guard). A code point takes at most 2 UTF-16 units, so 128 always fit.
 */
export const PASSWORD_MAX_UTF16_LENGTH = 512;

export const EMAIL_INPUT_MAX_LENGTH = 254;

/**
 * A submitted password. The minimum length is not checked here: the API's domain rule rejects it
 * with the specific `PASSWORD_TOO_SHORT` code instead of `VALIDATION_FAILED`.
 */
export const passwordSchema = z
  .string()
  .min(1)
  .max(PASSWORD_MAX_UTF16_LENGTH)
  .refine((password) => Array.from(password).length <= PASSWORD_MAX_CODE_POINTS, {
    message: `must be at most ${PASSWORD_MAX_CODE_POINTS} characters`,
  });

/** The format check is the API's Email value object; this only bounds the input. */
export const emailInputSchema = z.string().trim().min(1).max(EMAIL_INPUT_MAX_LENGTH);

/** Verification and reset tokens: 256 random bits, base64url without padding. */
export const oneTimeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
