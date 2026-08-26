import type {
  ModerationState,
  MomentVisibility,
  TemporalPrecision,
} from "@chronologity/contracts";

/**
 * Turning authoritative state into a Search document.
 *
 * Pure, and the single place a document's shape is decided. The indexer and the
 * rebuild both call these, which is what makes a rebuild worth trusting: a
 * second implementation would only prove the two agreed on the day somebody
 * last compared them.
 *
 * Nothing here reads a database or a clock. What it is given is what a document
 * says, so a builder can be exercised exhaustively over cases the indexer would
 * take minutes to arrange.
 */

/** Which index these documents belong to. */
export const INDEX_VERSION = "search-v1";

/** What a searchable thing is. */
export type SearchEntityType = "moment" | "user" | "event" | "location";

/** Where a value came from (`search.md:141`). */
export type FieldProvenance = "authored" | "structured" | "derived";

/** A document, ready to be written. */
export interface SearchDocumentFields {
  readonly entityType: SearchEntityType;
  readonly entityId: string;
  readonly title: string;
  readonly body: string;
  readonly aliases: string;
  readonly occurrenceStart: Date | null;
  readonly occurrenceEnd: Date | null;
  readonly occurrencePrecision: TemporalPrecision | null;
  readonly publishedAt: Date | null;
  readonly visibility: MomentVisibility;
  readonly searchable: boolean;
  readonly moderationState: ModerationState;
  readonly deleted: boolean;
  readonly authorUserId: string | null;
  readonly geohashExact: string | null;
  readonly geohashCoarse: string | null;
  readonly geohashRegion: string | null;
  readonly significance: number | null;
  readonly significanceVersion: string | null;
  readonly provenance: Record<string, FieldProvenance>;
}

/** A Moment, as the indexer read it. */
export interface MomentSource {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly caption: string;
  readonly occurrenceStart: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly visibility: string;
  readonly locationDisclosure: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly moderationState: string | undefined;
  readonly placeName: string | undefined;
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
  readonly realWorldEventNames: readonly string[];
}

/** An account, as the indexer read it. */
export interface UserSource {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly biography: string | null;
  readonly createdAt: Date;
  readonly moderationState: string | undefined;
}

/** A real-world Event, as the indexer read it. */
export interface RealWorldEventSource {
  readonly realWorldEventId: string;
  readonly name: string;
  readonly occurrenceStart: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly createdAt: Date;
  readonly aliasNames: readonly string[];
  readonly moderationState: string | undefined;
}

/** A Location, as the indexer read it. */
export interface LocationSource {
  readonly locationId: string;
  readonly name: string;
  /** The city, region, and country it sits in, where they are known. */
  readonly alternateNames: readonly string[];
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly createdAt: Date;
  readonly moderationState: string | undefined;
}

/** The three occurrence precisions a Moment can carry, plus the Event's. */
const PRECISIONS = new Set(["instant", "day", "month", "year"]);

/** The seven states the moderation feature recognises. */
const MODERATION_STATES = new Set([
  "allowed",
  "warned",
  "restricted_from_amplification",
  "restricted_to_authorized_audience",
  "age_restricted",
  "temporarily_unavailable",
  "removed",
]);

/** The three visibilities a Moment can carry. */
const VISIBILITIES = new Set(["public", "restricted", "private"]);

/**
 * How exact each geohash tier is, in characters.
 *
 * Roughly a street, a neighbourhood, and a city. Tiers rather than a point
 * because a Viewer entitled to know somebody was in a city is not thereby
 * entitled to the doorway, and an index holding the doorway can leak it through
 * a sufficiently narrow query however the read path is written.
 */
const TIER_LENGTHS = { exact: 8, coarse: 5, region: 3 } as const;

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encode a position as a geohash.
 *
 * @param latitude - Degrees north, within -90 to 90.
 * @param longitude - Degrees east, within -180 to 180.
 * @param length - How many characters, which decides how exact it is.
 * @returns The geohash. Positions outside the valid range are clamped rather
 *   than rejected: a stored coordinate that is already wrong should still index
 *   somewhere approximately right instead of removing the entity from Search.
 */
