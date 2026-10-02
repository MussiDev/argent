import type { AccessScope } from '../../../shared/access';
import type { Movement, NewMovement } from '../../domain/movement';

export type { NewMovement };

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null`). Lists are ordered newest first (`occurredAt`, then `id`, both descending).
 */
export interface MovementRepository {
  /** The owner is the scope's user. */
  insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement>;
  list(
    scope: AccessScope<'read'>,
    options: { limit: number; offset: number },
  ): Promise<{ items: Movement[]; total: number }>;
  findById(scope: AccessScope<'read'>, id: string): Promise<Movement | null>;
}
