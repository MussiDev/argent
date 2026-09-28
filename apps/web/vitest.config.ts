import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'node',
    // next-intl's ESM build imports `next/navigation` without an extension, which only a bundler
    // resolves; inlining lets Vite resolve it instead of Node.
    server: { deps: { inline: ['next-intl'] } },
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
