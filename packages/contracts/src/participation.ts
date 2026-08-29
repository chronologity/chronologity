import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";
import { publicUserSchema } from "./users.js";

/**
 * Participation contracts.
 *
 * Participation records that a User was part of the experience a Moment
 * represents. It is a claim about history and never about access
 * (`participation.md:38`): a participant may be somebody who cannot read the
 * Moment at all, and accepting grants them nothing.
 *
 * A creator proposes and only the person named may establish it. That is the
 * whole model, and the reason the word is "participation" rather than
 * "tagging" — tagging describes an act performed on somebody, participation
 * describes a fact about them which they confirm.
 */

/** How far a participation has got. */
export const participationStatusSchema = z.enum([
  /** Proposed by the Moment's creator, waiting on the person named. */
  "proposed",
  /** They confirmed they were there. */
  "accepted",
  /** They said they were not, or would rather not be recorded as having been. */
  "rejected",
  /** They accepted once and have since taken it back. */
  "withdrawn",
]);

export type ParticipationStatus = z.infer<typeof participationStatusSchema>;

/**
 * How many people one Moment may name.
 *
 * Proposals count against it as well as acceptances, so a pending proposal
 * holds its place — otherwise a hundred could accept out of a hundred and fifty
 * asked. The limit is not about storage: a proposal is an unsolicited assertion
 * about a person delivered to that person, and uncapped, one Moment reaches
 * everybody.
 */
export const MAXIMUM_PARTICIPANTS = 100;

/**
 * A participation as the person named sees it.
 *
 * Carries the Moment's identifier and nothing the Moment says. Whether they may
 * read it is a separate question with a separate answer, and a proposal that
 * disclosed a caption would have disclosed it before they agreed to anything.
 */
export const participationSchema = z.object({
  participationId: identifierSchema,
  momentId: identifierSchema,
  /** Who is said to have been there. */
  user: publicUserSchema,
  /** Whose Moment it is, and therefore who proposed. */
  proposedBy: publicUserSchema,
  status: participationStatusSchema,
  proposedAt: timestampSchema,
  /** When it was answered, absent while it is still a question. */
  resolvedAt: timestampSchema.optional(),
});

export type Participation = z.infer<typeof participationSchema>;

/** Naming somebody who was there. */
export const proposeParticipationSchema = z.object({
  userId: identifierSchema,
});

export type ProposeParticipation = z.infer<typeof proposeParticipationSchema>;

/**
 * Which of somebody's participations to list.
 *
 * The two directions are separate screens with separate actions: what has been
 * proposed to you is a question you must answer, and what you proposed is a
 * claim you may retract.
 */
export const participationDirectionSchema = z.enum(["to-me", "by-me"]);

export type ParticipationDirection = z.infer<typeof participationDirectionSchema>;

/** Asking for a page of participations. */
export const listParticipationsRequestSchema = z.object({
  direction: participationDirectionSchema.default("to-me"),
  /** Absent means every state, which is how somebody reviews their history. */
  status: participationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export type ListParticipationsRequest = z.infer<typeof listParticipationsRequestSchema>;

/** A page of participations. */
export const participationListSchema = z.object({
  items: z.array(participationSchema),
  nextCursor: z.string().optional(),
});

export type ParticipationList = z.infer<typeof participationListSchema>;

/**
 * Who a Moment records as having been there.
 *
 * Accepted participations only. A proposal is visible to the two people in it
 * and to nobody else, so it must not be reachable from the Moment — which is
 * why this is a list of people rather than of participations.
 */
export const momentParticipantsSchema = z.object({
  participants: z.array(
    z.object({
      user: publicUserSchema,
      /** When they confirmed it, not when they were asked. */
      acceptedAt: timestampSchema,
    }),
  ),
});

export type MomentParticipants = z.infer<typeof momentParticipantsSchema>;

/** Somebody whose proposals are refused before they are made. */
export const participationRefusalSchema = z.object({
  user: publicUserSchema,
  refusedAt: timestampSchema,
});

export type ParticipationRefusal = z.infer<typeof participationRefusalSchema>;

/**
 * A page of refusals.
 *
 * Only ever your own, and only the direction you can act on. Who has refused
 * *you* is not something the product will tell you, for the same reason a Block
 * is not announced.
 */
export const participationRefusalListSchema = z.object({
  items: z.array(participationRefusalSchema),
  nextCursor: z.string().optional(),
});

export type ParticipationRefusalList = z.infer<typeof participationRefusalListSchema>;
