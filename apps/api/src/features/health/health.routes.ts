import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkDependencies } from "../../lib/health.js";
import { errors } from "../../server/error-responses.js";

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
  // Both routes here, grouped under one heading in the published document. A
  // hook rather than a line on each route: a route added later is grouped
  // without anybody remembering to say so.
  app.addHook("onRoute", (route) => {
    route.schema = { ...route.schema, tags: ["Health"] };
  });

  app.get(
    "/health/live",
    {
      schema: {
          // No credential needed. Declared rather than assumed, because the
          // document requires one by default and silence would say this route
          // needs a token it will never look at.
          security: [],
        summary: "Is the process running",
        description:
          "Answers only whether this process is alive. It says nothing about whether the instance can serve traffic — a database outage must not cause an orchestrator to kill a healthy process.",
        response: { 200: livenessSchema, ...errors() },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/health/ready",
    {
      schema: {
          // No credential needed. Declared rather than assumed, because the
          // document requires one by default and silence would say this route
          // needs a token it will never look at.
          security: [],
        summary: "Can this instance serve traffic",
        description:
          "Reports each dependency this instance needs. `degraded` with a 503 means traffic should go elsewhere; the process is still healthy and should not be restarted.",
        response: { 200: readinessSchema, 503: readinessSchema, ...errors() },
      },
    },
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
