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
      "import { z } from 'zod';\nimport { AppError } from '@pesly/shared';\nimport { y } from './email';\n";
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

describe('identity never imports the categories module (dependency direction)', () => {
  it.each([
    [DOMAIN_FILE, "import { x } from '../../categories';"],
    [DOMAIN_FILE, "import { x } from '../../categories/domain/category';"],
    [APPLICATION_FILE, "import { seedDefaultCategories } from '../../categories';"],
    [APPLICATION_FILE, "import { x } from '../../categories/application/ensure-defaults';"],
    ['apps/api/src/identity/index.ts', "import { seedDefaultCategories } from '../categories';"],
    [
      'apps/api/src/identity/index.ts',
      "import { x } from './../categories/application/ensure-defaults';",
    ],
    [
      'apps/api/src/identity/infrastructure/db/probe.ts',
      "import { seedDefaultCategories } from '../../../categories';",
    ],
    [
      'apps/api/src/identity/infrastructure/http/probe.ts',
      "import { x } from '../../../categories/infrastructure/db/schema';",
    ],
  ])('rejects %s: %s', async (file, source) => {
    expect(await restrictedImports(file, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('keeps rejecting infrastructure and test imports where the categories pattern was added', async () => {
    expect(
      await restrictedImports(
        APPLICATION_FILE,
        "import { x } from '../infrastructure/db/schema';\n",
      ),
    ).toEqual(['no-restricted-imports']);
    expect(await restrictedImports(DOMAIN_FILE, "import { eq } from 'drizzle-orm';\n")).toEqual([
      'no-restricted-imports',
    ]);
    expect(
      await restrictedImports(
        'apps/api/src/identity/infrastructure/db/probe.ts',
        "import { x } from '../../../../test/fakes/mutable-clock';\n",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows the composition root and other modules to import categories', async () => {
    const source = "import { seedDefaultCategories } from './categories';\n";
    expect(await restrictedImports('apps/api/src/server.ts', source)).toEqual([]);
    expect(
      await restrictedImports(
        'apps/api/src/accounts/application/probe.ts',
        "import { x } from '../../categories';\n",
      ),
    ).toEqual([]);
  });

  it('allows identity infrastructure to import its own files', async () => {
    const source = "import { x } from './schema';\nimport { y } from '../email/email-transport';\n";
    expect(
      await restrictedImports('apps/api/src/identity/infrastructure/db/probe.ts', source),
    ).toEqual([]);
  });
});

describe('hexagonal import boundaries in the accounts module', () => {
  const ACCOUNTS_DOMAIN_FILE = 'apps/api/src/accounts/domain/probe.ts';
  const ACCOUNTS_APPLICATION_FILE = 'apps/api/src/accounts/application/probe.ts';

  it.each([
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { accounts } from '../infrastructure/db/schema';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in accounts domain: %s', async (source) => {
    expect(await restrictedImports(ACCOUNTS_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    "import { accounts } from '../infrastructure/db/schema';",
    "import { x } from '../infrastructure/http/account-routes';",
    "import { x } from '../infrastructure/movements/no-movements-adapter';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in accounts application: %s', async (source) => {
    expect(await restrictedImports(ACCOUNTS_APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows accounts application code to import its domain, ports and the shared access port', async () => {
    const source =
      "import { x } from '../domain/account';\nimport type { AccountMovements } from './ports/account-movements';\nimport type { AccessScope } from '../../shared/access';\n";
    expect(await restrictedImports(ACCOUNTS_APPLICATION_FILE, source)).toEqual([]);
  });

  it('allows accounts domain code to import shared schemas and its own files', async () => {
    const source = "import { z } from 'zod';\nimport { y } from './account-name';\n";
    expect(await restrictedImports(ACCOUNTS_DOMAIN_FILE, source)).toEqual([]);
  });
});
