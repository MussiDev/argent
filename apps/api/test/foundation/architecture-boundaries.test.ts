import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

// Lints virtual files with the repository's real ESLint config, keeping only the boundary rule
// (type-aware parsing is switched off because the files do not exist on disk).
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: { languageOptions: { parserOptions: { projectService: false, project: null } } },
  ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-imports',
});

async function restrictedImports(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: `${repoRoot}${filePath}` });
  return (result?.messages ?? []).map((message) => message.ruleId ?? `fatal: ${message.message}`);
}

const DOMAIN_FILE = 'apps/api/src/identity/domain/probe.ts';
const APPLICATION_FILE = 'apps/api/src/identity/application/probe.ts';

describe('hexagonal import boundaries', () => {
  it.each([
    "import { x } from '../infrastructure/db/schema';",
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { SignJWT } from 'jose';",
    "import { hash } from '@node-rs/argon2';",
    "import { Resend } from 'resend';",
    "import { randomUUID } from 'node:crypto';",
  ])('rejects in domain: %s', async (source) => {
    expect(await restrictedImports(DOMAIN_FILE, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('rejects infrastructure imports in application', async () => {
    expect(
      await restrictedImports(
        APPLICATION_FILE,
        "import { x } from '../infrastructure/db/schema';\n",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows domain code to import shared schemas and other domain files', async () => {
    const source =
      "import { z } from 'zod';\nimport { AppError } from '@argent/shared';\nimport { y } from './email';\n";
    expect(await restrictedImports(DOMAIN_FILE, source)).toEqual([]);
  });

  it.each([
    ['apps/api/src/app.ts', "import { x } from '../test/fixtures/fixture-resource-routes';\n"],
    ['apps/api/src/shared/access/probe.ts', "import { x } from '../../../test/helpers/x';\n"],
    [DOMAIN_FILE, "import { x } from '../../../test/fakes/mutable-clock';\n"],
    [APPLICATION_FILE, "import { x } from '../../../test/fakes/mutable-clock';\n"],
  ])('rejects test-code imports from production code: %s', async (file, source) => {
    expect(await restrictedImports(file, source)).toEqual(['no-restricted-imports']);
  });

  it('keeps rejecting infrastructure imports in domain alongside the test-code rule', async () => {
    expect(
      await restrictedImports(DOMAIN_FILE, "import { x } from '../infrastructure/db/schema';\n"),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows test code to import test code and production code', async () => {
    const source =
      "import { x } from '../fixtures/fixture-resource-routes';\nimport { y } from '../../src/app';\n";
    expect(await restrictedImports('apps/api/test/access/probe.test.ts', source)).toEqual([]);
  });

  it.each([
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
    "import { DenyAllGroupMembershipReader } from '../../shared/access/infrastructure/deny-all-group-membership-reader';",
  ])('rejects shared access infrastructure in application: %s', async (source) => {
    expect(await restrictedImports(APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows application code to import the shared access port', async () => {
    const source = "import type { AccessScope } from '../../shared/access';\n";
    expect(await restrictedImports(APPLICATION_FILE, source)).toEqual([]);
  });

  it('allows application code to import its domain and ports', async () => {
    const source =
      "import { y } from '../domain/email';\nimport type { Clock } from './ports/clock';\n";
    expect(await restrictedImports(APPLICATION_FILE, source)).toEqual([]);
  });
});
