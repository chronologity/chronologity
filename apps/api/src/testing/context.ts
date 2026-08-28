import { randomUUID } from "node:crypto";
import { systemContext, type RequestContext } from "../types/request-context.js";

/**
 * The context a test supplies when it drives a service directly.
 *
 * `RequestContext` is required wherever a service publishes or audits, which is
 * what stops a trace being dropped silently — the compiler refuses the call
 * rather than the service inventing an identifier nobody can follow. A test
 * calling a service without going through HTTP still has to say where the work
 * came from, and the honest answer is that no request did.
 *
 * @returns A fresh system context. Fresh rather than shared, so two calls in one
 *   test are distinguishable in anything that records the trace.
 */
export function testContext(): RequestContext {
  return systemContext(randomUUID(), new Date());
}
