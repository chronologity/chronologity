import { ValidationError } from "../../lib/errors/validation-error.js";

/**
 * Where a Timeline page resumes from.
 *
 * A position in history, not a page number. `timeline.md:776` requires keyset
 * semantics rather than offsets, and the reason is the product rather than
 * performance: history grows in the middle. A photograph uploaded today may
 * belong to 1969, so an offset taken a moment ago now points somewhere else,
 * and paging with it repeats rows and skips others.
 *
 * The tuple is `(occurredAt, momentId)` — the one `timeline.md:244` names, the
 * one the ClickHouse sort key uses, and the one 7A stored as text so that
 * ordering computed here and ordering computed there cannot disagree.
 */
export interface TimelinePosition {
  readonly occurredAt: Date;
  readonly momentId: string;
}

/**
 * The encoding's version.
 *
 * Carried so the shape can change without a cursor a client stored last month
 * becoming a wrong answer. An unrecognised version is refused, which a client
 * can act on by starting again; a silently misread one would resume somewhere
 * nobody asked for.
 */
const VERSION = 1;

/** What the cursor holds, kept short because it travels in a query string. */
interface Encoded {
  readonly v: number;
  /** Milliseconds since the epoch. Negative for history before 1970. */
  readonly t: number;
  readonly m: string;
}

/**
 * Encode a position.
 *
 * Base64url, so it survives a query string without escaping. Opaque rather than
 * encrypted: `timeline.md:794` asks that clients not read it, and this makes it
 * inconvenient rather than secret — which is the honest guarantee, since a
 * cursor names a position in history the Viewer is already being shown.
 *
 * @param position - Where the next page resumes.
 * @returns The cursor.
 */
export function encodeCursor(position: TimelinePosition): string {
  const encoded: Encoded = {
    v: VERSION,
    t: position.occurredAt.getTime(),
    m: position.momentId,
  };

  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
}

/**
 * Read a cursor a client handed back.
 *
 * Everything about this input is untrusted: it has been out of the system and
 * may have been edited, truncated, or kept since a previous version of the
 * encoding. Each of those is refused rather than interpreted — a cursor that
 * decoded to something plausible but wrong would page through the wrong part of
 * somebody's history without anybody noticing.
 *
 * @param cursor - The string a client supplied.
 * @returns The position it names.
 * @throws {ValidationError} If it is not a cursor this system issued: malformed,
 *   altered, missing a field, or of a version this code does not know.
 */
export function decodeCursor(cursor: string): TimelinePosition {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("That is not a usable cursor", { field: "cursor" });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError("That is not a usable cursor", { field: "cursor" });
  }

  const { v, t, m } = parsed as Partial<Encoded>;

  if (v !== VERSION) {
    // Distinct from malformed, and deliberately so: a client holding a cursor
    // from an older encoding should discard it and start again, which is a
    // different instruction from "you sent nonsense".
    throw new ValidationError("That cursor is from an older Timeline", { field: "cursor" });
  }

  if (typeof t !== "number" || !Number.isFinite(t) || typeof m !== "string" || m.length === 0) {
    throw new ValidationError("That is not a usable cursor", { field: "cursor" });
  }

  return { occurredAt: new Date(t), momentId: m };
}
