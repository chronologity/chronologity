import { z } from "zod";
import { aggregateReferenceSchema, identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Who caused an event.
 *
 * Account identity, authenticated identity, and session are separate concerns
 * and are not collapsed into a single "user" field. System-originated events
 * carry no actor rather than a fabricated one.
 */
export const actorSchema = z.object({
  userId: identifierSchema.optional(),
  identityId: identifierSchema.optional(),
  sessionId: identifierSchema.optional(),
});

export type Actor = z.infer<typeof actorSchema>;

/**
 * The standard envelope wrapping every serialized event contract.
 *
 * The envelope is a durable schema. Once an event is persisted it will be read
 * back by code that does not exist yet, so envelope fields evolve additively
 * and `eventVersion` carries the payload's contract version.
 *
 * `occurredAt` here is when the *event* happened — the domain fact being
 * recorded. It is not the occurrence time of a Moment, which is domain payload
 * and belongs inside `payload`.
 */
export const eventEnvelopeSchema = z.object({
  eventId: identifierSchema,
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: timestampSchema,
  aggregate: aggregateReferenceSchema,
  correlationId: identifierSchema.optional(),
  causationId: identifierSchema.optional(),
  actor: actorSchema.optional(),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * Build an envelope schema with a typed payload.
 *
 * Domains declare their own events by supplying a payload schema, so the
 * envelope stays canonical while payloads remain owned by the feature that
 * produces them.
 *
 * @param eventType - The single type this envelope accepts.
 * @param payload - The schema its payload must satisfy.
 * @returns An envelope schema bound to that one event type, so a domain declares
 *   its own events while the envelope stays canonical.
 */
export function envelopeOf<PayloadSchema extends z.ZodType>(
  eventType: string,
  payload: PayloadSchema,
) {
  return eventEnvelopeSchema.extend({
    eventType: z.literal(eventType),
    payload,
  });
}
