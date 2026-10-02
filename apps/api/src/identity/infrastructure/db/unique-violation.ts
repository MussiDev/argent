import { violatedConstraint } from '../../../shared/db/pg-errors';

/**
 * The name of the unique constraint `error` violated, or undefined for any other error. Kept as
 * the identity-facing name of the shared helper.
 */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  return violatedConstraint(error, '23505');
}
