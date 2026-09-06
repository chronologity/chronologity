import type { z } from "zod";
import type { ApiClient } from "../client.js";
import { queryString } from "../query.js";

/**
 * One thing the API can do.
 *
 * **A descriptor rather than a hand-written function**, and the difference is
 * what makes the completeness check possible. A hundred and sixty-three plain
 * functions are a hundred and sixty-three things a test cannot see: it could
 * check that a name exists, but not what it calls. A descriptor carries its own
 * method and path, so a test can read every operation this package offers and
 * compare that against every operation the API documents — which is the only
 * mechanism that notices the one somebody forgot.
 *
 * It is also less to write and less to get wrong. Every operation is the same
 * four facts — a method, a path, what goes up, what comes back — and writing
 * them as data rather than as prose means the differences between operations are
 * the only thing on the page.
 *
 * **Nothing here decides anything.** No operation retries by itself, interprets
 * a refusal, or reshapes a response: it names a route and the contract schemas
 * either side of it. Server business logic never moves into the client
 * (`monorepo.md:1110`), and the way to keep that true is for there to be nowhere
 * here for it to go.
 */

/** The methods this API uses. */
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** What an operation is, before it is called. */
export interface Operation<Arguments, Result> {
  readonly method: Method;
  /**
   * The path as the API documents it, with `:name` placeholders.
   *
   * Kept alongside the built path because the completeness check compares
   * against the OpenAPI document, which names parameters rather than filling
   * them in.
   */
  readonly template: string;
  /** Whether repeating this is defined to be the same as doing it once. */
  readonly idempotent: boolean;
  /** Make the call. */
  (client: ApiClient, args: Arguments, options?: CallOptions): Promise<Result>;
}

/** What a caller may say about one call, beyond its arguments. */
export interface CallOptions {
  readonly signal?: AbortSignal;
  /** Ties this call to whatever the caller is already tracing. */
  readonly traceId?: string;
}

/** How an operation is described. */
interface Spec<Arguments, Response extends z.ZodType> {
  readonly method: Method;
  /** The documented path, with `:name` placeholders. */
  readonly template: string;
  /**
   * Fills the placeholders from the arguments.
   *
   * Omitted where there are none, which is most read-everything routes.
   */
  readonly path?: (args: Arguments) => string;
  /** Validates and serialises the query string. */
  readonly query?: z.ZodType;
  /** Validates the request body before it is sent. */
  readonly body?: z.ZodType;
  /** Parses the response. The client trusts no payload it has not parsed. */
  readonly response: Response;
  /**
   * Whether this may be retried automatically.
   *
   * Defaults to false for anything that is not a repeatable method, and must be
   * set deliberately: only a route the API documents as idempotent qualifies,
   * and `POST /uploads/:uploadId/finalize` is the one that does.
   */
  readonly idempotent?: boolean;
}

/**
 * What an operation is called with.
 *
 * One object rather than positional arguments, because operations differ in
 * which of the three they need and a positional signature would make the
 * absent ones holes somebody has to count.
 */
export interface Arguments {
  /** Fills the path's placeholders. */
  readonly params?: Record<string, string>;
  /** Becomes the query string, parsed through the contract first. */
  readonly query?: unknown;
  /** Becomes the request body, parsed through the contract first. */
  readonly body?: unknown;
}

/**
 * Describe one operation.
 *
 * @param spec - The method, the path, and the contract schemas either side.
 * @returns A callable operation that also carries what it is, so the
 *   completeness check can read it.
 */
export function defineOperation<Args extends Arguments, Response extends z.ZodType>(
  spec: Spec<Args, Response>,
): Operation<Args, z.infer<Response>> {
  const call = async (
    client: ApiClient,
    args: Args,
    options: CallOptions = {},
  ): Promise<z.infer<Response>> => {
    const path = spec.path === undefined ? spec.template : spec.path(args);
    const query = spec.query === undefined ? "" : queryString(spec.query, args.query ?? {});

    return client.request({
      method: spec.method,
      path: `${path}${query}`,
      schema: spec.response,
      // Parsed before sending, so a body the server would refuse is refused
      // here — where the error names the field rather than arriving as a status.
      ...(spec.body === undefined ? {} : { body: spec.body.parse(args.body) }),
      ...(spec.idempotent === true ? { idempotent: true } : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    });
  };

  return Object.assign(call, {
    method: spec.method,
    template: spec.template,
    idempotent: spec.idempotent === true,
  });
}
