import type { Coordinates, PlaceSuggestion } from "@chronologity/contracts";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Looking places up in a map service.
 *
 * An adapter, and a deliberately thin one. What comes back is a list of
 * candidates; nothing becomes a Location until someone chooses it, and when
 * they do, Chronologity creates a record carrying its own identity rather than
 * adopting the service's.
 *
 * The service is OpenStreetMap, and that was forced rather than preferred.
 * Chronologity has to keep the name a place had at the time, permanently —
 * Google's terms grant no permission to store a display name and Mapbox
 * prohibits storage outright, so both would require re-fetching a name that
 * would come back as today's name (ADR-090). OpenStreetMap permits permanent
 * storage.
 */

export interface PlaceSearchClient {
  /**
   * Find places matching what someone typed.
   *
   * @param query - What they typed.
   * @param limit - How many candidates to return.
   * @returns Candidates, and the attribution the data must be shown with.
   *   An empty list is an ordinary answer: plenty of searches match nothing.
   * @throws {Error} If the service could not be reached or refused the request.
   */
  search(
    query: string,
    limit?: number,
  ): Promise<{
    suggestions: PlaceSuggestion[];
    attribution: string;
  }>;
  /**
   * Find what is at a coordinate.
   *
   * A coordinate is a measurement, not a place. This is what turns the numbers
   * a camera recorded into something a person can recognise and choose —
   * without which accepting a photograph's location would record a naked pair
   * of numbers as though it were somewhere.
   *
   * @param coordinates - Where to look.
   * @returns Candidates, and the attribution the data must be shown with. An
   *   empty list is an ordinary answer: a coordinate in open ocean is a real
   *   coordinate and not a place.
   * @throws {Error} If the service could not be reached or refused the request.
   */
  reverse(coordinates: Coordinates): Promise<{
    suggestions: PlaceSuggestion[];
    attribution: string;
  }>;
}

export interface PlaceSearchConfig {
  readonly endpoint: string;
  /** Where to ask what is at a coordinate. A different endpoint from search. */
  readonly reverseEndpoint: string;
  /**
   * How this application identifies itself.
   *
   * OpenStreetMap's usage policy requires a real identifier rather than a
   * generic one; requests without it are refused, and rightly.
   */
  readonly userAgent: string;
  readonly timeoutMs?: number;
  /**
   * Smallest gap between requests, in milliseconds.
   *
   * The public service asks for no more than one request per second. This is a
   * shared resource maintained by volunteers, and exceeding it is both rude
   * and a good way to be blocked.
   */
  readonly minimumIntervalMs?: number;
}

/** What the service actually returns. Only the fields we use are named. */
interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    region?: string;
    country?: string;
    country_code?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MINIMUM_INTERVAL_MS = 1_100;
const DEFAULT_LIMIT = 5;

const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";

/**
 * Build the place-search adapter.
 *
 * @param config - Where the service is, how to identify ourselves, and how
 *   fast we may ask.
 * @param logger - Optional. Failures are logged with the reason; what someone
 *   searched for is not, since a search is a statement about where a person
 *   has been or intends to go.
 * @returns A client that can search for places.
 */
export function createPlaceSearchClient(
  config: PlaceSearchConfig,
  logger?: Logger,
): PlaceSearchClient {
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interval = config.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS;

  let lastRequestAt = 0;

  /**
   * Ask the service, no faster than it permits.
   *
   * @param url - The prepared request.
   * @returns The parsed body.
   * @throws {Error} If the service refused the request.
   */
  const ask = async (url: URL): Promise<unknown> => {
    // Waiting rather than refusing. A request that arrives too soon after the
    // last one is not a mistake worth failing; the caller wants an answer, and
    // the service asks only that we not rush it. Shared across both kinds of
    // lookup, because the limit belongs to the service and not to a method.
    const sinceLast = Date.now() - lastRequestAt;

    if (sinceLast < interval) {
      await new Promise((resolve) => setTimeout(resolve, interval - sinceLast));
    }

    lastRequestAt = Date.now();

    const response = await fetch(url, {
      headers: { "user-agent": config.userAgent },
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      logger?.warn({ status: response.status }, "Place lookup was refused");

      throw new Error(`Place lookup failed with status ${response.status}`);
    }

    return response.json();
  };

  return {
    async search(query, limit = DEFAULT_LIMIT) {
      const url = new URL(config.endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(limit));

      return {
        suggestions: interpretResults(await ask(url)),
        attribution: ATTRIBUTION,
      };
    },

    async reverse(coordinates) {
      const url = new URL(config.reverseEndpoint);
      url.searchParams.set("lat", String(coordinates.latitude));
      url.searchParams.set("lon", String(coordinates.longitude));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      // How wide a thing to name. 18 is a building; smaller numbers give the
      // street, the suburb, the city. Asked for at the finest level because a
      // photograph's coordinate points at a spot, and what someone wants
      // offered is the venue they were in — not the county it sits in.
      url.searchParams.set("zoom", "18");

      return {
        // Reverse lookup answers with one object where search answers with a
        // list. Wrapping it means both go through exactly the same
        // interpretation, so a candidate means the same thing either way.
        suggestions: interpretResults([await ask(url)]),
        attribution: ATTRIBUTION,
      };
    },
  };
}

/**
 * Turn what the service returned into candidates.
 *
 * Exported so recorded responses are interpreted by exactly the same code as
 * live ones. A test stand-in that parsed differently would be testing itself.
 *
 * @param raw - The service's response body.
 * @returns The candidates it contained. Results missing what a place needs are
 *   dropped rather than throwing: one unusable result among five should not
 *   lose the other four.
 */
export function interpretResults(raw: unknown): PlaceSuggestion[] {
  return Array.isArray(raw) ? (raw as NominatimResult[]).flatMap(toSuggestion) : [];
}

/**
 * Turn one service result into a candidate.
 *
 * @param result - As returned by the service.
 * @returns The candidate in a list, or an empty list when the result lacks
 *   what a place needs. Returning nothing rather than throwing: one unusable
 *   result among five should not lose the other four.
 */
function toSuggestion(result: NominatimResult): PlaceSuggestion[] {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);

  // The durable reference is the type and identifier pair. The service also
  // returns a `place_id`, which is an internal row number that changes
  // whenever the data is reimported — using it would make our provenance
  // point at nothing after the next import.
  const reference =
    result.osm_type !== undefined && result.osm_id !== undefined
      ? `${result.osm_type}:${result.osm_id}`
      : undefined;

  const name =
    result.name !== undefined && result.name.length > 0 ? result.name : result.display_name;

  if (
    reference === undefined ||
    name === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return [];
  }

  const address = result.address ?? {};

  return [
    {
      reference,
      name,
      description: result.display_name ?? name,
      coordinates: { latitude, longitude },
      context: {
        neighbourhood: address.neighbourhood ?? address.suburb ?? null,
        // A place sits in exactly one of these, and which one depends on how
        // large it is. Taking the first that exists is how the service's own
        // formatting handles it.
        city: address.city ?? address.town ?? address.village ?? null,
        region: address.state ?? address.region ?? null,
        country: address.country ?? null,
        countryCode: address.country_code?.toUpperCase() ?? null,
      },
    },
  ];
}
