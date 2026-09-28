/**
 * Who the request is authenticated as. Set on `req.auth` by the session middleware (Block 4's
 * `requireSession`); handlers read it from their `HandlerContext`, never from the request body.
 */
export interface AuthContext {
  userId: string;
  /** The session the access token belongs to (for audit logs and sign-out of this device). */
  sessionId: string;
  /** Whether the user verified their email; financial routes require it (Block 6). */
  emailVerified: boolean;
}
