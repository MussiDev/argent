import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import type { EmailMessage, EmailTransport, SendResult } from '../email-transport';

export interface MailpitTransportOptions {
  from: string;
  host?: string;
  port?: number;
  /** Deadline for the whole SMTP exchange. */
  timeoutMs?: number;
}

export const MAILPIT_DEFAULT_HOST = 'localhost';
export const MAILPIT_DEFAULT_PORT = 1025;
const DEFAULT_TIMEOUT_MS = 10_000;
const BASE64_LINE_LENGTH = 76;

interface SmtpReply {
  code: number;
  text: string;
}

/** Reads SMTP replies (possibly multi-line: `250-...` continued until `250 ...`) off a socket. */
class SmtpReader {
  private buffer = '';
  private lines: string[] = [];
  private waiting:
    { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void } | undefined;
  private failure: Error | undefined;

  constructor(socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => {
      this.fail(error);
    });
    socket.on('close', () => {
      this.fail(new Error('SMTP connection closed'));
    });
  }

  next(): Promise<SmtpReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.drain();
    });
  }

  fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.reject(this.failure);
  }

  private drain(): void {
    for (
      let newline = this.buffer.indexOf('\r\n');
      newline !== -1;
      newline = this.buffer.indexOf('\r\n')
    ) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 2);
      this.lines.push(line);
      // A space (or nothing) after the code ends the reply; a hyphen continues it.
      if (line.length <= 3 || line[3] === ' ') {
        const reply = { code: Number(line.slice(0, 3)), text: this.lines.join('\n') };
        this.lines = [];
        const waiting = this.waiting;
        this.waiting = undefined;
        waiting?.resolve(reply);
      }
    }
  }
}

function assertHeaderSafe(name: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`Refusing ${name} header value with a line break`);
}

/** RFC 2047 encoded-word, so non-ASCII subjects survive. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Lines(content: string): string {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += BASE64_LINE_LENGTH) {
    lines.push(encoded.slice(i, i + BASE64_LINE_LENGTH));
  }
  return lines.join('\r\n');
}

/** `Name <addr@x>` or `addr@x` → `addr@x`. */
function envelopeAddress(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return (match?.[1] ?? from).trim();
}

function buildMessage(from: string, message: EmailMessage, messageId: string): string {
  const boundary = `argent-${randomUUID()}`;
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.html),
    `--${boundary}--`,
  ];
  // Dot-stuffing: a line starting with "." would otherwise be read as the end of DATA.
  return lines.map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

/**
 * Minimal SMTP client for Mailpit (local development and e2e): plain SMTP, no TLS and no auth,
 * which is what Mailpit accepts on port 1025. Never used in production (the environment requires
 * `EMAIL_PROVIDER=resend` there).
 */
export class MailpitTransport implements EmailTransport {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: MailpitTransportOptions) {
    this.host = options.host ?? MAILPIT_DEFAULT_HOST;
    this.port = options.port ?? MAILPIT_DEFAULT_PORT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    assertHeaderSafe('From', this.options.from);
    assertHeaderSafe('To', message.to);
    assertHeaderSafe('Subject', message.subject);

    const sender = envelopeAddress(this.options.from);
    const domain = sender.split('@')[1] ?? 'localhost';
    const messageId = `<${randomUUID()}@${domain}>`;
    const data = buildMessage(this.options.from, message, messageId);

    const socket = connect({ host: this.host, port: this.port });
    const reader = new SmtpReader(socket);
    const timer = setTimeout(() => {
      reader.fail(new Error('SMTP exchange timed out'));
      socket.destroy();
    }, this.timeoutMs);

    // Errors carry the step and the reply code only: reply texts can echo the recipient address,
    // and errors end up in logs.
    const expect = async (step: string, expected: number, command?: string): Promise<void> => {
      if (command !== undefined) socket.write(`${command}\r\n`);
      const reply = await reader.next();
      if (reply.code !== expected) throw new Error(`SMTP ${step} failed: ${reply.code}`);
    };

    try {
      await expect('greeting', 220);
      await expect('EHLO', 250, `EHLO ${domain}`);
      await expect('MAIL', 250, `MAIL FROM:<${sender}>`);
      await expect('RCPT', 250, `RCPT TO:<${message.to}>`);
      await expect('DATA', 354, 'DATA');
      await expect('message', 250, `${data}\r\n.`);
      await expect('QUIT', 221, 'QUIT');
      return { messageId };
    } finally {
      clearTimeout(timer);
      socket.destroy();
    }
  }
}
