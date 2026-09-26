import { z } from 'zod';

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
    EMAIL_PROVIDER: z.enum(['console', 'mailpit', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional(),
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
    if (env.NODE_ENV === 'production') {
      for (const issue of productionIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
    }
  })
  .transform((env) => ({
    ...env,
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
