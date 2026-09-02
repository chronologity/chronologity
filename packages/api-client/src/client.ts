import { errorResponseSchema, type ErrorCode, type ErrorResponse } from "@chronologity/contracts";
import type { z } from "zod";

/** An error returned by the API in its stable envelope. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly code: ErrorCode;
  readonly status: number;
  readonly traceId: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Build an error from the API's stable envelope.
   *
   * @param status - The HTTP status returned.
   * @param response - The envelope body.
   */
  constructor(status: number, response: ErrorResponse) {
    super(response.message);
    this.status = status;
    this.code = response.code;
    this.traceId = response.traceId;
    this.details = response.details;
  }
}

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
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface RequestOptions<Schema extends z.ZodType> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  /** Validates the response body. The client trusts no payload it has not parsed. */
  schema: Schema;
  body?: unknown;
  signal?: AbortSignal;
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
  } = options;

  return {
    async request<Schema extends z.ZodType>({
      method,
      path,
      schema,
      body,
      signal,
    }: RequestOptions<Schema>): Promise<z.infer<Schema>> {
      const token = await getAccessToken?.();
      const headers: Record<string, string> = { accept: "application/json" };

      if (token !== undefined) {
        headers.authorization = `Bearer ${token}`;
      }
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }

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
        return schema.parse(undefined);
      }

      return schema.parse(await response.json());
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

  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    return new ApiError(response.status, parsed.success ? parsed.data : fallback);
  } catch {
    return new ApiError(response.status, fallback);
  }
}
