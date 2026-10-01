import { Email } from '../domain/email';
import { TwoFactorUnavailable } from '../domain/errors';
import { normalizeRecoveryCode } from '../domain/recovery-code';
import { SIGN_IN_ACCOUNT_POLICY } from './attempt-policies';
import type { AttemptLimiter, AttemptPolicy, AttemptResult } from './ports/attempt-limiter';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import { SecretBoxUnavailable, type SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository, TwoFactorSettings } from './ports/two-factor-repository';

/** One unit reserved in one policy, to be given back exactly if the attempt must not count. */
interface Reservation {
  policy: AttemptPolicy;
  key: string;
  windowStart: Date;
}

export interface ReservedAttempt {
  /** False when any policy is over its limit; the caller must refund and answer 429. */
  allowed: boolean;
  reservations: readonly Reservation[];
}

/**
 * Reserve-then-refund (DISC-001-01a, FIX-001): one unit per policy is recorded before any code is
 * checked, so parallel requests share at most `limit` guesses.
 */
export async function reserveAttempt(
  limiter: AttemptLimiter,
  policies: readonly AttemptPolicy[],
  key: string,
): Promise<ReservedAttempt> {
  const results: AttemptResult[] = await Promise.all(
    policies.map((policy) => limiter.record(policy, key)),
  );
  return {
    allowed: results.every((result) => result.allowed),
    reservations: results.map((result, index) => ({
      // `results` has one entry per policy, in order.
      policy: policies[index] as AttemptPolicy,
      key,
      windowStart: result.windowStart,
    })),
  };
}

/**
 * Gives every reserved unit back, in the window it was recorded in. Never rejects: a failed refund
 * only makes the limiter stricter (fail safe), so it is reported and the outcome stands.
 */
export async function refundAttempt(
  limiter: AttemptLimiter,
  attempt: ReservedAttempt,
  reportRefundFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await Promise.all(
      attempt.reservations.map(({ policy, key, windowStart }) =>
        limiter.release(policy, key, windowStart),
      ),
    );
  } catch (error) {
    reportRefundFailure(error);
  }
}

/**
 * NFR-01: a failed code also counts toward the per-account sign-in limit, keyed like a password
 * sign-in. Never rejects: a failure to record it is reported and the caller's answer stands.
 */
export async function recordSignInFailure(
  limiter: AttemptLimiter,
  userEmail: string,
  reportRecordFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await limiter.record(SIGN_IN_ACCOUNT_POLICY, Email.parse(userEmail).value);
  } catch (error) {
    reportRecordFailure(error);
  }
}

/** A code as the user sent it, classified: a TOTP code or a recovery code in its stored form. */
export type SecondFactorCode = { kind: 'totp'; code: string } | { kind: 'recovery'; code: string };

const TOTP_CODE = /^[0-9]{6}$/;

/** Null when the input is neither a 6-digit code nor a recovery code. */
export function parseSecondFactorCode(input: string): SecondFactorCode | null {
  const trimmed = input.trim();
  if (TOTP_CODE.test(trimmed)) return { kind: 'totp', code: trimmed };
  const recovery = normalizeRecoveryCode(trimmed);
  return recovery === null ? null : { kind: 'recovery', code: recovery };
}

/**
 * Opens a sealed TOTP secret. A missing key becomes `TwoFactorUnavailable` (503); any other
 * failure (tampered, wrong key, other user) propagates as an unexpected error (500), never as a
 * wrong code.
 */
export function openTotpSecret(secretBox: SecretBox, settings: TwoFactorSettings): string {
  try {
    return secretBox.open(settings.secretSealed, settings.userId);
  } catch (error) {
    if (error instanceof SecretBoxUnavailable) throw new TwoFactorUnavailable({ cause: error });
    throw error;
  }
}

/** Seals a TOTP secret for `userId`; a missing key becomes `TwoFactorUnavailable` (503). */
export function sealTotpSecret(secretBox: SecretBox, secret: string, userId: string): string {
  try {
    return secretBox.seal(secret, userId);
  } catch (error) {
    if (error instanceof SecretBoxUnavailable) throw new TwoFactorUnavailable({ cause: error });
    throw error;
  }
}

export interface SecondFactorCheckDependencies {
  totp: TotpEngine;
  secretBox: SecretBox;
  passwordHasher: PasswordHasher;
}

/** Where a check records what it spends; pool-bound, or bound to the caller's transaction. */
export interface SecondFactorStores {
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
}

/**
 * Checks one code against the user's 2FA and spends it: a TOTP code only for a step later than the
 * last one accepted (NFR-03, R-41), a recovery code only while unused (R-41). Resolves false for a
 * wrong, replayed or used code. Recovery codes are tried one after another, never in parallel, so
 * memory stays bounded (R-45).
 */
export async function checkSecondFactorCode(
  deps: SecondFactorCheckDependencies,
  stores: SecondFactorStores,
  settings: TwoFactorSettings,
  code: SecondFactorCode,
  now: Date,
): Promise<boolean> {
  if (code.kind === 'totp') {
    const secret = openTotpSecret(deps.secretBox, settings);
    const step = deps.totp.verify(secret, code.code, now);
    if (step === null) return false;
    return stores.twoFactor.advanceLastUsedStep(settings.userId, step);
  }
  const unused = await stores.recoveryCodes.findUnused(settings.userId);
  for (const stored of unused) {
    // Sequential on purpose (see above).
    if (await deps.passwordHasher.verify(stored.codeHash, code.code)) {
      return stores.recoveryCodes.markUsed(stored.id, now);
    }
  }
  return false;
}
