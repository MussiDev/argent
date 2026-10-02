import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'EMAIL_NOT_VERIFIED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_BREACHED',
  'PASSWORD_CHECK_UNAVAILABLE',
  'TOKEN_INVALID',
  'INVALID_CREDENTIALS',
  'TOTP_INVALID',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_NOT_ENABLED',
  'TWO_FACTOR_SETUP_REQUIRED',
  'TWO_FACTOR_UNAVAILABLE',
  'SECOND_FACTOR_INVALID',
  'SECOND_FACTOR_EXPIRED',
  'ACCOUNT_NAME_TAKEN',
  'ACCOUNT_HAS_MOVEMENTS',
  'CATEGORY_NAME_TAKEN',
  'CATEGORY_IN_USE',
  'CATEGORY_NESTING_TOO_DEEP',
  'CATEGORY_PARENT_KIND_MISMATCH',
  'REAUTHENTICATION_REQUIRED',
  'ACCOUNT_ARCHIVED',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Body of every API error response. `fields` lists failing input paths, never their values. */
export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  fields: z.array(z.string()).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Base class for typed application and domain errors. The API error handler maps `code` to an
 * HTTP status; the web client maps it to a message key.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Failing input paths (`<part>.<path>`), never values; the error handler echoes them. */
  readonly fields: readonly string[] | undefined;

  constructor(code: ErrorCode, message: string = code, fields?: string[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.fields = fields;
  }
}
