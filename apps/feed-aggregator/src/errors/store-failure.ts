/**
 * Telling an outage apart from a defect.
 *
 * Neither store throws a type this application controls: `pg` throws its own
 * error carrying a SQLSTATE, and `@clickhouse/client` throws either its own
 * error or whatever the socket produced. So classification is by shape, which is
 * unsatisfying and is the honest option — the alternative is wrapping every read
 * in a translation layer, which would put a try/catch around each of the twenty
 * or so statements this service issues and would still be classifying by shape,
 * one level down.
 *
 * **The list is explicit and short on purpose.** A classifier that treated every
 * unrecognised error as an outage would report a genuine defect as "try again",
 * and the retry would fail forever. Anything not named here stays an internal
 * error, which is the safer way to be wrong: somebody is paged rather than
 * nobody.
 */

/**
 * Failures that mean the store could not be reached or could not finish.
 *
 * Connection-level codes come from Node's socket layer and mean the same thing
 * whichever store produced them. `57014` is PostgreSQL cancelling a statement
 * that ran past `statement_timeout` — a budget being enforced rather than a bug,
 * and a request that may well succeed when the database is less busy.
 */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "57014",
]);

/**
 * ClickHouse's own errors for a query that exceeded its budget.
 *
 * Named rather than matched on a message, because a message is prose that
 * changes between versions.
 */
const OVER_BUDGET = new Set(["TIMEOUT_EXCEEDED", "TOO_MANY_ROWS_OR_BYTES", "MEMORY_LIMIT_EXCEEDED"]);

/**
 * Whether a failure means the store could not answer.
 *
 * @param error - Whatever was thrown.
 * @returns True when this is an availability problem rather than a defect —
 *   unreachable, cancelled by a timeout, or stopped by a query budget. False for
 *   anything unrecognised, deliberately: an unknown failure is a defect until
 *   somebody says otherwise.
 */
export function isStoreFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  if (typeof code === "string" && (UNREACHABLE.has(code) || OVER_BUDGET.has(code))) {
    return true;
  }

  // The client wraps a socket failure rather than replacing it, so the cause is
  // where the code lives when the connection itself was the problem.
  const cause = (error as { cause?: unknown }).cause;

  return cause === undefined ? false : isStoreFailure(cause);
}
