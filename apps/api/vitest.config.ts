import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Test files share one database that is truncated between tests, so they must run serially.
    fileParallelism: false,
  },
});
