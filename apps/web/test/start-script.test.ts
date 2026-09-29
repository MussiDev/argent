import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('web start script', () => {
  it('passes no port flag, so Next.js listens on PORT', () => {
    expect(manifest.scripts.start).toBe('next start');
    expect(manifest.scripts.start).not.toMatch(/(--port|-p)\b/);
  });
});
