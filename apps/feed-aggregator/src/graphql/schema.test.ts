import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, it } from "vitest";
import type { SessionLookup } from "../auth/session.repository.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";

/**
 * The read contract's shape.
 *
 * Asserted through introspection rather than by comparing a printed schema,
 * because a whole-schema snapshot passes or fails as one thing and says nothing
 * about which part changed. What is checked here is what a client would break
 * on, and — more importantly — the two places where a wrong shape would leak
 * something.
 *
 * These run without infrastructure. The schema is built at registration, so an
 * application that starts has already proved the SDL parses and every scalar
 * found the type it names; what remains is whether it says the right thing.
 */

const NOTHING_TO_LOOK_UP: SessionLookup = { findOpen: async () => undefined };

let app: FastifyInstance;
let store: ReadStore;

beforeEach(async () => {
  const config = testAppConfig();

  store = createReadStore(config.clickhouse);
  app = await buildApp({
    config,
    dependencies: [],
    graphql: {
      store,
      sessions: NOTHING_TO_LOOK_UP,
      eligibility: {} as never,
      // Never reached: these assertions are introspection, which touches no store.
      directory: {} as never,
    },
  });
});

afterEach(async () => {
  await app.close();
  await store.close();
});

/** Introspect one type. */
const typeNamed = async (name: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    payload: {
      query: `{
        __type(name: "${name}") {
          kind
          inputFields { name type { kind name ofType { kind name } } }
          fields {
            name
            args { name }
            # Deep enough to name the type inside a non-null list of non-nulls,
            # which is what a list field's shape actually is.
            type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
          }
          possibleTypes { name }
          interfaces { name }
          enumValues { name }
        }
      }`,
    },
  });

  return response.json().data.__type;
};

/** The field names a type declares. */
const fieldsOf = async (name: string): Promise<string[]> =>
  ((await typeNamed(name))?.fields ?? []).map((field: { name: string }) => field.name);

/** The values an enum declares. */
const enumValuesOf = async (name: string): Promise<string[]> =>
  ((await typeNamed(name))?.enumValues ?? []).map((value: { name: string }) => value.name);

/** The type at the bottom of however many non-nulls and lists wrap it. */
const namedTypeOf = (type: { name: string | null; ofType?: unknown }): string => {
  const inner = type.ofType as { name: string | null; ofType?: unknown } | null | undefined;

  return inner === null || inner === undefined ? (type.name ?? "") : namedTypeOf(inner);
};

/** Whether a field is non-null. */
const isRequired = async (typeName: string, fieldName: string): Promise<boolean> => {
  const type = await typeNamed(typeName);
  const field = type.fields.find((candidate: { name: string }) => candidate.name === fieldName);

  assert.ok(field, `${typeName}.${fieldName} does not exist`);

  return field.type.kind === "NON_NULL";
};

describe("what a withheld Moment carries", () => {
  it("is its own type rather than the readable one with holes in it", async () => {
    const union = await typeNamed("TimelineEntry");

    assert.equal(union.kind, "UNION");
    assert.deepEqual(union.possibleTypes.map((type: { name: string }) => type.name).sort(), [
      "ReadableTimelineEntry",
      "WithheldTimelineEntry",
    ]);
  });

  it("carries when it happened and nothing that says what it was", async () => {
    const fields = await fieldsOf("WithheldTimelineEntry");

    assert.deepEqual(fields.sort(), [
      "momentId",
      "occurredAt",
      "occurrenceEnd",
      "occurrencePrecision",
    ]);
  });

  it("carries no UTC offset", async () => {
    // The leak this shape exists to prevent. An offset is a weak statement about
    // where somebody was — the one occurrence field that says anything about
    // place — so a withheld Moment reports times in UTC and nothing else.
    const fields = await fieldsOf("WithheldTimelineEntry");

    assert.ok(!fields.includes("occurrenceOffsetMinutes"));
  });

  it("carries none of what the readable one does", async () => {
    const readable = await fieldsOf("ReadableTimelineEntry");
    const withheld = await fieldsOf("WithheldTimelineEntry");

    for (const field of readable.filter((name) => !withheld.includes(name))) {
      assert.ok(
        ["occurrenceOffsetMinutes", "visibility", "discoverable"].includes(field),
        `the readable entry gained ${field}, which the withheld one should be checked against`,
      );
    }
  });
});

