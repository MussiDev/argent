import { AppError } from '@pesly/shared';

/** Missing, or outside the caller's scope; both answer 404 `NOT_FOUND` with the same body. */
export class ResourceNotFound extends AppError {
  constructor() {
    super('NOT_FOUND');
  }
}

/**
 * Maps the result of a scoped query to a response: nothing found (missing id or not allowed, which
 * the scoped query cannot tell apart) raises `ResourceNotFound` (AC-15, AC-16).
 */
export function notFoundUnlessAllowed<T>(resource: T | null | undefined): T {
  if (resource === null || resource === undefined) throw new ResourceNotFound();
  return resource;
}
