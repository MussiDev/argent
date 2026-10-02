import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const ratesRoot = join(repoRoot, 'apps/api/src/exchange-rates');

const STATIC_IMPORT =
  /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const FORBIDDEN_FILE_PATTERN =
  /(?:^|\/)(?:rate-provider|dolarapi-rate-provider|fake-rate-provider|rates-sync-job)$/;
const FORBIDDEN_TARGET =
  /\/infrastructure\/(?:provider|jobs)(?:\/|$)|\/application\/refresh-rates$/;
const FORBIDDEN_NAMES = [
  'createRatesSyncJob',
  'DolarapiRateProvider',
  'FakeRateProvider',
  'RatesSyncJob',
];

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function blankStrings(code: string): string {
  return code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

/** Import specifiers (static, dynamic import, require) of the comment-stripped source. */
function specifiers(source: string): string[] {
  const code = stripComments(source);
  const statics = [...code.matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2] ?? '');
  const dynamics = [...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1] ?? '');
  return [...statics, ...dynamics];
}

function isBarrel(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = toPosix(resolve(dirname(file), specifier));
  const barrel = toPosix(ratesRoot);
  return target === barrel || target === `${barrel}/index`;
}

function reachesProviderOrJob(file: string, specifier: string): boolean {
  const resolved = specifier.startsWith('.') ? toPosix(resolve(dirname(file), specifier)) : '';
  return (
    FORBIDDEN_FILE_PATTERN.test(specifier) ||
    FORBIDDEN_TARGET.test(specifier) ||
    FORBIDDEN_FILE_PATTERN.test(resolved) ||
    FORBIDDEN_TARGET.test(resolved)
  );
}

/** Request-path scan of a handler/use-case file: no provider, job, refresh or barrel imports. */
function requestPathFindings(file: string, source: string): string[] {
  return specifiers(source).filter(
    (spec) => reachesProviderOrJob(file, spec) || isBarrel(file, spec),
  );
}

/** Process-entry scan: no provider/job identifiers in code, nor imports reaching them. */
function entryFindings(file: string, source: string): string[] {
  const code = blankStrings(stripComments(source));
  const names = FORBIDDEN_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
  return [...names, ...requestPathFindings(file, source)];
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('request path never reaches the rate provider or the sync job (NFR-02/03)', () => {
  const probeFile = join(ratesRoot, 'infrastructure/http/probe.ts');

  it.each([
    "import type { RateProvider } from '../../application/ports/rate-provider';",
    "import { DolarapiRateProvider } from '../provider/dolarapi-rate-provider';",
    "import { FakeRateProvider } from '../provider/fake-rate-provider';",
    "import { RatesSyncJob } from '../jobs/rates-sync-job';",
    "export { x } from '../jobs/rates-sync-job';",
    "import { createRatesSyncJob } from '../..';",
    "import { createRatesSyncJob } from '../../index';",
    "import { RefreshRates } from '../../application/refresh-rates';",
    "import { x } from '../../infrastructure/provider/x';",
    "import { x } from '../../../exchange-rates/infrastructure/jobs/x';",
    "const m = await import('../jobs/rates-sync-job');",
    "const m = require('../provider/fake-rate-provider');",
    "const m = await import('../../application/refresh-rates');",
    "const m = await import('../..');",
  ])('the scanner flags %s', (probe) => {
    expect(requestPathFindings(probeFile, probe)).not.toEqual([]);
  });

  it.each([
    "import { RateRepository } from '../../application/ports/rate-repository';",
    "import { GetLatestRates } from '../../application/get-latest-rates';",
    "import express from 'express';",
    "const m = await import('express');",
    "const m = require('zod');",
    "// import { x } from '../jobs/rates-sync-job';",
    "/* import { x } from '../../application/refresh-rates'; */",
  ])('the scanner passes clean probe %s', (probe) => {
    expect(requestPathFindings(probeFile, probe)).toEqual([]);
  });

  it('the entry scanner flags names and provider/job paths', () => {
    const entry = join(repoRoot, 'apps/api/src/server.ts');
    expect(entryFindings(entry, "import { createRatesSyncJob } from './x';")).not.toEqual([]);
    expect(entryFindings(entry, 'const p = new FakeRateProvider();')).not.toEqual([]);
    expect(
      entryFindings(entry, "import { a } from './exchange-rates/infrastructure/jobs/x';"),
    ).not.toEqual([]);
    expect(entryFindings(entry, "import { a } from './exchange-rates';")).not.toEqual([]);
    expect(entryFindings(entry, "const m = await import('./exchange-rates');")).not.toEqual([]);
    expect(
      entryFindings(entry, "const m = require('./exchange-rates/infrastructure/provider/x');"),
    ).not.toEqual([]);
    expect(
      entryFindings(
        entry,
        "import { createExchangeRateRoutes } from './exchange-rates/infrastructure/http/exchange-rate-routes';",
      ),
    ).toEqual([]);
  });

  it('the entry scanner ignores comments and string literals', () => {
    const entry = join(repoRoot, 'apps/api/src/server.ts');
    expect(entryFindings(entry, '// FakeRateProvider and createRatesSyncJob\n')).toEqual([]);
    expect(entryFindings(entry, '/* DolarapiRateProvider */ const a = 1;')).toEqual([]);
    expect(entryFindings(entry, "logger.info('RatesSyncJob started');")).toEqual([]);
    expect(entryFindings(entry, 'const p = new FakeRateProvider();')).toEqual(['FakeRateProvider']);
  });

  const httpFiles = tsFiles(join(ratesRoot, 'infrastructure/http'));
  const requestFiles = [...httpFiles, join(ratesRoot, 'application/get-latest-rates.ts')];

  it('finds the request-path files', () => {
    expect(httpFiles.length).toBeGreaterThanOrEqual(2);
  });

  it.each(requestFiles.map((f) => [toPosix(f.slice(repoRoot.length)), f]))(
    'has no provider/job imports: %s',
    (_name, file) => {
      expect(requestPathFindings(file, readFileSync(file, 'utf8'))).toEqual([]);
    },
  );

  it.each(['apps/api/src/server.ts', 'apps/api/src/app.ts'])(
    'the API process entry does not load providers or the job: %s',
    (relative) => {
      const file = join(repoRoot, relative);
      expect(entryFindings(file, readFileSync(file, 'utf8'))).toEqual([]);
    },
  );
});
