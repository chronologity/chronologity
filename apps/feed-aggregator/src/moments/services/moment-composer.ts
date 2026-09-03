import type {
  GeographicContext,
  Location,
  LocationDisclosure,
} from "@chronologity/contracts";
import { disclosePlace } from "@chronologity/moment-access";
import type { Position } from "../../pagination/cursors.js";
import type {
  CommentRow,
  MediaRow,
  MomentRow,
  ReactionCountRow,
  RelationshipRow,
  Slice,
} from "../../read-models/postgres/moment-read-model.js";

/**
 * Rows as a client receives them.
 *
 * Everything shaped, nothing decided. What a Viewer may read was settled inside
 * the statements; what is left is arranging it — and reducing the one thing that
 * cannot be reduced in SQL, which is how much of a place somebody is told.
 *
 * That reduction comes from `@chronologity/moment-access` rather than being
 * written again here. `locations.md:830` states the distinction the rule exists
 * to hold: "Can view Moment ≠ Can view exact Location", and a second copy of it
 * is a second place for a constraint to be widened and this one forgotten.
 */

/** Somebody, as anybody may see them. */
export interface PublicUserShape {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly biography: string | null;
  readonly createdAt: Date;
}

/**
 * Where a Moment happened, as one reader receives it.
 *
 * The contract's shape with its enums in the case GraphQL uses. Written out
 * rather than passed through, because the reduction and the presentation are
 * different jobs: `disclosePlace` decides how much somebody is told, and this
 * decides how it is spelled.
 */
export interface PlaceShape {
  readonly disclosure: string;
  readonly location: {
    readonly locationId: string;
    readonly name: string;
    readonly coordinates: { latitude: number; longitude: number } | null;
    readonly precision: string;
    readonly context: GeographicContext;
  } | null;
  readonly area: GeographicContext | null;
}

/** A Moment, composed. Media and comments arrive through their own fields. */
export interface MomentShape {
  readonly momentId: string;
  readonly author: PublicUserShape;
  readonly caption: string;
  readonly occurrence: { start: Date; end: Date; precision: string };
  readonly occurrenceOffsetMinutes: number;
  readonly place: PlaceShape | null;
  readonly visibility: string;
  readonly commentPolicy: string;
  readonly createdAt: Date;
}

/** Whether this reader marked the Moment, and when. */
export interface PersonalSignificanceShape {
  readonly momentId: string;
  readonly significant: boolean;
  readonly markedAt: Date | null;
}

/** One piece of media, as the schema's interface describes it. */
export interface MediaShape {
  readonly mediaId: string;
  /** Which member of the interface this is, read by `resolveType`. */
  readonly kind: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly derivatives: string[];
  readonly durationSeconds: number | null;
}

