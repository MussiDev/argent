import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNED_DIRS = ['apps/api/src/exchange-rates', 'packages/shared/src/exchange-rates'];

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['parseFloat', /\bparseFloat\b/],
  ['Number(', /\bNumber\s*\(/],
  ['.toFixed', /\.toFixed\b/],
  ['parseInt', /\bparseInt\b/],
  ['Math.round', /\bMath\.round\b/],
  ['Math.floor/ceil/trunc', /\bMath\.(?:floor|ceil|trunc)\b/],
  ['number-typed rate/buy/sell', /\b(?:rate|buy|sell|compra|venta)\s*\??\s*:\s*number\b/],
  ['as number', /\bas\s+number\b/],
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Source-text scan: returns the names of the float-style constructs found in the source. */
function floatFindings(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('no floating point in exchange rate sources (NFR-01)', () => {
  it.each([
    ['const rate = parseFloat(x);', 'parseFloat'],
    ['const buy = Number(x);', 'Number('],
    ['const s = value.toFixed(2);', '.toFixed'],
    ['const r = Math.round(x * 10000);', 'Math.round'],
    ['interface Q { rate: number }', 'number-typed rate/buy/sell'],
    ['function f(sell: number) {}', 'number-typed rate/buy/sell'],
    ['interface Q { compra: number }', 'number-typed rate/buy/sell'],
    ['interface Q { venta?: number }', 'number-typed rate/buy/sell'],
    ['const r = payload.rate as number;', 'as number'],
    ['const r = parseInt(x, 10);', 'parseInt'],
    ['const r = Math.floor(x);', 'Math.floor/ceil/trunc'],
    ['const r = Math.ceil(x);', 'Math.floor/ceil/trunc'],
    ['const r = Math.trunc(x);', 'Math.floor/ceil/trunc'],
  ])('the scanner flags %s', (probe, expected) => {
    expect(floatFindings(probe)).toContain(expected);
  });

  it.each([
    'const rate = 12_3400n;',
    'interface Q { rate: bigint; count: number }',
    'interface Q { compra: bigint; venta: bigint }',
    '// parseFloat and Number( and rate: number in a comment\nconst a = 1n;',
    '/* Math.round(x).toFixed(2) */ const a = 1n;',
  ])('the scanner passes clean probe %#', (probe) => {
    expect(floatFindings(probe)).toEqual([]);
  });

  const files = SCANNED_DIRS.flatMap((dir) => tsFiles(join(repoRoot, dir)));

  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it.each(files.map((file) => [file.slice(repoRoot.length).replaceAll('\\', '/'), file]))(
    'has no float constructs: %s',
    (_name, file) => {
      expect(floatFindings(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );
});
