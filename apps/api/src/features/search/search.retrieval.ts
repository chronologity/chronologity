import type { DataSource } from "typeorm";
import { geohash, INDEX_VERSION } from "./search-document.js";
import { cellsAround, TIER_LENGTH } from "./search.geo.js";
import { eligibleForViewer } from "./search.eligibility.js";
import type { InterpretedQuery } from "./search.query.js";
import { occurrenceOrder, relevanceOrder, scoreExpression } from "./search.ranking.js";

/** One candidate, as the store found it. */
export interface RetrievedDocument {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly aliases: string;
  readonly body: string;
  readonly occurrenceStart: Date | null;
  readonly occurrenceEnd: Date | null;
  readonly occurrencePrecision: string | null;
}

/** Who is asking. */
export interface Viewer {
  readonly userId: string;
  readonly isAdult: boolean;
}

/** A page of candidates, and how many there were altogether. */
export interface Retrieved {
  readonly documents: RetrievedDocument[];
  /** Eligible candidates only. Counting before eligibility would report how much was withheld. */
  readonly total: number;
}

/**
 * Where candidates come from.
 *
 * The seam `search.md:559` asks for: query construction, eligibility, and
 * ranking above it, store syntax below. It exists so the eventual decision
 * about a dedicated Search engine becomes a second implementation of this
 * rather than a rewrite of everything above it.
 *
 * Eligibility is not something a caller can forget to pass. Every
 * implementation applies it, and the Viewer is required rather than optional —
 * an anonymous Viewer would be an explicit context, not an absent one.
 */
export interface SearchRetrieval {
  /**
   * Find eligible candidates.
   *
   * @param query - What was asked.
   * @param viewer - Who is asking.
   * @param offset - How far into the ordering to start.
   * @returns The page and the eligible total.
   */
  retrieve(query: InterpretedQuery, viewer: Viewer, offset: number): Promise<Retrieved>;
}

/** How the query addresses the document table. */
const DOC = "d";