describe("how a page is shaped", () => {
  it("says whether there is more in each direction, always", async () => {
    assert.equal(await isRequired("PageInfo", "hasNextPage"), true);
    assert.equal(await isRequired("PageInfo", "hasPreviousPage"), true);
  });

  it("leaves the ends absent when a page holds nothing", async () => {
    // An empty page has no start and no end; a page that holds anything has
    // both. Non-null cursors here would force a lie about the empty case.
    assert.equal(await isRequired("PageInfo", "startCursor"), false);
    assert.equal(await isRequired("PageInfo", "endCursor"), false);
  });

  it("gives every entry a position", async () => {
    assert.equal(await isRequired("TimelineEdge", "cursor"), true);
    assert.equal(await isRequired("TimelineEdge", "node"), true);
  });

  it("says whose history a page is", async () => {
    // So a client can restore where it was without remembering what it asked.
    assert.equal(await isRequired("TimelineConnection", "scope"), true);
  });
});

describe("what a Moment says about where it happened", () => {
  it("distinguishes nobody saying from being told nothing", async () => {
    // Null means nobody said where. A place its author withheld is not null —
    // it is a place with HIDDEN disclosure. A client that cannot tell these
    // apart shows the wrong thing.
    assert.equal(await isRequired("Moment", "place"), false);
    assert.equal(await isRequired("MomentPlace", "disclosure"), true);
  });

  it("gives a reduced place no identifier to look up", async () => {
    // Below exact there is no identifier at all, which is what stops the
    // reduction being undone by looking the place up.
    assert.equal(await isRequired("MomentPlace", "location"), false);
    assert.equal(await isRequired("MomentPlace", "area"), false);
  });

  it("keeps disclosure and precision as separate things", async () => {
    const disclosure = await typeNamed("LocationDisclosure");
    const precision = await typeNamed("LocationPrecision");

    assert.deepEqual(disclosure.enumValues.map((value: { name: string }) => value.name).sort(), [
      "CITY",
      "EXACT",
      "HIDDEN",
      "NEIGHBOURHOOD",
    ]);
    assert.deepEqual(precision.enumValues.map((value: { name: string }) => value.name).sort(), [
      "APPROXIMATE",
      "BROAD",
      "EXACT",
      "UNKNOWN",
    ]);
  });
});

describe("media", () => {
  it("is an interface with a photograph and a recording implementing it", async () => {
    const media = await typeNamed("Media");

    assert.equal(media.kind, "INTERFACE");
    assert.deepEqual(media.possibleTypes.map((type: { name: string }) => type.name).sort(), [
      "Image",
      "Video",
    ]);
  });

  it("gives only a recording a length", async () => {
    assert.ok((await fieldsOf("Video")).includes("durationSeconds"));
    assert.ok(!(await fieldsOf("Image")).includes("durationSeconds"));
  });

  it("carries nothing about storage or an upload's progress", async () => {
    // Narrower than what an owner sees: no key, no URL, no lifecycle state, no
    // declared-versus-verified pair, no failure reason.
    const video = await fieldsOf("Video");

    for (const absent of [
      "url",
      "storageKey",
      "state",
      "declaredContentType",
      "declaredByteSize",
      "checksum",
      "failureReason",
      "expiresAt",
    ]) {
      assert.ok(!video.includes(absent), `media exposed ${absent}`);
    }
  });

  it("pages a Moment's media rather than returning all of it", async () => {
    assert.equal(await isRequired("Moment", "media"), true);
    assert.ok((await fieldsOf("MediaConnection")).includes("pageInfo"));
  });
});

describe("occurrence", () => {
  it("keeps the interval and its precision together", async () => {
    // So a Moment known only as "summer 1998" is never presented as a day.
    assert.deepEqual((await fieldsOf("Occurrence")).sort(), ["end", "precision", "start"]);
    assert.equal(await isRequired("Occurrence", "precision"), true);
  });
});

describe("a Moment in full", () => {
  it("is null when it may not be had, so one refusal covers every reason", async () => {
    // No such Moment, private, blocked, not on its list, withheld: telling them
    // apart would disclose which applied, and knowing an identifier has never
    // granted access to what it names.
    assert.equal(await isRequired("Query", "moment"), false);
  });

  it("pages its media and its discussion, and neither connection is optional", async () => {
    assert.equal(await isRequired("Moment", "media"), true);
    assert.equal(await isRequired("Moment", "comments"), true);
    assert.ok((await fieldsOf("CommentConnection")).includes("pageInfo"));
    assert.ok((await fieldsOf("CommentConnection")).includes("total"));
  });

  it("says who may join the discussion, separately from who may read it", async () => {
    assert.equal(await isRequired("Moment", "commentPolicy"), true);
    assert.deepEqual((await enumValuesOf("CommentPolicy")).sort(), [
      "ANYONE",
      "DISABLED",
      "FOLLOWERS",
    ]);
  });
});

