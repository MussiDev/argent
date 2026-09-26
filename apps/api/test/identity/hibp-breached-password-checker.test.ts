import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertPasswordAcceptable } from '../../src/identity/application/password-policy';
import { PasswordBreached, PasswordCheckUnavailable } from '../../src/identity/domain/errors';
import {
  HIBP_RANGE_URL,
  HIBP_TIMEOUT_MS,
  HibpBreachedPasswordChecker,
} from '../../src/identity/infrastructure/security/hibp-breached-password-checker';
import { createLogger, serializeError } from '../../src/shared/logging/logger';

const PASSWORD = 'correct horse battery staple';
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch double: records every request and answers with `respond`. No network is touched. */
function fakeFetch(respond: (request: CapturedRequest) => Promise<Response>) {
  const requests: CapturedRequest[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const request = { url, init };
    requests.push(request);
    return respond(request);
  };
  return { fetch: fetchFn, requests };
}

function rangeBody(lines: string[]): string {
  return lines.join('\r\n');
}

/** Settles only when the request's signal aborts, like a server that never answers. */
function hangUntilAborted({ init }: CapturedRequest): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    });
  });
}

describe('HibpBreachedPasswordChecker', () => {
  it('sends only the 5-char SHA-1 prefix and reports a listed suffix as PASSWORD_BREACHED (NFR-02)', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Promise.resolve(
        new Response(rangeBody(['0018A45C4D1DEF81644B54AB7F969B88D65:3', `${SUFFIX}:42`]), {
          status: 200,
        }),
      ),
    );
    const checker = new HibpBreachedPasswordChecker({ fetch });

    await expect(checker.isBreached(PASSWORD)).resolves.toBe(true);
    await expect(assertPasswordAcceptable(PASSWORD, checker)).rejects.toMatchObject({
      code: 'PASSWORD_BREACHED',
    });
    await expect(assertPasswordAcceptable(PASSWORD, checker)).rejects.toBeInstanceOf(
      PasswordBreached,
    );

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe(`${HIBP_RANGE_URL}${PREFIX}`);
      expect(request.init?.method ?? 'GET').toBe('GET');
      expect(request.init?.body).toBeUndefined();
      const sent = JSON.stringify({ url: request.url, headers: request.init?.headers ?? {} });
      expect(sent).not.toContain(SUFFIX);
      expect(sent).not.toContain(PASSWORD);
    }
  });

  it('matches suffixes case-insensitively', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.resolve(new Response(`${SUFFIX.toLowerCase()}:1`, { status: 200 })),
    );
    await expect(new HibpBreachedPasswordChecker({ fetch }).isBreached(PASSWORD)).resolves.toBe(
      true,
    );
  });

  it('reports an unlisted suffix and padding entries (count 0) as not breached', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.resolve(
        new Response(rangeBody(['0018A45C4D1DEF81644B54AB7F969B88D65:3', `${SUFFIX}:0`]), {
          status: 200,
        }),
      ),
    );
    const checker = new HibpBreachedPasswordChecker({ fetch });

    await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);
    await expect(assertPasswordAcceptable(PASSWORD, checker)).resolves.toBeUndefined();
  });

  it('raises PasswordCheckUnavailable when HIBP does not answer within 400 ms', async () => {
    expect(HIBP_TIMEOUT_MS).toBe(400);
    const { fetch } = fakeFetch(hangUntilAborted);
    const checker = new HibpBreachedPasswordChecker({ fetch });

    const startedAt = performance.now();
    const outcome = checker.isBreached(PASSWORD);
    await expect(outcome).rejects.toBeInstanceOf(PasswordCheckUnavailable);
    await expect(outcome).rejects.toMatchObject({ code: 'PASSWORD_CHECK_UNAVAILABLE' });
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(390);
    expect(elapsed).toBeLessThan(1000);
  });

  it('enforces the timeout even if the transport ignores the abort signal', async () => {
    const { fetch } = fakeFetch(() => new Promise<Response>(() => undefined));
    const checker = new HibpBreachedPasswordChecker({ fetch, timeoutMs: 50 });

    await expect(checker.isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });

  it('enforces the timeout while the response body is still streaming', async () => {
    const { fetch } = fakeFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${SUFFIX}:1\r\n`));
          // Never closes: the server stalls mid-body.
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const checker = new HibpBreachedPasswordChecker({ fetch, timeoutMs: 50 });

    await expect(checker.isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });

  it.each([500, 503, 429, 404])('raises PasswordCheckUnavailable on HTTP %i', async (status) => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response(`${SUFFIX}:1`, { status })));
    const checker = new HibpBreachedPasswordChecker({ fetch });

    await expect(checker.isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });

  it('raises PasswordCheckUnavailable on a network error and logs latency without the password', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const checker = new HibpBreachedPasswordChecker({ fetch, logger });

    await expect(checker.isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry.latencyMs).toEqual(expect.any(Number));
    expect(lines[0]).not.toContain(PASSWORD);
    expect(lines[0]).not.toContain(PREFIX);
  });

  it('cancels the body of a 5xx response and keeps the URL out of the error cause', async () => {
    let cancelled = false;
    const { fetch } = fakeFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('upstream error page'));
        },
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(new Response(body, { status: 503 }));
    });
    const checker = new HibpBreachedPasswordChecker({ fetch });

    const error: unknown = await checker.isBreached(PASSWORD).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PasswordCheckUnavailable);
    expect(cancelled).toBe(true);
    const cause = JSON.stringify(serializeError((error as Error).cause));
    expect(cause).toContain('http_status');
    expect(cause).not.toContain('pwnedpasswords');
    expect(cause).not.toContain(PREFIX);
  });

  it('replaces a raw network error (which may carry the URL) with a sanitized cause', async () => {
    const { fetch } = fakeFetch((request) =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: new Error(`connect ECONNREFUSED while requesting ${request.url}`),
        }),
      ),
    );
    const checker = new HibpBreachedPasswordChecker({ fetch });

    const error: unknown = await checker.isBreached(PASSWORD).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PasswordCheckUnavailable);
    const cause = JSON.stringify(serializeError((error as Error).cause));
    expect(cause).toContain('network');
    expect(cause).not.toContain('pwnedpasswords');
    expect(cause).not.toContain(PREFIX);
  });

  it('logs at debug, instead of swallowing, a failure to cancel the error body', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: { write: (line: string) => lines.push(line) },
    });
    const { fetch } = fakeFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error('cancel failed');
        },
      });
      return Promise.resolve(new Response(body, { status: 500 }));
    });
    const checker = new HibpBreachedPasswordChecker({ fetch, logger });

    await expect(checker.isBreached(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toContainEqual(
      expect.objectContaining({ level: 20, msg: 'could not cancel the HIBP response body' }),
    );
  });
});
