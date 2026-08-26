import type {
  DiscoveryRequest,
  NearbyDiscoveryRequest,
  Recommendation,
  RecommendationPage,
  RecommendationReason,
  TemporalPrecision,
} from "@chronologity/contracts";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import { isAdult } from "../moderation/moderation.policy.js";
import type { ModerationRepository } from "../moderation/moderation.repository.js";
import { capPerFacet, overFetchFor } from "./discovery.diversity.js";
import {
  nearbyScope,
  type DiscoveredMoment,
  type DiscoveryRetrieval,
  type DiscoveryScope,
} from "./discovery.retrieval.js";

/**
 * Offering history to somebody who did not ask for it.
 *
 * The whole of this feature is the difference between three questions:
 *
 * ```text
 * may view directly  !=  may be searched  !=  may be recommended
 * ```
 *
 * Every surface here is the same eligibility rule with a different scope. That
 * is deliberate — a surface added later inherits the rule rather than restating
 * it, and `discovery.md:159` is unambiguous that a recommendation system must
 * never treat its ability to infer that content exists as permission to expose
 * it.
 */
export class DiscoveryService {
  /**
   * Build the discovery service.
   *
   * @param retrieval - Where candidates come from, eligibility already applied.
   * @param moderation - Used to establish the Viewer's age, resolved once per
   *   request rather than per candidate.
   * @param now - Reads the clock, injected so the age boundary can be tested.
   */
  constructor(
    private readonly retrieval: DiscoveryRetrieval,
    private readonly moderation: ModerationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * History worth exploring, for nobody in particular.
   *
   * Non-personalised, which is also the answer to cold start: somebody who has
   * done nothing yet gets the same page as somebody who has done a great deal,
   * and neither page was assembled from a profile of what they looked at.
   *
   * @param request - How many, and where to continue from.
   * @param viewerUserId - Who is asking.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async explore(request: DiscoveryRequest, viewerUserId: string): Promise<RecommendationPage> {
    return this.surface(request, viewerUserId, undefined, ["significant"]);
  }

  /**
   * History from a real-world Event.
   *
   * @param realWorldEventId - Which Event.
   * @param request - How many, and where to continue from.
   * @param viewerUserId - Who is asking.
   * @returns The page. An Event with no eligible history returns an empty page
   *   rather than a refusal: that an Event exists is not a secret, and how much
   *   of its history this Viewer may be offered is.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async fromEvent(
    realWorldEventId: string,
    request: DiscoveryRequest,
    viewerUserId: string,
  ): Promise<RecommendationPage> {
    return this.surface(request, viewerUserId, { kind: "event", realWorldEventId }, [
      "same_event",
    ]);
  }

  /**
   * History at a Location, or near a position.
   *
   * A position is query input and nothing else. `discovery.md:277` draws the
   * line: current location may say what to look for and must never become
   * historical content or visible presence.
   *
   * @param locationId - Which Location, when the surface is a place.
   * @param request - How many, where to continue from, and optionally a
   *   position and radius to search around instead.
   * @param viewerUserId - Who is asking.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async fromLocation(
    locationId: string | undefined,
    request: NearbyDiscoveryRequest,
    viewerUserId: string,
  ): Promise<RecommendationPage> {
    if (request.lat !== undefined && request.lon !== undefined) {
      return this.surface(
        request,
        viewerUserId,
        nearbyScope(request.lat, request.lon, request.radius ?? 1_000),
        ["same_location"],
      );
    }

    if (locationId === undefined) {
      throw new NotFoundError("No such place");
    }

    return this.surface(request, viewerUserId, { kind: "location", locationId }, [
      "same_location",
    ]);
  }

  /**
   * History related to one Moment.
   *
   * Asserted relationships, shared Events, and shared places. Nothing is
   * inferred, and nothing inferred would be presented as though it were
   * established — `discovery.md:394` requires that an AI-generated causal
   * recommendation never be presented as historical fact, and the simplest way
   * to honour that is to have nothing of the kind.
   *
   * @param momentId - Which Moment.
   * @param request - How many, and where to continue from.
   * @param viewerUserId - Who is asking.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async relatedTo(
    momentId: string,
    request: DiscoveryRequest,
    viewerUserId: string,
  ): Promise<RecommendationPage> {
    return this.surface(request, viewerUserId, { kind: "related", momentId }, ["same_period"]);
  }

  /**
   * One surface.
   *
   * Every surface is this, with a different scope. Retrieval applies
   * eligibility, ranking orders, diversity caps, and only then is the page cut
   * — the order `discovery.md:1543` requires, where authorization and
   * discoverability are prerequisites rather than ranking features.
   *
   * @param request - How many, and where to continue from.
   * @param viewerUserId - Who is asking.
   * @param scope - What narrows this surface, or undefined for Explore.
   * @param because - Why this surface offers what it offers.
   * @returns The page.
   */
  private async surface(
    request: DiscoveryRequest,
    viewerUserId: string,
    scope: DiscoveryScope | undefined,
    because: readonly RecommendationReason[],
  ): Promise<RecommendationPage> {
    const cursor = decodeCursor(request.cursor);
    const offset = cursor === undefined ? 0 : Number(cursor.id);
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;

    const viewer = {
      userId: viewerUserId,
      isAdult: isAdult(await this.moderation.findDateOfBirth(viewerUserId), this.now()),
    };

    // More than a page, because the caps discard some. Bounded, and a page that
    // comes back short because diversity discarded the rest is an honest page.
    const candidates = await this.retrieval.candidates(
      viewer,
      overFetchFor(request.limit),
      start,
      scope,
    );

    const kept = capPerFacet(candidates, request.limit);

    return {
      recommendations: kept.map((candidate) => this.present(candidate, because)),
      ...(candidates.length < overFetchFor(request.limit)
        ? {}
        : { nextCursor: encodeCursor(this.now(), String(start + candidates.length)) }),
    };
  }

  /**
   * Shape one candidate as a recommendation.
   *
   * @param candidate - The candidate, already found eligible by the query.
   * @param because - Why this surface offered it.
   * @returns The recommendation. It carries no score: a number beside a
   *   recommendation reads as a claim about historical importance whatever it
   *   is labelled, and `discovery.md:85` keeps Discovery and historical truth
   *   apart.
   */
  private present(
    candidate: DiscoveredMoment,
    because: readonly RecommendationReason[],
  ): Recommendation {
    return {
      momentId: candidate.momentId,
      title: candidate.title,
      authorUserId: candidate.authorUserId,
      occurrence: {
        start: candidate.occurrenceStart.toISOString(),
        end: candidate.occurrenceEnd.toISOString(),
        precision: candidate.occurrencePrecision as TemporalPrecision,
      },
      because: [...because],
    };
  }
}
