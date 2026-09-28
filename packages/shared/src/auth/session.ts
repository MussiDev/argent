import { z } from 'zod';
import { signedInUserSchema } from './sign-in';

/** Body of `POST /auth/refresh`, `/auth/sign-out` and `/auth/sign-out-all`: they read cookies only. */
export const emptyRequestSchema = z.object({});

export type EmptyRequest = z.infer<typeof emptyRequestSchema>;

/** `POST /auth/refresh`: the rotated tokens travel in cookies. */
export const refreshResponseSchema = z.object({ status: z.literal('refreshed') });

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/** `GET /auth/session`: who is signed in. */
export const sessionResponseSchema = z.object({
  user: signedInUserSchema.extend({ timeZone: z.string() }),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
