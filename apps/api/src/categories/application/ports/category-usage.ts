/**
 * The only door through which movements reach categories (PRD 03 implements it).
 *
 * UNSCOPED BY DESIGN: it takes no `AccessScope`. It is safe only because the categories module
 * passes it ids the scoped `CategoryRepository` just returned. An adapter must never read other
 * categories' rows.
 */
export interface CategoryUsage {
  isUsed(categoryId: string): Promise<boolean>;
}
