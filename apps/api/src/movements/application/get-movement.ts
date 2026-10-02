import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Movement } from '../domain/movement';
import type { MovementRepository } from './ports/movement-repository';

export interface GetMovementDependencies {
  movements: MovementRepository;
}

export class GetMovement {
  constructor(private readonly deps: GetMovementDependencies) {}

  async execute(scope: AccessScope<'read'>, id: string): Promise<Movement> {
    return notFoundUnlessAllowed(await this.deps.movements.findById(scope, id));
  }
}