describe("comments", () => {
  it("lets a tombstone carry neither author nor words", async () => {
    // A deleted comment with live replies still appears: the replies need
    // something to hang from. What it loses is who wrote it and what they said.
    assert.equal(await isRequired("Comment", "author"), false);
    assert.equal(await isRequired("Comment", "body"), false);
    assert.equal(await isRequired("Comment", "deleted"), true);
  });

  it("keeps its position in the conversation non-null", async () => {
    // The ordering the page is keyed on. A null here would be a comment that
    // could not be paged past.
    assert.equal(await isRequired("Comment", "createdAt"), true);
    assert.equal(await isRequired("Comment", "editedAt"), false);
  });
});

describe("what a Moment is connected to", () => {
  it("keeps who claimed it, and offers no confidence score", async () => {
    const fields = await fieldsOf("MomentRelationship");

    assert.ok(fields.includes("assertedByUserId"));
    assert.ok(fields.includes("origin"));

    for (const absent of ["confidence", "score", "probability", "likelihood"]) {
      assert.ok(!fields.includes(absent), `a relationship offered ${absent}`);
    }
  });

  it("carries nothing about a far end moderation withheld", async () => {
    // `unavailable` says a link continues here and refuses to say through what.
    const fields = await fieldsOf("MomentRelationship");

    assert.ok(fields.includes("unavailable"));

    for (const absent of ["caption", "author", "place", "media", "occurrence"]) {
      assert.ok(!fields.includes(absent), `a relationship exposed ${absent}`);
    }
  });

  it("names suggestion and derivation without being able to produce them", async () => {
    // Named so a suggestion engine is additive, and so what it produces can
    // never be mistaken for what a person said.
    assert.deepEqual((await enumValuesOf("MomentRelationshipOrigin")).sort(), [
      "ASSERTED",
      "DERIVED",
      "SUGGESTED",
    ]);
  });
});

describe("significance", () => {
  it("exposes one private mark and no score at all", async () => {
    // The absence is the decision. Chronologity computes significance per scope
    // and per dimension, versioned, with provenance — and shows none of it.
    const fields = await fieldsOf("PersonalSignificance");

    assert.deepEqual(fields.sort(), ["markedAt", "momentId", "significant"]);

    for (const absent of ["score", "value", "dimension", "scope", "provenance", "algorithmVersion"]) {
      assert.ok(!fields.includes(absent), `significance exposed ${absent}`);
    }
  });

  it("has no shape that could carry anybody else's mark", async () => {
    const fields = await fieldsOf("PersonalSignificance");

    for (const absent of ["count", "total", "users", "markedBy"]) {
      assert.ok(!fields.includes(absent), `significance exposed ${absent}`);
    }
  });
});

describe("moving sideways", () => {
  it("hands back a scope, so a client need not assemble one", async () => {
    // The point of the field is "open that Timeline". A shape the client had to
    // reconstruct a scope from would make its primary use its assembly job.
    assert.deepEqual((await fieldsOf("HistoricalContext")).sort(), [
      "adjacency",
      "name",
      "scope",
    ]);
  });

  it("says why a context is there, rather than leaving it to the order", async () => {
    // Order is not durable meaning: a client that sorts or re-pages loses it,
    // and mere co-presence then reads as connection.
    assert.deepEqual((await enumValuesOf("ContextAdjacency")).sort(), [
      "SAME_PERIOD",
      "SHARED_HISTORY",
    ]);
    assert.equal(await isRequired("HistoricalContext", "adjacency"), true);
  });

  it("offers no measure of how connected two contexts are", async () => {
    // A number beside a context is the first vertebra of a ranking, and with
    // the disclosure gate it would be a count over a superset of what survives.
    const fields = await fieldsOf("HistoricalContext");

    for (const absent of ["sharedMomentCount", "momentCount", "count", "strength", "score"]) {
      assert.ok(!fields.includes(absent), `the axis exposed ${absent}`);
    }
  });

  it("pages, because the axis does not run out", async () => {
    assert.ok((await fieldsOf("HistoricalContextConnection")).includes("pageInfo"));
    assert.ok((await fieldsOf("HistoricalContextConnection")).includes("edges"));
  });
});

