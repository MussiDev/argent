// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { takeUrlToken } from '../src/features/auth/take-url-token';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('takeUrlToken', () => {
  it('returns the token and removes only it from the address bar, keeping query and hash', () => {
    window.history.replaceState(null, '', '/es/verify-email?utm=mail&token=abc123#done');
    const lengthBefore = window.history.length;

    expect(takeUrlToken()).toBe('abc123');

    expect(window.location.pathname).toBe('/es/verify-email');
    expect(window.location.search).toBe('?utm=mail');
    expect(window.location.hash).toBe('#done');
    // Replaced, not pushed: going back must not reveal the token.
    expect(window.history.length).toBe(lengthBefore);
  });

  it('returns null and leaves history alone when there is no token', () => {
    window.history.replaceState(null, '', '/es/verify-email?utm=mail');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    expect(takeUrlToken()).toBeNull();

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?utm=mail');
  });

  it('returns an empty token (and still clears it) when the parameter is empty', () => {
    window.history.replaceState(null, '', '/es/reset-password?token=');

    expect(takeUrlToken()).toBe('');
    expect(window.location.search).toBe('');
  });
});
