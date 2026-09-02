import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { occurrenceSchema, timestampSchema } from "./time.js";

/**
 * Real-world Event boundary contracts.
 *
 * A real-world Event is the shared occurrence that gives several people's
 * Moments a common context: a convention, a wedding, an election
 * (`real-world-events.md:15`). It is not a Moment, and it is not a software
 * event — the outbox and the audit tables use that word for something else
 * entirely, which is why the full term is spelled out here and everywhere else.
 *
 * The Event is not a container. Moments belong to whoever recorded them; the
 * Event only says those experiences share an occurrence, and grouping them must
 * never move them from their own place in chronology
 * (`real-world-events.md:1016`).
 */

/**
 * A name an Event goes by.
 *
 * Deliberately not an identity. `real-world-events.md:249-268` is explicit that
 * not every occurrence has an official name, that names differ between
 * communities, and that Event identity must not depend on normalised name
 * text. Two Events sharing a name are not thereby the same Event, and one
 * Event carrying several names is ordinary rather than a conflict.
 */
export const eventNameSchema = z.string().trim().min(1).max(500);

/** What someone supplies to record a real-world Event. */
export const createRealWorldEventRequestSchema = z.object({
  name: eventNameSchema,
  /**
   * Other names the same occurrence goes by: a local name, a former name, an
   * official name nobody uses. None is more the Event's identity than another.
   */
  aliases: z.array(eventNameSchema).max(20).optional(),
  /**
   * When it happened, as an interval with the precision it is actually known
   * at.
   *
   * The same shape a Moment's occurrence uses, deliberately: `Occurrence`
   * already expresses everything `real-world-events.md:154-188` asks of Event
   * time. A concert is `instant` precision with a start and end hours apart; a
   * convention is `day` precision spanning three days; "sometime in 1969" is
   * `year` precision spanning that year. None of them fabricates a clock time
   * nobody knows.
   */
  occurrence: occurrenceSchema,
  /**
   * Where it happened, as Locations already recorded.
   *
   * A list rather than one, because the specification refuses to assume a
   * single point (`real-world-events.md:211-247`): a marathon is a route, a
   * product launch happens in three cities at once. Unordered — ordering would
   * describe a route, and how routes are represented is still open.
   */
  locationIds: z.array(identifierSchema).max(50).optional(),
});

export type CreateRealWorldEventRequest = z.infer<typeof createRealWorldEventRequestSchema>;

/** A real-world Event, as anyone permitted to see it receives it. */
export const realWorldEventSchema = z.object({
  realWorldEventId: identifierSchema,
  /**
   * The name it was recorded under: a useful label rather than a canonical
   * historical fact. Nothing about this string identifies the Event, and two
   * Events may legitimately carry the same one.
   */
  name: eventNameSchema,
  aliases: z.array(eventNameSchema),
  occurrence: occurrenceSchema,
  locationIds: z.array(identifierSchema),
  /**
   * Who first recorded it here.
   *
   * Provenance, never ownership. `real-world-events.md:549-563` is explicit
   * that creating the first record for a concert, election, or ceremony must
   * not give one person authority over everyone else's history of it.
   */
  createdByUserId: identifierSchema,
  createdAt: timestampSchema,
});

export type RealWorldEvent = z.infer<typeof realWorldEventSchema>;
