import { AppError, LIST_MOVEMENTS_MAX_LIMIT } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import type { MovementRepository } from './ports/movement-repository';

export interface ListMovementsDependencies {
  movements: MovementRepository;
}

export interface ListMovementsOptions {
  limit: number;
  offset: number;
}

export class ListMovements {
  constructor(private readonly deps: ListMovementsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    options: ListMovementsOptions,
  ): Promise<{ items: Movement[]; total: number }> {
    const { limit, offset } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_MOVEMENTS_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'limit or offset out of range');
    }
    return this.deps.movements.list(scope, { limit, offset });
  }
}
