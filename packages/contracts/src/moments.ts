import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { geographicContextSchema, locationSchema } from "./locations.js";
import { realWorldEventSchema } from "./real-world-events.js";
import { occurrenceSchema, timestampSchema } from "./time.js";
import { uploadSchema } from "./uploads.js";
import { publicUserSchema } from "./users.js";

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

/**
 * Who may see a Moment.
 *
 * The three models `privacy.md:92` names, and no more. That document asks for a
 * vocabulary "as simple as possible" and warns against reproducing a matrix of
 * social-network privacy controls.
 *
 * There is deliberately no value meaning "my followers". `social-graph.md:490`
 * says a Follow does not override privacy: following states what somebody wants
 * to hear about, never what they are entitled to see.
 */
export const momentVisibilitySchema = z.enum(["private", "restricted", "public"]);

export type MomentVisibility = z.infer<typeof momentVisibilitySchema>;

/**
 * How much of a Moment's place other people are told.
 *
 * A different axis from a Location's own `precision`, and the two must not be
 * conflated. Precision says how well anybody knows where something happened —
 * it is a fact about history, and it is the same for everybody. Disclosure says
 * how much of that a given Viewer receives, and is the author's privacy choice.
 *
 * A place known exactly may still be disclosed as a city; a place known only to
 * the city reports `broad` precision to its author too.
 *
 * The author always receives the exact place. This governs everybody else.
 */
export const locationDisclosureSchema = z.enum([
  /** The place in full: its name, its coordinates, and its identity. */
  "exact",
  /** The neighbourhood it sits in, and the wider areas around that. */
  "neighbourhood",
  /** The city and wider, with the neighbourhood withheld. */
  "city",
  /** Nothing about where. The Moment itself is still readable. */
  "hidden",
]);

export type LocationDisclosure = z.infer<typeof locationDisclosureSchema>;

/**
 * A Moment's place, as one Viewer receives it.
 *
 * Two fields rather than one because they carry different things, and a client
 * has to know which it was given. At `exact` the whole Location is here, its
 * identifier included. Below that there is no identifier at all — a reduced
 * place is not a reference to a Location but a coarser statement about where,
 * and an identifier would let anybody look up what was just withheld
 * (`locations.md:855`).
 */
export const momentPlaceSchema = z.object({
  disclosure: locationDisclosureSchema,
  /** The place in full. Present only at `exact`. */
  location: locationSchema.nullable(),
  /** The area, at the granularity disclosed. Present at `neighbourhood` and `city`. */
  area: geographicContextSchema.nullable(),
});

export type MomentPlace = z.infer<typeof momentPlaceSchema>;

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
  /** Where it happened, if anybody knows. */
  locationId: identifierSchema.optional(),
  /**
   * How much of that place other people are told.
   *
   * Chosen while recording rather than only afterwards, so that somebody who
   * does not want a place published never has to publish it first and narrow it
   * after.
   */
  locationDisclosure: locationDisclosureSchema.default("exact"),
  /** The larger occurrences it was part of, if any. */
  realWorldEventIds: z.array(identifierSchema).max(20).optional(),
  /**
   * Who may see it. Public unless the author says otherwise.
   *
   * Accepted at creation rather than only afterwards, because with a public
   * default an author who wants privacy must be able to say so while recording
   * instead of publishing first and correcting after.
   *
   * `restricted` is accepted here without a list, which is the same audience as
   * `private` until one is set. Naming the audience is a separate call, so that
   * recording a Moment does not have to carry it.
   */
  visibility: momentVisibilitySchema.default("public"),
});

export type CreateMomentRequest = z.infer<typeof createMomentRequestSchema>;

