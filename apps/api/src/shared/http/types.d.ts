import 'express-serve-static-core';
import type { AuthContext } from './auth-context';

declare module 'express-serve-static-core' {
  interface Locals {
    requestId: string;
  }

  interface Request {
    /** Set only by the session middleware. */
    auth?: AuthContext;
  }
}
