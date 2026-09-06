import type { Session } from "@chronologity/api-client";

/**
 * Reading history, over the other protocol.
 *
 * **Why this is not a GraphQL library.** ADR-154 kept generated GraphQL types
 * out of a shared package because nothing else consumes the schema, and the same
 * reasoning applies one level down: the aggregator has no mutations and no
 * subscriptions (ADR-136), so what a GraphQL client provides over `fetch` is a
 * normalized cache — and the cache this application uses is TanStack Query's,
 * shared with every REST call. A second cache with different invalidation rules
 * would be a second place for something to be stale.
 *
 * What is left is a POST with a document and variables, which is this file.
 *
 * **The same credential, and no downgrade.** ADR-137 has the aggregator verify
 * the bearer token itself and refuse anything it cannot verify rather than
 * quietly treating the reader as anonymous — because a client shown an anonymous
 * Timeline would render somebody's history as though it had shrunk. So the token
 * comes from the same Session the REST client uses, and a refusal is surfaced
 * rather than smoothed over.
 *
 * **A GraphQL error is not an empty answer.** The transport answers 200 with an
 * `errors` array, so a caller that reads `data` alone sees nothing and concludes
 * there is nothing — which is exactly the confusion ADR-151 was written to
 * prevent. Errors are thrown.
 */

/** What the reader needs to ask anything. */
export interface GraphqlClientOptions {
  /** Where the aggregator is. */
  readonly url: string;
  /** The signed-in Session, asked for a token per request. */
  readonly session: Session;
  /** How to make requests. A seam for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Asking the aggregator something. */
export interface GraphqlClient {
  /**
   * Run one document.
   *
   * @param document - The query text.
   * @param variables - Its variables.
   * @param signal - Cancellation, for a screen that is left before it answers.
   * @returns The `data` field, parsed by the caller.
   * @throws {GraphqlError} If the response carries errors, or is not a 200.
   */
  query<Result>(
    document: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Result>;
}

/** What the aggregator said went wrong. */
export class GraphqlError extends Error {
  override readonly name = "GraphqlError";
  /** The HTTP status, which is 200 for most GraphQL failures. */
  readonly status: number;

  /**
   * Build one.
   *
   * @param message - The first error's message.
   * @param status - The HTTP status the response carried.
   */
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Build a reader for the aggregator.
 *
 * @param options - Where it is, which Session to present, and how to fetch.
 * @returns The client.
 */
export function createGraphqlClient(options: GraphqlClientOptions): GraphqlClient {
  const { url, session, fetch: fetchImpl = globalThis.fetch } = options;

  return {
    async query<Result>(
      document: string,
      variables: Record<string, unknown> = {},
      signal?: AbortSignal,
    ): Promise<Result> {
      const token = await session.accessToken();

      const response = await fetchImpl(`${url.replace(/\/+$/, "")}/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ query: document, variables }),
        ...(signal === undefined ? {} : { signal }),
      });

      if (!response.ok) {
        throw new GraphqlError(
          `The Timeline service answered ${String(response.status)}`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        data?: Result;
        errors?: Array<{ message?: string }>;
      };

      // Before reading `data`. A partial answer with errors beside it is a
      // failure, and rendering its `data` would show a Timeline that is missing
      // pieces without saying so.
      if (payload.errors !== undefined && payload.errors.length > 0) {
        throw new GraphqlError(
          payload.errors[0]?.message ?? "The Timeline service refused the request",
          response.status,
        );
      }

      if (payload.data === undefined) {
        throw new GraphqlError("The Timeline service answered with nothing", response.status);
      }

      return payload.data;
    },
  };
}
