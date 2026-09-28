const UNIQUE_VIOLATION = '23505';
const MAX_CAUSE_DEPTH = 5;

/**
 * The name of the unique constraint `error` violated, or undefined for any other error. Drizzle
 * wraps driver errors (DrizzleQueryError), so the pg error may sit in the cause chain.
 */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (Reflect.get(current, 'code') === UNIQUE_VIOLATION) {
      const constraint: unknown = Reflect.get(current, 'constraint');
      return typeof constraint === 'string' ? constraint : undefined;
    }
    current = current.cause;
  }
  return undefined;
}