describe("an occurrence in the world", () => {
  it("carries its names and its own places", async () => {
    assert.deepEqual((await fieldsOf("RealWorldEvent")).sort(), [
      "aliases",
      "locations",
      "name",
      "occurrence",
      "realWorldEventId",
    ]);
  });

  it("says nothing about who recorded it, or when", async () => {
    // Recording an occurrence is provenance and never ownership, and a field
    // named for its creator is one somebody builds a permission around. When
    // the record was made is not when the occurrence happened.
    const fields = await fieldsOf("RealWorldEvent");

    for (const absent of ["createdByUserId", "createdBy", "createdAt", "owner"]) {
      assert.ok(!fields.includes(absent), `an occurrence exposed ${absent}`);
    }
  });

  it("is null when it may not be had, so one refusal covers both reasons", async () => {
    assert.equal(await isRequired("Query", "realWorldEvent"), false);
  });
});

describe("reading history span by span", () => {
  it("offers every scale somebody zooms through", async () => {
    assert.deepEqual((await enumValuesOf("TimelineScale")).sort(), [
      "CENTURY",
      "DAY",
      "DECADE",
      "MONTH",
      "WEEK",
      "YEAR",
    ]);
  });

  it("reads at one scale for the whole answer, so a mixed one cannot be expressed", async () => {
    // On the distribution rather than on each span. A scale per bucket would
    // permit an answer mixing them, and permitting it is inviting it.
    assert.ok((await fieldsOf("TemporalDistribution")).includes("scale"));
    assert.ok(!(await fieldsOf("TemporalBucket")).includes("scale"));
  });

  it("says which interval it read, because a client draws the empty spans itself", async () => {
    // A rolling range resolves against the instant the request arrived. Without
    // these a client could not know which spans were silent and which were never
    // asked about.
    assert.deepEqual((await fieldsOf("TemporalDistribution")).sort(), [
      "buckets",
      "from",
      "scale",
      "scope",
      "to",
    ]);
  });

  it("carries a span, how much it holds, and a little of what was in it", async () => {
    assert.deepEqual((await fieldsOf("TemporalBucket")).sort(), [
      "count",
      "representatives",
      "startsAt",
    ]);
  });

  it("says where a span begins and lets its scale say where it ends", async () => {
    // A second instant per bucket would be a second thing to get wrong at a
    // boundary, and it is already determined by `startsAt` and the scale.
    assert.ok(!(await fieldsOf("TemporalBucket")).includes("endsAt"));
  });

  it("makes a withheld representative impossible to express", async () => {
    const bucket = await typeNamed("TemporalBucket");
    const field = bucket.fields.find((one: { name: string }) => one.name === "representatives");

    // A list of the readable member, never the union and never `Moment`. The
    // type is what enforces that a representative is always readable — a client
    // cannot receive a redacted one because there is no shape for one — and
    // never the depth type, which would cost a statement each.
    assert.equal(field.type.kind, "NON_NULL");
    assert.equal(field.type.ofType.kind, "LIST");

    assert.equal(namedTypeOf(field.type), "ReadableTimelineEntry");
  });

  it("puts no score, rank or reason beside a span", async () => {
    // Significance decides the order and never reaches a client. Order in the
    // list is the only ranking signal there is.
    const fields = await fieldsOf("TemporalBucket");

    for (const forbidden of ["significance", "score", "rank", "density", "cursor", "reason"]) {
      assert.ok(!fields.includes(forbidden), `TemporalBucket exposes ${forbidden}`);
    }
  });

  it("does not split a count into what may and may not be read", async () => {
    // The ratio is the disclosure. One count, whose meaning depends on whose
    // Timeline it is rather than on which half a client adds up.
    const fields = await fieldsOf("TemporalBucket");

    assert.ok(!fields.includes("readableCount"));
    assert.ok(!fields.includes("withheldCount"));
  });
});

