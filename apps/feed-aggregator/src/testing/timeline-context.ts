import { randomUUID } from "node:crypto";
import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelineEligibility, TimelineReading } from "@chronologity/timeline-derivation";
import type { GraphQLContext } from "../graphql/context/graphql-context.js";
import type {
  TimelineBoundary,
  TimelineReadModel,
  TimelineSlice,
} from "../read-models/clickhouse/timeline-read-model.js";

/**
 * A request context standing in for a real one, for tests about composition.
 *
 * The read model is **stood in for rather than mocked away**: it is handed in
 * through the context, which is how a query function receives it in production
 * too. What ClickHouse actually returns is settled by the integration suite,
 * which is the only thing that can settle it.
 *
 * Shared because two query modules compose the same rows and would otherwise
 * each keep their own copy of this — and a fixture that drifts between two
 * tests makes them quietly stop testing the same thing.
 */

/**
 * A stored row, with anything a test needs different.
 *
 * @param authorUserId - Whose Moment it is. Taken rather than defaulted, since
 *   the eligibility rule turns on whether the reader is the author.
 * @param over - Anything this row needs different.
 * @returns The row as ClickHouse would return it.
 */
export function reading(
  authorUserId: string,
  over: Partial<TimelineReading> = {},
): TimelineReading {
  return {
    readable: 1,
    occurred_at: "2014-05-01 00:00:00.000",
    recorded_at: "2026-01-01 00:00:00.000",
    moment_id: randomUUID(),
    author_user_id: authorUserId,
    projected_at: "2026-01-01 00:00:00.000",
    occurrence_end: "2014-05-01 00:00:00.000",
    occurrence_precision: "instant",
    occurrence_offset_minutes: 0,
    visibility: "public",
    moderation_state: "none",
    discoverable: 1,
    projection_version: "timeline-v1",
    ...over,
  };
}

/** What was asked of the store, so a translation can be inspected. */
export interface Asked {
  view?: ViewSpecification;
  from?: TimelineBoundary | undefined;
}

/**
 * Build a context whose read model returns one prepared slice.
 *
 * @param viewerUserId - Who the request established.
 * @param slice - What the store should answer with.
 * @param asked - Filled in with what the store was asked for, so a test can
 *   assert the translation rather than only the result.
 * @returns A context sufficient for a query function. Deliberately not a whole
 *   one: a test that needed the rest would be a test of something else.
 */
export function contextReturning(
  viewerUserId: string,
  slice: TimelineSlice,
  asked: Asked = {},
): GraphQLContext {
  return {
    viewer: {
      kind: "authenticated",
      identityId: randomUUID(),
      sessionId: randomUUID(),
      userId: viewerUserId,
    },
    eligibility: {
      forScope: async (): Promise<TimelineEligibility> => ({
        viewerUserId,
        blocked: [],
        audience: [],
        isAdult: true,
        scopeIsOpen: true,
      }),
    },
    timeline: {
      page: async (
        view: ViewSpecification,
        _viewer: TimelineEligibility,
        from: TimelineBoundary | undefined,
      ) => {
        asked.view = view;
        asked.from = from;

        return slice;
      },
    } as unknown as TimelineReadModel,
  } as unknown as GraphQLContext;
}
