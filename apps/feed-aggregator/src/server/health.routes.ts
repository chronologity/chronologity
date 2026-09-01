import type { FastifyInstance } from "fastify";
import { checkDependencies } from "./health.js";

/**
 * Liveness and readiness.
 *
 * They answer different questions and must not be collapsed. Liveness asks
 * whether the process is running and should be restarted if not. Readiness asks
 * whether this instance can serve traffic right now, which depends on stores it
 * does not control.
 *
 * The distinction is sharper here than in the API. This application cannot
 * answer a single Timeline query with ClickHouse unavailable — there is no
 * fallback, and `feed.md:1186` forbids inventing one by reading authoritative
 * PostgreSQL instead. But an instance that can serve nothing is still a healthy
 * process, and killing it would only produce a restart loop that recovers no
 * faster than the store does.
 *
 * No response schema: this application publishes no OpenAPI document, and a
 * schema written only to be a schema would be a contract nobody reads.
 *
 * @param app - The instance to register on. Its decorated dependencies are what
 *   readiness consults.
 * @returns Nothing.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async () => ({ status: "ok" as const }));

  app.get("/health/ready", async (_request, reply) => {
    const dependencies = await checkDependencies(app.dependencies);
    const ready = dependencies.every(({ healthy }) => healthy);

    return reply.status(ready ? 200 : 503).send({
      status: ready ? ("ready" as const) : ("degraded" as const),
      dependencies,
    });
  });
}
