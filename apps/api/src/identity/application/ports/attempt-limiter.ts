export const ATTEMPT_KINDS = [
  'sign_in_account',
  'sign_in_ip',
  'register_ip',
  'reset_ip',
  'reset_email',
  'resend_account',
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
}
