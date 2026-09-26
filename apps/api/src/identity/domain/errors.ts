import { AppError } from '@argent/shared';

/** The email does not have a valid format or is longer than 254 characters. */
export class InvalidEmail extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'Invalid email');
  }
}

export class PasswordTooShort extends AppError {
  constructor() {
    super('PASSWORD_TOO_SHORT');
  }
}

/** Over 128 characters; the request schemas reject it first, so it has no dedicated code. */
export class PasswordTooLong extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'Password too long');
  }
}

export class PasswordBreached extends AppError {
  constructor() {
    super('PASSWORD_BREACHED');
  }
}

/** The breach check could not be completed; callers must fail closed (threat R-07). */
export class PasswordCheckUnavailable extends AppError {
  constructor(options?: { cause?: unknown }) {
    super('PASSWORD_CHECK_UNAVAILABLE');
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Raised by the user repository when the email is already registered. Deliberately not an
 * `AppError`: the register use case must absorb it (anti-enumeration), so if it ever escapes it is
 * a bug and the error handler answers 500 `INTERNAL`.
 */
export class DuplicateEmail extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Email already registered', options);
    this.name = 'DuplicateEmail';
  }
}

/** A verification or reset token that is unknown, expired, already used or of another purpose. */
export class TokenInvalid extends AppError {
  constructor() {
    super('TOKEN_INVALID');
  }
}

/** Too many attempts for a key in the current window (NFR-03, threat R-09). */
export class RateLimited extends AppError {
  constructor() {
    super('RATE_LIMITED');
  }
}

/** No valid session, or the session's user no longer exists. */
export class Unauthenticated extends AppError {
  constructor() {
    super('UNAUTHENTICATED');
  }
}
