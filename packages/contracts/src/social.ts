import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";
import { locationSchema } from "./locations.js";
import { realWorldEventSchema } from "./real-world-events.js";
import { publicUserSchema } from "./users.js";

/**
 * Social boundary contracts.
 *
 * Following is directional and needs no reciprocity: A following B says nothing
 * about whether B follows A (`social-graph.md:36`). It was chosen over mutual
 * friendship because history is asymmetric — somebody may care about another
 * person's record of an event without that interest being returned.
 *
 * "Follow" here always means following a **person**. Following a historical
 * context — a real-world Event, a Location — is a different relationship with
 * different rules, and nobody approves who watches shared history.
 */

/** What one person's follow of another looks like once it exists. */
export const followSchema = z.object({
  /** Who is being followed, as anyone may see them. */
  user: publicUserSchema,
  followedAt: timestampSchema,
});

export type Follow = z.infer<typeof followSchema>;

/** How far a request has got. */
export const followRequestStatusSchema = z.enum([
  /** Waiting on the person who was asked. */
  "pending",
  /** They said yes, and a Follow exists.  */
  "accepted",
  /** They said no. Deliberately not a block (`social-graph.md:181`). */
  "declined",
  /** The asker changed their mind. */
  "cancelled",
]);

export type FollowRequestStatus = z.infer<typeof followRequestStatusSchema>;

/** Somebody asking to follow an account that requires approval. */
export const followRequestSchema = z.object({
  requestId: identifierSchema,
  /**
   * Who asked, as anyone may see them. The person deciding needs to know who
   * is asking; that is the whole point of being asked.
   */
  requester: publicUserSchema,
  status: followRequestStatusSchema,
  requestedAt: timestampSchema,
});

export type FollowRequest = z.infer<typeof followRequestSchema>;

/**
 * What happened when somebody asked to follow.
 *
 * One of two things, and the response says which. That is deliberate: no
 * endpoint has to disclose whether an account requires approval, because the
 * answer to asking already reveals exactly as much as the asker needs.
 */
export const followOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("following"), follow: followSchema }),
  z.object({ outcome: z.literal("requested"), request: followRequestSchema }),
]);

export type FollowOutcome = z.infer<typeof followOutcomeSchema>;

/**
 * A page of people.
 *
 * Used for both followers and following. `nextCursor` is absent on the last
 * page and opaque throughout: it encodes where the ordering continues from,
 * and a caller that takes it apart will break when the ordering changes.
 */
export const followListSchema = z.object({
  users: z.array(publicUserSchema),
  nextCursor: z.string().optional(),
});

export type FollowList = z.infer<typeof followListSchema>;

/** Pending requests waiting on the caller. */
export const followRequestListSchema = z.object({
  requests: z.array(followRequestSchema),
  nextCursor: z.string().optional(),
});

export type FollowRequestList = z.infer<typeof followRequestListSchema>;

/** What a caller may ask for when listing people or requests. */
export const listFollowsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export type ListFollowsRequest = z.infer<typeof listFollowsRequestSchema>;

/**
 * A page of real-world Events somebody follows.
 *
 * Each Event whole rather than by identifier, so a client listing what somebody
 * follows can show it without a round trip per row.
 */
export const followedEventListSchema = z.object({
  realWorldEvents: z.array(realWorldEventSchema),
  nextCursor: z.string().optional(),
});

export type FollowedEventList = z.infer<typeof followedEventListSchema>;

/** A page of Locations somebody follows. */
export const followedLocationListSchema = z.object({
  locations: z.array(locationSchema),
  nextCursor: z.string().optional(),
});

export type FollowedLocationList = z.infer<typeof followedLocationListSchema>;
