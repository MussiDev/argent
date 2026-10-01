export const ATTEMPT_KINDS = [
  'sign_in_account',
  'sign_in_ip',
  'register_ip',
  'reset_ip',
  'reset_email',
  'resend_account',
  'google_start_ip',
  'second_factor_user_15m',
  'second_factor_user_24h',
  'two_factor_disable_user',
  'two_factor_disable_user_24h',
] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** A fixed-window limit: at most `limit` attempts per `windowSeconds`, per key. */
export interface AttemptPolicy {
  kind: AttemptKind;
  limit: number;
  windowSeconds: number;
}

export interface AttemptResult {
  /** Attempts recorded for the key in the current window, including this one. */
  count: number;
  /** False once `count` exceeds the policy's limit. */
  allowed: boolean;
  /** The window this attempt was recorded in; pass it to `release` to refund exactly this one. */
  windowStart: Date;
}

/**
 * Counts attempts per key in fixed time windows (NFR-03). State lives outside the process so
 * every API instance sees the same counters (NFR-09).
 */
export interface AttemptLimiter {
  /** True when the current window already holds `limit` attempts; records nothing. */
  isLimitReached(policy: AttemptPolicy, key: string): Promise<boolean>;
  /** Records one attempt in the current window. */
  record(policy: AttemptPolicy, key: string): Promise<AttemptResult>;
  /**
   * Gives back one attempt of the window `windowStart` (never below zero). Lets a caller reserve a
   * unit with `record` before expensive work and refund exactly that unit when the attempt must
   * not count, even if the current window has changed since.
   */
  release(policy: AttemptPolicy, key: string, windowStart: Date): Promise<void>;
}
