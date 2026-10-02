import type { CategoryUsage } from '../../application/ports/category-usage';

/** Production adapter until PRD 03: no movements exist yet, so no category is used. */
export class NoUsageAdapter implements CategoryUsage {
  isUsed(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
