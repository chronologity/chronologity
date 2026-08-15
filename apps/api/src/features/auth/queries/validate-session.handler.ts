import { isUsable } from "../aggregates/session.aggregate.js";
import { clockFor, type AuthDependencies } from "../dependencies.js";
import { loadSession } from "../utils/session-store.js";
import type { ValidateSessionQuery, ValidatedSession } from "./validate-session.query.js";

/**
 * Decide whether a Session is currently good.
 *
 * Answers from the Session aggregate rather than the `sessions` table. This is
 * the one place where being slightly slower is unambiguously right: the
 * alternative is a revoked Session that keeps working until a projection
 * catches up.
 *
 * Runs on every authenticated request, so it is the obvious candidate if
 * request latency ever needs attention — but caching it would need explicit
 * freshness semantics (ADR-043), not a convenient TTL.
 *
 * @param deps - Event store and clock.
 * @param query - Which Session to judge.
 * @returns The Identity it belongs to, or undefined if it cannot authenticate a
 *   request right now.
 */
export async function handleValidateSession(
  deps: AuthDependencies,
  query: ValidateSessionQuery,
): Promise<ValidatedSession | undefined> {
  const { state } = await loadSession(deps, query.sessionId);

  if (!isUsable(state, clockFor(deps)()) || state.identityId === undefined) {
    return undefined;
  }

  return { identityId: state.identityId };
}
