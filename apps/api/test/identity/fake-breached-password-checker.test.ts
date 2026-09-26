import { describe, expect, it } from 'vitest';
import {
  FAKE_BREACHED_PASSWORDS,
  FakeBreachedPasswordChecker,
} from '../../src/identity/infrastructure/security/fake-breached-password-checker';

describe('FakeBreachedPasswordChecker', () => {
  it('reports every password of its deterministic list as breached', async () => {
    const checker = new FakeBreachedPasswordChecker();
    expect(FAKE_BREACHED_PASSWORDS).toContain('password123');
    for (const password of FAKE_BREACHED_PASSWORDS) {
      await expect(checker.isBreached(password)).resolves.toBe(true);
    }
  });

  it('reports other passwords as not breached', async () => {
    await expect(new FakeBreachedPasswordChecker().isBreached('password123')).resolves.toBe(true);
    await expect(
      new FakeBreachedPasswordChecker().isBreached('a unique passphrase 42'),
    ).resolves.toBe(false);
  });

  it('accepts a custom list', async () => {
    const checker = new FakeBreachedPasswordChecker(['only-this-one']);
    await expect(checker.isBreached('only-this-one')).resolves.toBe(true);
    await expect(checker.isBreached('password123')).resolves.toBe(false);
  });
});
