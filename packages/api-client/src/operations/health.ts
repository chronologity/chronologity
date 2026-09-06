import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Whether the API is alive, and whether it can do its job.
 *
 * Two questions rather than one, deliberately, and a client should not conflate
 * them: a process can be alive while PostgreSQL is unreachable, and killing it
 * for that would take away the only thing able to recover.
 *
 * These are the two operations in the whole surface that need no credential.
 */

/** The process is running. Answers whatever else is broken. */
export const checkLiveness = defineOperation({
  method: "GET",
  template: "/health/live",
  response: z.object({ status: z.literal("ok") }),
});

/** The process can serve. Answers 503 when a dependency cannot. */
export const checkReadiness = defineOperation({
  method: "GET",
  template: "/health/ready",
  response: z.object({
    status: z.enum(["ready", "degraded"]),
    dependencies: z.array(
      z.object({ name: z.string(), healthy: z.boolean(), error: z.string().optional() }),
    ),
  }),
});
