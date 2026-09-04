/**
 * A cursor a client handed back that this Timeline cannot use.
 *
 * Its own type rather than either application's, because the two report a
 * refusal differently — the API as a 400 in its error envelope, the feed
 * aggregator as a GraphQL error — and a package that threw one of those would
 * be deciding transport on behalf of both.
 */
export class CursorError extends Error {
  override readonly name = "CursorError";

  /**
   * Build the error.
   *
   * @param message - Safe to show a client: it says the cursor is unusable and
   *   nothing about what the encoding contains.
   */
  constructor(message: string) {
    super(message);
  }
}

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
 * @throws {CursorError} If it is not a cursor this system issued: malformed,
 *   altered, missing a field, or of a version this code does not know. Callers
 *   map it onto whatever their transport tells a client.
 */
export function decodeCursor(cursor: string): TimelinePosition {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new CursorError("That is not a usable cursor");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CursorError("That is not a usable cursor");
  }

  const { v, t, m } = parsed as Partial<Encoded>;

  if (v !== VERSION) {
    // Distinct from malformed, and deliberately so: a client holding a cursor
    // from an encoding this code does not know should discard it and start
    // again, which is a different instruction from "you sent nonsense".
    //
    // The check is inequality rather than "older", so a cursor from a *newer*
    // encoding is refused too — which happens during a deployment, when a
    // client that reached a new instance sends its cursor to an old one. The
    // wording says unreadable rather than old for that reason.
    throw new CursorError("That cursor is not one this Timeline can read");
  }

  if (typeof t !== "number" || !Number.isFinite(t) || typeof m !== "string" || m.length === 0) {
    throw new CursorError("That is not a usable cursor");
  }

  return { occurredAt: new Date(t), momentId: m };
}

/** Which way a page runs through history. */
export type TimelineDirection = "older" | "newer";

/**
 * The condition that resumes from a cursor.
 *
 * Here rather than at the call site because it is the other half of the cursor
 * contract: `encodeCursor` writes `(occurredAt, momentId)` and this reads it
 * back, and the two only agree if they name the same tuple in the same order.
 * They were written twice in `timeline.read.repository.ts` and were already
 * identical by copying, which is the state just before they stop being.
 *
 * A tuple comparison rather than `occurred_at < x OR (occurred_at = x AND …)`,
 * because ClickHouse compares tuples lexicographically and the sort key is that
 * tuple — so this is the form the index can use.
 *
 * **Strict by default, and inclusive only for a landing.** Resuming from a
 * cursor must exclude the row the cursor names, or paging repeats it. Landing at
 * a Moment must include it, because the landing *is* the first row of the page
 * before it — see `instantBoundary` for the half of this rule that concerns an
 * instant.
 *
 * @param direction - Which way the page runs.
 * @param inclusive - Whether the named position is itself part of the page.
 *   False for every cursor; true only where a page begins at a position rather
 *   than resuming past one.
 * @returns A fragment beginning with `AND`, reading the `at` and `momentId`
 *   parameters the caller must bind from the decoded position.
 */
export function boundaryCondition(direction: TimelineDirection, inclusive = false): string {
  const comparison = `${direction === "older" ? "<" : ">"}${inclusive ? "=" : ""}`;

  return `AND (occurred_at, moment_id) ${comparison} ({at: DateTime64(3)}, {momentId: String})`;
}

/**
 * The condition that bounds a page at an instant rather than at a position.
 *
 * **An instant has no tie to break, and that is the whole reason this exists.**
 * The tuple comparison above splits Moments sharing one occurrence by identifier,
 * which is exactly right when resuming from one of them. An instant names none of
 * them, so it must put the whole instant — every Moment in it — on one side. A
 * tuple comparison against a synthesised identifier would do that too, and was
 * measured to work, but only for a reader who knows how identifiers happen to
 * sort. This says what it means.
 *
 * The two directions are written to partition history exactly: `older` takes
 * everything at or before the instant, `newer` everything strictly after, so
 * together they cover the axis once and overlap nowhere. A landing is those two
 * pages, and nothing is skipped between them or repeated across them.
 *
 * Older is the inclusive side because it runs newest-first from the boundary, so
 * its first row is the landing itself — which is where a jump reads what it
 * arrived at, and which still works when nothing came after.
 *
 * @param direction - Which way the page runs.
 * @returns A fragment beginning with `AND`, reading the `at` parameter. It never
 *   names `momentId`, so a caller must not bind one.
 */
export function instantBoundary(direction: TimelineDirection): string {
  return direction === "older"
    ? "AND occurred_at <= {at: DateTime64(3)}"
    : "AND occurred_at > {at: DateTime64(3)}";
}

/**
 * The ordering a page runs in.
 *
 * Both columns, always, and in the tuple's order. Ordering by occurrence alone
 * would leave two Moments that happened at the same instant in whatever order
 * the engine returned them, which changes between reads — and a cursor taken
 * from one of them would then skip the other or repeat it.
 *
 * Takes an alias because the ordering is applied twice per page: once to choose
 * the rows, and again after they are joined back to the table carrying the
 * columns a caller presents. The second is the same ordering under another name,
 * and writing it out again is how the two drift apart.
 *
 * @param direction - Which way the page runs.
 * @param alias - The table the columns are read under. Omitted where the
 *   columns are unambiguous.
 * @returns An `ORDER BY` list, without the keyword.
 */
export function orderFor(direction: TimelineDirection, alias?: string): string {
  const sense = direction === "older" ? "DESC" : "ASC";
  const prefix = alias === undefined ? "" : `${alias}.`;

  return `${prefix}occurred_at ${sense}, ${prefix}moment_id ${sense}`;
}
