import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

// Built at runtime so this file never contains the needles it searches for.
const OLD_SCOPE = ['@', 'argent/'].join('');
const OLD_SCOPE_ESCAPED = ['@', 'argent', '\\', '/'].join('');

/** History keeps the old scope on purpose (PRD Out of Scope). */
const EXCLUDED_PREFIXES = ['docs/ddw/'];
const EXCLUDED_FILES = ['CHANGELOG.md'];

/** Keeps only the paths outside the history that is allowed to name the old scope. */
function oldScopeReferences(paths: readonly string[]): string[] {
  return paths
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => p.length > 0)
    .filter((p) => !EXCLUDED_FILES.includes(p))
    .filter((p) => !EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix)));
}

function scanTrackedFiles(): string[] {
  const run = spawnSync(
    'git',
    [
      'grep',
      '-l',
      '-F',
      '-e',
      OLD_SCOPE,
      '-e',
      OLD_SCOPE_ESCAPED,
      // Also new files not committed yet, so a local run cannot miss a leftover.
      '--untracked',
      '--',
      '.',
      ...[...EXCLUDED_PREFIXES, ...EXCLUDED_FILES].map((excluded) => `:(exclude)${excluded}`),
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  // git grep exits 1 when nothing matches; anything else is a failed scan, not a clean one.
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`git grep failed (${String(run.status)}): ${run.stderr}`);
  }
  return oldScopeReferences(run.stdout.split(/\r?\n/));
}

describe('package scope', () => {
  it('no tracked file outside docs/ddw and CHANGELOG.md references the old scope', () => {
    expect(scanTrackedFiles()).toEqual([]);
  });

  it('this file does not contain the old scope it searches for', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(source).not.toContain(OLD_SCOPE);
    expect(source).not.toContain(OLD_SCOPE_ESCAPED);
  });

  it('package scope error: a file still referencing the old scope is reported by path, and docs/ddw and CHANGELOG.md are not', () => {
    expect(
      oldScopeReferences([
        'apps/web/src/lib/api-client.ts',
        'docs/ddw/specs/spec-FEAT-002.md',
        'CHANGELOG.md',
        'apps\\api\\scripts\\build.mjs',
        '',
      ]),
    ).toEqual(['apps/web/src/lib/api-client.ts', 'apps/api/scripts/build.mjs']);
  });
});