describe("arriving somewhere without travelling there", () => {
  it("carries the position, what was at it, where it landed and why", async () => {
    assert.deepEqual((await fieldsOf("TimelineAround")).sort(), [
      "anchoredAt",
      "at",
      "newer",
      "older",
      "reason",
      "scope",
    ]);
  });

  it("lets the position exist with nothing at it, and lets there be no position", async () => {
    // Two different nulls. A position with nothing at it is jumping to a time
    // nothing happened at; no position at all is a destination that was not
    // this reader's to reach.
    assert.equal(await isRequired("TimelineAround", "anchoredAt"), false);
    assert.equal(await isRequired("TimelineAround", "at"), false);
  });

  it("always says which Timeline it landed in, and why", async () => {
    // A jump may cross scopes, so these cannot be optional: a client that could
    // not tell where it arrived would have to assume it did not move.
    assert.equal(await isRequired("TimelineAround", "scope"), true);
    assert.equal(await isRequired("TimelineAround", "reason"), true);
  });

  it("offers every way of naming a destination, and no more", async () => {
    const input = await typeNamed("TimelineAnchorInput");

    assert.deepEqual(input.inputFields.map((one: { name: string }) => one.name).sort(), [
      "causal",
      "instant",
      "location",
      "moment",
      "realWorldEvent",
      "significance",
    ]);
  });

  it("makes every anchor optional, because exactly one is a runtime rule", async () => {
    // A required field would make "exactly one" unexpressible. The refusal
    // happens in the resolver, before any store is read.
    const input = await typeNamed("TimelineAnchorInput");

    for (const field of input.inputFields) {
      assert.notEqual(field.type.kind, "NON_NULL", `${field.name} is required`);
    }
  });

  it("names only reasons the server can actually verify", async () => {
    // No SEARCH_RESULT until something produces one. A reason the server could
    // only echo back from a client's assertion would undo the property that
    // makes returning it worth anything.
    assert.deepEqual((await enumValuesOf("TimelineJumpReason")).sort(), [
      "CAUSAL_RELATIONSHIP",
      "HISTORICAL_SIGNIFICANCE",
      "INSTANT",
      "LOCATION",
      "MOMENT",
      "REAL_WORLD_EVENT",
    ]);
  });

  it("requires a Moment to travel from when following a relationship", async () => {
    // Without it, knowing any relationship's identifier would let somebody
    // travel from a Moment it has nothing to do with.
    const input = await typeNamed("CausalAnchorInput");
    const from = input.inputFields.find((one: { name: string }) => one.name === "fromMomentId");

    assert.equal(from.type.kind, "NON_NULL");
  });

  it("says nothing about how far away anything was, or how much it mattered", async () => {
    // Significance may choose a destination and may never be shown. A distance
    // would reintroduce the nearest-Moment semantics the product forbids.
    const fields = await fieldsOf("TimelineAround");

    for (const forbidden of ["score", "significance", "rank", "nearest", "distance", "foundExactly"]) {
      assert.ok(!fields.includes(forbidden), `TimelineAround exposes ${forbidden}`);
    }
  });
});

describe("what this phase did not add", () => {
  it("leaves Query with the fields that can be answered", async () => {
    // Types are defined here; the queries returning them arrive with the phases
    // that compose them. Every type this schema declares is now returned by
    // something.
    assert.deepEqual(
      (await fieldsOf("Query")).sort(),
      [
        "adjacentContexts",
        "moment",
        "realWorldEvent",
        "temporalDistribution",
        "timeline",
        "timelineAround",
        "timelineHead",
        "viewer",
      ],
    );
  });

  it("leaves the finest rung of the ladder exactly as it was", async () => {
    // The temptation to fold zoom into `timeline` as an argument will recur. It
    // cannot be done: a field's return type may not vary by argument, so the
    // node would have to become a union and every client already written would
    // acquire a case to handle at the scale it was already using.
    const timeline = (await typeNamed("Query")).fields.find(
      (one: { name: string }) => one.name === "timeline",
    );

    assert.deepEqual(timeline.args.map((one: { name: string }) => one.name).sort(), [
      "after",
      "before",
      "first",
      "last",
      "view",
    ]);
  });

  it("offers no way to open a place directly", async () => {
    // Deliberate. A REST endpoint already serves any authenticated caller a
    // place in full, so a GraphQL rule withholding one would protect nothing —
    // and deriving Location visibility would answer an open product question by
    // implementation.
    assert.ok(!(await fieldsOf("Query")).includes("location"));
  });

  it("offers no way to enumerate occurrences", async () => {
    // The property ADR-100 called load-bearing: an occurrence is reachable by
    // identifier or as somebody's adjacent context, and both are gated.
    const fields = await fieldsOf("Query");

    for (const absent of ["realWorldEvents", "searchRealWorldEvents", "events"]) {
      assert.ok(!fields.includes(absent), `Query exposed ${absent}`);
    }
  });

  it("still exposes no mutations and no subscriptions", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      payload: { query: "{ __schema { mutationType { name } subscriptionType { name } } }" },
    });
    const schema = response.json().data.__schema;

    assert.equal(schema.mutationType, null);
    assert.equal(schema.subscriptionType, null);
  });
});
