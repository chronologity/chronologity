import { errorCodeSchema, type ErrorCode } from "@chronologity/contracts";
import type {
  ExecutionResult,
  FormattedExecutionResult,
  GraphQLError,
  GraphQLFormattedError,
} from "graphql";
import type { MercuriusContext } from "mercurius";
import { AggregatorError } from "../errors/aggregator-error.js";
import { isStoreFailure } from "../errors/store-failure.js";

/**
 * What a client is told when something goes wrong.
 *
 * The default is deliberately uninformative, and that matters more in a read
 * service than in a command API. The things that fail here are ClickHouse
 * queries and cursor decoding, and both describe storage in their message — a
 * table name, a column, a projection version. `feed.md:562` says a malformed
 * cursor must produce a semantic error rather than a decoding failure, and the
 * general form of that rule is: only errors written to be shown get shown.
 *
 * Three kinds arrive here.
 *
 * An `AggregatorError` was written to be shown. It keeps its message and
 * carries its stable code, and its status becomes the response's.
 *
 * A GraphQL error with no original error came from GraphQL itself — a syntax
 * error, an unknown field, a document deeper than the limit. It describes the
 * document the client sent rather than anything behind the schema, so it is
 * safe and useful to pass through. Refusing to say "there is no such field"
 * would make the schema undiscoverable without telling an attacker anything.
 *
 * A GraphQL error carrying one of this system's codes was written to be shown
 * too. That is how a scalar refuses: a `Cursor` this Timeline did not issue is
 * rejected while a variable is being coerced, before any resolver runs, and
 * GraphQL wraps the refusal in an error of its own. Without this branch the
 * wrapper would be an unrecognised original and the refusal would reach the
 * client as "An unexpected error occurred" — precisely what `feed.md:562`
 * forbids, and indistinguishable from the service falling over.
 *
 * Anything else is a failure nobody planned. It becomes one internal error
 * carrying the trace identifier, and its real message stays in the logs.
 */

/** The shape Mercurius expects back. */
export interface FormattedExecution {
  readonly statusCode: number;
  readonly response: FormattedExecutionResult;
}

/** What Mercurius hands the formatter: a result that definitely failed. */
type FailedExecution = ExecutionResult & Required<Pick<ExecutionResult, "errors">>;

/** Just enough of a logger to record what the client is not told. */
interface RequestLog {
  error(details: unknown, message: string): void;
  /**
   * For a store that could not answer.
   *
   * A level below `error` deliberately: an outage is already somebody's alert,
   * and logging it at error here would page twice for one incident. It is also
   * not this service's fault, which is what a level is for.
   */
  warn(details: unknown, message: string): void;
}

/**
 * Format an execution's errors for the client.
 *
 * @param execution - The result, which always carries at least one error when
 *   this is called. Partial data may accompany them.
 * @param context - The GraphQL context, for the trace identifier and the
 *   request's logger.
 * @returns The status to reply with and the response body. The status is 200
 *   where data is present, following the GraphQL-over-HTTP convention that a
 *   partially successful response is a successful one; otherwise it is the
 *   status the first describable error asked for.
 */
export function formatErrors(
  execution: FailedExecution,
  context: MercuriusContext,
): FormattedExecution {
  // Defaulted rather than asserted. Mercurius builds a context for the error
  // path too, but a failure early enough — before a request context existed at
  // all — can reach here with neither field, and an error report is the last
  // place that should throw.
  const traceId = context.traceId ?? "unknown";
  const log: RequestLog | undefined = context.reply?.log;

  // Validation and depth failures arrive as one error wrapping many. Flattened
  // so the client is told about each unknown field rather than only that
  // something was wrong.
  const flattened = execution.errors.flatMap((error) => {
    const nested = (error.originalError as { errors?: readonly GraphQLError[] } | undefined)
      ?.errors;

    return Array.isArray(nested) ? nested : [error];
  });

  const formatted = flattened.map((error) => describe(error, traceId, log));

  return {
    statusCode:
      execution.data === null || execution.data === undefined
        ? // Unflattened deliberately: a validation failure's status lives on the
          // wrapper, and the errors it wraps carry none.
          statusFor(execution.errors)
        : 200,
    response: { data: execution.data ?? null, errors: [...formatted] },
  };
}

