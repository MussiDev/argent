import type { AccountMovements } from '../../application/ports/account-movements';

/** Production adapter until PRD 03: no movements exist yet, so every account sums to zero. */
export class NoMovementsAdapter implements AccountMovements {
  sumsByAccount(): Promise<ReadonlyMap<string, bigint>> {
    return Promise.resolve(new Map());
  }

  hasMovements(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
