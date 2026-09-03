import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelineEligibility, TimelinePosition, TimelineReading } from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import type { TimelineReadModel, TimelineSlice } from "../../read-models/clickhouse/timeline-read-model.js";
import type { GraphQLContext } from "../context/graphql-context.js";
import { timelineEntryResolver, timelineQueries } from "./timeline.resolver.js";

/**
 * The resolvers, as the thin things they are meant to be.
 *
 * What the store returns is settled elsewhere — by the integration suite, which
 * is the only thing that can prove a statement against ClickHouse. What is left
 * here is the mapping, and the two decisions the resolvers actually make: that
 * a Timeline holding nothing opens at nothing rather than at an error, and that
 * a page knows whether it was reached from a cursor.
 *
 * The read model is stood in for rather than mocked away: it is handed in
 * through the context, which is how a resolver receives it in production too.
 */

const PERSON = randomUUID();

const reading = (over: Partial<TimelineReading> = {}): TimelineReading => ({
  readable: 1,
  occurred_at: "2014-05-01 00:00:00.000",
  recorded_at: "2026-01-01 00:00:00.000",
  moment_id: randomUUID(),
  author_user_id: PERSON,
  projected_at: "2026-01-01 00:00:00.000",
  occurrence_end: "2014-05-01 00:00:00.000",
  occurrence_precision: "instant",
  occurrence_offset_minutes: 0,
  visibility: "public",
  moderation_state: "none",
  discoverable: 1,
  projection_version: "timeline-v1",
  ...over,
});

/** What was asked of the store, so the resolver's translation can be inspected. */
interface Asked {
  view?: ViewSpecification;
  from?: TimelinePosition | undefined;
}

const contextReturning = (slice: TimelineSlice, asked: Asked = {}): GraphQLContext =>
  ({
    viewer: { kind: "authenticated", identityId: randomUUID(), sessionId: randomUUID(), userId: PERSON },
    eligibility: {
      forScope: async (): Promise<TimelineEligibility> => ({
        viewerUserId: PERSON,
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
        from: TimelinePosition | undefined,
      ) => {
        asked.view = view;
        asked.from = from;

        return slice;
      },
    } as unknown as TimelineReadModel,
  }) as unknown as GraphQLContext;

const view = { scope: { type: "PERSON", id: PERSON } } as const;

describe("Query.timelineHead", () => {
  it("opens a Timeline at its newest occurrence", async () => {
    const row = reading();
    const context = contextReturning({ rows: [row], more: false });

    const head = await timelineQueries.timelineHead(undefined, { view }, context);

    assert.equal(head?.momentId, row.moment_id);
  });

  it("asks for one Moment, walking into the past", async () => {
    // A page of one rather than a query of its own, so that where a Timeline
    // opens and where paging would take it cannot disagree.
    const asked: Asked = {};

    await timelineQueries.timelineHead(undefined, { view }, contextReturning({ rows: [], more: false }, asked));

    assert.equal(asked.view?.limit, 1);
    assert.equal(asked.view?.direction, "older");
    assert.equal(asked.from, undefined);
  });

  it("answers nothing for a Timeline holding none", async () => {
    const context = contextReturning({ rows: [], more: false });

    assert.equal(await timelineQueries.timelineHead(undefined, { view }, context), null);
  });
});

describe("Query.timeline", () => {
  it("reports a page reached without a cursor as having nothing before it", async () => {
    const context = contextReturning({ rows: [reading()], more: true });

    const connection = await timelineQueries.timeline(undefined, { view, first: 10 }, context);

    assert.equal(connection.pageInfo.hasPreviousPage, false);
    assert.equal(connection.pageInfo.hasNextPage, true);
  });

  it("reports a page reached from a cursor as having something before it", async () => {
    const asked: Asked = {};
    const after = { occurredAt: new Date("2015-01-01T00:00:00Z"), momentId: randomUUID() };
    const context = contextReturning({ rows: [reading()], more: false }, asked);

    const connection = await timelineQueries.timeline(undefined, { view, first: 10, after }, context);

    assert.deepEqual(asked.from, after);
    assert.equal(connection.pageInfo.hasPreviousPage, true);
  });

  it("carries the scope so a client can restore where it was", async () => {
    const context = contextReturning({ rows: [], more: false });

    const connection = await timelineQueries.timeline(undefined, { view }, context);

    assert.deepEqual(connection.scope, { type: "PERSON", id: PERSON });
  });
});

describe("which kind of entry a row is", () => {
  it("names a readable Moment's type", () => {
    assert.equal(
      timelineEntryResolver.resolveType({
        readable: true,
        momentId: randomUUID(),
        occurredAt: new Date(),
        occurrenceEnd: new Date(),
        occurrencePrecision: "INSTANT",
        occurrenceOffsetMinutes: 0,
        visibility: "PUBLIC",
        discoverable: true,
      }),
      "ReadableTimelineEntry",
    );
  });

  it("names a withheld Moment's type", () => {
    assert.equal(
      timelineEntryResolver.resolveType({
        readable: false,
        momentId: randomUUID(),
        occurredAt: new Date(),
        occurrenceEnd: new Date(),
        occurrencePrecision: "INSTANT",
      }),
      "WithheldTimelineEntry",
    );
  });
});