/**
 * Turn one error into what the client may see.
 *
 * @param error - The error as GraphQL produced it.
 * @param traceId - Quoted back so a report can be found in the logs.
 * @param log - The request's logger, where an unplanned failure's real message
 *   is recorded. Absent when the failure happened outside a request.
 * @returns The error to send: its own message when it was written to be shown
 *   or came from GraphQL itself, and an opaque internal error otherwise.
 */
function describe(
  error: GraphQLError,
  traceId: string,
  log: RequestLog | undefined,
): GraphQLFormattedError {
  const original = error.originalError;

  if (original instanceof AggregatorError) {
    return withCode(error, original.code, traceId);
  }

  // GraphQL's own errors carry no original: they describe the document rather
  // than anything behind the schema.
  if (original === undefined) {
    return withCode(error, "VALIDATION_FAILED", traceId);
  }

  const declared = codeOf(original);

  if (declared !== undefined) {
    // The wrapper's message, not the original's: GraphQL prefixes which
    // variable was rejected, which is the useful half, and the scalar's own
    // words are already inside it.
    return withCode(error, declared, traceId);
  }

  // A store that could not answer, told apart from a defect. Logged at `warn`
  // rather than `error`: an outage is somebody else's alert already firing, and
  // an error level here would page twice for one incident.
  if (isStoreFailure(original)) {
    log?.warn({ err: original, traceId }, "A store could not answer");

    return {
      message: "History is temporarily unavailable",
      ...(error.path === undefined ? {} : { path: error.path }),
      extensions: { code: "PROVIDER_UNAVAILABLE" satisfies ErrorCode, traceId },
    };
  }

  log?.error({ err: original, traceId }, "GraphQL execution failed");

  return {
    message: "An unexpected error occurred",
    ...(error.path === undefined ? {} : { path: error.path }),
    extensions: { code: "INTERNAL_ERROR" satisfies ErrorCode, traceId },
  };
}

/**
 * The classification an error declared for itself.
 *
 * Read only from a GraphQL error, and only when the value is one of the codes
 * the contract defines. Both narrowings matter: anything else reaching here is
 * a driver's or a library's error, and one that happened to carry an
 * `extensions.code` would otherwise get to choose how it is presented — and its
 * message would go with it.
 *
 * @param error - The original error, whatever it turned out to be.
 * @returns Its code, or undefined when it declared none this system issues.
 */
function codeOf(error: Error): ErrorCode | undefined {
  // By name rather than by `instanceof`, and measured rather than assumed.
  // `graphql` ships both a CommonJS and an ECMAScript build; Mercurius loads
  // one and this module the other, so the error a scalar throws is a
  // `GraphQLError` from a different copy of the class and `instanceof` is
  // false. Testing the name works across both, and it is the check that would
  // go on working if a third copy ever appeared.
  if (error.name !== "GraphQLError") {
    return undefined;
  }

  const parsed = errorCodeSchema.safeParse(
    (error as { extensions?: Record<string, unknown> }).extensions?.["code"],
  );

  return parsed.success ? parsed.data : undefined;
}

/**
 * Keep an error's own words, and attach the stable classification.
 *
 * @param error - The error to send on.
 * @param code - Its stable code, from the vocabulary shared with the API.
 * @param traceId - Quoted back so a report can be found in the logs.
 * @returns The formatted error.
 */
function withCode(error: GraphQLError, code: ErrorCode, traceId: string): GraphQLFormattedError {
  return {
    message: error.message,
    ...(error.locations === undefined ? {} : { locations: error.locations }),
    ...(error.path === undefined ? {} : { path: error.path }),
    extensions: { code, traceId },
  };
}

/**
 * The status a failed execution should carry.
 *
 * @param errors - Every error, already flattened.
 * @returns The status of the first error that asked for one, or 200. GraphQL
 *   over HTTP treats a well-formed response describing a failure as a
 *   successful exchange, so 200 is the default rather than 500; an error that
 *   deliberately names a status — an authentication refusal, a validation
 *   failure — overrides it, because a client's handling of those is different.
 */
function statusFor(errors: readonly GraphQLError[]): number {
  for (const error of errors) {
    const original = error.originalError;

    if (original instanceof AggregatorError) {
      return original.status;
    }

    const status = (original as { statusCode?: unknown } | undefined)?.statusCode;

    if (typeof status === "number" && status >= 400 && status <= 499) {
      return status;
    }

    // An outage answers 503, so the thing in front of this process can tell it
    // from a defect. Without this a store being unreachable answered 200 with
    // an error in the body, and nothing watching status codes would ever know.
    if (isStoreFailure(original)) {
      return 503;
    }
  }

  return 200;
}
