// A leaf: every attempt policy lives here so use cases can share them without importing each other.
// The only import is a type from a port, which emits nothing at runtime.
import type { AttemptPolicy } from './ports/attempt-limiter';

const FIFTEEN_MINUTES = 15 * 60;
const TWENTY_FOUR_HOURS = 24 * 60 * 60;

/** NFR-03 / threat R-01: 5 failed sign-ins per account (normalized email) per 15 minutes. */
export const SIGN_IN_ACCOUNT_POLICY: AttemptPolicy = {
  kind: 'sign_in_account',
  limit: 5,
  windowSeconds: FIFTEEN_MINUTES,
};

/** NFR-03 / threat R-01: 20 failed sign-ins per client IP per 15 minutes. */
export const SIGN_IN_IP_POLICY: AttemptPolicy = {
  kind: 'sign_in_ip',
  limit: 20,
  windowSeconds: FIFTEEN_MINUTES,
};

/** 01c NFR-04: 5 failed second-factor codes per user per 15 minutes, at the sign-in second step. */
export const SECOND_FACTOR_USER_15M_POLICY: AttemptPolicy = {
  kind: 'second_factor_user_15m',
  limit: 5,
  windowSeconds: FIFTEEN_MINUTES,
};

/** 01c NFR-04: 20 failed second-factor codes per user per 24 hours, at the sign-in second step. */
export const SECOND_FACTOR_USER_24H_POLICY: AttemptPolicy = {
  kind: 'second_factor_user_24h',
  limit: 20,
  windowSeconds: TWENTY_FOUR_HOURS,
};

/** The sign-in second step's per-user limits; wrong passwords never touch them (threat R-51). */
export const SECOND_FACTOR_POLICIES: readonly AttemptPolicy[] = [
  SECOND_FACTOR_USER_15M_POLICY,
  SECOND_FACTOR_USER_24H_POLICY,
];

/** 01c NFR-04: 5 failed disables per user per 15 minutes. */
export const TWO_FACTOR_DISABLE_USER_15M_POLICY: AttemptPolicy = {
  kind: 'two_factor_disable_user',
  limit: 5,
  windowSeconds: FIFTEEN_MINUTES,
};

/** 01c NFR-04: 20 failed disables per user per 24 hours. */
export const TWO_FACTOR_DISABLE_USER_24H_POLICY: AttemptPolicy = {
  kind: 'two_factor_disable_user_24h',
  limit: 20,
  windowSeconds: TWENTY_FOUR_HOURS,
};

/**
 * Disabling has limits of its own, so a stolen session cannot exhaust the sign-in second step
 * (threat R-51).
 */
export const TWO_FACTOR_DISABLE_POLICIES: readonly AttemptPolicy[] = [
  TWO_FACTOR_DISABLE_USER_15M_POLICY,
  TWO_FACTOR_DISABLE_USER_24H_POLICY,
];
