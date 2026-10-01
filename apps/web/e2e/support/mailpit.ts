import { expect } from '@playwright/test';

/** Mailpit's HTTP API; the e2e API delivers email through Mailpit's SMTP port (EMAIL_PROVIDER=mailpit). */
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export type EmailPage = 'verify-email' | 'reset-password';

interface MailpitSummary {
  ID: string;
  Subject: string;
}

interface MailpitSearch {
  messages: MailpitSummary[];
}

interface MailpitMessage {
  Text: string;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

async function messagesTo(address: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const { messages } = await getJson<MailpitSearch>(`/api/v1/search?query=${query}`);
  return messages;
}

/** Waits until `address` has received `count` emails and returns them, newest first. */
export async function waitForEmails(address: string, count: number): Promise<MailpitSummary[]> {
  let messages: MailpitSummary[] = [];
  await expect
    .poll(
      async () => {
        messages = await messagesTo(address);
        return messages.length;
      },
      { timeout: 30_000, message: `waiting for ${count} email(s) to ${address}` },
    )
    .toBeGreaterThanOrEqual(count);
  return messages;
}

/** The link to `page` in the newest email to `address`, once `count` emails have arrived. */
export async function emailLink(address: string, page: EmailPage, count = 1): Promise<URL> {
  const [newest] = await waitForEmails(address, count);
  if (!newest) throw new Error(`no email to ${address}`);
  const message = await getJson<MailpitMessage>(`/api/v1/message/${newest.ID}`);
  const match = new RegExp(`https?://\\S+/(?:es|en)/${page}\\?token=[A-Za-z0-9_-]{43}`).exec(
    message.Text,
  );
  if (!match) throw new Error(`no ${page} link in the email to ${address}`);
  return new URL(match[0]);
}

/** Waits until an email with exactly `subject` reaches `address`. */
export async function waitForSubject(address: string, subject: string): Promise<void> {
  await expect
    .poll(async () => (await messagesTo(address)).map((message) => message.Subject), {
      timeout: 30_000,
      message: `waiting for "${subject}" to ${address}`,
    })
    .toContain(subject);
}