/** Retrieval against PostgreSQL. */
export class PostgresSearchRetrieval implements SearchRetrieval {
  /**
   * Build the adapter.
   *
   * @param dataSource - Read only. Search never writes.
   * @param indexVersion - Which index to read, so a new version can be served
   *   by changing one value rather than by rewriting queries.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly indexVersion: string = INDEX_VERSION,
  ) {}

  /**
   * Find eligible candidates.
   *
   * Everything happens in one statement: eligibility, filtering, scoring,
   * ordering, and the count. `search.md:249` requires filtering before ranking
   * and paginating, because removing results afterwards leaks through page
   * sizes, counts, and pagination gaps even when nothing restricted is shown.
   *
   * @param query - What was asked.
   * @param viewer - Who is asking.
   * @param offset - How far into the ordering to start.
   * @returns The page and the eligible total.
   */
  async retrieve(query: InterpretedQuery, viewer: Viewer, offset: number): Promise<Retrieved> {
    const parameters: unknown[] = [];
    const bind = (value: unknown): number => {
      parameters.push(value);

      return parameters.length;
    };

    const indexVersionParam = bind(this.indexVersion);
    const viewerParam = bind(viewer.userId);
    const adultParam = bind(viewer.isAdult);
    const phrase = query.phrase.toLowerCase();
    const phraseParam = bind(phrase);
    // `plainto_tsquery` rather than `to_tsquery`: the caller's text is words a
    // person typed, not query syntax, and interpreting it as syntax would let a
    // stray character turn a search into a parse error.
    const queryParam = bind(phrase);

    const where: string[] = [
      `${DOC}.index_version = $${indexVersionParam}`,
      eligibleForViewer(DOC)
        .replaceAll(":viewerUserId", `$${viewerParam}`)
        .replaceAll(":viewerIsAdult", `$${adultParam}`),
    ];

    if (query.entityType !== undefined) {
      where.push(`${DOC}.entity_type = $${bind(query.entityType)}`);
    }

    if (query.terms.length > 0) {
      // Lexical match, or a close-enough name. `search.md:96` names trigram
      // matching for typo tolerance, and a historically unusual spelling may be
      // the correct one — so a near miss retrieves rather than rewrites.
      const similarity = bind(phrase);

      where.push(`(
        ${DOC}.search_vector @@ plainto_tsquery('simple', $${queryParam})
        OR ${DOC}.title % $${similarity}
        OR ${DOC}.aliases % $${similarity}
      )`);
    }

    // Overlap, not containment. A Moment known only as "summer 1998" belongs in
    // a search for 1998 and must not acquire a fabricated exact timestamp to
    // make the comparison easier.
    if (query.from !== undefined) {
      where.push(`${DOC}.occurrence_end >= $${bind(query.from)}`);
    }

    if (query.to !== undefined) {
      where.push(`${DOC}.occurrence_start <= $${bind(query.to)}`);
    }

    if (query.creator !== undefined) {
      where.push(`${DOC}.author_user_id = $${bind(query.creator)}`);
    }

    if (query.locationId !== undefined) {
      where.push(`EXISTS (
        SELECT 1 FROM moment_locations ml
         WHERE ml.moment_id = ${DOC}.entity_id AND ml.location_id = $${bind(query.locationId)}
      )`);
    }

    if (query.realWorldEventId !== undefined) {
      where.push(`EXISTS (
        SELECT 1 FROM moment_real_world_events mre
         WHERE mre.moment_id = ${DOC}.entity_id
           AND mre.real_world_event_id = $${bind(query.realWorldEventId)}
      )`);
    }

    if (query.near !== undefined) {
      // Matched against the tier the disclosure supports and no finer. A Moment
      // whose author shared only the city has no finer cell stored, so a
      // street-sized search cannot return it — which is the disclosure working
      // rather than a limitation to route around.
      const column = `geohash_${query.near.tier === "neighbourhood" ? "coarse" : query.near.tier}`;
      const cells = cellsAround(
        query.near.latitude,
        query.near.longitude,
        query.near.tier,
        geohash,
        query.near.rings,
      );

      where.push(`${DOC}.${column} = ANY($${bind(cells)}::text[])`);
    }

    const scored = scoreExpression(DOC, phraseParam, queryParam, {
      phrase,
      hasTemporalFilter: query.from !== undefined || query.to !== undefined,
      hasProximityFilter: query.near !== undefined,
    });

    const order =
      query.sort === "relevance"
        ? relevanceOrder(DOC, "score")
        : occurrenceOrder(DOC, query.sort === "occurrence_new");

    const limitParam = bind(query.limit);
    const offsetParam = bind(offset);

    const rows: {
      entity_type: string;
      entity_id: string;
      title: string;
      aliases: string;
      body: string;
      occurrence_start: Date | null;
      occurrence_end: Date | null;
      occurrence_precision: string | null;
      total: string;
    }[] = await this.dataSource.query(
      `SELECT ${DOC}.entity_type, ${DOC}.entity_id, ${DOC}.title, ${DOC}.aliases, ${DOC}.body,
              ${DOC}.occurrence_start, ${DOC}.occurrence_end, ${DOC}.occurrence_precision,
              ${scored} AS score,
              COUNT(*) OVER () AS total
         FROM search_documents ${DOC}
        WHERE ${where.join("\n          AND ")}
        ORDER BY ${order}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      parameters,
    );

    return {
      documents: rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        aliases: row.aliases,
        body: row.body,
        occurrenceStart: row.occurrence_start,
        occurrenceEnd: row.occurrence_end,
        occurrencePrecision: row.occurrence_precision,
      })),
      // Zero when the page is empty, which is also the honest count: the window
      // function reports the eligible set, so a search that matched nothing
      // reports nothing rather than how much it was not allowed to see.
      total: Number(rows[0]?.total ?? "0"),
    };
  }
}

/** How long a cell prefix is at each tier, re-exported for the tests. */
export { TIER_LENGTH };