export function geohash(latitude: number, longitude: number, length: number): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  const lat = Math.min(90, Math.max(-90, latitude));
  const lon = Math.min(180, Math.max(-180, longitude));

  let hash = "";
  let bits = 0;
  let value = 0;
  let even = true;

  while (hash.length < length) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;

      if (lon >= mid) {
        value = value * 2 + 1;
        lonMin = mid;
      } else {
        value *= 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;

      if (lat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value *= 2;
        latMax = mid;
      }
    }

    even = !even;
    bits += 1;

    if (bits === 5) {
      hash += GEOHASH_ALPHABET[value];
      bits = 0;
      value = 0;
    }
  }

  return hash;
}

/**
 * The three tiers for a position.
 *
 * @param latitude - Degrees north, or undefined when the place is unknown.
 * @param longitude - Degrees east, or undefined when the place is unknown.
 * @param disclosure - How much of the place other people are told: `exact`,
 *   `neighbourhood`, `city`, or `hidden`. The author's privacy choice, not the
 *   Location's own precision (`locations.md:830`). The names are the contract's
 *   own — an earlier draft here invented `coarse` and `region`, which fell
 *   through to the safe default and quietly indexed no geography whatsoever.
 * @returns The tiers a Viewer may be given. A tier more exact than the
 *   disclosure allows is null rather than stored and filtered later — an index
 *   that holds it can leak it through a narrow enough query however carefully
 *   the read path is written.
 */
export function geohashTiers(
  latitude: number | undefined,
  longitude: number | undefined,
  disclosure: string,
): { exact: string | null; coarse: string | null; region: string | null } {
  if (latitude === undefined || longitude === undefined) {
    return { exact: null, coarse: null, region: null };
  }

  const at = (length: number) => geohash(latitude, longitude, length);

  switch (disclosure) {
    case "exact":
      return {
        exact: at(TIER_LENGTHS.exact),
        coarse: at(TIER_LENGTHS.coarse),
        region: at(TIER_LENGTHS.region),
      };
    case "neighbourhood":
      return { exact: null, coarse: at(TIER_LENGTHS.coarse), region: at(TIER_LENGTHS.region) };
    case "city":
      return { exact: null, coarse: null, region: at(TIER_LENGTHS.region) };
    case "hidden":
      return { exact: null, coarse: null, region: null };
    default:
      // An unrecognised disclosure discloses nothing. The alternative is a
      // widened vocabulary silently publishing positions.
      return { exact: null, coarse: null, region: null };
  }
}

/**
 * Read a stored moderation state, refusing one nobody recognises.
 *
 * @param state - As stored, or undefined when nothing has been decided — which
 *   is the ordinary case and means `allowed`.
 * @returns The state, or undefined when it is not one of the seven. Undefined
 *   means the caller must exclude the document rather than index it:
 *   `search.md:295` requires that eligibility which cannot be determined leads
 *   to exclusion, not retention.
 */
export function readModerationState(state: string | undefined): ModerationState | undefined {
  if (state === undefined) {
    return "allowed";
  }

  return MODERATION_STATES.has(state) ? (state as ModerationState) : undefined;
}

/**
 * Whether a moderation state permits a document to exist at all.
 *
 * Distinct from whether it is searchable. A removed subject has no document; a
 * subject restricted from amplification has one and is found less often, which
 * is 5O-2's problem rather than this one's.
 *
 * @param state - What Chronologity has decided.
 * @returns Whether the document should be written.
 */
export function permitsDocument(state: ModerationState): boolean {
  return state !== "removed";
}

/**
 * Whether a moderation state leaves a document findable.
 *
 * @param state - What Chronologity has decided.
 * @returns Whether it may be returned by a search. False for the states that
 *   hide a subject outright and for age restriction, which is resolved against
 *   the Viewer at query time and starts from not-findable.
 */
export function permitsSearch(state: ModerationState): boolean {
  return state === "allowed" || state === "warned" || state === "restricted_from_amplification";
}

/**
 * Build the lexical index for a document.
 *
 * Weights are `A` for the title, `B` for aliases, `C` for the body — a name
 * match outranks a mention. They are written here rather than generated by the
 * database because they are part of the index version: changing them produces a
 * new version built beside the old one rather than a silent redefinition of
 * every stored row.
 *
 * @param titleParam - Which positional parameter carries the title.
 * @param aliasesParam - Which carries the aliases.
 * @param bodyParam - Which carries the body.
 * @returns A SQL fragment referring to parameters the caller is already
 *   passing, rather than one with its own numbering the caller has to
 *   interleave. The interleaved version was written first and was wrong in a
 *   way nothing would have reported: the columns still line up, so a swapped
 *   pair produces a document that indexes the body as the title.
 */
