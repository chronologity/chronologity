import { randomUUID } from "node:crypto";

/**
 * Generate a trace identifier for one request.
 *
 * Distinct from domain identifiers: a trace identifier correlates logs and
 * error responses and is never persisted as domain data.
 *
 * @returns A new trace identifier.
 */
export function generateTraceId(): string {
  return randomUUID();
}
