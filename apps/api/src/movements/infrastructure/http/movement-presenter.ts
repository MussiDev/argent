import {
  formatMinorUnitsString,
  type ListMovementsResponse,
  type MovementResponse,
} from '@pesly/shared';
import type { Movement } from '../../domain/movement';

/** The only place where `bigint` becomes a decimal string and an instant an ISO 8601 UTC string. */
export function presentMovement(movement: Movement): MovementResponse {
  return {
    id: movement.id,
    type: movement.type,
    accountId: movement.accountId,
    categoryId: movement.categoryId,
    amount: formatMinorUnitsString(movement.amount),
    occurredAt: movement.occurredAt.toISOString(),
    note: movement.note,
    // The rate is a scaled integer: its plain decimal digits are the wire form.
    rate: movement.rate.toString(),
    rateSource: movement.rateSource,
    rateType: movement.rateType,
    createdAt: movement.createdAt.toISOString(),
  };
}

export function presentMovementList(
  list: { items: Movement[]; total: number },
  page: { limit: number; offset: number },
): ListMovementsResponse {
  return {
    items: list.items.map(presentMovement),
    total: list.total,
    limit: page.limit,
    offset: page.offset,
  };
}
