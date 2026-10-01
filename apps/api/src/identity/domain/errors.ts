import { AppError } from '@pesly/shared';

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

/**
 * Raised by the identity repository when the external identity is already linked, or the user
 * already has one of that provider. Not an `AppError`, like `DuplicateEmail`: the Google sign-in
 * use case handles it, so if it ever escapes the error handler answers 500 `INTERNAL`.
 */
export class IdentityAlreadyLinked extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Identity already linked', options);
    this.name = 'IdentityAlreadyLinked';
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

/** Wrong password or unknown email: one error for both, so accounts cannot be enumerated (R-02). */
export class InvalidCredentials extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS');
  }
}

/** A wrong or replayed TOTP code, or an unknown or used recovery code, in settings (enable, disable). */
export class TotpInvalid extends AppError {
  constructor() {
    super('TOTP_INVALID');
  }
}

export class TwoFactorAlreadyEnabled extends AppError {
  constructor() {
    super('TWO_FACTOR_ALREADY_ENABLED');
  }
}

export class TwoFactorNotEnabled extends AppError {
  constructor() {
    super('TWO_FACTOR_NOT_ENABLED');
  }
}

/** Enable without a pending setup, or with a pending secret replaced meanwhile (threat R-52). */
export class TwoFactorSetupRequired extends AppError {
  constructor() {
    super('TWO_FACTOR_SETUP_REQUIRED');
  }
}

/** No encryption key for TOTP secrets is configured (only possible outside production). */
export class TwoFactorUnavailable extends AppError {
  constructor(options?: { cause?: unknown }) {
    super('TWO_FACTOR_UNAVAILABLE');
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** A wrong or replayed code at the second step of sign-in (AC-05). */
export class SecondFactorInvalid extends AppError {
  constructor() {
    super('SECOND_FACTOR_INVALID');
  }
}

/** The sign-in challenge is missing, expired, used up or no longer valid for the user. */
export class SecondFactorExpired extends AppError {
  constructor() {
    super('SECOND_FACTOR_EXPIRED');
  }
}
