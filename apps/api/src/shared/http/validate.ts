import type { CookieOptions, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { HttpError } from './error-handler';

type ObjectSchema = z.ZodObject;

export interface InputSchemas {
  params?: ObjectSchema;
  query?: ObjectSchema;
  body?: ObjectSchema;
}

/**
 * `z.looseObject` is assignable to `z.object` in the type system, so it is rejected explicitly:
 * a loose schema's output admits any string key, a stripping (or strict) one does not (R-10).
 */
type StrippingOnly<S extends InputSchemas> = {
  [K in keyof S]: S[K] extends z.ZodObject<z.ZodRawShape, infer Config>
    ? string extends keyof Config['out']
      ? never
      : S[K]
    : never;
};

type Infer<T> = T extends ObjectSchema ? z.infer<T> : undefined;

export interface ValidatedInput<S extends InputSchemas> {
  params: Infer<S['params']>;
  query: Infer<S['query']>;
  body: Infer<S['body']>;
}

/**
 * The only response operations a handler needs. Express' `Response` is not exposed because
 * `res.req` leads back to the raw, unvalidated request.
 */
export interface ResponseFacade {
  status(code: number): ResponseFacade;
  json(body: unknown): void;
  cookie(name: string, value: string, options: CookieOptions): ResponseFacade;
  clearCookie(name: string, options?: CookieOptions): ResponseFacade;
  setHeader(name: string, value: string): ResponseFacade;
  sendStatus(code: number): void;
  end(): void;
}

function responseFacade(res: Response): ResponseFacade {
  const facade: ResponseFacade = {
    status(code) {
      res.status(code);
      return facade;
    },
    json(body) {
      res.json(body);
    },
    cookie(name, value, options) {
      res.cookie(name, value, options);
      return facade;
    },
    clearCookie(name, options) {
      res.clearCookie(name, options);
      return facade;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return facade;
    },
    sendStatus(code) {
      res.sendStatus(code);
    },
    end() {
      res.end();
    },
  };
  return facade;
}

/** cookie-parser turns `j:`-prefixed values into objects; only plain string cookies are kept. */
function stringCookies(cookies: unknown): Readonly<Record<string, string>> {
  if (typeof cookies !== 'object' || cookies === null) return {};
  return Object.fromEntries(
    Object.entries(cookies).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * What a handler may use besides its validated input. The raw request is deliberately absent so
 * no handler can read an unvalidated `req.body`, `req.query` or `req.params`.
 */
export interface HandlerContext {
  res: ResponseFacade;
  cookies: Readonly<Record<string, string>>;
  ip: string | undefined;
  requestId: string;
}

const PARTS = ['params', 'query', 'body'] as const;

/**
 * The single validation middleware: parses params, query and body with the given Zod schemas
 * (unknown keys are stripped) and hands the handler only the parsed, typed values.
 * Failures become 400 `VALIDATION_FAILED` listing the failing paths, never the submitted values.
 */
export function validate<S extends InputSchemas>(
  schemas: S & StrippingOnly<S>,
  handler: (input: ValidatedInput<S>, context: HandlerContext) => unknown,
): RequestHandler {
  const partSchemas: InputSchemas = schemas;
  return async (req, res) => {
    const parsed: Partial<Record<(typeof PARTS)[number], unknown>> = {};
    const fields = new Set<string>();

    for (const part of PARTS) {
      const schema = partSchemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        parsed[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          fields.add([part, ...issue.path.map(String)].join('.'));
        }
      }
    }

    if (fields.size > 0) {
      throw new HttpError(400, 'VALIDATION_FAILED', [...fields]);
    }

    const context: HandlerContext = {
      res: responseFacade(res),
      cookies: stringCookies(req.cookies),
      ip: req.ip,
      requestId: res.locals.requestId,
    };
    // Each present part was produced by its own schema above, so the shape matches ValidatedInput<S>.
    await handler(parsed as ValidatedInput<S>, context);
  };
}
