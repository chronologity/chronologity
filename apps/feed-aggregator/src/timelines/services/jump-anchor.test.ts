import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HISTORY_FLOOR, viewSpecificationSchema } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { ValidationError } from "../../errors/aggregator-error.js";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import { resolveAnchor, type TimelineAnchorArguments } from "./jump-anchor.js";

/**
 * Working out where somebody asked to go.
 *
 * These are the refusals, and what matters about them is *when* they happen. A
 * destination that was never usable must be refused from the arguments alone —
 * before a store is asked anything — because the alternative is a path that
 * reads history to answer a question that was malformed, and because
 * `architecture/timeline.md:672` counts a timestamp among the things an
 * unreachable destination must not leak.
 *
 * What each anchor resolves *to* needs real rows, and is settled by the
 * integration suites.
 */

const PERSON = randomUUID();
const FACTS = { viewerUserId: PERSON, isAdult: true };

const view = viewSpecificationSchema.parse({ context: { type: "person", id: PERSON } });

/** A context whose every store refuses to be reached. */
const NO_STORES = {
  moments: {
    findVisible: () => {
      throw new Error("PostgreSQL was read for an anchor that should have been refused");
    },
    findRelationship: () => {
      throw new Error("PostgreSQL was read for an anchor that should have been refused");
    },
  },
  realWorldEvents: {
    findVisible: () => {
      throw new Error("PostgreSQL was read for an anchor that should have been refused");
    },
  },
  representatives: {
    choose: () => {
      throw new Error("PostgreSQL was read for an anchor that should have been refused");
    },
  },
  timeline: {
    page: () => {
      throw new Error("ClickHouse was read for an anchor that should have been refused");
    },
  },
  eligibility: {
    forScope: () => {
      throw new Error("eligibility was resolved for an anchor that should have been refused");
    },
  },
  searchDocuments: {
    findable: () => {
      throw new Error("the Search index was read for an anchor that should have been refused");
    },
  },
} as unknown as GraphQLContext;

/**
 * A context whose Search index answers, and whose every other store refuses.
 *
 * @param findable - What the index should say.
 * @param asked - Filled in with what it was asked about.
 * @returns A context sufficient to reach the findability check and no further.
 */
const indexSaying = (
  findable: boolean,
  asked: { entityType?: string; entityId?: string } = {},
): GraphQLContext =>
  ({
    ...NO_STORES,
    searchDocuments: {
      findable: async (entityType: string, entityId: string) => {
        asked.entityType = entityType;
        asked.entityId = entityId;

        return findable;
      },
    },
  }) as unknown as GraphQLContext;

const anchoring = (anchor: TimelineAnchorArguments): Promise<unknown> =>
  resolveAnchor(anchor, view, FACTS, NO_STORES);

describe("naming exactly one destination", () => {
  it("refuses a jump that names nowhere", async () => {
    await assert.rejects(anchoring({}), ValidationError);
  });

  it("refuses a jump that names nowhere because every field was null", async () => {
    // GraphQL sends an explicit null for an absent optional, so this is the
    // ordinary shape of "the client set none of them" rather than an edge case.
    await assert.rejects(
      anchoring({ moment: null, instant: null, location: null, causal: null }),
      ValidationError,
    );
  });

  it("refuses a jump that names two destinations rather than picking one", async () => {
    // Picking would send somebody somewhere they did not ask to go, and a
    // request naming both is a client assembling arguments wrongly.
    await assert.rejects(
      anchoring({ moment: randomUUID(), instant: new Date("2014-05-01T00:00:00Z") }),
      ValidationError,
    );
  });

  it("refuses six destinations as readily as two", async () => {
    await assert.rejects(
      anchoring({
        moment: randomUUID(),
        instant: new Date("2014-05-01T00:00:00Z"),
        location: { locationId: randomUUID() },
        realWorldEvent: { realWorldEventId: randomUUID() },
        causal: { fromMomentId: randomUUID(), relationshipId: randomUUID() },
        significance: { startsAt: new Date("2014-01-01T00:00:00Z"), scale: "YEAR" },
      }),
      ValidationError,
    );
  });
});

