import type { Actor } from "@chronologity/contracts";

/**
 * Everything a command or query needs to know about who is asking and why.
 *
 * Passed explicitly rather than read from ambient storage: a handler's
 * dependence on identity should be visible in its signature, and a background
 * worker has no request to inherit context from.
 */
export interface RequestContext {
  /** Correlates this work across services, logs, and published messages. */
  readonly traceId: string;
  /** Who initiated the work. Absent for system-originated processing. */
  readonly actor: Actor | undefined;
  /** When the work was accepted. Never the occurrence time of domain history. */
  readonly receivedAt: Date;
}

/**
 * Context for work the system initiates itself, such as a scheduled rebuild.
 *
 * @param traceId - Correlates the work across services and logs.
 * @param receivedAt - When the work was accepted.
 * @returns Context for work the system initiates itself, which has no request and
 *   no actor to inherit from.
 */
export function systemContext(traceId: string, receivedAt: Date): RequestContext {
  return { traceId, actor: undefined, receivedAt };
}
