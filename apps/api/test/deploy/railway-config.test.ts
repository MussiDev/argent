import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface RailwayConfig {
  build?: { builder?: string; buildCommand?: string; watchPatterns?: string[] };
  deploy?: {
    startCommand?: string;
    preDeployCommand?: string[];
    restartPolicyType?: string;
    restartPolicyMaxRetries?: number;
  };
  variables?: unknown;
}

function readConfig(relativeToRepo: string): RailwayConfig {
  const file = fileURLToPath(new URL(`../../../../${relativeToRepo}`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as RailwayConfig;
}

const services = [
  { name: 'api', file: 'apps/api/railway.json', pkg: '@argent/api', heapMb: 320 },
  { name: 'worker', file: 'apps/api/railway.worker.json', pkg: '@argent/api', heapMb: 192 },
  { name: 'web', file: 'apps/web/railway.json', pkg: '@argent/web', heapMb: 320 },
] as const;

describe.each(services)('Railway config for $name', ({ name, file, pkg, heapMb }) => {
  const config = readConfig(file);
  const build = config.build?.buildCommand ?? '';
  const start = config.deploy?.startCommand ?? '';

  it('builds only its workspace package with pnpm and starts with pnpm or node, never npm', () => {
    expect(config.build?.builder).toBe('RAILPACK');
    expect(build).toBe(`pnpm --filter ${pkg} build`);
    expect(start).toMatch(/(^|\s)(pnpm|node)\s/);
    expect(`${build} ${start}`).not.toMatch(/(^|\s)npm\s/);
  });

  it('heap limit error: caps the heap in the start command only, with a bounded restart policy', () => {
    expect(start).toContain(`--max-old-space-size=${String(heapMb)}`);
    expect(build).not.toContain('max-old-space-size');
    expect(config.deploy?.restartPolicyType).toBe('ON_FAILURE');
    expect(config.deploy?.restartPolicyMaxRetries).toBeLessThanOrEqual(10);
  });

  it('holds no variables, so no secret can live in the repository', () => {
    expect(config).not.toHaveProperty('variables');
  });

  it(
    name === 'api'
      ? 'runs the built migration before the new version starts'
      : 'leaves migrations to the API service',
    () => {
      if (name === 'api') {
        expect(config.deploy?.preDeployCommand).toEqual([
          'node apps/api/dist/shared/db/migrate.js',
        ]);
      } else {
        expect(config.deploy?.preDeployCommand).toBeUndefined();
      }
    },
  );
});
