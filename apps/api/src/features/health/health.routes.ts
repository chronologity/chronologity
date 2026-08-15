import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkDependencies } from "../../lib/health.js";

const livenessSchema = z.object({ status: z.literal("ok") });

const readinessSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  dependencies: z.array(
    z.object({
      name: z.string(),
      healthy: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});

/**
 * Liveness and readiness.
 *
 * They answer different questions and must not be collapsed. Liveness asks
 * whether the process is running and should be restarted if not. Readiness
 * asks whether this instance can serve traffic right now, which depends on
 * dependencies it does not control. A database outage should stop traffic
 * being routed here; it should not cause an orchestrator to kill the process.
 *
 * @param app - The instance to register on. Its decorated dependencies are what
 *   readiness consults.
 * @returns Nothing.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { response: { 200: livenessSchema } } }, async () => ({
    status: "ok" as const,
  }));

  app.get(
    "/health/ready",
    { schema: { response: { 200: readinessSchema, 503: readinessSchema } } },
    async (_request, reply) => {
      const dependencies = await checkDependencies(app.dependencies);
      const ready = dependencies.every(({ healthy }) => healthy);

      return reply.status(ready ? 200 : 503).send({
        status: ready ? ("ready" as const) : ("degraded" as const),
        dependencies,
      });
    },
  );
}
