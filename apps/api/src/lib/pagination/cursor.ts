import { ValidationError } from "../errors/validation-error.js";

/**
 * Where a page continues from, for any list ordered on a moment and an
 * identifier.
 *
 * Every keyset list in this system orders on a pair rather than on a moment
 * alone, because two rows sharing a moment is ordinary — several follows made
 * in one sitting, several uploads registered at once — and a cursor over the
 * moment alone skips or repeats a row at the page boundary. That defect
 * shipped once already (ADR-105), which is why this lives in one place instead
 * of being written out per feature.
 *
 * The encoding is opaque on purpose. A caller that takes a cursor apart and
 * rebuilds it will break the moment an ordering changes.
 *
 * It is not a security boundary and does not pretend to be one. A cursor names
 * a position, and every read is authorized against the caller regardless of
 * what the cursor says.
 */
export interface Cursor {
  /** The moment the row carries in the ordering. */
  readonly at: Date;
  /** What settles ties at that moment. */
  readonly id: string;
}

/**
 * What separates the two halves.
 *
 * The seam is found by the timestamp's trailing `Z` rather than by searching
 * for this character, because an ISO timestamp is full of colons of its own. A
 * cursor split on the last colon would read a bare timestamp as a well-formed
 * pair — `2026-08-22T10:30` and `00.000Z` — and page from a moment fifteen
 * seconds adrift instead of refusing.
 */
const SEPARATOR = ":";

/** What ends the timestamp, and appears nowhere else in it. */
const TIMESTAMP_END = "Z";

/**
 * Encode where the next page continues from.
 *
 * @param at - The moment the last row on the page carries.
 * @param id - What settles ties at that moment. Must not be empty, and must not
 *   contain the character that ends a timestamp, since that is where the two
 *   halves are told apart.
 * @returns The cursor to hand back.
 * @throws {Error} If the identifier cannot survive the round trip. A programming
 *   error rather than a caller's mistake, and louder than silently paging from
 *   the wrong place.
 */
export function encodeCursor(at: Date, id: string): string {
  if (id.length === 0 || id.includes(TIMESTAMP_END)) {
    throw new Error(`Cannot encode a cursor for identifier ${JSON.stringify(id)}`);
  }

  return Buffer.from(`${at.toISOString()}${SEPARATOR}${id}`, "utf8").toString("base64url");
}

/**
 * Decode where a page should continue from.
 *
 * @param cursor - What a caller sent back, or undefined for the first page.
 * @returns Where to continue after, or undefined when there was no cursor.
 * @throws {ValidationError} If it is not a cursor this module produced. Refused
 *   rather than ignored, because silently starting from the beginning would
 *   hand back a page the caller believes it has already read.
 */
export function decodeCursor(cursor?: string): Cursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const end = raw.indexOf(TIMESTAMP_END);

  if (end === -1 || raw[end + 1] !== SEPARATOR) {
    throw new ValidationError("Malformed cursor", { field: "cursor" });
  }

  const at = new Date(raw.slice(0, end + 1));
  const id = raw.slice(end + 2);

  if (Number.isNaN(at.getTime()) || id.length === 0) {
    throw new ValidationError("Malformed cursor", { field: "cursor" });
  }

  return { at, id };
}
