import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmailTransport } from '../../src/identity/infrastructure/email/email-transport';
import { ConsoleTransport } from '../../src/identity/infrastructure/email/transports/console-transport';
import { MailpitTransport } from '../../src/identity/infrastructure/email/transports/mailpit-transport';
import {
  RESEND_TIMEOUT_MS,
  ResendTransport,
  type ResendClient,
} from '../../src/identity/infrastructure/email/transports/resend-transport';
import { createLogger } from '../../src/shared/logging/logger';

const IDEMPOTENCY_KEY = '0b7c6f1e-5d4a-4c3b-9a8f-7e6d5c4b3a21:1';
const MESSAGE = {
  idempotencyKey: IDEMPOTENCY_KEY,
  to: 'ana@example.com',
  subject: 'Confirmá tu email',
  text: 'Abrí este enlace: https://app.argent.test/es/verify-email?token=abc',
  html: '<p><a href="https://app.argent.test/es/verify-email?token=abc">Confirmar</a></p>',
};
const FROM = 'Pesly <no-reply@pesly.test>';
const silent = createLogger({ level: 'silent' });

interface SmtpSession {
  commands: string[];
  data: string;
}

/** A tiny in-process SMTP server that accepts one message, like Mailpit does. */
function fakeSmtpServer(options: { rejectRcpt?: boolean } = {}) {
  const sessions: SmtpSession[] = [];
  const server: Server = createServer((socket: Socket) => {
    const session: SmtpSession = { commands: [], data: '' };
    sessions.push(session);
    let inData = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.write('220 fake.smtp ESMTP ready\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          session.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 2.0.0 Ok: queued as FAKE123\r\n');
          continue;
        }
        const newline = buffer.indexOf('\r\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        session.commands.push(line);
        const verb = line.split(' ')[0]?.toUpperCase();
        if (verb === 'EHLO') socket.write('250-fake.smtp\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        else if (verb === 'MAIL') socket.write('250 2.1.0 Ok\r\n');
        else if (verb === 'RCPT')
          socket.write(
            options.rejectRcpt
              ? '550 5.1.1 <ana@example.com>: Recipient address rejected\r\n'
              : '250 2.1.5 Ok\r\n',
          );
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 2.0.0 Bye\r\n');
        } else if (verb === 'RSET') socket.write('250 Ok\r\n');
        else socket.write('502 Unknown command\r\n');
      }
    });
  });
  return new Promise<{ server: Server; port: number; sessions: SmtpSession[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, sessions });
    });
  });
}

/** Decodes the base64 MIME parts of a message so assertions can read its text. */
function decodedParts(data: string): string {
  return [
    ...data.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n(?:--|$)/g,
    ),
  ]
    .map((match) => Buffer.from((match[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8'))
    .join('\n');
}

let openServer: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!openServer) {
      resolve();
      return;
    }
    openServer.close(() => {
      resolve();
    });
  });
  openServer = undefined;
});

describe('MailpitTransport (SMTP)', () => {
  it('delivers a UTF-8 multipart message over SMTP', async () => {
    const { server, port, sessions } = await fakeSmtpServer();
    openServer = server;
    const transport = new MailpitTransport({ host: '127.0.0.1', port, from: FROM });

    const result = await transport.send(MESSAGE);

    expect(result.messageId).toMatch(/^<.+@.+>$/);
    const [session] = sessions;
    expect(session?.commands[0]).toMatch(/^EHLO /);
    expect(session?.commands).toContain('MAIL FROM:<no-reply@pesly.test>');
    expect(session?.commands).toContain('RCPT TO:<ana@example.com>');
    expect(session?.commands.at(-1)).toBe('QUIT');
    expect(session?.data).toContain('To: ana@example.com');
    expect(session?.data).toContain(`From: ${FROM}`);
    expect(session?.data).toContain(
      `Subject: =?UTF-8?B?${Buffer.from(MESSAGE.subject).toString('base64')}?=`,
    );
    expect(session?.data).toContain('multipart/alternative');
    const decoded = decodedParts(session?.data ?? '');
    expect(decoded).toContain(MESSAGE.text);
    expect(decoded).toContain(MESSAGE.html);
  });

  it('rejects when the server refuses the recipient', async () => {
    const { server, port } = await fakeSmtpServer({ rejectRcpt: true });
    openServer = server;
    const transport = new MailpitTransport({ host: '127.0.0.1', port, from: FROM });

    const error: unknown = await transport.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/RCPT/);
    expect((error as Error).message).toMatch(/550/);
    // The reply text echoes the address; errors end up in logs, so it is left out.
    expect((error as Error).message).not.toContain('ana@example.com');
  });

  it('rejects when nothing listens on the port', async () => {
    const transport = new MailpitTransport({ host: '127.0.0.1', port: 1, from: FROM });

    await expect(transport.send(MESSAGE)).rejects.toThrow();
  });

  it('refuses header values with line breaks (header injection)', async () => {
    const transport = new MailpitTransport({ host: '127.0.0.1', port: 1, from: FROM });

    await expect(
      transport.send({ ...MESSAGE, subject: 'Hi\r\nBcc: victim@example.com' }),
    ).rejects.toThrow(/header/i);
  });
});

