/**
 * Who the request is authenticated as. Set on `req.auth` by the session middleware (Block 4's
 * `requireSession`); handlers read it from their `HandlerContext`, never from the request body.
 */
export interface AuthContext {
  userId: string;
}
