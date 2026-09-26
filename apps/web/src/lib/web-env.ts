import { z } from 'zod';

/** Where `pnpm --filter api dev` listens; used by the dev CSP when API_ORIGIN is not set. */
export const DEV_API_ORIGIN = 'http://localhost:4000';

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_ORIGIN: z
      .url()
      .transform((value) => new URL(value).origin)
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.API_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_ORIGIN'],
        message: 'required in production (CSP connect-src)',
      });
    }
  })
  .transform((env) => ({
    ...env,
    API_ORIGIN: env.API_ORIGIN ?? (env.NODE_ENV === 'development' ? DEV_API_ORIGIN : undefined),
  }));

export type WebEnv = z.infer<typeof webEnvSchema>;

/** Validates the server-side environment of the web app; throws naming the invalid variables. */
export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    API_ORIGIN: source.API_ORIGIN === '' ? undefined : source.API_ORIGIN,
  });
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid web environment: ${details}`);
  }
  return result.data;
}
