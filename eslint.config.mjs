import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_IMPORTS = {
  group: ['**/infrastructure', '**/infrastructure/**'],
  message: 'Only infrastructure may depend on infrastructure (hexagonal boundary).',
};

// Production code never depends on tests, fixtures or fakes (e.g. test-only routes).
const TEST_IMPORTS = {
  group: ['**/test', '**/test/**'],
  message: 'Production code must not import test code.',
};

// Frameworks, drivers, SDKs and Node built-ins are I/O concerns: domain code stays pure.
const IO_IMPORTS = {
  group: [
    'drizzle-orm',
    'drizzle-orm/*',
    'pg',
    'pg/*',
    'express',
    'express/*',
    'jose',
    'jose/*',
    '@node-rs/argon2',
    'resend',
    'resend/*',
    'node:*',
  ],
  message: 'Domain code must stay free of frameworks, drivers, SDKs and Node built-ins.',
};

// Identity declares a port and the composition root wires categories in; identity never knows it.
const CATEGORIES_IMPORTS = {
  group: ['**/categories', '**/categories/**'],
  message:
    'Identity must not import the categories module; the composition root registers a hook instead.',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'apps/api/drizzle/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'apps/*/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Flat config replaces rule options per file, so the more specific blocks below repeat TEST_IMPORTS.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS] }],
    },
  },
  // Identity: the three blocks above repeated with CATEGORIES_IMPORTS added (later blocks win).
  {
    files: ['apps/api/src/identity/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS, CATEGORIES_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/identity/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS, CATEGORIES_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/identity/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS, CATEGORIES_IMPORTS] },
      ],
    },
  },
);
