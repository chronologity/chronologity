import type { SearchRequest, SearchSort } from "@chronologity/contracts";
import { createHash } from "node:crypto";
import { coverageFor, type GeoTier } from "./search.geo.js";

/**
 * Turning a request into something the retrieval layer can act on.
 *
 * Pure. The schema has already bounded and shaped what arrived; this decides
 * what it means — which tier can answer a radius, what the words are once
 * split, and what makes this query the same query as another.
 */

/** A search, interpreted. */
export interface InterpretedQuery {
  readonly terms: readonly string[];
  /** The words as one string, for phrase and exact comparison. */
  readonly phrase: string;
  readonly entityType: SearchRequest["type"];
  readonly sort: SearchSort;
  readonly limit: number;
  readonly from: Date | undefined;
  readonly to: Date | undefined;
  readonly creator: string | undefined;
  readonly locationId: string | undefined;
  readonly realWorldEventId: string | undefined;
  readonly near:
    | { latitude: number; longitude: number; tier: GeoTier; rings: number }
    | undefined;
  /**
   * What makes this the same search as another.
   *
   * A cursor carrying a different one is refused rather than honoured, because
   * paging through results ordered by one query using a position from another
   * would silently mix two answers together.
   */
  readonly fingerprint: string;
}

/** How far to look when a position is given without a radius. */
const DEFAULT_RADIUS_METRES = 1_000;

/** The longest a single word may be before it is discarded. */
const MAX_TERM_LENGTH = 60;

/** How many words are honoured; the rest are dropped. */
const MAX_TERMS = 12;

/** Splits on any run of whitespace. */
const WHITESPACE = /\s+/u;

/**
 * Interpret a request.
 *
 * @param request - What arrived, already validated against the schema.
 * @returns The interpreted query, including the tier that can answer its radius
 *   and the fingerprint identifying it.
 */
export function interpret(request: SearchRequest): InterpretedQuery {
  const phrase = (request.q ?? "").trim();
  const terms = phrase
    .toLowerCase()
    .split(WHITESPACE)
    .filter((term) => term.length > 0 && term.length <= MAX_TERM_LENGTH)
    .slice(0, MAX_TERMS);

  const near =
    request.lat === undefined || request.lon === undefined
      ? undefined
      : {
          latitude: request.lat,
          longitude: request.lon,
          // A radius nobody gave is a modest one rather than the whole world:
          // "near here" should mean near.
          ...coverageFor(request.radius ?? DEFAULT_RADIUS_METRES),
        };

  const interpreted = {
    terms,
    phrase,
    entityType: request.type,
    sort: request.sort,
    limit: request.limit,
    from: request.from === undefined ? undefined : new Date(request.from),
    to: request.to === undefined ? undefined : new Date(request.to),
    creator: request.creator,
    locationId: request.locationId,
    realWorldEventId: request.realWorldEventId,
    near,
  };

  return { ...interpreted, fingerprint: fingerprintOf(interpreted) };
}

/**
 * What makes two searches the same search.
 *
 * Everything that changes which results are eligible or how they are ordered —
 * so the sort mode counts, and the page size deliberately does not: asking for
 * twenty and then ten of the same search is the same search.
 *
 * @param query - The interpreted query, without its fingerprint.
 * @returns A short stable digest.
 */
function fingerprintOf(query: Omit<InterpretedQuery, "fingerprint">): string {
  const parts = [
    query.terms.join(" "),
    query.entityType ?? "",
    query.sort,
    query.from?.toISOString() ?? "",
    query.to?.toISOString() ?? "",
    query.creator ?? "",
    query.locationId ?? "",
    query.realWorldEventId ?? "",
    query.near === undefined
      ? ""
      : `${query.near.latitude},${query.near.longitude},${query.near.tier}`,
  ];

  return createHash("sha256").update(parts.join(" ")).digest("base64url").slice(0, 16);
}
