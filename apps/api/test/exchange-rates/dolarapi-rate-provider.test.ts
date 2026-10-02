import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateProviderFailure } from '../../src/exchange-rates/domain/errors';
import { DolarapiRateProvider } from '../../src/exchange-rates/infrastructure/provider/dolarapi-rate-provider';
import { FakeRateProvider } from '../../src/exchange-rates/infrastructure/provider/fake-rate-provider';

const fixtureText = readFileSync(join(__dirname, 'fixtures', 'dolarapi-2026-10-02.json'), 'utf8');

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface Stub {
  baseUrl: string;
  server: Server;
  paths: string[];
}

const open: { server: Server; sockets: Set<Socket> }[] = [];

async function startStub(handler: Handler): Promise<Stub> {
  const paths: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    paths.push(req.url ?? '');
    handler(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({ server, sockets });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server, paths };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const { server, sockets } of open.splice(0)) {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
  }
});

function json(res: ServerResponse, body: string, type = 'application/json; charset=utf-8'): void {
  res.writeHead(200, { 'content-type': type });
  res.end(body);
}

async function failureOf(run: () => Promise<unknown>): Promise<RateProviderFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RateProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a RateProviderFailure');
}

function fetchFrom(stub: Stub, timeoutMs?: number): Promise<unknown> {
  const options =
    timeoutMs === undefined ? { baseUrl: stub.baseUrl } : { baseUrl: stub.baseUrl, timeoutMs };
  return new DolarapiRateProvider(options).fetchQuotes();
}

describe('DolarapiRateProvider against a local stub', () => {
  it('fetches /v1/dolares and maps the fixture', async () => {
    let accept: string | undefined;
    const stub = await startStub((req, res) => {
      accept = req.headers.accept;
      json(res, fixtureText);
    });
    const quotes = await new DolarapiRateProvider({ baseUrl: stub.baseUrl }).fetchQuotes();
    expect(stub.paths).toEqual(['/v1/dolares']);
    expect(accept).toBe('application/json');
    expect(quotes).toHaveLength(7);
    expect(quotes.find((q) => q.rateType === 'ccl')?.buy).toBe(16233000n);
  });

  it('maps HTTP 500 to provider_bad_status with 500', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(500).end('boom');
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_bad_status');
    expect(error.statusCode).toBe(500);
  });

  it('maps a 302 to provider_bad_status and does not follow it', async () => {
    const target = await startStub((_req, res) => {
      json(res, fixtureText);
    });
    const stub = await startStub((_req, res) => {
      res.writeHead(302, { location: `${target.baseUrl}/elsewhere` }).end();
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_bad_status');
    expect(error.statusCode).toBe(302);
    expect(target.paths).toEqual([]);
  });

  it('maps a closed port to provider_unreachable', async () => {
    const stub = await startStub((_req, res) => {
      json(res, '[]');
    });
    await new Promise<void>((resolve) =>
      stub.server.close(() => {
        resolve();
      }),
    );
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_unreachable');
  });

  it('maps a stub that never answers to provider_timeout', async () => {
    const stub = await startStub(() => undefined);
    const error = await failureOf(() => fetchFrom(stub, 100));
    expect(error.code).toBe('provider_timeout');
  });

  it('maps a body over 64 KiB to provider_invalid_payload', async () => {
    const stub = await startStub((_req, res) => {
      json(res, ' '.repeat(65_537) + fixtureText);
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_invalid_payload');
  });

  it('caps a chunked body that never declares its length', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(' '.repeat(70_000));
      res.end(fixtureText);
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_invalid_payload');
  });

  it('maps a non-JSON content type to provider_invalid_payload', async () => {
    const stub = await startStub((_req, res) => {
      json(res, fixtureText, 'text/html');
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_invalid_payload');
  });

  it('maps invalid JSON to provider_invalid_payload', async () => {
    const stub = await startStub((_req, res) => {
      json(res, '{oops');
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_invalid_payload');
  });
});

describe('DolarapiRateProvider hardening', () => {
  it.each(['application/json-seq', 'application/json+garbage', 'text/json', 'application/jsonx'])(
    'rejects the content type %s',
    async (type) => {
      const stub = await startStub((_req, res) => {
        json(res, fixtureText, type);
      });
      const error = await failureOf(() => fetchFrom(stub));
      expect(error.code).toBe('provider_invalid_payload');
    },
  );

  it.each(['application/json', 'application/json; charset=utf-8', 'application/vnd.api+json'])(
    'accepts the content type %s',
    async (type) => {
      const stub = await startStub((_req, res) => {
        json(res, fixtureText, type);
      });
      expect(await fetchFrom(stub)).toHaveLength(7);
    },
  );

  it.each(['AbortError', 'TimeoutError'])(
    'maps a %s from fetch to provider_timeout',
    async (name) => {
      vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', name)));
      const error = await failureOf(() =>
        new DolarapiRateProvider({ baseUrl: 'http://x' }).fetchQuotes(),
      );
      expect(error.code).toBe('provider_timeout');
    },
  );

  it('keeps the mapped code when cancelling the body of a bad status rejects', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('cancel failed');
      },
    });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status: 500 })));
    const error = await failureOf(() =>
      new DolarapiRateProvider({ baseUrl: 'http://x' }).fetchQuotes(),
    );
    expect(error.code).toBe('provider_bad_status');
    expect(error.statusCode).toBe(500);
  });

  it('keeps the invalid-payload code when cancelling an oversized declared body rejects', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('cancel failed');
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '70000' },
    });
    vi.stubGlobal('fetch', () => Promise.resolve(response));
    const error = await failureOf(() =>
      new DolarapiRateProvider({ baseUrl: 'http://x' }).fetchQuotes(),
    );
    expect(error.code).toBe('provider_invalid_payload');
  });

  it('maps headers followed by a stalled body to provider_timeout', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[');
    });
    const error = await failureOf(() => fetchFrom(stub, 200));
    expect(error.code).toBe('provider_timeout');
  });

  it('maps a socket destroyed mid-body to provider_unreachable', async () => {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const error = await failureOf(() => fetchFrom(stub));
    expect(error.code).toBe('provider_unreachable');
  });

  it('cuts an endless stream at the cap and closes the server socket', async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const timer = setInterval(() => res.write(' '.repeat(8192)), 5);
      res.on('close', () => {
        clearInterval(timer);
        closed();
      });
    });
    const error = await failureOf(() => fetchFrom(stub, 5000));
    expect(error.code).toBe('provider_invalid_payload');
    await serverSawClose;
  });
});

describe('FakeRateProvider', () => {
  it('returns 7 complete quotes with a deterministic providerUpdatedAt', async () => {
    const quotes = await new FakeRateProvider().fetchQuotes();
    expect(quotes).toHaveLength(7);
    expect(new Set(quotes.map((q) => q.rateType)).size).toBe(7);
    expect(await new FakeRateProvider().fetchQuotes()).toEqual(quotes);
  });

  it('can be scripted to fail', async () => {
    const fake = new FakeRateProvider();
    fake.failWith(new RateProviderFailure('provider_timeout'));
    const error = await failureOf(() => fake.fetchQuotes());
    expect(error.code).toBe('provider_timeout');
    fake.recover();
    expect(await fake.fetchQuotes()).toHaveLength(7);
  });
});
