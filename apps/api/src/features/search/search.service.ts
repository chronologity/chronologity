import type {
  SearchPage,
  SearchRequest,
  SearchResult,
  TemporalPrecision,
} from "@chronologity/contracts";
import { isAdult } from "../moderation/moderation.policy.js";
import type { ModerationRepository } from "../moderation/moderation.repository.js";
import { decodeSearchCursor, encodeSearchCursor } from "./search.cursor.js";
import { interpret } from "./search.query.js";
import { RANKING_VERSION } from "./search.ranking.js";
import { matchReasons, snippet } from "./search.presentation.js";
import type { RetrievedDocument, SearchRetrieval } from "./search.retrieval.js";

/**
 * Answering a question about history.
 *
 * Search finds things; it never decides anything about them. A result is a
 * pointer, and `search.md:265` is explicit that every result is reauthorized
 * when opened — Search rank grants no access, and an old result reference does
 * not preserve access that has since been revoked. Nothing here is authoritative
 * and nothing here writes.
 *
 * The one rule everything else serves: eligibility lives in the query. It is
 * never applied to results after they come back, because removing them
 * afterwards leaks through page sizes, counts, and pagination gaps even when
 * the restricted thing is never shown.
 */
export class SearchService {
  /**
   * Build the search service.
   *
   * @param retrieval - Where candidates come from. An interface rather than a
   *   database, so a different store is a different implementation and not a
   *   rewrite.
   * @param moderation - Used to establish the Viewer's age, which the age gate
   *   needs and which is resolved once per request rather than per row.
   * @param now - Reads the clock, injected so the age boundary can be tested.
   */
  constructor(
    private readonly retrieval: SearchRetrieval,
    private readonly moderation: ModerationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Search.
   *
   * @param request - What was asked, already validated and bounded.
   * @param viewerUserId - Who is asking.
   * @returns The page. A search that matches nothing returns nothing:
   *   `search.md:453` forbids substituting loosely related history to avoid an
   *   empty state, because no result is preferable to fictional history.
   * @throws {ValidationError} If the cursor belongs to a different search, or
   *   to a ranking version that no longer produces this ordering.
   */
  async search(request: SearchRequest, viewerUserId: string): Promise<SearchPage> {
    const query = interpret(request);
    const cursor = decodeSearchCursor(request.cursor, query.fingerprint);
    const offset = cursor?.offset ?? 0;

    const viewer = {
      userId: viewerUserId,
      isAdult: isAdult(await this.moderation.findDateOfBirth(viewerUserId), this.now()),
    };

    const { documents, total } = await this.retrieval.retrieve(query, viewer, offset);
    const results = documents.map((document) => this.present(document, query));

    return {
      results,
      total,
      ...(query.near === undefined ? {} : { geoPrecision: query.near.tier }),
      ...(offset + documents.length >= total || documents.length === 0
        ? {}
        : {
            nextCursor: encodeSearchCursor({
              fingerprint: query.fingerprint,
              rankingVersion: RANKING_VERSION,
              offset: offset + documents.length,
              at: documents[documents.length - 1]?.occurrenceStart?.toISOString(),
              id: documents[documents.length - 1]?.entityId,
            }),
          }),
    };
  }

  /**
   * Shape one candidate as a result.
   *
   * @param document - The candidate, already found eligible by the query.
   * @param query - What was asked, for the snippet and the reasons.
   * @returns The result. It carries no score and no significance number: a
   *   number beside a result reads as a judgement about the past whatever it is
   *   labelled, and `search.md:67` separates relevance from significance.
   */
  private present(
    document: RetrievedDocument,
    query: ReturnType<typeof interpret>,
  ): SearchResult {
    return {
      entityType: document.entityType as SearchResult["entityType"],
      entityId: document.entityId,
      title: document.title,
      // Built only from text already in this result's own document, so it can
      // never widen what was disclosed.
      snippet: snippet(document.body, query.terms),
      occurrence:
        document.occurrenceStart === null || document.occurrenceEnd === null
          ? null
          : {
              start: document.occurrenceStart.toISOString(),
              end: document.occurrenceEnd.toISOString(),
              precision: (document.occurrencePrecision ?? "year") as TemporalPrecision,
            },
      matchedOn: matchReasons({
        title: document.title,
        aliases: document.aliases,
        body: document.body,
        phrase: query.phrase,
        terms: query.terms,
        hadTemporalFilter: query.from !== undefined || query.to !== undefined,
        hadProximityFilter: query.near !== undefined,
        hadCreatorFilter: query.creator !== undefined,
        hadEventFilter: query.realWorldEventId !== undefined,
        hadLocationFilter: query.locationId !== undefined,
      }),
    };
  }
}