export function lexicalVector(titleParam: number, aliasesParam: number, bodyParam: number): string {
  return (
    `setweight(to_tsvector('simple', $${titleParam}), 'A')` +
    ` || setweight(to_tsvector('simple', $${aliasesParam}), 'B')` +
    ` || setweight(to_tsvector('simple', $${bodyParam}), 'C')`
  );
}

/**
 * Read a stored occurrence precision.
 *
 * @param precision - As stored.
 * @returns The precision, or `year` for anything unrecognised. Widening rather
 *   than refusing: a precision nobody recognises must not be read as more exact
 *   than it is, and treating it as the coarsest keeps the entity findable
 *   without asserting a date it cannot support.
 */
export function readPrecision(precision: string): TemporalPrecision {
  return PRECISIONS.has(precision) ? (precision as TemporalPrecision) : "year";
}

/**
 * Read a stored visibility.
 *
 * @param visibility - As stored.
 * @returns The visibility, or `private` for anything unrecognised. Deny by
 *   default: a widened column constraint that forgot this file should make
 *   something unfindable rather than publish it.
 */
export function readVisibility(visibility: string): MomentVisibility {
  return VISIBILITIES.has(visibility) ? (visibility as MomentVisibility) : "private";
}

/**
 * Build the document for a Moment.
 *
 * One document however many images and videos it holds (`search.md` invariant
 * 8). Media quantity contributes nothing: a Moment is an experience, and fifty
 * photographs of it are not fifty times the history.
 *
 * @param source - The Moment as authoritative state has it, with its place, its
 *   Events, and whether its author is suspended.
 * @returns The document, or undefined when it must not be indexed — the state
 *   is unrecognised, or moderation has removed it. Exclusion over retention.
 */
export function buildMomentDocument(source: MomentSource): SearchDocumentFields | undefined {
  const state = readModerationState(source.moderationState);

  if (state === undefined || !permitsDocument(state)) {
    return undefined;
  }

  const visibility = readVisibility(source.visibility);
  const tiers = geohashTiers(source.latitude, source.longitude, source.locationDisclosure);

  // The place and the Events belong in the body: somebody looking for what
  // happened at a wedding in Lisbon is searching words that live on neither the
  // Moment nor the caption alone.
  const context = [source.placeName, ...source.realWorldEventNames].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );

  return {
    entityType: "moment",
    entityId: source.momentId,
    // A caption is required and is the only thing a Moment is called, so the
    // first line stands in for a title it does not have.
    title: firstLine(source.caption),
    body: [source.caption, ...context].join(" "),
    aliases: "",
    occurrenceStart: source.occurrenceStart,
    occurrenceEnd: source.occurrenceEnd,
    occurrencePrecision: readPrecision(source.occurrencePrecision),
    publishedAt: source.createdAt,
    visibility,
    // Moderation only. Visibility and suspension are carried in their own
    // columns and resolved against the Viewer at query time, because both
    // decide *who* may find this rather than *whether* it may be found —
    // `search.md:243` keeps searchability and visibility as separate
    // dimensions. Folding them together here would mean nobody could search
    // their own private history, since the author would be filtered out before
    // anybody knew who was asking.
    searchable: permitsSearch(state),
    moderationState: state,
    deleted: source.deletedAt !== null,
    authorUserId: source.authorUserId,
    geohashExact: tiers.exact,
    geohashCoarse: tiers.coarse,
    geohashRegion: tiers.region,
    significance: null,
    significanceVersion: null,
    provenance: {
      title: "authored",
      body: "authored",
      occurrence: "authored",
      location: "structured",
      visibility: "structured",
    },
  };
}

/**
 * Build the document for an account.
 *
 * @param source - The account as authoritative state has it.
 * @returns The document, or undefined when it must not be indexed.
 */
export function buildUserDocument(source: UserSource): SearchDocumentFields | undefined {
  const state = readModerationState(source.moderationState);

  if (state === undefined || !permitsDocument(state)) {
    return undefined;
  }

  return {
    entityType: "user",
    entityId: source.userId,
    title: source.displayName,
    // The handle is what somebody types when they know exactly who they want,
    // so it is weighted with the aliases rather than buried in the body.
    aliases: source.handle,
    body: source.biography ?? "",
    occurrenceStart: null,
    occurrenceEnd: null,
    occurrencePrecision: null,
    publishedAt: source.createdAt,
    // An account has no audience of its own; nothing about it is restricted to
    // a list. What limits finding it is its status, which is volatile and lives
    // on the account rather than here — resolved at query time through
    // `authorUserId`, exactly as a Moment's author is.
    visibility: "public",
    searchable: permitsSearch(state),
    moderationState: state,
    deleted: false,
    // Itself. A suspension has to reach this row as well as everything the
    // account authored, and keying on the author is how the sweep finds both.
    authorUserId: source.userId,
    geohashExact: null,
    geohashCoarse: null,
    geohashRegion: null,
    significance: null,
    significanceVersion: null,
    provenance: { title: "authored", aliases: "authored", body: "authored" },
  };
}

