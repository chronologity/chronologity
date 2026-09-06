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
 * Only `request` is exposed. Named operations live in `./operations` and take a
 * client as their first argument, so the transport knows nothing about routes
 * and the routes know nothing about retries, tokens, or timeouts.
 *
 * @param options - Base URL, an optional token supplier, an optional fetch
 *   implementation for tests, and a per-request timeout.
 * @returns A client that can make any request. What is worth requesting is
 *   `operations`' business.
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
        // A fresh timeout per attempt. Sharing one across retries would mean
        // the last attempt inherits whatever the first two left of it.
        const attemptDeadline = deadline(timeoutMs);

        try {
          const response = await fetchImpl(join(baseUrl, path), {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: soonestOf(signal, attemptDeadline.signal),
          });

          if (!response.ok) {
            throw await toApiError(response);
          }

          if (response.status === 204) {
            return emptyBody(schema);
          }

          return schema.parse(await response.json());
        } catch (thrown) {
          const error = classify(thrown, signal, attemptDeadline.expired());

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
        } finally {
          // The timer holds the event loop open otherwise, which in Node keeps
          // a process alive for the remainder of a timeout nobody is waiting on.
          attemptDeadline.cancel();
        }
      }
    },
  };
}

/**
 * Join a base URL and a path.
 *
 * Written out rather than using `new URL(path, baseUrl)`, and the reason is a
 * runtime rather than a preference. React Native ships a homemade lightweight
 * `URL` whose documented gaps include being unable to take a `localhost` base —
 * which is every development build, so the two-argument form fails on the first
 * request an app ever makes.
 *
 * It also fixes a smaller thing the standard form gets wrong here. An absolute
 * path *replaces* the base's own path, so a client pointed at
 * `https://example.com/v1` would send every request to `/moments` and none to
 * `/v1/moments`. A base URL's prefix is part of where the API is.
 *
 * @param baseUrl - Where the API is, with or without a trailing slash.
 * @param path - The route, beginning with a slash.
 * @returns The absolute URL to request.
 */
function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** One attempt's deadline, and the means to stop it. */
interface Deadline {
  readonly signal: AbortSignal;
  /** Whether the deadline is what aborted. */
  expired: () => boolean;
  /** Stop the timer, whether or not it fired. */
  cancel: () => void;
}

/**
 * Start a deadline for one attempt.
 *
 * `AbortSignal.timeout` would say this in one line and is absent from React
 * Native, so it is built from the two primitives that are everywhere.
 *
 * @param ms - How long the attempt may take.
 * @returns The deadline. `cancel` must be called however the attempt ends, or
 *   the timer keeps the event loop alive for the remainder of a wait nobody is
 *   waiting on.
 */
function deadline(ms: number): Deadline {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);

  return {
    signal: controller.signal,
    expired: () => expired,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * A signal that aborts when the first of its inputs does.
 *
 * `AbortSignal.any` is the one-line version and React Native does not have it,
 * so an unguarded call fails on every request where a caller passes a signal of
 * their own — which is every screen that can be navigated away from.
 *
 * @param caller - The caller's signal, where they gave one.
 * @param timeout - This attempt's deadline.
 * @returns The deadline alone when there is nothing to combine it with, and
 *   otherwise a signal following whichever aborts first.
 */
function soonestOf(caller: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (caller === undefined) {
    return timeout;
  }

  const combined = new AbortController();

  for (const one of [caller, timeout]) {
    // Already aborted signals never fire the event, so the state is read as
    // well as listened for.
    if (one.aborted) {
      combined.abort(one.reason);

      return combined.signal;
    }

    one.addEventListener("abort", () => {
      combined.abort(one.reason);
    });
  }

  return combined.signal;
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
