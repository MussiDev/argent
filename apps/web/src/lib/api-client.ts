import {
  errorResponseSchema,
  passwordResetConfirmResponseSchema,
  passwordResetResponseSchema,
  refreshResponseSchema,
  registerResponseSchema,
  resendVerificationResponseSchema,
  sessionResponseSchema,
  signInResponseSchema,
  verifyEmailResponseSchema,
  type ErrorCode,
  type PasswordResetConfirmRequest,
  type PasswordResetConfirmResponse,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResendVerificationResponse,
  type SessionResponse,
  type SignInRequest,
  type SignInResponse,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
} from '@argent/shared';
import type { z } from 'zod';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Keys of the `errors` namespace in the i18n catalogs; the API only ever sends codes. */
export type ApiErrorKey =
  | 'invalidCredentials'
  | 'passwordTooShort'
  | 'passwordBreached'
  | 'tokenInvalid'
  | 'retryLater'
  | 'network'
  | 'unexpected'
  | 'unauthenticated'
  | 'emailNotVerified'
  | 'validationFailed';

/** `NETWORK`: the request never got an HTTP answer (offline, DNS, CORS, aborted). */
export type ApiFailureCode = ErrorCode | 'NETWORK';

export interface ApiFailure {
  ok: false;
  code: ApiFailureCode;
  messageKey: ApiErrorKey;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

const MESSAGE_KEY_BY_CODE: Record<ApiFailureCode, ApiErrorKey> = {
  INVALID_CREDENTIALS: 'invalidCredentials',
  PASSWORD_TOO_SHORT: 'passwordTooShort',
  PASSWORD_BREACHED: 'passwordBreached',
  TOKEN_INVALID: 'tokenInvalid',
  RATE_LIMITED: 'retryLater',
  PASSWORD_CHECK_UNAVAILABLE: 'retryLater',
  NETWORK: 'network',
  UNAUTHENTICATED: 'unauthenticated',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  VALIDATION_FAILED: 'validationFailed',
  NOT_FOUND: 'unexpected',
  INTERNAL: 'unexpected',
};

function failure(code: ApiFailureCode): ApiFailure {
  return { ok: false, code, messageKey: MESSAGE_KEY_BY_CODE[code] };
}

/** Required by the API's origin guard on state-changing requests (CSRF defence in depth). */
const REQUESTED_WITH = 'argent';

/** Web Locks name shared by every tab of the origin. */
const REFRESH_LOCK = 'argent-refresh';

interface RequestOptions<T> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** `null` for answers without a body (204). */
  response: z.ZodType<T> | null;
  /** Session-bound calls try `POST /auth/refresh` once when the access token is refused. */
  refreshOnUnauthenticated?: boolean;
}

export interface ApiClientOptions {
  /** The API origin, e.g. `https://api.argent.app`. */
  baseUrl: string;
  fetch?: FetchLike;
}

export interface ApiClient {
  register(body: RegisterRequest): Promise<ApiResult<RegisterResponse>>;
  verifyEmail(body: VerifyEmailRequest): Promise<ApiResult<VerifyEmailResponse>>;
  resendVerification(): Promise<ApiResult<ResendVerificationResponse>>;
  signIn(body: SignInRequest): Promise<ApiResult<SignInResponse>>;
  signOut(): Promise<ApiResult<undefined>>;
  getSession(): Promise<ApiResult<SessionResponse>>;
  requestPasswordReset(body: PasswordResetRequest): Promise<ApiResult<PasswordResetResponse>>;
  confirmPasswordReset(
    body: PasswordResetConfirmRequest,
  ): Promise<ApiResult<PasswordResetConfirmResponse>>;
}

/**
 * Browser client of the Express API. Session cookies are HttpOnly, so they travel only through
 * `credentials: 'include'`; bodies are parsed with the shared Zod schemas and error codes become
 * message keys, never API-provided text.
 */
export function createApiClient({
  baseUrl,
  fetch = (url, init) => globalThis.fetch(url, init),
}: ApiClientOptions): ApiClient {
  async function send<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { 'X-Requested-With': REQUESTED_WITH };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${options.path}`, {
        method: options.method,
        credentials: 'include',
        cache: 'no-store',
        // A redirect would carry credentials somewhere the client never chose to talk to.
        redirect: 'error',
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      return failure('NETWORK');
    }

    // Real `fetch` rejects on redirects with `redirect: 'error'`; this covers opaque or injected
    // 3xx answers so they are never read as API errors.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      return failure('NETWORK');
    }

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const parsed = errorResponseSchema.safeParse(payload);
      return failure(parsed.success ? parsed.data.code : 'INTERNAL');
    }
    if (options.response === null) return { ok: true, data: undefined as T };
    const parsed = options.response.safeParse(payload);
    return parsed.success ? { ok: true, data: parsed.data } : failure('INTERNAL');
  }

  // The API rotates the refresh token on every use and treats a second use of a rotated token as
  // theft (the whole session family is revoked). Refreshes are therefore serialized across tabs
  // with the Web Locks API, and inside the lock the refused request is retried first: if another
  // tab refreshed meanwhile, the new cookies already work and this tab must not refresh again.
  // Without Web Locks, a promise chain serializes them inside this tab only.
  let inTabQueue: Promise<unknown> = Promise.resolve();

  function withRefreshLock<T>(critical: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks) return locks.request(REFRESH_LOCK, critical);
    const run = inTabQueue.then(critical);
    inTabQueue = run.catch(() => undefined);
    return run;
  }

  async function recoverSession<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const retried = await send(options);
    if (retried.ok || retried.code !== 'UNAUTHENTICATED') return retried;
    const refreshed = await send({
      method: 'POST',
      path: '/auth/refresh',
      body: {},
      response: refreshResponseSchema,
    });
    if (refreshed.ok) return send(options);
    // An unreachable API says nothing about the session: offline users must not be signed out.
    return refreshed.code === 'NETWORK' ? failure('NETWORK') : retried;
  }

  async function request<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const result = await send(options);
    if (result.ok || result.code !== 'UNAUTHENTICATED' || !options.refreshOnUnauthenticated) {
      return result;
    }
    return withRefreshLock(() => recoverSession(options));
  }

  return {
    register: (body) =>
      request({ method: 'POST', path: '/auth/register', body, response: registerResponseSchema }),
    verifyEmail: (body) =>
      request({
        method: 'POST',
        path: '/auth/verify-email',
        body,
        response: verifyEmailResponseSchema,
      }),
    resendVerification: () =>
      request({
        method: 'POST',
        path: '/auth/verification/resend',
        body: {},
        response: resendVerificationResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    signIn: (body) =>
      request({ method: 'POST', path: '/auth/sign-in', body, response: signInResponseSchema }),
    signOut: () => request({ method: 'POST', path: '/auth/sign-out', body: {}, response: null }),
    getSession: () =>
      request({
        method: 'GET',
        path: '/auth/session',
        response: sessionResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    requestPasswordReset: (body) =>
      request({
        method: 'POST',
        path: '/auth/password-reset/request',
        body,
        response: passwordResetResponseSchema,
      }),
    confirmPasswordReset: (body) =>
      request({
        method: 'POST',
        path: '/auth/password-reset/confirm',
        body,
        response: passwordResetConfirmResponseSchema,
      }),
  };
}
