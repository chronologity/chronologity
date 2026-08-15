import fp from "fastify-plugin";
import { generateTraceId } from "../lib/ids/generate-trace-id.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Correlates this request across logs, errors, and downstream calls. */
    traceId: string;
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

  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers["x-trace-id"];
    request.traceId =
      typeof inbound === "string" && inbound.length > 0 ? inbound : generateTraceId();
    reply.header("x-trace-id", request.traceId);
  });
});
