import { z } from 'zod';
import { emailInputSchema } from '../auth/credentials';
import { LANGUAGE_VALUES } from '../auth/sign-in';
import { rateTypeSchema } from '../rate-types';
import { ianaTimeZoneSchema } from './time-zone';

export const DISPLAY_NAME_MAX_CODE_POINTS = 50;
/**
 * Raw UTF-16 cap checked before counting code points, so an oversized string is not iterated.
 * A code point takes at most 2 UTF-16 units, so 50 code points fit in 100; 200 is a generous guard.
 */
const DISPLAY_NAME_MAX_UTF16_LENGTH = 200;

export const DISPLAY_CURRENCY_VALUES = ['ARS', 'USD'] as const;

export const displayNameSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_UTF16_LENGTH)
  .refine((value) => !value.includes('\u0000'), { message: 'must not contain a NUL character' })
  .refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= 1 && length <= DISPLAY_NAME_MAX_CODE_POINTS;
    },
    { message: `must be between 1 and ${DISPLAY_NAME_MAX_CODE_POINTS} characters` },
  );

export const updateProfileRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    // Only so the API can reject a different address (FR-03); it is never applied.
    email: emailInputSchema.optional(),
    defaultRateType: rateTypeSchema.optional(),
    displayCurrency: z.enum(DISPLAY_CURRENCY_VALUES).optional(),
    timeZone: ianaTimeZoneSchema.optional(),
    language: z.enum(LANGUAGE_VALUES).optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.defaultRateType !== undefined ||
      value.displayCurrency !== undefined ||
      value.timeZone !== undefined ||
      value.language !== undefined,
    { message: 'at least one changeable field is required' },
  );

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const profileResponseSchema = z.object({
  displayName: z.string().nullable(),
  email: z.string(),
  twoFactorEnabled: z.boolean(),
  preferences: z.object({
    defaultRateType: rateTypeSchema,
    displayCurrency: z.enum(DISPLAY_CURRENCY_VALUES),
    // Plain string: registration can have stored a zone the strict request check would refuse,
    // and reading the profile must not fail for that user.
    timeZone: z.string(),
    language: z.enum(LANGUAGE_VALUES),
  }),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