describe("destinations refused from the arguments alone", () => {
  it("refuses an instant older than history can be read", async () => {
    await assert.rejects(
      anchoring({ instant: new Date("1850-06-15T00:00:00Z") }),
      (error: unknown) => error instanceof ValidationError && /1900/.test(error.message),
    );
  });

  it("admits the floor itself", async () => {
    const resolved = await anchoring({ instant: HISTORY_FLOOR });

    assert.notEqual(resolved, undefined);
  });

  it("refuses a span that does not begin where its scale says it must", async () => {
    // The middle of a year is not a year. Answering would bucket from somewhere
    // nobody asked about, and the answer would look ordinary.
    await assert.rejects(
      anchoring({ significance: { startsAt: new Date("1998-06-15T00:00:00Z"), scale: "YEAR" } }),
      (error: unknown) => error instanceof ValidationError && /year begins/.test(error.message),
    );
  });

  it("refuses a span whose scale it does not begin, even when it begins another", async () => {
    // 1998-06-01 is a real month start and not a real year start.
    await assert.rejects(
      anchoring({ significance: { startsAt: new Date("1998-06-01T00:00:00Z"), scale: "YEAR" } }),
      ValidationError,
    );
  });

  it("refuses a span reaching before history is held", async () => {
    await assert.rejects(
      anchoring({ significance: { startsAt: new Date("1800-01-01T00:00:00Z"), scale: "CENTURY" } }),
      ValidationError,
    );
  });
});

describe("an instant", () => {
  it("resolves without asking any store anything", async () => {
    // The only anchor that names a position directly, and the only one that
    // cannot be refused: every instant exists, whether or not anything happened
    // at it.
    const at = new Date("2014-05-01T12:00:00.000Z");

    assert.deepEqual(await anchoring({ instant: at }), {
      instant: at,
      momentId: undefined,
      authorUserId: undefined,
      scope: { type: "person", id: PERSON },
      reason: "INSTANT",
    });
  });

  it("stays in the Timeline being read", async () => {
    const resolved = (await anchoring({ instant: new Date("2014-05-01T00:00:00Z") })) as {
      scope: { type: string; id: string };
    };

    assert.deepEqual(resolved.scope, { type: "person", id: PERSON });
  });
});

describe("something found", () => {
  it("refuses an identifier that is not one, before reading anything", async () => {
    // It reaches a `uuid` column, where PostgreSQL raises rather than returning
    // nothing — which would surface as an internal error where a refusal was
    // the right answer.
    await assert.rejects(
      anchoring({ searchResult: { entityType: "MOMENT", entityId: "not-a-uuid" } }),
      ValidationError,
    );
  });

  it("asks the index about the kind that was named, under the index's own spelling", async () => {
    // EVENT here, `event` there. A reference carries what a Search result
    // carried, and translating it is this layer's job rather than an app's.
    const asked: { entityType?: string; entityId?: string } = {};
    const entityId = randomUUID();

    await resolveAnchor(
      { searchResult: { entityType: "EVENT", entityId } },
      view,
      FACTS,
      indexSaying(false, asked),
    );

    assert.equal(asked.entityType, "event");
    assert.equal(asked.entityId, entityId);
  });

  it("stops at a thing that is no longer findable, without resolving it", async () => {
    // The whole ordering argument in one assertion. Every other store in this
    // context throws, so reaching any of them fails the test rather than
    // producing a wrong answer quietly — and an instant is never computed for
    // something Search would no longer offer.
    const resolved = await resolveAnchor(
      { searchResult: { entityType: "MOMENT", entityId: randomUUID() } },
      view,
      FACTS,
      indexSaying(false),
    );

    assert.equal(resolved, undefined);
  });

  it("answers a thing never indexed exactly as one withdrawn from the index", async () => {
    // Both are a missing row, and neither is distinguished, because
    // distinguishing them would say something exists.
    const never = await resolveAnchor(
      { searchResult: { entityType: "LOCATION", entityId: randomUUID() } },
      view,
      FACTS,
      indexSaying(false),
    );
    const withdrawn = await resolveAnchor(
      { searchResult: { entityType: "USER", entityId: randomUUID() } },
      view,
      FACTS,
      indexSaying(false),
    );

    assert.deepEqual(never, withdrawn);
  });

  it("is refused alongside another destination, like any other pair", async () => {
    await assert.rejects(
      anchoring({
        instant: new Date("2014-05-01T00:00:00Z"),
        searchResult: { entityType: "MOMENT", entityId: randomUUID() },
      }),
      ValidationError,
    );
  });
});
