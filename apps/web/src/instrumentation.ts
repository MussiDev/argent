import { parseWebEnv } from './lib/web-env';

/** Runs once when the server starts: an invalid environment stops the server before any request. */
export function register(): void {
  parseWebEnv(process.env);
}