/** A Moment, as whoever is permitted to see it receives it. */
export const momentSchema = z.object({
  momentId: identifierSchema,
  /**
   * Who recorded it.
   *
   * Authorship alone. Who may see it is `visibility`, and the two stopped
   * coinciding when Moments gained an audience.
   */
  authorUserId: identifierSchema,
  caption: captionSchema,
  occurrence: occurrenceSchema,
  occurrenceOffsetMinutes: utcOffsetMinutesSchema,
  /** The media in presentation order, whole rather than by identifier. */
  media: z.array(uploadSchema),
  /**
   * Where the experience happened, as this Viewer may receive it, or null when
   * nobody said.
   *
   * One place, not several: `locations.md:433` asks that the Moment-level
   * Location represent the experience as a whole, and media pointing at
   * several distinct places usually means several Moments.
   *
   * Null rather than absent, because "not known" is a fact about the history
   * and a missing key would only mean "not loaded". A Moment whose place is
   * withheld is not null here — it carries a `hidden` disclosure, because
   * "nobody said where" and "you are not being told where" are different facts.
   */
  place: momentPlaceSchema.nullable(),
  /**
   * The larger occurrences it was part of.
   *
   * Several are permitted, unlike Locations: a photograph at a wedding that is
   * also part of a family reunion is genuinely both.
   */
  realWorldEvents: z.array(realWorldEventSchema),
  /** Who may see it. */
  visibility: momentVisibilitySchema,
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

/**
 * Setting who may see a Moment.
 *
 * The audience travels with the visibility rather than in a call of its own, so
 * a Moment is never restricted with a list from some earlier decision. Both
 * land in one transaction.
 *
 * An audience is accepted only alongside `restricted`. Supplying one with
 * `public` or `private` is refused rather than ignored: it means the caller
 * believes something about the result that would not be true.
 */
export const setMomentVisibilityRequestSchema = z
  .object({
    visibility: momentVisibilitySchema,
    /**
     * Who may see it, replacing whoever was named before.
     *
     * Bounded. A Moment may hold unlimited media at the product level, but an
     * audience is a request payload and a list somebody types, and every
     * operation here stays bounded.
     */
    audience: z.array(identifierSchema).max(100).optional(),
  })
  .refine(
    (body) => body.visibility === "restricted" || body.audience === undefined,
    { message: "An audience may only be set on a restricted Moment", path: ["audience"] },
  );

export type SetMomentVisibilityRequest = z.infer<typeof setMomentVisibilityRequestSchema>;

/** Who may see a restricted Moment, as its author sees the list. */
export const momentAudienceSchema = z.object({ users: z.array(publicUserSchema) });

export type MomentAudience = z.infer<typeof momentAudienceSchema>;

/** Changing how much of a Moment's place other people are told. */
export const setLocationDisclosureRequestSchema = z.object({
  disclosure: locationDisclosureSchema,
});

export type SetLocationDisclosureRequest = z.infer<typeof setLocationDisclosureRequestSchema>;

/**
 * What one Moment may claim about another.
 *
 * Two kinds assert influence and three deliberately do not.
 * `causality.md:415` requires that contextual relationships never imply causal
 * ones, and without a non-causal option every connection somebody wants to draw
 * would have to be phrased as causation.
 *
 * Deliberately small. `causality.md:156` asks that the vocabulary "remain
 * intentionally small until product testing demonstrates that users need more
 * precision", and warns against an elaborate ontology built before anybody has
 * watched how people describe their own histories.
 */
export const momentRelationshipKindSchema = z.enum([
  /** The source meaningfully brought the target about. */
  "led_to",
  /** The source was one of several things that brought the target about. */
  "contributed_to",
  /** Connected, without any claim about how. */
  "related_to",
  /** Another account of substantially the same occurrence. */
  "alternate_perspective",
  /** The source disputes a claim the target represents. */
  "contradicts",
]);

export type MomentRelationshipKind = z.infer<typeof momentRelationshipKindSchema>;

/**
 * Where a relationship came from.
 *
 * Only `asserted` is producible. The others are named so that a suggestion
 * engine is additive and so that what it produces can never be mistaken for
 * what a person said — `causality.md:187` requires that such output stay a
 * hypothesis rather than becoming historical authority.
 */
export const momentRelationshipOriginSchema = z.enum(["asserted", "derived", "suggested"]);

export type MomentRelationshipOrigin = z.infer<typeof momentRelationshipOriginSchema>;

/**
 * A claim connecting two Moments.
 *
 * Carries no confidence score, deliberately. `causality.md:485` warns against
 * "87% likely that Moment A caused Moment B": human histories are not improved
 * by false mathematical precision.
 */
export const momentRelationshipSchema = z.object({
  relationshipId: identifierSchema,
  /** Which way the claim runs. Meaningless for the symmetric kinds. */
  sourceMomentId: identifierSchema,
  targetMomentId: identifierSchema,
  kind: momentRelationshipKindSchema,
  origin: momentRelationshipOriginSchema,
  /** Whose perspective this is (`causality.md:520`). */
  assertedByUserId: identifierSchema,
  createdAt: timestampSchema,
  /**
   * Whether the far end has been withheld by moderation.
   *
   * `moderation.md:713` draws the case exactly: a chain running Moment A to
   * Moment C through something now unavailable should keep its shape rather
   * than quietly becoming two unrelated pairs. The relationship is still true —
   * moderation decides what Chronologity distributes, not what happened.
   *
   * True carries nothing else: no title, no author, no place, no Event, no
   * media, as `moderation.md:722` requires. It says a link continues here and
   * refuses to say through what.
   *
   * Never true for a Moment privacy hides rather than moderation. Those are
   * absent from the list entirely, because `privacy.md:158` forbids using a
   * visible relationship to reveal an inaccessible Moment, and a marker where
   * somebody's private history sits would do exactly that.
   */
  unavailable: z.boolean(),
});

export type MomentRelationship = z.infer<typeof momentRelationshipSchema>;

/** Claiming a relationship from one Moment to another. */
export const assertMomentRelationshipRequestSchema = z.object({
  targetMomentId: identifierSchema,
  kind: momentRelationshipKindSchema,
});

export type AssertMomentRelationshipRequest = z.infer<
  typeof assertMomentRelationshipRequestSchema
>;

/**
 * A Moment's relationships, in both directions.
 *
 * Only those whose other end this Viewer may see. `privacy.md:158`:
 * "Chronologity must never use a visible relationship to reveal an
 * inaccessible Moment."
 */
export const momentRelationshipListSchema = z.object({
  relationships: z.array(momentRelationshipSchema),
});

export type MomentRelationshipList = z.infer<typeof momentRelationshipListSchema>;

/**
 * A lightweight response to a Moment.
 *
 * Four feelings, each describing the reader rather than the history. None of
 * them amounts to confirming that a Moment occurred as represented, which
 * `reactions.md:99` warns against: there is no verification capability behind
 * such a claim, so no reaction may imply one.
 *
 * These are names, never glyphs. `reactions.md:101` requires that changing an
 * icon must not silently transform the meaning of what is stored — so the
 * artwork a client renders is free to change, and the meaning recorded against
 * years of history is not.
 */
export const reactionKindSchema = z.enum([
  /** Warmth, affection, being touched by it. */
  "loved",
  /** It was funny. */
  "amused",
  /** Wonder, or disbelief. */
  "astonished",
  /** Sorrow, sympathy, loss. */
  "saddened",
]);

export type ReactionKind = z.infer<typeof reactionKindSchema>;

/** Setting your own reaction to a Moment. */
export const setReactionRequestSchema = z.object({ kind: reactionKindSchema });

export type SetReactionRequest = z.infer<typeof setReactionRequestSchema>;

/** Turning reactions on or off for a Moment. */
export const setReactionsEnabledRequestSchema = z.object({ enabled: z.boolean() });

export type SetReactionsEnabledRequest = z.infer<typeof setReactionsEnabledRequestSchema>;

/**
 * How a Moment has been responded to.
 *
 * Counts, never identities. `reactions.md:307` asks that displaying an
 * aggregate and displaying exactly who reacted be distinguished deliberately,
 * and a list of reactors on a restricted Moment would reveal that Moment's
 * audience to everybody on it.
 *
 * Counts are derived and may lag at scale (`reactions.md:214`). They are not a
 * measure of historical importance and must never be presented as one: a
 * private family Moment with two may matter more than a public one with
 * millions.
 */
export const reactionSummarySchema = z.object({
  /**
   * Whether this Moment accepts reactions.
   *
   * False hides the counts as well as refusing new ones. Told rather than
   * implied, because "reactions are off" and "nobody has reacted" are different
   * facts and a client that cannot tell them apart will render the wrong thing.
   */
  enabled: z.boolean(),
  /** How many of each kind. A kind nobody chose is absent rather than zero. */
  counts: z.partialRecord(reactionKindSchema, z.number().int().min(0)),
  /** Everybody who reacted, counted once each. */
  total: z.number().int().min(0),
  /**
   * Your own, or null.
   *
   * Yours is not an identity disclosure, and without it a client cannot show
   * which one you chose.
   */
  yours: reactionKindSchema.nullable(),
});

export type ReactionSummary = z.infer<typeof reactionSummarySchema>;

/**
 * Who may join the discussion on a Moment.
 *
 * Seeing a Moment does not by itself mean being able to comment on it
 * (`comments.md:417`); this is what separates the two.
 *
 * `followers` grants no access. A stranger who could read the Moment still can
 * — it governs participation rather than sight, which is why it does not
 * contradict the rule that a Follow never bypasses a visibility rule.
 */
export const commentPolicySchema = z.enum(["anyone", "followers", "disabled"]);

export type CommentPolicy = z.infer<typeof commentPolicySchema>;

/** How long a comment may be, after normalisation. */
export const COMMENT_MAX_LENGTH = 500;

/**
 * What somebody wrote.
 *
 * Plain text. `comments.md:537` asks the initial model to avoid a rich-text
 * editor, and `comments.md:527` keeps media out entirely: Chronologity already
 * has a first-class construct for preserving media, and it is a Moment.
 */
export const commentBodySchema = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);

/** Somebody a comment refers to, resolved to identity rather than to a handle. */
export const commentMentionSchema = z.object({
  userId: identifierSchema,
  /** Their handle as it stands now, which may not be the one that was typed. */
  handle: z.string(),
});

export type CommentMention = z.infer<typeof commentMentionSchema>;

/**
 * A comment on a Moment.
 *
 * Conversation, not history (`comments.md:58`). When it was written says
 * nothing about when the experience happened.
 *
 * A deleted comment with replies still appears, carrying neither body nor
 * author: the replies need something to hang from, and `comments.md:339` asks
 * for a generic representation rather than one preserving identity nobody needs
 * to see.
 */
export const commentSchema = z.object({
  commentId: identifierSchema,
  momentId: identifierSchema,
  /** Null on a deleted comment kept as a tombstone. */
  author: publicUserSchema.nullable(),
  /** Null on a deleted comment kept as a tombstone. */
  body: commentBodySchema.nullable(),
  /** True when this is a tombstone rather than something somebody wrote. */
  deleted: z.boolean(),
  /** The top-level comment this belongs to, or null when it is one. */
  threadCommentId: identifierSchema.nullable(),
  /** Which comment was actually addressed, where that differs from the thread. */
  inReplyToCommentId: identifierSchema.nullable(),
  /** Who it refers to in conversation. Never a claim that they were there. */
  mentions: z.array(commentMentionSchema),
  /** How it has been responded to, and your own. */
  reactions: reactionSummarySchema,
  /** Its position in the conversation, and never rewritten by an edit. */
  createdAt: timestampSchema,
  /** When the visible text last changed, or null if it never has. */
  editedAt: timestampSchema.nullable(),
});

export type Comment = z.infer<typeof commentSchema>;

/**
 * A page of comments, oldest first.
 *
 * Ascending, unlike every other list here. `comments.md:198`: showing the
 * beginning of a discussion first preserves the context that makes later
 * replies comprehensible, and engagement ranking would make the order opaque.
 */
export const commentPageSchema = z.object({
  comments: z.array(commentSchema),
  /** Every comment on the Moment, replies included (`comments.md:230`). */
  total: z.number().int().min(0),
  nextCursor: z.string().optional(),
});

export type CommentPage = z.infer<typeof commentPageSchema>;

/** Saying something, or replying to something already said. */
export const createCommentRequestSchema = z.object({
  body: commentBodySchema,
  /**
   * Which comment this replies to, if any.
   *
   * Replying to a reply joins that reply's thread rather than nesting deeper.
   */
  inReplyToCommentId: identifierSchema.optional(),
  /**
   * Optional, and the answer to a retried submission.
   *
   * Supplying the same identifier twice yields one comment; supplying none
   * twice yields two, because repeating yourself deliberately is allowed
   * (`comments.md:561`).
   */
  commentId: identifierSchema.optional(),
});

export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

/** Correcting what somebody wrote. */
export const editCommentRequestSchema = z.object({ body: commentBodySchema });

export type EditCommentRequest = z.infer<typeof editCommentRequestSchema>;

/** Setting who may join the discussion. */
export const setCommentPolicyRequestSchema = z.object({ policy: commentPolicySchema });

export type SetCommentPolicyRequest = z.infer<typeof setCommentPolicyRequestSchema>;

/** What a caller may ask for when reading a discussion. */
export const listCommentsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type ListCommentsRequest = z.infer<typeof listCommentsRequestSchema>;

/**
 * What a caller may ask for when reading a Moment's media.
 *
 * A Moment may hold any number of images and videos, and that is a statement
 * about the product rather than about a request. `moments.md:103` draws the
 * line: "unlimited" describes the model, not the absence of infrastructure
 * safeguards, and unlimited media is delivered through bounded pages.
 *
 * Bounded here rather than wherever a page happens to be assembled, so that a
 * second surface cannot arrive at a different ceiling. The numbers match the
 * discussion above for no deeper reason than that both are somebody scrolling.
 */
export const listMomentMediaRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type ListMomentMediaRequest = z.infer<typeof listMomentMediaRequestSchema>;

/**
 * What a caller may ask for when reading a Moment's relationships.
 *
 * A list rather than a page: the vocabulary of relationship kinds is small on
 * purpose, and a Moment connected to more than a hundred others is not the case
 * this bound exists to serve — it exists so that one request cannot ask for
 * every claim in the graph.
 */
export const listMomentRelationshipsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export type ListMomentRelationshipsRequest = z.infer<
  typeof listMomentRelationshipsRequestSchema
>;

/**
 * Whether somebody has marked a Moment as mattering to them.
 *
 * One binary mark, and private always. Which Moments matter to somebody is
 * closer to a diary than to a reaction, so this reports only the caller's own —
 * there is no shape here that could carry anybody else's.
 *
 * A mark says something about that person's relationship to the Moment and
 * nothing about universal importance (`historical-significance.md:312`).
 */
export const personalSignificanceSchema = z.object({
  momentId: identifierSchema,
  /** Whether you marked it. Never whether anybody else did. */
  significant: z.boolean(),
  /** When you marked it, or null. */
  markedAt: timestampSchema.nullable(),
});

export type PersonalSignificance = z.infer<typeof personalSignificanceSchema>;

/** Correcting what a Moment says happened. */
export const updateCaptionRequestSchema = z.object({ caption: captionSchema });

export type UpdateCaptionRequest = z.infer<typeof updateCaptionRequestSchema>;

/**
 * Moving a Moment to where it actually belongs in history.
 *
 * Its own request rather than part of a general update, because it is not the
 * same act: `moments.md:443` treats this as a historical correction rather than
 * an ordinary edit, and it may move the Moment through chronological
 * navigation.
 */
export const correctOccurrenceRequestSchema = z.object({
  occurrence: occurrenceSchema,
  occurrenceOffsetMinutes: utcOffsetMinutesSchema,
});

export type CorrectOccurrenceRequest = z.infer<typeof correctOccurrenceRequestSchema>;

/** Adding media to a Moment, appended in the order given. */
export const addMediaRequestSchema = z.object({
  uploadIds: z.array(identifierSchema).min(1).max(100),
});

export type AddMediaRequest = z.infer<typeof addMediaRequestSchema>;

/**
 * Changing the order a Moment shows its media in.
 *
 * Every medium the Moment has, in the order asked for. A list that adds or
 * drops anything is refused: that would be an addition or a removal, and each
 * has rules a reorder does not apply.
 */
export const reorderMediaRequestSchema = z.object({
  uploadIds: z.array(identifierSchema).min(1).max(100),
});

export type ReorderMediaRequest = z.infer<typeof reorderMediaRequestSchema>;
