import type { Express } from 'express';
import request, { type Response } from 'supertest';
import type { Language } from '../../src/identity/domain/account-defaults';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { trustedHeaders } from './test-env';

export const ACCESS_COOKIE = '__Host-argent_at';
export const REFRESH_COOKIE = '__Secure-argent_rt';
export const DELETION_GRANT_COOKIE = '__Secure-argent_del';

export interface ParsedCookie {
  name: string;
  value: string;
  /** Lower-cased attribute names mapped to their value (`true` for flags such as HttpOnly). */
  attributes: Record<string, string | true>;
}

function setCookieHeaders(response: Response): string[] {
  const header: unknown = response.headers['set-cookie'];
  if (Array.isArray(header)) return header.filter((line) => typeof line === 'string');
  return typeof header === 'string' ? [header] : [];
}

export function parseSetCookies(response: Response): Map<string, ParsedCookie> {
  const cookies = new Map<string, ParsedCookie>();
  for (const line of setCookieHeaders(response)) {
    const [pair = '', ...rest] = line.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const attributes: Record<string, string | true> = {};
    for (const attribute of rest) {
      const equals = attribute.indexOf('=');
      if (equals === -1) attributes[attribute.toLowerCase()] = true;
      else attributes[attribute.slice(0, equals).toLowerCase()] = attribute.slice(equals + 1);
    }
    cookies.set(name, { name, value: decodeURIComponent(pair.slice(separator + 1)), attributes });
  }
  return cookies;
}

/** The session a signed-in browser holds: the two cookie values. */
export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
}

export function sessionFrom(response: Response): SessionCookies {
  const cookies = parseSetCookies(response);
  const accessToken = cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookies.get(REFRESH_COOKIE)?.value;
  if (!accessToken || !refreshToken) {
    throw new Error(`Response ${response.status} did not set both session cookies`);
  }
  return { accessToken, refreshToken };
}

/** `Cookie` header value for the given cookies (tests send cookies by hand: they are Secure). */
export function cookieHeader(cookies: Partial<SessionCookies>): string {
  const pairs: string[] = [];
  if (cookies.accessToken !== undefined) {
    pairs.push(`${ACCESS_COOKIE}=${encodeURIComponent(cookies.accessToken)}`);
  }
  if (cookies.refreshToken !== undefined) {
    pairs.push(`${REFRESH_COOKIE}=${encodeURIComponent(cookies.refreshToken)}`);
  }
  return pairs.join('; ');
}

export function signIn(app: Express, email: string, password: string, ip?: string) {
  const call = request(app).post('/auth/sign-in').set(trustedHeaders);
  if (ip) call.set('X-Forwarded-For', ip);
  return call.send({ email, password });
}

export function refresh(app: Express, cookies: Partial<SessionCookies>) {
  return request(app)
    .post('/auth/refresh')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send();
}

export function currentSession(app: Express, cookies: Partial<SessionCookies>) {
  return request(app).get('/auth/session').set('Cookie', cookieHeader(cookies));
}

export function signOut(app: Express, cookies: Partial<SessionCookies>) {
  return request(app)
    .post('/auth/sign-out')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send();
}

export function signOutAll(app: Express, cookies: Partial<SessionCookies>) {
  return request(app)
    .post('/auth/sign-out-all')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send();
}

export interface SeedUserOptions {
  email: string;
  password: string;
  verified?: boolean;
  language?: Language;
  timeZone?: string;
}

const hashes = new Map<string, Promise<string>>();

/** Argon2id is slow on purpose; each distinct password is hashed once per test run. */
function hashOnce(password: string): Promise<string> {
  let hash = hashes.get(password);
  if (!hash) {
    hash = new Argon2idPasswordHasher().hash(password);
    hashes.set(password, hash);
  }
  return hash;
}

/** Inserts a user directly (no registration round trip); returns its id. */
export async function seedUser(
  connection: DatabaseConnection,
  {
    email,
    password,
    verified = true,
    language = 'es',
    timeZone = 'America/Cordoba',
  }: SeedUserOptions,
): Promise<string> {
  const users = new DrizzleUserRepository(connection.db);
  const user = await users.create({
    email: Email.parse(email),
    passwordHash: await hashOnce(password),
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone,
    language,
  });
  if (verified) await users.markEmailVerified(user.id, new Date());
  return user.id;
}

/** `Cookie` header value that carries a deletion grant next to the session cookies. */
export function cookieHeaderWithGrant(
  cookies: Partial<SessionCookies>,
  grantToken: string,
): string {
  const pairs = [
    cookieHeader(cookies),
    `${DELETION_GRANT_COOKIE}=${encodeURIComponent(grantToken)}`,
  ];
  return pairs.filter((pair) => pair !== '').join('; ');
}

export interface DeleteAccountOptions {
  body?: unknown;
  /** A grant token sent in its cookie, as the browser does after Google re-authentication. */
  grantToken?: string;
  ip?: string;
}

/** `POST /profile/delete` as a browser sends it. */
export function deleteAccount(
  app: Express,
  cookies: Partial<SessionCookies>,
  { body = {}, grantToken, ip }: DeleteAccountOptions = {},
) {
  const call = request(app)
    .post('/profile/delete')
    .set(trustedHeaders)
    .set(
      'Cookie',
      grantToken === undefined ? cookieHeader(cookies) : cookieHeaderWithGrant(cookies, grantToken),
    );
  if (ip) call.set('X-Forwarded-For', ip);
  return call.send(body as object);
}
