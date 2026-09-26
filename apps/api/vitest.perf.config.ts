import { defineProject } from 'vitest/config';

/**
 * Argon2id runs on libuv's thread pool, so its size decides how many hashes run in parallel and
 * therefore the latency under load. Pinned here, before the test workers are forked (they inherit
 * the environment), so every run measures the same configuration.
 */
process.env.UV_THREADPOOL_SIZE = '4';

/** NFR-06 latency benchmarks, kept out of `pnpm test` so that suite stays deterministic. */
export default defineProject({
  test: {
    name: 'api-perf',
    environment: 'node',
    include: ['test/perf/**/*.perf.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
  },
});
