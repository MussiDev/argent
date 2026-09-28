import { z } from 'zod';

/** Sender for local transports (console, Mailpit) when EMAIL_FROM is unset. */
const LOCAL_EMAIL_FROM = 'Argent <no-reply@argent.local>';

const jwtSecretSchema = z.string().min(32, 'must be at least 32 characters (256 bits)');

/** Google's OpenID Connect endpoints; only a local fake OIDC server replaces them, never in production. */
export const GOOGLE_ENDPOINT_DEFAULTS = {
  GOOGLE_AUTHORIZATION_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_JWKS_URL: 'https://www.googleapis.com/oauth2/v3/certs',
  GOOGLE_ISSUER: 'https://accounts.google.com',
} as const;

type GoogleEndpoint = keyof typeof GOOGLE_ENDPOINT_DEFAULTS;
const GOOGLE_ENDPOINTS = Object.keys(GOOGLE_ENDPOINT_DEFAULTS) as GoogleEndpoint[];

/** An empty value (a blank line copied from .env.example) counts as unset. */
function optionalSetting<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

function googleEndpoint(name: GoogleEndpoint) {
  return z.preprocess(
    (value) => (value === '' || value === undefined ? GOOGLE_ENDPOINT_DEFAULTS[name] : value),
    z.url(),
  );
}

interface RawEnv {
  JWT_SECRET: string;
  EMAIL_PROVIDER: string;
  BREACH_CHECKER: string;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  WEB_BASE_URL: string;
  TRUST_PROXY: number;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_AUTHORIZATION_URL: string;
  GOOGLE_TOKEN_URL: string;
  GOOGLE_JWKS_URL: string;
  GOOGLE_ISSUER: string;
}

/** Settings that are fine locally but unsafe in production: fakes, plain http, no proxy trust. */
function productionIssues(env: RawEnv): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  if (env.JWT_SECRET.startsWith('change-me')) {
    issues.push({ path: ['JWT_SECRET'], message: 'must not be the .env.example placeholder' });
  }
  if (env.EMAIL_PROVIDER !== 'resend') {
    issues.push({ path: ['EMAIL_PROVIDER'], message: 'must be resend in production' });
  }
  if (env.BREACH_CHECKER !== 'hibp') {
    issues.push({ path: ['BREACH_CHECKER'], message: 'must be hibp in production' });
  }
  for (const name of ['WEB_ORIGIN', 'API_ORIGIN', 'WEB_BASE_URL'] as const) {
    if (!URL.canParse(env[name]) || new URL(env[name]).protocol !== 'https:') {
      issues.push({ path: [name], message: 'must use https: in production' });
    }
  }
  if (env.TRUST_PROXY < 1) {
    issues.push({
      path: ['TRUST_PROXY'],
      message: 'must be at least 1 in production (TLS ends at the hosting proxy)',
    });
  }
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const) {
    if (!env[name]) issues.push({ path: [name], message: 'required in production' });
  }
  // A misconfigured endpoint would send the client secret, or accept ID tokens, somewhere else.
  for (const name of GOOGLE_ENDPOINTS) {
    if (env[name] !== GOOGLE_ENDPOINT_DEFAULTS[name]) {
      issues.push({ path: [name], message: "must be Google's endpoint in production" });
    }
  }
  return issues;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    JWT_SECRET: jwtSecretSchema,
    WEB_ORIGIN: z.url(),
    API_ORIGIN: z.url(),
    WEB_BASE_URL: z.url(),
    // No default: which provider delivers email must be a deliberate choice per environment.
    EMAIL_PROVIDER: z.enum(['console', 'mailpit', 'resend']),
    RESEND_API_KEY: z.string().optional(),
    /** Sender of auth emails; required with Resend, whose sending domain must be verified. */
    EMAIL_FROM: z
      .string()
      .min(3)
      .max(254)
      .regex(/^[^\r\n]+$/, 'must be a single line')
      .optional(),
    BREACH_CHECKER: z.enum(['hibp', 'fake']).default('hibp'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Unset outside production disables Google sign-in. */
    GOOGLE_CLIENT_ID: optionalSetting(z.string().max(255)),
    GOOGLE_CLIENT_SECRET: optionalSetting(z.string().max(255)),
    GOOGLE_AUTHORIZATION_URL: googleEndpoint('GOOGLE_AUTHORIZATION_URL'),
    GOOGLE_TOKEN_URL: googleEndpoint('GOOGLE_TOKEN_URL'),
    GOOGLE_JWKS_URL: googleEndpoint('GOOGLE_JWKS_URL'),
    GOOGLE_ISSUER: googleEndpoint('GOOGLE_ISSUER'),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'required when EMAIL_PROVIDER=resend',
      });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'required when EMAIL_PROVIDER=resend',
      });
    }
    // Outside production the Resend SDK prints raw provider errors (which can echo the recipient
    // address) to the console, bypassing the logger's redaction.
    if (env.EMAIL_PROVIDER === 'resend' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'resend requires NODE_ENV=production',
      });
    }
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'required when GOOGLE_CLIENT_ID is set',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const issue of productionIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    }
  })
  .transform((env) => ({
    ...env,
    // Only console and mailpit can get here without one (resend requires it above).
    EMAIL_FROM: env.EMAIL_FROM ?? LOCAL_EMAIL_FROM,
    WEB_ORIGIN: new URL(env.WEB_ORIGIN).origin,
    API_ORIGIN: new URL(env.API_ORIGIN).origin,
  }));

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment; throws listing the invalid variable names, never values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
