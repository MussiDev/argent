// @vitest-environment happy-dom
import { cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, useApiClient } from '../src/lib/api-client-provider';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApiClientProvider', () => {
  it('refuses to hand out a client outside the provider', () => {
    // React logs the thrown render error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useApiClient())).toThrow(
      'useApiClient must be used inside <ApiClientProvider>',
    );
  });

  it('gives every consumer the same client, talking to the configured origin', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'reset_sent_if_registered' }), { status: 202 }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiClientProvider apiOrigin="https://api.argent.test">{children}</ApiClientProvider>
    );

    const { result, rerender } = renderHook(() => useApiClient(), { wrapper });
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    await first.requestPasswordReset({ email: 'ana@example.com' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.argent.test/auth/password-reset/request',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('renders its children', () => {
    const { getByText } = render(
      <ApiClientProvider apiOrigin="https://api.argent.test">
        <p>inside</p>
      </ApiClientProvider>,
    );

    expect(getByText('inside')).toBeDefined();
  });
});
