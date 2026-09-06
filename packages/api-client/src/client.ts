import { errorResponseSchema, type ErrorResponse } from "@chronologity/contracts";
import { ApiError } from "./api-error.js";
import {
  classify,
  defaultRetryPolicy,
  delayFor,
  mayRetry,
  retryAfterSeconds,
  type RetryPolicy,
} from "./retry.js";
import type { z } from "zod";

export interface ApiClientOptions {
  /** Absolute base URL of the API, without a trailing path. */
  baseUrl: string;
  /**
   * Supplies the bearer token for each request.
   *
   * A callback rather than a value, so a refreshed session is picked up
   * without rebuilding the client, and so no token is captured in a closure
   * that outlives it.
   */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** Overrides `globalThis.fetch`. Primarily a testing seam. */
  fetch?: typeof globalThis.fetch;
  /**
   * Produces the identifier that ties one request to the API's logs.
   *
   * The API honours an inbound `x-trace-id` and echoes it back, so sending one
   * lets a request be followed from here through the server without anybody
   * correlating by timestamp. Injectable because `crypto.randomUUID` is not
   * everywhere: React Native has no global `crypto` without a polyfill, and a
   * client that threw on a missing global would be unusable in the one runtime
   * this package exists for. Absent, the header is omitted and the server
   * generates one.
   */
  newTraceId?: () => string | undefined;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** How persistent to be about failures worth retrying. */
  retry?: RetryPolicy;
  /** Waits between attempts. A seam, so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions<Schema extends z.ZodType> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  /** Validates the response body. The client trusts no payload it has not parsed. */
  schema: Schema;
  body?: unknown;
  signal?: AbortSignal;
  /** Ties this request to whatever the caller is already tracing. */
  traceId?: string;
  /**
   * Whether repeating this request is defined to be the same as making it
   * once.
   *
   * The only way a `POST` is ever retried. Declared per operation rather
   * than inferred, because nothing about a path says whether repeating it is
   * safe — `POST /uploads/:id/finalize` is documented idempotent and `POST
   * /moments` records a second Moment.
   */
  idempotent?: boolean;
}

export interface ApiClient {
  request<Schema extends z.ZodType>(options: RequestOptions<Schema>): Promise<z.infer<Schema>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Create a client bound to one API base URL.
 *
 * Only `request` is exposed. Named operations are added as the API implements
 * the routes behind them.
 *
 * @param options - Base URL, an optional token supplier, an optional fetch
 *   implementation for tests, and a per-request timeout.
 * @returns A client exposing only `request`. Named operations are added as the
 *   API implements the routes behind them.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const {
    baseUrl,
    getAccessToken,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    newTraceId = defaultTraceId,
    retry = defaultRetryPolicy,
    sleep = defaultSleep,
  } = options;

  return {
    async request<Schema extends z.ZodType>({
      method,
      path,
      schema,
      body,
      signal,
      traceId,
      idempotent,
    }: RequestOptions<Schema>): Promise<z.infer<Schema>> {
      const token = await getAccessToken?.();
      const headers: Record<string, string> = { accept: "application/json" };
      const trace = traceId ?? newTraceId();

      if (trace !== undefined) {
        headers["x-trace-id"] = trace;
      }

      if (token !== undefined) {
        headers.authorization = `Bearer ${token}`;
      }
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }

      for (let attempt = 1; ; attempt += 1) {
        try {
          // A fresh timeout per attempt. Sharing one across retries would mean
          // the last attempt inherits whatever the first two left of it.
          const timeout = AbortSignal.timeout(timeoutMs);
          const response = await fetchImpl(new URL(path, baseUrl), {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
          });

          if (!response.ok) {
            throw await toApiError(response);
          }

          if (response.status === 204) {
            return emptyBody(schema);
          }

          return schema.parse(await response.json());
        } catch (thrown) {
          const error = classify(thrown, signal);

          // A schema mismatch is not a transport failure and repeating it would
          // produce the same bytes; `classify` returns it unchanged and
          // `mayRetry` refuses it, but the ordering is worth being explicit
          // about: the last attempt always throws what it caught.
          if (attempt >= retry.attempts || !mayRetry(error, method, idempotent === true)) {
            throw error;
          }

          await sleep(
            delayFor(
              attempt,
              error instanceof ApiError ? error.retryAfterSeconds : undefined,
              retry,
            ),
          );
        }
      }
    },
  };
}

/**
 * Map a failed response onto {@link ApiError}.
 *
 * A response that is not the documented envelope is reported as an internal
 * error rather than being reshaped into one, so a proxy's HTML error page is
 * never mistaken for an API contract.
 *
 * @param response - The failed response.
 * @returns An ApiError. A body that is not the documented envelope becomes an
 *   internal error rather than being reshaped into one, so a proxy's HTML error
 *   page is never mistaken for an API contract.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const fallback: ErrorResponse = {
    code: "INTERNAL_ERROR",
    message: `Request failed with status ${response.status}`,
    traceId: response.headers.get("x-trace-id") ?? "unknown",
  };

  const wait = retryAfterSeconds(response);

  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    return new ApiError(response.status, parsed.success ? parsed.data : fallback, wait);
  } catch {
    return new ApiError(response.status, fallback, wait);
  }
}

/**
 * The value a schema expects when a response carried no body.
 *
 * **Both spellings are legitimate and this client must answer either.** A route
 * describing its empty success as `z.void()` parses `undefined`; one describing
 * it as `z.null()` parses `null`, and six routes in this API do — deleting a
 * Moment among them. Parsing `undefined` unconditionally, which is what this did
 * before anything called it, threw *after the server had already succeeded*: the
 * Moment was gone and the caller saw a validation failure.
 *
 * Fixed here rather than by changing six routes, because neither spelling is
 * wrong. A client that tolerates only one is the thing that is wrong.
 *
 * @param schema - What the route says a 204 carries.
 * @returns Whichever of `undefined` or `null` the schema accepts.
 * @throws {z.ZodError} If it accepts neither, which means the route documents a
 *   body for a status that cannot carry one. The error is the one raised for
 *   `undefined`, because that is the spelling a reader would have expected.
 */
function emptyBody<Schema extends z.ZodType>(schema: Schema): z.infer<Schema> {
  const asVoid = schema.safeParse(undefined);

  if (asVoid.success) {
    return asVoid.data;
  }

  const asNull = schema.safeParse(null);

  if (asNull.success) {
    return asNull.data;
  }

  return schema.parse(undefined);
}

/**
 * An identifier for one request, where the runtime can produce one.
 *
 * @returns A fresh identifier, or undefined where `crypto.randomUUID` is absent
 *   — in which case the header is omitted and the API generates its own, which
 *   is a worse experience than correlating and a better one than crashing.
 */
function defaultTraceId(): string | undefined {
  return globalThis.crypto?.randomUUID?.();
}

/**
 * Wait.
 *
 * @param ms - How long.
 * @returns A promise that settles then.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