/**
 * Build the document for a real-world Event.
 *
 * @param source - The Event as authoritative state has it, with its aliases.
 * @returns The document, or undefined when it must not be indexed.
 */
export function buildRealWorldEventDocument(
  source: RealWorldEventSource,
): SearchDocumentFields | undefined {
  const state = readModerationState(source.moderationState);

  if (state === undefined || !permitsDocument(state)) {
    return undefined;
  }

  return {
    entityType: "event",
    entityId: source.realWorldEventId,
    title: source.name,
    // Historical names, alternate spellings, and translations. Not a nicety:
    // somebody searching for the Great War and somebody searching for the First
    // World War are looking for the same Event.
    aliases: source.aliasNames.join(" "),
    body: "",
    occurrenceStart: source.occurrenceStart,
    occurrenceEnd: source.occurrenceEnd,
    occurrencePrecision: readPrecision(source.occurrencePrecision),
    publishedAt: source.createdAt,
    // Shared history. It belongs to nobody, so nobody's privacy or suspension
    // decides whether it can be found.
    visibility: "public",
    searchable: permitsSearch(state),
    moderationState: state,
    deleted: false,
    authorUserId: null,
    geohashExact: null,
    geohashCoarse: null,
    geohashRegion: null,
    significance: null,
    significanceVersion: null,
    provenance: { title: "structured", aliases: "structured", occurrence: "structured" },
  };
}

/**
 * Build the document for a Location.
 *
 * @param source - The Location as authoritative state has it.
 * @returns The document, or undefined when it must not be indexed.
 */
export function buildLocationDocument(
  source: LocationSource,
): SearchDocumentFields | undefined {
  const state = readModerationState(source.moderationState);

  if (state === undefined || !permitsDocument(state)) {
    return undefined;
  }

  // Shared reference data rather than somebody's private position, so the full
  // tier set applies. What a Moment discloses about being *there* is decided on
  // the Moment, not here.
  const tiers = geohashTiers(
    source.latitude ?? undefined,
    source.longitude ?? undefined,
    "exact",
  );

  return {
    entityType: "location",
    entityId: source.locationId,
    title: source.name,
    aliases: source.alternateNames.join(" "),
    body: "",
    occurrenceStart: null,
    occurrenceEnd: null,
    occurrencePrecision: null,
    publishedAt: source.createdAt,
    visibility: "public",
    searchable: permitsSearch(state),
    moderationState: state,
    deleted: false,
    authorUserId: null,
    geohashExact: tiers.exact,
    geohashCoarse: tiers.coarse,
    geohashRegion: tiers.region,
    significance: null,
    significanceVersion: null,
    provenance: { title: "structured", location: "structured" },
  };
}

/**
 * Whether an incoming document should replace the one already stored.
 *
 * The guard against a slower writer holding an older reading of authoritative
 * state overwriting a newer document — which is reachable whenever a rebuild
 * runs beside the indexer.
 *
 * @param storedBuiltAt - When the stored document was built, or undefined when
 *   there is none.
 * @param incomingBuiltAt - When the incoming one was built.
 * @returns Whether to write. Equal timestamps do not replace: two readings of
 *   the same instant carry the same state, so the write would be a no-op that
 *   only churns the row.
 */
export function shouldReplace(
  storedBuiltAt: Date | undefined,
  incomingBuiltAt: Date,
): boolean {
  return storedBuiltAt === undefined || incomingBuiltAt.getTime() > storedBuiltAt.getTime();
}

/**
 * The first line of a caption, for use where a title is wanted.
 *
 * @param caption - What somebody wrote.
 * @returns Its first line, trimmed, bounded so a caption with no newlines does
 *   not become an unbounded title.
 */
function firstLine(caption: string): string {
  return (caption.split("\n")[0] ?? "").trim().slice(0, 200);
}
