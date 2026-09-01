import { randomUUID } from "node:crypto";
import fp from "fastify-plugin";

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
 * to service; otherwise one is generated. The identifier is echoed on the
 * response so somebody reporting a slow or empty Timeline can quote something
 * that finds it in the logs.
 *
 * It matters more here than in a command API. A GraphQL request is one HTTP
 * call carrying several resolvers, each with its own ClickHouse query, and
 * without a correlator the logs from one Timeline page are indistinguishable
 * from the logs of every other page being served at that moment.
 *
 * Registered first, so everything after it can quote the identifier.
 */
export const requestContextPlugin = fp(async (app) => {
  app.decorateRequest("traceId", "");

  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers["x-trace-id"];

    request.traceId = typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
    reply.header("x-trace-id", request.traceId);
  });
});
