import { z } from 'zod';

/** Recovery codes issued when 2FA is enabled (PRD 01c FR-03). */
export const RECOVERY_CODE_COUNT = 10;

const TOTP_CODE = /^[0-9]{6}$/;
/** Crockford base32 plus `I`, `L` and `O` (read as `1`, `1` and `0`), in either case: no `U`. */
const RECOVERY_CHARACTERS = /^[0-9A-TV-Za-tv-z ]*-?[0-9A-TV-Za-tv-z ]*$/;
const RECOVERY_CODE_LENGTH = 10;
/** A recovery code as typed: 10 characters, with spaces and one dash allowed around them. */
const RECOVERY_INPUT_MAX_LENGTH = 16;

/** A TOTP code: exactly 6 ASCII digits, after trimming surrounding spaces. */
export const totpCodeSchema = z.string().max(RECOVERY_INPUT_MAX_LENGTH).trim().regex(TOTP_CODE);

function isRecoveryCodeInput(value: string): boolean {
  return (
    RECOVERY_CHARACTERS.test(value) && value.replace(/[ -]/g, '').length === RECOVERY_CODE_LENGTH
  );
}

/**
 * A TOTP code or a recovery code as a user may type it, trimmed. The recovery code is only shape-checked
 * here; the API normalizes it (case, separators, `I`/`L`/`O`) before comparing.
 */
export const secondFactorCodeSchema = z
  .string()
  .max(RECOVERY_INPUT_MAX_LENGTH)
  .trim()
  .refine((value) => TOTP_CODE.test(value) || isRecoveryCodeInput(value));

/** `GET /auth/2fa`: whether 2FA is on, and how many recovery codes are left (never the codes). */
export const twoFactorStatusResponseSchema = z.object({
  enabled: z.boolean(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
});

export type TwoFactorStatusResponse = z.infer<typeof twoFactorStatusResponseSchema>;

/** `POST /auth/2fa/setup` (body `{}`): the secret for the authenticator, as a URI and as text. */
export const twoFactorSetupResponseSchema = z.object({
  otpauthUri: z.string(),
  secret: z.string(),
});

export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponseSchema>;

/** `POST /auth/2fa/enable`: confirms the pending secret with one code. */
export const twoFactorEnableRequestSchema = z.object({ code: totpCodeSchema });

export type TwoFactorEnableRequest = z.infer<typeof twoFactorEnableRequestSchema>;

/** The recovery codes, returned once (AC-02). */
export const twoFactorEnableResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
});

export type TwoFactorEnableResponse = z.infer<typeof twoFactorEnableResponseSchema>;

/** `POST /auth/2fa/disable`: a TOTP code or an unused recovery code (FR-02). */
export const twoFactorDisableRequestSchema = z.object({ code: secondFactorCodeSchema });

export type TwoFactorDisableRequest = z.infer<typeof twoFactorDisableRequestSchema>;
