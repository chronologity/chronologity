import { createRealWorldEventRequestSchema, realWorldEventSchema } from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * Occasions in the world that a Moment may have been part of.
 *
 * Shared history rather than anybody's: recording one confers no authority over
 * anybody else's account of it. Which means an occasion is exactly as private as
 * the history establishing it — a client asking for one it cannot see gets
 * nothing, indistinguishable from one that does not exist.
 */

/** Record an occasion. */
export const createRealWorldEvent = defineOperation({
  method: "POST",
  template: "/real-world-events",
  body: createRealWorldEventRequestSchema,
  response: realWorldEventSchema,
});

/** One occasion, if any of its history is readable. */
export const getRealWorldEvent = defineOperation({
  method: "GET",
  template: "/real-world-events/:realWorldEventId",
  path: (args: { params: { realWorldEventId: string } }) =>
    `/real-world-events/${args.params.realWorldEventId}`,
  response: realWorldEventSchema,
});
