import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_IMPORTS = {
  group: ['**/infrastructure', '**/infrastructure/**'],
  message: 'Only infrastructure may depend on infrastructure (hexagonal boundary).',
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
  {
    files: ['apps/api/src/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [INFRASTRUCTURE_IMPORTS] }],
    },
  },
);
