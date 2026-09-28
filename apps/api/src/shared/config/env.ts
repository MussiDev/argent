import { z } from 'zod';

/** Sender for local transports (console, Mailpit) when EMAIL_FROM is unset. */
const LOCAL_EMAIL_FROM = 'Argent <no-reply@argent.local>';

const jwtSecretSchema = z.string().min(32, 'must be at least 32 characters (256 bits)');

interface RawEnv {
  JWT_SECRET: string;
  EMAIL_PROVIDER: string;
  BREACH_CHECKER: string;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  WEB_BASE_URL: string;
  TRUST_PROXY: number;
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
