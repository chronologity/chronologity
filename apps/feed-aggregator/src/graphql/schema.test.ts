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
          fields { name type { kind name ofType { kind name } } }
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

describe("what this phase did not add", () => {
  it("leaves Query with the fields that can be answered", async () => {
    // Types are defined here; the queries returning them arrive with the phases
    // that compose them. A field declared before then would answer null, so a
    // jump and a distribution are absent until something can answer one.
    assert.deepEqual((await fieldsOf("Query")).sort(), ["timeline", "timelineHead", "viewer"]);
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