/** A comment, with everything about it already gathered. */
export interface CommentShape {
  readonly commentId: string;
  readonly momentId: string;
  readonly author: PublicUserShape | null;
  readonly body: string | null;
  readonly deleted: boolean;
  readonly threadCommentId: string | null;
  readonly inReplyToCommentId: string | null;
  readonly mentions: readonly { userId: string; handle: string }[];
  readonly reactions: ReactionSummaryShape;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

/** How something has been responded to. */
export interface ReactionSummaryShape {
  readonly enabled: boolean;
  readonly counts: readonly { kind: string; count: number }[];
  readonly total: number;
  readonly yours: string | null;
}

/** A page, in the shape every connection here takes. */
export interface Connection<Node> {
  readonly edges: readonly { cursor: Position; node: Node }[];
  readonly pageInfo: {
    startCursor: Position | null;
    endCursor: Position | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * A Moment as this reader receives it.
 *
 * @param row - The stored Moment, with its author and undisclosed place.
 * @param viewerUserId - Who is asking, which decides how much of the place they
 *   are told. The author always receives it exactly: a choice about what to tell
 *   other people was never a choice to forget it themselves.
 * @returns The Moment. Its place is null only when nobody said where — a place
 *   that exists but is withheld carries a `hidden` disclosure instead, because
 *   "nobody said" and "you are not being told" are different facts.
 */
export function momentFor(row: MomentRow, viewerUserId: string): MomentShape {
  return {
    momentId: row.moment_id,
    author: {
      userId: row.author_user_id,
      handle: row.handle,
      displayName: row.display_name,
      biography: row.biography,
      createdAt: row.author_created_at,
    },
    caption: row.caption,
    occurrence: {
      start: row.occurrence_start,
      end: row.occurrence_end,
      precision: asEnum(row.occurrence_precision),
    },
    occurrenceOffsetMinutes: row.occurrence_offset_minutes,
    place: placeFor(row, viewerUserId),
    visibility: asEnum(row.visibility),
    commentPolicy: asEnum(row.comment_policy),
    createdAt: row.created_at,
  };
}

/**
 * Whether this reader has marked the Moment.
 *
 * @param row - The stored Moment, carrying this reader's mark and nobody else's.
 * @returns The mark. Never a score, a count of other people's marks, or
 *   anything derived — none of which has a shape here to arrive in.
 */
export function significanceFor(row: MomentRow): PersonalSignificanceShape {
  return {
    momentId: row.moment_id,
    significant: row.marked_at !== null,
    markedAt: row.marked_at,
  };
}

/**
 * A page of media.
 *
 * @param slice - The rows and whether the sequence continues.
 * @param momentId - Which Moment they belong to, carried in each cursor so one
 *   taken from another Moment is refused rather than resumed at the same
 *   ordinal of a different sequence.
 * @param resumed - Whether the request supplied a cursor.
 * @returns The connection, in the order the author arranged it.
 */
export function mediaConnectionFor(
  slice: Slice<MediaRow>,
  momentId: string,
  resumed: boolean,
): Connection<MediaShape> {
  const edges = slice.rows.map((row) => ({
    cursor: { kind: "media", momentId, position: row.position } as const,
    node: mediaFor(row),
  }));

  return { edges, pageInfo: pageInfoFor(edges, slice.more, resumed) };
}

/**
 * A page of discussion.
 *
 * @param slice - The rows and whether the discussion continues.
 * @param resumed - Whether the request supplied a cursor.
 * @returns The connection, oldest first.
 */
export function commentConnectionFor(
  slice: Slice<CommentRow>,
  resumed: boolean,
): Connection<CommentShape> {
  const edges = slice.rows.map((row) => ({
    cursor: { kind: "comment", createdAt: row.created_at, commentId: row.comment_id } as const,
    node: commentFor(row),
  }));

  return { edges, pageInfo: pageInfoFor(edges, slice.more, resumed) };
}

/**
 * How a Moment has been responded to.
 *
 * @param rows - One row per kind anybody chose.
 * @param enabled - Whether the Moment accepts reactions at all.
 * @returns The summary. When reactions are off the counts are withheld rather
 *   than deleted, so turning them back on restores the same numbers — and a
 *   client must show "reactions are off" differently from "nobody reacted".
 */
export function reactionSummaryFor(
  rows: readonly ReactionCountRow[],
  enabled: boolean,
): ReactionSummaryShape {
  if (!enabled) {
    return { enabled: false, counts: [], total: 0, yours: null };
  }

  // A kind chosen only by people who are now suspended counts zero, and a kind
  // nobody chose has no row at all. Both are absent rather than present as
  // zero, so a client shows what happened rather than a row of empties.
  const counts = rows
    .filter((row) => row.count > 0)
    .map((row) => ({ kind: asEnum(row.kind), count: row.count }));

  // Theirs is not an identity disclosure, and without it a client cannot show
  // which one they chose. Found before the zero-count filter above, so a
  // suspended reader is still told what they themselves chose.
  const mine = rows.find((row) => row.mine);

  return {
    enabled: true,
    counts,
    total: counts.reduce((running, row) => running + row.count, 0),
    yours: mine === undefined ? null : asEnum(mine.kind),
  };
}

/**
 * A claim connecting two Moments.
 *
 * @param row - The stored relationship.
 * @returns The claim. A far end withheld by moderation arrives as `unavailable`
 *   and nothing else; one withheld by privacy never reaches this function,
 *   because the statement omitted it.
 */
export function relationshipFor(row: RelationshipRow): {
  relationshipId: string;
  sourceMomentId: string;
  targetMomentId: string;
  kind: string;
  origin: string;
  assertedByUserId: string;
  createdAt: Date;
  unavailable: boolean;
} {
  return {
    relationshipId: row.relationship_id,
    sourceMomentId: row.source_moment_id,
    targetMomentId: row.target_moment_id,
    kind: asEnum(row.kind),
    origin: asEnum(row.origin),
    assertedByUserId: row.asserted_by_user_id,
    createdAt: row.created_at,
    unavailable: row.unavailable,
  };
}

/**
 * One comment, with its author, mentions and responses.
 *
 * @param row - The stored comment.
 * @returns The comment. A deleted one keeps its identifier and its place in the
 *   conversation and loses its author and its words — the replies need
 *   something to hang from, and nothing else about it is anybody's business.
 */
function commentFor(row: CommentRow): CommentShape {
  const deleted = row.deleted_at !== null;

  return {
    commentId: row.comment_id,
    momentId: row.moment_id,
    author:
      deleted || row.handle === null || row.display_name === null || row.author_created_at === null
        ? null
        : {
            userId: row.author_user_id,
            handle: row.handle,
            displayName: row.display_name,
            biography: row.biography,
            createdAt: row.author_created_at,
          },
    body: deleted ? null : row.body,
    deleted,
    threadCommentId: row.thread_comment_id,
    inReplyToCommentId: row.in_reply_to_comment_id,
    // A tombstone mentions nobody: the text is gone, so who it referred to is
    // no longer a fact about anything a reader can see.
    mentions: deleted ? [] : (row.mentions ?? []),
    reactions: reactionSummaryFor(
      (row.counts ?? []).map((count) => ({
        kind: count.kind,
        count: count.count,
        mine: count.kind === row.yours,
      })),
      true,
    ),
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/**
 * One piece of media.
 *
 * @param row - The stored media, joined to its upload.
 * @returns What a reader receives: what a decoder found, and which forms have
 *   been produced. Never a storage key, a URL, an upload state or a failure —
 *   those are an author's view of their own upload.
 */
function mediaFor(row: MediaRow): MediaShape {
  return {
    mediaId: row.upload_id,
    kind: row.kind,
    width: row.width,
    height: row.height,
    derivatives: (row.derivatives ?? []).map(asEnum),
    // `numeric` arrives as a string, because a driver that turned it into a
    // float would be choosing precision on the database's behalf.
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
  };
}

/**
 * How much of a place this reader is told.
 *
 * @param row - The Moment, with its place joined whole and undisclosed.
 * @param viewerUserId - Who is asking.
 * @returns What to present, or null when the Moment has no place at all.
 */
function placeFor(row: MomentRow, viewerUserId: string): PlaceShape | null {
  if (row.location_id === null) {
    return null;
  }

  const location: Location = {
    locationId: row.location_id,
    name: row.location_name ?? "",
    coordinates:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    precision: (row.location_precision ?? "unknown") as Location["precision"],
    context: {
      neighbourhood: row.neighbourhood,
      city: row.city,
      region: row.region,
      country: row.country,
      countryCode: row.country_code,
    },
    sourceReference: row.source_reference,
    source: (row.location_source ?? "explicit-selection") as Location["source"],
    createdAt: (row.location_created_at ?? new Date(0)).toISOString(),
  };

  const disclosed = disclosePlace(
    viewerUserId,
    row.author_user_id,
    // Narrowed rather than validated. The column carries a check constraint and
    // the contract carries the same set; a value from neither is refused by
    // `disclosePlace`'s default branch, which withholds.
    row.location_disclosure as LocationDisclosure,
    location,
  );

  if (disclosed === null) {
    return null;
  }

  return {
    disclosure: asEnum(disclosed.disclosure),
    location:
      disclosed.location === null
        ? null
        : {
            locationId: disclosed.location.locationId,
            name: disclosed.location.name,
            coordinates: disclosed.location.coordinates,
            precision: asEnum(disclosed.location.precision),
            context: disclosed.location.context,
          },
    area: disclosed.area,
  };
}

/**
 * Where a page sits.
 *
 * @param edges - The page, already built.
 * @param more - Whether the sequence continues past it.
 * @param resumed - Whether the request supplied a cursor, which is what says
 *   there is a page on the near side to go back to.
 * @returns The page information. Both these sequences run forwards, unlike a
 *   Timeline: `hasNextPage` means there is more further along.
 */
function pageInfoFor<Node>(
  edges: readonly { cursor: Position; node: Node }[],
  more: boolean,
  resumed: boolean,
): Connection<Node>["pageInfo"] {
  return {
    // Null rather than absent when the page holds nothing: an empty page has no
    // ends, and a cursor invented for one would name a position nothing holds.
    startCursor: edges[0]?.cursor ?? null,
    endCursor: edges[edges.length - 1]?.cursor ?? null,
    hasNextPage: more,
    hasPreviousPage: resumed,
  };
}

/**
 * The schema's name for a value the contract writes in lowercase.
 *
 * @param value - The contract's value, as stored.
 * @returns The GraphQL enum value, which is the same word in the case GraphQL
 *   uses. A value from neither vocabulary fails as an invalid enum rather than
 *   being quietly presented as something it is not.
 */
function asEnum(value: string): string {
  return value.toUpperCase();
}
