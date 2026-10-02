import { AppError, type ErrorCode, type ErrorResponse } from '@pesly/shared';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import type { Logger } from '../logging/logger';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PASSWORD_TOO_SHORT: 400,
  PASSWORD_BREACHED: 400,
  PASSWORD_CHECK_UNAVAILABLE: 503,
  TOKEN_INVALID: 400,
  INVALID_CREDENTIALS: 401,
  TOTP_INVALID: 400,
  TWO_FACTOR_ALREADY_ENABLED: 409,
  TWO_FACTOR_NOT_ENABLED: 409,
  TWO_FACTOR_SETUP_REQUIRED: 409,
  TWO_FACTOR_UNAVAILABLE: 503,
  SECOND_FACTOR_INVALID: 401,
  SECOND_FACTOR_EXPIRED: 401,
  ACCOUNT_NAME_TAKEN: 409,
  ACCOUNT_HAS_MOVEMENTS: 409,
  INTERNAL: 500,
};

/**
 * An error raised by the HTTP layer itself (validation, guards) whose status is not necessarily the
 * default one for its code, e.g. 403 or 413 `VALIDATION_FAILED`.
 */
export class HttpError extends AppError {
  readonly status: number;
  readonly fields: string[] | undefined;

  constructor(status: number, code: ErrorCode, fields?: string[]) {
    super(code);
    this.status = status;
    this.fields = fields;
  }
}

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  );
}

interface MappedError {
  status: number;
  body: ErrorResponse;
}

function mapError(error: unknown): MappedError {
  if (error instanceof HttpError) {
    const body: ErrorResponse = error.fields
      ? { code: error.code, fields: error.fields }
      : { code: error.code };
    return { status: error.status, body };
  }
  if (error instanceof AppError) {
    return { status: STATUS_BY_CODE[error.code], body: { code: error.code } };
  }
  if (isBodyParserError(error)) {
    // Oversized (413), malformed (400) and unsupported-encoding (415) bodies.
    return { status: error.status, body: { code: 'VALIDATION_FAILED' } };
  }
  return { status: 500, body: { code: 'INTERNAL' } };
}

/**
 * The single mapping from errors to HTTP responses. Bodies carry only a stable code (plus failing
 * field paths for validation); stack traces and driver messages go to the log, never to the client.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const { status, body } = mapError(error);
    const context = {
      requestId: res.locals.requestId,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      status,
      code: body.code,
    };
    if (status >= 500) {
      logger.error({ ...context, err: error }, 'request failed');
    } else {
      logger.warn(context, 'request rejected');
    }
    res.status(status).json(body);
  };
}