describe('ResendTransport', () => {
  it('sends through the Resend client and returns its message id', async () => {
    const calls: unknown[] = [];
    const client: ResendClient = {
      emails: {
        send: (payload, options) => {
          calls.push(payload, { idempotencyKey: options.idempotencyKey });
          return Promise.resolve({ data: { id: 're_123' }, error: null });
        },
      },
    };

    const result = await new ResendTransport({ client, from: FROM }).send(MESSAGE);

    expect(result).toEqual({ messageId: 're_123' });
    expect(calls).toEqual([
      {
        from: FROM,
        to: [MESSAGE.to],
        subject: MESSAGE.subject,
        text: MESSAGE.text,
        html: MESSAGE.html,
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ]);
  });

  it('turns a Resend error response into a thrown error', async () => {
    const client: ResendClient = {
      emails: {
        send: () =>
          Promise.resolve({
            data: null,
            error: { name: 'rate_limit_exceeded', message: 'Too many requests' },
          }),
      },
    };

    await expect(new ResendTransport({ client, from: FROM }).send(MESSAGE)).rejects.toThrow(
      /rate_limit_exceeded/,
    );
  });
});

describe('ResendTransport failures', () => {
  it('keeps the provider message (which may echo the address) out of the error', async () => {
    const client: ResendClient = {
      emails: {
        send: () =>
          Promise.resolve({
            data: null,
            error: {
              name: 'validation_error',
              message: 'Invalid `to` field: ana@example.com',
              statusCode: 422,
            },
          }),
      },
    };

    const error: unknown = await new ResendTransport({ client, from: FROM })
      .send(MESSAGE)
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toMatch(/validation_error/);
    expect((error as Error).message).toMatch(/422/);
    expect((error as Error).message).not.toContain('ana@example.com');
  });

  it('gives up after timeoutMs (default 10 s) when the SDK call hangs', async () => {
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
    const client: ResendClient = { emails: { send: () => new Promise(() => undefined) } };
    const transport = new ResendTransport({ client, from: FROM, timeoutMs: 50 });

    const startedAt = performance.now();
    await expect(transport.send(MESSAGE)).rejects.toThrow(/timed out/);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});

describe('ResendTransport timeout', () => {
  it('aborts a call that exceeds the timeout through its signal and passes the idempotency key through', async () => {
    let received: { idempotencyKey: string; signal: AbortSignal } | undefined;
    const client: ResendClient = {
      emails: {
        // Like fetch: pending until the signal aborts, then rejected with the abort reason.
        send: (_payload, options) => {
          received = options;
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(options.signal.reason as Error);
            });
          });
        },
      },
    };
    const transport = new ResendTransport({ client, from: FROM, timeoutMs: 50 });

    await expect(transport.send(MESSAGE)).rejects.toThrow(/timed out/);

    expect(received?.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(received?.signal.aborted).toBe(true);
  });

  it('does not abort a call that answers in time', async () => {
    let signal: AbortSignal | undefined;
    const client: ResendClient = {
      emails: {
        send: (_payload, options) => {
          signal = options.signal;
          return Promise.resolve({ data: { id: 're_1' }, error: null });
        },
      },
    };

    await new ResendTransport({ client, from: FROM, timeoutMs: 50 }).send(MESSAGE);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(signal?.aborted).toBe(false);
  });
});

describe('ConsoleTransport', () => {
  it('writes the subject and the text body, without the recipient address', async () => {
    const written: string[] = [];
    const transport = new ConsoleTransport({ write: (chunk) => written.push(chunk) });

    const result = await transport.send(MESSAGE);

    expect(result.messageId).toMatch(/^console-/);
    const output = written.join('');
    expect(output).toContain(MESSAGE.subject);
    expect(output).toContain(MESSAGE.text);
    expect(output).not.toContain(MESSAGE.to);
  });
});

describe('createEmailTransport', () => {
  it('selects the transport named by EMAIL_PROVIDER', () => {
    const base = { EMAIL_FROM: FROM, RESEND_API_KEY: undefined };
    expect(createEmailTransport({ ...base, EMAIL_PROVIDER: 'console' }, silent)).toBeInstanceOf(
      ConsoleTransport,
    );
    expect(createEmailTransport({ ...base, EMAIL_PROVIDER: 'mailpit' }, silent)).toBeInstanceOf(
      MailpitTransport,
    );
    // Constructing the Resend client makes no network call; it is never used to send in tests.
    expect(
      createEmailTransport(
        { ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' },
        silent,
      ),
    ).toBeInstanceOf(ResendTransport);
  });

  it('refuses resend without an API key', () => {
    expect(() =>
      createEmailTransport(
        { EMAIL_FROM: FROM, RESEND_API_KEY: undefined, EMAIL_PROVIDER: 'resend' },
        silent,
      ),
    ).toThrow(/RESEND_API_KEY/);
  });
});
