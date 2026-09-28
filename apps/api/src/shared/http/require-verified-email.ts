import type { RequestHandler } from 'express';
import { HttpError } from './error-handler';

/**
 * Mounted after `requireSession` on every financial route (AC-04): an unverified user gets
 * 403 `EMAIL_NOT_VERIFIED`, which is about the caller's own state, so it reveals nothing about
 * other users' data. Without `req.auth` (no session middleware ran) it fails closed with 401.
 */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new HttpError(401, 'UNAUTHENTICATED'));
    return;
  }
  next(req.auth.emailVerified ? undefined : new HttpError(403, 'EMAIL_NOT_VERIFIED'));
};
