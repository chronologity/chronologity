import type { DataSource } from "typeorm";
import { geohash, INDEX_VERSION } from "../search/search-document.js";
import { cellsAround, coverageFor, type GeoTier } from "../search/search.geo.js";
import { discoverableForViewer } from "./discovery.eligibility.js";
import { discoveryOrder, discoveryScoreExpression } from "./discovery.ranking.js";

/** One candidate, with what it belongs to. */
export interface DiscoveredMoment {
  readonly momentId: string;
  readonly title: string;
  readonly authorUserId: string;
  readonly occurrenceStart: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly locationId: string | undefined;
  readonly realWorldEventId: string | undefined;
}

/** Who is being recommended to. */
export interface Viewer {
  readonly userId: string;
  readonly isAdult: boolean;
}

/**
 * How old a Moment must be to count as historical rather than recent.
 *
 * Two years. `discovery.md:664` asks that Discovery reach yesterday, last year,
 * and decades ago rather than overconcentrating on the recent past; the exact
 * boundary matters less than there being one.
 */
const HISTORICAL_YEARS = 2;

/** How the query addresses the document table. */
const DOC = "d";

/**
 * Where recommendations come from.
 *
 * Separate from Search retrieval on purpose, even though both read the same
 * table. `discovery.md:1537` requires Discovery to stay architecturally
 * separable from the Feed "so recommendation logic cannot accidentally become
 * Feed ordering logic", and the same argument holds against it silently
 * becoming Search ranking.
 *
 * What is shared is the part that must never diverge: the eligibility rule.
 * What is separate is the part that should — what to offer, and in what order.
 */
