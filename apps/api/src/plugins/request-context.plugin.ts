import fp from "fastify-plugin";
import { generateTraceId } from "../lib/ids/generate-trace-id.js";
import { now } from "../lib/time/now.js";
import type { RequestContext } from "../types/request-context.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Correlates this request across logs, errors, and downstream calls. */
    traceId: string;
    /** What handlers receive instead of reaching for ambient state. */
    requestContext: RequestContext;
  }
}

/**
 * Establish per-request context.
 *
 * An inbound `x-trace-id` is honoured so a trace survives the hop from client
 * to API; otherwise one is generated. The identifier is echoed on the response
 * so a user reporting a failure can quote something that finds it in the logs.
 */
export const requestContextPlugin = fp(async (app) => {
  app.decorateRequest("traceId", "");
  // Same reason as `traceId` above: declared for shape, populated per request.
  app.decorateRequest("requestContext", null as unknown as RequestContext);

  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers["x-trace-id"];
    request.traceId =
      typeof inbound === "string" && inbound.length > 0 ? inbound : generateTraceId();
    reply.header("x-trace-id", request.traceId);

    // The actor is filled in by authentication where a route requires one; an
    // unauthenticated request gets a context with no actor rather than no
    // context at all, so handlers never have to check whether one exists.
    request.requestContext = {
      traceId: request.traceId,
      actor: undefined,
      receivedAt: now(),
    };
  });
});
