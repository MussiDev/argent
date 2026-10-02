import { effectiveNames, type Category } from './category';

function fold(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** The sibling whose effective name equals `candidate` (NFC, case-insensitive), or null. */
export function findNameConflict(
  siblings: readonly Category[],
  candidate: string,
  excludeId: string | null,
): Category | null {
  const wanted = fold(candidate);
  for (const sibling of siblings) {
    if (sibling.id === excludeId) continue;
    if (effectiveNames(sibling).some((name) => fold(name) === wanted)) return sibling;
  }
  return null;
}