export class DiscoveryRetrieval {
  /**
   * Build the adapter.
   *
   * @param dataSource - Read only. Discovery never writes.
   * @param indexVersion - Which index to read.
   * @param now - Reads the clock, injected so the historical horizon and the
   *   author age floor can both be tested.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly indexVersion: string = INDEX_VERSION,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Candidates for a surface.
   *
   * Every surface is this one query with a different extra condition, which is
   * deliberate: the eligibility rule is written once and cannot be forgotten by
   * a surface added later.
   *
   * @param viewer - Who is being recommended to.
   * @param limit - How many candidates to retrieve. The caller asks for more
   *   than a page because diversity caps discard some.
   * @param offset - How far into the ordering to start.
   * @param scope - What narrows this surface, or undefined for Explore.
   * @returns The candidates, best first.
   */
  async candidates(
    viewer: Viewer,
    limit: number,
    offset: number,
    scope?: DiscoveryScope,
  ): Promise<DiscoveredMoment[]> {
    const parameters: unknown[] = [];
    const bind = (value: unknown): number => {
      parameters.push(value);

      return parameters.length;
    };

    const at = this.now();
    const indexVersionParam = bind(this.indexVersion);
    const viewerParam = bind(viewer.userId);
    const adultParam = bind(viewer.isAdult);
    const bornBeforeParam = bind(yearsBefore(at, 18));
    const horizonParam = bind(yearsBefore(at, HISTORICAL_YEARS));

    const where: string[] = [
      `${DOC}.index_version = $${indexVersionParam}`,
      discoverableForViewer(DOC)
        .replaceAll(":viewerUserId", `$${viewerParam}`)
        .replaceAll(":viewerIsAdult", `$${adultParam}`)
        .replaceAll(":adultBornBefore", `$${bornBeforeParam}`),
    ];

    if (scope !== undefined) {
      where.push(this.scopeCondition(scope, bind));
    }

    const scored = discoveryScoreExpression(DOC, horizonParam);
    const limitParam = bind(limit);
    const offsetParam = bind(offset);

    const rows: {
      entity_id: string;
      title: string;
      author_user_id: string;
      occurrence_start: Date;
      occurrence_end: Date;
      occurrence_precision: string;
      location_id: string | null;
      real_world_event_id: string | null;
    }[] = await this.dataSource.query(
      `SELECT ${DOC}.entity_id, ${DOC}.title, ${DOC}.author_user_id,
              ${DOC}.occurrence_start, ${DOC}.occurrence_end, ${DOC}.occurrence_precision,
              (SELECT ml.location_id FROM moment_locations ml
                WHERE ml.moment_id = ${DOC}.entity_id) AS location_id,
              (SELECT mre.real_world_event_id FROM moment_real_world_events mre
                WHERE mre.moment_id = ${DOC}.entity_id
                ORDER BY mre.real_world_event_id LIMIT 1) AS real_world_event_id,
              ${scored} AS score
         FROM search_documents ${DOC}
        WHERE ${where.join("\n          AND ")}
        ORDER BY ${discoveryOrder(DOC, "score")}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      parameters,
    );

    return rows.map((row) => ({
      momentId: row.entity_id,
      title: row.title,
      authorUserId: row.author_user_id,
      occurrenceStart: row.occurrence_start,
      occurrenceEnd: row.occurrence_end,
      occurrencePrecision: row.occurrence_precision,
      locationId: row.location_id ?? undefined,
      realWorldEventId: row.real_world_event_id ?? undefined,
    }));
  }

  /**
   * The condition that narrows a surface.
   *
   * @param scope - What this surface is about.
   * @param bind - Binds a parameter and returns its position.
   * @returns A SQL condition.
   */
  private scopeCondition(scope: DiscoveryScope, bind: (value: unknown) => number): string {
    switch (scope.kind) {
      case "event":
        return `EXISTS (
          SELECT 1 FROM moment_real_world_events mre
           WHERE mre.moment_id = ${DOC}.entity_id
             AND mre.real_world_event_id = $${bind(scope.realWorldEventId)}
        )`;
      case "location":
        return `EXISTS (
          SELECT 1 FROM moment_locations ml
           WHERE ml.moment_id = ${DOC}.entity_id
             AND ml.location_id = $${bind(scope.locationId)}
        )`;
      case "nearby": {
        // The tier the disclosure supports and no finer, exactly as Search
        // does. A Moment whose author shared only the city has no finer cell
        // stored, so a street-sized surface cannot reach it.
        const column = `geohash_${scope.tier === "neighbourhood" ? "coarse" : scope.tier}`;
        const cells = cellsAround(scope.latitude, scope.longitude, scope.tier, geohash, scope.rings);

        return `${DOC}.${column} = ANY($${bind(cells)}::text[])`;
      }
      case "related":
        // Asserted relationships only. Nothing here infers, and nothing
        // inferred would be presented as though it were established.
        return `(
          EXISTS (
            SELECT 1 FROM moment_relationships r
             WHERE (r.source_moment_id = $${bind(scope.momentId)}
                    AND r.target_moment_id = ${DOC}.entity_id)
                OR (r.target_moment_id = $${bind(scope.momentId)}
                    AND r.source_moment_id = ${DOC}.entity_id)
          )
          OR EXISTS (
            SELECT 1 FROM moment_real_world_events mine
              JOIN moment_real_world_events theirs
                ON theirs.real_world_event_id = mine.real_world_event_id
             WHERE mine.moment_id = $${bind(scope.momentId)}
               AND theirs.moment_id = ${DOC}.entity_id
          )
          OR EXISTS (
            SELECT 1 FROM moment_locations mine
              JOIN moment_locations theirs ON theirs.location_id = mine.location_id
             WHERE mine.moment_id = $${bind(scope.momentId)}
               AND theirs.moment_id = ${DOC}.entity_id
          )
        )
        AND ${DOC}.entity_id <> $${bind(scope.momentId)}`;
      default:
        // An unrecognised scope narrows to nothing rather than to everything.
        // The alternative is a widened vocabulary quietly turning a scoped
        // surface into an unscoped one.
        return "false";
    }
  }
}

/** What a surface is about. */
export type DiscoveryScope =
  | { kind: "event"; realWorldEventId: string }
  | { kind: "location"; locationId: string }
  | {
      kind: "nearby";
      latitude: number;
      longitude: number;
      tier: GeoTier;
      rings: number;
    }
  | { kind: "related"; momentId: string };

/**
 * Where to look for history near a position.
 *
 * @param latitude - Degrees north.
 * @param longitude - Degrees east.
 * @param radiusMetres - How far around it to look.
 * @returns The scope, at the granularity that radius can honestly be answered
 *   at. The same coverage rule Search uses, so the two surfaces cannot disagree
 *   about what "near" means.
 */
export function nearbyScope(
  latitude: number,
  longitude: number,
  radiusMetres: number,
): DiscoveryScope {
  return { kind: "nearby", latitude, longitude, ...coverageFor(radiusMetres) };
}

/**
 * The instant a given number of years before another.
 *
 * @param at - The instant to count back from.
 * @param years - How many years.
 * @returns The earlier instant, by calendar rather than by subtracting an
 *   average year — which leap years make wrong at exactly the boundary that
 *   matters for an age check.
 */
function yearsBefore(at: Date, years: number): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear() - years, at.getUTCMonth(), at.getUTCDate()),
  );
}
