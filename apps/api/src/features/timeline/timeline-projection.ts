import type { MomentVisibility, TemporalPrecision } from "@chronologity/contracts";
import {
  permitsDocument,
  readModerationState,
  readVisibility,
} from "../search/search-document.js";
import type { TimelineSource } from "./timeline-source.repository.js";
import type { TimelineRow } from "./timeline-row.js";

/**
 * Deciding what belongs on the Timeline, and where.
 *
 * Pure, and separate from both stores so the decisions can be tested without
 * either. What is decided here is only what is intrinsic to a Moment: when it
 * happened, whose it is, and whether it may be shown at all. Everything
 * depending on who is asking — a Block, an audience, the author's account
 * status — is resolved when the Timeline is read, which is the arrangement
 * `search.eligibility.ts` sets out and the reason a suspension does not
 * reproject a decade of somebody's history.
 */

/**
 * Occurrence precisions the Timeline understands.
 *
 * The four `temporalPrecisionSchema` defines, and no more. Written out here
 * rather than derived, so that adding a fifth is a decision taken in both
 * places — a projection that silently accepted one it could not render would
 * be worse than one that refused to compile.
 */
const PRECISIONS = new Set<TemporalPrecision>(["instant", "day", "month", "year"]);

/**
 * Read a stored precision.
 *
 * @param precision - As stored.
 * @returns The precision, or `day` for anything unrecognised. A Moment with an
 *   unreadable precision still happened and still belongs in history; showing
 *   it to the day is a smaller error than dropping it, and dropping it is the
 *   one outcome a chronology cannot recover from.
 */
export function readPrecision(precision: string): TemporalPrecision {
  return PRECISIONS.has(precision as TemporalPrecision)
    ? (precision as TemporalPrecision)
    : "day";
}

/**
 * What the Timeline should hold for a Moment.
 *
 * @param source - The Moment as authoritative state has it.
 * @returns The row, or undefined when the Timeline must not hold it — deleted,
 *   removed by moderation, or in a moderation state this code does not
 *   recognise. Undefined is an instruction to remove any row already there,
 *   never an instruction to leave one standing: exclusion over retention, the
 *   same way Search decides it.
 */
export function timelineRowFor(source: TimelineSource): TimelineRow | undefined {
  if (source.deletedAt !== null) {
    return undefined;
  }

  const state = readModerationState(source.moderationState);

  // An unrecognised state is not treated as permission. A worker older than the
  // moderation vocabulary it is reading must withhold rather than guess, which
  // `search.md:295` requires of eligibility that cannot be determined.
  if (state === undefined || !permitsDocument(state)) {
    return undefined;
  }

  return {
    momentId: source.momentId,
    authorUserId: source.authorUserId,
    // Occurrence, never insertion. The whole point of the table.
    occurredAt: source.occurrenceStart,
    occurrenceEnd: source.occurrenceEnd,
    occurrencePrecision: readPrecision(source.occurrencePrecision),
    occurrenceOffsetMinutes: source.occurrenceOffsetMinutes,
    visibility: readVisibility(source.visibility) as MomentVisibility,
    moderationState: state,
    discoverable: source.discoverable,
  };
}
