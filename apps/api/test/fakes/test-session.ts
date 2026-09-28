import type { RequestHandler } from 'express';
import { HttpError } from '../../src/shared/http/error-handler';

export const TEST_USER_HEADER = 'x-test-user-id';

/**
 * Stand-in for Block 4's `requireSession`: authenticates whoever the test names in a header.
 * Only ever mounted in tests.
 */
export const testRequireSession: RequestHandler = (req, _res, next) => {
  const userId = req.get(TEST_USER_HEADER);
  if (!userId) {
    next(new HttpError(401, 'UNAUTHENTICATED'));
    return;
  }
  // The double names only the user; the session is fictitious and the email counts as unverified.
  req.auth = { userId, sessionId: 'test-session', emailVerified: false };
  next();
};
