import {
  CursorError,
  decodeCursor,
  encodeCursor,
  type TimelinePosition,
} from "@chronologity/timeline-derivation";
import { ValidationError } from "../errors/aggregator-error.js";

/**
 * Where a page resumes, whatever it is a page of.
 *
 * A Timeline runs on `(occurredAt, momentId)`; a Moment's media runs on its
 * position in the sequence; a discussion runs on `(createdAt, commentId)`. Three
 * orderings, and one `Cursor` scalar in the schema, because a client should not
 * have to learn a second opaque string for the second thing it pages.
 *
 * **The Timeline's bytes do not change.** That encoding is shared with
 * `apps/api` through `@chronologity/timeline-derivation`, and a cursor somebody
 * stored last month has to go on working. So the Timeline kind delegates to the
 * shared codec and produces exactly what it produced before; only the kinds this
 * application invented carry a tag.
 *
 * These live here rather than in the shared package for the reason ADR-138
 * gives: that package holds what two applications must agree about, and nothing
 * in `apps/api` pages a Moment's media or its comments. `feed.md:527` gives
 * client-facing cursor encoding to the aggregator.
 */

/** A position in whatever is being paged. */
export type Position =
  | ({ readonly kind: "timeline" } & TimelinePosition)
  | { readonly kind: "media"; readonly momentId: string; readonly position: number }
  | { readonly kind: "comment"; readonly createdAt: Date; readonly commentId: string }
  | {
      readonly kind: "context";
      /**
       * Which tier of the axis this position is in.
       *
       * The axis runs in two: contexts sharing history with where somebody is
       * standing, then everything else whose history reaches the same period.
       * Paging has to know which one it is walking, because the two are ordered
       * differently and the boundary between them is crossed exactly once.
       */
      readonly tier: "shared" | "period";
      /** How many Moments the two contexts share. Zero in the second tier. */
      readonly shared: number;
      /** The most recent Moment behind this context, which both tiers order by. */
      readonly latest: Date;
      readonly contextType: string;
      readonly contextId: string;
    };

/** The kinds of thing a cursor can name. */
export type PositionKind = Position["kind"];

/** The encoding's version, for the kinds this application owns. */
const VERSION = 1;

/** How a tagged cursor is written down. Short keys, because it travels. */
interface Encoded {
  readonly v: number;
  readonly k: "m" | "c" | "x";
  /** The Moment a media page belongs to. */
  readonly i?: string;
  /** A media position within that Moment. */
  readonly p?: number;
  /** A comment's instant, in milliseconds. */
  readonly t?: number;
  /** A comment's identifier. */
  readonly c?: string;
  /** Which tier of the horizontal axis: `s` shared, `p` same period. */
  readonly r?: "s" | "p";
  /** How many Moments two contexts share. */
  readonly n?: number;
  /** A context's kind, and which one. */
  readonly ct?: string;
  readonly ci?: string;
}

/**
 * Write a position down.
 *
 * @param position - Where a page resumes.
 * @returns The opaque cursor. For a Timeline position this is byte-identical to
 *   what the shared codec has always produced, so nothing a client holds and
 *   nothing the API issued stops working.
 */
export function encodePosition(position: Position): string {
  if (position.kind === "timeline") {
    return encodeCursor(position);
  }

  const encoded: Encoded =
    position.kind === "media"
      ? { v: VERSION, k: "m", i: position.momentId, p: position.position }
      : position.kind === "comment"
        ? { v: VERSION, k: "c", t: position.createdAt.getTime(), c: position.commentId }
        : {
            v: VERSION,
            k: "x",
            r: position.tier === "shared" ? "s" : "p",
            n: position.shared,
            t: position.latest.getTime(),
            ct: position.contextType,
            ci: position.contextId,
          };

  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
}

/**
 * Read a cursor a client handed back.
 *
 * Everything about this input is untrusted: it has been out of the system and
 * may have been edited, truncated, or kept since a previous version of the
 * encoding. Each of those is refused rather than interpreted.
 *
 * @param cursor - The string a client supplied.
 * @returns The position it names.
 * @throws {CursorError} If it is not a cursor this system issued. A string
 *   carrying no tag is handed to the shared decoder untouched, so a Timeline
 *   cursor is refused in the shared package's words rather than in a second set
 *   that could describe the same failure differently.
 */
export function decodePosition(cursor: string): Position {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    // Not readable as anything. Let the shared decoder refuse it, so a
    // malformed cursor says the same thing whichever connection received it.
    return { kind: "timeline", ...decodeCursor(cursor) };
  }

  if (typeof parsed !== "object" || parsed === null || !("k" in parsed)) {
    // Untagged, and therefore the Timeline's. Passed on as the original string
    // rather than as what was parsed out of it: version refusal is the shared
    // package's to make, and re-encoding here would be a second implementation
    // of a decision that must have one.
    return { kind: "timeline", ...decodeCursor(cursor) };
  }

  const { v, k, i, p, t, c, r, n, ct, ci } = parsed as Partial<Encoded>;

  if (v !== VERSION) {
    throw new CursorError("That cursor is from an older version of this Timeline");
  }

  if (k === "m" && typeof i === "string" && typeof p === "number" && Number.isInteger(p)) {
    return { kind: "media", momentId: i, position: p };
  }

  if (k === "c" && typeof t === "number" && Number.isFinite(t) && typeof c === "string") {
    return { kind: "comment", createdAt: new Date(t), commentId: c };
  }

  if (
    k === "x" &&
    (r === "s" || r === "p") &&
    typeof n === "number" &&
    Number.isInteger(n) &&
    typeof t === "number" &&
    Number.isFinite(t) &&
    typeof ct === "string" &&
    typeof ci === "string"
  ) {
    return {
      kind: "context",
      tier: r === "s" ? "shared" : "period",
      shared: n,
      latest: new Date(t),
      contextType: ct,
      contextId: ci,
    };
  }

  throw new CursorError("That is not a usable cursor");
}

/**
 * Insist that a cursor is for the connection that received it.
 *
 * One scalar serving three connections means a client can hand any of them to
 * any of them, and the shapes are close enough that the wrong one decodes to
 * something plausible. A Timeline cursor read as a media position would resume a
 * sequence at an ordinal it never named — quietly, and only for whoever did it.
 * That is the failure the shared decoder's own comment warns about, and this is
 * where it is refused.
 *
 * @param position - What the scalar decoded.
 * @param kind - What this connection pages.
 * @returns The position, narrowed.
 * @throws {ValidationError} If it names a different kind of thing. The message
 *   says which connection refused it and nothing about the encoding.
 */
export function expectKind<K extends PositionKind>(
  position: Position,
  kind: K,
): Extract<Position, { kind: K }> {
  if (position.kind !== kind) {
    throw new ValidationError("That cursor is not for this connection");
  }

  return position as Extract<Position, { kind: K }>;
}
