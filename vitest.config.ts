import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/api', 'packages/shared', 'apps/web'],
    coverage: {
      provider: 'v8',
      // The floor in AGENTS.md ("Testing") is measured over these three trees together.
      include: ['apps/api/src/**', 'apps/web/src/**', 'packages/shared/src/**'],
      exclude: [
        // Ambient declarations: types only, nothing is emitted, so there is nothing to run.
        '**/*.d.ts',
        // Stylesheets are not JavaScript; V8 cannot instrument them.
        '**/*.css',
      ],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
