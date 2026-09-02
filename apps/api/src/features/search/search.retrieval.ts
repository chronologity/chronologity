import type { DataSource } from "typeorm";
import { geohash, INDEX_VERSION } from "./search-document.js";
import { cellsAround, TIER_LENGTH } from "./search.geo.js";
import { eligibleForViewer } from "./search.eligibility.js";
import type { InterpretedQuery } from "./search.query.js";
import type { NamedCandidate } from "./search.suggest.js";
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

  /**
   * Names to complete a prefix with.
   *
   * The same eligibility as `retrieve`, deliberately. `search.md:301` says
   * autocomplete gets the same treatment as results, "not a relaxed one", and
   * the only durable form of that is the same predicate rather than a second
   * one written for speed.
   *
   * @param prefix - What has been typed, lowercased and long enough to answer.
   * @param entityType - Restrict to one kind, or undefined for all three.
   * @param viewer - Who is asking.
   * @param limit - How many at most.
   * @returns The candidates and their names.
   */
  suggest(
    prefix: string,
    entityType: string | undefined,
    viewer: Viewer,
    limit: number,
  ): Promise<NamedCandidate[]>;

  /**
   * The nearest eligible titles to a phrase.
   *
   * Used only when a search found nothing. Eligibility is applied here rather
   * than by the caller, so a correction cannot name something the asker could
   * not have found.
   *
   * @param phrase - What was searched for, lowercased.
   * @param viewer - Who is asking.
   * @param limit - How many at most.
   * @returns The closest titles, nearest first.
   */
  nearestTitles(phrase: string, viewer: Viewer, limit: number): Promise<string[]>;
}

/** How the query addresses the document table. */
const DOC = "d";

/**
 * How close a name must be to be worth suggesting.
 *
 * Below `pg_trgm`'s own 0.3 threshold, deliberately. Search retrieves at 0.3,
 * so anything at or above it was already found and needs no correction; this is
 * the band where the search came back empty but something recognisable exists.
 */
const CORRECTION_THRESHOLD = 0.15;

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

  /**
   * Names to complete a prefix with.
   *
   * The same eligibility fragment `retrieve` uses, applied the same way. That
   * sameness is the feature: a suggestion path with its own looser rule is how
   * a private name reaches somebody who typed three letters.
   *
   * @param prefix - What has been typed, lowercased.
   * @param entityType - Restrict to one kind, or undefined for all three.
   * @param viewer - Who is asking.
   * @param limit - How many at most.
   * @returns The candidates and their names.
   */
  async suggest(
    prefix: string,
    entityType: string | undefined,
    viewer: Viewer,
    limit: number,
  ): Promise<NamedCandidate[]> {
    const parameters: unknown[] = [];
    const bind = (value: unknown): number => {
      parameters.push(value);

      return parameters.length;
    };

    const indexVersionParam = bind(this.indexVersion);
    const viewerParam = bind(viewer.userId);
    const adultParam = bind(viewer.isAdult);
    const prefixParam = bind(prefix);

    const where: string[] = [
      `${DOC}.index_version = $${indexVersionParam}`,
      // Moments are deliberately absent. A caption is the most sensitive text
      // Chronologity holds, and a surface that fires on every keystroke is the
      // worst place to put it; finding a Moment is search's job.
      `${DOC}.entity_type IN ('user', 'event', 'location')`,
      eligibleForViewer(DOC)
        .replaceAll(":viewerUserId", `$${viewerParam}`)
        .replaceAll(":viewerIsAdult", `$${adultParam}`),
      `(
        lower(${DOC}.title) LIKE $${prefixParam} || '%'
        OR lower(${DOC}.aliases) LIKE $${prefixParam} || '%'
        OR lower(${DOC}.aliases) LIKE '% ' || $${prefixParam} || '%'
      )`,
    ];

    if (entityType !== undefined) {
      where.push(`${DOC}.entity_type = $${bind(entityType)}`);
    }

    const limitParam = bind(limit);

    const rows: { entity_type: string; entity_id: string; title: string; aliases: string }[] =
      await this.dataSource.query(
        `SELECT ${DOC}.entity_type, ${DOC}.entity_id, ${DOC}.title, ${DOC}.aliases
           FROM search_documents ${DOC}
          WHERE ${where.join("\n            AND ")}
          ORDER BY length(${DOC}.title), lower(${DOC}.title), ${DOC}.entity_id
          LIMIT $${limitParam}`,
        parameters,
      );

    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.title,
      aliases: row.aliases,
    }));
  }

  /**
   * The nearest eligible titles to a phrase.
   *
   * Eligibility first, similarity second. Drawing the nearest title before
   * eligibility and filtering afterwards would be the same post-filtering
   * mistake `search.md:249` warns about, in the one place where the leak is a
   * name rather than a count.
   *
   * @param phrase - What was searched for, lowercased.
   * @param viewer - Who is asking.
   * @param limit - How many at most.
   * @returns The closest titles, nearest first.
   */
  async nearestTitles(phrase: string, viewer: Viewer, limit: number): Promise<string[]> {
    const rows: { title: string }[] = await this.dataSource.query(
      `SELECT ${DOC}.title
         FROM search_documents ${DOC}
        WHERE ${DOC}.index_version = $1
          AND ${eligibleForViewer(DOC)
            .replaceAll(":viewerUserId", "$2")
            .replaceAll(":viewerIsAdult", "$3")}
          -- Names, not captions. A correction is a name-correction feature, and
          -- putting caption text behind a door marked "did you mean" would
          -- undo the decision that keeps captions out of suggestion surfaces.
          AND ${DOC}.entity_type IN ('user', 'event', 'location')
          -- A lower bar than the search itself uses. The similarity operator
          -- matches at 0.3, so drawing corrections with it could only ever
          -- offer something the search had already found — the correction
          -- would be dead code. This is the band between "close enough to
          -- retrieve" and "close enough to mention".
          AND similarity(lower(${DOC}.title), $4) >= ${CORRECTION_THRESHOLD}
        ORDER BY similarity(lower(${DOC}.title), $4) DESC, ${DOC}.entity_id
        LIMIT $5`,
      [this.indexVersion, viewer.userId, viewer.isAdult, phrase, limit],
    );

    return rows.map((row) => row.title);
  }
}

/** How long a cell prefix is at each tier, re-exported for the tests. */
export { TIER_LENGTH };
