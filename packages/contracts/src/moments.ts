import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { occurrenceSchema, timestampSchema } from "./time.js";
import { uploadSchema } from "./uploads.js";

/**
 * Moment boundary contracts.
 *
 * A Moment is the fundamental unit of represented history: something that
 * happened, at a time, recorded by one person. It is not a media file
 * (`moments.md:54` — "Moment ≠ Media"), and it is not a container: media is
 * evidence of an experience, and the Moment is the experience.
 *
 * Its position in history comes from when the experience happened, never from
 * when it was recorded. A Moment entered today for something in 2014 belongs in
 * 2014, and nothing that happens afterwards — a comment, a reaction, a
 * correction — moves it.
 */

/**
 * The words that say what happened.
 *
 * Required. Media and a timestamp alone are a photograph with a date on it; the
 * caption is what makes the record be about an experience. This is a
 * deliberate product decision that overrides `moments.md`'s earlier "may
 * include descriptive text", and that document now says so.
 */
export const captionSchema = z.string().trim().min(1).max(2_000);

/**
 * How far from UTC the person was when it happened.
 *
 * Minutes, matching the offset an ISO-8601 timestamp already carries, and
 * ranged to the real span of world offsets — from -12:00 to +14:00.
 *
 * Stored because a `timestamptz` column keeps the instant and throws the offset
 * away, and the offset is what "half past seven in the evening" means.
 * `moments.md:263` asks that enough context survive to reconstruct the intended
 * historical meaning; the instant alone does not.
 */
export const utcOffsetMinutesSchema = z.number().int().min(-720).max(840);

/** What someone supplies to record a Moment. */
export const createMomentRequestSchema = z.object({
  caption: captionSchema,
  /**
   * When it happened, as an interval at the precision it is actually known at.
   *
   * The same shape real-world Events use. A Moment known only as "summer 1998"
   * is that interval at `month` precision and never acquires an invented day
   * (`moments.md:253`).
   */
  occurrence: occurrenceSchema,
  occurrenceOffsetMinutes: utcOffsetMinutesSchema,
  /**
   * The media, in the order it should be shown.
   *
   * At least one. Each must already be `ready` — opened by a decoder and found
   * to be what it claimed — and must belong to whoever is recording the Moment.
   *
   * Order here is presentation only. It says nothing about when anything
   * happened, and changing it never moves the Moment through chronology
   * (`moments.md:143`).
   */
  uploadIds: z.array(identifierSchema).min(1).max(100),
});

export type CreateMomentRequest = z.infer<typeof createMomentRequestSchema>;

/** A Moment, as whoever is permitted to see it receives it. */
export const momentSchema = z.object({
  momentId: identifierSchema,
  /**
   * Who recorded it.
   *
   * Authorship, and for now also audience: every Moment is private to its
   * author until the social graph exists.
   */
  authorUserId: identifierSchema,
  caption: captionSchema,
  occurrence: occurrenceSchema,
  occurrenceOffsetMinutes: utcOffsetMinutesSchema,
  /** The media in presentation order, whole rather than by identifier. */
  media: z.array(uploadSchema),
  /** Who may see it. One value for now, and stated rather than implied. */
  visibility: z.literal("private"),
  /** When it was recorded, which is not when it happened. */
  createdAt: timestampSchema,
});

export type Moment = z.infer<typeof momentSchema>;

/**
 * A page of Moments.
 *
 * `nextCursor` is absent on the last page. It is opaque on purpose: it encodes
 * the occurrence and identifier the next page continues from, and a caller that
 * takes it apart will break when the ordering changes.
 */
export const momentPageSchema = z.object({
  moments: z.array(momentSchema),
  nextCursor: z.string().optional(),
});

export type MomentPage = z.infer<typeof momentPageSchema>;

/** What a caller may ask for when listing their own Moments. */
export const listMomentsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type ListMomentsRequest = z.infer<typeof listMomentsRequestSchema>;
