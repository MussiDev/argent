import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../src/shared/db/client';
import { cookieHeader, seedUser, type SessionCookies } from './helpers/session-client';
import { testDatabaseUrl } from './helpers/test-database';
import { testEnvSource, trustedHeaders } from './helpers/test-env';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const STARTUP_TIMEOUT_MS = 30_000;

let connection: DatabaseConnection;
const instances: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

/** Starts `src/server.ts` in its own Node process: nothing in memory is shared with the others. */
async function startInstance(): Promise<string> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...testEnvSource({ PORT: String(port), LOG_LEVEL: 'silent' }),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  instances.push(child);

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`instance exited: ${stderr}`);
    try {
      const health = await fetch(`${baseUrl}/health`);
      if (health.ok) return baseUrl;
    } catch {
      // Not listening yet: retried until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`instance did not start in time: ${stderr}`);
}

function sessionCookies(response: Response): SessionCookies {
  const values = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const separator = pair.indexOf('=');
    values.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
  }
  const accessToken = values.get('__Host-argent_at');
  const refreshToken = values.get('__Secure-argent_rt');
  if (!accessToken || !refreshToken) throw new Error('session cookies missing');
  return { accessToken, refreshToken };
}

function post(baseUrl: string, path: string, cookies?: SessionCookies, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...trustedHeaders,
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookieHeader(cookies) } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

function getSession(baseUrl: string, cookies: SessionCookies) {
  return fetch(`${baseUrl}/auth/session`, { headers: { Cookie: cookieHeader(cookies) } });
}

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  for (const child of instances) child.kill();
  await connection.pool.end();
});

describe('two API instances (NFR-09)', () => {
  it('accept on instance B a session created on instance A', async () => {
    const [instanceA, instanceB] = await Promise.all([startInstance(), startInstance()]);
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });

    const signedIn = await post(instanceA, '/auth/sign-in', undefined, {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    const onA = sessionCookies(signedIn);

    const readOnB = await getSession(instanceB, onA);
    expect(readOnB.status).toBe(200);
    expect(((await readOnB.json()) as { user: { id: string } }).user.id).toBe(userId);

    // Rotation on B is visible to A: the new token works there, the old one is reuse.
    const refreshedOnB = await post(instanceB, '/auth/refresh', onA);
    expect(refreshedOnB.status).toBe(200);
    const onB = sessionCookies(refreshedOnB);
    expect((await getSession(instanceA, onB)).status).toBe(200);

    // Sign-out on A ends the session on B.
    expect((await post(instanceA, '/auth/sign-out', onB)).status).toBe(204);
    expect((await getSession(instanceB, onB)).status).toBe(401);
  }, 60_000);
});
