import { ValidationError } from "../../lib/errors/validation-error.js";
import { RANKING_VERSION } from "./search.ranking.js";

/**
 * Where a page of results continues from.
 *
 * Deliberately not the Timeline cursor. A Timeline cursor names a position in
 * chronology and stays meaningful forever; a Search cursor names a position in
 * one particular answer to one particular question, ordered by one particular
 * version of the ranking. `search.md:383` keeps them separate and says they are
 * not interchangeable.
 *
 * The consequence is that a Search cursor can go stale in ways a Timeline
 * cursor cannot, and the honest response is to say so rather than to hand back
 * a page from a different ordering and let somebody page through two answers
 * spliced together.
 */

/** A position in one answer to one question. */
export interface SearchCursor {
  /** Which question. */
  readonly fingerprint: string;
  /** Which ranking produced the order. */
  readonly rankingVersion: string;
  /**
   * How far in. A rank rather than a key, because relevance has no key: two
   * documents can score identically and the tie-break is what separates them.
   */
  readonly offset: number;
  /**
   * The occurrence the last row carried, for the chronological modes.
   *
   * Those do have a key, so they page properly rather than by counting, and a
   * row inserted mid-page cannot push results onto a page somebody has already
   * seen.
   */
  readonly at: string | undefined;
  /** What settles ties at that occurrence. */
  readonly id: string | undefined;
}

/**
 * Encode where the next page continues from.
 *
 * @param cursor - The position.
 * @returns An opaque string. It is not a security boundary and does not pretend
 *   to be one: every read is authorized against the caller whatever the cursor
 *   says, and a forged cursor can move somebody through results they were
 *   already entitled to and nothing else.
 */
export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(
    JSON.stringify([
      cursor.fingerprint,
      cursor.rankingVersion,
      cursor.offset,
      cursor.at ?? null,
      cursor.id ?? null,
    ]),
    "utf8",
  ).toString("base64url");
}

/**
 * Read a cursor, refusing one that belongs to a different answer.
 *
 * @param encoded - What the caller sent back, or undefined for a first page.
 * @param fingerprint - The question being asked now.
 * @returns The position, or undefined for a first page.
 * @throws {ValidationError} If it is unreadable, if it belongs to a different
 *   question, or if it was produced by a different ranking version. All three
 *   are refused explicitly rather than treated as a first page: silently
 *   restarting looks to the caller like results repeating, and silently
 *   re-ranking mid-pagination is worse — they would page through two different
 *   orderings without being told.
 */
export function decodeSearchCursor(
  encoded: string | undefined,
  fingerprint: string,
): SearchCursor | undefined {
  if (encoded === undefined) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("That is not a cursor this search issued", { field: "cursor" });
  }

  if (!Array.isArray(parsed) || parsed.length !== 5) {
    throw new ValidationError("That is not a cursor this search issued", { field: "cursor" });
  }

  const [storedFingerprint, rankingVersion, offset, at, id] = parsed as unknown[];

  if (typeof storedFingerprint !== "string" || typeof rankingVersion !== "string") {
    throw new ValidationError("That is not a cursor this search issued", { field: "cursor" });
  }

  if (storedFingerprint !== fingerprint) {
    throw new ValidationError("That cursor belongs to a different search", { field: "cursor" });
  }

  if (rankingVersion !== RANKING_VERSION) {
    // The ordering changed underneath. Continuing would interleave two
    // rankings; restarting silently would look like results repeating.
    throw new ValidationError("Results have been reordered since that page", {
      field: "cursor",
    });
  }

  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    throw new ValidationError("That is not a cursor this search issued", { field: "cursor" });
  }

  return {
    fingerprint: storedFingerprint,
    rankingVersion,
    offset,
    at: typeof at === "string" ? at : undefined,
    id: typeof id === "string" ? id : undefined,
  };
}
