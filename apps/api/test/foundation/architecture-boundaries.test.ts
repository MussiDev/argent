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

  it('allows application code to import its domain and ports', async () => {
    const source =
      "import { y } from '../domain/email';\nimport type { Clock } from './ports/clock';\n";
    expect(await restrictedImports(APPLICATION_FILE, source)).toEqual([]);
  });
});
