import type { RequestHandler } from 'express';
import { HttpError } from './error-handler';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const REQUIRED_REQUESTED_WITH = 'argent';

/**
 * CSRF defence in depth on top of SameSite=Strict cookies (R-19): state-changing requests must come
 * from the web origin and carry `X-Requested-With: argent`, which a cross-site form cannot send.
 */
export function createOriginGuard(webOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const allowed =
      req.get('origin') === webOrigin && req.get('x-requested-with') === REQUIRED_REQUESTED_WITH;
    next(allowed ? undefined : new HttpError(403, 'VALIDATION_FAILED'));
  };
}
