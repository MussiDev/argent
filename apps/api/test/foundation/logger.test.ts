import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { createLogger } from '../../src/shared/logging/logger';

const SECRETS = [
  'plain-password-1',
  'plain-password-2',
  'new-password-3',
  'reset-token-4',
  'verify-token-5',
  'argent_at=cookie-6',
  'argent_rt=cookie-7',
  'cookie-value-8',
  'bearer-9',
];

describe('logger redaction (NFR-01)', () => {
  it('removes password, newPassword, token and cookies from every log line', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });

    logger.info({ password: 'plain-password-1', token: 'verify-token-5' }, 'top level');
    logger.info(
      {
        body: {
          password: 'plain-password-2',
          newPassword: 'new-password-3',
          token: 'reset-token-4',
        },
        req: { headers: { cookie: 'argent_at=cookie-6', authorization: 'Bearer bearer-9' } },
        res: { headers: { 'set-cookie': 'argent_rt=cookie-7' } },
        cookies: { argent_at: 'cookie-value-8' },
      },
      'nested',
    );

    const output = lines.join('\n');
    expect(lines).toHaveLength(2);
    for (const secret of SECRETS) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
  });
});

describe('logger redaction of email addresses (PII)', () => {
  it('removes email, toEmail, to_email and message.to at the top level and nested', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });

    logger.info(
      { email: 'a1@example.com', to_email: 'a2@example.com', toEmail: 'a3@example.com' },
      'top level',
    );
    logger.info(
      {
        row: { to_email: 'a4@example.com', toEmail: 'a5@example.com' },
        message: { to: 'a6@example.com' },
        body: { user: { email: 'a7@example.com' } },
      },
      'nested',
    );

    const output = lines.join('\n');
    expect(output).not.toMatch(/a\d@example\.com/);
    expect(output).toContain('[REDACTED]');
  });
});

describe('logger redaction scope', () => {
  it('keeps an unrelated field named to, while toEmail, to_email and message.to are redacted', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });

    logger.info(
      {
        transfer: { from: 'account-ars', to: 'account-usd' },
        message: { to: 'b1@example.com', subject: 'Hola' },
        toEmail: 'b2@example.com',
        row: { to_email: 'b3@example.com' },
      },
      'mixed',
    );

    const [line] = lines;
    const entry = JSON.parse(line ?? '{}') as Record<string, unknown>;
    expect(entry.transfer).toEqual({ from: 'account-ars', to: 'account-usd' });
    expect(entry.message).toEqual({ to: '[REDACTED]', subject: 'Hola' });
    expect(entry.toEmail).toBe('[REDACTED]');
    expect(entry.row).toEqual({ to_email: '[REDACTED]' });
    expect(line).not.toMatch(/b\d@example\.com/);
  });
});

describe('logger redaction of OAuth secrets (SAST I-2)', () => {
  const OAUTH_KEYS = [
    'state',
    'id_token',
    'idToken',
    'code_verifier',
    'codeVerifier',
    'client_secret',
    'clientSecret',
    'binding',
    'nonce',
  ];

  function capture() {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });
    return { lines, logger };
  }

  const secrets = (where: string, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, `oauth-${where}-${key}-secret`]));

  it('removes every OAuth key at the top level, one level and two levels deep', () => {
    const { lines, logger } = capture();

    logger.info(secrets('top', OAUTH_KEYS), 'top level');
    logger.info({ callback: secrets('one', OAUTH_KEYS) }, 'one level');
    logger.info({ req: { callback: secrets('two', OAUTH_KEYS) } }, 'two levels');

    const output = lines.join('\n');
    expect(lines).toHaveLength(3);
    expect(output).not.toMatch(/oauth-\w+-\w+-secret/);
    const [top] = lines;
    const entry = JSON.parse(top ?? '{}') as Record<string, unknown>;
    for (const key of OAUTH_KEYS) {
      expect(entry[key]).toBe('[REDACTED]');
    }
  });

  it('removes the authorization code from a query or body, at one and two levels deep', () => {
    const { lines, logger } = capture();

    logger.info({ query: secrets('query', ['code']) }, 'query');
    logger.info({ body: secrets('body', ['code']) }, 'body');
    logger.info({ req: { query: secrets('reqquery', ['code']) } }, 'request query');
    logger.info({ req: { body: secrets('reqbody', ['code']) } }, 'request body');

    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).not.toMatch(/oauth-\w+-code-secret/);
  });

  it('keeps a bare code, which is an error code (HTTP body code, err.code)', () => {
    const { lines, logger } = capture();

    logger.error({ code: 'INTERNAL', err: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });

    const [line] = lines;
    expect(line).toContain('"code":"INTERNAL"');
    expect(line).toContain('"code":"ECONNRESET"');
  });
});

describe('logger error serialization (NFR-01)', () => {
  function pgUniqueViolation(): Error {
    return Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      {
        severity: 'ERROR',
        code: '23505',
        constraint: 'users_email_key',
        table: 'users',
        detail: 'Key (email)=(victim@example.com) already exists.',
      },
    );
  }

  function queryError(): DrizzleQueryError {
    return new DrizzleQueryError(
      'insert into "users" ("email", "password_hash") values ($1, $2)',
      ['victim@example.com', 'hash-secret-value'],
      pgUniqueViolation(),
    );
  }

  it('drops query params and pg details from a failed query, keeping query and pg metadata', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });

    logger.error({ err: queryError() }, 'direct');
    logger.error({ err: new Error('use case failed', { cause: queryError() }) }, 'wrapped');

    const output = lines.join('\n');
    expect(output).not.toContain('victim@example.com');
    expect(output).not.toContain('hash-secret-value');
    expect(output).toContain('Failed query');
    expect(output).toContain('values ($1, $2)');
    expect(output).toContain('users_email_key');
    expect(output).toContain('23505');
  });

  it('logs a non-Error thrown value by type only', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });

    logger.error({ err: { email: 'thrown@example.com', password: 'thrown-secret' } }, 'odd throw');
    logger.error({ err: 'string-with-secret-value' }, 'string throw');

    const output = lines.join('\n');
    expect(output).not.toContain('thrown@example.com');
    expect(output).not.toContain('thrown-secret');
    expect(output).not.toContain('string-with-secret-value');
    expect(output).toContain('[non-error thrown: object]');
    expect(output).toContain('[non-error thrown: string]');
  });

  it('falls back to a fixed shape when serializing the error itself throws', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });
    const hostile = new Error('hostile');
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('getter exploded');
      },
    });

    expect(() => {
      logger.error({ err: hostile }, 'hostile error');
    }).not.toThrow();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"message":"[unserializable error]"');
    expect(lines[0]).toContain('"type":"Error"');
  });

  it('replaces pg data-exception messages (SQLSTATE 22xxx), which can echo input values', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });
    const dataException = Object.assign(
      new Error('invalid input syntax for type uuid: "victim@example.com"'),
      { severity: 'ERROR', code: '22P02', routine: 'string_to_uuid' },
    );

    logger.error({ err: new DrizzleQueryError('select 1 where id = $1', [], dataException) }, 'x');

    const output = lines.join('\n');
    expect(output).not.toContain('victim@example.com');
    expect(output).toContain('pg data exception 22P02');
    expect(output).toContain('"code":"22P02"');
  });
});
